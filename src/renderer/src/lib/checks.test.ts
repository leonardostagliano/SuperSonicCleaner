import { describe, expect, it } from 'vitest'
import {
  checkState,
  latestEntry,
  latestRun,
  newestRun,
  recommendedCount,
  STALE_AFTER_DAYS,
  type CheckInput
} from './checks'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 8, 28, 12)
const daysAgo = (days: number) => NOW - days * DAY
const state = (input: CheckInput) => checkState(input, NOW)

describe('checkState', () => {
  it('recommends updates only while some are pending', () => {
    expect(state({ id: 'updates', lastRun: null, pendingCount: 0 })).toEqual({
      id: 'updates',
      recommended: false,
      reason: null
    })
    expect(state({ id: 'updates', lastRun: null })).toMatchObject({ recommended: false })
    expect(state({ id: 'updates', lastRun: daysAgo(90), pendingCount: 37 })).toEqual({
      id: 'updates',
      recommended: true,
      reason: 'pending'
    })
  })

  it('recommends a malware scan while threats are open, even after a fresh run', () => {
    expect(state({ id: 'malware', lastRun: daysAgo(0), openThreats: 2 })).toEqual({
      id: 'malware',
      recommended: true,
      reason: 'threats'
    })
  })

  it('recommends a malware scan that never ran or is older than 7 days', () => {
    expect(state({ id: 'malware', lastRun: null })).toMatchObject({
      recommended: true,
      reason: 'never'
    })
    expect(state({ id: 'malware', lastRun: daysAgo(8) })).toMatchObject({
      recommended: true,
      reason: 'stale'
    })
    expect(state({ id: 'malware', lastRun: daysAgo(6), openThreats: 0 })).toEqual({
      id: 'malware',
      recommended: false,
      reason: null
    })
  })

  it('recommends the startup check after 30 days', () => {
    expect(state({ id: 'startup', lastRun: daysAgo(31) })).toMatchObject({
      recommended: true,
      reason: 'stale'
    })
    expect(state({ id: 'startup', lastRun: daysAgo(29) })).toMatchObject({
      recommended: false,
      reason: null
    })
    expect(state({ id: 'startup', lastRun: null })).toMatchObject({ reason: 'never' })
  })

  it('recommends a cleanup after 14 days', () => {
    expect(state({ id: 'cleanup', lastRun: daysAgo(15) })).toMatchObject({
      recommended: true,
      reason: 'stale'
    })
    expect(state({ id: 'cleanup', lastRun: daysAgo(13) })).toMatchObject({
      recommended: false,
      reason: null
    })
  })

  it('never recommends registry, drivers or privacy, even when they never ran', () => {
    for (const id of ['registry', 'drivers', 'privacy'] as const) {
      expect(STALE_AFTER_DAYS[id]).toBeUndefined()
      expect(state({ id, lastRun: null })).toEqual({ id, recommended: false, reason: null })
      expect(state({ id, lastRun: daysAgo(400) })).toEqual({ id, recommended: false, reason: null })
    }
  })
})

describe('recommendedCount', () => {
  it('counts the recommended checks', () => {
    const states = [
      state({ id: 'updates', lastRun: null, pendingCount: 3 }),
      state({ id: 'startup', lastRun: daysAgo(2) }),
      state({ id: 'malware', lastRun: null }),
      state({ id: 'registry', lastRun: null })
    ]
    expect(recommendedCount(states)).toBe(2)
    expect(recommendedCount([])).toBe(0)
  })
})

describe('latestRun', () => {
  it('returns the newest entry of a type, or null', () => {
    const history = [
      { type: 'cleaner' as const, timestamp: new Date(NOW - 9 * DAY).toISOString() },
      { type: 'registry' as const, timestamp: new Date(NOW - DAY).toISOString() },
      { type: 'cleaner' as const, timestamp: new Date(NOW - 3 * DAY).toISOString() }
    ]
    expect(latestRun(history, 'cleaner')).toBe(NOW - 3 * DAY)
    expect(latestRun(history, 'malware')).toBeNull()
    expect(latestRun([{ type: 'cleaner', timestamp: 'not a date' }], 'cleaner')).toBeNull()
  })
})

describe('newestRun', () => {
  it('returns the later of two timestamps, treating null as unknown (never)', () => {
    expect(newestRun(null, null)).toBeNull()
    expect(newestRun(daysAgo(1), null)).toBe(daysAgo(1))
    expect(newestRun(null, daysAgo(1))).toBe(daysAgo(1))
    expect(newestRun(daysAgo(5), daysAgo(1))).toBe(daysAgo(1))
    expect(newestRun(daysAgo(1), daysAgo(5))).toBe(daysAgo(1))
  })
})

describe('latestEntry', () => {
  it('returns the whole newest entry, comparing times rather than strings', () => {
    // 10:00+02:00 is 08:00 UTC: earlier, although its string sorts later.
    const earlier = { type: 'malware' as const, timestamp: '2026-09-28T10:00:00+02:00', id: 'a' }
    const later = { type: 'malware' as const, timestamp: '2026-09-28T09:30:00Z', id: 'b' }
    expect(latestEntry([later, earlier], 'malware')).toBe(later)
    expect(latestEntry([earlier], 'cleaner')).toBeNull()
  })
})
