import i18next from 'i18next'
import { formatBytes } from '@/lib/format'

/**
 * Counts, shares, durations and dates for the storage tools, in the UI language with
 * Latin digits (sizes use formatBytes). Formatters are cached per language and shape.
 */
const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>()
const uiLocale = (): string => i18next.language || 'en'

function numberFormat(locale: string, key: string, options: Intl.NumberFormatOptions) {
  const id = `n|${locale}|${key}`
  let formatter = cache.get(id) as Intl.NumberFormat | undefined
  if (!formatter) {
    const withDigits = { ...options, numberingSystem: 'latn' }
    try {
      formatter = new Intl.NumberFormat(locale, withDigits)
    } catch {
      formatter = new Intl.NumberFormat('en', withDigits)
    }
    cache.set(id, formatter)
  }
  return formatter
}

/** 1.512 (it), 1,512 (en). */
export function formatCount(value: number, locale: string = uiLocale()): string {
  return numberFormat(locale, 'count', {}).format(value)
}

const NBSP = ' '
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/**
 * A size the user picks as a threshold ("1 MB", "100 KB"): whole units when the value is
 * an exact multiple, otherwise the usual three significant digits of formatBytes.
 */
export function formatThreshold(bytes: number, locale: string = uiLocale()): string {
  let value = bytes
  let unit = 0
  while (value >= 1024 && value % 1024 === 0 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  if (unit === 0 && bytes >= 1024) return formatBytes(bytes, locale)
  return `${formatCount(value, locale)}${NBSP}${UNITS[unit]}`
}

/** A share of a total: 46 %, 4,0 %, and "< 0,1 %" so a real share never reads as zero. */
export function formatShare(fraction: number, locale: string = uiLocale()): string {
  if (fraction > 0 && fraction < 0.001) {
    return `< ${numberFormat(locale, 'share1', { style: 'percent', maximumFractionDigits: 1 }).format(0.001)}`
  }
  const digits = fraction < 0.1 ? 1 : 0
  return numberFormat(locale, `share${digits}`, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(fraction)
}

/** How long a scan took: 4,2 s under a minute, then 2 min 5 s; U+00A0 before each unit. */
export function formatElapsed(ms: number, locale: string = uiLocale()): string {
  // Intl separates number and unit with a plain space; the UI keeps them together.
  const keep = (text: string) => text.replace(/ /g, NBSP)
  const seconds = Math.max(ms, 0) / 1000
  if (seconds < 60) {
    return keep(
      numberFormat(locale, 'seconds1', {
        style: 'unit',
        unit: 'second',
        unitDisplay: 'short',
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      }).format(Math.max(seconds, 0.1))
    )
  }
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  const min = numberFormat(locale, 'minutes', {
    style: 'unit',
    unit: 'minute',
    unitDisplay: 'short'
  })
  const sec = numberFormat(locale, 'seconds0', {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'short',
    maximumFractionDigits: 0
  })
  return `${keep(min.format(minutes))} ${keep(sec.format(rest))}`
}

function dateFormat(locale: string, key: string, options: Intl.DateTimeFormatOptions) {
  const id = `d|${locale}|${key}`
  let formatter = cache.get(id) as Intl.DateTimeFormat | undefined
  if (!formatter) {
    const withDigits = { ...options, numberingSystem: 'latn' }
    try {
      formatter = new Intl.DateTimeFormat(locale, withDigits)
    } catch {
      formatter = new Intl.DateTimeFormat('en', withDigits)
    }
    cache.set(id, formatter)
  }
  return formatter
}

/** 12 set 2026, 18:40 */
export function formatDateTime(timestamp: number, locale: string = uiLocale()): string {
  return dateFormat(locale, 'datetime', { dateStyle: 'medium', timeStyle: 'short' }).format(
    timestamp
  )
}

/** 12 set 2026 */
export function formatDay(timestamp: number, locale: string = uiLocale()): string {
  return dateFormat(locale, 'day', { dateStyle: 'medium' }).format(timestamp)
}

/** "a, b, c" or "a, b, c" plus the translated remainder ("e altri 2"). */
export function listPreview(items: string[], more: (count: number) => string, max = 3): string {
  const shown = items.slice(0, max).join(', ')
  return items.length > max ? `${shown} ${more(items.length - max)}` : shown
}
