import type { StorageSnapshotSummary } from '@shared/storage-history'
import { storageTrend } from './storage-trend'

const MIB = 1024 * 1024

export type TrendView =
  | { kind: 'chart' }
  | { kind: 'none' }
  | { kind: 'one'; bytes: number }
  | { kind: 'flat'; count: number; bytes: number }

/**
 * Whether the trend deserves a chart: at least two comparable complete snapshots whose
 * sizes differ by more than 1 MiB and 1 % of the largest. Otherwise one sentence says why.
 */
export function trendView(snapshots: StorageSnapshotSummary[]): TrendView {
  const points = storageTrend(snapshots)
  if (points.length === 0) return { kind: 'none' }
  const last = points[points.length - 1].bytes
  if (points.length === 1) return { kind: 'one', bytes: last }
  const values = points.map((p) => p.bytes)
  const max = Math.max(...values)
  const spread = max - Math.min(...values)
  if (spread <= Math.max(MIB, max * 0.01))
    return { kind: 'flat', count: points.length, bytes: last }
  return { kind: 'chart' }
}

/** The most recent snapshot on the page, whatever its status. */
export function latestSnapshot(
  snapshots: StorageSnapshotSummary[]
): StorageSnapshotSummary | undefined {
  let latest: StorageSnapshotSummary | undefined
  for (const s of snapshots)
    if (!latest || Date.parse(s.createdAt) > Date.parse(latest.createdAt)) latest = s
  return latest
}

/** An IPC rejection without Electron's "Error invoking remote method '…': Error:" prefix. */
export function ipcErrorDetail(message: string): string {
  return message.replace(/^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/, '')
}
