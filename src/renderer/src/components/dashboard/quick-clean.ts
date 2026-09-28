// The Home's two cleaning entry points: "Analizza e pulisci" starts the Cleaner page's
// analysis, "Pulisci senza anteprima" runs today's one-click clean behind a confirmation.
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { TFunction } from 'i18next'
import type { CleanResult, ScanResult } from '@shared/types'
import { CleanerType, ScanStatus } from '@shared/enums'
import { startCleanerScan } from '@/lib/cleaner-scan'
import { cleanInBatches } from '@/lib/cleaner-batches'
import { useScanStore } from '@/stores/scan-store'
import { useSettingsStore } from '@/stores/settings-store'

/**
 * The categories the Cleaner page analyses, in its order (CleanerPage `categories`,
 * without the AI tools view). Kept here so Home does not load the Cleaner chunk.
 */
const ANALYSIS_CATEGORIES: readonly { type: CleanerType; labelKey: string }[] = [
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

/** Starts the Cleaner page's analysis (read-only), labelled as the page labels it. */
export function startCleanerAnalysis(t: TFunction, protectRecycleBin: boolean): void {
  const categories = protectRecycleBin
    ? ANALYSIS_CATEGORIES.filter((category) => category.type !== CleanerType.RecycleBin)
    : ANALYSIS_CATEGORIES
  void startCleanerScan(
    categories.map(({ type, labelKey }) => ({ type, label: t(labelKey, { ns: 'cleaner' }) }))
  )
}

/** Starts the Cleaner analysis and opens the page, unless the Cleaner is already busy. */
export function useAnalyzeAndClean(): () => void {
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()
  const protectRecycleBin = useSettingsStore((s) => s.settings.cleaner.protectRecycleBin)
  return useCallback(() => {
    const status = useScanStore.getState().status
    if (status !== ScanStatus.Scanning && status !== ScanStatus.Cleaning) {
      startCleanerAnalysis(t, protectRecycleBin)
    }
    navigate('/cleaner')
  }, [t, protectRecycleBin, navigate])
}

interface QuickCleaner {
  type: CleanerType
  scan: () => Promise<ScanResult[]>
  clean: (ids: string[]) => Promise<CleanResult>
}

/** What the one-click clean scans and cleans, in order. */
export const QUICK_CLEANERS: readonly QuickCleaner[] = [
  {
    type: CleanerType.System,
    scan: () => window.kudu.systemScan(),
    clean: (ids) => window.kudu.systemClean(ids)
  },
  {
    type: CleanerType.Browser,
    scan: () => window.kudu.browserScan(),
    clean: (ids) => window.kudu.browserClean(ids)
  },
  {
    type: CleanerType.App,
    scan: () => window.kudu.appScan(),
    clean: (ids) => window.kudu.appClean(ids)
  },
  {
    type: CleanerType.Gaming,
    scan: () => window.kudu.gamingScan(),
    clean: (ids) => window.kudu.gamingClean(ids)
  },
  {
    type: CleanerType.RecycleBin,
    scan: () => window.kudu.recycleBinScan(),
    clean: () => window.kudu.recycleBinClean()
  },
  {
    type: CleanerType.Environment,
    scan: () => window.kudu.environmentScan(),
    clean: (ids) => window.kudu.environmentClean(ids)
  },
  {
    type: CleanerType.Database,
    scan: () => window.kudu.databaseScan(),
    clean: (ids) => window.kudu.databaseClean(ids)
  }
]

export function quickCleaners(protectRecycleBin: boolean): readonly QuickCleaner[] {
  return protectRecycleBin
    ? QUICK_CLEANERS.filter((cleaner) => cleaner.type !== CleanerType.RecycleBin)
    : QUICK_CLEANERS
}

export interface QuickCleanProgress {
  /** i18n key in the dashboard namespace, with its parameters. */
  key: string
  params?: Record<string, string>
  done: number
  total: number
}

export interface QuickCleanResult {
  space: number
  files: number
  registryFixed: number
  failed: string[]
}

/**
 * Scans and cleans every category without a preview, skipping the subcategories excluded
 * on the Cleaner page, then fixes the registry entries its scan marks as safe.
 */
export async function runQuickClean(options: {
  t: TFunction
  excluded: ReadonlySet<string>
  protectRecycleBin: boolean
  registry: boolean
  onProgress: (progress: QuickCleanProgress) => void
}): Promise<QuickCleanResult> {
  const { t, excluded, onProgress } = options
  const cleaners = quickCleaners(options.protectRecycleBin)
  const total = cleaners.length + (options.registry ? 1 : 0)
  const result: QuickCleanResult = { space: 0, files: 0, registryFixed: 0, failed: [] }
  let done = 0
  for (const { type, scan, clean } of cleaners) {
    const category = t(`dashboard:categories.${type}`)
    try {
      onProgress({ key: 'quick.progressScanning', params: { category }, done, total })
      const results = await scan()
      const ids = results
        .filter((r) => !excluded.has(r.subcategory))
        .flatMap((r) => r.items.map((i) => i.id))
      if (ids.length > 0) {
        onProgress({ key: 'quick.progressCleaning', params: { category }, done, total })
        const cleaned = await cleanInBatches(ids, clean)
        result.space += cleaned.result.totalCleaned || 0
        result.files += cleaned.result.filesDeleted || 0
        if (cleaned.error) result.failed.push(category)
      }
    } catch {
      result.failed.push(category)
    }
    done++
  }
  if (options.registry) {
    try {
      onProgress({ key: 'quick.progressRegistryScan', done, total })
      const entries = await window.kudu.registryScan()
      const ids = Array.isArray(entries) ? entries.filter((e) => e?.selected).map((e) => e.id) : []
      if (ids.length > 0) {
        onProgress({ key: 'quick.progressRegistryFix', done, total })
        const fixed = await window.kudu.registryFix(ids)
        result.registryFixed = fixed?.fixed ?? 0
      }
    } catch {
      result.failed.push(t('dashboard:categories.registry'))
    }
    done++
  }
  onProgress({ key: 'quick.progressDone', done, total })
  return result
}
