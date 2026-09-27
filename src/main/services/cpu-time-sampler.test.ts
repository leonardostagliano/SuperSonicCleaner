import { describe, expect, it } from 'vitest'
import { cpuTimeTotals, CpuTimeSampler } from './cpu-time-sampler'

const core = (user: number, idle: number, sys = 0, irq = 0) => ({
  times: { user, idle, sys, irq, nice: 0 }
})

describe('CPU busy-time accounting', () => {
  it('counts Windows IRQ once and uses identical totals for recording and live sampling', () => {
    const sampler = new CpuTimeSampler('win32')
    expect(sampler.sample([core(0, 0)], 0)).toBeNull()
    const current = [core(20, 70, 10, 5)]
    expect(cpuTimeTotals(current, 'win32')).toEqual({ idle: 70, total: 100 })
    expect(sampler.sample(current, 1000)?.overall).toBeCloseTo(30)
    expect(cpuTimeTotals(current, 'linux')).toEqual({ idle: 70, total: 105 })
  })

  it('weights total CPU by measured processor time instead of averaging unequal core windows', () => {
    const sampler = new CpuTimeSampler('linux')
    sampler.sample([core(0, 0), core(0, 0)], 0)
    const value = sampler.sample([core(100, 0), core(0, 200)], 1000)!
    expect(value.perCore).toEqual([100, 0])
    expect(value.overall).toBeCloseTo(100 / 3)
  })

  it('preserves real 90% and 100% readings without an artificial adjustment', () => {
    const sampler = new CpuTimeSampler('win32')
    sampler.sample([core(0, 0)], 0)
    expect(sampler.sample([core(90, 10)], 1000)?.overall).toBe(90)
    expect(sampler.sample([core(190, 10)], 2000)?.overall).toBe(100)
  })

  it('rejects counter resets, impossible values and unchanged counters instead of clamping to 100%', () => {
    const sampler = new CpuTimeSampler('win32')
    sampler.sample([core(100, 100)], 0)
    expect(sampler.sample([core(90, 200)], 1000)).toBeNull()
    expect(sampler.sample([core(140, 250)], 2000)?.overall).toBe(50)
    expect(sampler.sample([core(140, 250)], 3000)).toBeNull()
    expect(sampler.sample([core(Number.NaN, 300)], 4000)).toBeNull()
    expect(sampler.sample([core(200, 300)], 5000)).toBeNull()
    expect(sampler.sample([core(200, 400)], 6000)?.overall).toBe(0)
  })

  it('primes after topology changes, long pauses and restarts, and ignores too-short windows', () => {
    const sampler = new CpuTimeSampler('win32')
    sampler.sample([core(0, 0)], 0)
    expect(sampler.sample([core(5, 5)], 100)).toBeNull()
    expect(sampler.sample([core(50, 50)], 1000)?.overall).toBe(50)
    expect(sampler.sample([core(60, 60), core(0, 0)], 2000)).toBeNull()
    expect(sampler.sample([core(70, 70), core(10, 10)], 10000)).toBeNull()
    expect(sampler.sample([core(80, 80), core(20, 20)], 11000)?.overall).toBe(50)
    sampler.reset()
    expect(sampler.sample([core(90, 90), core(30, 30)], 12000)).toBeNull()
  })
})
