import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import { cleanupResult, driversResult, malwareResult, updatesResult } from './check-results'

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

describe('cleanupResult', () => {
  const cleaned = (timestamp: string, saved: number, items: number) => ({
    timestamp,
    totalSpaceSaved: saved,
    totalItemsCleaned: items
  })

  it('reports "never" when neither a run nor a cleanup was recorded', () => {
    expect(cleanupResult(t, { entry: null, lastRun: null, locale: 'en' })).toEqual({
      result: 'checks.results.cleanupNever',
      resultTone: 'neutral'
    })
  })

  it('reports an analysis with no cleanup as analysed, not "never"', () => {
    expect(
      cleanupResult(t, { entry: null, lastRun: Date.parse('2026-09-28T10:00:00Z'), locale: 'en' })
    ).toEqual({ result: 'checks.results.cleanupAnalyzed', resultTone: 'neutral' })
  })

  it('reports what the last cleanup freed or cleaned when no run is recorded', () => {
    expect(
      cleanupResult(t, {
        entry: cleaned('2026-09-20T10:00:00Z', 2048, 3),
        lastRun: null,
        locale: 'en'
      })
    ).toEqual({ result: 'checks.results.freed({"size":"2.00\u00a0KB"})', resultTone: 'neutral' })
    expect(
      cleanupResult(t, {
        entry: cleaned('2026-09-20T10:00:00Z', 0, 3),
        lastRun: null,
        locale: 'en'
      })
    ).toEqual({
      result: 'checks.results.itemsCleaned({"count":3,"n":"3"})',
      resultTone: 'neutral'
    })
  })

  it('reports the cleanup when the recorded run is the analysis before it', () => {
    expect(
      cleanupResult(t, {
        entry: cleaned('2026-09-20T10:05:00Z', 2048, 3),
        lastRun: Date.parse('2026-09-20T10:00:00Z'),
        locale: 'en'
      })
    ).toEqual({ result: 'checks.results.freed({"size":"2.00\u00a0KB"})', resultTone: 'neutral' })
  })

  it('reports an analysis newer than the last cleanup as analysed', () => {
    expect(
      cleanupResult(t, {
        entry: cleaned('2026-09-20T10:00:00Z', 2048, 3),
        lastRun: Date.parse('2026-09-28T10:00:00Z'),
        locale: 'en'
      })
    ).toEqual({ result: 'checks.results.cleanupAnalyzed', resultTone: 'neutral' })
  })
})

describe('updatesResult', () => {
  const answered = [{ name: 'winget' as const }, { name: 'choco' as const }]

  it('reports no package manager as neutral, never as up to date', () => {
    expect(
      updatesResult(t, {
        pending: 0,
        major: 0,
        packageManagerAvailable: false,
        managers: [],
        locale: 'en'
      })
    ).toEqual({ result: 'checks.results.updatesNoManager', resultTone: 'neutral' })
  })

  it('reports a manager that did not answer as an incomplete check', () => {
    expect(
      updatesResult(t, {
        pending: 0,
        major: 0,
        packageManagerAvailable: true,
        managers: [
          { name: 'winget', error: 'timed out' },
          { name: 'choco', error: 'failed' }
        ],
        locale: 'en'
      })
    ).toEqual({
      result: 'checks.results.updatesIncomplete({"managers":"winget and Chocolatey"})',
      resultTone: 'neutral'
    })
  })

  it('reports ok only when every manager answered and nothing is pending', () => {
    expect(
      updatesResult(t, {
        pending: 0,
        major: 0,
        packageManagerAvailable: true,
        managers: answered,
        locale: 'en'
      })
    ).toEqual({ result: 'checks.results.updatesNone', resultTone: 'ok' })
  })

  it('reports pending updates, with the major ones, as recommended', () => {
    expect(
      updatesResult(t, {
        pending: 3,
        major: 1,
        packageManagerAvailable: true,
        managers: answered,
        locale: 'en'
      })
    ).toEqual({
      result:
        'checks.results.updatesPending({"count":3}) · checks.results.updatesMajor({"count":1})',
      resultTone: 'recommended'
    })
    expect(
      updatesResult(t, {
        pending: 2,
        major: 0,
        packageManagerAvailable: true,
        managers: answered,
        locale: 'en'
      }).result
    ).toBe('checks.results.updatesPending({"count":2})')
  })
})
