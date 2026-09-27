import { describe, expect, it, vi } from 'vitest'
import i18next from 'i18next'
import { createLocaleBackend } from './locale-backend'

describe('on-demand local translations', () => {
  it('loads only the chosen language and namespace and retains English fallback', async () => {
    const italian = vi.fn(async () => ({ title: 'Monitor' }))
    const german = vi.fn(async () => ({ title: 'Monitor DE' }))
    const unrelated = vi.fn(async () => ({ title: 'Pulizia' }))
    const instance = i18next.createInstance()
    await instance
      .use(
        createLocaleBackend({
          './it/notch.json': italian,
          './de/notch.json': german,
          './it/cleaner.json': unrelated
        })
      )
      .init({
        resources: { en: { notch: { title: 'Monitor EN', missing: 'Fallback' } } },
        partialBundledLanguages: true,
        lng: 'it',
        fallbackLng: 'en',
        ns: ['notch'],
        defaultNS: 'notch'
      })
    expect(instance.t('title')).toBe('Monitor')
    expect(instance.t('missing')).toBe('Fallback')
    expect(italian).toHaveBeenCalledTimes(1)
    expect(german).not.toHaveBeenCalled()
    expect(unrelated).not.toHaveBeenCalled()
    await instance.changeLanguage('de')
    expect(instance.t('title')).toBe('Monitor DE')
    expect(german).toHaveBeenCalledTimes(1)
  })

  it('handles an untranslated namespace without requesting an unknown path', async () => {
    const unrelated = vi.fn(async () => ({ title: 'unused' }))
    const instance = i18next.createInstance()
    await instance.use(createLocaleBackend({ './it/common.json': unrelated })).init({
      resources: { en: { ai: { title: 'AI analysis' } } },
      partialBundledLanguages: true,
      lng: 'it',
      fallbackLng: 'en',
      ns: ['ai'],
      defaultNS: 'ai'
    })
    expect(instance.t('title')).toBe('AI analysis')
    expect(unrelated).not.toHaveBeenCalled()
  })
})
