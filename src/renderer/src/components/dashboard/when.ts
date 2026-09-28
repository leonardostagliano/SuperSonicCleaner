// Dates and percentages for the Home: locale-aware, Latin digits, tabular in the UI.

const MINUTE = 60_000
const HOUR = 3_600_000

const relative = (locale: string) => {
  try {
    // The options type has no numberingSystem: ask for Latin digits in the locale tag.
    return new Intl.RelativeTimeFormat(`${locale}-u-nu-latn`, { numeric: 'auto' })
  } catch {
    return new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  }
}

const dateTime = (locale: string, options: Intl.DateTimeFormatOptions) => {
  try {
    return new Intl.DateTimeFormat(locale, { ...options, numberingSystem: 'latn' })
  } catch {
    return new Intl.DateTimeFormat('en', options)
  }
}

const startOfDay = (ms: number) => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * When something ran, as short as it can be said: "ora", "5 minuti fa", "oggi, 09:12",
 * "ieri", "3 giorni fa", then the date ("12 set, 18:40", with the year when it differs).
 */
export function formatWhen(ms: number, now: number, locale: string): string {
  const diff = now - ms
  const rtf = relative(locale)
  if (diff < MINUTE) return rtf.format(0, 'second')
  if (diff < HOUR) return rtf.format(-Math.floor(diff / MINUTE), 'minute')
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / 86_400_000)
  if (days <= 0) {
    const time = dateTime(locale, { hour: '2-digit', minute: '2-digit' }).format(ms)
    return `${rtf.format(0, 'day')}, ${time}`
  }
  if (days < 7) return rtf.format(-days, 'day')
  return dateTime(locale, {
    day: 'numeric',
    month: 'short',
    year: new Date(ms).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(ms)
}

/** A full date and time for a record: "12 set 2026, 18:40". */
export function formatDateTime(ms: number, locale: string): string {
  return dateTime(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(ms)
}

/** A count with the language's grouping and Latin digits ("1.402", "1,402"). */
export function formatCount(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { numberingSystem: 'latn' }).format(value)
  } catch {
    return new Intl.NumberFormat('en').format(value)
  }
}

/** A whole percentage from 0..100, in the language's own style ("56%", "56 %"). */
export function formatPercent(value: number, locale: string): string {
  const options: Intl.NumberFormatOptions = {
    style: 'percent',
    maximumFractionDigits: 0,
    numberingSystem: 'latn'
  }
  let format: Intl.NumberFormat
  try {
    format = new Intl.NumberFormat(locale, options)
  } catch {
    format = new Intl.NumberFormat('en', options)
  }
  return format.format(Math.max(0, Math.min(100, value)) / 100)
}

/** "C: · Windows"; a Windows drive letter gets its colon, a mount path stays as it is. */
export function driveName(drive: { letter: string; label: string }): string {
  const letter = /^[A-Za-z]$/.test(drive.letter) ? `${drive.letter}:` : drive.letter
  return drive.label ? `${letter} · ${drive.label}` : letter
}
