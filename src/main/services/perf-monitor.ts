import * as si from 'systeminformation'
import * as os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { IPC } from '../../shared/channels'
import type {
  PerfSystemInfo,
  PerfSnapshot,
  PerfProcess,
  PerfProcessList,
  PerfKillResult,
  DiskSmartInfo,
  StartupItem
} from '../../shared/types'
import { psUtf8 } from './exec-utf8'
import { CpuTimeSampler } from './cpu-time-sampler'

const execFileAsync = promisify(execFile)

export class PerfMonitorService {
  private fastTimer: ReturnType<typeof setInterval> | null = null
  private slowTimer: ReturnType<typeof setInterval> | null = null
  private sender: Electron.WebContents | null = null
  private snapshotListeners = new Set<(snapshot: PerfSnapshot) => void>()
  private monitoringGeneration = 0
  private cachedSystemInfo: PerfSystemInfo | null = null
  private startupExeMap: Map<string, string> = new Map()
  // Guards to prevent overlapping async calls from piling up if si hangs
  private snapshotRunning = false
  private processesRunning = false
  private readonly cpuSampler = new CpuTimeSampler()
  private snapshotGeneration = 0
  // Cache expensive si.networkStats() — poll every 5s, reuse in between
  private cachedNetworkStats = { rxBytesPerSec: 0, txBytesPerSec: 0 }
  private lastNetworkPoll = -Infinity
  private networkPollRunning = false
  private diskPollRunning = false
  private lastDiskPoll = -Infinity
  private diskUpdatedAt = -Infinity
  private cachedDiskStats: PerfSnapshot['disk'] = {
    readBytesPerSec: 0,
    writeBytesPerSec: 0,
    available: false
  }
  private readonly NETWORK_POLL_INTERVAL_MS = 5000

  async getSystemInfo(): Promise<PerfSystemInfo> {
    if (this.cachedSystemInfo) return this.cachedSystemInfo

    const [cpu, os, mem] = await Promise.all([si.cpu(), si.osInfo(), si.mem()])

    this.cachedSystemInfo = {
      cpuModel: `${cpu.manufacturer} ${cpu.brand}`,
      cpuCores: cpu.physicalCores,
      cpuThreads: cpu.cores,
      totalMemBytes: mem.total,
      osVersion: `${os.distro} ${os.release}`,
      hostname: os.hostname
    }
    return this.cachedSystemInfo
  }

  async startMonitoring(
    sender: Electron.WebContents,
    getStartupItems?: () => Promise<StartupItem[]>
  ): Promise<void> {
    const generation = ++this.monitoringGeneration
    this.sender = sender
    if (this.slowTimer) return

    // Build startup exe map for correlation
    if (getStartupItems) {
      try {
        const items = await getStartupItems()
        if (generation !== this.monitoringGeneration || this.sender !== sender) return
        this.startupExeMap.clear()
        for (const item of items) {
          // Extract exe name from command string
          const match = item.command.match(/([^/\\]+\.exe)/i)
          if (match) {
            this.startupExeMap.set(match[1].toLowerCase(), item.displayName || item.name)
          }
        }
      } catch {
        // Startup correlation is optional
      }
    }

    if (generation !== this.monitoringGeneration || this.sender !== sender || sender.isDestroyed())
      return

    // Fast interval: system metrics every 1s
    this.ensureSnapshotTimer()

    // Slow interval: process list every 10s (si.processes() is expensive)
    this.slowTimer = setInterval(() => this.collectProcesses(), 10000)
    this.collectProcesses()
  }

  stopMonitoring(): void {
    this.monitoringGeneration++
    if (this.slowTimer) {
      clearInterval(this.slowTimer)
      this.slowTimer = null
    }
    this.sender = null
    this.stopUnusedSnapshotTimer()
  }

  /** Shared system metrics without starting the expensive process-list collector. */
  subscribeSnapshots(listener: (snapshot: PerfSnapshot) => void): () => void {
    this.snapshotListeners.add(listener)
    this.ensureSnapshotTimer()
    return () => {
      this.snapshotListeners.delete(listener)
      this.stopUnusedSnapshotTimer()
    }
  }

  private ensureSnapshotTimer(): void {
    if (this.fastTimer) return
    this.snapshotGeneration++
    this.cpuSampler.reset()
    this.fastTimer = setInterval(() => void this.collectSnapshot(), 1000)
    void this.collectSnapshot()
  }

  private stopUnusedSnapshotTimer(): void {
    if (!this.sender && this.snapshotListeners.size === 0 && this.fastTimer) {
      clearInterval(this.fastTimer)
      this.fastTimer = null
      this.snapshotGeneration++
      this.cpuSampler.reset()
      this.lastNetworkPoll = -Infinity
      this.lastDiskPoll = -Infinity
    }
  }

  async getProcessName(pid: number): Promise<string | null> {
    try {
      const data = await si.processes()
      const proc = data.list.find((p) => p.pid === pid)
      return proc?.name ?? null
    } catch {
      return null
    }
  }

  async killProcess(pid: number): Promise<PerfKillResult> {
    try {
      process.kill(pid)
      return { success: true }
    } catch {
      // Fallback to platform-specific kill command
      try {
        if (process.platform === 'win32') {
          await execFileAsync('taskkill', ['/F', '/PID', String(pid)])
        } else {
          await execFileAsync('kill', ['-9', String(pid)])
        }
        return { success: true }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        const requiresAdmin =
          message.includes('Access') ||
          message.includes('denied') ||
          message.includes('Operation not permitted')
        return {
          success: false,
          error: requiresAdmin
            ? 'Access denied. Run SuperSonicCleaner as Administrator to end this process.'
            : `Failed to end process: ${message}`,
          requiresAdmin
        }
      }
    }
  }

  async getDiskHealth(): Promise<DiskSmartInfo[]> {
    try {
      const disks = await si.diskLayout()
      const reliabilityMap = await this.getStorageReliability()

      return disks.map((d) => {
        const smartStatus =
          d.smartStatus === 'Ok'
            ? 'Healthy'
            : d.smartStatus === 'Caution'
              ? 'Caution'
              : d.smartStatus === 'Bad'
                ? 'Bad'
                : 'Unknown'

        let diskType: DiskSmartInfo['type'] = 'Unknown'
        if (d.interfaceType === 'NVMe') diskType = 'NVMe'
        else if (d.type === 'SSD') diskType = 'SSD'
        else if (d.type === 'HD') diskType = 'HDD'

        // Match reliability data by device index (e.g. "\\.\PHYSICALDRIVE0" → "0")
        const deviceIndex = d.device.replace(/\D/g, '')
        const rel = reliabilityMap.get(deviceIndex)

        return {
          device: d.device,
          model: d.name,
          type: diskType,
          sizeBytes: d.size,
          temperature: rel?.temperature ?? d.temperature ?? null,
          healthStatus: smartStatus as DiskSmartInfo['healthStatus'],
          powerOnHours: rel?.powerOnHours ?? null,
          remainingLife: rel?.wear !== null && rel?.wear !== undefined ? 100 - rel.wear : null,
          readErrors: rel?.readErrors ?? null,
          writeErrors: rel?.writeErrors ?? null,
          reallocatedSectors: null,
          smartAttributes: []
        }
      })
    } catch {
      return []
    }
  }

  private async getStorageReliability(): Promise<
    Map<
      string,
      {
        temperature: number | null
        powerOnHours: number | null
        wear: number | null
        readErrors: number | null
        writeErrors: number | null
      }
    >
  > {
    const map = new Map<
      string,
      {
        temperature: number | null
        powerOnHours: number | null
        wear: number | null
        readErrors: number | null
        writeErrors: number | null
      }
    >()

    try {
      const script =
        'Get-PhysicalDisk | ForEach-Object { $disk = $_; $rel = $_ | Get-StorageReliabilityCounter; [PSCustomObject]@{ DeviceId = $disk.DeviceId; Temperature = $rel.Temperature; PowerOnHours = $rel.PowerOnHours; ReadErrorsTotal = $rel.ReadErrorsTotal; WriteErrorsTotal = $rel.WriteErrorsTotal; Wear = $rel.Wear } } | ConvertTo-Json -Compress'

      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-Command', psUtf8(script)],
        {
          timeout: 10000,
          windowsHide: true
        }
      )

      const parsed = JSON.parse(stdout.trim())
      const entries = Array.isArray(parsed) ? parsed : [parsed]

      for (const entry of entries) {
        map.set(String(entry.DeviceId), {
          temperature: entry.Temperature ?? null,
          powerOnHours: entry.PowerOnHours ?? null,
          wear: entry.Wear ?? null,
          readErrors: entry.ReadErrorsTotal ?? null,
          writeErrors: entry.WriteErrorsTotal ?? null
        })
      }
    } catch {
      // Requires admin — return empty map, fall back to basic data
    }

    return map
  }

  private pollSlowMetrics(now: number): void {
    // Notch subscribers need only CPU/memory; disk capacity is collected by
    // the notch separately. Never make fast snapshots wait for I/O probes.
    if (!this.sender) return
    const generation = this.snapshotGeneration
    if (!this.diskPollRunning && now - this.lastDiskPoll >= 5000) {
      this.diskPollRunning = true
      this.lastDiskPoll = now
      void si
        .fsStats()
        .then((disk) => {
          if (generation !== this.snapshotGeneration) return
          const read = disk?.rx_sec
          const write = disk?.wx_sec
          const available =
            typeof read === 'number' &&
            Number.isFinite(read) &&
            read >= 0 &&
            typeof write === 'number' &&
            Number.isFinite(write) &&
            write >= 0
          this.cachedDiskStats = {
            readBytesPerSec: available ? read : 0,
            writeBytesPerSec: available ? write : 0,
            available
          }
          this.diskUpdatedAt = performance.now()
        })
        .catch(() => {
          if (generation === this.snapshotGeneration)
            this.cachedDiskStats = { readBytesPerSec: 0, writeBytesPerSec: 0, available: false }
        })
        .finally(() => {
          this.diskPollRunning = false
        })
    }
    if (!this.networkPollRunning && now - this.lastNetworkPoll >= this.NETWORK_POLL_INTERVAL_MS) {
      this.networkPollRunning = true
      this.lastNetworkPoll = now
      void si
        .networkStats()
        .then((net) => {
          if (generation !== this.snapshotGeneration) return
          this.cachedNetworkStats = {
            rxBytesPerSec: net.reduce((sum, entry) => sum + Math.max(0, entry.rx_sec || 0), 0),
            txBytesPerSec: net.reduce((sum, entry) => sum + Math.max(0, entry.tx_sec || 0), 0)
          }
        })
        .catch(() => {})
        .finally(() => {
          this.networkPollRunning = false
        })
    }
  }

  private async collectSnapshot(): Promise<void> {
    if (this.sender?.isDestroyed()) this.stopMonitoring()
    if (!this.sender && this.snapshotListeners.size === 0) {
      this.stopUnusedSnapshotTimer()
      return
    }
    if (this.snapshotRunning) return
    this.snapshotRunning = true
    const generation = this.snapshotGeneration

    try {
      this.pollSlowMetrics(performance.now())

      // On Windows, si.mem() costs ~290ms per call — use os.totalmem()/os.freemem()
      // instead (identical values, near-zero cost). On Linux/macOS, si.mem() is cheap
      // (reads /proc/meminfo or vm_stat) and os.freemem() excludes buffers/cache,
      // so we must keep si.mem() to avoid overstating memory pressure.
      const isWindows = process.platform === 'win32'

      const mem = isWindows ? null : await si.mem()
      if (generation !== this.snapshotGeneration) return
      const cpu = this.cpuSampler.sample(os.cpus(), performance.now())
      if (!cpu) return
      const measuredAt = Date.now()

      let usedMem: number, totalMem: number, cachedMem: number
      if (isWindows) {
        totalMem = os.totalmem()
        usedMem = totalMem - os.freemem()
        cachedMem = 0
      } else if (process.platform === 'darwin') {
        totalMem = mem!.total
        // mem.active includes file-backed/reclaimable pages and vastly overstates
        // real pressure on macOS.  (total − available) matches Activity Monitor.
        usedMem = totalMem - mem!.available
        cachedMem = mem!.cached
      } else {
        usedMem = mem!.active
        totalMem = mem!.total
        cachedMem = mem!.cached
      }

      const snapshot: PerfSnapshot = {
        timestamp: measuredAt,
        cpu,
        memory: {
          usedBytes: usedMem,
          totalBytes: totalMem,
          cachedBytes: cachedMem,
          percent: (usedMem / totalMem) * 100
        },
        disk:
          performance.now() - this.diskUpdatedAt <= 10000
            ? this.cachedDiskStats
            : { readBytesPerSec: 0, writeBytesPerSec: 0, available: false },
        network: this.cachedNetworkStats,
        uptime: si.time().uptime
      }

      if (this.sender && !this.sender.isDestroyed()) {
        this.sender.send(IPC.PERF_SNAPSHOT, snapshot)
      }
      for (const listener of this.snapshotListeners) listener(snapshot)
    } catch {
      // Silently skip failed ticks
    } finally {
      this.snapshotRunning = false
    }
  }

  private async collectProcesses(): Promise<void> {
    if (!this.sender || this.sender.isDestroyed()) {
      this.stopMonitoring()
      return
    }
    if (this.processesRunning) return
    this.processesRunning = true

    try {
      const [data, mem] = await Promise.all([si.processes(), si.mem()])
      const totalMem = mem.total

      // Sort by CPU + memory and take top 100
      const sorted = data.list.sort((a, b) => b.cpu + b.memRss - (a.cpu + a.memRss)).slice(0, 100)

      const processes: PerfProcess[] = sorted.map((p) => {
        const exeName = (p.name || '').toLowerCase()
        const startupName = this.startupExeMap.get(
          exeName.endsWith('.exe') ? exeName : `${exeName}.exe`
        )

        return {
          pid: p.pid,
          name: p.name,
          cpuPercent: p.cpu,
          memBytes: p.memRss,
          memPercent: totalMem > 0 ? (p.memRss / totalMem) * 100 : 0,
          user: p.user || '',
          started: p.started || '',
          isStartupItem: !!startupName,
          startupItemName: startupName
        }
      })

      const result: PerfProcessList = {
        timestamp: Date.now(),
        processes,
        totalCount: data.all
      }

      if (this.sender && !this.sender.isDestroyed()) {
        this.sender.send(IPC.PERF_PROCESS_LIST, result)
      }
    } catch {
      // Silently skip failed ticks
    } finally {
      this.processesRunning = false
    }
  }
}

export const perfMonitor = new PerfMonitorService()
