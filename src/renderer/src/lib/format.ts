import i18next from 'i18next'

/** Shown wherever a value is not known yet or not available. */
export const NO_VALUE = '—'

const NBSP = ' '
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
const RATE_UNITS = BYTE_UNITS.map((unit) => `${unit}/s`)
const formatters = new Map<string, Intl.NumberFormat>()

function threeDigits(locale: string): Intl.NumberFormat {
  let formatter = formatters.get(locale)
  if (!formatter) {
    const options: Intl.NumberFormatOptions = {
      minimumSignificantDigits: 3,
      maximumSignificantDigits: 3,
      numberingSystem: 'latn'
    }
    try {
      formatter = new Intl.NumberFormat(locale, options)
    } catch {
      formatter = new Intl.NumberFormat('en', options)
    }
    formatters.set(locale, formatter)
  }
  return formatter
}

const uiLocale = (): string => i18next.language || 'en'

/**
 * Three significant digits in base 1024. The unit steps up as soon as the
 * rounded value would reach 1000, so a value never needs four integer digits
 * ("0,977 TB", never "1023.99 GB"); below 1000 of the first unit the value is
 * a whole number. The non-breaking space keeps number and unit together.
 */
function scaled(value: number, units: string[], locale: string): string {
  if (!Number.isFinite(value) || value <= 0) return `0${NBSP}${units[0]}`
  if (value < 1000) return `${Math.round(value)}${NBSP}${units[0]}`
  let v = value
  let i = 0
  while (i < units.length - 1 && v >= 1024) {
    v /= 1024
    i++
  }
  if (i < units.length - 1 && Number(v.toPrecision(3)) >= 1000) {
    v /= 1024
    i++
  }
  return `${threeDigits(locale).format(v)}${NBSP}${units[i]}`
}

/** A size in the UI language: 113 GB, 22,1 GB, 1,50 KB, 0,977 TB. */
export function formatBytes(bytes: number, locale: string = uiLocale()): string {
  if (bytes < 0) return `-${formatBytes(-bytes, locale)}`
  return scaled(bytes, BYTE_UNITS, locale)
}

/** A transfer rate with the same rules as formatBytes; negatives read as 0 B/s. */
export function formatSpeed(bytesPerSec: number, locale: string = uiLocale()): string {
  return scaled(bytesPerSec, RATE_UNITS, locale)
}
