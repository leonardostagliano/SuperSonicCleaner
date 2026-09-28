import type { TrimDriveInfo, TrimRunResult } from '@shared/types'
import { isSelectable } from '@/stores/disk-maintenance-store'

const GIB = 1024 * 1024 * 1024

export type TrimReason =
  | {
      key:
        | 'macosManaged'
        | 'hdd'
        | 'removable'
        | 'unsupported'
        | 'disabled'
        | 'recent'
        | 'overdue'
        | 'ok'
        | 'noHistory'
    }
  | { key: 'discard'; bytes: number }

/**
 * Why a drive has its status, from the same fields the main process used to compute it
 * (disk-trim.ipc.ts computeStatus). The renderer words it in the UI language, with the
 * size formatted locally, instead of showing the English `statusReason`; the date of the
 * last TRIM has its own column.
 */
export function trimReason(drive: TrimDriveInfo): TrimReason {
  switch (drive.status) {
    case 'not-applicable':
      if (drive.trimSupport === 'macos-managed') return { key: 'macosManaged' }
      return drive.mediaType === 'HDD' ? { key: 'hdd' } : { key: 'removable' }
    case 'disabled':
      return drive.trimSupport === 'unsupported' ? { key: 'unsupported' } : { key: 'disabled' }
    case 'recently-trimmed':
      return drive.lastTrimAt ? { key: 'recent' } : { key: 'noHistory' }
    case 'recommended':
      if (drive.estimatedDiscardBytes && drive.estimatedDiscardBytes > GIB)
        return { key: 'discard', bytes: drive.estimatedDiscardBytes }
      return drive.lastTrimAt ? { key: 'overdue' } : { key: 'noHistory' }
    case 'ok':
      return drive.lastTrimAt ? { key: 'ok' } : { key: 'noHistory' }
    default:
      return { key: 'noHistory' }
  }
}

export type TrimRunState = 'done' | 'skipped' | 'blocked' | 'failed'

/** A finished run: skipped (trimmed in the last 24 h) and blocked (no admin rights) are states, not errors. */
export function trimRunState(result: TrimRunResult): TrimRunState {
  if (result.success) return 'done'
  if (result.throttled) return 'skipped'
  if (result.needsAdmin) return 'blocked'
  return 'failed'
}

export interface TrimRunSummary {
  done: number
  skipped: number
  blocked: number
  failed: number
  /** When the latest result arrived, or null without results. */
  at: number | null
}

/** Counts for the receipt of the TRIM runs of this session. */
export function summariseTrimRuns(results: TrimRunResult[]): TrimRunSummary {
  const summary: TrimRunSummary = { done: 0, skipped: 0, blocked: 0, failed: 0, at: null }
  for (const result of results) {
    summary[trimRunState(result)]++
    summary.at = Math.max(summary.at ?? 0, result.timestamp)
  }
  return summary
}

/** The drives to pre-select: the ones the app recommends and TRIM can run on. */
export function recommendedDriveIds(drives: TrimDriveInfo[]): string[] {
  return drives.filter((d) => d.status === 'recommended' && isSelectable(d)).map((d) => d.id)
}
