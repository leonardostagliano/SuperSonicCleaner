import { describe, expect, it } from 'vitest'
import type { TrimDriveInfo, TrimRunResult } from '@shared/types'
import { recommendedDriveIds, summariseTrimRuns, trimReason, trimRunState } from './trim-view'

const drive = (over: Partial<TrimDriveInfo>): TrimDriveInfo => ({
  id: 'C',
  letter: 'C',
  label: 'Windows',
  totalSize: 512e9,
  freeSpace: 100e9,
  mediaType: 'SSD',
  isRemovable: false,
  isEncrypted: false,
  trimSupport: 'supported',
  status: 'ok',
  statusReason: '',
  lastTrimAt: null,
  ...over
})

const run = (over: Partial<TrimRunResult>): TrimRunResult => ({
  driveId: 'C',
  success: false,
  durationMs: 0,
  exitCode: null,
  summary: '',
  log: '',
  timestamp: 1000,
  ...over
})

describe('trimReason', () => {
  it('explains the drives TRIM does not apply to', () => {
    expect(trimReason(drive({ status: 'not-applicable', mediaType: 'HDD' }))).toEqual({
      key: 'hdd'
    })
    expect(trimReason(drive({ status: 'not-applicable', isRemovable: true }))).toEqual({
      key: 'removable'
    })
    expect(trimReason(drive({ status: 'not-applicable', trimSupport: 'macos-managed' }))).toEqual({
      key: 'macosManaged'
    })
    expect(trimReason(drive({ status: 'disabled', trimSupport: 'unsupported' }))).toEqual({
      key: 'unsupported'
    })
    expect(trimReason(drive({ status: 'disabled', trimSupport: 'disabled' }))).toEqual({
      key: 'disabled'
    })
  })

  it('tells recent, overdue and waiting-space cases apart', () => {
    expect(trimReason(drive({ status: 'recently-trimmed', lastTrimAt: 5 }))).toEqual({
      key: 'recent'
    })
    expect(trimReason(drive({ status: 'ok', lastTrimAt: 7 }))).toEqual({ key: 'ok' })
    expect(
      trimReason(drive({ status: 'recommended', estimatedDiscardBytes: 3 * 1024 ** 3 }))
    ).toEqual({ key: 'discard', bytes: 3 * 1024 ** 3 })
    expect(trimReason(drive({ status: 'recommended', lastTrimAt: 9 }))).toEqual({
      key: 'overdue'
    })
  })

  it('says when there is no TRIM history', () => {
    expect(trimReason(drive({ status: 'unknown' }))).toEqual({ key: 'noHistory' })
    expect(trimReason(drive({ status: 'ok', lastTrimAt: null }))).toEqual({ key: 'noHistory' })
  })
})

describe('trimRunState and summariseTrimRuns', () => {
  it('separates skipped and blocked runs from failures', () => {
    expect(trimRunState(run({ success: true }))).toBe('done')
    expect(trimRunState(run({ throttled: true }))).toBe('skipped')
    expect(trimRunState(run({ needsAdmin: true }))).toBe('blocked')
    expect(trimRunState(run({ exitCode: 1 }))).toBe('failed')
  })

  it('counts each state and keeps the latest time', () => {
    expect(
      summariseTrimRuns([
        run({ success: true, timestamp: 10 }),
        run({ driveId: 'D', throttled: true, timestamp: 30 }),
        run({ driveId: 'E', exitCode: 5, timestamp: 20 })
      ])
    ).toEqual({ done: 1, skipped: 1, blocked: 0, failed: 1, at: 30 })
    expect(summariseTrimRuns([])).toEqual({ done: 0, skipped: 0, blocked: 0, failed: 0, at: null })
  })
})

describe('recommendedDriveIds', () => {
  it('pre-selects only recommended drives that TRIM can run on', () => {
    expect(
      recommendedDriveIds([
        drive({ id: 'C', status: 'recommended' }),
        drive({ id: 'D', status: 'ok' }),
        drive({ id: 'E', status: 'recommended', isRemovable: true }),
        drive({ id: 'F', status: 'recommended', mediaType: 'NVMe' })
      ])
    ).toEqual(['C', 'F'])
  })
})
