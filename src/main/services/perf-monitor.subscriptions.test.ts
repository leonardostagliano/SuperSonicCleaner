import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as si from 'systeminformation'
import * as os from 'os'
import { PerfMonitorService } from './perf-monitor'

vi.mock('systeminformation', () => ({
  currentLoad: vi.fn().mockResolvedValue({ currentLoad: 24, cpus: [{ load: 24 }] }),
  fsStats: vi.fn().mockResolvedValue(null),
  networkStats: vi.fn().mockResolvedValue([]),
  mem: vi.fn().mockResolvedValue({ total: 100, available: 60, active: 40, cached: 10 }),
  processes: vi.fn().mockResolvedValue({ list: [], all: 0 }),
  time: () => ({ uptime: 10 })
}))
vi.mock('os', () => ({ cpus: vi.fn(), totalmem: () => 100, freemem: () => 60 }))

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
  vi.mocked(si.networkStats).mockReset().mockResolvedValue([])
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
    expect(si.processes).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
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
    expect(si.networkStats).not.toHaveBeenCalled()
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

  it('keeps CPU and memory updating while disk and network probes never settle', async () => {
    vi.useFakeTimers()
    vi.mocked(si.fsStats).mockImplementation(() => new Promise(() => {}))
    vi.mocked(si.networkStats).mockImplementation(() => new Promise(() => {}))
    const service = new PerfMonitorService()
    const listener = vi.fn()
    const off = service.subscribeSnapshots(listener)
    const sender = { isDestroyed: () => false, send: vi.fn() }
    await service.startMonitoring(sender as unknown as Electron.WebContents)
    await vi.advanceTimersByTimeAsync(6000)
    expect(listener).toHaveBeenCalledTimes(6)
    expect(si.fsStats).toHaveBeenCalledTimes(1)
    expect(si.networkStats).toHaveBeenCalledTimes(1)
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
})
