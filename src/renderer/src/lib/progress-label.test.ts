import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import { progressText } from './progress-label'

const t = ((key: string, params?: Record<string, unknown>) =>
  params && Object.keys(params).length
    ? `${key}(${JSON.stringify(params)})`
    : key) as unknown as TFunction

describe('progressText', () => {
  it('translates a key with its parameters', () => {
    expect(progressText(t, { key: 'firewall:progress.rules', params: { count: 3 } })).toBe(
      'firewall:progress.rules({"count":3})'
    )
  })

  it('translates a key without parameters', () => {
    expect(progressText(t, { key: 'services:progress.enumerating' })).toBe(
      'services:progress.enumerating'
    )
  })

  it('shows a legacy string as it is', () => {
    expect(progressText(t, 'Enumerating services…')).toBe('Enumerating services…')
  })

  it('is empty when there is no label yet', () => {
    expect(progressText(t, undefined)).toBe('')
    expect(progressText(t, '')).toBe('')
  })
})
