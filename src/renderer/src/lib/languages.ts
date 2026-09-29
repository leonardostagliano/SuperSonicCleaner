import { RTL_LANGUAGES } from '@shared/languages'

// The list itself lives in `shared` so the main process can reuse it when
// resolving a fresh install's default language from the OS locale.
export { LANGUAGES, RTL_LANGUAGES, matchLocaleToLanguage } from '@shared/languages'
export type { LanguageCode } from '@shared/languages'

/** Toasts sit at the end of the reading direction: bottom right, bottom left in RTL. */
export function toastPlacement(language: string): {
  position: 'bottom-right' | 'bottom-left'
  dir: 'ltr' | 'rtl'
} {
  return RTL_LANGUAGES.includes(language)
    ? { position: 'bottom-left', dir: 'rtl' }
    : { position: 'bottom-right', dir: 'ltr' }
}
