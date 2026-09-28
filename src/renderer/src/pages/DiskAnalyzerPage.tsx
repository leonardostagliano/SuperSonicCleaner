import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, FileType2, Folder } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Segmented } from '@/components/ui/Segmented'
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/Table'
import { ErrorCard, SummaryCard } from '@/components/storage/parts'
import { ScanProgressCard } from '@/components/storage/ScanProgressCard'
import { layoutTreemap, type TreemapItem } from '@/components/storage/treemap'
import { formatCount, formatShare } from '@/components/storage/format'
import { formatBytes } from '@/lib/utils'
import { icons } from '@/lib/icons'
import { useDiskStore } from '@/stores/disk-store'
import { useDrivesStore } from '@/stores/drives-store'
import { AiAnalysisPanel } from '@/components/ai/AiAnalysisPanel'
import { usePlatform } from '@/hooks/usePlatform'
import type { DiskNode, DriveInfo, FileTypeInfo } from '@shared/types'

type ViewMode = 'folders' | 'filetypes'

/** The main process names files without an extension with this English marker. */
const NO_EXTENSION = '(no extension)'
/** The file-type map shows the 30 biggest types; the table lists them all. */
const TREEMAP_TYPES = 30

/** A flat treemap: one tone, area = size. Drawn only with two tiles or more. */
function Treemap({
  items,
  otherLabel
}: {
  items: TreemapItem[]
  otherLabel: (n: number) => string
}) {
  const rects = layoutTreemap(items, otherLabel)
  if (rects.length < 2) return null
  return (
    <Card>
      {/* The table below carries the same data for assistive technology. */}
      <div className="storage-treemap" aria-hidden="true">
        {rects.map((rect) => (
          <div
            key={rect.name}
            className="storage-tile"
            data-other={rect.other || undefined}
            style={{
              left: `${rect.x}%`,
              top: `${rect.y}%`,
              width: `${rect.w}%`,
              height: `${rect.h}%`
            }}
          >
            <div className="storage-tile-fill">
              {rect.w > 8 && rect.h > 12 && <span className="storage-tile-name">{rect.name}</span>}
              {rect.w > 12 && rect.h > 20 && (
                <span className="storage-tile-size">{formatBytes(rect.size)}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

/** A share of the parent as a bar and a percentage; the bar is decoration for the number. */
function Share({ fraction }: { fraction: number }) {
  return (
    <div className="storage-share">
      <div className="storage-share-bar" aria-hidden="true">
        <ProgressBar value={fraction} label="" />
      </div>
      <span className="storage-share-value">{formatShare(fraction)}</span>
    </div>
  )
}

function driveName(drive: Pick<DriveInfo, 'letter' | 'label'>, isWin: boolean): string {
  return isWin ? `${drive.letter}: ${drive.label}` : `${drive.letter} ${drive.label}`
}

export function DiskAnalyzerPage() {
  const { t } = useTranslation('disk')
  const { platform } = usePlatform()
  const isWin = platform === 'win32'
  // Sub-project 1's drives store: the last known list at once, revalidated in the background.
  const drives = useDrivesStore((s) => s.drives)
  const refreshDrives = useDrivesStore((s) => s.refresh)
  const selectedDrive = useDiskStore((s) => s.selectedDrive)
  const data = useDiskStore((s) => s.data)
  const analyzing = useDiskStore((s) => s.analyzing)
  const breadcrumb = useDiskStore((s) => s.breadcrumb)
  const error = useDiskStore((s) => s.error)
  const fileTypes = useDiskStore((s) => s.fileTypes)
  const fileTypesLoading = useDiskStore((s) => s.fileTypesLoading)
  const store = useDiskStore()
  const [viewMode, setViewMode] = useState<ViewMode>('folders')

  useEffect(() => {
    void refreshDrives()
  }, [refreshDrives])

  const driveOptions = useMemo(
    () =>
      drives.length > 0
        ? drives
        : [
            { letter: isWin ? 'C' : '/', label: t('systemDrive') } as Pick<
              DriveInfo,
              'letter' | 'label'
            >
          ],
    [drives, isWin, t]
  )
  const selectedInfo = drives.find((d) => d.letter === selectedDrive)

  const handleAnalyze = async () => {
    store.setAnalyzing(true)
    store.setData(null)
    store.setBreadcrumb([])
    store.setError(null)
    store.setFileTypes([])
    try {
      const result = await window.kudu.diskAnalyze(selectedDrive)
      store.setData(result)
      store.setBreadcrumb([result])
    } catch (err) {
      console.error('Disk analysis failed:', err)
      toast.error(
        isWin
          ? t('failedToAnalyzeToastWindows', { drive: selectedDrive })
          : t('failedToAnalyzeToastOther', { drive: selectedDrive }),
        { description: t('failedToAnalyzeDescMakeAccessible') }
      )
      store.setError(
        isWin
          ? t('failedToAnalyzeErrorWindows', { drive: selectedDrive })
          : t('failedToAnalyzeErrorOther', { drive: selectedDrive })
      )
    }
    store.setAnalyzing(false)
  }

  const handleFileTypeScan = async () => {
    store.setFileTypesLoading(true)
    store.setError(null)
    try {
      const result = await window.kudu.diskFileTypes(selectedDrive)
      store.setFileTypes(result)
    } catch (err) {
      console.error('File type scan failed:', err)
      store.setError(
        isWin
          ? t('failedToScanFileTypesWindows', { drive: selectedDrive })
          : t('failedToScanFileTypesOther', { drive: selectedDrive })
      )
    }
    store.setFileTypesLoading(false)
  }

  // Count file types when that view opens after an analysis, once. Starting here rather
  // than in an effect puts the progress card on screen with the view, without a flash.
  const changeView = (next: ViewMode) => {
    setViewMode(next)
    if (next === 'filetypes' && fileTypes.length === 0 && !fileTypesLoading && data) {
      void handleFileTypeScan()
    }
  }

  const currentNode = breadcrumb[breadcrumb.length - 1] ?? data
  const children = useMemo(
    () => (currentNode?.children ? [...currentNode.children].sort((a, b) => b.size - a.size) : []),
    [currentNode]
  )
  // The analysis lists folders only; the rest of a folder's size is its own files.
  const ownFilesSize = currentNode
    ? Math.max(0, currentNode.size - children.reduce((s, c) => s + c.size, 0))
    : 0
  const fileTypesTotal = useMemo(
    () => fileTypes.reduce((s, ft) => s + ft.totalSize, 0),
    [fileTypes]
  )

  const drillDown = (node: DiskNode) => {
    if (node.children?.length) store.pushBreadcrumb(node)
  }
  const otherLabel = (count: number) => t('otherItems', { count })
  const extensionName = (ft: FileTypeInfo) =>
    ft.extension === NO_EXTENSION ? t('noExtension') : ft.extension

  const emptyDescription = selectedInfo
    ? t('emptyStateUsage', {
        drive: driveName(selectedInfo, isWin),
        used: formatBytes(selectedInfo.usedSpace),
        total: formatBytes(selectedInfo.totalSize),
        free: formatBytes(selectedInfo.freeSpace)
      })
    : t('emptyStateDescription')

  return (
    <div>
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <>
            <select
              value={selectedDrive}
              onChange={(e) => store.setSelectedDrive(e.target.value)}
              className="storage-input"
              aria-label={t('driveLabel')}
              disabled={analyzing}
            >
              {driveOptions.map((d) => (
                <option key={d.letter} value={d.letter}>
                  {driveName(d, isWin)}
                </option>
              ))}
            </select>
            <Button
              variant="primary"
              size="lg"
              icon={icons.storage}
              busy={analyzing}
              onClick={handleAnalyze}
            >
              {t('analyzeButton')}
            </Button>
          </>
        }
      />

      <div className="storage-stack">
        {error && (
          <ErrorCard
            message={error}
            dismissLabel={t('dismissError')}
            onDismiss={() => store.setError(null)}
          />
        )}

        {analyzing && (
          <ScanProgressCard
            title={
              isWin
                ? t('analyzingProgressWindows', { drive: selectedDrive })
                : t('analyzingProgressOther', { drive: selectedDrive })
            }
            progressLabel={t('analyzeButton')}
          />
        )}

        {!data && !analyzing && (
          <EmptyState
            title={t('emptyStateTitle')}
            description={emptyDescription}
            checks={[
              { title: t('checkFoldersTitle'), detail: t('checkFoldersDetail') },
              { title: t('checkTypesTitle'), detail: t('checkTypesDetail') },
              { title: t('checkSkippedTitle'), detail: t('checkSkippedDetail') }
            ]}
          />
        )}

        {data && !analyzing && (
          <>
            <div>
              <Segmented
                label={t('viewLabel')}
                value={viewMode}
                onChange={changeView}
                options={[
                  { value: 'folders', label: t('viewFolders') },
                  { value: 'filetypes', label: t('viewFileTypes') }
                ]}
              />
            </div>

            {viewMode === 'folders' && currentNode && (
              <>
                <SummaryCard
                  value={t('folderTotal', { size: formatBytes(currentNode.size) })}
                  facts={t('folderFacts', {
                    path: currentNode.path,
                    count: children.length,
                    folders: formatCount(children.length)
                  })}
                  actions={
                    breadcrumb.length > 1 && (
                      <Button
                        variant="ghost"
                        icon={ArrowUp}
                        onClick={() => store.sliceBreadcrumb(breadcrumb.length - 2)}
                      >
                        {t('upOneLevel')}
                      </Button>
                    )
                  }
                />

                {children.length > 0 && (
                  <AiAnalysisPanel
                    source="disk"
                    sourceRevision={currentNode}
                    candidates={children.map((child) => ({
                      path: child.path,
                      size: child.size,
                      isDirectory: !child.isFile
                    }))}
                  />
                )}

                <Treemap
                  items={children.map((c) => ({ name: c.name, size: c.size }))}
                  otherLabel={otherLabel}
                />

                {(children.length > 0 || ownFilesSize > 0) && (
                  <Card>
                    <Table>
                      <TableHead>
                        <TableHeaderCell>{t('folderTableHeaderName')}</TableHeaderCell>
                        <TableHeaderCell numeric>{t('folderTableHeaderSize')}</TableHeaderCell>
                        <TableHeaderCell>{t('folderTableHeaderUsage')}</TableHeaderCell>
                      </TableHead>
                      <tbody>
                        {children.map((child) => {
                          const fraction = currentNode.size > 0 ? child.size / currentNode.size : 0
                          const name = (
                            <>
                              <Folder size={16} strokeWidth={1.75} aria-hidden="true" />
                              <span className="storage-name-text">{child.name}</span>
                            </>
                          )
                          return (
                            <TableRow key={child.path}>
                              <TableCell className="storage-col-path" title={child.path}>
                                {child.children?.length ? (
                                  <button
                                    type="button"
                                    className="storage-drill storage-name"
                                    onClick={() => drillDown(child)}
                                    aria-label={t('openFolder', { name: child.name })}
                                  >
                                    {name}
                                  </button>
                                ) : (
                                  <span className="storage-name">{name}</span>
                                )}
                              </TableCell>
                              <TableCell numeric>{formatBytes(child.size)}</TableCell>
                              <TableCell>
                                <Share fraction={fraction} />
                              </TableCell>
                            </TableRow>
                          )
                        })}
                        {ownFilesSize > 0 && (
                          <TableRow>
                            <TableCell muted className="storage-col-path">
                              {t('filesHere')}
                            </TableCell>
                            <TableCell numeric>{formatBytes(ownFilesSize)}</TableCell>
                            <TableCell>
                              <Share
                                fraction={
                                  currentNode.size > 0 ? ownFilesSize / currentNode.size : 0
                                }
                              />
                            </TableCell>
                          </TableRow>
                        )}
                      </tbody>
                    </Table>
                  </Card>
                )}
              </>
            )}

            {viewMode === 'filetypes' && (
              <>
                {fileTypesLoading && (
                  <ScanProgressCard
                    title={
                      isWin
                        ? t('scanningFileTypesWindows', { drive: selectedDrive })
                        : t('scanningFileTypesOther', { drive: selectedDrive })
                    }
                    progressLabel={t('viewFileTypes')}
                  />
                )}

                {!fileTypesLoading && fileTypes.length === 0 && (
                  <EmptyState
                    title={t('fileTypesEmptyTitle')}
                    description={t('fileTypesEmptyDescription')}
                    action={
                      <Button icon={FileType2} onClick={handleFileTypeScan}>
                        {t('countFileTypes')}
                      </Button>
                    }
                  />
                )}

                {!fileTypesLoading && fileTypes.length > 0 && (
                  <>
                    <SummaryCard
                      value={t('fileTypesTotal', {
                        size: formatBytes(fileTypesTotal),
                        count: fileTypes.length,
                        types: formatCount(fileTypes.length)
                      })}
                      facts={t('fileTypesFacts', {
                        extension: extensionName(fileTypes[0]),
                        size: formatBytes(fileTypes[0].totalSize)
                      })}
                    />

                    <Treemap
                      items={fileTypes
                        .slice(0, TREEMAP_TYPES)
                        .map((ft) => ({ name: extensionName(ft), size: ft.totalSize }))}
                      otherLabel={otherLabel}
                    />

                    <Card>
                      <Table>
                        <TableHead>
                          <TableHeaderCell>{t('fileTypeTableHeaderExtension')}</TableHeaderCell>
                          <TableHeaderCell numeric>{t('fileTypeTableHeaderFiles')}</TableHeaderCell>
                          <TableHeaderCell numeric>{t('fileTypeTableHeaderSize')}</TableHeaderCell>
                          <TableHeaderCell>{t('fileTypeTableHeaderShare')}</TableHeaderCell>
                        </TableHead>
                        <tbody>
                          {fileTypes.map((ft) => (
                            <TableRow key={ft.extension}>
                              <TableCell className="storage-col-path">
                                <span className="storage-name">
                                  <span
                                    className={
                                      ft.extension === NO_EXTENSION
                                        ? 'storage-name-text'
                                        : 'storage-name-text storage-mono'
                                    }
                                  >
                                    {extensionName(ft)}
                                  </span>
                                </span>
                              </TableCell>
                              <TableCell numeric>{formatCount(ft.fileCount)}</TableCell>
                              <TableCell numeric>{formatBytes(ft.totalSize)}</TableCell>
                              <TableCell>
                                <Share
                                  fraction={fileTypesTotal > 0 ? ft.totalSize / fileTypesTotal : 0}
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </tbody>
                      </Table>
                    </Card>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
