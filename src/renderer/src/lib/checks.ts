import type { HistoryEntryType, ScanHistoryEntry } from '@shared/types'

// Which Home checks the app recommends running, from their last run and pending work.
export type CheckId =
  'updates' | 'startup' | 'malware' | 'cleanup' | 'registry' | 'drivers' | 'privacy'
export interface CheckInput {
  id: CheckId
  lastRun: number | null // epoch ms of the last completed run, null = never
  pendingCount?: number // updates available
  openThreats?: number // unresolved malware detections
}
export type CheckReason = 'pending' | 'threats' | 'never' | 'stale'
export interface CheckState {
  id: CheckId
  recommended: boolean
  reason: CheckReason | null
}

const DAY = 86_400_000
/** Days after which a check is recommended again. Checks not listed are never recommended by age. */
export const STALE_AFTER_DAYS: Partial<Record<CheckId, number>> = {
  startup: 30,
  malware: 7,
  cleanup: 14
}

export function checkState(input: CheckInput, now: number): CheckState {
  const { id } = input
  if (id === 'updates') {
    const pending = input.pendingCount ?? 0
    return { id, recommended: pending > 0, reason: pending > 0 ? 'pending' : null }
  }
  if (id === 'malware' && (input.openThreats ?? 0) > 0)
    return { id, recommended: true, reason: 'threats' }
  const staleDays = STALE_AFTER_DAYS[id]
  if (staleDays === undefined) return { id, recommended: false, reason: null }
  if (input.lastRun === null) return { id, recommended: true, reason: 'never' }
  const stale = now - input.lastRun > staleDays * DAY
  return { id, recommended: stale, reason: stale ? 'stale' : null }
}

export function recommendedCount(states: readonly CheckState[]): number {
  return states.filter((s) => s.recommended).length
}

export type HistoryStamp = Pick<ScanHistoryEntry, 'type' | 'timestamp'>

/** Epoch ms of the newest history entry of a type, or null when there is none. */
export function latestRun(history: readonly HistoryStamp[], type: HistoryEntryType): number | null {
  let latest: number | null = null
  for (const entry of history) {
    if (entry.type !== type) continue
    const time = new Date(entry.timestamp).getTime()
    if (Number.isFinite(time) && (latest === null || time > latest)) latest = time
  }
  return latest
}
