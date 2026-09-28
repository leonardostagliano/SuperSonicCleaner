import { CleanerType, ScanStatus } from '@shared/enums'
import type { ProgressData, ScanResult } from '@shared/types'
import { useScanStore } from '@/stores/scan-store'
import { recordCheckRun } from '@/stores/check-runs-store'

export interface CleanerScanCategory {
  type: CleanerType
  label: string
}

const scanFns: Partial<Record<CleanerType, () => Promise<ScanResult[]>>> = {
  [CleanerType.System]: () => window.kudu.systemScan(),
  [CleanerType.Browser]: () => window.kudu.browserScan(),
  [CleanerType.App]: () => window.kudu.appScan(),
  [CleanerType.Gaming]: () => window.kudu.gamingScan(),
  [CleanerType.RecycleBin]: () => window.kudu.recycleBinScan(),
  [CleanerType.Shortcut]: () => window.kudu.shortcutScan(),
  [CleanerType.Environment]: () => window.kudu.environmentScan(),
  [CleanerType.Database]: () => window.kudu.databaseScan(),
  [CleanerType.PrivacyTraces]: () => window.kudu.privacyTracesScan()
}

let activeScan: Promise<void> | null = null
let cancelRequested = false

export function cancelCleanerScan(): void {
  if (!activeScan) return
  // The individual IPC scanners do not expose cancellation. Finish the active
  // category, then stop before invoking another one.
  cancelRequested = true
  useScanStore.getState().setScanCancelRequested(true)
}

export function startCleanerScan(categories: CleanerScanCategory[]): Promise<void> {
  if (activeScan) return activeScan

  cancelRequested = false
  const state = useScanStore.getState()
  state.setStatus(ScanStatus.Scanning)
  state.setResults([])
  state.setProgress(null)
  state.setCleanSummary(null)
  state.setFailedCategories([])
  state.setElevationSkipped([])
  state.setScanCancelRequested(false)
  state.setScannedAt(null)

  const run = async (): Promise<void> => {
    const failed: string[] = []
    const skippedForElevation: string[] = []
    const total = categories.length
    let current: CleanerScanCategory | null = null
    let completed = 0
    let unsubscribe: (() => void) | undefined

    const totals = () => {
      const results = useScanStore.getState().results
      return {
        itemsFound: results.reduce((sum, result) => sum + result.itemCount, 0),
        sizeFound: results.reduce((sum, result) => sum + result.totalSize, 0)
      }
    }

    const report = (data: Partial<ProgressData> = {}) => {
      if (!current) return
      const fraction =
        typeof data.progress === 'number' && Number.isFinite(data.progress)
          ? Math.max(0, Math.min(100, data.progress)) / 100
          : 0
      const prior = totals()
      const previous = useScanStore.getState().progress
      const measured = total > 0 ? ((completed + fraction) / total) * 100 : 0
      useScanStore.getState().setProgress({
        phase: 'scanning',
        category: current.type,
        currentPath: data.currentPath || current.label,
        // A scanner step without a path arrives as a translatable label.
        ...(data.label ? { label: data.label } : {}),
        progress:
          previous?.phase === 'scanning' && previous.category === current.type
            ? Math.max(previous.progress, measured)
            : measured,
        itemsFound: prior.itemsFound + (data.itemsFound ?? 0),
        sizeFound: prior.sizeFound + (data.sizeFound ?? 0)
      })
    }

    try {
      unsubscribe = window.kudu.onScanProgress((data) => {
        if (data.phase === 'scanning' && current && data.category === current.type) report(data)
      })

      for (const category of categories) {
        if (cancelRequested) break
        current = category
        useScanStore.getState().setScanningCategory(category.type)
        report()
        try {
          const scan = scanFns[category.type]
          if (!scan) throw new Error('Unsupported cleaner category')
          const results = await scan()
          const elevationMarker = results.find(
            (result) => result.subcategory === '__elevation_required'
          )
          if (elevationMarker?.group) {
            skippedForElevation.push(...elevationMarker.group.split(', '))
          }
          useScanStore
            .getState()
            .addResults(results.filter((result) => result.subcategory !== '__elevation_required'))
        } catch {
          failed.push(category.label)
        }
        completed++
        const found = totals()
        useScanStore.getState().setProgress({
          phase: 'scanning',
          category: category.type,
          currentPath: category.label,
          progress: total > 0 ? (completed / total) * 100 : 100,
          ...found
        })
      }
      const currentState = useScanStore.getState()
      currentState.setFailedCategories(failed)
      currentState.setElevationSkipped(skippedForElevation)
      if (completed > 0) currentState.setScannedAt(Date.now())
      const finished = completed === 0 && cancelRequested ? ScanStatus.Idle : ScanStatus.Complete
      currentState.setStatus(finished)
      // Not "every category failed" (and not an empty run): the analysis must have
      // actually produced a result, not merely finished going through the motions.
      if (finished === ScanStatus.Complete && completed > failed.length) recordCheckRun('cleanup')
    } catch {
      useScanStore.getState().setStatus(ScanStatus.Error)
    } finally {
      unsubscribe?.()
      const currentState = useScanStore.getState()
      currentState.setScanningCategory(null)
      currentState.setScanCancelRequested(false)
      currentState.setProgress(null)
      cancelRequested = false
      activeScan = null
    }
  }

  activeScan = Promise.resolve().then(run)
  return activeScan
}
