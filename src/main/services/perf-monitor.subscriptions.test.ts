import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as si from 'systeminformation'
import * as os from 'os'
import type { StartupItem } from '../../shared/types'
import { FIRST_READING_WAIT_MS, FIRST_SAMPLE_MS, PerfMonitorService } from './perf-monitor'

const network = vi.hoisted(() => ({ read: vi.fn(), reset: vi.fn() }))

vi.mock('systeminformation', () => ({
  currentLoad: vi.fn().mockResolvedValue({ currentLoad: 24, cpus: [{ load: 24 }] }),
  cpu: vi
    .fn()
    .mockResolvedValue({ manufacturer: 'Intel', brand: 'Core', physicalCores: 4, cores: 8 }),
  osInfo: vi.fn().mockResolvedValue({ distro: 'Windows 11 Pro', release: '10.0', hostname: 'pc' }),
  diskLayout: vi.fn().mockResolvedValue([]),
  fsStats: vi.fn().mockResolvedValue(null),
  mem: vi.fn().mockResolvedValue({ total: 100, available: 60, active: 40, cached: 10 }),
  processes: vi.fn().mockResolvedValue({ list: [], all: 0 }),
  time: () => ({ uptime: 10 })
}))
vi.mock('os', () => ({ cpus: vi.fn(), totalmem: vi.fn(() => 100), freemem: () => 60 }))
vi.mock('child_process', () => ({
  execFile: vi.fn((...args: unknown[]) =>
    (args.at(-1) as (error: null, result: { stdout: string }) => void)(null, { stdout: '[]' })
  ),
  spawn: vi.fn()
}))
vi.mock('./network-throughput', () => ({
  NetworkThroughput: class {
    read = network.read
    reset = network.reset
  }
}))

beforeEach(() => {
  let ticks = 0
  vi.mocked(os.cpus).mockImplementation(() => {
    ticks++
    return [
      {
        model: 'Synthetic CPU',
        speed: 1000,
        times: { user: ticks * 24, idle: ticks * 76, nice: 0, sys: 0, irq: 0 }
      }
    ]
  })
  vi.mocked(si.fsStats)
    .mockReset()
    .mockResolvedValue(null as never)
  network.read.mockReset().mockResolvedValue({ rxBytesPerSec: 0, txBytesPerSec: 0 })
  vi.mocked(si.mem)
    .mockReset()
    .mockResolvedValue({ total: 100, available: 60, active: 40, cached: 10 } as never)
  vi.mocked(si.processes)
    .mockReset()
    .mockResolvedValue({ list: [], all: 0 } as never)
  vi.mocked(os.totalmem).mockReset().mockReturnValue(100)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('shared performance snapshots', () => {
  it('does not restart timers after stopping during asynchronous startup lookup', async () => {
    vi.useFakeTimers()
    const service = new PerfMonitorService()
    let resolveLookup!: (items: []) => void
    const lookup = new Promise<[]>((resolve) => {
      resolveLookup = resolve
    })
    const sender = { isDestroyed: () => false, send: vi.fn() }
    const start = service.startMonitoring(sender as unknown as Electron.WebContents, () => lookup)
    service.stopMonitoring()
    resolveLookup([])
    await start
    await vi.advanceTimersByTimeAsync(20000)
    expect(si.currentLoad).not.toHaveBeenCalled()
    // Only the collection that started with monitoring, before the lookup settled
    expect(si.processes).toHaveBeenCalledTimes(1)
    expect(sender.send).not.toHaveBeenCalledWith('perf:snapshot', expect.anything())
    expect(vi.getTimerCount()).toBe(0)
  })

  it('starts sampling without waiting for the startup-item lookup and applies it when it arrives', async () => {
    vi.useFakeTimers()
    vi.mocked(si.processes).mockResolvedValueOnce({
      list: [{ pid: 7, name: 'Tray.exe', cpu: 1, memRss: 10, user: '', started: '' }],
      all: 1
    } as never)
    const service = new PerfMonitorService()
    let resolveLookup!: (items: StartupItem[]) => void
    const lookup = new Promise<StartupItem[]>((resolve) => {
      resolveLookup = resolve
    })
    const sender = { isDestroyed: () => false, send: vi.fn() }
    const start = service.startMonitoring(sender as unknown as Electron.WebContents, () => lookup)
    await vi.advanceTimersByTimeAsync(FIRST_SAMPLE_MS)
    expect(sender.send).toHaveBeenCalledWith('perf:snapshot', expect.anything())
    expect(sender.send).toHaveBeenCalledWith(
      'perf:process-list',
      expect.objectContaining({ processes: [expect.objectContaining({ isStartupItem: false })] })
    )
    resolveLookup([
      { name: 'tray', displayName: 'Tray helper', command: '"C:\\Apps\\Tray.exe" --min' }
    ] as StartupItem[])
    await start
    expect(sender.send).toHaveBeenLastCalledWith(
      'perf:process-list',
      expect.objectContaining({
        processes: [
          expect.objectContaining({ isStartupItem: true, startupItemName: 'Tray helper' })
        ]
      })
    )
    service.stopMonitoring()
  })

  it('takes the first reading shortly after priming, then keeps the one-second cadence', async () => {
    vi.useFakeTimers()
    const service = new PerfMonitorService()
    const listener = vi.fn()
    const off = service.subscribeSnapshots(listener)
    await vi.advanceTimersByTimeAsync(FIRST_SAMPLE_MS - 1)
    expect(listener).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].cpu.overall).toBeCloseTo(24)
    await vi.advanceTimersByTimeAsync(999)
    expect(listener).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(listener).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(3000)
    expect(listener).toHaveBeenCalledTimes(5)
    off()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves no timer behind when the last subscriber goes before the first reading', async () => {
    vi.useFakeTimers()
    const service = new PerfMonitorService()
    const listener = vi.fn()
    service.subscribeSnapshots(listener)()
    expect(vi.getTimerCount()).toBe(0)
    // Windows takes the priming CPU reading synchronously; Linux and macOS await si.mem()
    // first and skip it once the subscriber has gone. Either way nothing reads again.
    const primingReads = vi.mocked(os.cpus).mock.calls.length
    expect(primingReads).toBeLessThanOrEqual(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(listener).not.toHaveBeenCalled()
    expect(os.cpus).toHaveBeenCalledTimes(primingReads)
  })

  it('starts one timer pair when two startup lookups resolve together', async () => {
    vi.useFakeTimers()
    const service = new PerfMonitorService()
    let resolveLookup!: (items: []) => void
    const lookup = new Promise<[]>((resolve) => {
      resolveLookup = resolve
    })
    const sender = { isDestroyed: () => false, send: vi.fn() }
    const first = service.startMonitoring(sender as unknown as Electron.WebContents, () => lookup)
    const second = service.startMonitoring(sender as unknown as Electron.WebContents, () => lookup)
    resolveLookup([])
    await Promise.all([first, second])
    await vi.advanceTimersByTimeAsync(0)
    expect(os.cpus).toHaveBeenCalledTimes(1)
    expect(si.currentLoad).not.toHaveBeenCalled()
    expect(si.processes).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(2)
    service.stopMonitoring()
  })

  it('shares one collector among subscribers and stops after the last leaves', async () => {
    vi.useFakeTimers()
    const service = new PerfMonitorService()
    const first = vi.fn(),
      second = vi.fn()
    const offFirst = service.subscribeSnapshots(first)
    const offSecond = service.subscribeSnapshots(second)
    await vi.advanceTimersByTimeAsync(0)
    expect(os.cpus).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(si.processes).not.toHaveBeenCalled()
    expect(network.read).not.toHaveBeenCalled()
    expect(si.fsStats).not.toHaveBeenCalled()
    offFirst()
    await vi.advanceTimersByTimeAsync(1000)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
    offSecond()
    await vi.advanceTimersByTimeAsync(2000)
    expect(os.cpus).toHaveBeenCalledTimes(3)
  })
  it('keeps notch snapshots alive when the performance page stops', async () => {
    vi.useFakeTimers()
    const service = new PerfMonitorService()
    const listener = vi.fn()
    const off = service.subscribeSnapshots(listener)
    const sender = { isDestroyed: () => false, send: vi.fn() }
    await service.startMonitoring(sender as unknown as Electron.WebContents)
    await vi.advanceTimersByTimeAsync(0)
    expect(si.processes).toHaveBeenCalledTimes(1)
    service.stopMonitoring()
    const count = listener.mock.calls.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(listener).toHaveBeenCalledTimes(count + 1)
    off()
  })

  it('keeps the shared network reading when the page stops while another subscriber stays', async () => {
    vi.useFakeTimers()
    network.read.mockResolvedValue({ rxBytesPerSec: 2048, txBytesPerSec: 512 })
    const service = new PerfMonitorService()
    const listener = vi.fn()
    const off = service.subscribeSnapshots(listener)
    const sender = { isDestroyed: () => false, send: vi.fn() }
    await service.startMonitoring(sender as unknown as Electron.WebContents)
    await vi.advanceTimersByTimeAsync(2000)
    expect(network.read).toHaveBeenCalledTimes(1)
    service.stopMonitoring()
    // The timer keeps running for the subscriber: nothing about the network restarts
    expect(network.reset).not.toHaveBeenCalled()
    const count = listener.mock.calls.length
    await vi.advanceTimersByTimeAsync(3000)
    expect(listener).toHaveBeenCalledTimes(count + 3)
    for (const [snapshot] of listener.mock.calls.slice(count))
      expect(snapshot.network).toEqual({ rxBytesPerSec: 2048, txBytesPerSec: 512 })
    // The page comes back: readings continue from the same baseline
    await service.startMonitoring(sender as unknown as Electron.WebContents)
    await vi.advanceTimersByTimeAsync(1000)
    expect(network.read).toHaveBeenCalledTimes(2)
    expect(network.reset).not.toHaveBeenCalled()
    service.stopMonitoring()
    off()
    // Only when the shared timer really stops does the next session prime again
    expect(network.reset).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps disk and network polling when a CPU sample fails after priming', async () => {
    vi.useFakeTimers()
    vi.mocked(si.fsStats).mockResolvedValue({ rx_sec: 1, wx_sec: 2 } as never)
    const service = new PerfMonitorService()
    const sender = { isDestroyed: () => false, send: vi.fn() }
    await service.startMonitoring(sender as unknown as Electron.WebContents)
    await vi.advanceTimersByTimeAsync(0)
    expect(network.read).not.toHaveBeenCalled()
    // Counters become unusable right after priming: no CPU reading at all
    vi.mocked(os.cpus).mockReturnValue([
      { model: 'Broken CPU', speed: 0, times: { user: -1, idle: 0, nice: 0, sys: 0, irq: 0 } }
    ])
    await vi.advanceTimersByTimeAsync(FIRST_SAMPLE_MS)
    expect(sender.send).not.toHaveBeenCalledWith('perf:snapshot', expect.anything())
    expect(network.read).toHaveBeenCalledTimes(1)
    expect(si.fsStats).toHaveBeenCalledTimes(1)
    service.stopMonitoring()
  })

  it('keeps CPU and memory updating while disk and network probes never settle', async () => {
    vi.useFakeTimers()
    vi.mocked(si.fsStats).mockImplementation(() => new Promise(() => {}))
    network.read.mockImplementation(() => new Promise(() => {}))
    const service = new PerfMonitorService()
    const listener = vi.fn()
    const off = service.subscribeSnapshots(listener)
    const sender = { isDestroyed: () => false, send: vi.fn() }
    await service.startMonitoring(sender as unknown as Electron.WebContents)
    // Readings at FIRST_SAMPLE_MS, then every second: stop on the sixth
    await vi.advanceTimersByTimeAsync(5000 + FIRST_SAMPLE_MS)
    expect(listener).toHaveBeenCalledTimes(6)
    expect(si.fsStats).toHaveBeenCalledTimes(1)
    expect(network.read).toHaveBeenCalledTimes(1)
    const latest = listener.mock.calls.at(-1)![0]
    expect(latest.cpu.overall).toBeCloseTo(24)
    expect(latest.memory.percent).toBe(40)
    expect(latest.timestamp).toBe(Date.now())
    expect(latest.disk.available).toBe(false)
    expect(sender.send).toHaveBeenCalledWith('perf:snapshot', latest)
    service.stopMonitoring()
    off()
  })

  it('uses byte counters and marks unsupported or stale disk measurements unavailable', async () => {
    vi.useFakeTimers()
    vi.mocked(si.fsStats)
      .mockResolvedValueOnce({ rx_sec: 2048, wx_sec: 4096 } as never)
      .mockImplementation(() => new Promise(() => {}))
    const service = new PerfMonitorService()
    const listener = vi.fn()
    const off = service.subscribeSnapshots(listener)
    const sender = { isDestroyed: () => false, send: vi.fn() }
    await service.startMonitoring(sender as unknown as Electron.WebContents)
    await vi.advanceTimersByTimeAsync(2000)
    expect(listener.mock.calls.at(-1)![0].disk).toEqual({
      readBytesPerSec: 2048,
      writeBytesPerSec: 4096,
      available: true
    })
    await vi.advanceTimersByTimeAsync(11000)
    expect(listener.mock.calls.at(-1)![0].disk.available).toBe(false)
    service.stopMonitoring()
    off()
  })

  it('re-primes CPU after all subscribers leave instead of reusing a previous session average', async () => {
    vi.useFakeTimers()
    const service = new PerfMonitorService()
    const listener = vi.fn()
    const off = service.subscribeSnapshots(listener)
    await vi.advanceTimersByTimeAsync(1000)
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    const next = vi.fn()
    const offNext = service.subscribeSnapshots(next)
    await vi.advanceTimersByTimeAsync(0)
    expect(next).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(next).toHaveBeenCalledTimes(1)
    offNext()
  })

  it('shows default-interface throughput and primes it again after the page stops', async () => {
    vi.useFakeTimers()
    network.read.mockResolvedValue({ rxBytesPerSec: 2048, txBytesPerSec: 512 })
    const service = new PerfMonitorService()
    const sender = { isDestroyed: () => false, send: vi.fn() }
    await service.startMonitoring(sender as unknown as Electron.WebContents)
    await vi.advanceTimersByTimeAsync(0)
    // Priming spawns nothing: the probes start once the first reading is out
    expect(network.read).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(FIRST_SAMPLE_MS)
    expect(network.read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(sender.send).toHaveBeenLastCalledWith(
      'perf:snapshot',
      expect.objectContaining({ network: { rxBytesPerSec: 2048, txBytesPerSec: 512 } })
    )
    await vi.advanceTimersByTimeAsync(3000)
    expect(network.read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(network.read).toHaveBeenCalledTimes(2)
    service.stopMonitoring()
    expect(network.reset).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('lists processes without waiting on a memory query', async () => {
    vi.useFakeTimers()
    // 10 KiB of 100 KiB.
    vi.mocked(os.totalmem).mockReturnValue(100 * 1024)
    vi.mocked(si.mem).mockRejectedValue(new Error('PowerShell timed out'))
    vi.mocked(si.processes).mockResolvedValueOnce({
      list: [{ pid: 7, name: 'Tray.exe', cpu: 1, memRss: 10, user: '', started: '' }],
      all: 1
    } as never)
    const service = new PerfMonitorService()
    const sender = { isDestroyed: () => false, send: vi.fn() }
    await service.startMonitoring(sender as unknown as Electron.WebContents)
    await vi.advanceTimersByTimeAsync(0)
    expect(sender.send).toHaveBeenCalledWith(
      'perf:process-list',
      expect.objectContaining({ processes: [expect.objectContaining({ memPercent: 10 })] })
    )
    service.stopMonitoring()
  })

  it('reports process memory in bytes: systeminformation gives resident memory in KiB', async () => {
    vi.useFakeTimers()
    vi.mocked(os.totalmem).mockReturnValue(8 * 1024 ** 3)
    // 222 208 KiB = 217 MiB, as si.processes() reports a browser tab.
    vi.mocked(si.processes).mockResolvedValueOnce({
      list: [{ pid: 7, name: 'msedge.exe', cpu: 1, memRss: 222208, user: '', started: '' }],
      all: 1
    } as never)
    const service = new PerfMonitorService()
    const sender = { isDestroyed: () => false, send: vi.fn() }
    await service.startMonitoring(sender as unknown as Electron.WebContents)
    await vi.advanceTimersByTimeAsync(0)
    const call = sender.send.mock.calls.find(([channel]) => channel === 'perf:process-list')
    const [process] = (call?.[1] as { processes: { memBytes: number; memPercent: number }[] })
      .processes
    expect(process.memBytes).toBe(222208 * 1024)
    expect(process.memPercent).toBeCloseTo(((222208 * 1024) / (8 * 1024 ** 3)) * 100, 6)
    service.stopMonitoring()
  })
})

describe('one-off probes on page open', () => {
  const sender = () => ({ isDestroyed: () => false, send: vi.fn() })

  it('holds system info until the first reading and shares one query between callers', async () => {
    vi.useFakeTimers()
    const service = new PerfMonitorService()
    const page = sender()
    await service.startMonitoring(page as unknown as Electron.WebContents)
    // React's development double mount asks twice
    const first = service.getSystemInfo()
    const second = service.getSystemInfo()
    await vi.advanceTimersByTimeAsync(FIRST_SAMPLE_MS - 1)
    expect(si.cpu).not.toHaveBeenCalled()
    expect(si.osInfo).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(page.send).toHaveBeenCalledWith('perf:snapshot', expect.anything())
    expect(await first).toBe(await second)
    expect(await first).toMatchObject({ cpuCores: 4, cpuThreads: 8, hostname: 'pc' })
    expect(si.cpu).toHaveBeenCalledTimes(1)
    expect(si.osInfo).toHaveBeenCalledTimes(1)
    service.stopMonitoring()
  })

  it('holds disk health until the first reading and shares one query between callers', async () => {
    vi.useFakeTimers()
    const service = new PerfMonitorService()
    await service.startMonitoring(sender() as unknown as Electron.WebContents)
    const first = service.getDiskHealth()
    const second = service.getDiskHealth()
    await vi.advanceTimersByTimeAsync(FIRST_SAMPLE_MS - 1)
    expect(si.diskLayout).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await first).toEqual([])
    expect(await second).toEqual([])
    expect(si.diskLayout).toHaveBeenCalledTimes(1)
    service.stopMonitoring()
  })

  it('runs probes at once when nothing samples, and after a bounded wait without a reading', async () => {
    vi.useFakeTimers()
    const service = new PerfMonitorService()
    await service.getDiskHealth()
    expect(si.diskLayout).toHaveBeenCalledTimes(1)
    // Unusable counters: the sampler never produces a reading
    vi.mocked(os.cpus).mockReturnValue([
      { model: 'Broken CPU', speed: 0, times: { user: -1, idle: 0, nice: 0, sys: 0, irq: 0 } }
    ])
    await service.startMonitoring(sender() as unknown as Electron.WebContents)
    const disks = service.getDiskHealth()
    await vi.advanceTimersByTimeAsync(FIRST_READING_WAIT_MS - 1)
    expect(si.diskLayout).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await disks).toEqual([])
    expect(si.diskLayout).toHaveBeenCalledTimes(2)
    service.stopMonitoring()
  })
})
