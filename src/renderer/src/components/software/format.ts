/** Date and list formatting shared by the Software pages. Latin digits in every language. */

const dateTimeOptions: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  numberingSystem: 'latn'
}
const clockOptions: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  numberingSystem: 'latn'
}

function format(
  value: number | string | Date,
  locale: string,
  options: Intl.DateTimeFormatOptions
) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(locale, options).format(date)
  } catch {
    return new Intl.DateTimeFormat('en', options).format(date)
  }
}

/** "12 set 2026, 18:40" */
export function formatDateTime(value: number | string | Date, locale: string): string {
  return format(value, locale, dateTimeOptions)
}

/** "18:40" */
export function formatClock(value: number | string | Date, locale: string): string {
  return format(value, locale, clockOptions)
}

/** Facts of a summary or receipt line, empty ones dropped: "6 principali · 21 secondarie". */
export function joinFacts(parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' · ')
}
