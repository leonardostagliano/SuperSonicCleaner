import { describe, expect, it } from 'vitest'
import type { DiskSmartInfo, PerfSnapshot } from '@shared/types'
import {
  chartBody,
  diskFacts,
  diskRateState,
  formatClock,
  formatDateTime,
  formatPercent,
  formatSeconds,
  loadAlerts,
  meterTone,
  uptimeParts
} from './perf-summary'

const NBSP = '\u00a0'

function snapshot(cpu: number, memory: number, timestamp = 0): PerfSnapshot {
  return {
    timestamp,
    cpu: { overall: cpu, perCore: [cpu] },
    memory: { usedBytes: 1, totalBytes: 2, cachedBytes: 0, percent: memory },
    disk: { readBytesPerSec: 0, writeBytesPerSec: 0 },
    network: { rxBytesPerSec: 0, txBytesPerSec: 0 },
    uptime: 60
  }
}

function disk(overrides: Partial<DiskSmartInfo> = {}): DiskSmartInfo {
  return {
    device: 'disk0',
    model: 'Disk',
    type: 'SSD',
    sizeBytes: 1,
    temperature: null,
    healthStatus: 'Healthy',
    powerOnHours: null,
    remainingLife: null,
    readErrors: null,
    writeErrors: null,
    reallocatedSectors: null,
    smartAttributes: [],
    ...overrides
  }
}

describe('meterTone', () => {
  it('stays neutral up to 90 % and turns danger above it', () => {
    expect(meterTone(null)).toBe('neutral')
    expect(meterTone(59)).toBe('neutral')
    expect(meterTone(85)).toBe('neutral')
    expect(meterTone(90)).toBe('neutral')
    expect(meterTone(90.5)).toBe('danger')
  })
})

describe('loadAlerts', () => {
  it('is empty before the first sample', () => {
    expect(loadAlerts(null, [])).toEqual([])
  })

  it('reports CPU only when the last five samples are all above 90 %', () => {
    const high = [95, 96, 97, 98, 99].map((cpu) => snapshot(cpu, 10))
    expect(loadAlerts(high[4], high)).toEqual([{ id: 'cpu-high' }])
    const dip = [95, 96, 80, 98, 99].map((cpu) => snapshot(cpu, 10))
    expect(loadAlerts(dip[4], dip)).toEqual([])
    expect(loadAlerts(high[3], high.slice(0, 4))).toEqual([])
  })

  it('reports memory above 85 % with the current percentage', () => {
    const now = snapshot(10, 87.4)
    expect(loadAlerts(now, [now])).toEqual([{ id: 'mem-high', percent: 87.4 }])
    const edge = snapshot(10, 85)
    expect(loadAlerts(edge, [edge])).toEqual([])
  })
})

describe('diskRateState', () => {
  const withDisk = (available: boolean | undefined) => {
    const sample = snapshot(10, 10)
    return { ...sample, disk: { ...sample.disk, available } }
  }

  it('waits for the first samples', () => {
    expect(diskRateState(null, [])).toBe('waiting')
    const early = Array.from({ length: 9 }, () => withDisk(false))
    expect(diskRateState(early[8], early)).toBe('waiting')
  })

  it('is measured as soon as a sample has disk rates', () => {
    expect(diskRateState(withDisk(true), [withDisk(true)])).toBe('measured')
    expect(diskRateState(withDisk(undefined), [withDisk(undefined)])).toBe('measured')
  })

  it('gives up after ten samples without disk rates', () => {
    const none = Array.from({ length: 10 }, () => withDisk(false))
    expect(diskRateState(none[9], none)).toBe('unavailable')
  })

  it('keeps waiting when rates existed earlier and paused for a moment', () => {
    const gap = [withDisk(true), ...Array.from({ length: 12 }, () => withDisk(false))]
    expect(diskRateState(gap[12], gap)).toBe('waiting')
  })
})

describe('chartBody', () => {
  it('waits without points and asks for a second one with a single point', () => {
    expect(chartBody([], 2)).toEqual({ kind: 'waiting' })
    expect(chartBody([null, null], 2)).toEqual({ kind: 'waiting' })
    expect(chartBody([null, 40], 2)).toEqual({ kind: 'single' })
  })

  it('returns one sentence when the spread is below the threshold', () => {
    expect(chartBody([70.2, 71.1, 70.8], 2)).toEqual({ kind: 'flat', min: 70.2, max: 71.1 })
  })

  it('draws the chart when the values move', () => {
    expect(chartBody([10, 35, 12], 2)).toEqual({ kind: 'chart' })
  })
})

describe('formatPercent', () => {
  it('follows the language, rounds and keeps Latin digits', () => {
    expect(formatPercent(71.4, 'en')).toBe('71%')
    expect(formatPercent(71.6, 'de')).toBe(`72${NBSP}%`)
    expect(formatPercent(5, 'ar')).toMatch(/^[^\d]*5[^\d]*$/)
  })

  it('keeps the requested decimals', () => {
    expect(formatPercent(0.46, 'it', 1)).toBe('0,5%')
    expect(formatPercent(12, 'en', 1)).toBe('12.0%')
  })
})

describe('formatClock', () => {
  it('shows hours, minutes and seconds with Latin digits', () => {
    const at = new Date(2026, 8, 28, 9, 5, 7).getTime()
    expect(formatClock(at, 'it')).toBe('09:05:07')
    expect(formatClock(at, 'ar')).toMatch(/0?9.05.07/)
  })
})

describe('formatDateTime', () => {
  it('shows the date and time in the UI language with Latin digits', () => {
    const at = new Date(2026, 8, 12, 18, 40).toISOString()
    expect(formatDateTime(at, 'it')).toBe('12 set 2026, 18:40')
    expect(formatDateTime(at, 'ar')).toMatch(/12/)
    expect(formatDateTime(at, 'ar')).not.toMatch(/[٠-٩]/)
  })
})

describe('formatSeconds', () => {
  it('uses the language decimal separator', () => {
    expect(formatSeconds(12345, 'it')).toBe(`12,3${NBSP}s`)
    expect(formatSeconds(500, 'en')).toBe(`0.5${NBSP}s`)
  })
})

describe('uptimeParts', () => {
  it('splits seconds into days, hours and minutes', () => {
    expect(uptimeParts(0)).toEqual({ days: 0, hours: 0, minutes: 0 })
    expect(uptimeParts(59)).toEqual({ days: 0, hours: 0, minutes: 0 })
    expect(uptimeParts(3 * 3600 + 5 * 60)).toEqual({ days: 0, hours: 3, minutes: 5 })
    expect(uptimeParts(11 * 86400 + 9 * 3600 + 21 * 60 + 30)).toEqual({
      days: 11,
      hours: 9,
      minutes: 21
    })
  })
})

describe('diskFacts', () => {
  it('lists nothing a disk did not report', () => {
    expect(diskFacts(disk(), 'en')).toEqual([])
  })

  it('formats the reported values and flags the worrying ones', () => {
    const facts = diskFacts(
      disk({
        temperature: 64,
        powerOnHours: 12345,
        remainingLife: 15,
        readErrors: 0,
        writeErrors: 2,
        reallocatedSectors: 0
      }),
      'it'
    )
    expect(facts).toEqual([
      { key: 'diskFactTemperature', params: { value: 64 }, warn: true },
      { key: 'diskFactPowerOn', params: { value: '12.345' }, warn: false },
      { key: 'diskFactLife', params: { value: '15%' }, warn: true },
      { key: 'diskFactReadErrors', params: { count: 0 }, warn: false },
      { key: 'diskFactWriteErrors', params: { count: 2 }, warn: true },
      { key: 'diskFactReallocated', params: { count: 0 }, warn: false }
    ])
  })

  it('keeps a normal temperature and life unflagged', () => {
    expect(diskFacts(disk({ temperature: 38, remainingLife: 98 }), 'en')).toEqual([
      { key: 'diskFactTemperature', params: { value: 38 }, warn: false },
      { key: 'diskFactLife', params: { value: '98%' }, warn: false }
    ])
  })
})
