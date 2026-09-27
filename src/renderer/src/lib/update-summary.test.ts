import { describe, it, expect, beforeAll } from 'vitest'
import i18next, { type TFunction } from 'i18next'
import enUpdates from '@/locales/en/updates.json'
import itUpdates from '@/locales/it/updates.json'
import type { UpdatableApp, UpdateResult } from '@shared/types'
import {
  buildUpdateSummary,
  formatElapsed,
  summaryMessage,
  type UpdateSummary
} from './update-summary'

let t: TFunction

beforeAll(async () => {
  const i18n = i18next.createInstance()
  await i18n.init({
    lng: 'en',
    resources: { en: { updates: enUpdates } },
    ns: ['updates'],
    defaultNS: 'updates',
    interpolation: { escapeValue: false }
  })
  t = i18n.getFixedT('en', 'updates')
})

function app(id: string, source: string, name: string, from = '1.0', to = '2.0'): UpdatableApp {
  return {
    id,
    source,
    name,
    currentVersion: from,
    availableVersion: to,
    severity: 'major',
    selected: true
  }
}

function result(partial: Partial<UpdateResult>): UpdateResult {
  const updated = partial.updated ?? []
  const errors = partial.errors ?? []
  return {
    succeeded: updated.length,
    failed: errors.length,
    updated,
    pending: partial.pending ?? [],
    errors
  }
}

const POWERTOYS = app('XP89DCGQ3K6VLD', 'msstore', 'Microsoft PowerToys', '0.88.0', '0.101.2362.0')

describe('buildUpdateSummary', () => {
  it('names each package from the row that was requested, with its versions', () => {
    const summary = buildUpdateSummary(
      result({
        updated: [{ appId: 'XP89DCGQ3K6VLD', name: 'XP89DCGQ3K6VLD', source: 'msstore' }]
      }),
      [{ ...POWERTOYS, iconDataUrl: 'data:image/png;base64,AA==' }]
    )
    expect(summary.updated).toEqual([
      {
        key: 'msstore␟XP89DCGQ3K6VLD',
        appId: 'XP89DCGQ3K6VLD',
        name: 'Microsoft PowerToys',
        iconDataUrl: 'data:image/png;base64,AA==',
        fromVersion: '0.88.0',
        toVersion: '0.101.2362.0'
      }
    ])
  })

  it('matches the exact manager when the same id exists under two', () => {
    const summary = buildUpdateSummary(
      result({
        updated: [{ appId: 'git', name: 'git', source: 'scoop' }],
        errors: [{ appId: 'git', name: 'git', source: 'choco', reason: 'Upgrade failed' }]
      }),
      [app('git', 'choco', 'Git (choco)', '2.40'), app('git', 'scoop', 'Git (scoop)', '2.41')]
    )
    expect(summary.updated.map((e) => [e.key, e.name, e.fromVersion])).toEqual([
      ['scoop␟git', 'Git (scoop)', '2.41']
    ])
    expect(summary.failed.map((e) => [e.key, e.name, e.reason])).toEqual([
      ['choco␟git', 'Git (choco)', 'Upgrade failed']
    ])
  })

  it('matches by id when the platform reports no source', () => {
    const summary = buildUpdateSummary(result({ updated: [{ appId: 'wget', name: 'wget' }] }), [
      app('wget', 'brew', 'GNU Wget')
    ])
    expect(summary.updated[0]).toMatchObject({ key: 'brew␟wget', name: 'GNU Wget' })
  })

  it('falls back to the name the run reported for a package it cannot pair', () => {
    const summary = buildUpdateSummary(
      result({ pending: [{ appId: 'Other.App', name: 'Other App', source: 'winget' }] }),
      []
    )
    expect(summary.pending).toEqual([
      { key: 'winget␟Other.App', appId: 'Other.App', name: 'Other App' }
    ])
  })
})

describe('summaryMessage', () => {
  const entry = (name: string, extra: Partial<UpdateSummary['updated'][number]> = {}) => ({
    key: `winget␟${name}`,
    appId: name,
    name,
    ...extra
  })
  const summary = (s: Partial<UpdateSummary>): UpdateSummary => ({
    updated: [],
    pending: [],
    failed: [],
    ...s
  })

  it('names a single updated app and the version it reached', () => {
    expect(
      summaryMessage(
        summary({ updated: [entry('Microsoft PowerToys', { toVersion: '0.101.2362.0' })] }),
        t,
        'en'
      )
    ).toEqual({
      kind: 'success',
      title: 'Microsoft PowerToys updated to 0.101.2362.0',
      lines: [],
      truncated: false
    })
  })

  it('names a single updated app without a known version', () => {
    expect(summaryMessage(summary({ updated: [entry('AnyDesk')] }), t, 'en')?.title).toBe(
      'AnyDesk updated'
    )
  })

  it('warns about a single install still running in the background', () => {
    const message = summaryMessage(summary({ pending: [entry('Microsoft PowerToys')] }), t, 'en')
    expect(message?.kind).toBe('warning')
    expect(message?.title).toContain('Microsoft PowerToys')
    expect(message?.title).toContain('still installing')
  })

  it('names a single failed app and why', () => {
    expect(
      summaryMessage(summary({ failed: [entry('Git', { reason: 'Files are in use' })] }), t, 'en')
    ).toEqual({
      kind: 'error',
      title: 'Failed to update Git',
      lines: ['Files are in use'],
      truncated: false
    })
  })

  it('lists every outcome of a bulk update by name, a few at a time', () => {
    const updated = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((n) => entry(n))
    const message = summaryMessage(
      summary({ updated, pending: [entry('P')], failed: [entry('X', { reason: 'nope' })] }),
      t,
      'en'
    )
    expect(message).toEqual({
      kind: 'error',
      title: '7 of 9 apps updated',
      lines: ['Updated: A, B, C, D, E, and 2 more', 'Still installing: P', 'Failed: X'],
      truncated: true
    })
  })

  it('lists six names whole rather than folding one into "1 more"', () => {
    const updated = ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => entry(n))
    const message = summaryMessage(summary({ updated }), t, 'en')
    expect(message?.lines).toEqual(['Updated: A, B, C, D, E, and F'])
    expect(message?.truncated).toBe(false)
  })

  it('lists names the way the language does', async () => {
    const italian = i18next.createInstance()
    await italian.init({
      lng: 'it',
      resources: { it: { updates: itUpdates } },
      defaultNS: 'updates',
      interpolation: { escapeValue: false }
    })
    const message = summaryMessage(
      summary({ updated: ['A', 'B', 'C'].map((n) => entry(n)) }),
      italian.getFixedT('it', 'updates'),
      'it'
    )
    expect(message?.title).toBe('App aggiornate: 3 su 3')
    expect(message?.lines).toEqual(['Aggiornate: A, B e C'])
  })

  it('warns, rather than celebrates, when installs are still running', () => {
    const message = summaryMessage(
      summary({ updated: [entry('A')], pending: [entry('B')] }),
      t,
      'en'
    )
    expect(message?.kind).toBe('warning')
  })

  it('has nothing to say about an empty run', () => {
    expect(summaryMessage(summary({}), t, 'en')).toBeNull()
  })
})

describe('formatElapsed', () => {
  it('reads like a clock', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(65_000)).toBe('1:05')
    expect(formatElapsed(9 * 60_000 + 10_500)).toBe('9:10')
    expect(formatElapsed(3_725_000)).toBe('1:02:05')
  })

  it('never goes negative', () => {
    expect(formatElapsed(-5_000)).toBe('0:00')
  })
})
