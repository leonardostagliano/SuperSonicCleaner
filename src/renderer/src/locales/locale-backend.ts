import type { BackendModule } from 'i18next'

type Namespace = Record<string, unknown>
type Loaders = Record<string, () => Promise<Namespace>>

const PLURAL_OTHER = '_other'

/**
 * A copy of `data` with every plural category the language uses. Translations carry
 * `_one` and `_other`, but i18next picks the suffix with the language's own rules
 * (Arabic also needs zero, two, few and many; Russian few and many; Italian many for
 * exact millions), and a missing form falls back to English mid-sentence. A missing
 * form takes the `_other` text; a form the translation has is never replaced.
 */
export function completePlurals(data: Namespace, language: string): Namespace {
  let categories: string[]
  try {
    categories = new Intl.PluralRules(language.replace('_', '-')).resolvedOptions()
      .pluralCategories
  } catch {
    return data
  }
  const complete = (level: Namespace): Namespace => {
    const out: Namespace = {}
    for (const [key, value] of Object.entries(level))
      out[key] =
        value && typeof value === 'object' && !Array.isArray(value)
          ? complete(value as Namespace)
          : value
    for (const [key, value] of Object.entries(level)) {
      // Ordinal forms follow other rules; only cardinal plurals are completed.
      if (!key.endsWith(PLURAL_OTHER) || key.includes('_ordinal_') || typeof value !== 'string')
        continue
      const base = key.slice(0, -PLURAL_OTHER.length)
      for (const category of categories)
        if (!Object.hasOwn(out, `${base}_${category}`)) out[`${base}_${category}`] = value
    }
    return out
  }
  return complete(data)
}

/** Only build-time allowlisted locale chunks can be requested by i18next. */
export function createLocaleBackend(loaders: Loaders): BackendModule {
  return {
    type: 'backend',
    init() {},
    read(language, namespace, callback) {
      const key = `./${language}/${namespace}.json`
      const load = Object.hasOwn(loaders, key) ? loaders[key] : undefined
      if (!load) {
        // An untranslated namespace falls back to English.
        callback(null, {})
        return
      }
      void load().then(
        (data) => callback(null, completePlurals(data, language)),
        (error) => callback(error, false)
      )
    }
  }
}
