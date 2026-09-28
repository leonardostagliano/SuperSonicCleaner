import type { HistoryEntryType, ScanHistoryEntry } from '@shared/types'
import { normalizeHistoryCategory } from './history-categories'

/** The totals of the Activity page's summary line. */
export interface HistorySummary {
  count: number
  spaceSaved: number
  itemsProcessed: number
  errors: number
  averageDurationMs: number
  /** ISO timestamps of the oldest and newest entry, null without entries. */
  firstAt: string | null
  lastAt: string | null
}

export function summarizeHistory(entries: ScanHistoryEntry[]): HistorySummary {
  let spaceSaved = 0
  let itemsProcessed = 0
  let errors = 0
  let duration = 0
  let first: number | null = null
  let last: number | null = null
  for (const e of entries) {
    spaceSaved += e.totalSpaceSaved
    itemsProcessed += e.totalItemsCleaned
    errors += e.errorCount
    duration += e.duration
    const at = Date.parse(e.timestamp)
    if (Number.isFinite(at)) {
      if (first === null || at < first) first = at
      if (last === null || at > last) last = at
    }
  }
  return {
    count: entries.length,
    spaceSaved,
    itemsProcessed,
    errors,
    averageDurationMs: entries.length ? duration / entries.length : 0,
    firstAt: first === null ? null : new Date(first).toISOString(),
    lastAt: last === null ? null : new Date(last).toISOString()
  }
}

const pad = (n: number) => String(n).padStart(2, '0')
/** Local calendar day as YYYY-MM-DD, so entries group by the day the user saw. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
/** The Monday that starts the local week of `date`, as a day key. */
export function weekKey(date: Date): string {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return dayKey(monday)
}
/** A day key back to a local Date at midnight. */
export function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function grouped<T>(
  entries: ScanHistoryEntry[],
  keyOf: (date: Date) => string,
  limit: number,
  empty: () => T,
  add: (acc: T, e: ScanHistoryEntry) => void
): { key: string; value: T }[] {
  const byKey = new Map<string, T>()
  for (const e of entries) {
    const at = new Date(e.timestamp)
    if (!Number.isFinite(at.getTime())) continue
    const key = keyOf(at)
    let acc = byKey.get(key)
    if (!acc) {
      acc = empty()
      byKey.set(key, acc)
    }
    add(acc, e)
  }
  // Oldest first, keeping the newest `limit` groups.
  return [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-limit)
    .map(([key, value]) => ({ key, value }))
}

/** Space freed per day, oldest first, for the newest 30 days that have entries. */
export function spaceByDay(entries: ScanHistoryEntry[]): { day: string; space: number }[] {
  return grouped(
    entries,
    dayKey,
    30,
    () => ({ space: 0 }),
    (acc, e) => {
      acc.space += e.totalSpaceSaved
    }
  ).map(({ key, value }) => ({ day: key, space: value.space }))
}

/** Entries per week (weeks start on Monday), oldest first, for the newest 12 weeks with entries. */
export function entriesByWeek(entries: ScanHistoryEntry[]): { week: string; count: number }[] {
  return grouped(
    entries,
    weekKey,
    12,
    () => ({ count: 0 }),
    (acc) => {
      acc.count++
    }
  ).map(({ key, value }) => ({ week: key, count: value.count }))
}

export interface TypeBreakdown {
  type: HistoryEntryType
  count: number
  items: number
  space: number
}

/** One row per entry type: most frequent first, then by space freed. */
export function breakdownByType(entries: ScanHistoryEntry[]): TypeBreakdown[] {
  const byType = new Map<HistoryEntryType, TypeBreakdown>()
  for (const e of entries) {
    let row = byType.get(e.type)
    if (!row) {
      row = { type: e.type, count: 0, items: 0, space: 0 }
      byType.set(e.type, row)
    }
    row.count++
    row.items += e.totalItemsCleaned
    row.space += e.totalSpaceSaved
  }
  return [...byType.values()].sort((a, b) => b.count - a.count || b.space - a.space)
}

/** The categories that freed the most space across all entries (legacy names merged). */
export function breakdownByCategory(
  entries: ScanHistoryEntry[],
  limit = 8
): { key: string; items: number; space: number }[] {
  const byKey = new Map<string, { key: string; items: number; space: number }>()
  for (const e of entries) {
    for (const c of e.categories) {
      const key = normalizeHistoryCategory(c.name)
      let row = byKey.get(key)
      if (!row) {
        row = { key, items: 0, space: 0 }
        byKey.set(key, row)
      }
      row.items += c.itemsCleaned
      row.space += c.spaceSaved
    }
  }
  return [...byKey.values()]
    .filter((row) => row.items > 0 || row.space > 0)
    .sort((a, b) => b.space - a.space || b.items - a.items)
    .slice(0, limit)
}

/** The entry types present, in first-seen order: the list filter offers only these. */
export function typesPresent(entries: ScanHistoryEntry[]): HistoryEntryType[] {
  return [...new Set(entries.map((e) => e.type))]
}

const dateFormats = new Map<string, Intl.DateTimeFormat>()
const countFormats = new Map<string, Intl.NumberFormat>()

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions, id: string) {
  const key = `${locale}|${id}`
  let format = dateFormats.get(key)
  if (!format) {
    const withDigits = { ...options, numberingSystem: 'latn' }
    try {
      format = new Intl.DateTimeFormat(locale, withDigits)
    } catch {
      format = new Intl.DateTimeFormat('en', withDigits)
    }
    dateFormats.set(key, format)
  }
  return format
}

/** "12 set 2026, 18:40" in the UI language, Latin digits (sub-project 1). */
export function formatDateTime(value: string | Date, locale: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return dateFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }, 'datetime').format(date)
}

/** "12 set 2026". */
export function formatDay(value: string | Date, locale: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return dateFormat(locale, { dateStyle: 'medium' }, 'day').format(date)
}

/** "12 set", for chart axes. */
export function formatShortDay(value: string | Date, locale: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return dateFormat(locale, { day: 'numeric', month: 'short' }, 'short').format(date)
}

/** "12.402" in the UI language (CLDR grouping), Latin digits. */
export function formatCount(value: number, locale: string): string {
  let format = countFormats.get(locale)
  if (!format) {
    try {
      format = new Intl.NumberFormat(locale, { numberingSystem: 'latn' })
    } catch {
      format = new Intl.NumberFormat('en')
    }
    countFormats.set(locale, format)
  }
  return format.format(value)
}

/**
 * A chart earns its place only with at least two points and a spread worth seeing
 * (spec 4, "Chart"): the largest value is positive and the smallest differs from it
 * by at least a tenth. Otherwise one sentence says the same thing.
 */
export function isChartable(values: number[]): boolean {
  if (values.length < 2) return false
  const max = Math.max(...values)
  const min = Math.min(...values)
  return max > 0 && (max - min) / max >= 0.1
}
