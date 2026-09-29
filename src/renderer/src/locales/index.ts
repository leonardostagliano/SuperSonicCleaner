import { createLocaleBackend } from './locale-backend'

// Every language, English included, is a local chunk loaded on demand: the UI language is
// only known at runtime (the OS language, then the saved setting), so none is bundled.
// Vite emits one chunk per file; nothing is fetched from a network service.
const loaders = import.meta.glob('./*/*.json', { import: 'default' }) as Record<
  string,
  () => Promise<Record<string, unknown>>
>

/** Every namespace, named after the English files, which every language translates. */
export const namespaces = Object.keys(loaders)
  .filter((file) => file.startsWith('./en/'))
  .map((file) => file.slice('./en/'.length, -'.json'.length))
export const localeBackend = createLocaleBackend(loaders)
