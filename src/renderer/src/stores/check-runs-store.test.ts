import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock localStorage, same pattern as scan-store.test.ts.
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, val: string) => storage.set(key, val),
  removeItem: (key: string) => storage.delete(key)
})

import { lastCheckRun, parseCheckRuns, recordCheckRun, useCheckRunsStore } from './check-runs-store'

describe('parseCheckRuns', () => {
  it('returns nothing for missing, empty or unparsable input', () => {
    expect(parseCheckRuns(null)).toEqual({})
    expect(parseCheckRuns('')).toEqual({})
    expect(parseCheckRuns('not json')).toEqual({})
  })

  it('returns nothing for a payload with the wrong shape or version', () => {
    expect(parseCheckRuns(JSON.stringify({ runs: { startup: 1 } }))).toEqual({})
    expect(parseCheckRuns(JSON.stringify({ version: 2, runs: { startup: 1 } }))).toEqual({})
    expect(parseCheckRuns(JSON.stringify({ version: 1, runs: null }))).toEqual({})
    expect(parseCheckRuns(JSON.stringify({ version: 1 }))).toEqual({})
  })

  it('drops unknown ids and non-numeric values, keeping the rest', () => {
    const raw = JSON.stringify({
      version: 1,
      runs: { startup: 1000, bogusId: 2000, malware: 'nope', cleanup: Number.NaN, privacy: 3000 }
    })
    expect(parseCheckRuns(raw)).toEqual({ startup: 1000, privacy: 3000 })
  })
})

describe('recordCheckRun / lastCheckRun', () => {
  beforeEach(() => {
    storage.clear()
    useCheckRunsStore.setState({ runs: {} })
  })

  it('has no recorded run before any check completes', () => {
    expect(lastCheckRun('startup')).toBeNull()
  })

  it('records the moment a check completes and reads it back', () => {
    recordCheckRun('startup', 1_000)
    expect(lastCheckRun('startup')).toBe(1_000)
  })

  it('defaults to now when no timestamp is given', () => {
    const before = Date.now()
    recordCheckRun('malware')
    const at = lastCheckRun('malware')
    expect(at).not.toBeNull()
    expect(at as number).toBeGreaterThanOrEqual(before)
  })

  it('keeps each check id separate', () => {
    recordCheckRun('cleanup', 1)
    recordCheckRun('registry', 2)
    expect(lastCheckRun('cleanup')).toBe(1)
    expect(lastCheckRun('registry')).toBe(2)
    expect(lastCheckRun('drivers')).toBeNull()
  })

  it('overwrites an earlier run of the same check', () => {
    recordCheckRun('updates', 1)
    recordCheckRun('updates', 2)
    expect(lastCheckRun('updates')).toBe(2)
  })

  it('persists to localStorage in the versioned shape', () => {
    recordCheckRun('privacy', 5_000)
    const stored = JSON.parse(storage.get('kudu:check-runs') as string)
    expect(stored).toEqual({ version: 1, runs: { privacy: 5_000 } })
  })

  it('hydrates from a previously persisted value', () => {
    storage.set('kudu:check-runs', JSON.stringify({ version: 1, runs: { drivers: 42 } }))
    useCheckRunsStore.setState({ runs: parseCheckRuns(storage.get('kudu:check-runs') as string) })
    expect(lastCheckRun('drivers')).toBe(42)
  })
})
