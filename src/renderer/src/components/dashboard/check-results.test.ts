import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import { driversResult, malwareResult } from './check-results'

const t = ((key: string, params?: Record<string, unknown>) =>
  params && Object.keys(params).length
    ? `${key}(${JSON.stringify(params)})`
    : key) as unknown as TFunction

const entry = (found: number, cleaned: number, timestamp = '2026-09-20T10:00:00Z') => ({
  timestamp,
  totalItemsFound: found,
  totalItemsCleaned: cleaned
})

describe('malwareResult', () => {
  it('reports open threats as danger, regardless of any recorded run', () => {
    expect(
      malwareResult(t, {
        openThreats: 2,
        entry: null,
        lastScan: null,
        sessionScan: null,
        hasRecordedRun: true
      })
    ).toEqual({ result: 'checks.results.malwareThreats({"count":2})', resultTone: 'danger' })
  })

  it('reports this session’s clean scan as ok', () => {
    expect(
      malwareResult(t, {
        openThreats: 0,
        entry: null,
        lastScan: { completedAt: '2026-09-28T10:00:00Z' },
        sessionScan: Date.parse('2026-09-28T10:00:00Z'),
        hasRecordedRun: true
      })
    ).toEqual({ result: 'checks.results.malwareClear', resultTone: 'ok' })
  })

  it('reports a handled history entry over a recorded run with no session scan', () => {
    expect(
      malwareResult(t, {
        openThreats: 0,
        entry: entry(3, 3),
        lastScan: null,
        sessionScan: null,
        hasRecordedRun: true
      })
    ).toEqual({
      result: 'checks.results.malwareHandled({"handled":3,"count":3})',
      resultTone: 'neutral'
    })
  })

  // X1 fix 1: a persisted check run with no history entry and no in-session scan (e.g.
  // right after a restart, having only ever run clean scans) must not say "never".
  it('reports a recorded run with no history and no session scan as clean, not "never"', () => {
    expect(
      malwareResult(t, {
        openThreats: 0,
        entry: null,
        lastScan: null,
        sessionScan: null,
        hasRecordedRun: true
      })
    ).toEqual({ result: 'checks.results.malwareClear', resultTone: 'ok' })
  })

  it('reports "never" only when nothing at all was ever recorded', () => {
    expect(
      malwareResult(t, {
        openThreats: 0,
        entry: null,
        lastScan: null,
        sessionScan: null,
        hasRecordedRun: false
      })
    ).toEqual({ result: 'checks.results.malwareNever', resultTone: 'neutral' })
  })
})

describe('driversResult', () => {
  it('reports a history entry with removals', () => {
    expect(driversResult(t, { entry: entry(5, 2), hasRecordedRun: true })).toEqual({
      result: 'checks.results.driversRemoved({"count":2})',
      resultTone: 'neutral'
    })
  })

  it('reports a history entry with nothing removed by its found count', () => {
    expect(driversResult(t, { entry: entry(4, 0), hasRecordedRun: true })).toEqual({
      result: 'checks.results.driversFound({"count":4})',
      resultTone: 'neutral'
    })
  })

  // X1 fix 1: a persisted check run with no history entry (evicted from the capped log,
  // or a scan that found nothing to change) must not say "no scan recorded".
  it('reports a recorded run with no history entry as nothing to review, not "never"', () => {
    expect(driversResult(t, { entry: null, hasRecordedRun: true })).toEqual({
      result: 'checks.results.driversFound({"count":0})',
      resultTone: 'neutral'
    })
  })

  it('reports "never" only when nothing at all was ever recorded', () => {
    expect(driversResult(t, { entry: null, hasRecordedRun: false })).toEqual({
      result: 'checks.results.driversNever',
      resultTone: 'neutral'
    })
  })
})
