import { describe, it, expect, beforeAll } from 'vitest'
import i18next from 'i18next'
import enUpdates from '@/locales/en/updates.json'
import {
  historyCategoryLabel,
  normalizeHistoryCategory,
  softwareUpdateCategory
} from './history-categories'

beforeAll(async () => {
  await i18next.init({ lng: 'en', resources: { en: { updates: enUpdates } }, ns: ['updates'] })
})

describe('history categories', () => {
  it('stores software updates under a stable key', () => {
    expect(softwareUpdateCategory('minor')).toBe('software-update:minor')
  })

  it('maps entries saved with the old English name to the same key', () => {
    expect(normalizeHistoryCategory('minor updates')).toBe('software-update:minor')
    expect(normalizeHistoryCategory('major updates')).toBe('software-update:major')
    expect(normalizeHistoryCategory('Browser cache')).toBe('Browser cache')
  })

  it('translates software update categories', () => {
    expect(historyCategoryLabel('software-update:minor')).toBe('Minor Updates')
    expect(historyCategoryLabel('patch updates')).toBe('Patches')
    expect(historyCategoryLabel('software-update:unknown')).toBe('Update')
  })

  it('shows other categories as stored, with a capital first letter', () => {
    expect(historyCategoryLabel('browser cache')).toBe('Browser cache')
    expect(historyCategoryLabel('')).toBe('')
  })
})
