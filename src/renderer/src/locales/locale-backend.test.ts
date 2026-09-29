import { describe, expect, it, vi } from 'vitest'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import i18next from 'i18next'
import enCommon from './en/common.json'
import enNotch from './en/notch.json'
import itNotch from './it/notch.json'
import arDashboard from './ar/dashboard.json'
import { completePlurals, createLocaleBackend } from './locale-backend'
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

describe('plural forms of every language', () => {
  const english = { items_one: '{{count}} item', items_other: '{{count}} items' }

  it('fills the categories a language needs with its own _other text, never English', async () => {
    const arabic = {
      items_one: 'AR one',
      items_other: 'AR {{count}}',
      nested: { steps_one: 'AR step', steps_other: 'AR steps {{count}}' },
      kept_one: 'AR kept one',
      kept_two: 'AR kept two',
      kept_few: 'AR kept few',
      kept_other: 'AR kept other'
    }
    const instance = i18next.createInstance()
    await instance
      .use(
        createLocaleBackend({
          './ar/ns.json': async () => arabic,
          './en/ns.json': async () => ({
            ...english,
            nested: { steps_one: 'EN step', steps_other: 'EN steps' },
            kept_one: 'EN kept',
            kept_other: 'EN kept other'
          })
        })
      )
      .init({ lng: 'ar', fallbackLng: 'en', ns: ['ns'], defaultNS: 'ns' })
    for (const count of [0, 2, 3, 11, 100]) {
      expect(instance.t('items', { count })).toBe(`AR ${count}`)
      expect(instance.t('nested.steps', { count })).toBe(`AR steps ${count}`)
    }
    expect(instance.t('items', { count: 1 })).toBe('AR one')
    // Forms a translation already has are kept.
    expect(instance.t('kept', { count: 2 })).toBe('AR kept two')
    expect(instance.t('kept', { count: 3 })).toBe('AR kept few')
    expect(instance.t('kept', { count: 11 })).toBe('AR kept other')
    // The loaded module itself is left as it was.
    expect(arabic).not.toHaveProperty('items_two')
  })

  it("covers Italian 'many', used for exact millions", async () => {
    const instance = i18next.createInstance()
    await instance
      .use(
        createLocaleBackend({
          './it/ns.json': async () => ({ items_one: '1 elemento', items_other: '{{count}} elementi' }),
          './en/ns.json': async () => english
        })
      )
      .init({ lng: 'it', fallbackLng: 'en', ns: ['ns'], defaultNS: 'ns' })
    expect(instance.t('items', { count: 1000000 })).toBe('1000000 elementi')
    expect(instance.t('items', { count: 2 })).toBe('2 elementi')
  })

  it('keeps a real Arabic page in Arabic for every count', async () => {
    const instance = i18next.createInstance()
    await instance
      .use(localeBackend)
      .init({ lng: 'ar', fallbackLng: 'en', ns: ['dashboard'], defaultNS: 'dashboard' })
    for (const count of [0, 1, 2, 3, 11, 100])
      expect(instance.t('checks.toRun', { count })).toBe(
        arDashboard.checks[count === 1 ? 'toRun_one' : 'toRun_other'].replace(
          '{{count}}',
          String(count)
        )
      )
  })

  it('adds only the missing categories and leaves other keys alone', () => {
    const data = { a_one: 'one', a_other: 'other', a_few: 'few', plain: 'text', b_other: 'b' }
    expect(completePlurals(data, 'ru')).toEqual({
      a_one: 'one',
      a_other: 'other',
      a_few: 'few',
      a_many: 'other',
      plain: 'text',
      b_other: 'b',
      b_one: 'b',
      b_few: 'b',
      b_many: 'b'
    })
    expect(completePlurals(data, 'en')).toEqual({ ...data, b_one: 'b' })
    expect(completePlurals(data, 'not a language')).toEqual(data)
  })
})
