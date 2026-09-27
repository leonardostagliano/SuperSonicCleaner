import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../shared/channels'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, () => unknown>(),
  cpus: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, callback: () => unknown) => mocks.handlers.set(channel, callback)
  }
}))
vi.mock('os', () => ({ default: { cpus: mocks.cpus, totalmem: () => 100, freemem: () => 60 } }))
vi.mock('../services/perf-monitor', () => ({ perfMonitor: {} }))

import { registerPerfMonitorIpc } from './perf-monitor.ipc'

afterEach(() => vi.useRealTimers())

describe('dashboard CPU sample availability', () => {
  it('returns null for priming, counter resets and pauses without reporting a healthy zero', () => {
    vi.useFakeTimers()
    const counters = (user: number, idle: number) => [
      { times: { user, idle, nice: 0, sys: 0, irq: 0 } }
    ]
    registerPerfMonitorIpc(() => null)
    const read = mocks.handlers.get(IPC.PERF_QUICK_STATS)!
    mocks.cpus.mockReturnValue(counters(0, 0))
    expect(read()).toBeNull()
    vi.advanceTimersByTime(1000)
    mocks.cpus.mockReturnValue(counters(90, 10))
    expect(read()).toMatchObject({ cpuPercent: 90, memPercent: 40 })
    vi.advanceTimersByTime(3000)
    mocks.cpus.mockReturnValue(counters(1, 2))
    expect(read()).toBeNull()
    vi.advanceTimersByTime(3000)
    mocks.cpus.mockReturnValue(counters(51, 52))
    expect(read()).toMatchObject({ cpuPercent: 50 })
    vi.advanceTimersByTime(6000)
    mocks.cpus.mockReturnValue(counters(91, 62))
    expect(read()).toBeNull()
    vi.advanceTimersByTime(1000)
    mocks.cpus.mockReturnValue(counters(91, 162))
    expect(read()).toMatchObject({ cpuPercent: 0, memPercent: 40 })
  })

  it('still surfaces unexpected counter failures', () => {
    registerPerfMonitorIpc(() => null)
    mocks.cpus.mockImplementationOnce(() => {
      throw new Error('Synthetic counter failure')
    })
    expect(mocks.handlers.get(IPC.PERF_QUICK_STATS)).toThrow('Synthetic counter failure')
  })
})
