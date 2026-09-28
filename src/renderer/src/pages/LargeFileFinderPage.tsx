import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FolderOpen, RotateCcw, X } from 'lucide-react'
import { formatBytes, NO_VALUE } from '@/lib/utils'
import { icons } from '@/lib/icons'
import { useLargeFileStore } from '@/stores/large-file-store'
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
import {
  DepthInput,
  ExcludeEditor,
  FilterField,
  FolderScope
} from '@/components/storage/FolderScope'
import { InlineNote, RowAction, SummaryCard } from '@/components/storage/parts'
import { ScanProgressCard } from '@/components/storage/ScanProgressCard'
import {
  formatCount,
  formatDateTime,
  formatDay,
  formatElapsed,
  formatThreshold,
  listPreview
} from '@/components/storage/format'
import type { LargeFileDeleteMode } from '@shared/types'

const NS = 'largeFiles'

const MIN_SIZES = [1_048_576, 10_485_760, 52_428_800, 104_857_600, 524_288_000, 1_073_741_824]
/** The main process returns at most this many files, largest first. */
const RESULT_CAP = 500

export function LargeFileFinderPage() {
  const { t } = useTranslation(NS)
  const store = useLargeFileStore()
  const [showConfirm, setShowConfirm] = useState(false)
  const depthId = useId()
  const excludeId = useId()

  const { result, status, progress } = store
  const selectedCount = store.selectedPaths.size
  const busy = status === 'scanning' || status === 'deleting'
  const selectedSize = useMemo(() => {
    if (!result) return 0
    let size = 0
    for (const file of result.files) if (store.selectedPaths.has(file.path)) size += file.size
    return size
  }, [result, store.selectedPaths])
  const totalLargeSize = useMemo(
    () => (result ? result.files.reduce((sum, f) => sum + f.size, 0) : 0),
    [result]
  )

  // ── Handlers ──

  const chooseFolder = async (): Promise<string | null> => {
    const dir = await window.kudu?.largeFilesSelectDir?.()
    if (dir) useLargeFileStore.getState().setDirectory(dir)
    return dir ?? null
  }

  const handleScan = async () => {
    if (busy) return
    // Without a folder, "Find large files" asks for one first.
    const directory = useLargeFileStore.getState().directory ?? (await chooseFolder())
    if (!directory) return
    const s = useLargeFileStore.getState()
    s.reset()
    s.setStatus('scanning')
    try {
      const scan = await window.kudu?.largeFilesScan?.({
        directory,
        minFileSize: s.minFileSize,
        maxDepth: s.maxDepth,
        excludePatterns: s.excludePatterns
      })
      if (scan) {
        s.setResult(scan)
        s.setStatus('complete')
      }
    } catch {
      s.setStatus('idle')
    }
  }

  const handleCancel = async () => {
    await window.kudu?.largeFilesCancel?.()
  }

  const handleDelete = async () => {
    setShowConfirm(false)
    const s = useLargeFileStore.getState()
    const deletingPaths = new Set(s.selectedPaths)
    const mode: LargeFileDeleteMode = s.deleteMode
    s.setStatus('deleting')
    try {
      const outcome = await window.kudu?.largeFilesDelete?.(Array.from(deletingPaths), mode)
      if (outcome) {
        s.setDeleteResult(outcome, mode)
        if (outcome.deleted > 0) {
          const failedPaths = new Set(outcome.errors.map((e) => e.path))
          const successPaths = new Set<string>()
          for (const p of deletingPaths) if (!failedPaths.has(p)) successPaths.add(p)
          s.removeDeletedFiles(successPaths)
          toast.success(
            t(mode === 'permanent' ? 'deletePermanentToast' : 'deleteRecycleToast', {
              count: outcome.deleted,
              files: formatCount(outcome.deleted),
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
      // The main process refuses a deletion while another large-file operation runs.
    } finally {
      useLargeFileStore.getState().setStatus('complete')
    }
  }

  // ── Copy ──

  const more = (count: number) => t('moreItems', { count })
  const minSize = formatThreshold(store.minFileSize)
  const filtersSummary = [
    t('sizeFrom', { min: minSize }),
    t('depthSummary', { count: store.maxDepth }),
    store.excludePatterns.length > 0
      ? t('excludedSummary', { list: listPreview(store.excludePatterns, more) })
      : t('noneExcluded')
  ].join(' · ')

  const permanent = store.deleteMode === 'permanent'
  const selection = {
    count: selectedCount,
    files: formatCount(selectedCount),
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
          t('receiptCount', { count: done.deleted, files: formatCount(done.deleted) }),
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

  const scannedFact = result
    ? t('factScanned', {
        count: result.totalFilesScanned,
        files: formatCount(result.totalFilesScanned),
        duration: formatElapsed(result.duration)
      })
    : ''

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
              icon={icons.largeFiles}
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
              <FilterField label={t('minFileSize')} wide>
                <Segmented
                  label={t('minFileSize')}
                  value={String(store.minFileSize)}
                  onChange={(v) => store.setMinFileSize(Number(v))}
                  options={MIN_SIZES.map((v) => ({ value: String(v), label: formatThreshold(v) }))}
                />
              </FilterField>
              <FilterField label={t('maxDepth')} htmlFor={depthId}>
                <DepthInput id={depthId} value={store.maxDepth} onChange={store.setMaxDepth} />
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
                { title: t('checkListTitle'), detail: t('checkListDetail', { min: minSize }) },
                { title: t('checkReadTitle'), detail: t('checkReadDetail') },
                { title: t('checkSkipTitle'), detail: t('checkSkipDetail') }
              ]}
            />
          </>
        )}

        {scanning && (
          <ScanProgressCard
            title={t('scanningTitle')}
            progressLabel={t('progressLabel')}
            path={progress?.currentPath || store.directory || undefined}
            facts={
              progress
                ? [
                    t('filesRead', {
                      count: progress.filesScanned,
                      files: formatCount(progress.filesScanned)
                    }),
                    t('largeFound', {
                      count: progress.largeFilesFound,
                      found: formatCount(progress.largeFilesFound),
                      min: minSize
                    })
                  ].join(' · ')
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

            {result.files.length > 0 ? (
              <>
                <SummaryCard
                  value={
                    selectedCount > 0
                      ? t('summarySelected', { size: formatBytes(selectedSize) })
                      : t('summaryFound', {
                          count: result.files.length,
                          files: formatCount(result.files.length),
                          size: formatBytes(totalLargeSize)
                        })
                  }
                  facts={[
                    t('factFound', {
                      count: result.files.length,
                      files: formatCount(result.files.length),
                      min: minSize
                    }),
                    result.files.length >= RESULT_CAP && t('capReached', { cap: RESULT_CAP }),
                    scannedFact,
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
                  source="large-files"
                  sourceRevision={result}
                  candidates={result.files.map((file) => ({
                    path: file.path,
                    size: file.size,
                    lastModified: file.lastModified,
                    lastAccessed: file.lastAccessed
                  }))}
                />

                <Section
                  title={t('filesTitle')}
                  meta={t('filesMeta')}
                  actions={
                    selectedCount > 0 ? (
                      <Button variant="ghost" onClick={() => store.deselectAll()}>
                        {t('deselectAll')}
                      </Button>
                    ) : (
                      <Button variant="ghost" onClick={() => store.selectAll()}>
                        {t('selectAll')}
                      </Button>
                    )
                  }
                >
                  <Table>
                    <TableHead>
                      <TableHeaderCell className="storage-col-check">
                        <span className="sr-only">{t('colSelect')}</span>
                      </TableHeaderCell>
                      <TableHeaderCell>{t('colPath')}</TableHeaderCell>
                      <TableHeaderCell>{t('colType')}</TableHeaderCell>
                      <TableHeaderCell numeric className="storage-col-date">
                        {t('colModified')}
                      </TableHeaderCell>
                      <TableHeaderCell numeric>{t('colSize')}</TableHeaderCell>
                      <TableHeaderCell className="storage-col-action">
                        <span className="sr-only">{t('openLocation')}</span>
                      </TableHeaderCell>
                    </TableHead>
                    <tbody>
                      {result.files.map((file) => {
                        const isSelected = store.selectedPaths.has(file.path)
                        return (
                          <TableRow key={file.path} selected={isSelected}>
                            <TableCell className="storage-col-check">
                              <Checkbox
                                checked={isSelected}
                                onChange={() => store.togglePath(file.path)}
                                label={t('selectFile', { path: file.path })}
                              />
                            </TableCell>
                            <TableCell className="storage-col-path" title={file.path}>
                              <span className="storage-path-text">{file.path}</span>
                            </TableCell>
                            <TableCell muted>
                              <span className="storage-mono">{file.extension || NO_VALUE}</span>
                            </TableCell>
                            <TableCell numeric muted className="storage-col-date">
                              {formatDay(file.lastModified)}
                            </TableCell>
                            <TableCell numeric>{formatBytes(file.size)}</TableCell>
                            <TableCell className="storage-col-action">
                              <RowAction
                                icon={FolderOpen}
                                label={t('openLocation')}
                                onClick={() => window.kudu?.largeFilesOpenLocation?.(file.path)}
                              />
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </tbody>
                  </Table>
                </Section>
              </>
            ) : (
              <Card>
                <p className="storage-summary-value">{t('emptyTitle', { min: minSize })}</p>
                <p className="storage-summary-facts">
                  {[scannedFact, store.directory].filter(Boolean).join(' · ')}
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
