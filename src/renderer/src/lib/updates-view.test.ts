import { describe, expect, it } from 'vitest'
import { noUpdatesState } from './updates-view'

const base = {
  checked: true,
  loading: false,
  packageManagerAvailable: true,
  pending: 0,
  ignored: 0,
  managers: [
    { name: 'winget' as const, available: true },
    { name: 'npm' as const, available: true }
  ]
}

describe('noUpdatesState', () => {
  it('says all up to date only when every manager answered', () => {
    expect(noUpdatesState(base)).toEqual({ kind: 'upToDate' })
  })

  it('names the managers that answered when another one failed', () => {
    expect(
      noUpdatesState({
        ...base,
        managers: [
          { name: 'winget', available: true, error: 'timed out' },
          { name: 'npm', available: true },
          { name: 'choco', available: false }
        ]
      })
    ).toEqual({ kind: 'partial', checked: ['npm'] })
  })

  it('shows nothing beyond the failure note when no manager answered', () => {
    expect(
      noUpdatesState({ ...base, managers: [{ name: 'winget', available: true, error: 'failed' }] })
    ).toBeNull()
  })

  it('shows nothing while checking, before a check, without a manager or with updates', () => {
    expect(noUpdatesState({ ...base, checked: false })).toBeNull()
    expect(noUpdatesState({ ...base, loading: true })).toBeNull()
    expect(noUpdatesState({ ...base, packageManagerAvailable: false })).toBeNull()
    expect(noUpdatesState({ ...base, pending: 2 })).toBeNull()
    expect(noUpdatesState({ ...base, ignored: 1 })).toBeNull()
  })
})
