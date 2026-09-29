// Number and date formatting for the Protection pages (malware, privacy, firewall, game
// mode): the UI language decides separators, digits stay Latin.

const NBSP = ' '
const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>()

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const id = `n|${locale}|${JSON.stringify(options)}`
  let format = cache.get(id) as Intl.NumberFormat | undefined
  if (!format) {
    try {
      format = new Intl.NumberFormat(locale, { ...options, numberingSystem: 'latn' })
    } catch {
      format = new Intl.NumberFormat('en', { ...options, numberingSystem: 'latn' })
    }
    cache.set(id, format)
  }
  return format
}

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const id = `d|${locale}|${JSON.stringify(options)}`
  let format = cache.get(id) as Intl.DateTimeFormat | undefined
  if (!format) {
    try {
      format = new Intl.DateTimeFormat(locale, { ...options, numberingSystem: 'latn' })
    } catch {
      format = new Intl.DateTimeFormat('en', { ...options, numberingSystem: 'latn' })
    }
    cache.set(id, format)
  }
  return format
}

/** A whole number with the language's grouping: 12.345 (it), 12,345 (en). */
export function formatCount(value: number, locale: string): string {
  return numberFormat(locale, { maximumFractionDigits: 0 }).format(value)
}

/** Milliseconds as seconds with one decimal and no unit: 42,3 (it), 42.3 (en). */
export function formatSeconds(ms: number, locale: string): string {
  return numberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    Math.max(0, ms) / 1000
  )
}

/** A share 0..1 as a whole percentage, with the language's spacing: 45 % (it), 45% (en). */
export function formatPercent(fraction: number, locale: string): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0))
  return numberFormat(locale, { style: 'percent', maximumFractionDigits: 0 })
    .format(clamped)
    .replace(/\s/g, NBSP)
}

/** Date and time of an event: 12 set 2026, 18:40. Invalid input gives ''. */
export function formatDateTime(value: string | number | Date, locale: string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return dateFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

/** Date only: 12 set 2026. Invalid input gives ''. */
export function formatDay(value: string | number | Date, locale: string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return dateFormat(locale, { dateStyle: 'medium' }).format(date)
}

/** Time of day: 18:40. Invalid input gives ''. */
export function formatTime(value: string | number | Date, locale: string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return dateFormat(locale, { timeStyle: 'short' }).format(date)
}
