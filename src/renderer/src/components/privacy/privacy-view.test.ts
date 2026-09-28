import { describe, expect, it } from 'vitest'
import type { PrivacySetting } from '@shared/types'
import {
  categoryCounts,
  irreversibleCount,
  presentCategories,
  settingsToApply,
  switchDisabled
} from './privacy-view'

const setting = (over: Partial<PrivacySetting>): PrivacySetting => ({
  id: 'id',
  category: 'telemetry',
  label: 'Label',
  description: '',
  enabled: false,
  reversible: true,
  requiresAdmin: false,
  ...over
})

const settings = [
  setting({ id: 'a', category: 'telemetry', enabled: true }),
  setting({ id: 'b', category: 'telemetry' }),
  setting({ id: 'c', category: 'ads', reversible: false }),
  setting({ id: 'd', category: 'ai', dependsOn: 'b' })
]

describe('privacy-view', () => {
  it('lists the settings an apply would change, overall or per category', () => {
    expect(settingsToApply(settings).map((s) => s.id)).toEqual(['b', 'c', 'd'])
    expect(settingsToApply(settings, 'telemetry').map((s) => s.id)).toEqual(['b'])
  })

  it('counts the changes that cannot be undone from the page', () => {
    expect(irreversibleCount(settingsToApply(settings))).toBe(1)
  })

  it('counts applied and pending settings per category', () => {
    expect(categoryCounts(settings, 'telemetry')).toEqual({ total: 2, applied: 1, pending: 1 })
    expect(categoryCounts(settings, 'browser')).toEqual({ total: 0, applied: 0, pending: 0 })
  })

  it('keeps page order and skips categories without settings', () => {
    expect(presentCategories(settings)).toEqual(['telemetry', 'ads', 'ai'])
  })

  it('locks a switch while busy, before its dependency, and once an irreversible setting is on', () => {
    expect(switchDisabled(settings[1], settings, true)).toBe(true)
    expect(switchDisabled(settings[3], settings, false)).toBe(true)
    expect(switchDisabled(setting({ enabled: true, reversible: false }), settings, false)).toBe(
      true
    )
    expect(switchDisabled(settings[1], settings, false)).toBe(false)
  })
})
