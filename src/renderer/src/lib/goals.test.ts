import { describe, expect, it } from 'vitest'
import type { HistoryEntryType, PlatformInfo } from '@shared/types'
import { GOALS, goalPaths, stepStates } from './goals'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 8, 28, 12)
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString()
const entry = (type: HistoryEntryType, daysAgo: number) => ({ type, timestamp: at(daysAgo) })
const features = (firewallAudit: boolean) =>
  ({
    registry: true,
    debloater: true,
    drivers: true,
    restorePoint: true,
    bootTrace: true,
    gameMode: true,
    firewallAudit,
    contextMenu: true
  }) satisfies PlatformInfo['features']

describe('goalPaths', () => {
  it('lists each goal’s tools in the recommended order', () => {
    expect(GOALS).toEqual(['space', 'speed', 'protection'])
    expect(goalPaths('space')).toEqual([
      '/cleaner',
      '/large-files',
      '/duplicates',
      '/empty-folders',
      '/disk'
    ])
    expect(goalPaths('speed')).toEqual([
      '/startup',
      '/performance',
      '/services',
      '/performance-diagnostics'
    ])
    expect(goalPaths('protection')).toEqual(['/malware', '/privacy', '/firewall', '/updates'])
  })

  it('drops tools the platform does not have', () => {
    expect(goalPaths('protection', features(false))).toEqual(['/malware', '/privacy', '/updates'])
    expect(goalPaths('protection', features(true))).toContain('/firewall')
  })
})

describe('stepStates', () => {
  it('marks a cleanup that never ran as recommended and the first step to take', () => {
    const steps = stepStates('space', [], [], NOW)
    expect(steps.map((s) => s.path)).toEqual(goalPaths('space'))
    expect(steps[0]).toEqual({
      path: '/cleaner',
      status: 'recommended',
      reason: 'never',
      lastRun: null,
      marked: true
    })
    // Tools without a history type have no date to show.
    expect(steps.slice(1).map((s) => s.status)).toEqual([
      'unknown',
      'unknown',
      'unknown',
      'unknown'
    ])
    expect(steps.filter((s) => s.marked)).toHaveLength(1)
  })

  it('shows a recent cleanup as done with its date and marks the first step', () => {
    const steps = stepStates('space', [entry('cleaner', 3)], [], NOW)
    expect(steps[0]).toMatchObject({ status: 'done', lastRun: NOW - 3 * DAY, marked: true })
    expect(steps[0].reason).toBeNull()
  })

  it('recommends a stale cleanup again', () => {
    const [cleaner] = stepStates('space', [entry('cleaner', 20)], [], NOW)
    expect(cleaner).toMatchObject({ status: 'recommended', reason: 'stale', marked: true })
  })

  it('tells "never" apart from "unknown" and marks the first recommended step', () => {
    const steps = stepStates('speed', [entry('startup', 2)], [], NOW)
    expect(steps.map((s) => [s.path, s.status])).toEqual([
      ['/startup', 'done'],
      ['/performance', 'unknown'],
      ['/services', 'never'],
      ['/performance-diagnostics', 'unknown']
    ])
    // Nothing recommended: the first step carries the action.
    expect(steps.map((s) => s.marked)).toEqual([true, false, false, false])
  })

  it('marks the first recommended step, not the first step', () => {
    const steps = stepStates(
      'protection',
      [entry('malware', 1), entry('privacy', 40)],
      [{ id: 'updates', lastRun: NOW - 1000, pendingCount: 5 }],
      NOW,
      features(true)
    )
    expect(steps.map((s) => [s.path, s.status, s.marked])).toEqual([
      ['/malware', 'done', false],
      ['/privacy', 'done', false],
      ['/firewall', 'unknown', false],
      ['/updates', 'recommended', true]
    ])
    expect(steps[3].reason).toBe('pending')
  })

  it('uses the newer of the check input and the history, and open threats', () => {
    const [malware] = stepStates(
      'protection',
      [entry('malware', 30)],
      [{ id: 'malware', lastRun: NOW - DAY, openThreats: 0 }],
      NOW
    )
    expect(malware).toMatchObject({ status: 'done', lastRun: NOW - DAY })
    const [threats] = stepStates(
      'protection',
      [],
      [{ id: 'malware', lastRun: NOW - DAY, openThreats: 2 }],
      NOW
    )
    expect(threats).toMatchObject({ status: 'recommended', reason: 'threats', marked: true })
  })

  it('counts a completed check with no history entry as done, not never (X1)', () => {
    // A user who reviews startup apps and changes nothing leaves no history entry;
    // the recorded check run (check-runs-store) is the only source for `lastRun`.
    const [startup] = stepStates('speed', [], [{ id: 'startup', lastRun: NOW - 2 * DAY }], NOW)
    expect(startup).toMatchObject({ status: 'done', reason: null, lastRun: NOW - 2 * DAY })
  })

  it('shows updates checked in this session and none pending as done', () => {
    const steps = stepStates(
      'protection',
      [entry('malware', 1)],
      [{ id: 'updates', lastRun: NOW - 5000, pendingCount: 0 }],
      NOW,
      features(false)
    )
    expect(steps.at(-1)).toMatchObject({ path: '/updates', status: 'done', lastRun: NOW - 5000 })
    expect(steps[0].marked).toBe(true)
  })
})
