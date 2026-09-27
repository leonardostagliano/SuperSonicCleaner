import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  acquirePerfMonitoring,
  MONITOR_TAIL_MS,
  resetPerfMonitoringForTests,
  setPerfMonitoringPaused,
  usePerfStore
} from './perf-store'
import type { PerfSnapshot } from '@shared/types'

function makeSnapshot(timestamp: number): PerfSnapshot {
  return {
    timestamp,
    cpu: { overall: 50, perCore: [50] },
    memory: { usedBytes: 4e9, totalBytes: 8e9, cachedBytes: 1e9, percent: 50 },
    disk: { readBytesPerSec: 1e6, writeBytesPerSec: 5e5 },
    network: { rxBytesPerSec: 1e4, txBytesPerSec: 5e3 },
    uptime: 3600
  }
}

describe('perf-store', () => {
  beforeEach(() => {
    usePerfStore.getState().reset()
  })

  it('starts with empty state', () => {
    const state = usePerfStore.getState()
    expect(state.history).toEqual([])
    expect(state.currentSnapshot).toBeNull()
    expect(state.isMonitoring).toBe(false)
  })

  it('pushSnapshot sets currentSnapshot immediately', () => {
    const snap = makeSnapshot(1)
    usePerfStore.getState().pushSnapshot(snap)
    const state = usePerfStore.getState()
    expect(state.currentSnapshot).toEqual(snap)
    // Ring buffer should have 1 entry
    expect(state._ringSize).toBe(1)
  })

  it('pushSnapshot flushes history to React after throttle window', () => {
    // First push triggers flush (lastHistoryFlush starts at 0)
    usePerfStore.getState().pushSnapshot(makeSnapshot(1))
    expect(usePerfStore.getState().history.length).toBeGreaterThanOrEqual(1)
  })

  it('pushSnapshot caps ring buffer at MAX_HISTORY (900)', () => {
    for (let i = 0; i < 910; i++) {
      usePerfStore.getState().pushSnapshot(makeSnapshot(i))
    }
    const state = usePerfStore.getState()
    expect(state._ringSize).toBe(900)
    // Latest snapshot should always be current
    expect(state.currentSnapshot!.timestamp).toBe(909)
  })

  it('setProcessSort toggles direction on same column', () => {
    expect(usePerfStore.getState().processSortDir).toBe('desc')
    usePerfStore.getState().setProcessSort('cpuPercent')
    expect(usePerfStore.getState().processSortDir).toBe('asc')
    usePerfStore.getState().setProcessSort('cpuPercent')
    expect(usePerfStore.getState().processSortDir).toBe('desc')
  })

  it('setProcessSort resets to desc on new column', () => {
    usePerfStore.getState().setProcessSort('cpuPercent') // asc
    usePerfStore.getState().setProcessSort('memBytes') // new column → desc
    const state = usePerfStore.getState()
    expect(state.processSortColumn).toBe('memBytes')
    expect(state.processSortDir).toBe('desc')
  })

  it('setTimeRange updates time range', () => {
    usePerfStore.getState().setTimeRange('15m')
    expect(usePerfStore.getState().timeRange).toBe('15m')
  })

  it('setProcessFilter updates filter', () => {
    usePerfStore.getState().setProcessFilter('chrome')
    expect(usePerfStore.getState().processFilter).toBe('chrome')
  })

  it('reset preserves systemInfo but clears monitoring data', () => {
    usePerfStore.getState().setSystemInfo({
      cpuModel: 'i7',
      cpuCores: 8,
      cpuThreads: 16,
      totalMemBytes: 16e9,
      osVersion: 'Win11',
      hostname: 'TEST'
    })
    usePerfStore.getState().pushSnapshot(makeSnapshot(1))
    usePerfStore.getState().setMonitoring(true)
    usePerfStore.getState().reset()
    const state = usePerfStore.getState()
    expect(state.systemInfo).not.toBeNull() // Preserved
    expect(state.history).toEqual([])
    expect(state.isMonitoring).toBe(false)
  })
})

describe('perf monitoring lifecycle', () => {
  let visibility: 'visible' | 'hidden'
  const listeners = new Set<() => void>()
  const api = {
    onPerfSnapshot: vi.fn(() => () => {}),
    onPerfProcessList: vi.fn(() => () => {}),
    perfStartMonitoring: vi.fn(async () => {}),
    perfStopMonitoring: vi.fn(async () => {})
  }
  const setVisibility = (value: 'visible' | 'hidden') => {
    visibility = value
    for (const l of listeners) l()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    visibility = 'visible'
    listeners.clear()
    Object.values(api).forEach((fn) => fn.mockClear())
    vi.stubGlobal('window', { kudu: api })
    vi.stubGlobal('document', {
      get visibilityState() {
        return visibility
      },
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l)
    })
    resetPerfMonitoringForTests()
  })

  afterEach(() => {
    resetPerfMonitoringForTests()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('starts and subscribes once for several views', async () => {
    const a = acquirePerfMonitoring()
    const b = acquirePerfMonitoring()
    await vi.advanceTimersByTimeAsync(0)
    expect(api.perfStartMonitoring).toHaveBeenCalledTimes(1)
    expect(api.onPerfSnapshot).toHaveBeenCalledTimes(1)
    a()
    b()
  })

  it('stops only after the tail, and a quick return cancels the stop', async () => {
    const release = acquirePerfMonitoring()
    await vi.advanceTimersByTimeAsync(0)
    release()
    await vi.advanceTimersByTimeAsync(MONITOR_TAIL_MS - 1)
    expect(api.perfStopMonitoring).not.toHaveBeenCalled()
    const again = acquirePerfMonitoring()
    await vi.advanceTimersByTimeAsync(MONITOR_TAIL_MS)
    expect(api.perfStopMonitoring).not.toHaveBeenCalled()
    expect(api.perfStartMonitoring).toHaveBeenCalledTimes(1)
    again()
    await vi.advanceTimersByTimeAsync(MONITOR_TAIL_MS)
    expect(api.perfStopMonitoring).toHaveBeenCalledTimes(1)
  })

  it('stops while hidden and starts again when shown', async () => {
    const release = acquirePerfMonitoring()
    await vi.advanceTimersByTimeAsync(0)
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(0)
    expect(api.perfStopMonitoring).toHaveBeenCalledTimes(1)
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(api.perfStartMonitoring).toHaveBeenCalledTimes(2)
    release()
  })

  it('keeps a paused view paused while hidden; resuming or reopening restarts', async () => {
    const release = acquirePerfMonitoring()
    await vi.advanceTimersByTimeAsync(0)
    setPerfMonitoringPaused(true)
    expect(api.perfStopMonitoring).toHaveBeenCalledTimes(1)
    expect(usePerfStore.getState().monitoringPaused).toBe(true)
    setVisibility('hidden')
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(api.perfStartMonitoring).toHaveBeenCalledTimes(1)
    expect(usePerfStore.getState().monitoringPaused).toBe(true)
    setPerfMonitoringPaused(false)
    expect(api.perfStartMonitoring).toHaveBeenCalledTimes(2)
    expect(usePerfStore.getState().monitoringPaused).toBe(false)
    setPerfMonitoringPaused(true)
    release()
    // Leaving drops the pause without restarting the feed during the tail
    expect(usePerfStore.getState().monitoringPaused).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(api.perfStartMonitoring).toHaveBeenCalledTimes(2)
    // Coming back inside the tail shows a fresh Pause button, so the feed runs again
    const again = acquirePerfMonitoring()
    expect(api.perfStartMonitoring).toHaveBeenCalledTimes(3)
    again()
  })

  it('shows a failed start as paused, never retries on its own, and Resume retries', async () => {
    api.perfStartMonitoring.mockRejectedValueOnce(new Error('denied'))
    const onError = vi.fn()
    const release = acquirePerfMonitoring(onError)
    await vi.advanceTimersByTimeAsync(0)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(usePerfStore.getState().monitoringPaused).toBe(true)
    expect(usePerfStore.getState().isMonitoring).toBe(false)
    setVisibility('hidden')
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(api.perfStartMonitoring).toHaveBeenCalledTimes(1)
    setPerfMonitoringPaused(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(api.perfStartMonitoring).toHaveBeenCalledTimes(2)
    expect(usePerfStore.getState().monitoringPaused).toBe(false)
    expect(usePerfStore.getState().isMonitoring).toBe(true)
    release()
  })

  it('ignores the outcome of a start that a later stop superseded', async () => {
    let rejectFirst: (error: Error) => void = () => {}
    api.perfStartMonitoring.mockImplementationOnce(
      () => new Promise<void>((_, reject) => (rejectFirst = reject))
    )
    const onError = vi.fn()
    const release = acquirePerfMonitoring(onError)
    setVisibility('hidden')
    setVisibility('visible')
    rejectFirst(new Error('late'))
    await vi.advanceTimersByTimeAsync(0)
    expect(api.perfStartMonitoring).toHaveBeenCalledTimes(2)
    expect(onError).not.toHaveBeenCalled()
    expect(usePerfStore.getState().monitoringPaused).toBe(false)
    expect(usePerfStore.getState().isMonitoring).toBe(true)
    release()
  })

  it('pauses on hide during the tail, keeps the subscription, and stays off when shown', async () => {
    const release = acquirePerfMonitoring()
    await vi.advanceTimersByTimeAsync(0)
    release()
    await vi.advanceTimersByTimeAsync(1000)
    setVisibility('hidden')
    expect(api.perfStopMonitoring).toHaveBeenCalledTimes(1)
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(api.perfStartMonitoring).toHaveBeenCalledTimes(1)
    // A return inside the tail reuses the subscription and only restarts main sampling
    const again = acquirePerfMonitoring()
    expect(api.onPerfSnapshot).toHaveBeenCalledTimes(1)
    expect(api.perfStartMonitoring).toHaveBeenCalledTimes(2)
    again()
  })

  it('still tears down when the tail expires while hidden, and showing later stays off', async () => {
    const offSnapshot = vi.fn()
    api.onPerfSnapshot.mockReturnValueOnce(offSnapshot)
    const release = acquirePerfMonitoring()
    await vi.advanceTimersByTimeAsync(0)
    release()
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(MONITOR_TAIL_MS - 1)
    expect(offSnapshot).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(offSnapshot).toHaveBeenCalledTimes(1)
    expect(api.perfStopMonitoring).toHaveBeenCalledTimes(1)
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(api.perfStartMonitoring).toHaveBeenCalledTimes(1)
  })
})
