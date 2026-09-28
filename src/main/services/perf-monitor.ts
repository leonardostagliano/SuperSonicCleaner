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
import { cpuModelName } from './cpu-model'
import { NetworkThroughput } from './network-throughput'

const execFileAsync = promisify(execFile)

/** A CPU reading needs two counter samples: take the second this soon after priming, then every second. */
export const FIRST_SAMPLE_MS = 300
const SNAPSHOT_INTERVAL_MS = 1000
/** One-off probes wait this long at most for the first reading before starting anyway. */
export const FIRST_READING_WAIT_MS = 2000

export class PerfMonitorService {
  private fastTimer: ReturnType<typeof setInterval> | null = null
  private firstSampleTimer: ReturnType<typeof setTimeout> | null = null
  private slowTimer: ReturnType<typeof setInterval> | null = null
  private sender: Electron.WebContents | null = null
  private snapshotListeners = new Set<(snapshot: PerfSnapshot) => void>()
  private monitoringGeneration = 0
  private cachedSystemInfo: PerfSystemInfo | null = null
  private systemInfoQuery: Promise<PerfSystemInfo> | null = null
  private diskHealthQuery: Promise<DiskSmartInfo[]> | null = null
  // Callers held until the first reading after the snapshot timer starts; null once it went out
  private firstReadingWaiters: Array<() => void> | null = null
  private startupExeMap: Map<string, string> = new Map()
  private lastProcessList: PerfProcessList | null = null
  // Guards to prevent overlapping async calls from piling up if si hangs
  private snapshotRunning = false
  private processesRunning = false
  private readonly cpuSampler = new CpuTimeSampler()
  private snapshotGeneration = 0
  // The first tick after the timer starts only takes the CPU baseline
  private primingTick = false
  // Network counters cost a child process: poll every 5s, reuse in between
  private readonly network = new NetworkThroughput()
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
    // One query for concurrent callers (React's development double mount asks twice)
    this.systemInfoQuery ??= this.querySystemInfo().finally(() => {
      this.systemInfoQuery = null
    })
    return this.systemInfoQuery
  }

  private async querySystemInfo(): Promise<PerfSystemInfo> {
    // About a dozen child processes: start them after the live data, not in front of it
    await this.afterFirstReading()
    const [cpu, osInfo] = await Promise.all([si.cpu(), si.osInfo()])

    this.cachedSystemInfo = {
      cpuModel: cpuModelName(cpu.manufacturer, cpu.brand, os.cpus()[0]?.model),
      cpuCores: cpu.physicalCores,
      cpuThreads: cpu.cores,
      // si.mem() reports this same total, after a PowerShell query for swap on Windows
      totalMemBytes: os.totalmem(),
      osVersion: `${osInfo.distro} ${osInfo.release}`,
      hostname: osInfo.hostname
    }
    return this.cachedSystemInfo
  }

  /**
   * Resolves once the first live reading after the snapshot timer started has
   * gone out (at once when nothing is sampling or it already has), or after
   * FIRST_READING_WAIT_MS. Spawning a child process blocks main's event loop
   * for tens to hundreds of milliseconds on a busy machine, so one-off probes
   * wait here instead of pushing the first value back.
   */
  private afterFirstReading(): Promise<void> {
    const waiters = this.firstReadingWaiters
    if (!waiters) return Promise.resolve()
    return new Promise((resolve) => {
      const release = (): void => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(release, FIRST_READING_WAIT_MS)
      waiters.push(release)
    })
  }

  private releaseFirstReadingWaiters(): void {
    const waiters = this.firstReadingWaiters
    this.firstReadingWaiters = null
    waiters?.forEach((release) => release())
  }

  async startMonitoring(
    sender: Electron.WebContents,
    getStartupItems?: () => Promise<StartupItem[]>
  ): Promise<void> {
    const generation = ++this.monitoringGeneration
    this.sender = sender
    if (this.slowTimer || sender.isDestroyed()) return

    // Live data first: the startup-item lookup below runs beside the collectors
    // Fast interval: system metrics every 1s
    this.ensureSnapshotTimer()

    // Slow interval: process list every 10s (si.processes() is expensive)
    this.slowTimer = setInterval(() => this.collectProcesses(), 10000)
    this.collectProcesses()

    if (getStartupItems) await this.loadStartupItems(getStartupItems, generation, sender)
  }

  /** Startup-item correlation for the process list, applied whenever the lookup settles. */
  private async loadStartupItems(
    getStartupItems: () => Promise<StartupItem[]>,
    generation: number,
    sender: Electron.WebContents
  ): Promise<void> {
    let items: StartupItem[]
    try {
      items = await getStartupItems()
    } catch {
      return // Startup correlation is optional
    }
    if (generation !== this.monitoringGeneration || this.sender !== sender) return
    this.startupExeMap.clear()
    for (const item of items) {
      // Extract exe name from command string
      const match = item.command.match(/([^/\\]+\.exe)/i)
      if (match) {
        this.startupExeMap.set(match[1].toLowerCase(), item.displayName || item.name)
      }
    }
    // The first process list has usually gone out already: send it again, marked
    if (this.lastProcessList && !sender.isDestroyed()) {
      this.lastProcessList = {
        ...this.lastProcessList,
        processes: this.lastProcessList.processes.map((p) => this.withStartupItem(p))
      }
      sender.send(IPC.PERF_PROCESS_LIST, this.lastProcessList)
    }
  }

  private withStartupItem(proc: PerfProcess): PerfProcess {
    const exeName = (proc.name || '').toLowerCase()
    const startupName = this.startupExeMap.get(
      exeName.endsWith('.exe') ? exeName : `${exeName}.exe`
    )
    return { ...proc, isStartupItem: !!startupName, startupItemName: startupName }
  }

  stopMonitoring(): void {
    this.monitoringGeneration++
    if (this.slowTimer) {
      clearInterval(this.slowTimer)
      this.slowTimer = null
    }
    this.sender = null
    this.lastProcessList = null
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
    if (this.fastTimer || this.firstSampleTimer) return
    this.snapshotGeneration++
    this.cpuSampler.reset()
    this.primingTick = true
    this.firstReadingWaiters ??= []
    // Prime now and read shortly after instead of a full second later, then every second
    this.firstSampleTimer = setTimeout(() => {
      this.firstSampleTimer = null
      this.fastTimer = setInterval(() => void this.collectSnapshot(), SNAPSHOT_INTERVAL_MS)
      void this.collectSnapshot()
    }, FIRST_SAMPLE_MS)
    void this.collectSnapshot()
  }

  private stopUnusedSnapshotTimer(): void {
    if (this.sender || this.snapshotListeners.size > 0) return
    if (!this.fastTimer && !this.firstSampleTimer) return
    if (this.firstSampleTimer) clearTimeout(this.firstSampleTimer)
    if (this.fastTimer) clearInterval(this.fastTimer)
    this.firstSampleTimer = null
    this.fastTimer = null
    this.snapshotGeneration++
    this.cpuSampler.reset()
    this.lastNetworkPoll = -Infinity
    this.lastDiskPoll = -Infinity
    // The next session primes network rates instead of averaging over the pause
    this.network.reset()
    this.releaseFirstReadingWaiters()
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

  getDiskHealth(): Promise<DiskSmartInfo[]> {
    // One query for concurrent callers (React's development double mount asks twice)
    this.diskHealthQuery ??= this.queryDiskHealth().finally(() => {
      this.diskHealthQuery = null
    })
    return this.diskHealthQuery
  }

  private async queryDiskHealth(): Promise<DiskSmartInfo[]> {
    // Several child processes, and a synchronous `WHERE smartctl` on the first call:
    // start them after the live data, not in front of it
    await this.afterFirstReading()
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
      // Never si.networkStats() without an interface: its lookup is a synchronous netstat
      void this.network
        .read(now)
        .then((rates) => {
          if (generation === this.snapshotGeneration && rates) this.cachedNetworkStats = rates
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
    const priming = this.primingTick
    this.primingTick = false

    try {
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
      // One-off probes that spawn child processes start once a reading is out
      this.releaseFirstReadingWaiters()
    } catch {
      // Silently skip failed ticks
    } finally {
      this.snapshotRunning = false
      // Disk and network keep their cadence even on a tick without a CPU reading,
      // but never spawn on the priming tick, in front of the first value
      if (!priming && generation === this.snapshotGeneration)
        this.pollSlowMetrics(performance.now())
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
      // si.mem() would add a PowerShell for swap on Windows every 10s for this same total
      const data = await si.processes()
      const totalMem = os.totalmem()

      // Sort by CPU + memory and take top 100
      const sorted = data.list.sort((a, b) => b.cpu + b.memRss - (a.cpu + a.memRss)).slice(0, 100)

      const processes: PerfProcess[] = sorted.map((p) => {
        // systeminformation reports resident memory in KiB on every platform
        // (diagnostics-recorder.ts converts it the same way).
        const memBytes = p.memRss * 1024
        return this.withStartupItem({
          pid: p.pid,
          name: p.name,
          cpuPercent: p.cpu,
          memBytes,
          memPercent: totalMem > 0 ? (memBytes / totalMem) * 100 : 0,
          user: p.user || '',
          started: p.started || ''
        })
      })

      const result: PerfProcessList = {
        timestamp: Date.now(),
        processes,
        totalCount: data.all
      }

      if (this.sender && !this.sender.isDestroyed()) {
        this.lastProcessList = result
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
