import type { BackendModule } from 'i18next'

type Namespace = Record<string, unknown>
type Loaders = Record<string, () => Promise<Namespace>>

/** Only build-time allowlisted locale chunks can be requested by i18next. */
export function createLocaleBackend(loaders: Loaders): BackendModule {
  return {
    type: 'backend',
    init() {},
    read(language, namespace, callback) {
      const key = `./${language}/${namespace}.json`
      const load = Object.hasOwn(loaders, key) ? loaders[key] : undefined
      if (!load) {
        // Untranslated namespaces use the bundled English fallback.
        callback(null, {})
        return
      }
      void load().then(
        (data) => callback(null, data),
        (error) => callback(error, false)
      )
    }
  }
}
