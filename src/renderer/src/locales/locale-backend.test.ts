import { describe, expect, it, vi } from 'vitest'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import i18next from 'i18next'
import enCommon from './en/common.json'
import enNotch from './en/notch.json'
import itNotch from './it/notch.json'
import { createLocaleBackend } from './locale-backend'
import { localeBackend, namespaces } from './index'

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

describe('English loaded on demand', () => {
  it('loads the UI language and the English fallback before init resolves', async () => {
    const italian = vi.fn(async () => ({ title: 'Monitor' }))
    const english = vi.fn(async () => ({ title: 'Monitor EN', missing: 'Fallback' }))
    const german = vi.fn(async () => ({ title: 'Monitor DE' }))
    const instance = i18next.createInstance()
    await instance
      .use(
        createLocaleBackend({
          './it/notch.json': italian,
          './en/notch.json': english,
          './de/notch.json': german
        })
      )
      .init({ lng: 'it', fallbackLng: 'en', ns: ['notch'], defaultNS: 'notch' })
    // Nothing is bundled: both languages came through the backend, before the first render.
    expect(instance.t('title')).toBe('Monitor')
    expect(instance.t('missing')).toBe('Fallback')
    expect(italian).toHaveBeenCalledTimes(1)
    expect(english).toHaveBeenCalledTimes(1)

    // A saved language applied after init keeps the fallback it already has.
    await instance.changeLanguage('de')
    expect(instance.t('title')).toBe('Monitor DE')
    expect(instance.t('missing')).toBe('Fallback')
    expect(english).toHaveBeenCalledTimes(1)
  })

  it('knows every namespace from the English files without loading them', () => {
    const files = readdirSync(path.resolve(__dirname, 'en')).map((f) => f.replace('.json', ''))
    expect([...namespaces].sort()).toEqual(files.sort())
  })

  it('serves the English files from the app backend, for the app and for the notch', async () => {
    const app = i18next.createInstance()
    await app.use(localeBackend).init({ lng: 'it', fallbackLng: 'en', ns: namespaces })
    expect(app.getResource('en', 'common', 'cancel')).toBe(enCommon.cancel)
    expect(namespaces.every((ns) => app.hasResourceBundle('en', ns))).toBe(true)

    const notch = i18next.createInstance()
    await notch.use(localeBackend).init({ lng: 'it', fallbackLng: 'en', ns: ['notch'] })
    expect(notch.t('notch:title')).toBe(itNotch.title)
    expect(notch.getResource('en', 'notch', 'title')).toBe(enNotch.title)
    expect(notch.hasResourceBundle('en', 'common')).toBe(false)
  })
})
