import { CleanerType } from '@shared/enums'

/**
 * The categories the Cleaner page analyses, in its order (CleanerPage `categories`,
 * without the AI tools view). Kept here so Home does not load the Cleaner chunk.
 */
export const ANALYSIS_CATEGORIES: readonly { type: CleanerType; labelKey: string }[] = [
  { type: CleanerType.System, labelKey: 'categorySystem' },
  { type: CleanerType.Browser, labelKey: 'categoryBrowsers' },
  { type: CleanerType.App, labelKey: 'categoryApplications' },
  { type: CleanerType.Gaming, labelKey: 'categoryGaming' },
  { type: CleanerType.RecycleBin, labelKey: 'categoryRecycleBin' },
  { type: CleanerType.Shortcut, labelKey: 'categoryShortcuts' },
  { type: CleanerType.Environment, labelKey: 'categoryEnvironment' },
  { type: CleanerType.Database, labelKey: 'categoryDatabases' },
  { type: CleanerType.PrivacyTraces, labelKey: 'categoryPrivacyTraces' }
]
