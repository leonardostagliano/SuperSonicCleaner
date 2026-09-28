import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ChevronRight, FolderOpen, ListChecks, RotateCcw, X } from 'lucide-react'
import { formatBytes } from '@/lib/utils'
import { icons } from '@/lib/icons'
import { isRecommendedCopy, useDuplicateStore } from '@/stores/duplicate-store'
import { useDrivesStore } from '@/stores/drives-store'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { Receipt } from '@/components/shared/Receipt'
import { PageHeader } from '@/components/layout/PageHeader'
import { AiAnalysisPanel } from '@/components/ai/AiAnalysisPanel'
import { Button } from '@/components/ui/Button'
import { Card, Section } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import { Segmented } from '@/components/ui/Segmented'
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/Table'
import { Tag } from '@/components/ui/Tag'
import {
  DepthInput,
  ExcludeEditor,
  FilterField,
  FolderScope
} from '@/components/storage/FolderScope'
import { InlineNote, RowAction, SummaryCard } from '@/components/storage/parts'
import { ScanProgressCard } from '@/components/storage/ScanProgressCard'
import { stagesFor } from '@/components/storage/stages'
import {
  formatCount,
  formatDateTime,
  formatDay,
  formatElapsed,
  formatThreshold,
  listPreview
} from '@/components/storage/format'
import type { DuplicateDeleteMode, DuplicateGroup } from '@shared/types'

const NS = 'duplicates'

const MIN_SIZES = [102_400, 1_048_576, 10_485_760, 104_857_600]
const MAX_SIZES = [104_857_600, 1_073_741_824, 5_368_709_120]

const EXT_PRESETS: Record<string, string[]> = {
  images: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff'],
  videos: ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm'],
  audio: ['.mp3', '.flac', '.wav', '.aac', '.ogg', '.wma', '.m4a'],
  documents: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv']
}
type ExtPreset = 'all' | 'images' | 'videos' | 'audio' | 'documents'
const EXT_PRESET_KEYS: ExtPreset[] = ['all', 'images', 'videos', 'audio', 'documents']
/** The filter summary names the preset in running text ("solo immagini"). */
const EXT_SUMMARY_KEYS: Record<ExtPreset, string> = {
  all: 'typesAll',
  images: 'typesImages',
  videos: 'typesVideos',
  audio: 'typesAudio',
  documents: 'typesDocuments'
}

/** The real stages of a duplicate scan, in the order the main process runs them. */
const STAGES = ['walking', 'grouping', 'partial-hash', 'full-hash'] as const
const STAGE_LABELS: Record<string, string> = {
  walking: 'phaseWalking',
  grouping: 'phaseGrouping',
  'partial-hash': 'phasePartialHash',
  'full-hash': 'phaseFullHash'
}

export function DuplicateFinderPage() {
  const { t } = useTranslation(NS)
  const store = useDuplicateStore()
  const [showConfirm, setShowConfirm] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const depthId = useId()
  const excludeId = useId()

  const { result, status, progress } = store
  const selectedCount = store.selectedPaths.size
  const selectedSize = useMemo(() => {
    if (!result) return 0
    let size = 0
    for (const group of result.groups) {
      for (const file of group.files) if (store.selectedPaths.has(file.path)) size += file.size
    }
    return size
  }, [result, store.selectedPaths])
  const recommendedCount = useMemo(
    () =>
      result
        ? result.groups.reduce(
            (n, g) => n + g.files.filter((_, i) => isRecommendedCopy(g, i)).length,
            0
          )
        : 0,
    [result]
  )

  const activeExtPreset = useMemo<ExtPreset | null>(() => {
    if (store.extensionFilter.length === 0) return 'all'
    for (const [name, exts] of Object.entries(EXT_PRESETS)) {
      if (
        exts.length === store.extensionFilter.length &&
        exts.every((e) => store.extensionFilter.includes(e))
      ) {
        return name as ExtPreset
      }
    }
    return null
  }, [store.extensionFilter])

  // ── Handlers ──

  const chooseFolder = async (): Promise<string | null> => {
    const dir = await window.kudu?.duplicatesSelectDir?.()
    if (dir) useDuplicateStore.getState().setDirectory(dir)
    return dir ?? null
  }

  const handleScan = async () => {
    // Without a folder, "Find duplicates" asks for one first.
    const directory = useDuplicateStore.getState().directory ?? (await chooseFolder())
    if (!directory) return
    const s = useDuplicateStore.getState()
    s.reset()
    s.setStatus('scanning')
    setExpandedGroups(new Set())
    try {
      const scan = await window.kudu?.duplicatesScan?.({
        directory,
        minFileSize: s.minFileSize,
        maxFileSize: s.maxFileSize,
        excludePatterns: s.excludePatterns,
        extensionFilter: s.extensionFilter,
        maxDepth: s.maxDepth
      })
      if (scan) {
        s.setResult(scan)
        s.setStatus('complete')
        if (scan.groups.length > 0) s.selectAllDuplicates()
      }
    } catch {
      s.setStatus('idle')
    }
  }

  const handleCancel = async () => {
    await window.kudu?.duplicatesCancel?.()
  }

  const handleDelete = async () => {
    setShowConfirm(false)
    const s = useDuplicateStore.getState()
    const deletingPaths = new Set(s.selectedPaths)
    const mode: DuplicateDeleteMode = s.deleteMode
    s.setStatus('deleting')
    try {
      const outcome = await window.kudu?.duplicatesDelete?.(Array.from(deletingPaths), mode)
      if (outcome) {
        s.setDeleteResult(outcome, mode)
        // Build the set of successfully deleted paths (remove failures)
        const failedPaths = new Set(outcome.errors.map((e) => e.path))
        const successPaths = new Set<string>()
        for (const p of deletingPaths) if (!failedPaths.has(p)) successPaths.add(p)
        s.removeDeletedFiles(successPaths, failedPaths)
        if (outcome.deleted > 0) {
          toast.success(
            t(mode === 'permanent' ? 'deletePermanentToast' : 'deleteRecycleToast', {
              count: outcome.deleted,
              copies: formatCount(outcome.deleted),
              size: formatBytes(outcome.spaceRecovered)
            })
          )
          // Only a permanent deletion frees space on the drive.
          if (mode === 'permanent') void useDrivesStore.getState().refresh({ fresh: true })
        }
        if (outcome.failed > 0) {
          toast.error(
            t('deleteFailed', { count: outcome.failed, failed: formatCount(outcome.failed) })
          )
        }
      }
    } catch {
      // The main process refuses overlapping deletions; the list stays as it was.
    } finally {
      useDuplicateStore.getState().setStatus('complete')
    }
  }

  const toggleGroup = (hash: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(hash)) next.delete(hash)
      else next.add(hash)
      return next
    })
  }

  // ── Copy ──

  const more = (count: number) => t('moreItems', { count })
  const filtersSummary = [
    store.maxFileSize === null
      ? t('sizeFrom', { min: formatThreshold(store.minFileSize) })
      : t('sizeRange', {
          min: formatThreshold(store.minFileSize),
          max: formatThreshold(store.maxFileSize)
        }),
    activeExtPreset === null
      ? t('typesCustom', { count: store.extensionFilter.length })
      : t(EXT_SUMMARY_KEYS[activeExtPreset]),
    t('depthSummary', { count: store.maxDepth }),
    store.excludePatterns.length > 0
      ? t('excludedSummary', { list: listPreview(store.excludePatterns, more) })
      : t('noneExcluded')
  ].join(' · ')

  const permanent = store.deleteMode === 'permanent'
  const selection = {
    count: selectedCount,
    copies: formatCount(selectedCount),
    size: formatBytes(selectedSize)
  }
  const actionLabel =
    selectedCount === 0
      ? t(permanent ? 'deleteActionNone' : 'moveActionNone')
      : t(permanent ? 'deleteAction' : 'moveAction', selection)

  const receipt = (() => {
    const done = store.deleteResult
    if (status !== 'complete' || !done || store.deletedAt === null) return null
    const wasPermanent = store.deletedMode === 'permanent'
    return (
      <Receipt
        title={
          done.deleted === 0
            ? t('receiptNoneTitle')
            : t(wasPermanent ? 'receiptPermanentTitle' : 'receiptRecycleTitle')
        }
        value={
          done.deleted > 0
            ? t(wasPermanent ? 'receiptPermanentValue' : 'receiptRecycleValue', {
                size: formatBytes(done.spaceRecovered)
              })
            : undefined
        }
        facts={[
          t('receiptCount', { count: done.deleted, copies: formatCount(done.deleted) }),
          formatDateTime(store.deletedAt),
          t(wasPermanent ? 'receiptPermanentNote' : 'receiptRecycleNote')
        ]}
        skipped={
          done.failed > 0
            ? t('receiptSkipped', { count: done.failed, skipped: formatCount(done.failed) })
            : undefined
        }
      />
    )
  })()

  // ── Render ──

  const scanning = status === 'scanning'
  const showResults = status === 'complete' && result

  return (
    <div>
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          status === 'idle' || scanning ? (
            <Button
              variant="primary"
              size="lg"
              icon={icons.duplicates}
              busy={scanning}
              onClick={handleScan}
            >
              {t('scanButton')}
            </Button>
          ) : (
            <Button
              variant="ghost"
              icon={RotateCcw}
              onClick={() => store.reset()}
              disabled={status === 'deleting'}
            >
              {t('newSearch')}
            </Button>
          )
        }
      />

      <div className="storage-stack">
        {status === 'idle' && (
          <>
            <FolderScope
              ns={NS}
              folder={store.directory}
              onChooseFolder={() => void chooseFolder()}
              filtersSummary={filtersSummary}
            >
              <FilterField label={t('minFileSize')}>
                <Segmented
                  label={t('minFileSize')}
                  value={String(store.minFileSize)}
                  onChange={(v) => store.setMinFileSize(Number(v))}
                  options={MIN_SIZES.map((v) => ({ value: String(v), label: formatThreshold(v) }))}
                />
              </FilterField>
              <FilterField label={t('maxFileSize')}>
                <Segmented
                  label={t('maxFileSize')}
                  value={String(store.maxFileSize ?? 'none')}
                  onChange={(v) => store.setMaxFileSize(v === 'none' ? null : Number(v))}
                  options={[
                    { value: 'none', label: t('noLimit') },
                    ...MAX_SIZES.map((v) => ({ value: String(v), label: formatThreshold(v) }))
                  ]}
                />
              </FilterField>
              <FilterField label={t('maxDepth')} htmlFor={depthId}>
                <DepthInput id={depthId} value={store.maxDepth} onChange={store.setMaxDepth} />
              </FilterField>
              <FilterField label={t('extensionFilter')} wide>
                <Segmented
                  label={t('extensionFilter')}
                  value={activeExtPreset ?? ''}
                  onChange={(v) => store.setExtensionFilter(v === 'all' ? [] : EXT_PRESETS[v])}
                  options={EXT_PRESET_KEYS.map((key) => ({
                    value: key,
                    label: t(key === 'all' ? 'allFiles' : key)
                  }))}
                />
              </FilterField>
              <FilterField label={t('excludePatterns')} htmlFor={excludeId} wide>
                <ExcludeEditor
                  ns={NS}
                  id={excludeId}
                  patterns={store.excludePatterns}
                  onChange={store.setExcludePatterns}
                />
              </FilterField>
            </FolderScope>

            <EmptyState
              title={t('idleTitle')}
              description={t('idleDescription')}
              checks={[
                { title: t('checkMatchTitle'), detail: t('checkMatchDetail') },
                { title: t('checkKeepTitle'), detail: t('checkKeepDetail') },
                { title: t('checkSkipTitle'), detail: t('checkSkipDetail') }
              ]}
            />
          </>
        )}

        {scanning && (
          <ScanProgressCard
            title={t('scanningTitle')}
            progressLabel={t('progressLabel')}
            value={
              progress && progress.progress > 0 ? Math.min(1, progress.progress / 100) : undefined
            }
            stages={stagesFor(STAGES, progress?.phase, (key) => t(STAGE_LABELS[key]))}
            stagesLabel={t('stagesLabel')}
            path={progress?.currentPath || store.directory || undefined}
            facts={
              progress
                ? [
                    progress.filesScanned > 0 &&
                      t('filesRead', {
                        count: progress.filesScanned,
                        files: formatCount(progress.filesScanned)
                      }),
                    progress.filesHashed != null &&
                      progress.filesToHash != null &&
                      t('filesCompared', {
                        done: formatCount(progress.filesHashed),
                        total: formatCount(progress.filesToHash)
                      }),
                    progress.duplicatesFound > 0 &&
                      t('groupsSoFar', {
                        count: progress.duplicatesFound,
                        groups: formatCount(progress.duplicatesFound)
                      })
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : undefined
            }
            action={
              <Button icon={X} onClick={handleCancel}>
                {t('cancelScan')}
              </Button>
            }
          />
        )}

        {status === 'deleting' && (
          <ScanProgressCard
            title={t(permanent ? 'deletingPermanent' : 'deletingRecycle', selection)}
            progressLabel={t('progressLabel')}
            facts={t('deletingFacts')}
          />
        )}

        {showResults && (
          <>
            {receipt}
            {result.cancelled && <InlineNote tone="warning">{t('scanCancelled')}</InlineNote>}

            {result.groups.length > 0 ? (
              <>
                <SummaryCard
                  value={
                    selectedCount > 0
                      ? t('summarySelected', { size: formatBytes(selectedSize) })
                      : t('summaryNoneSelected')
                  }
                  facts={[
                    t('factCopies', {
                      count: result.totalDuplicates,
                      copies: formatCount(result.totalDuplicates),
                      size: formatBytes(result.totalReclaimable)
                    }),
                    t('factGroups', {
                      count: result.groups.length,
                      groups: formatCount(result.groups.length)
                    }),
                    t('factScanned', {
                      count: result.totalFilesScanned,
                      files: formatCount(result.totalFilesScanned),
                      duration: formatElapsed(result.duration)
                    }),
                    store.directory
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  actions={
                    <>
                      <Segmented
                        label={t('deleteModeLabel')}
                        value={store.deleteMode}
                        onChange={store.setDeleteMode}
                        options={[
                          { value: 'recycle', label: t('recycleBin') },
                          { value: 'permanent', label: t('permanentDelete') }
                        ]}
                      />
                      <Button
                        variant="primary"
                        size="lg"
                        disabled={selectedCount === 0}
                        onClick={() => setShowConfirm(true)}
                      >
                        {actionLabel}
                      </Button>
                    </>
                  }
                />

                <AiAnalysisPanel
                  source="duplicates"
                  sourceRevision={result}
                  candidates={result.groups.flatMap((group) =>
                    group.files.map((file) => ({
                      path: file.path,
                      size: file.size,
                      lastModified: file.lastModified,
                      lastAccessed: file.lastAccessed,
                      duplicateGroupKey: group.fullHash
                    }))
                  )}
                />

                <Section
                  title={t('groupsTitle')}
                  meta={
                    recommendedCount > 0
                      ? t('groupsMeta', {
                          count: recommendedCount,
                          copies: formatCount(recommendedCount)
                        })
                      : undefined
                  }
                  metaTone="recommended"
                  actions={
                    selectedCount > 0 ? (
                      <Button variant="ghost" onClick={() => store.deselectAll()}>
                        {t('deselectAll')}
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        icon={ListChecks}
                        onClick={() => store.selectAllDuplicates()}
                      >
                        {t('selectRecommended')}
                      </Button>
                    )
                  }
                >
                  <ul className="storage-groups">
                    {result.groups.map((group) => (
                      <DuplicateGroupRow
                        key={group.fullHash}
                        group={group}
                        expanded={expandedGroups.has(group.fullHash)}
                        onToggle={() => toggleGroup(group.fullHash)}
                        selectedPaths={store.selectedPaths}
                        onTogglePath={store.togglePath}
                      />
                    ))}
                  </ul>
                </Section>
              </>
            ) : (
              <Card>
                <p className="storage-summary-value">{t('emptyTitle')}</p>
                <p className="storage-summary-facts">
                  {[
                    t('emptyDescription'),
                    t('factScanned', {
                      count: result.totalFilesScanned,
                      files: formatCount(result.totalFilesScanned),
                      duration: formatElapsed(result.duration)
                    }),
                    store.directory
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </Card>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={showConfirm && status === 'complete'}
        onConfirm={handleDelete}
        onCancel={() => setShowConfirm(false)}
        title={t(permanent ? 'confirmPermanentTitle' : 'confirmRecycleTitle', selection)}
        description={t(permanent ? 'confirmPermanentDesc' : 'confirmRecycleDesc')}
        variant={permanent ? 'danger' : 'default'}
        confirmLabel={actionLabel}
      />
    </div>
  )
}

/** One group of identical files: a disclosure row, then its copies. */
function DuplicateGroupRow({
  group,
  expanded,
  onToggle,
  selectedPaths,
  onTogglePath
}: {
  group: DuplicateGroup
  expanded: boolean
  onToggle: () => void
  selectedPaths: Set<string>
  onTogglePath: (path: string) => void
}) {
  const { t } = useTranslation(NS)
  const bodyId = useId()
  const groupSelected = group.files.filter((f) => selectedPaths.has(f.path)).length
  return (
    <li className="storage-group">
      <button
        type="button"
        className="storage-group-head"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
        <span className="storage-group-title">
          {t('groupHeader', {
            count: group.files.length,
            copies: formatCount(group.files.length),
            size: formatBytes(group.fileSize)
          })}
        </span>
        <span className="storage-group-meta">
          {t('groupSelected', {
            selected: formatCount(groupSelected),
            total: formatCount(group.files.length)
          })}
        </span>
        <span className="storage-group-size">
          {t('groupFreeable', { size: formatBytes(group.reclaimableSpace) })}
        </span>
      </button>
      {expanded && (
        <div id={bodyId} className="storage-group-body">
          <Table className="storage-table-fixed">
            <TableHead>
              <TableHeaderCell className="storage-col-check">
                <span className="sr-only">{t('colSelect')}</span>
              </TableHeaderCell>
              <TableHeaderCell>{t('colPath')}</TableHeaderCell>
              <TableHeaderCell className="storage-col-status">{t('colStatus')}</TableHeaderCell>
              <TableHeaderCell numeric className="storage-col-date">
                {t('colModified')}
              </TableHeaderCell>
              <TableHeaderCell className="storage-col-action">
                <span className="sr-only">{t('openLocation')}</span>
              </TableHeaderCell>
            </TableHead>
            <tbody>
              {group.files.map((file, index) => {
                const isSelected = selectedPaths.has(file.path)
                const recommended = isRecommendedCopy(group, index)
                // Selecting this would leave no copy of the file behind
                const isLastCopy = !isSelected && groupSelected === group.files.length - 1
                return (
                  <TableRow key={file.path} recommended={recommended} selected={isSelected}>
                    <TableCell className="storage-col-check">
                      <span
                        title={
                          file.hardLinked
                            ? t('hardLinkedCopy')
                            : isLastCopy
                              ? t('keepOneCopy')
                              : undefined
                        }
                      >
                        <Checkbox
                          checked={isSelected}
                          disabled={isLastCopy || file.hardLinked}
                          onChange={() => onTogglePath(file.path)}
                          label={t('selectCopy', { path: file.path })}
                        />
                      </span>
                    </TableCell>
                    <TableCell className="storage-col-path" title={file.path}>
                      <span className="storage-path-text">{file.path}</span>
                    </TableCell>
                    <TableCell className="storage-col-status">
                      {index === 0 ? (
                        <Tag tone="neutral">{t('keepTag')}</Tag>
                      ) : recommended ? (
                        <Tag tone="recommended">{t('recommendedTag')}</Tag>
                      ) : file.hardLinked ? (
                        <Tag tone="neutral">{t('hardLinkedTag')}</Tag>
                      ) : null}
                    </TableCell>
                    <TableCell numeric muted className="storage-col-date">
                      {formatDay(file.lastModified)}
                    </TableCell>
                    <TableCell className="storage-col-action">
                      <RowAction
                        icon={FolderOpen}
                        label={t('openLocation')}
                        onClick={() => window.kudu?.duplicatesOpenLocation?.(file.path)}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </tbody>
          </Table>
        </div>
      )}
    </li>
  )
}
