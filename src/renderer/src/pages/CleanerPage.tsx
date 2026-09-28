import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { CleanSummary } from '@/components/cleaner/CleanSummary'
import { ReportNotice } from '@/components/cleaner/ReportNotice'
import '@/components/cleaner/pulizia.css'
import {
  Button,
  Card,
  Checkbox,
  ProgressBar,
  Section,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tag
} from '@/components/ui'
import { AiAnalysisPanel } from '@/components/ai/AiAnalysisPanel'
import { icons } from '@/lib/icons'
import { formatBytes, formatNumber } from '@/lib/utils'
import { progressText } from '@/lib/progress-label'
import {
  entryTotal,
  formatDateTime,
  formatList,
  formatPercent,
  formatTime,
  isRecommendedGroup,
  isSafeDefault,
  latestEntry,
  nextSizeSort,
  selectionState,
  selectionTotals,
  sortBySize,
  type SizeSort
} from '@/lib/cleaner-report'
import { cleanInBatches } from '@/lib/cleaner-batches'
import { cancelCleanerScan, startCleanerScan } from '@/lib/cleaner-scan'
import { useScanStore } from '@/stores/scan-store'
import { useHistoryStore } from '@/stores/history-store'
import { useSettingsStore } from '@/stores/settings-store'
import { usePlatform } from '@/hooks/usePlatform'
import { ScanStatus, CleanerType } from '@shared/enums'
import type { CleanerBlocker, ScanItem, ScanResult } from '@shared/types'

/** Check whether a path looks like an absolute filesystem path (not a label like "Recycle Bin" or "PATH → …"). */
const isAbsolutePath = (p: string) => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/')

const AI_TOOLS_VIEW = 'aiTools' as const
const AI_TOOLS_GROUP = 'AI Tools'
type CategoryType = CleanerType | typeof AI_TOOLS_VIEW

interface CategoryDef {
  type: CategoryType
  labelKey: string
  descriptionKey: string
}

const categories: CategoryDef[] = [
  {
    type: CleanerType.System,
    labelKey: 'categorySystem',
    descriptionKey: 'categorySystemDescription'
  },
  {
    type: CleanerType.Browser,
    labelKey: 'categoryBrowsers',
    descriptionKey: 'categoryBrowsersDescription'
  },
  {
    type: CleanerType.App,
    labelKey: 'categoryApplications',
    descriptionKey: 'categoryApplicationsDescription'
  },
  {
    type: AI_TOOLS_VIEW,
    labelKey: 'categoryAiTools',
    descriptionKey: 'categoryAiToolsDescription'
  },
  {
    type: CleanerType.Gaming,
    labelKey: 'categoryGaming',
    descriptionKey: 'categoryGamingDescription'
  },
  {
    type: CleanerType.RecycleBin,
    labelKey: 'categoryRecycleBin',
    descriptionKey: 'categoryRecycleBinDescription'
  },
  {
    type: CleanerType.Shortcut,
    labelKey: 'categoryShortcuts',
    descriptionKey: 'categoryShortcutsDescription'
  },
  {
    type: CleanerType.Environment,
    labelKey: 'categoryEnvironment',
    descriptionKey: 'categoryEnvironmentDescription'
  },
  {
    type: CleanerType.Database,
    labelKey: 'categoryDatabases',
    descriptionKey: 'categoryDatabasesDescription'
  },
  {
    type: CleanerType.PrivacyTraces,
    labelKey: 'categoryPrivacyTraces',
    descriptionKey: 'categoryPrivacyTracesDescription'
  }
]

const scannerCategories = categories.filter(
  (category): category is CategoryDef & { type: CleanerType } => category.type !== AI_TOOLS_VIEW
)

/** Group labels the scanners send in English; unknown ones are shown as they come. */
const GROUP_LABEL_KEYS: Record<string, string> = {
  'Optional cache resets — next launch may be slower': 'groupOptionalCacheResets',
  'Optional maintenance': 'groupOptionalMaintenance',
  'Launcher Caches': 'groupLauncherCaches',
  'GPU Shader Caches': 'groupGpuShaderCaches',
  Redistributables: 'groupRedistributables'
}

/** Items shown under an opened row; the rest are counted. */
const ITEMS_SHOWN = 50

const MENU_VIEWPORT_MARGIN = 8

interface CleanerContextMenuState {
  x: number
  y: number
  label: string
  ids: string[]
}

function sizeForIds(results: ScanResult[], ids: string[]): number {
  const idSet = new Set(ids)
  return results.reduce(
    (sum, r) =>
      sum + r.items.filter((item) => idSet.has(item.id)).reduce((s, item) => s + item.size, 0),
    0
  )
}

function CleanerContextMenu({
  menu,
  size,
  onClean,
  onClose,
  cleanLabel
}: {
  menu: CleanerContextMenuState
  size: number
  onClean: () => void
  onClose: () => void
  cleanLabel: string
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: menu.x, top: menu.y, visible: false })

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const maxLeft = window.innerWidth - el.offsetWidth - MENU_VIEWPORT_MARGIN
    const maxTop = window.innerHeight - el.offsetHeight - MENU_VIEWPORT_MARGIN
    setPosition({
      left: Math.max(MENU_VIEWPORT_MARGIN, Math.min(menu.x, maxLeft)),
      top: Math.max(MENU_VIEWPORT_MARGIN, Math.min(menu.y, maxTop)),
      visible: true
    })
  }, [menu.x, menu.y])

  useEffect(() => {
    const handleDismiss = () => onClose()
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', handleDismiss)
    window.addEventListener('keydown', handleKey)
    window.addEventListener('scroll', handleDismiss, true)
    return () => {
      window.removeEventListener('mousedown', handleDismiss)
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('scroll', handleDismiss, true)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="pulizia-menu"
      style={{
        left: position.left,
        top: position.top,
        visibility: position.visible ? 'visible' : 'hidden'
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button type="button" role="menuitem" onClick={onClean} className="pulizia-menu-item">
        <icons.clean size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>{cleanLabel}</span>
        <span className="pulizia-menu-size">{formatBytes(size)}</span>
      </button>
    </div>,
    document.body
  )
}

/** The live stage of a scan or cleanup: category, bar, what has been found or freed. */
function CleanerProgress({ scanCategories }: { scanCategories: CategoryDef[] }) {
  const { t, i18n } = useTranslation('cleaner')
  const progress = useScanStore((state) => state.progress)
  const status = useScanStore((state) => state.status)
  const cancelRequested = useScanStore((state) => state.scanCancelRequested)
  const scanning = status === ScanStatus.Scanning
  if (!scanning && status !== ScanStatus.Cleaning) return null

  const category = scanCategories.find((c) => c.type === progress?.category)
  const categoryLabel = category ? t(category.labelKey) : ''
  const index = category ? scanCategories.indexOf(category) + 1 : 0
  const step = category
    ? scanning
      ? t('progress.step', { category: categoryLabel, index, total: scanCategories.length })
      : categoryLabel
    : ''
  const detail = progress?.label
    ? progressText(t, progress.label)
    : progress?.currentPath && progress.currentPath !== categoryLabel
      ? progress.currentPath
      : ''
  const value = progress ? progress.progress / 100 : undefined

  return (
    <Section
      title={scanning ? t('progress.scanning') : t('progress.cleaning')}
      meta={progress ? formatPercent(progress.progress, i18n.language) : undefined}
      actions={
        scanning ? (
          <Button
            variant="ghost"
            onClick={cancelCleanerScan}
            disabled={cancelRequested}
            title={t('cancelAfterCategory')}
          >
            {t('common:cancel')}
          </Button>
        ) : undefined
      }
    >
      <div className="pulizia-progress" aria-live="polite">
        <ProgressBar
          value={value}
          label={scanning ? t('progress.scanning') : t('progress.cleaning')}
        />
        {step && <p className="pulizia-progress-step">{step}</p>}
        {detail && (
          <p className="pulizia-progress-path" title={detail}>
            {detail}
          </p>
        )}
        {progress && (
          <p className="pulizia-progress-counts">
            {scanning
              ? t('progress.found', {
                  count: progress.itemsFound,
                  n: formatNumber(progress.itemsFound),
                  size: formatBytes(progress.sizeFound)
                })
              : t('progress.freed', { size: formatBytes(progress.sizeFound) })}
          </p>
        )}
        {cancelRequested && <p className="pulizia-progress-counts">{t('scanCancelPending')}</p>}
      </div>
    </Section>
  )
}

interface CategoryGroup {
  def: CategoryDef
  results: ScanResult[]
  itemCount: number
  totalSize: number
  entries: number | null
  recommended: boolean
}

export function CleanerPage() {
  const { t, i18n } = useTranslation(['cleaner', 'settings'])
  const navigate = useNavigate()
  const { platform } = usePlatform()
  // Progress arrives frequently; only the progress card needs to render for
  // those events, not every result row and selection aggregate on the page.
  const store = useScanStore(useShallow(({ progress: _progress, ...state }) => state))
  const addHistoryEntry = useHistoryStore((s) => s.addEntry)
  const historyEntries = useHistoryStore((s) => s.entries)
  const createRestorePointEnabled = useSettingsStore((s) => s.settings.cleaner.createRestorePoint)
  const closeBrowsersBeforeClean = useSettingsStore(
    (s) => s.settings.cleaner.closeBrowsersBeforeClean
  )
  const protectRecycleBin = useSettingsStore((s) => s.settings.cleaner.protectRecycleBin)
  const scannableCategories = protectRecycleBin
    ? scannerCategories.filter((c) => c.type !== CleanerType.RecycleBin)
    : scannerCategories
  const [showConfirm, setShowConfirm] = useState(false)
  const [blockers, setBlockers] = useState<CleanerBlocker[]>([])
  const [confirmBlockers, setConfirmBlockers] = useState<CleanerBlocker[]>([])
  const [checkingBlockers, setCheckingBlockers] = useState(false)
  const [preparingClean, setPreparingClean] = useState(false)
  const [openCategories, setOpenCategories] = useState<Set<CategoryType>>(new Set())
  const [openResults, setOpenResults] = useState<Set<string>>(new Set())
  const cleanStartRef = useRef<number>(0)
  const blockerRequestRef = useRef(0)
  const scopedBlockerRequestRef = useRef(0)
  const [sortMode, setSortMode] = useState<SizeSort>('default')
  const [contextMenu, setContextMenu] = useState<CleanerContextMenuState | null>(null)
  const [scopedClean, setScopedClean] = useState<{ ids: string[]; label: string } | null>(null)

  const cleanIndexRef = useRef(0)
  const cleanTotalRef = useRef(1)

  const { failedCategories, elevationSkipped } = store

  // Check the default selection after each scan. Selection changes are
  // revalidated when Clean is clicked, avoiding an OS query on every checkbox.
  useEffect(() => {
    if (
      platform !== 'win32' ||
      store.status !== ScanStatus.Complete ||
      store.cleanSummary ||
      store.selectedItems.size === 0 ||
      !window.kudu?.cleanerBlockers
    ) {
      setBlockers([])
      setCheckingBlockers(false)
      return
    }

    const requestId = ++blockerRequestRef.current
    let cancelled = false
    setCheckingBlockers(true)
    const timer = window.setTimeout(async () => {
      try {
        const result = await window.kudu.cleanerBlockers([...store.selectedItems])
        if (!cancelled && blockerRequestRef.current === requestId) setBlockers(result)
      } catch {
        if (!cancelled && blockerRequestRef.current === requestId) setBlockers([])
      } finally {
        if (!cancelled && blockerRequestRef.current === requestId) setCheckingBlockers(false)
      }
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [platform, store.status, store.cleanSummary])

  const handleRelaunch = useCallback(() => {
    window.kudu.elevationRelaunch()
  }, [])

  const handleScan = () => {
    setOpenCategories(new Set())
    setOpenResults(new Set())
    void startCleanerScan(
      scannableCategories.map((cat) => ({ type: cat.type, label: t(cat.labelKey) }))
    )
  }

  const handleCleanRequest = useCallback(
    async (scope?: { ids: string[]; label: string }) => {
      const selectedIds = scope?.ids ?? store.getSelectedIds()
      if (selectedIds.length === 0) return

      setScopedClean(scope ?? null)
      setPreparingClean(true)
      // Scoped requests track their own counter so they neither cancel the
      // page-wide blocker check nor overwrite its notice, which always describes
      // the globally selected items.
      const requestRef = scope ? scopedBlockerRequestRef : blockerRequestRef
      const requestId = ++requestRef.current
      let latest: CleanerBlocker[] = []
      try {
        if (platform === 'win32' && window.kudu?.cleanerBlockers) {
          latest = await window.kudu.cleanerBlockers(selectedIds)
        }
      } catch {
        // Advisory preflight failures must not prevent the confirmation dialog.
      } finally {
        if (requestRef.current === requestId) {
          if (!scope) {
            setBlockers(latest)
            setCheckingBlockers(false)
          }
          setConfirmBlockers(latest)
          setShowConfirm(true)
          setPreparingClean(false)
        }
      }
    },
    [platform]
  )

  const handleClean = useCallback(async () => {
    const shouldCloseDetectedBrowsers =
      closeBrowsersBeforeClean && confirmBlockers.some((blocker) => blocker.isBrowser)
    setShowConfirm(false)
    setConfirmBlockers([])
    store.setStatus(ScanStatus.Cleaning)
    cleanStartRef.current = Date.now()
    // Own the listener for the duration of the operation, not the page. The
    // cleanup and its progress continue when the user navigates elsewhere.
    const stopProgress = window.kudu.onScanProgress((data) => {
      if (data.phase !== 'cleaning') return
      const total = cleanTotalRef.current
      const base = (cleanIndexRef.current / total) * 100
      const slice = data.progress / total
      useScanStore.getState().setProgress({ ...data, progress: base + slice })
    })
    try {
      if (shouldCloseDetectedBrowsers) {
        try {
          await window.kudu.cleanerPrepareClean()
        } catch {
          // Browser closing is best-effort; individual cleaners still report
          // any files that remain locked.
        }
      }

      // Create a system restore point before cleaning if enabled
      if (createRestorePointEnabled) {
        try {
          const rpResult = await window.kudu.createRestorePoint(
            `SuperSonicCleaner clean — ${new Date().toLocaleString()}`
          )
          if (rpResult.success) {
            toast.success(t('toastRestorePointCreated'))
          } else {
            toast.warning(t('toastRestorePointSkipped'), { description: rpResult.error })
          }
        } catch {
          toast.warning(t('toastRestorePointSkipped'), {
            description: t('toastRestorePointSkippedDescription')
          })
        }
      }

      const selectedIds = scopedClean?.ids ?? store.getSelectedIds()
      setScopedClean(null)
      const selectedIdSet = new Set(selectedIds)
      const cleanFns: Partial<Record<CleanerType, (ids: string[]) => Promise<any>>> = {
        [CleanerType.System]: (ids) => window.kudu.systemClean(ids),
        [CleanerType.Browser]: (ids) => window.kudu.browserClean(ids),
        [CleanerType.App]: (ids) => window.kudu.appClean(ids),
        [CleanerType.Gaming]: (ids) => window.kudu.gamingClean(ids),
        [CleanerType.RecycleBin]: () => window.kudu.recycleBinClean(),
        [CleanerType.Shortcut]: (ids) => window.kudu.shortcutClean(ids),
        [CleanerType.Environment]: (ids) => window.kudu.environmentClean(ids),
        [CleanerType.Database]: (ids) => window.kudu.databaseClean(ids),
        [CleanerType.PrivacyTraces]: (ids) => window.kudu.privacyTracesClean(ids)
      }
      let totalCleaned = 0,
        totalFiles = 0,
        totalSkipped = 0,
        anyNeedsElevation = false
      const allErrors: { path: string; reason: string }[] = []
      const categoryBreakdown: Array<{
        name: string
        type: string
        found: number
        cleaned: number
        space: number
        skipped: number
      }> = []

      // Build the category plan once with O(1) selection lookups. Large scans
      // can hold tens of thousands of IDs, so repeatedly calling includes()
      // here made preparation quadratic. Reclaim the largest selections first
      // so protected system paths cannot delay all useful cleanup behind their
      // retry window.
      const categoryPlans = scannableCategories.map((cat) => {
        const catResults = store.results.filter((r) => r.category === cat.type)
        const catItemsAll = catResults.flatMap((r) => r.items)
        const selectedItems = catItemsAll.filter((item) => selectedIdSet.has(item.id))
        return {
          cat,
          catResults,
          catItemsAll,
          catItemIds: selectedItems.map((item) => item.id),
          selectedSize: selectedItems.reduce((sum, item) => sum + item.size, 0)
        }
      })
      const activePlans = categoryPlans
        .filter((plan) => plan.catItemIds.length > 0)
        .sort((a, b) => b.selectedSize - a.selectedSize)
      cleanTotalRef.current = Math.max(activePlans.length, 1)
      let activeIndex = 0

      store.setProgress({
        phase: 'cleaning',
        category: '',
        currentPath: '',
        progress: 0,
        itemsFound: 0,
        sizeFound: 0
      })

      for (const { cat, catResults, catItemIds } of activePlans) {
        cleanIndexRef.current = activeIndex
        // Some cleaners (notably the Windows Recycle Bin) perform one
        // blocking platform operation and therefore have no per-file
        // callbacks. Announce the category before invoking it so the UI
        // never leaves the previous cleaner's path and 100% progress on
        // screen while the next category is still working.
        store.setProgress({
          phase: 'cleaning',
          category: cat.type,
          currentPath: t(cat.labelKey),
          progress: (activeIndex / cleanTotalRef.current) * 100,
          itemsFound: catResults.reduce((sum, scan) => sum + scan.itemCount, 0),
          sizeFound: totalCleaned
        })
        try {
          const cleanFn = cleanFns[cat.type]
          if (!cleanFn) continue
          const cleaned = await cleanInBatches(catItemIds, cleanFn)
          const result = cleaned.result
          if (result.receiptSaved === false) toast.warning(t('history:receipts.saveError'))
          totalCleaned += result.totalCleaned
          totalFiles += result.filesDeleted
          totalSkipped += result.filesSkipped
          if (result.needsElevation) anyNeedsElevation = true
          if (result.errors.length) allErrors.push(...result.errors)
          if (cleaned.error) {
            const reason =
              cleaned.error instanceof Error ? cleaned.error.message : String(cleaned.error)
            allErrors.push({ path: t(cat.labelKey), reason })
          }
          categoryBreakdown.push({
            name: t(cat.labelKey),
            type: cat.type,
            found: catResults.reduce((sum, scan) => sum + scan.itemCount, 0),
            cleaned: result.filesDeleted,
            space: result.totalCleaned,
            skipped: result.filesSkipped
          })
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          allErrors.push({ path: t(cat.labelKey), reason })
          categoryBreakdown.push({
            name: t(cat.labelKey),
            type: cat.type,
            found: catResults.reduce((sum, scan) => sum + scan.itemCount, 0),
            cleaned: 0,
            space: 0,
            skipped: catItemIds.length
          })
        }
        activeIndex++
      }

      for (const { cat, catResults, catItemsAll, catItemIds } of categoryPlans) {
        if (catItemIds.length === 0 && catItemsAll.length > 0) {
          categoryBreakdown.push({
            name: t(cat.labelKey),
            type: cat.type,
            found: catResults.reduce((sum, scan) => sum + scan.itemCount, 0),
            cleaned: 0,
            space: 0,
            skipped: 0
          })
        }
      }

      const totalFound = store.results.reduce((s, r) => s + r.itemCount, 0)
      const duration = Date.now() - cleanStartRef.current
      await addHistoryEntry({
        id: Date.now().toString(),
        type: 'cleaner',
        timestamp: new Date().toISOString(),
        duration,
        // Window the deletion log by, so History can list the exact paths this
        // run removed across all the per-category clean calls above.
        cleanedFrom: new Date(cleanStartRef.current).toISOString(),
        cleanedTo: new Date().toISOString(),
        totalItemsFound: totalFound,
        totalItemsCleaned: totalFiles,
        totalItemsSkipped: totalSkipped,
        totalSpaceSaved: totalCleaned,
        categories: categoryBreakdown.map((d) => ({
          name: d.name,
          itemsFound: d.found,
          itemsCleaned: d.cleaned,
          spaceSaved: d.space
        })),
        errorCount: allErrors.length
      })

      store.setCleanSummary({
        totalCleaned,
        filesDeleted: totalFiles,
        filesSkipped: totalSkipped,
        errors: allErrors,
        needsElevation: anyNeedsElevation,
        categories: categoryBreakdown,
        duration,
        totalSizeBefore: store.getTotalSize(),
        completedAt: Date.now()
      })
      store.setStatus(ScanStatus.Complete)
    } catch {
      store.setStatus(ScanStatus.Error)
    } finally {
      stopProgress()
      store.setProgress(null)
    }
  }, [
    store.results,
    createRestorePointEnabled,
    protectRecycleBin,
    closeBrowsersBeforeClean,
    confirmBlockers,
    scopedClean
  ])

  const categoryResults = useCallback(
    (type: CategoryType) => {
      if (type === AI_TOOLS_VIEW) {
        return store.results.filter(
          (r) => r.category === CleanerType.App && r.group === AI_TOOLS_GROUP
        )
      }
      if (type === CleanerType.App) {
        return store.results.filter(
          (r) => r.category === CleanerType.App && r.group !== AI_TOOLS_GROUP
        )
      }
      return store.results.filter((r) => r.category === type)
    },
    [store.results]
  )

  const groups: CategoryGroup[] = useMemo(
    () =>
      categories
        .filter((c) => !(protectRecycleBin && c.type === CleanerType.RecycleBin))
        .map((def) => {
          const results = categoryResults(def.type)
          return {
            def,
            results,
            itemCount: results.reduce((sum, r) => sum + r.itemCount, 0),
            totalSize: results.reduce((sum, r) => sum + r.totalSize, 0),
            entries: entryTotal(results),
            recommended: isRecommendedGroup(results)
          }
        }),
    [categoryResults, protectRecycleBin]
  )
  const foundGroups = groups.filter((group) => group.results.length > 0)
  const emptyGroups = groups.filter((group) => group.results.length === 0)

  const totals = useMemo(
    () => selectionTotals(store.results, store.selectedItems),
    [store.results, store.selectedItems]
  )
  const selectedGroupCount = foundGroups.filter(
    (group) => selectionState(group.results, store.selectedItems) !== 'none'
  ).length

  // Privacy traces such as registry lists are counted in entries, not bytes.
  const entryCountLabel = (count: number) =>
    t(count === 1 ? 'traceEntryCount' : 'traceEntryCountPlural', { count: formatNumber(count) })

  // Native maintenance has no measurable size; a row made only of it says so, a row
  // that mixes it with files shows the measured bytes (the note explains the rest).
  const sizeLabel = (results: ScanResult[], totalSize: number) => {
    const maintenance = (r: ScanResult) => r.items.some((item) => item.cleanupAction)
    if (results.length > 0 && results.every(maintenance)) return t('maintenanceSizeUnknown')
    const entries = entryTotal(results)
    return entries !== null ? entryCountLabel(entries) : formatBytes(totalSize)
  }

  /** The first names and a count of the rest: "A, B, C, D e altre 38". */
  const shortList = (names: string[]) => {
    const shown = names.slice(0, 4)
    if (names.length > shown.length)
      shown.push(t('moreApps', { count: names.length - shown.length }))
    return formatList(shown, i18n.language)
  }

  const groupLabel = (group: string) =>
    GROUP_LABEL_KEYS[group] ? t(GROUP_LABEL_KEYS[group]) : group

  const resultNote = (result: ScanResult) => {
    const action = result.items[0]?.cleanupAction
    if (action)
      return action === 'windows-components'
        ? t('maintenanceComponentsNote')
        : t('maintenanceNativeNote')
    if (result.descriptionKey) return t(result.descriptionKey)
    if (!result.items.every(isSafeDefault)) return t('optionalNote')
    return ''
  }

  const toggleGroupSelection = (results: ScanResult[]) => {
    const isAll = (result: ScanResult) =>
      result.items.every((item) => store.selectedItems.has(item.id))
    const allSelected = results.every(isAll)
    for (const result of results) {
      if (allSelected === isAll(result)) store.toggleSubcategory(result)
    }
  }

  const toggleOpenCategory = (type: CategoryType) =>
    setOpenCategories((previous) => {
      const next = new Set(previous)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })

  const toggleOpenResult = (key: string) =>
    setOpenResults((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const isScanning = store.status === ScanStatus.Scanning
  const isCleaning = store.status === ScanStatus.Cleaning
  const hasResults = store.results.length > 0
  const showReceipt = !!store.cleanSummary && store.status === ScanStatus.Complete
  const showResults = hasResults && !showReceipt && !isCleaning
  const settled = !isScanning && !isCleaning
  const confirmCleanIds = scopedClean?.ids ?? store.getSelectedIds()
  const confirmCleanSize = scopedClean ? sizeForIds(store.results, scopedClean.ids) : totals.size
  const confirmNames = scopedClean
    ? [scopedClean.label]
    : foundGroups
        .filter((group) => selectionState(group.results, store.selectedItems) !== 'none')
        .map((group) => t(group.def.labelKey))

  const openContextMenu = useCallback(
    (event: React.MouseEvent, label: string, ids: string[]) => {
      if (!hasResults || isScanning || isCleaning || preparingClean || ids.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      setContextMenu({ x: event.clientX, y: event.clientY, label, ids })
    },
    [hasResults, isScanning, isCleaning, preparingClean]
  )

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const handleContextMenuClean = useCallback(() => {
    if (!contextMenu) return
    const { ids, label } = contextMenu
    closeContextMenu()
    void handleCleanRequest({ ids, label })
  }, [contextMenu, closeContextMenu, handleCleanRequest])

  const lastClean = useMemo(() => latestEntry(historyEntries, 'cleaner'), [historyEntries])
  const scannedAtText = store.scannedAt ? formatTime(store.scannedAt, i18n.language) : ''

  const cleanLabel =
    totals.size > 0
      ? t('cleanSize', { size: formatBytes(totals.size) })
      : totals.count > 0
        ? t('cleanItems', { count: totals.count, n: formatNumber(totals.count) })
        : t('cleanButton')

  const headerAction =
    showResults && settled ? (
      <Button variant="ghost" onClick={handleScan} disabled={preparingClean}>
        {t('rescanButton')}
      </Button>
    ) : (
      <Button
        variant="primary"
        size="lg"
        onClick={handleScan}
        busy={isScanning}
        disabled={isCleaning || preparingClean}
      >
        {t('scanButton')}
      </Button>
    )

  // Warnings about the scan just finished. They stay neutral (icon and text): a category
  // that did not run is not a threat, and red is kept for failed deletions.
  const notices: ReactElement[] = []
  if (settled && !store.cleanSummary) {
    if (!checkingBlockers && blockers.length > 0)
      notices.push(
        <ReportNotice
          key="blockers"
          title={t('closeAppsBeforeCleaning', {
            apps: shortList(blockers.map((blocker) => blocker.name))
          })}
          detail={
            closeBrowsersBeforeClean && blockers.every((blocker) => blocker.isBrowser)
              ? t('blockersAutoCloseDescription')
              : t('blockersDescription')
          }
        />
      )
    if (elevationSkipped.length > 0)
      notices.push(
        <ReportNotice
          key="elevation"
          title={t('categoriesNotScanned', { count: elevationSkipped.length })}
          detail={shortList(elevationSkipped)}
          action={
            platform !== 'darwin' ? (
              <Button onClick={handleRelaunch}>{t('relaunchAsAdmin')}</Button>
            ) : undefined
          }
        />
      )
    if (failedCategories.length > 0 && store.status === ScanStatus.Complete)
      notices.push(
        <ReportNotice
          key="failed"
          title={t('scannersFailed', { list: shortList(failedCategories) })}
        />
      )
  }

  const SortIcon =
    sortMode === 'size-desc' ? ArrowDown : sortMode === 'size-asc' ? ArrowUp : ArrowUpDown
  const sortLabel =
    sortMode === 'size-desc'
      ? t('sortSizeDesc')
      : sortMode === 'size-asc'
        ? t('sortSizeAsc')
        : t('sortDefault')

  const blockSize = (results: ScanResult[]) => {
    const size = results.reduce((sum, r) => sum + r.totalSize, 0)
    return size > 0 ? ` · ${formatBytes(size)}` : ''
  }

  const renderResultRows = (group: CategoryGroup) => {
    // Ungrouped results first, then one block per scanner group; each block is sorted on
    // its own so a sort never interleaves groups. AI tools are one group already.
    const flat = group.def.type === AI_TOOLS_VIEW
    const ungrouped = sortBySize(
      flat ? group.results : group.results.filter((r) => !r.group),
      sortMode,
      (r) => r.totalSize
    )
    const blocks: { label?: string; results: ScanResult[] }[] = []
    if (ungrouped.length > 0) blocks.push({ results: ungrouped })
    if (!flat) {
      const grouped = new Map<string, ScanResult[]>()
      for (const result of group.results) {
        if (!result.group) continue
        grouped.set(result.group, [...(grouped.get(result.group) ?? []), result])
      }
      for (const [label, results] of grouped)
        blocks.push({ label, results: sortBySize(results, sortMode, (r) => r.totalSize) })
    }
    const privacy = group.def.type === CleanerType.PrivacyTraces

    return blocks.map((block) => (
      <Fragment key={block.label ?? '_ungrouped'}>
        {block.label && (
          <tr className="pulizia-group-row">
            <td />
            <td colSpan={4}>
              {groupLabel(block.label)}
              {blockSize(block.results)}
            </td>
          </tr>
        )}
        {block.results.map((result) => {
          const key = `${result.category}:${result.group ?? ''}:${result.subcategory}`
          const open = openResults.has(key)
          const state = selectionState([result], store.selectedItems)
          const firstPath = result.items[0]?.path
          const note = resultNote(result)
          return (
            <Fragment key={key}>
              <TableRow
                data-level="sub"
                selected={state === 'all'}
                onContextMenu={(e) => {
                  // The quick-clean menu would clear traces without selecting them.
                  if (privacy) return
                  openContextMenu(
                    e,
                    result.subcategory,
                    result.items.map((item) => item.id)
                  )
                }}
              >
                <TableCell className="pulizia-check">
                  <Checkbox
                    checked={state === 'all'}
                    indeterminate={state === 'some'}
                    onChange={() => store.toggleSubcategory(result)}
                    label={t('selectRow', { name: result.subcategory })}
                  />
                </TableCell>
                <TableCell className="pulizia-name pulizia-sub">
                  <span className="pulizia-name-line">
                    <button
                      type="button"
                      className="pulizia-disclosure"
                      aria-expanded={open}
                      onClick={() => toggleOpenResult(key)}
                    >
                      <ChevronRight
                        className="pulizia-chevron"
                        size={14}
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      <span>{result.subcategory}</span>
                    </button>
                    {firstPath && isAbsolutePath(firstPath) && (
                      <button
                        type="button"
                        className="pulizia-icon-button"
                        title={t('openLocation')}
                        aria-label={t('openLocation')}
                        onClick={() => window.kudu?.cleanerOpenLocation?.(firstPath)}
                      >
                        <FolderOpen size={14} strokeWidth={1.75} aria-hidden="true" />
                      </button>
                    )}
                  </span>
                </TableCell>
                <TableCell numeric>{formatNumber(result.itemCount)}</TableCell>
                <TableCell numeric>{sizeLabel([result], result.totalSize)}</TableCell>
                <TableCell muted className="pulizia-note">
                  {note}
                </TableCell>
              </TableRow>
              {open && renderItemRows(result)}
            </Fragment>
          )
        })}
      </Fragment>
    ))
  }

  const renderItemRows = (result: ScanResult) => (
    <>
      {result.items.slice(0, ITEMS_SHOWN).map((item: ScanItem) => {
        const checked = store.selectedItems.has(item.id)
        const pathLabel = item.path.split(/[/\\]/).slice(-2).join('/') || item.path
        const label = item.cleanupAction ? t('maintenanceOptional') : pathLabel
        return (
          <TableRow key={item.id} data-level="item" selected={checked}>
            <TableCell className="pulizia-check">
              <Checkbox
                checked={checked}
                onChange={() => store.toggleItem(item.id)}
                label={t('selectRow', { name: label })}
              />
            </TableCell>
            <TableCell className="pulizia-name pulizia-item">
              <span className="pulizia-name-line">
                <span className="pulizia-path" title={item.path}>
                  {label}
                </span>
                {isAbsolutePath(item.path) && (
                  <button
                    type="button"
                    className="pulizia-icon-button"
                    title={t('openLocation')}
                    aria-label={t('openLocation')}
                    onClick={() => window.kudu?.cleanerOpenLocation?.(item.path)}
                  >
                    <FolderOpen size={14} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                )}
              </span>
            </TableCell>
            <TableCell numeric />
            <TableCell numeric>
              {item.cleanupAction
                ? t('maintenanceSizeUnknown')
                : item.entryCount !== undefined
                  ? entryCountLabel(item.entryCount)
                  : formatBytes(item.size)}
            </TableCell>
            <TableCell muted className="pulizia-note" />
          </TableRow>
        )
      })}
      {result.items.length > ITEMS_SHOWN && (
        <tr className="pulizia-group-row">
          <td />
          <td colSpan={4} className="pulizia-item">
            {t('moreItems', { count: formatNumber(result.items.length - ITEMS_SHOWN) })}
          </td>
        </tr>
      )}
    </>
  )

  return (
    <div className="pulizia-page">
      <PageHeader title={t('pageTitle')} description={t('pageDescription')} action={headerAction} />

      <CleanerProgress scanCategories={scannableCategories} />

      {showReceipt && store.cleanSummary && (
        <CleanSummary
          summary={store.cleanSummary}
          onRelaunchAsAdmin={handleRelaunch}
          platform={platform}
        />
      )}

      {!hasResults && !isScanning && !isCleaning && store.status !== ScanStatus.Complete && (
        <EmptyState
          title={t('emptyTitle')}
          description={
            lastClean
              ? t('emptyLastClean', {
                  date: formatDateTime(lastClean.timestamp, i18n.language),
                  size: formatBytes(lastClean.totalSpaceSaved)
                })
              : t('emptyNoClean')
          }
          action={
            lastClean ? (
              <Button onClick={() => navigate('/history?view=receipts')}>{t('viewReceipt')}</Button>
            ) : undefined
          }
          checks={categories.map((c) => ({
            title: t(c.labelKey),
            detail:
              c.type === CleanerType.RecycleBin && protectRecycleBin
                ? t('recycleBinProtected')
                : t(c.descriptionKey)
          }))}
        />
      )}

      {!hasResults && store.status === ScanStatus.Complete && !showReceipt && (
        <Card className="pulizia-summary">
          <div className="pulizia-summary-text">
            <p className="pulizia-summary-value">{t('nothingFoundTitle')}</p>
            {scannedAtText && (
              <p className="pulizia-summary-meta">
                {t('nothingFoundDescription', { time: scannedAtText })}
              </p>
            )}
          </div>
          {notices.length > 0 && <ul className="pulizia-notices">{notices}</ul>}
        </Card>
      )}

      {showResults && settled && (
        <Card as="section" className="pulizia-summary" aria-label={t('pageTitle')}>
          <div className="pulizia-summary-main">
            <div className="pulizia-summary-text">
              <p className="pulizia-summary-value">
                {totals.size > 0
                  ? t('summarySelected', { size: formatBytes(totals.size) })
                  : totals.count > 0
                    ? t('summarySelectedItems', {
                        count: totals.count,
                        n: formatNumber(totals.count)
                      })
                    : t('summaryNothingSelected')}
              </p>
              {totals.count > 0 && (
                <p className="pulizia-summary-meta">
                  {t('summaryMeta', {
                    items: t('summaryItems', {
                      count: totals.count,
                      n: formatNumber(totals.count)
                    }),
                    categories: t('summaryCategories', { count: selectedGroupCount }),
                    time: scannedAtText
                  })}
                </p>
              )}
            </div>
            <Button
              variant="primary"
              size="lg"
              onClick={() => void handleCleanRequest()}
              busy={preparingClean || checkingBlockers}
              disabled={totals.count === 0}
            >
              {cleanLabel}
            </Button>
          </div>
          {notices.length > 0 && <ul className="pulizia-notices">{notices}</ul>}
        </Card>
      )}

      {showResults && (
        <Card className="pulizia-table-card">
          <Table className="pulizia-table">
            <TableHead>
              <TableHeaderCell className="pulizia-check">
                <span className="sr-only">{t('columnSelect')}</span>
              </TableHeaderCell>
              <TableHeaderCell>{t('columnCategory')}</TableHeaderCell>
              <TableHeaderCell numeric>{t('columnItems')}</TableHeaderCell>
              <TableHeaderCell
                numeric
                aria-sort={
                  sortMode === 'size-desc'
                    ? 'descending'
                    : sortMode === 'size-asc'
                      ? 'ascending'
                      : 'none'
                }
              >
                <button
                  type="button"
                  className="pulizia-sort"
                  title={sortLabel}
                  onClick={() => setSortMode(nextSizeSort(sortMode))}
                >
                  {t('columnSize')}
                  <SortIcon size={12} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </TableHeaderCell>
              <TableHeaderCell>{t('columnNote')}</TableHeaderCell>
            </TableHead>
            <tbody>
              {sortBySize(foundGroups, sortMode, (group) => group.totalSize).map((group) => {
                const state = selectionState(group.results, store.selectedItems)
                const open = openCategories.has(group.def.type)
                const label = t(group.def.labelKey)
                // Privacy traces are opted into group by group: no select-everything.
                const privacy = group.def.type === CleanerType.PrivacyTraces
                return (
                  <Fragment key={group.def.type}>
                    <TableRow
                      recommended={group.recommended}
                      selected={state === 'all'}
                      onContextMenu={(e) => {
                        if (privacy) return
                        openContextMenu(
                          e,
                          label,
                          group.results.flatMap((r) => r.items.map((item) => item.id))
                        )
                      }}
                    >
                      <TableCell className="pulizia-check">
                        {!privacy && (
                          <Checkbox
                            checked={state === 'all'}
                            indeterminate={state === 'some'}
                            onChange={() => toggleGroupSelection(group.results)}
                            label={t('selectRow', { name: label })}
                          />
                        )}
                      </TableCell>
                      <TableCell className="pulizia-name">
                        <span className="pulizia-name-line">
                          <button
                            type="button"
                            className="pulizia-disclosure"
                            aria-expanded={open}
                            onClick={() => toggleOpenCategory(group.def.type)}
                          >
                            <ChevronRight
                              className="pulizia-chevron"
                              size={14}
                              strokeWidth={1.75}
                              aria-hidden="true"
                            />
                            <span>{label}</span>
                          </button>
                          {group.recommended && (
                            <Tag tone="recommended">
                              <span aria-hidden="true">· </span>
                              {t('recommended')}
                            </Tag>
                          )}
                        </span>
                      </TableCell>
                      <TableCell numeric>{formatNumber(group.itemCount)}</TableCell>
                      <TableCell numeric>{sizeLabel(group.results, group.totalSize)}</TableCell>
                      <TableCell muted className="pulizia-note">
                        {t(group.def.descriptionKey)}
                      </TableCell>
                    </TableRow>
                    {open && renderResultRows(group)}
                  </Fragment>
                )
              })}
            </tbody>
          </Table>
          {settled && (emptyGroups.length > 0 || protectRecycleBin) && (
            <p className="pulizia-footnote">
              {emptyGroups.length > 0 &&
                t('emptyCategories', {
                  list: formatList(
                    emptyGroups.map((group) => t(group.def.labelKey)),
                    i18n.language
                  )
                })}
              {emptyGroups.length > 0 && protectRecycleBin && ' '}
              {protectRecycleBin && (
                <>
                  {t('recycleBinProtectedNote')}{' '}
                  <button
                    type="button"
                    className="pulizia-link"
                    onClick={() => navigate('/settings')}
                  >
                    {t('settings:sectionCleaningPreferences')}
                  </button>
                </>
              )}
            </p>
          )}
        </Card>
      )}

      {showResults && settled && (
        <AiAnalysisPanel
          source="cleaner"
          sourceRevision={store.results}
          candidates={store.results
            .filter((result) => result.category !== CleanerType.PrivacyTraces)
            .flatMap((result) => result.items)
            .filter((item) => !item.cleanupAction && !item.dockerTarget)
            .map((item) => ({
              path: item.path,
              size: item.size,
              lastModified: item.lastModified,
              lastAccessed: item.lastAccessed
            }))}
        />
      )}

      <ConfirmDialog
        open={showConfirm}
        onConfirm={handleClean}
        onCancel={() => {
          setShowConfirm(false)
          setConfirmBlockers([])
          setScopedClean(null)
        }}
        title={
          scopedClean
            ? t('confirmScopedTitle', {
                name: scopedClean.label,
                size: formatBytes(confirmCleanSize)
              })
            : t('confirmTitle', {
                count: confirmCleanIds.length,
                n: formatNumber(confirmCleanIds.length),
                size: formatBytes(confirmCleanSize)
              })
        }
        description={[
          t('confirmScope', { list: formatList(confirmNames, i18n.language) }),
          t('confirmLimits'),
          confirmBlockers.length > 0
            ? t('confirmCloseApps', {
                apps: shortList(confirmBlockers.map((blocker) => blocker.name))
              })
            : ''
        ]
          .filter(Boolean)
          .join(' ')}
        confirmLabel={
          confirmCleanSize > 0
            ? t('confirmDelete', { size: formatBytes(confirmCleanSize) })
            : t('confirmDeleteItems', {
                count: confirmCleanIds.length,
                n: formatNumber(confirmCleanIds.length)
              })
        }
        variant="danger"
      />

      {contextMenu && (
        <CleanerContextMenu
          menu={contextMenu}
          size={sizeForIds(store.results, contextMenu.ids)}
          onClean={handleContextMenuClean}
          onClose={closeContextMenu}
          cleanLabel={t('contextMenuClean', { name: contextMenu.label })}
        />
      )}
    </div>
  )
}
