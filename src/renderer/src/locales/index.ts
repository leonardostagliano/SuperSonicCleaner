import { createLocaleBackend } from './locale-backend'

// Keep the fallback ready, but do not parse every supported language in every
// window. Vite emits local chunks for the selected language; no network service.
const english = import.meta.glob('./en/*.json', { eager: true, import: 'default' }) as Record<
  string,
  Record<string, unknown>
>
const localized = import.meta.glob(['./*/*.json', '!./en/*.json'], { import: 'default' }) as Record<
  string,
  () => Promise<Record<string, unknown>>
>

export const resources = {
  en: Object.fromEntries(
    Object.entries(english).map(([path, data]) => [path.split('/')[2].replace('.json', ''), data])
  )
}
export const namespaces = Object.keys(resources.en)
export const localeBackend = createLocaleBackend(localized)
