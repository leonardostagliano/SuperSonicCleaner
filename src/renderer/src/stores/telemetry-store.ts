import { create } from 'zustand'
import type { PerfQuickStats } from '@shared/types'

export interface QuickSample {
  at: number
  cpu: number
  memory: number
}

const MAX_SAMPLES = 60
const POLL_MS = 3000
const FIRST_SAMPLE_MS = 1000
/** Keep sampling this long after the last view leaves, so coming back shows a full chart. */
export const TELEMETRY_TAIL_MS = 2 * 60 * 1000
/**
 * The chart's nominal span. Samples older than this (relative to the newest one)
 * are dropped, so after a long gap — tail expired, window hidden — the series
 * restarts instead of squeezing the live data against the right edge.
 */
export const TELEMETRY_WINDOW_MS = MAX_SAMPLES * POLL_MS

interface TelemetryState {
  current: PerfQuickStats | null
  samples: QuickSample[]
  push: (reading: PerfQuickStats | null, at: number) => void
}

export const useTelemetryStore = create<TelemetryState>((set) => ({
  current: null,
  samples: [],
  push: (reading, at) =>
    set((s) =>
      reading
        ? {
            current: reading,
            samples: [
              ...s.samples
                .filter((sample) => at - sample.at <= TELEMETRY_WINDOW_MS)
                .slice(-(MAX_SAMPLES - 1)),
              { at, cpu: reading.cpuPercent, memory: reading.memPercent }
            ]
          }
        : { current: null }
    )
}))

// Sampler lifecycle: one polling chain for the whole app, never while hidden.
let consumers = 0
let releasedAt: number | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let polling = false
let primed = false
let listening = false

const hidden = () => document.visibilityState === 'hidden'
const inTail = () => releasedAt !== null && Date.now() - releasedAt < TELEMETRY_TAIL_MS
const wanted = () => consumers > 0 || inTail()

function stopListening() {
  if (!listening) return
  document.removeEventListener('visibilitychange', onVisibilityChange)
  listening = false
}

async function poll() {
  timer = undefined
  // Main re-primes its CPU delta after a gap longer than 5 s, so any pause
  // needs a fresh priming read; until then the last reading stays on screen.
  if (!wanted()) {
    primed = false
    stopListening()
    return
  }
  if (hidden()) {
    primed = false
    return // onVisibilityChange resumes
  }
  polling = true
  const priming = !primed
  try {
    const reading = await window.kudu?.perfQuickStats?.()
    // The first CPU reading only primes the delta in main; it is not a real value
    if (!priming) useTelemetryStore.getState().push(reading ?? null, Date.now())
    primed = true
  } catch {
    useTelemetryStore.getState().push(null, Date.now())
  } finally {
    polling = false
  }
  const soon = priming || useTelemetryStore.getState().samples.length === 0
  timer = setTimeout(() => void poll(), soon ? FIRST_SAMPLE_MS : POLL_MS)
}

function onVisibilityChange() {
  if (!hidden() && timer === undefined && !polling && wanted()) void poll()
}

/** Sample for one view; call the returned function when the view goes away. */
export function acquireTelemetry(): () => void {
  consumers++
  releasedAt = null
  if (!listening) {
    document.addEventListener('visibilitychange', onVisibilityChange)
    listening = true
  }
  if (timer === undefined && !polling) void poll()
  let released = false
  return () => {
    if (released) return
    released = true
    consumers--
    if (consumers === 0) releasedAt = Date.now()
  }
}

export function resetTelemetryForTests(): void {
  clearTimeout(timer)
  timer = undefined
  consumers = 0
  releasedAt = null
  polling = false
  primed = false
  stopListening()
  useTelemetryStore.setState({ current: null, samples: [] })
}
