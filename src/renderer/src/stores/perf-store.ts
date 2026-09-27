import { create } from 'zustand'
import type { PerfSystemInfo, PerfSnapshot, PerfProcess, DiskSmartInfo } from '@shared/types'

const MAX_HISTORY = 900 // 15 minutes at 1s intervals
const CHART_THROTTLE_MS = 2000 // Only update chart-facing history every 2s

interface PerfState {
  systemInfo: PerfSystemInfo | null
  currentSnapshot: PerfSnapshot | null
  /** Ring buffer backing store — mutated in place to avoid GC pressure */
  _ringBuffer: PerfSnapshot[]
  _ringWriteIndex: number
  _ringSize: number
  /**
   * Snapshot of the ring buffer exposed to React — only updated every CHART_THROTTLE_MS
   * to avoid re-rendering charts on every 1s tick.
   */
  history: PerfSnapshot[]
  _lastHistoryFlush: number
  processList: PerfProcess[]
  processCount: number
  isMonitoring: boolean
  timeRange: '60s' | '5m' | '15m'
  processFilter: string
  processSortColumn: 'cpuPercent' | 'memBytes' | 'name' | 'pid'
  processSortDir: 'asc' | 'desc'
  diskHealth: DiskSmartInfo[]

  setSystemInfo: (info: PerfSystemInfo) => void
  pushSnapshot: (snap: PerfSnapshot) => void
  setProcessList: (processes: PerfProcess[], totalCount: number) => void
  setMonitoring: (on: boolean) => void
  setTimeRange: (range: '60s' | '5m' | '15m') => void
  setProcessFilter: (filter: string) => void
  setProcessSort: (column: PerfState['processSortColumn']) => void
  setDiskHealth: (disks: DiskSmartInfo[]) => void
  reset: () => void
}

function ringToArray(buf: PerfSnapshot[], writeIdx: number, size: number): PerfSnapshot[] {
  if (size === 0) return []
  if (size <= buf.length) {
    // Buffer not yet wrapped — just slice
    const start = writeIdx - size
    if (start >= 0) return buf.slice(start, writeIdx)
    // Wrapped — concat tail + head
    return buf.slice(buf.length + start).concat(buf.slice(0, writeIdx))
  }
  return buf.slice(0, size)
}

export const usePerfStore = create<PerfState>((set, get) => ({
  systemInfo: null,
  currentSnapshot: null,
  _ringBuffer: new Array<PerfSnapshot>(MAX_HISTORY),
  _ringWriteIndex: 0,
  _ringSize: 0,
  history: [],
  _lastHistoryFlush: 0,
  processList: [],
  processCount: 0,
  isMonitoring: false,
  timeRange: '60s',
  processFilter: '',
  processSortColumn: 'cpuPercent',
  processSortDir: 'desc',
  diskHealth: [],

  setSystemInfo: (info) => set({ systemInfo: info }),

  pushSnapshot: (snap) => {
    const state = get()
    const buf = state._ringBuffer
    const idx = state._ringWriteIndex
    buf[idx] = snap
    const nextIdx = (idx + 1) % MAX_HISTORY
    const nextSize = Math.min(state._ringSize + 1, MAX_HISTORY)

    const now = Date.now()
    const shouldFlush = now - state._lastHistoryFlush >= CHART_THROTTLE_MS

    if (shouldFlush) {
      set({
        currentSnapshot: snap,
        _ringWriteIndex: nextIdx,
        _ringSize: nextSize,
        history: ringToArray(buf, nextIdx, nextSize),
        _lastHistoryFlush: now
      })
    } else {
      set({
        currentSnapshot: snap,
        _ringWriteIndex: nextIdx,
        _ringSize: nextSize
      })
    }
  },

  setProcessList: (processes, totalCount) =>
    set({ processList: processes, processCount: totalCount }),

  setMonitoring: (on) => set({ isMonitoring: on }),

  setTimeRange: (range) => set({ timeRange: range }),

  setProcessFilter: (filter) => set({ processFilter: filter }),

  setDiskHealth: (disks) => set({ diskHealth: disks }),

  setProcessSort: (column) => {
    const { processSortColumn, processSortDir } = get()
    if (processSortColumn === column) {
      set({ processSortDir: processSortDir === 'asc' ? 'desc' : 'asc' })
    } else {
      set({ processSortColumn: column, processSortDir: 'desc' })
    }
  },

  reset: () =>
    set({
      currentSnapshot: null,
      _ringBuffer: new Array<PerfSnapshot>(MAX_HISTORY),
      _ringWriteIndex: 0,
      _ringSize: 0,
      history: [],
      _lastHistoryFlush: 0,
      processList: [],
      processCount: 0,
      isMonitoring: false,
      processFilter: '',
      diskHealth: []
    })
}))

// Monitoring lifecycle: one subscription for the app, a tail after the last
// view leaves (coming back paints at once), paused while the window is hidden.
export const MONITOR_TAIL_MS = 2 * 60 * 1000

let perfConsumers = 0
let stopTimer: ReturnType<typeof setTimeout> | undefined
let unsubscribe: (() => void) | null = null
let started = false
let userPaused = false
let onStartError: (() => void) | undefined

const perfHidden = () => document.visibilityState === 'hidden'

function startMonitoring() {
  if (started || userPaused) return
  started = true
  window.kudu
    .perfStartMonitoring()
    .then(() => usePerfStore.getState().setMonitoring(true))
    .catch(() => {
      started = false
      onStartError?.()
    })
}

function stopMonitoring() {
  if (!started) return
  started = false
  window.kudu.perfStopMonitoring().catch(() => {})
  usePerfStore.getState().setMonitoring(false)
}

function teardown() {
  clearTimeout(stopTimer)
  stopTimer = undefined
  stopMonitoring()
  unsubscribe?.()
  unsubscribe = null
  document.removeEventListener('visibilitychange', onPerfVisibility)
}

function onPerfVisibility() {
  if (perfHidden()) {
    if (perfConsumers === 0) teardown()
    else stopMonitoring()
  } else if (perfConsumers > 0) {
    startMonitoring()
  }
}

/** Keep the monitor running for one view; call the returned function when it goes away. */
export function acquirePerfMonitoring(onError?: () => void): () => void {
  perfConsumers++
  userPaused = false // a view opens with its Pause button off
  onStartError = onError
  clearTimeout(stopTimer)
  stopTimer = undefined
  if (!unsubscribe) {
    const offSnapshot = window.kudu.onPerfSnapshot((snap) =>
      usePerfStore.getState().pushSnapshot(snap)
    )
    const offProcesses = window.kudu.onPerfProcessList((data) =>
      usePerfStore.getState().setProcessList(data.processes, data.totalCount)
    )
    unsubscribe = () => {
      offSnapshot()
      offProcesses()
    }
    document.addEventListener('visibilitychange', onPerfVisibility)
  }
  if (!perfHidden()) startMonitoring()
  let released = false
  return () => {
    if (released) return
    released = true
    perfConsumers--
    if (perfConsumers === 0) stopTimer = setTimeout(teardown, MONITOR_TAIL_MS)
  }
}

/** The page's Pause button: stop the feed, and keep it stopped across hide and show. */
export function setPerfMonitoringPaused(paused: boolean): void {
  userPaused = paused
  if (paused) stopMonitoring()
  else if (perfConsumers > 0 && !perfHidden()) startMonitoring()
}

export function resetPerfMonitoringForTests(): void {
  perfConsumers = 0
  userPaused = false
  teardown()
}
