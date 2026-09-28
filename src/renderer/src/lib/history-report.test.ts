import { describe, expect, it } from 'vitest'
import type { ScanHistoryEntry } from '@shared/types'
import {
  breakdownByCategory,
  breakdownByType,
  dayKey,
  entriesByWeek,
  formatCount,
  formatDateTime,
  formatDay,
  formatShortDay,
  isChartable,
  keyToDate,
  spaceByDay,
  summarizeHistory,
  typesPresent,
  weekKey
} from './history-report'

let id = 0
function entry(
  type: ScanHistoryEntry['type'],
  timestamp: Date,
  values: Partial<ScanHistoryEntry> = {}
): ScanHistoryEntry {
  return {
    id: String(++id),
    type,
    timestamp: timestamp.toISOString(),
    duration: 1000,
    totalItemsFound: 0,
    totalItemsCleaned: 0,
    totalItemsSkipped: 0,
    totalSpaceSaved: 0,
    categories: [],
    errorCount: 0,
    ...values
  }
}
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h)

describe('summarizeHistory', () => {
  it('adds the totals and finds the first and last entry', () => {
    const summary = summarizeHistory([
      entry('cleaner', at(2026, 9, 12), {
        totalSpaceSaved: 2000,
        totalItemsCleaned: 10,
        errorCount: 1,
        duration: 3000
      }),
      entry('malware', at(2026, 9, 1), { totalItemsCleaned: 5, duration: 1000 })
    ])
    expect(summary).toMatchObject({
      count: 2,
      spaceSaved: 2000,
      itemsProcessed: 15,
      errors: 1,
      averageDurationMs: 2000
    })
    expect(summary.firstAt).toBe(at(2026, 9, 1).toISOString())
    expect(summary.lastAt).toBe(at(2026, 9, 12).toISOString())
  })

  it('is empty without entries', () => {
    expect(summarizeHistory([])).toMatchObject({
      count: 0,
      averageDurationMs: 0,
      firstAt: null,
      lastAt: null
    })
  })
})

describe('day and week keys', () => {
  it('uses the local calendar day', () => {
    expect(dayKey(at(2026, 1, 5, 23))).toBe('2026-01-05')
    expect(keyToDate('2026-01-05').getDate()).toBe(5)
  })

  it('starts weeks on Monday', () => {
    // 28 Sep 2026 is a Monday, 4 Oct a Sunday.
    expect(weekKey(at(2026, 9, 28))).toBe('2026-09-28')
    expect(weekKey(at(2026, 10, 4))).toBe('2026-09-28')
    expect(weekKey(at(2026, 10, 5))).toBe('2026-10-05')
  })
})

describe('series', () => {
  it('groups space by day, oldest first, whatever the entry order', () => {
    const entries = [
      entry('cleaner', at(2026, 9, 12, 18), { totalSpaceSaved: 300 }),
      entry('cleaner', at(2026, 9, 10), { totalSpaceSaved: 100 }),
      entry('cleaner', at(2026, 9, 12, 9), { totalSpaceSaved: 200 })
    ]
    expect(spaceByDay(entries)).toEqual([
      { day: '2026-09-10', space: 100 },
      { day: '2026-09-12', space: 500 }
    ])
  })

  it('keeps the newest 30 days', () => {
    const entries = Array.from({ length: 35 }, (_, i) => entry('cleaner', at(2026, 7, 1 + i)))
    const days = spaceByDay(entries)
    expect(days).toHaveLength(30)
    expect(days[0].day).toBe('2026-07-06')
    expect(days.at(-1)?.day).toBe('2026-08-04')
  })

  it('counts entries per week', () => {
    const entries = [
      entry('cleaner', at(2026, 9, 28)),
      entry('startup', at(2026, 10, 1)),
      entry('cleaner', at(2026, 10, 6))
    ]
    expect(entriesByWeek(entries)).toEqual([
      { week: '2026-09-28', count: 2 },
      { week: '2026-10-05', count: 1 }
    ])
  })

  it('skips entries with an unreadable timestamp', () => {
    const broken = { ...entry('cleaner', at(2026, 9, 1)), timestamp: 'not a date' }
    expect(spaceByDay([broken])).toEqual([])
    expect(summarizeHistory([broken]).firstAt).toBeNull()
  })
})

describe('breakdowns', () => {
  it('orders types by count, then by space', () => {
    const rows = breakdownByType([
      entry('startup', at(2026, 9, 1)),
      entry('cleaner', at(2026, 9, 2), { totalSpaceSaved: 50, totalItemsCleaned: 3 }),
      entry('cleaner', at(2026, 9, 3), { totalSpaceSaved: 25, totalItemsCleaned: 1 }),
      entry('malware', at(2026, 9, 4), { totalSpaceSaved: 0 })
    ])
    expect(rows.map((r) => r.type)).toEqual(['cleaner', 'startup', 'malware'])
    expect(rows[0]).toEqual({ type: 'cleaner', count: 2, items: 4, space: 75 })
  })

  it('merges legacy category names and drops empty categories', () => {
    const rows = breakdownByCategory([
      entry('software-update', at(2026, 9, 1), {
        categories: [
          { name: 'minor updates', itemsFound: 2, itemsCleaned: 2, spaceSaved: 0 },
          { name: 'empty', itemsFound: 0, itemsCleaned: 0, spaceSaved: 0 }
        ]
      }),
      entry('software-update', at(2026, 9, 2), {
        categories: [
          { name: 'software-update:minor', itemsFound: 1, itemsCleaned: 1, spaceSaved: 0 }
        ]
      })
    ])
    expect(rows).toEqual([{ key: 'software-update:minor', items: 3, space: 0 }])
  })

  it('lists the types present once each', () => {
    const entries = [
      entry('cleaner', at(2026, 9, 1)),
      entry('malware', at(2026, 9, 2)),
      entry('cleaner', at(2026, 9, 3))
    ]
    expect(typesPresent(entries)).toEqual(['cleaner', 'malware'])
  })
})

describe('formatting', () => {
  it('formats counts and dates in the UI language with Latin digits', () => {
    expect(formatCount(12402, 'it')).toBe('12.402')
    expect(formatCount(1402, 'ar')).toMatch(/^1\D?402$/)
    expect(formatDay(at(2026, 9, 12), 'it')).toBe('12 set 2026')
    expect(formatDateTime(at(2026, 9, 12, 18), 'ar')).toMatch(/2026/)
    expect(formatShortDay(at(2026, 9, 12), 'en')).toBe('Sep 12')
  })

  it('falls back on an unknown locale and an unreadable date', () => {
    expect(formatCount(5, 'not a locale!')).toBe('5')
    expect(formatDateTime('nope', 'it')).toBe('—')
  })
})

describe('isChartable', () => {
  it('needs two points', () => {
    expect(isChartable([])).toBe(false)
    expect(isChartable([5])).toBe(false)
  })

  it('needs a positive maximum and a spread of at least a tenth', () => {
    expect(isChartable([0, 0])).toBe(false)
    expect(isChartable([1, 1, 1])).toBe(false)
    expect(isChartable([100, 95])).toBe(false)
    expect(isChartable([100, 90])).toBe(true)
    expect(isChartable([0, 3])).toBe(true)
  })
})
