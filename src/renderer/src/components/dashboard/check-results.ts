// Pure result-text logic for Home's Controlli rows that needs recorded-check-run
// awareness (X1 fix 1). Kept out of home-checks.ts, which transitively imports
// stores/history-store.ts — that module touches `window.kudu` at import time, which
// makes it unimportable from a node-environment unit test; this module imports no
// stores, so it can be tested directly.
import type { TFunction } from 'i18next'
import type { ScanHistoryEntry } from '@shared/types'

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
