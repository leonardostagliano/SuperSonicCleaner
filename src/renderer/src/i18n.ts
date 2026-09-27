import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resources, namespaces, localeBackend } from './locales'
import { matchLocaleToLanguage } from '@shared/languages'

// Start loading the OS language while the app initializes. A persisted choice
// wins before first paint, and English remains available as the fallback.
const initialLanguage = matchLocaleToLanguage(
  typeof navigator !== 'undefined' ? navigator.language : 'en'
)

const initialized = i18n
  .use(localeBackend)
  .use(initReactI18next)
  .init({
    resources,
    partialBundledLanguages: true,
    lng: initialLanguage,
    fallbackLng: 'en',
    ns: new URLSearchParams(window.location.search).has('desktop-notch') ? ['notch'] : namespaces,
    defaultNS: 'common',
    interpolation: {
      escapeValue: false
    },
    react: {
      useSuspense: false
    }
  })

// Avoid racing an asynchronous locale import with a persisted-language change.
export const i18nReady = initialized.then(async () => {
  try {
    const settings = await window.kudu?.settingsGet?.()
    if (settings?.language && settings.language !== i18n.language)
      await i18n.changeLanguage(settings.language)
  } catch {
    // OS language and bundled English remain usable if settings are unavailable.
  }
})

export default i18n
