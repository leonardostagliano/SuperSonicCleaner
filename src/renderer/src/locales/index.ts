import { createLocaleBackend } from './locale-backend'

// Every language, English included, is a local chunk loaded on demand: the UI language is
// only known at runtime (the OS language, then the saved setting), so none is bundled.
// English is still read before the first render, as the fallback for missing keys: it
// sits in its own chunk (locale-en), loaded next to the UI language, not in the entry
// chunk. Measuring startup cost by the entry and App chunks alone therefore leaves it out.
// Nothing is fetched from a network service.
const loaders = import.meta.glob('./*/*.json', { import: 'default' }) as Record<
  string,
  () => Promise<Record<string, unknown>>
>

/** Every namespace, named after the English files, which every language translates. */
export const namespaces = Object.keys(loaders)
  .filter((file) => file.startsWith('./en/'))
  .map((file) => file.slice('./en/'.length, -'.json'.length))
export const localeBackend = createLocaleBackend(loaders)
