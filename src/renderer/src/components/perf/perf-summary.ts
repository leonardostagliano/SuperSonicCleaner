import type { DiskSmartInfo, PerfSnapshot } from '@shared/types'

/** A load meter turns red above this share of capacity; below it stays neutral. */
export const LOAD_DANGER_PERCENT = 90

export function meterTone(percent: number | null): 'neutral' | 'danger' {
  return percent !== null && percent > LOAD_DANGER_PERCENT ? 'danger' : 'neutral'
}

export type LoadAlert = { id: 'cpu-high' } | { id: 'mem-high'; percent: number }

const CPU_ALERT_PERCENT = 90
const CPU_ALERT_SAMPLES = 5
const MEMORY_ALERT_PERCENT = 85

/** CPU above 90 % in each of the last five samples; memory above 85 % now. */
export function loadAlerts(snapshot: PerfSnapshot | null, history: PerfSnapshot[]): LoadAlert[] {
  if (!snapshot) return []
  const alerts: LoadAlert[] = []
  const recent = history.slice(-CPU_ALERT_SAMPLES)
  if (
    recent.length >= CPU_ALERT_SAMPLES &&
    recent.every((sample) => sample.cpu.overall > CPU_ALERT_PERCENT)
  ) {
    alerts.push({ id: 'cpu-high' })
  }
  if (snapshot.memory.percent > MEMORY_ALERT_PERCENT) {
    alerts.push({ id: 'mem-high', percent: snapshot.memory.percent })
  }
  return alerts
}

/**
 * Samples without disk rates before the page stops waiting for them. Main probes the
 * disk every 5 s and some systems (Windows) never report rates, so after 10 s of
 * samples without any the page says they are not measurable instead of waiting forever.
 */
export const DISK_PROBE_SAMPLES = 10

export function diskRateState(
  snapshot: PerfSnapshot | null,
  history: PerfSnapshot[]
): 'measured' | 'waiting' | 'unavailable' {
  if (!snapshot) return 'waiting'
  if (snapshot.disk.available !== false) return 'measured'
  const everMeasured = history.some((sample) => sample.disk.available !== false)
  return !everMeasured && history.length >= DISK_PROBE_SAMPLES ? 'unavailable' : 'waiting'
}

export type ChartBody =
  | { kind: 'waiting' }
  | { kind: 'single' }
  | { kind: 'flat'; min: number; max: number }
  | { kind: 'chart' }

/**
 * A chart is drawn only from two points and a spread of at least `minSpread`;
 * otherwise the page says the same thing in one sentence.
 */
export function chartBody(values: (number | null)[], minSpread: number): ChartBody {
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v))
  if (known.length === 0) return { kind: 'waiting' }
  if (known.length === 1) return { kind: 'single' }
  const min = Math.min(...known)
  const max = Math.max(...known)
  return max - min < minSpread ? { kind: 'flat', min, max } : { kind: 'chart' }
}

const percentFormats = new Map<string, Intl.NumberFormat>()

/** A percentage in the language's own pattern ("71%", "72 %"), Latin digits. */
export function formatPercent(value: number, locale: string, fractionDigits = 0): string {
  const cacheKey = `${locale}|${fractionDigits}`
  let format = percentFormats.get(cacheKey)
  if (!format) {
    const options: Intl.NumberFormatOptions = {
      style: 'percent',
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
      numberingSystem: 'latn'
    }
    try {
      format = new Intl.NumberFormat(locale, options)
    } catch {
      format = new Intl.NumberFormat('en', options)
    }
    percentFormats.set(cacheKey, format)
  }
  return format.format(value / 100)
}

const integerFormats = new Map<string, Intl.NumberFormat>()

function formatInteger(value: number, locale: string): string {
  let format = integerFormats.get(locale)
  if (!format) {
    const options: Intl.NumberFormatOptions = { maximumFractionDigits: 0, numberingSystem: 'latn' }
    try {
      format = new Intl.NumberFormat(locale, options)
    } catch {
      format = new Intl.NumberFormat('en', options)
    }
    integerFormats.set(locale, format)
  }
  return format.format(value)
}

const clockFormats = new Map<string, Intl.DateTimeFormat>()

/** The time of a sample (hours, minutes, seconds) in the UI language, Latin digits. */
export function formatClock(timestamp: number, locale: string): string {
  let format = clockFormats.get(locale)
  if (!format) {
    const options: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      numberingSystem: 'latn'
    }
    try {
      format = new Intl.DateTimeFormat(locale, options)
    } catch {
      format = new Intl.DateTimeFormat('en', options)
    }
    clockFormats.set(locale, format)
  }
  return format.format(timestamp)
}

const dateTimeFormats = new Map<string, Intl.DateTimeFormat>()

/** A saved moment ("12 set 2026, 18:40") in the UI language, Latin digits. */
export function formatDateTime(iso: string, locale: string): string {
  let format = dateTimeFormats.get(locale)
  if (!format) {
    const options: Intl.DateTimeFormatOptions = {
      dateStyle: 'medium',
      timeStyle: 'short',
      numberingSystem: 'latn'
    }
    try {
      format = new Intl.DateTimeFormat(locale, options)
    } catch {
      format = new Intl.DateTimeFormat('en', options)
    }
    dateTimeFormats.set(locale, format)
  }
  return format.format(new Date(iso))
}

const secondFormats = new Map<string, Intl.NumberFormat>()

/** Milliseconds as seconds with one decimal and the SI symbol ("12,3 s"), Latin digits. */
export function formatSeconds(ms: number, locale: string): string {
  let format = secondFormats.get(locale)
  if (!format) {
    const options: Intl.NumberFormatOptions = {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      numberingSystem: 'latn'
    }
    try {
      format = new Intl.NumberFormat(locale, options)
    } catch {
      format = new Intl.NumberFormat('en', options)
    }
    secondFormats.set(locale, format)
  }
  return `${format.format(ms / 1000)}\u00a0s`
}

export function uptimeParts(seconds: number): { days: number; hours: number; minutes: number } {
  const s = Math.max(0, Math.floor(seconds))
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60)
  }
}

export interface DiskFact {
  /** A `performance` key; its params are already formatted where they need a locale. */
  key:
    | 'diskFactTemperature'
    | 'diskFactPowerOn'
    | 'diskFactLife'
    | 'diskFactReadErrors'
    | 'diskFactWriteErrors'
    | 'diskFactReallocated'
  params: Record<string, string | number>
  /** Worth a second look: hot, worn out or reporting errors. */
  warn: boolean
}

const DISK_HOT_CELSIUS = 60
const DISK_WORN_PERCENT = 20

/** The S.M.A.R.T. values a disk reported, in reading order; missing values are left out. */
export function diskFacts(disk: DiskSmartInfo, locale: string): DiskFact[] {
  const facts: DiskFact[] = []
  if (disk.temperature !== null) {
    facts.push({
      key: 'diskFactTemperature',
      params: { value: Math.round(disk.temperature) },
      warn: disk.temperature > DISK_HOT_CELSIUS
    })
  }
  if (disk.powerOnHours !== null) {
    facts.push({
      key: 'diskFactPowerOn',
      params: { value: formatInteger(disk.powerOnHours, locale) },
      warn: false
    })
  }
  if (disk.remainingLife !== null) {
    facts.push({
      key: 'diskFactLife',
      params: { value: formatPercent(disk.remainingLife, locale) },
      warn: disk.remainingLife < DISK_WORN_PERCENT
    })
  }
  const counts = [
    ['diskFactReadErrors', disk.readErrors],
    ['diskFactWriteErrors', disk.writeErrors],
    ['diskFactReallocated', disk.reallocatedSectors]
  ] as const
  for (const [key, count] of counts) {
    if (count !== null) facts.push({ key, params: { count }, warn: count > 0 })
  }
  return facts
}
