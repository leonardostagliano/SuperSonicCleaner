import type { CpuInfo } from 'os'

type CpuReading = { overall: number; perCore: number[] }
type Counters = number[][]
export type CpuTimeTotals = { idle: number; total: number }

function readCounters(
  cpus: readonly Pick<CpuInfo, 'times'>[],
  platform: NodeJS.Platform
): Counters | null {
  const counters = cpus.map(({ times }) => [
    times.idle,
    times.user,
    times.nice,
    times.sys,
    platform === 'win32' ? 0 : times.irq
  ])
  return !counters.length ||
    counters.some((values) => values.some((value) => !Number.isFinite(value) || value < 0))
    ? null
    : counters
}

/** Windows kernel time already includes IRQ; use the same accounting in
 * recordings and the live monitor rather than summing that time twice. */
export function cpuTimeTotals(
  cpus: readonly Pick<CpuInfo, 'times'>[],
  platform: NodeJS.Platform = process.platform
): CpuTimeTotals | null {
  const counters = readCounters(cpus, platform)
  if (!counters) return null
  const idle = counters.reduce((sum, values) => sum + values[0], 0)
  const total = counters.reduce((sum, values) => sum + values.reduce((a, b) => a + b, 0), 0)
  return Number.isFinite(total) && Number.isFinite(idle) ? { idle, total } : null
}

/** Busy-time percentage, weighted by measured time across logical processors.
 * Each consumer owns its baseline; no boot average, cross-consumer interval,
 * frequency correction or smoothing is applied. */
export class CpuTimeSampler {
  private previous: Counters | null = null
  private previousAt = 0

  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  reset(): void {
    this.previous = null
    this.previousAt = 0
  }

  sample(cpus: readonly Pick<CpuInfo, 'times'>[], now: number): CpuReading | null {
    const counters = readCounters(cpus, this.platform)
    if (!Number.isFinite(now) || !counters) {
      this.reset()
      return null
    }
    const previous = this.previous
    const elapsed = now - this.previousAt
    if (previous && elapsed > 0 && elapsed < 250) return null
    this.previous = counters
    this.previousAt = now
    // Prime after start, suspend or a topology change; don't present a long
    // historical average as a current one-second observation.
    if (!previous || previous.length !== counters.length || elapsed <= 0 || elapsed > 5000)
      return null
    let total = 0
    let idle = 0
    const perCore: number[] = []
    for (let i = 0; i < counters.length; i++) {
      const delta = counters[i].map((value, j) => value - previous[i][j])
      const ticks = delta.reduce((sum, value) => sum + value, 0)
      if (delta.some((value) => value < 0) || ticks <= 0 || !Number.isFinite(ticks)) return null
      total += ticks
      idle += delta[0]
      perCore.push((1 - delta[0] / ticks) * 100)
    }
    return Number.isFinite(total) && Number.isFinite(idle)
      ? { overall: (1 - idle / total) * 100, perCore }
      : null
  }
}
