import type { ScanHistoryEntry, ScanItem, ScanResult } from '@shared/types'

/**
 * Pure helpers behind the Pulizia pages' report layout: what is recommended, what is
 * selected, and how dates and lists read in the UI language.
 */

/** An item the scanner pre-selects and that has no side effect beyond deleting it. */
export function isSafeDefault(item: ScanItem): boolean {
  return item.selected !== false && !item.cacheReset && !item.cleanupAction
}

/** A result the app recommends: every item is a safe default. */
export function isRecommendedResult(result: ScanResult): boolean {
  return result.items.length > 0 && result.items.every(isSafeDefault)
}

/** A group of results (a cleaner category) the app recommends: it pre-selects part of it. */
export function isRecommendedGroup(results: ScanResult[]): boolean {
  return results.some(isRecommendedResult)
}

export type SelectionState = 'none' | 'some' | 'all'

export function selectionState(
  results: ScanResult[],
  selected: ReadonlySet<string>
): SelectionState {
  let total = 0
  let chosen = 0
  for (const result of results) {
    for (const item of result.items) {
      total++
      if (selected.has(item.id)) chosen++
    }
  }
  if (chosen === 0 || total === 0) return 'none'
  return chosen === total ? 'all' : 'some'
}

export interface SelectionTotals {
  count: number
  size: number
}

export function selectionTotals(
  results: ScanResult[],
  selected: ReadonlySet<string>
): SelectionTotals {
  let count = 0
  let size = 0
  for (const result of results) {
    for (const item of result.items) {
      if (!selected.has(item.id)) continue
      count++
      size += item.size
    }
  }
  return { count, size }
}

/** A record count ("12 voci") reads better than bytes when every item carries one. */
export function entryTotal(results: ScanResult[]): number | null {
  const items = results.flatMap((result) => result.items)
  if (items.length === 0 || items.some((item) => item.entryCount === undefined)) return null
  return items.reduce((sum, item) => sum + (item.entryCount ?? 0), 0)
}

/** The result a scanner returns in place of a category it skipped for lack of rights. */
export const ELEVATION_MARKER = '__elevation_required'

/** Whether a scanner that resolved read its category: not when it only reports the skip. */
export function categoryWasRead(results: readonly ScanResult[]): boolean {
  return results.length === 0 || results.some((result) => result.subcategory !== ELEVATION_MARKER)
}

/**
 * The groups to list as "nothing found": empty and read by this scan. A category that was
 * not read (cancelled before it, outside a scheduled scan, failed or skipped for rights)
 * found nothing only because nothing looked.
 */
export function emptyScannedGroups<T extends { results: readonly unknown[] }>(
  groups: readonly T[],
  scanned: readonly string[],
  scannerOf: (group: T) => string
): T[] {
  return groups.filter((group) => group.results.length === 0 && scanned.includes(scannerOf(group)))
}

export type SizeSort = 'default' | 'size-desc' | 'size-asc'

/** The next sort when the size column header is pressed: default, largest, smallest. */
export function nextSizeSort(current: SizeSort): SizeSort {
  return current === 'default' ? 'size-desc' : current === 'size-desc' ? 'size-asc' : 'default'
}

export function sortBySize<T>(list: T[], mode: SizeSort, size: (value: T) => number): T[] {
  if (mode === 'default') return list
  const direction = mode === 'size-desc' ? -1 : 1
  return [...list].sort((a, b) => direction * (size(a) - size(b)))
}

/** The newest history entry of one type, whatever order the store holds them in. */
export function latestEntry(
  entries: ScanHistoryEntry[],
  type: ScanHistoryEntry['type']
): ScanHistoryEntry | undefined {
  let latest: ScanHistoryEntry | undefined
  let latestTime = -Infinity
  for (const entry of entries) {
    if (entry.type !== type) continue
    const time = Date.parse(entry.timestamp)
    if (Number.isNaN(time) || time <= latestTime) continue
    latest = entry
    latestTime = time
  }
  return latest
}

const dateTimeFormats = new Map<string, Intl.DateTimeFormat>()
const timeFormats = new Map<string, Intl.DateTimeFormat>()

function cachedFormat(
  cache: Map<string, Intl.DateTimeFormat>,
  locale: string,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  let format = cache.get(locale)
  if (!format) {
    try {
      format = new Intl.DateTimeFormat(locale, { ...options, numberingSystem: 'latn' })
    } catch {
      format = new Intl.DateTimeFormat('en', options)
    }
    cache.set(locale, format)
  }
  return format
}

/** "12 set 2026, 18:40" in the UI language, Latin digits. */
export function formatDateTime(value: string | number | Date, locale: string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return cachedFormat(dateTimeFormats, locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

/** "18:40" in the UI language, Latin digits. */
export function formatTime(value: string | number | Date, locale: string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return cachedFormat(timeFormats, locale, { hour: '2-digit', minute: '2-digit' }).format(date)
}

/** "Sistema, Browser e Cestino" in the UI language. */
export function formatList(values: string[], locale: string): string {
  if (values.length < 2) return values.join('')
  try {
    return new Intl.ListFormat(locale, { type: 'conjunction' }).format(values)
  } catch {
    return values.join(', ')
  }
}

const percentFormats = new Map<string, Intl.NumberFormat>()

/** "25 %" / "25%" as the UI language writes it, from a 0..100 value, Latin digits. */
export function formatPercent(value: number, locale: string): string {
  let format = percentFormats.get(locale)
  if (!format) {
    const options: Intl.NumberFormatOptions = {
      style: 'percent',
      maximumFractionDigits: 0,
      numberingSystem: 'latn'
    }
    try {
      format = new Intl.NumberFormat(locale, options)
    } catch {
      format = new Intl.NumberFormat('en', options)
    }
    percentFormats.set(locale, format)
  }
  const clamped = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0
  return format.format(clamped / 100)
}

function unitFormat(
  locale: string,
  unit: 'millisecond' | 'second' | 'minute',
  fractionDigits = 0
): Intl.NumberFormat {
  const options: Intl.NumberFormatOptions = {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: fractionDigits,
    numberingSystem: 'latn'
  }
  try {
    return new Intl.NumberFormat(locale, options)
  } catch {
    return new Intl.NumberFormat('en', options)
  }
}

/** How long an operation took: "9 sec", "2 min, 5 sec" as the UI language writes units. */
export function formatElapsed(ms: number, locale: string): string {
  const seconds = Math.max(1, Math.round((Number.isFinite(ms) ? ms : 0) / 1000))
  if (seconds < 60) return unitFormat(locale, 'second').format(seconds)
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  const parts = [unitFormat(locale, 'minute').format(minutes)]
  if (rest > 0) parts.push(unitFormat(locale, 'second').format(rest))
  return parts.join(' ')
}

/** A measured delay: "850 ms", "1,2 s", "2,5 min" in the UI language. */
export function formatDelay(ms: number, locale: string): string {
  const value = Number.isFinite(ms) ? Math.max(0, ms) : 0
  if (value < 1000) return unitFormat(locale, 'millisecond').format(Math.round(value))
  if (value < 60_000) return unitFormat(locale, 'second', 1).format(value / 1000)
  return unitFormat(locale, 'minute', 1).format(value / 60_000)
}
