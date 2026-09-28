import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FolderOpen, RotateCcw, X } from 'lucide-react'
import { icons } from '@/lib/icons'
import { useEmptyFolderStore } from '@/stores/empty-folder-store'
import { refreshDrivesAfterDelete } from '@/stores/drives-store'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { Receipt } from '@/components/shared/Receipt'
import { PageHeader } from '@/components/layout/PageHeader'
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
  formatElapsed,
  listPreview
} from '@/components/storage/format'
import type { EmptyFolderDeleteMode } from '@shared/types'

const NS = 'emptyFolders'

export function EmptyFolderCleanerPage() {
  const { t } = useTranslation(NS)
  const store = useEmptyFolderStore()
  const [showConfirm, setShowConfirm] = useState(false)
  const depthId = useId()
  const excludeId = useId()

  const { result, status, progress } = store
  const selectedCount = store.selectedPaths.size

  // ── Handlers ──

  const chooseFolder = async (): Promise<string | null> => {
    const dir = await window.kudu?.emptyFoldersSelectDir?.()
    if (dir) useEmptyFolderStore.getState().setDirectory(dir)
    return dir ?? null
  }

  const handleScan = async () => {
    // Without a folder, "Find empty folders" asks for one first.
    const directory = useEmptyFolderStore.getState().directory ?? (await chooseFolder())
    if (!directory) return
    const s = useEmptyFolderStore.getState()
    s.reset()
    s.setStatus('scanning')
    try {
      const scan = await window.kudu?.emptyFoldersScan?.({
        directory,
        maxDepth: s.maxDepth,
        excludePatterns: s.excludePatterns
      })
      if (scan) {
        s.setResult(scan)
        s.setStatus('complete')
        // Every folder found is empty and outside the protected trees: all are pre-selected.
        if (scan.folders.length > 0) s.selectAll()
      }
    } catch {
      s.setStatus('idle')
    }
  }

  const handleCancel = async () => {
    await window.kudu?.emptyFoldersCancel?.()
  }

  const handleDelete = async () => {
    setShowConfirm(false)
    const s = useEmptyFolderStore.getState()
    const deletingPaths = new Set(s.selectedPaths)
    const mode: EmptyFolderDeleteMode = s.deleteMode
    s.setStatus('deleting')
    try {
      const outcome = await window.kudu?.emptyFoldersDelete?.(Array.from(deletingPaths), mode)
      if (outcome) {
        s.setDeleteResult(outcome, mode)
        if (outcome.deleted > 0) {
          const failedPaths = new Set(outcome.errors.map((e) => e.path))
          const successPaths = new Set<string>()
          for (const p of deletingPaths) if (!failedPaths.has(p)) successPaths.add(p)
          s.removeDeletedFolders(successPaths)
          toast.success(
            t(mode === 'permanent' ? 'deletePermanentToast' : 'deleteRecycleToast', {
              count: outcome.deleted,
              folders: formatCount(outcome.deleted)
            })
          )
          // Only a permanent deletion frees space on the drive: read it again.
          void refreshDrivesAfterDelete(mode, outcome.deleted)
        }
        if (outcome.failed > 0) {
          toast.error(
            t('deleteFailed', { count: outcome.failed, failed: formatCount(outcome.failed) })
          )
        }
      }
    } catch {
      // Nothing was removed; the list stays as it was.
    } finally {
      useEmptyFolderStore.getState().setStatus('complete')
    }
  }

  // ── Copy ──

  const more = (count: number) => t('moreItems', { count })
  const filtersSummary = [
    t('depthSummary', { count: store.maxDepth }),
    store.excludePatterns.length > 0
      ? t('excludedSummary', { list: listPreview(store.excludePatterns, more) })
      : t('noneExcluded')
  ].join(' · ')

  const permanent = store.deleteMode === 'permanent'
  const selection = { count: selectedCount, folders: formatCount(selectedCount) }
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
            ? t('receiptValue', { count: done.deleted, folders: formatCount(done.deleted) })
            : undefined
        }
        facts={[
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
        count: result.totalFoldersScanned,
        folders: formatCount(result.totalFoldersScanned),
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
              icon={icons.emptyFolders}
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
                { title: t('checkEmptyTitle'), detail: t('checkEmptyDetail') },
                { title: t('checkProtectedTitle'), detail: t('checkProtectedDetail') },
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
                    t('foldersRead', {
                      count: progress.foldersScanned,
                      folders: formatCount(progress.foldersScanned)
                    }),
                    t('emptySoFar', {
                      count: progress.emptyFound,
                      folders: formatCount(progress.emptyFound)
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

            {result.folders.length > 0 ? (
              <>
                <SummaryCard
                  value={
                    selectedCount > 0 ? t('summarySelected', selection) : t('summaryNoneSelected')
                  }
                  facts={[
                    t('factFound', {
                      count: result.folders.length,
                      folders: formatCount(result.folders.length)
                    }),
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

                <Section
                  title={t('foldersTitle')}
                  meta={t('foldersMeta', {
                    count: result.folders.length,
                    folders: formatCount(result.folders.length)
                  })}
                  metaTone="recommended"
                  actions={
                    selectedCount > 0 ? (
                      <Button variant="ghost" onClick={() => store.deselectAll()}>
                        {t('deselectAll')}
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        icon={icons.applyRecommended}
                        onClick={() => store.selectAll()}
                      >
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
                      <TableHeaderCell className="storage-col-action">
                        <span className="sr-only">{t('openLocation')}</span>
                      </TableHeaderCell>
                    </TableHead>
                    <tbody>
                      {result.folders.map((folder) => {
                        const isSelected = store.selectedPaths.has(folder.path)
                        return (
                          <TableRow key={folder.path} recommended selected={isSelected}>
                            <TableCell className="storage-col-check">
                              <Checkbox
                                checked={isSelected}
                                onChange={() => store.togglePath(folder.path)}
                                label={t('selectFolder', { path: folder.path })}
                              />
                            </TableCell>
                            <TableCell className="storage-col-path" title={folder.path}>
                              <span className="storage-path-text">{folder.path}</span>
                            </TableCell>
                            <TableCell className="storage-col-action">
                              <RowAction
                                icon={FolderOpen}
                                label={t('openLocation')}
                                onClick={() => window.kudu?.emptyFoldersOpenLocation?.(folder.path)}
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
                <p className="storage-summary-value">{t('emptyTitle')}</p>
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
