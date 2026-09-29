// Pure result-text logic for Home's Controlli rows that needs recorded-check-run
// awareness (X1 fix 1). Kept out of home-checks.ts, which transitively imports
// stores/history-store.ts — that module touches `window.kudu` at import time, which
// makes it unimportable from a node-environment unit test; this module imports no
// stores, so it can be tested directly.
import type { TFunction } from 'i18next'
import type { PackageManagerName, PackageManagerStatus, ScanHistoryEntry } from '@shared/types'
import { formatBytes } from '@/lib/format'
import { formatCount } from './when'

export type ResultTone = 'neutral' | 'recommended' | 'ok' | 'danger'

type HistoryLike = Pick<ScanHistoryEntry, 'timestamp' | 'totalItemsCleaned' | 'totalItemsFound'>

/**
 * The malware row's result text. A recorded check run (persisted, unlike the in-session
 * `lastScan`) proves a scan completed even across a restart, so it must be reported the
 * same way a same-session clean scan is ("no threats found"), never as "not run yet" —
 * otherwise the text would contradict the `when` date next to it.
 */
export function malwareResult(
  t: TFunction,
  params: {
    openThreats: number
    entry: HistoryLike | null
    lastScan: { completedAt: string } | null
    sessionScan: number | null
    hasRecordedRun: boolean
  }
): { result: string; resultTone: ResultTone } {
  const { openThreats, entry, lastScan, sessionScan, hasRecordedRun } = params
  if (openThreats > 0)
    return {
      result: t('checks.results.malwareThreats', { count: openThreats }),
      resultTone: 'danger'
    }
  const recorded = entry ? new Date(entry.timestamp).getTime() : null
  if (lastScan && (recorded === null || sessionScan! >= recorded))
    return { result: t('checks.results.malwareClear'), resultTone: 'ok' }
  if (entry)
    return {
      result: t('checks.results.malwareHandled', {
        handled: entry.totalItemsCleaned,
        count: entry.totalItemsFound
      }),
      resultTone: 'neutral'
    }
  if (hasRecordedRun) return { result: t('checks.results.malwareClear'), resultTone: 'ok' }
  return { result: t('checks.results.malwareNever'), resultTone: 'neutral' }
}

/**
 * The drivers row's result text. Same reasoning as `malwareResult`: a recorded check run
 * with no history entry (the common case right after a restart, since a driver scan only
 * writes history when at least one sub-scan succeeds and its history entry can still be
 * evicted from the capped log) must read as "nothing to review" instead of "no scan
 * recorded", reusing the same wording a same-session scan with nothing found already uses.
 */
export function driversResult(
  t: TFunction,
  params: { entry: HistoryLike | null; hasRecordedRun: boolean }
): { result: string; resultTone: ResultTone } {
  const { entry, hasRecordedRun } = params
  if (entry)
    return {
      result:
        entry.totalItemsCleaned > 0
          ? t('checks.results.driversRemoved', { count: entry.totalItemsCleaned })
          : t('checks.results.driversFound', { count: entry.totalItemsFound }),
      resultTone: 'neutral'
    }
  if (hasRecordedRun)
    return { result: t('checks.results.driversFound', { count: 0 }), resultTone: 'neutral' }
  return { result: t('checks.results.driversNever'), resultTone: 'neutral' }
}

/** Package managers whose display name differs from their command name. */
const MANAGER_LABEL: Partial<Record<PackageManagerName, string>> = {
  choco: 'Chocolatey',
  scoop: 'Scoop'
}

function listFormat(items: string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items)
  } catch {
    return items.join(', ')
  }
}

/**
 * The updates row's result text, once a check has finished. Green only for a verified
 * result: every package manager answered and nothing is pending. With no manager, or a
 * manager that failed or timed out, "no updates" would be a guess, so the row says so.
 */
export function updatesResult(
  t: TFunction,
  params: {
    pending: number
    major: number
    packageManagerAvailable: boolean
    managers: Pick<PackageManagerStatus, 'name' | 'error'>[]
    locale: string
  }
): { result: string; resultTone: ResultTone } {
  const { pending, major, packageManagerAvailable, managers, locale } = params
  if (!packageManagerAvailable)
    return { result: t('checks.results.updatesNoManager'), resultTone: 'neutral' }
  if (pending > 0) {
    const parts = [t('checks.results.updatesPending', { count: pending })]
    if (major > 0) parts.push(t('checks.results.updatesMajor', { count: major }))
    return { result: parts.join(' · '), resultTone: 'recommended' }
  }
  const failed = managers.filter((manager) => manager.error)
  if (failed.length > 0)
    return {
      result: t('checks.results.updatesIncomplete', {
        managers: listFormat(
          failed.map((manager) => MANAGER_LABEL[manager.name] ?? manager.name),
          locale
        )
      }),
      resultTone: 'neutral'
    }
  return { result: t('checks.results.updatesNone'), resultTone: 'ok' }
}

/**
 * The cleanup row's result text. Every completed analysis records a check run, and so
 * does Home's "Analyze and clean", which only analyses: when that run is newer than the
 * last cleanup in history (or there is none), the row says the system was analysed and
 * nothing was cleaned, so the text agrees with the `when` date next to it.
 */
export function cleanupResult(
  t: TFunction,
  params: {
    entry: Pick<ScanHistoryEntry, 'timestamp' | 'totalSpaceSaved' | 'totalItemsCleaned'> | null
    lastRun: number | null
    locale: string
  }
): { result: string; resultTone: ResultTone } {
  const { entry, lastRun, locale } = params
  const cleaned = entry ? new Date(entry.timestamp).getTime() : null
  if (entry && (lastRun === null || cleaned! >= lastRun))
    return {
      result:
        entry.totalSpaceSaved > 0
          ? t('checks.results.freed', { size: formatBytes(entry.totalSpaceSaved, locale) })
          : t('checks.results.itemsCleaned', {
              count: entry.totalItemsCleaned,
              n: formatCount(entry.totalItemsCleaned, locale)
            }),
      resultTone: 'neutral'
    }
  if (lastRun !== null)
    return { result: t('checks.results.cleanupAnalyzed'), resultTone: 'neutral' }
  return { result: t('checks.results.cleanupNever'), resultTone: 'neutral' }
}
