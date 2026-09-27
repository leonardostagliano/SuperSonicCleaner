import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  acquireTelemetry,
  resetTelemetryForTests,
  TELEMETRY_TAIL_MS,
  TELEMETRY_WINDOW_MS,
  useTelemetryStore
} from './telemetry-store'

const reading = (cpu: number) => ({
  cpuPercent: cpu,
  memUsedBytes: 1,
  memTotalBytes: 2,
  memPercent: 50
})
let visibility: 'visible' | 'hidden'
const listeners = new Set<() => void>()
const perfQuickStats = vi.fn(async () => reading(10))

function setVisibility(value: 'visible' | 'hidden') {
  visibility = value
  for (const l of listeners) l()
}

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  listeners.clear()
  perfQuickStats.mockClear()
  vi.stubGlobal('window', { kudu: { perfQuickStats } })
  vi.stubGlobal('document', {
    get visibilityState() {
      return visibility
    },
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l)
  })
  resetTelemetryForTests()
})

afterEach(() => {
  resetTelemetryForTests()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('telemetry sampler', () => {
  it('discards the priming read, then samples every 3 s', async () => {
    const release = acquireTelemetry()
    await vi.advanceTimersByTimeAsync(0)
    expect(useTelemetryStore.getState().samples).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(useTelemetryStore.getState().samples).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(useTelemetryStore.getState().samples).toHaveLength(2)
    release()
  })

  it('runs a single polling chain for several views', async () => {
    const a = acquireTelemetry()
    const b = acquireTelemetry()
    await vi.advanceTimersByTimeAsync(1000 + 3000 * 3)
    expect(perfQuickStats).toHaveBeenCalledTimes(5)
    a()
    b()
  })

  it('keeps samples and keeps sampling for the tail after the last view leaves', async () => {
    const release = acquireTelemetry()
    await vi.advanceTimersByTimeAsync(1000)
    release()
    const calls = perfQuickStats.mock.calls.length
    await vi.advanceTimersByTimeAsync(TELEMETRY_TAIL_MS - 1)
    expect(perfQuickStats.mock.calls.length).toBeGreaterThan(calls)
    await vi.advanceTimersByTimeAsync(4000)
    const afterTail = perfQuickStats.mock.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(perfQuickStats.mock.calls.length).toBe(afterTail)
    expect(useTelemetryStore.getState().samples.length).toBeGreaterThan(1)
  })

  it('pauses while the window is hidden and resumes when it is shown', async () => {
    const release = acquireTelemetry()
    await vi.advanceTimersByTimeAsync(1000)
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(3000)
    const paused = perfQuickStats.mock.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(perfQuickStats.mock.calls.length).toBe(paused)
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(perfQuickStats.mock.calls.length).toBe(paused + 1)
    release()
  })

  it('re-primes after a pause instead of blanking the last reading', async () => {
    const release = acquireTelemetry()
    await vi.advanceTimersByTimeAsync(1000)
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(30_000)
    // After a gap longer than 5 s main re-primes its CPU delta and answers null once
    perfQuickStats.mockResolvedValueOnce(null as never)
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(useTelemetryStore.getState().current).not.toBeNull()
    await vi.advanceTimersByTimeAsync(1000)
    expect(useTelemetryStore.getState().samples).toHaveLength(2)
    release()
  })

  it('keeps at most 60 samples', () => {
    for (let i = 0; i < 80; i++) useTelemetryStore.getState().push(reading(i), i)
    const { samples } = useTelemetryStore.getState()
    expect(samples).toHaveLength(60)
    expect(samples[59].cpu).toBe(79)
  })

  it('spans the 60 samples of the chart, 3 s apart', () => {
    expect(TELEMETRY_WINDOW_MS).toBe(180_000)
  })

  it('drops samples older than the chart window when a new one arrives after a gap', () => {
    const { push } = useTelemetryStore.getState()
    const start = 1_000_000
    for (let i = 0; i < 60; i++) push(reading(i), start + i * 3000)
    // Ten minutes later (tail expired or window hidden): the old series must not come back
    const later = start + 59 * 3000 + 10 * 60_000
    push(reading(99), later)
    expect(useTelemetryStore.getState().samples).toEqual([{ at: later, cpu: 99, memory: 50 }])
  })

  it('keeps samples up to one chart window old and drops older ones', () => {
    const { push } = useTelemetryStore.getState()
    push(reading(1), 0)
    push(reading(2), 1)
    push(reading(3), TELEMETRY_WINDOW_MS + 1)
    expect(useTelemetryStore.getState().samples.map((s) => s.cpu)).toEqual([2, 3])
  })
})
