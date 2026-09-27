import i18next from 'i18next'
import type { UpdateSeverity } from '@shared/types'

const SOFTWARE_PREFIX = 'software-update:'
/** Names written by versions that stored English text instead of a key. */
const LEGACY_SOFTWARE = /^(major|minor|patch|unknown) updates$/

const SEVERITY_LABEL_KEYS: Record<UpdateSeverity, string> = {
  major: 'softwareUpdater.statMajorUpdates',
  minor: 'softwareUpdater.statMinorUpdates',
  patch: 'softwareUpdater.statPatches',
  unknown: 'softwareUpdater.severityUpdate'
}

/** Key stored in a history entry for the software updates of one severity. */
export function softwareUpdateCategory(severity: UpdateSeverity): string {
  return SOFTWARE_PREFIX + severity
}

/** The key an entry's category belongs to, including entries saved with legacy names. */
export function normalizeHistoryCategory(name: string): string {
  const legacy = LEGACY_SOFTWARE.exec(name)
  return legacy ? SOFTWARE_PREFIX + legacy[1] : name
}

/** Label in the UI language for software update keys; other names as stored. */
export function historyCategoryLabel(name: string): string {
  const key = normalizeHistoryCategory(name)
  if (key.startsWith(SOFTWARE_PREFIX)) {
    const labelKey = SEVERITY_LABEL_KEYS[key.slice(SOFTWARE_PREFIX.length) as UpdateSeverity]
    if (labelKey) return i18next.t(labelKey, { ns: 'updates' })
  }
  return name.charAt(0).toUpperCase() + name.slice(1)
}
