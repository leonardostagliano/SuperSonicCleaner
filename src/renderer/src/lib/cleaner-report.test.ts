import { describe, expect, it } from 'vitest'
import type { ScanHistoryEntry, ScanItem, ScanResult } from '@shared/types'
import {
  categoryWasRead,
  emptyScannedGroups,
  entryTotal,
  formatDateTime,
  formatDelay,
  formatElapsed,
  formatList,
  formatPercent,
  formatTime,
  isRecommendedGroup,
  isRecommendedResult,
  isSafeDefault,
  latestEntry,
  nextSizeSort,
  selectionState,
  selectionTotals,
  sortBySize
} from './cleaner-report'

const item = (id: string, patch: Partial<ScanItem> = {}): ScanItem => ({
  id,
  path: `C:\\temp\\${id}`,
  size: 100,
  category: 'system',
  subcategory: 'temp',
  lastModified: 0,
  selected: true,
  ...patch
})

const result = (subcategory: string, items: ScanItem[]): ScanResult => ({
  category: 'system',
  subcategory,
  items,
  totalSize: items.reduce((sum, i) => sum + i.size, 0),
  itemCount: items.length
})

const entry = (
  id: string,
  type: ScanHistoryEntry['type'],
  timestamp: string
): ScanHistoryEntry => ({
  id,
  type,
  timestamp,
  duration: 0,
  totalItemsFound: 0,
  totalItemsCleaned: 0,
  totalItemsSkipped: 0,
  totalSpaceSaved: 0,
  categories: [],
  errorCount: 0
})

describe('recommended items', () => {
  it('treats a pre-selected plain deletion as a safe default', () => {
    expect(isSafeDefault(item('a'))).toBe(true)
  })

  it('never recommends opt-in items, cache resets or native maintenance', () => {
    expect(isSafeDefault(item('a', { selected: false }))).toBe(false)
    expect(isSafeDefault(item('a', { cacheReset: true }))).toBe(false)
    expect(isSafeDefault(item('a', { cleanupAction: 'uv-prune' }))).toBe(false)
  })

  it('recommends a result only when every item is a safe default', () => {
    expect(isRecommendedResult(result('temp', [item('a'), item('b')]))).toBe(true)
    expect(isRecommendedResult(result('temp', [item('a'), item('b', { selected: false })]))).toBe(
      false
    )
    expect(isRecommendedResult(result('empty', []))).toBe(false)
  })

  it('recommends a category when it pre-selects at least one result', () => {
    const optIn = result('shell', [item('s', { selected: false })])
    expect(isRecommendedGroup([optIn])).toBe(false)
    expect(isRecommendedGroup([optIn, result('temp', [item('a')])])).toBe(true)
    expect(isRecommendedGroup([])).toBe(false)
  })
})

describe('selection', () => {
  const results = [
    result('temp', [item('a'), item('b', { size: 50 })]),
    result('logs', [item('c')])
  ]

  it('reports none, some or all of the items as selected', () => {
    expect(selectionState(results, new Set())).toBe('none')
    expect(selectionState(results, new Set(['a']))).toBe('some')
    expect(selectionState(results, new Set(['a', 'b', 'c']))).toBe('all')
    expect(selectionState([], new Set(['a']))).toBe('none')
  })

  it('adds up the count and size of the selected items only', () => {
    expect(selectionTotals(results, new Set(['b', 'c', 'z']))).toEqual({ count: 2, size: 150 })
    expect(selectionTotals(results, new Set())).toEqual({ count: 0, size: 0 })
  })
})

describe('entry totals', () => {
  it('counts records when every item carries one, otherwise returns null', () => {
    expect(
      entryTotal([result('run', [item('a', { entryCount: 3 }), item('b', { entryCount: 0 })])])
    ).toBe(3)
    expect(entryTotal([result('mixed', [item('a', { entryCount: 3 }), item('b')])])).toBeNull()
    expect(entryTotal([])).toBeNull()
  })
})

describe('scanned categories', () => {
  it('counts a category as read unless its scan returned only the elevation marker', () => {
    expect(categoryWasRead([])).toBe(true)
    expect(categoryWasRead([result('temp', [item('a')])])).toBe(true)
    expect(categoryWasRead([result('__elevation_required', [])])).toBe(false)
    expect(categoryWasRead([result('__elevation_required', []), result('temp', [item('a')])])).toBe(
      true
    )
  })

  it('lists as empty only the categories that were read and found nothing', () => {
    const group = (type: string, found: number, scanner = type) => ({
      type,
      scanner,
      results: found > 0 ? [result(type, [item(type)])] : []
    })
    const groups = [
      group('system', 0),
      group('browser', 0),
      group('app', 1),
      group('aiTools', 0, 'app'),
      group('gaming', 0)
    ]
    expect(
      emptyScannedGroups(groups, ['system', 'app'], (g) => g.scanner).map((g) => g.type)
    ).toEqual(['system', 'aiTools'])
    expect(emptyScannedGroups(groups, [], (g) => g.scanner)).toEqual([])
  })
})

describe('size sort', () => {
  it('cycles default, largest first, smallest first', () => {
    expect(nextSizeSort('default')).toBe('size-desc')
    expect(nextSizeSort('size-desc')).toBe('size-asc')
    expect(nextSizeSort('size-asc')).toBe('default')
  })

  it('keeps the scanner order by default and sorts a copy otherwise', () => {
    const list = [2, 3, 1]
    expect(sortBySize(list, 'default', (n) => n)).toBe(list)
    expect(sortBySize(list, 'size-desc', (n) => n)).toEqual([3, 2, 1])
    expect(sortBySize(list, 'size-asc', (n) => n)).toEqual([1, 2, 3])
    expect(list).toEqual([2, 3, 1])
  })
})

describe('latest history entry', () => {
  it('finds the newest entry of the type regardless of order', () => {
    const entries = [
      entry('1', 'cleaner', '2026-09-01T10:00:00Z'),
      entry('2', 'registry', '2026-09-20T10:00:00Z'),
      entry('3', 'cleaner', '2026-09-12T18:40:00Z'),
      entry('4', 'cleaner', 'not a date')
    ]
    expect(latestEntry(entries, 'cleaner')?.id).toBe('3')
    expect(latestEntry(entries, 'network')).toBeUndefined()
  })
})

describe('formatting', () => {
  const when = new Date(2026, 8, 12, 18, 40)

  it('writes a date and time in the UI language with Latin digits', () => {
    expect(formatDateTime(when, 'it')).toBe('12 set 2026, 18:40')
    expect(formatDateTime(when, 'ar')).toMatch(/2026/)
    expect(formatDateTime('nonsense', 'it')).toBe('')
  })

  it('writes a time of day', () => {
    expect(formatTime(when, 'it')).toBe('18:40')
    expect(formatTime(when.getTime(), 'ar')).toMatch(/18|06/)
  })

  it('joins a list with the language conjunction', () => {
    expect(formatList(['Sistema', 'Browser', 'Cestino'], 'it')).toBe('Sistema, Browser e Cestino')
    expect(formatList(['System', 'Browsers'], 'en')).toBe('System and Browsers')
    expect(formatList(['Sistema'], 'it')).toBe('Sistema')
    expect(formatList([], 'it')).toBe('')
  })

  it('writes a percentage from a 0..100 value, clamped', () => {
    expect(formatPercent(25.4, 'en')).toBe('25%')
    expect(formatPercent(140, 'en')).toBe('100%')
    expect(formatPercent(Number.NaN, 'en')).toBe('0%')
    expect(formatPercent(50, 'ar')).toMatch(/50/)
  })

  it('writes how long an operation took, at least one second', () => {
    expect(formatElapsed(9200, 'it')).toBe('9 s')
    expect(formatElapsed(120, 'en')).toBe('1 sec')
    expect(formatElapsed(125_000, 'it')).toBe('2 min 5 s')
    expect(formatElapsed(120_000, 'en')).toBe('2 min')
  })

  it('writes a measured delay with the unit that fits', () => {
    expect(formatDelay(850, 'it')).toBe('850 ms')
    expect(formatDelay(1234, 'it')).toBe('1,2 s')
    expect(formatDelay(1234, 'en')).toBe('1.2 sec')
    expect(formatDelay(150_000, 'en')).toBe('2.5 min')
    expect(formatDelay(-5, 'en')).toBe('0 ms')
  })
})
