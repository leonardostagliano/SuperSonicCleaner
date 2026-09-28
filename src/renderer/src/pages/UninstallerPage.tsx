import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { ArrowUpDown, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { AppIcon } from '@/components/shared/AppIcon'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Receipt } from '@/components/shared/Receipt'
import { Button, Card, Checkbox, ListRow, Segmented, Tag } from '@/components/ui'
import {
  MenuButton,
  ProgressCard,
  SearchField,
  SummaryCard
} from '@/components/software/SoftwareBlocks'
import { joinFacts } from '@/components/software/format'
import { useHistoryStore } from '@/stores/history-store'
import { useStatsStore } from '@/stores/stats-store'
import { useUninstallerStore, UNUSED_THRESHOLD_DAYS } from '@/stores/uninstaller-store'
import { icons } from '@/lib/icons'
import { formatBytes, NO_VALUE } from '@/lib/utils'
import type { InstalledProgram } from '@shared/types'

function formatDate(raw: string): string {
  if (!raw || raw.length !== 8) return ''
  const year = raw.substring(0, 4)
  const month = raw.substring(4, 6)
  const day = raw.substring(6, 8)
  return `${year}-${month}-${day}`
}

const UNUSED_THRESHOLD_MS = UNUSED_THRESHOLD_DAYS * 24 * 60 * 60 * 1000

function isUnused(prog: InstalledProgram): boolean {
  if (prog.lastUsed === -1) return false // unknown (Prefetch unavailable)
  if (prog.lastUsed === 0) return true // Prefetch available but never seen
  return Date.now() - prog.lastUsed > UNUSED_THRESHOLD_MS
}

function formatLastUsed(ts: number, t: TFunction): string {
  if (ts <= 0) return t('lastUsedNeverDetected')
  const days = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000))
  if (days === 0) return t('lastUsedToday')
  if (days === 1) return t('lastUsedYesterday')
  if (days < 30) return t('lastUsedDaysAgo', { count: days })
  const months = Math.floor(days / 30)
  if (months < 12) return t('lastUsedMonthsAgo', { count: months })
  const years = Math.floor(months / 12)
  return t('lastUsedYearsAgo', { count: years })
}

type SortField = 'displayName' | 'estimatedSize' | 'installDate' | 'publisher'
type FilterMode = 'all' | 'unused'

const SORT_LABEL_KEYS: Record<SortField, string> = {
  displayName: 'sortByName',
  estimatedSize: 'sortBySize',
  installDate: 'sortByDate',
  publisher: 'sortByPublisher'
}

/** Rows off screen skip layout: a two-line row is 37.5 px high (content box). */
const ROW_CLASS = '[content-visibility:auto] [contain-intrinsic-size:auto_38px]'

export function UninstallerPage() {
  const { t } = useTranslation('uninstaller')
  const programs = useUninstallerStore((s) => s.programs)
  const loading = useUninstallerStore((s) => s.loading)
  const uninstalling = useUninstallerStore((s) => s.uninstalling)
  const progress = useUninstallerStore((s) => s.progress)
  const uninstallResult = useUninstallerStore((s) => s.uninstallResult)
  const error = useUninstallerStore((s) => s.error)
  const hasLoaded = useUninstallerStore((s) => s.hasLoaded)
  const searchQuery = useUninstallerStore((s) => s.searchQuery)
  const sortField = useUninstallerStore((s) => s.sortField)
  const sortDirection = useUninstallerStore((s) => s.sortDirection)
  const filterMode = useUninstallerStore((s) => s.filterMode)

  const selectedIds = useUninstallerStore((s) => s.selectedIds)

  const [confirmProgram, setConfirmProgram] = useState<InstalledProgram | null>(null)
  const [confirmForceRemove, setConfirmForceRemove] = useState<InstalledProgram | null>(null)
  const [confirmBatch, setConfirmBatch] = useState(false)
  const uninstallStartRef = useRef<number>(0)
  const lastFailedProgramRef = useRef<InstalledProgram | null>(null)
  const historyStore = useHistoryStore()
  const recomputeStats = useStatsStore((s) => s.recompute)

  // Auto-load on first visit
  useEffect(() => {
    if (!hasLoaded && !loading) handleLoad()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Load programs ─────────────────────────────────────────
  const handleLoad = useCallback(async () => {
    const store = useUninstallerStore.getState()
    store.setLoading(true)
    store.setError(null)
    store.setUninstallResult(null)

    try {
      const result = await window.kudu.uninstallerList()
      const s = useUninstallerStore.getState()
      s.setPrograms(result.programs)
      s.setHasLoaded(true)
    } catch (err) {
      console.error('Failed to list programs:', err)
      toast.error(t('failedToLoadToast'))
      useUninstallerStore.getState().setError(t('failedToLoadError'))
    } finally {
      useUninstallerStore.getState().setLoading(false)
    }
  }, [])

  // ─── Uninstall a program ──────────────────────────────────
  const handleUninstall = useCallback(async () => {
    if (!confirmProgram) return
    const program = confirmProgram
    setConfirmProgram(null)

    const store = useUninstallerStore.getState()
    store.setUninstalling(true)
    store.setUninstallResult(null)
    store.setError(null)
    store.setProgress(null)
    uninstallStartRef.current = Date.now()
    lastFailedProgramRef.current = program

    try {
      const result = await window.kudu.uninstallerUninstall(program.id)
      const s = useUninstallerStore.getState()
      s.setUninstallResult(result)
      s.setProgress(null)

      if (result.success) {
        lastFailedProgramRef.current = null
        // Remove from list
        s.removeProgram(program.id)

        // Record in history if leftovers were cleaned
        if (result.leftoversCleaned > 0) {
          await historyStore.addEntry({
            id: Date.now().toString(),
            type: 'cleaner',
            timestamp: new Date().toISOString(),
            duration: Date.now() - uninstallStartRef.current,
            totalItemsFound: result.leftoversFound,
            totalItemsCleaned: result.leftoversCleaned,
            totalItemsSkipped: result.leftoversFound - result.leftoversCleaned,
            totalSpaceSaved: result.leftoversSize,
            categories: [
              {
                name: `Uninstall: ${result.programName}`,
                itemsFound: result.leftoversFound,
                itemsCleaned: result.leftoversCleaned,
                spaceSaved: result.leftoversSize
              }
            ],
            errorCount: 0
          })
          recomputeStats()
        }
      }
    } catch (err) {
      console.error('Uninstall failed:', err)
      toast.error(t('uninstallFailedToast'))
      useUninstallerStore.getState().setError(t('uninstallFailedError'))
    } finally {
      useUninstallerStore.getState().setUninstalling(false)
    }
  }, [confirmProgram, historyStore, recomputeStats])

  // ─── Batch uninstall selected programs ─────────────────────
  const handleBatchUninstall = useCallback(async () => {
    setConfirmBatch(false)
    const store = useUninstallerStore.getState()
    const toUninstall = store.programs.filter((p) => store.selectedIds.has(p.id))
    if (toUninstall.length === 0) return

    store.setUninstalling(true)
    store.setUninstallResult(null)
    store.setError(null)
    store.setProgress(null)
    uninstallStartRef.current = Date.now()
    lastFailedProgramRef.current = null

    let successCount = 0
    let failCount = 0
    let totalLeftoversCleaned = 0
    let totalLeftoversSize = 0

    for (const program of toUninstall) {
      try {
        const result = await window.kudu.uninstallerUninstall(program.id)
        const s = useUninstallerStore.getState()

        if (result.success) {
          successCount++
          s.removeProgram(program.id)
          totalLeftoversCleaned += result.leftoversCleaned
          totalLeftoversSize += result.leftoversSize

          if (result.leftoversCleaned > 0) {
            await historyStore.addEntry({
              id: Date.now().toString(),
              type: 'cleaner',
              timestamp: new Date().toISOString(),
              duration: Date.now() - uninstallStartRef.current,
              totalItemsFound: result.leftoversFound,
              totalItemsCleaned: result.leftoversCleaned,
              totalItemsSkipped: result.leftoversFound - result.leftoversCleaned,
              totalSpaceSaved: result.leftoversSize,
              categories: [
                {
                  name: `Uninstall: ${result.programName}`,
                  itemsFound: result.leftoversFound,
                  itemsCleaned: result.leftoversCleaned,
                  spaceSaved: result.leftoversSize
                }
              ],
              errorCount: 0
            })
          }
        } else {
          failCount++
        }
      } catch {
        failCount++
      }
    }

    const s = useUninstallerStore.getState()
    s.clearSelected()
    s.setProgress(null)
    s.setUninstalling(false)

    if (failCount === 0) {
      s.setUninstallResult({
        success: true,
        programName:
          successCount !== 1
            ? t('batchResultProgramsPlural', { count: successCount })
            : t('batchResultProgramsSingular', { count: successCount }),
        exitCode: null,
        leftoversFound: totalLeftoversCleaned,
        leftoversCleaned: totalLeftoversCleaned,
        leftoversSize: totalLeftoversSize
      })
    } else {
      s.setUninstallResult({
        success: successCount > 0,
        programName:
          successCount + failCount !== 1
            ? t('batchResultProgramsPlural', { count: successCount + failCount })
            : t('batchResultProgramsSingular', { count: successCount + failCount }),
        exitCode: null,
        error: t('batchResultFailedSucceeded', { failed: failCount, succeeded: successCount }),
        leftoversFound: totalLeftoversCleaned,
        leftoversCleaned: totalLeftoversCleaned,
        leftoversSize: totalLeftoversSize
      })
    }

    if (successCount > 0) recomputeStats()
  }, [historyStore, recomputeStats])

  // ─── Force remove a program ─────────────────────────────
  const handleForceRemove = useCallback(async () => {
    if (!confirmForceRemove) return
    const program = confirmForceRemove
    setConfirmForceRemove(null)

    const store = useUninstallerStore.getState()
    store.setUninstalling(true)
    store.setUninstallResult(null)
    store.setError(null)
    store.setProgress(null)
    uninstallStartRef.current = Date.now()

    try {
      const result = await window.kudu.uninstallerForceRemove(program.id)
      const s = useUninstallerStore.getState()
      s.setUninstallResult(result)
      s.setProgress(null)

      if (result.success) {
        lastFailedProgramRef.current = null
        s.removeProgram(program.id)

        if (result.leftoversCleaned > 0) {
          await historyStore.addEntry({
            id: Date.now().toString(),
            type: 'cleaner',
            timestamp: new Date().toISOString(),
            duration: Date.now() - uninstallStartRef.current,
            totalItemsFound: result.leftoversFound,
            totalItemsCleaned: result.leftoversCleaned,
            totalItemsSkipped: result.leftoversFound - result.leftoversCleaned,
            totalSpaceSaved: result.leftoversSize,
            categories: [
              {
                name: `Force Remove: ${result.programName}`,
                itemsFound: result.leftoversFound,
                itemsCleaned: result.leftoversCleaned,
                spaceSaved: result.leftoversSize
              }
            ],
            errorCount: 0
          })
          recomputeStats()
        }
      }
    } catch (err) {
      console.error('Force remove failed:', err)
      toast.error(t('uninstallFailedToast'))
      useUninstallerStore.getState().setError(t('uninstallFailedError'))
    } finally {
      useUninstallerStore.getState().setUninstalling(false)
    }
  }, [confirmForceRemove, historyStore, recomputeStats])

  // ─── Filtered & sorted list ───────────────────────────────
  const filteredPrograms = useMemo(() => {
    let list = programs

    // Filter by unused
    if (filterMode === 'unused') {
      list = list.filter(isUnused)
    }

    // Filter by search
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (p) => p.displayName.toLowerCase().includes(q) || p.publisher.toLowerCase().includes(q)
      )
    }

    const dir = sortDirection === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      switch (sortField) {
        case 'estimatedSize':
          return (a.estimatedSize - b.estimatedSize) * dir
        case 'installDate':
          return a.installDate.localeCompare(b.installDate) * dir
        case 'publisher':
          return a.publisher.localeCompare(b.publisher) * dir
        default:
          return a.displayName.localeCompare(b.displayName) * dir
      }
    })
  }, [programs, searchQuery, sortField, sortDirection, filterMode])

  // Unused stats — only meaningful when Prefetch data is available
  const hasPrefetchData = useMemo(() => programs.some((p) => p.lastUsed !== -1), [programs])
  const unusedPrograms = useMemo(() => programs.filter(isUnused), [programs])
  const unusedTotalSize = useMemo(
    () => unusedPrograms.reduce((sum, p) => sum + p.estimatedSize, 0),
    [unusedPrograms]
  )

  const selectedCount = selectedIds.size
  const filteredSelected = filteredPrograms.filter((p) => selectedIds.has(p.id)).length
  const allFilteredSelected =
    filteredPrograms.length > 0 && filteredSelected === filteredPrograms.length
  const failedProgram = lastFailedProgramRef.current

  const progressTitle = progress
    ? progress.phase === 'uninstalling'
      ? t('progressUninstalling', { programName: progress.currentProgram })
      : progress.phase === 'force-removing'
        ? t('progressForceRemoving', { programName: progress.currentProgram })
        : progress.phase === 'scanning-leftovers'
          ? t('progressScanningLeftovers')
          : progress.phase === 'cleaning-leftovers'
            ? t('progressCleaningLeftovers')
            : t('progressLoading')
    : ''

  return (
    <div>
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <Button icon={RefreshCw} busy={loading} disabled={uninstalling} onClick={handleLoad}>
            {hasLoaded ? t('refresh') : t('loadPrograms')}
          </Button>
        }
      />

      <div className="sw-page">
        {error && (
          <ErrorAlert
            message={error}
            onDismiss={() => useUninstallerStore.getState().setError(null)}
          />
        )}

        {uninstalling && progress && (
          <ProgressCard
            title={progressTitle}
            meta={`${progress.progress}%`}
            value={progress.progress / 100}
            detail={
              progress.phase === 'scanning-leftovers' || progress.phase === 'cleaning-leftovers'
                ? progress.currentProgram
                : undefined
            }
          />
        )}

        {/* What the last uninstall did */}
        {uninstallResult && uninstallResult.success && (
          <Receipt
            title={t('receiptTitle')}
            value={
              uninstallResult.leftoversSize > 0
                ? t('receiptFreed', { size: formatBytes(uninstallResult.leftoversSize) })
                : undefined
            }
            facts={[
              uninstallResult.programName,
              uninstallResult.leftoversCleaned > 0
                ? t('receiptLeftovers', { count: uninstallResult.leftoversCleaned })
                : uninstallResult.leftoversFound === 0
                  ? t('receiptNoLeftovers')
                  : '',
              t('notReversible')
            ]}
            skipped={uninstallResult.error}
          />
        )}
        {uninstallResult && !uninstallResult.success && (
          <Card className="sw-note">
            <icons.warning
              className="sw-note-icon sw-danger-text"
              size={16}
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <div className="sw-note-body" role="alert">
              <p className="sw-note-title">
                {t('failedTitle', { programName: uninstallResult.programName })}
              </p>
              {uninstallResult.error && <p className="sw-note-text">{uninstallResult.error}</p>}
            </div>
            {failedProgram && failedProgram.registryKey && (
              <div className="sw-note-aside">
                <Button
                  onClick={() => setConfirmForceRemove(failedProgram)}
                  disabled={uninstalling}
                >
                  {t('forceRemoveButton')}
                </Button>
              </div>
            )}
          </Card>
        )}

        {/* Before the list is loaded: the real state and what the list reads */}
        {!hasLoaded && !loading && (
          <EmptyState
            title={t('emptyStateTitle')}
            description={t('emptyStateDescription')}
            checks={[
              { title: t('checkRegistryTitle'), detail: t('checkRegistryDetail') },
              { title: t('checkUsageTitle'), detail: t('checkUsageDetail') },
              { title: t('checkLeftoversTitle'), detail: t('checkLeftoversDetail') }
            ]}
          />
        )}

        {loading && <ProgressCard title={t('loadingInstalledPrograms')} />}

        {hasLoaded && !loading && programs.length === 0 && (
          <EmptyState title={t('noInstalledProgramsFound')} />
        )}

        {/* One summary line; unused programs are what the page suggests reviewing */}
        {hasLoaded && !loading && programs.length > 0 && (
          <SummaryCard
            title={t('summaryTitle', { count: programs.length })}
            detail={
              hasPrefetchData && unusedPrograms.length > 0
                ? unusedTotalSize > 0
                  ? t('summaryUnused', {
                      count: unusedPrograms.length,
                      days: UNUSED_THRESHOLD_DAYS,
                      size: formatBytes(unusedTotalSize)
                    })
                  : t('summaryUnusedNoSize', {
                      count: unusedPrograms.length,
                      days: UNUSED_THRESHOLD_DAYS
                    })
                : undefined
            }
            action={
              <Button
                variant="primary"
                icon={icons.uninstall}
                disabled={selectedCount === 0 || uninstalling}
                onClick={() => setConfirmBatch(true)}
              >
                {selectedCount > 0
                  ? t('uninstallSelected', { count: selectedCount })
                  : t('uninstallNone')}
              </Button>
            }
          />
        )}

        {hasLoaded && !loading && programs.length > 0 && (
          <Card className="sw-list">
            <div className="sw-toolbar">
              <label className="sw-select-all">
                <Checkbox
                  checked={allFilteredSelected}
                  indeterminate={filteredSelected > 0 && !allFilteredSelected}
                  onChange={(value) => {
                    const store = useUninstallerStore.getState()
                    if (value) store.selectAll(filteredPrograms.map((p) => p.id))
                    else store.clearSelected()
                  }}
                  label={t('selectAll')}
                  disabled={uninstalling || filteredPrograms.length === 0}
                />
                <span>{t('selectedCount', { count: selectedCount })}</span>
              </label>
              <div className="sw-toolbar-end">
                <SearchField
                  value={searchQuery}
                  onChange={(value) => useUninstallerStore.getState().setSearchQuery(value)}
                  placeholder={t('searchPlaceholder')}
                />
                {/* Filter only when Prefetch data says which programs go unused */}
                {hasPrefetchData && (
                  <Segmented<FilterMode>
                    label={t('filterLabel')}
                    value={filterMode}
                    onChange={(mode) => useUninstallerStore.getState().setFilterMode(mode)}
                    options={[
                      { value: 'all', label: t('filterAll', { count: programs.length }) },
                      {
                        value: 'unused',
                        label: t('filterUnused', { count: unusedPrograms.length })
                      }
                    ]}
                  />
                )}
                <MenuButton<SortField>
                  icon={ArrowUpDown}
                  label={t(SORT_LABEL_KEYS[sortField])}
                  menuLabel={t('sortLabel')}
                  value={sortField}
                  checkedHint={sortDirection === 'asc' ? t('sortAscending') : t('sortDescending')}
                  options={(Object.keys(SORT_LABEL_KEYS) as SortField[]).map((value) => ({
                    value,
                    label: t(SORT_LABEL_KEYS[value])
                  }))}
                  onSelect={(field) => {
                    const store = useUninstallerStore.getState()
                    if (sortField === field) {
                      store.setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
                    } else {
                      store.setSortField(field)
                      store.setSortDirection(field === 'estimatedSize' ? 'desc' : 'asc')
                    }
                  }}
                />
              </div>
            </div>

            {filteredPrograms.length === 0 ? (
              <p className="sw-list-empty">
                {filterMode === 'unused' ? t('noUnusedProgramsFound') : t('noProgramsMatchSearch')}
              </p>
            ) : (
              filteredPrograms.map((prog) => (
                <ProgramRow
                  key={prog.id}
                  program={prog}
                  selected={selectedIds.has(prog.id)}
                  disabled={uninstalling}
                  onUninstall={() => setConfirmProgram(prog)}
                />
              ))
            )}
          </Card>
        )}
      </div>

      {/* Uninstalling is irreversible: every confirmation is red and repeats the action */}
      <ConfirmDialog
        open={!!confirmProgram}
        onConfirm={handleUninstall}
        onCancel={() => setConfirmProgram(null)}
        title={t('confirmUninstallTitle', { programName: confirmProgram?.displayName ?? '' })}
        description={t('confirmUninstallDescription')}
        confirmLabel={t('confirmUninstallLabel')}
        variant="danger"
      />

      <ConfirmDialog
        open={confirmBatch}
        onConfirm={handleBatchUninstall}
        onCancel={() => setConfirmBatch(false)}
        title={t('confirmBatchTitle', { count: selectedCount })}
        description={t('confirmBatchDescription')}
        details={programs
          .filter((p) => selectedIds.has(p.id))
          .map((p) => p.displayName)
          .join(', ')}
        confirmLabel={t('confirmBatchLabel', { count: selectedCount })}
        variant="danger"
      />

      <ConfirmDialog
        open={!!confirmForceRemove}
        onConfirm={handleForceRemove}
        onCancel={() => setConfirmForceRemove(null)}
        title={t('confirmForceRemoveTitle', { programName: confirmForceRemove?.displayName ?? '' })}
        description={t('confirmForceRemoveDescription')}
        confirmLabel={t('confirmForceRemoveLabel')}
        variant="danger"
      />
    </div>
  )
}

function ProgramRow({
  program,
  selected,
  disabled,
  onUninstall
}: {
  program: InstalledProgram
  selected: boolean
  disabled: boolean
  onUninstall: () => void
}) {
  const { t } = useTranslation('uninstaller')
  const unused = isUnused(program)
  const lastUsed =
    program.lastUsed > 0 || (program.lastUsed === 0 && unused)
      ? t('lastUsed', { when: formatLastUsed(program.lastUsed, t) })
      : ''
  return (
    <ListRow className={ROW_CLASS} recommended={unused}>
      <Checkbox
        checked={selected}
        onChange={() => useUninstallerStore.getState().toggleSelected(program.id)}
        label={program.displayName}
        disabled={disabled}
      />
      <AppIcon iconDataUrl={program.iconDataUrl} small />
      <div className="min-w-0 flex-1">
        <div className="sw-row-title">
          <span className="sw-row-name" title={program.displayName}>
            {program.displayName}
          </span>
          {program.displayVersion && (
            <span className="sw-row-meta sw-muted shrink-0">v{program.displayVersion}</span>
          )}
          {unused && <Tag tone="recommended">{t('unusedBadge')}</Tag>}
        </div>
        <p className="sw-row-sub">
          {joinFacts([
            program.publisher || t('unknownPublisher'),
            formatDate(program.installDate),
            lastUsed
          ])}
        </p>
      </div>
      {/* A size of 0 means the program did not declare one */}
      <span className="sw-row-meta shrink-0">
        {program.estimatedSize > 0 ? formatBytes(program.estimatedSize) : NO_VALUE}
      </span>
      <Button
        variant="ghost"
        icon={icons.uninstall}
        onClick={onUninstall}
        disabled={disabled}
        aria-label={`${t('uninstallButton')} ${program.displayName}`}
      >
        {t('uninstallButton')}
      </Button>
    </ListRow>
  )
}
