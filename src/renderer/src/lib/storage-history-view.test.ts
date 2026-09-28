import { describe, expect, it } from 'vitest'
import type { StorageSnapshotSummary } from '@shared/storage-history'
import { ipcErrorDetail, latestSnapshot, trendView } from './storage-history-view'

const GIB = 1024 ** 3
let n = 0
const snap = (over: Partial<StorageSnapshotSummary>): StorageSnapshotSummary => ({
  version: 1,
  id: `s${++n}`,
  scopeId: 'scope',
  scopeKey: 'key',
  createdAt: '2026-09-01T10:00:00.000Z',
  durationMs: 1000,
  status: 'complete',
  reason: null,
  volumeId: 'vol',
  totalBytes: GIB,
  files: 10,
  skipped: 0,
  errors: 0,
  volumeSize: 500 * GIB,
  volumeFree: 100 * GIB,
  metadataBytes: 100,
  checksum: 'x',
  ...over
})

describe('trendView', () => {
  it('asks for more snapshots before drawing anything', () => {
    expect(trendView([])).toEqual({ kind: 'none' })
    expect(trendView([snap({ status: 'partial' })])).toEqual({ kind: 'none' })
    expect(trendView([snap({ totalBytes: 5 * GIB })])).toEqual({ kind: 'one', bytes: 5 * GIB })
  })

  it('draws no chart when the size barely moved', () => {
    expect(
      trendView([
        snap({ createdAt: '2026-09-01T10:00:00.000Z', totalBytes: 10 * GIB }),
        snap({ createdAt: '2026-09-02T10:00:00.000Z', totalBytes: 10 * GIB + 50 * 1024 ** 2 })
      ])
    ).toEqual({ kind: 'flat', count: 2, bytes: 10 * GIB + 50 * 1024 ** 2 })
  })

  it('draws the chart for a real change', () => {
    expect(
      trendView([
        snap({ createdAt: '2026-09-01T10:00:00.000Z', totalBytes: 10 * GIB }),
        snap({ createdAt: '2026-09-02T10:00:00.000Z', totalBytes: 12 * GIB })
      ])
    ).toEqual({ kind: 'chart' })
  })
})

describe('latestSnapshot', () => {
  it('picks the newest snapshot of any status', () => {
    const newest = snap({ createdAt: '2026-09-28T10:00:00.000Z', status: 'cancelled' })
    expect(
      latestSnapshot([snap({}), newest, snap({ createdAt: '2026-09-10T10:00:00.000Z' })])
    ).toBe(newest)
    expect(latestSnapshot([])).toBeUndefined()
  })
})

describe('ipcErrorDetail', () => {
  it("drops Electron's remote-method prefix", () => {
    expect(
      ipcErrorDetail(
        "Error invoking remote method 'storage-history:delete': Error: Wait for the current capture to finish"
      )
    ).toBe('Wait for the current capture to finish')
    expect(ipcErrorDetail('Plain message')).toBe('Plain message')
  })
})
