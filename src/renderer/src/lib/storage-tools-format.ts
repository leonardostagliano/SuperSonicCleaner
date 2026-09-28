/**
 * Counts and dates for the storage tool pages (shredder, repair, maintenance, storage
 * history) in the UI language, always with Latin digits like formatBytes.
 */
const DATE_TIME: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium',
  timeStyle: 'short',
  numberingSystem: 'latn'
}

/** 1402 → "1.402" (it), "1,402" (en). */
export function formatCount(value: number, locale: string): string {
  const options: Intl.NumberFormatOptions = { numberingSystem: 'latn' }
  try {
    return new Intl.NumberFormat(locale, options).format(value)
  } catch {
    return new Intl.NumberFormat('en', options).format(value)
  }
}

/** 0.349 → "35%" with the language's own percent pattern. */
export function formatPercent(fraction: number, locale: string): string {
  const options: Intl.NumberFormatOptions = {
    style: 'percent',
    maximumFractionDigits: 0,
    numberingSystem: 'latn'
  }
  try {
    return new Intl.NumberFormat(locale, options).format(fraction)
  } catch {
    return new Intl.NumberFormat('en', options).format(fraction)
  }
}

/** A point in time as "28 set 2026, 18:40" (it) or "Sep 28, 2026, 6:40 PM" (en). */
export function formatDateTime(value: number | string | Date, locale: string): string {
  const date = value instanceof Date ? value : new Date(value)
  try {
    return new Intl.DateTimeFormat(locale, DATE_TIME).format(date)
  } catch {
    return new Intl.DateTimeFormat('en', DATE_TIME).format(date)
  }
}
