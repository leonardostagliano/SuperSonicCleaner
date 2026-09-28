import type { PrivacySetting } from '@shared/types'

export type PrivacyCategoryId = PrivacySetting['category']

/** The categories in page order; labels live under hardening:privacyCategories. */
export const PRIVACY_CATEGORIES: readonly PrivacyCategoryId[] = [
  'telemetry',
  'ads',
  'search',
  'sync',
  'services',
  'tasks',
  'kernel',
  'network',
  'access',
  'ai',
  'browser'
]

export const categoryLabelKey = (id: PrivacyCategoryId) => `privacyCategories.${id}Label`
export const categoryDescriptionKey = (id: PrivacyCategoryId) =>
  `privacyCategories.${id}Description`

/** Settings not yet at the most private value (optionally in one category): what "apply" changes. */
export function settingsToApply(
  settings: readonly PrivacySetting[],
  category?: PrivacyCategoryId
): PrivacySetting[] {
  return settings.filter((s) => !s.enabled && (category === undefined || s.category === category))
}

/** How many of the given settings cannot be set back from the page once applied. */
export function irreversibleCount(settings: readonly PrivacySetting[]): number {
  return settings.filter((s) => !s.reversible).length
}

export interface CategoryCounts {
  total: number
  applied: number
  pending: number
}

export function categoryCounts(
  settings: readonly PrivacySetting[],
  category: PrivacyCategoryId
): CategoryCounts {
  const inCategory = settings.filter((s) => s.category === category)
  const applied = inCategory.filter((s) => s.enabled).length
  return { total: inCategory.length, applied, pending: inCategory.length - applied }
}

/** The categories that have settings on this platform, in page order. */
export function presentCategories(settings: readonly PrivacySetting[]): PrivacyCategoryId[] {
  return PRIVACY_CATEGORIES.filter((id) => settings.some((s) => s.category === id))
}

/**
 * Whether a setting's switch can be used: never while busy, not before the setting it depends
 * on is applied, and not to turn off a setting that cannot be reverted.
 */
export function switchDisabled(
  setting: PrivacySetting,
  settings: readonly PrivacySetting[],
  busy: boolean
): boolean {
  const dependency = setting.dependsOn
    ? settings.find((s) => s.id === setting.dependsOn)
    : undefined
  const dependencyMissing = dependency !== undefined && !dependency.enabled
  return busy || dependencyMissing || (setting.enabled && !setting.reversible)
}

/** i18next's t, narrowed to what the copy helpers use. */
type Translate = (key: string, options: { defaultValue: string }) => string

/**
 * A setting's label in the UI language. Main sends English copy; the renderer looks the
 * setting up by id in hardening:privacy.settings and keeps main's text for an id the
 * locale files do not know.
 */
export function settingLabel(t: Translate, setting: Pick<PrivacySetting, 'id' | 'label'>): string {
  return t(`privacy.settings.${setting.id}.label`, { defaultValue: setting.label })
}

/** The setting with its label and description in the UI language (see settingLabel). */
export function localizeSetting<T extends PrivacySetting>(t: Translate, setting: T): T {
  return {
    ...setting,
    label: settingLabel(t, setting),
    description: t(`privacy.settings.${setting.id}.description`, {
      defaultValue: setting.description
    })
  }
}

export function localizeSettings<T extends PrivacySetting>(
  t: Translate,
  settings: readonly T[]
): T[] {
  return settings.map((setting) => localizeSetting(t, setting))
}
