import { describe, expect, it } from 'vitest'
import {
  CATEGORIES,
  OPTIMIZATIONS,
  formatElapsed,
  isValidProcessName,
  stepLabel
} from './game-mode-view'

describe('game-mode-view', () => {
  it('formats the session length', () => {
    expect(formatElapsed(0)).toBe('0:00:00')
    expect(formatElapsed(309_000)).toBe('0:05:09')
    expect(formatElapsed(43_200_000)).toBe('12:00:00')
    expect(formatElapsed(-10)).toBe('0:00:00')
  })

  it('names optimization steps in both directions', () => {
    expect(stepLabel({ phase: 'activating', currentLabel: 'svc-wsearch' })).toEqual({
      key: 'applyingOptimization',
      labelKey: 'optSvcWsearch'
    })
    expect(stepLabel({ phase: 'deactivating', currentLabel: 'sys-power-plan' })).toEqual({
      key: 'restoringOptimization',
      labelKey: 'optSysPowerPlan'
    })
  })

  it('names restore-only steps and falls back for unknown ids', () => {
    expect(stepLabel({ phase: 'deactivating', currentLabel: 'svc-restore-WSearch' })).toEqual({
      key: 'restoringService',
      params: { name: 'WSearch' }
    })
    expect(stepLabel({ phase: 'deactivating', currentLabel: 'sys-registry-tweaks' })).toEqual({
      key: 'restoringRegistry'
    })
    expect(stepLabel({ phase: 'deactivating', currentLabel: 'other' })).toEqual({
      key: 'restoringOther'
    })
    expect(stepLabel({ phase: 'activating', currentLabel: 'other' })).toEqual({
      key: 'activatingProgress'
    })
  })

  it('accepts only plain process names', () => {
    expect(isValidProcessName('spotify.exe')).toBe(true)
    expect(isValidProcessName('My Game_2-x.exe')).toBe(true)
    expect(isValidProcessName('')).toBe(false)
    expect(isValidProcessName('a/b.exe')).toBe(false)
    expect(isValidProcessName('x'.repeat(101))).toBe(false)
  })

  it('puts every optimization in a known category', () => {
    const categories = new Set(CATEGORIES.map((c) => c.id))
    expect(OPTIMIZATIONS.every((o) => categories.has(o.category))).toBe(true)
  })
})
