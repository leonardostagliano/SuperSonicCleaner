import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Lock, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import type { TrimDriveInfo, TrimRunResult } from '@shared/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { Receipt } from '@/components/shared/Receipt'
import {
  Button,
  Card,
  Checkbox,
  ProgressBar,
  Section,
  Segmented,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tag
} from '@/components/ui'
import {
  useDiskMaintenanceStore,
  isSelectable,
  applyFilter,
  type DriveFilter,
  type RunState
} from '@/stores/disk-maintenance-store'
import { formatBytes, formatDate } from '@/lib/utils'
import { formatDateTime, formatDay } from '@/lib/storage-tools-format'
import {
  recommendedDriveIds,
  summariseTrimRuns,
  trimReason,
  trimRunState,
  type TrimRunSummary
} from '@/lib/trim-view'

const WEEK = 7 * 24 * 60 * 60 * 1000

/** "3 g fa" within a week, the day after that. */
function lastTrimText(at: number, locale: string): string {
  return Date.now() - at < WEEK ? formatDate(new Date(at)) : formatDay(at, locale)
}

/** "C: Windows" when the volume has a label, "C:" otherwise. */
function driveName(drive: TrimDriveInfo): string {
  if (!drive.letter) return drive.label
  const letter = `${drive.letter}:`
  return drive.label && drive.label !== letter ? `${letter} ${drive.label}` : letter
}

export function DiskMaintenancePage() {
  const { t, i18n } = useTranslation('disk')
  const drives = useDiskMaintenanceStore((s) => s.drives)
  const loading = useDiskMaintenanceStore((s) => s.loading)
  const error = useDiskMaintenanceStore((s) => s.error)
  const selected = useDiskMaintenanceStore((s) => s.selected)
  const filter = useDiskMaintenanceStore((s) => s.filter)
  const runStates = useDiskMaintenanceStore((s) => s.runStates)
  const results = useDiskMaintenanceStore((s) => s.results)
  const batchRunning = useDiskMaintenanceStore((s) => s.batchRunning)
  const store = useDiskMaintenanceStore()

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [showLog, setShowLog] = useState<string | null>(null)

  // Initial load; the drives the app recommends start selected
  useEffect(() => {
    void refresh(true)
  }, [])

  async function refresh(preselect = false): Promise<void> {
    store.setLoading(true)
    store.setError(null)
    try {
      const list = await window.kudu.diskTrimList()
      store.setDrives(list)
      if (preselect && useDiskMaintenanceStore.getState().selected.size === 0)
        store.setSelected(recommendedDriveIds(list))
    } catch (err) {
      console.error('Failed to list trim drives:', err)
      store.setError(err instanceof Error ? err.message : t('trimListFailed'))
    } finally {
      store.setLoading(false)
    }
  }

  const filtered = useMemo(() => applyFilter(drives, filter), [drives, filter])

  const selectableSelected = useMemo(
    () =>
      Array.from(selected).filter((id) => {
        const d = drives.find((x) => x.id === id)
        return d ? isSelectable(d) : false
      }),
    [selected, drives]
  )
  const recommendedCount = drives.filter((d) => d.status === 'recommended').length
  const runResults = Object.values(results)
  const runSummary = useMemo(() => summariseTrimRuns(Object.values(results)), [results])

  async function handleRun(): Promise<void> {
    if (selectableSelected.length === 0) return
    setConfirmOpen(false)
    store.setBatchRunning(true)
    for (const id of selectableSelected) {
      store.setRunState(id, 'running')
    }
    try {
      const outcome = await window.kudu.diskTrimRun(selectableSelected)
      for (const r of outcome) {
        store.setResult(r.driveId, r)
        store.setRunState(r.driveId, r.success ? 'done' : 'failed')
      }
      const summary = summariseTrimRuns(outcome)
      if (summary.blocked > 0) {
        toast.error(t('adminRequiredToast'), { description: t('trimRunDetail.blocked') })
      } else if (summary.done > 0) {
        toast.success(t('trimCompletedToast', { count: summary.done }))
      }
      if (summary.skipped > 0) toast.message(t('trimThrottledToast', { count: summary.skipped }))
      if (summary.failed > 0) toast.error(t('trimFailedToast', { count: summary.failed }))
      await refresh()
    } catch (err) {
      console.error('Trim batch failed:', err)
      toast.error(t('trimBatchFailed'))
      for (const id of selectableSelected) {
        store.setRunState(id, 'failed')
      }
    } finally {
      store.setBatchRunning(false)
      store.clearSelection()
    }
  }

  const filterOptions: { value: DriveFilter; label: string }[] = [
    { value: 'all', label: t('trimFilterAll') },
    { value: 'ssd', label: t('trimFilterSsd') },
    { value: 'needs-trim', label: t('trimFilterNeeds') }
  ]

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t('maintenanceTitle')}
        description={t('maintenanceDescription')}
        action={
          <Button
            size="lg"
            icon={RefreshCw}
            busy={loading}
            disabled={batchRunning}
            onClick={() => void refresh()}
          >
            {t('refresh')}
          </Button>
        }
      />

      {error && drives.length > 0 && (
        <Card role="alert" className="flex items-center gap-3">
          <AlertTriangle
            className="shrink-0 text-[var(--signal-danger-text)]"
            size={16}
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <p className="m-0 flex-1 text-[length:var(--text-13)]">
            {t('trimListFailed')}. {t('trimListFailedDescription')}
          </p>
          <Button
            variant="ghost"
            icon={X}
            aria-label={t('trimDismissError')}
            title={t('trimDismissError')}
            onClick={() => store.setError(null)}
          />
        </Card>
      )}

      {runResults.length > 0 && !batchRunning && (
        <TrimReceipt summary={runSummary} locale={i18n.language} />
      )}

      {drives.length === 0 ? (
        loading ? (
          <EmptyState title={t('trimLoadingTitle')} description={t('trimLoadingDescription')} />
        ) : error ? (
          <EmptyState title={t('trimListFailed')} description={t('trimListFailedDescription')} />
        ) : (
          <EmptyState title={t('trimEmptyTitle')} description={t('trimEmptyNoDrives')} />
        )
      ) : (
        <>
          <Card className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="min-w-0">
              <p className="m-0 font-[family-name:var(--font-display)] text-[length:var(--text-20)] leading-tight font-semibold tracking-[-0.01em] tabular-nums">
                {t('trimSummarySelected', { count: selectableSelected.length })}
              </p>
              <p className="m-0 mt-1 text-[length:var(--text-13)] text-[var(--text-secondary)] tabular-nums">
                {t('trimSummaryFound', { count: drives.length })}
                {recommendedCount > 0 && (
                  <>
                    {' · '}
                    <Tag tone="recommended">
                      {t('trimSummaryRecommended', { count: recommendedCount })}
                    </Tag>
                  </>
                )}
              </p>
            </div>
            <Button
              variant="primary"
              size="lg"
              busy={batchRunning}
              disabled={selectableSelected.length === 0}
              onClick={() => setConfirmOpen(true)}
            >
              {t('trimRunSelected', { count: selectableSelected.length })}
            </Button>
          </Card>

          <Section
            title={t('trimDrivesTitle')}
            actions={
              <Segmented
                label={t('trimFilterLabel')}
                options={filterOptions}
                value={filter}
                onChange={(value) => store.setFilter(value)}
              />
            }
          >
            {filtered.length === 0 ? (
              <p className="m-0 text-[length:var(--text-13)] text-[var(--text-muted)]">
                {t('trimEmptyFiltered')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <TableHeaderCell>
                      <span className="sr-only">{t('trimColSelect')}</span>
                    </TableHeaderCell>
                    <TableHeaderCell>{t('trimColDrive')}</TableHeaderCell>
                    <TableHeaderCell>{t('trimColType')}</TableHeaderCell>
                    <TableHeaderCell>{t('trimLastTrimmed')}</TableHeaderCell>
                    <TableHeaderCell>{t('trimColState')}</TableHeaderCell>
                  </TableHead>
                  <tbody>
                    {filtered.map((drive) => (
                      <DriveRow
                        key={drive.id}
                        drive={drive}
                        locale={i18n.language}
                        selected={selected.has(drive.id)}
                        runState={runStates[drive.id] ?? 'idle'}
                        result={results[drive.id]}
                        busy={batchRunning}
                        onToggle={() => store.toggleSelect(drive.id)}
                        showLog={showLog === drive.id}
                        onToggleLog={() => setShowLog(showLog === drive.id ? null : drive.id)}
                      />
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </Section>
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleRun}
        title={t('trimConfirmTitle', { count: selectableSelected.length })}
        description={t('trimConfirmBody')}
        details={selectableSelected
          .map((id) => {
            const d = drives.find((x) => x.id === id)
            return d ? driveName(d) : id
          })
          .join('\n')}
        confirmLabel={t('trimRunSelected', { count: selectableSelected.length })}
      />
    </div>
  )
}

function TrimReceipt({ summary, locale }: { summary: TrimRunSummary; locale: string }) {
  const { t } = useTranslation('disk')
  const problems = summary.failed + summary.blocked
  const title =
    summary.done === 0
      ? t('trimReceiptNone')
      : problems > 0
        ? t('trimReceiptPartial')
        : t('trimReceiptDone')
  return (
    <Receipt
      title={title}
      value={summary.done > 0 ? t('trimReceiptValue', { count: summary.done }) : undefined}
      facts={[
        summary.skipped > 0 ? t('trimReceiptSkipped', { count: summary.skipped }) : '',
        summary.blocked > 0 ? t('trimReceiptBlocked', { count: summary.blocked }) : '',
        summary.failed > 0 ? t('trimReceiptFailed', { count: summary.failed }) : '',
        summary.at ? formatDateTime(summary.at, locale) : '',
        t('trimReceiptNoChange')
      ]}
    />
  )
}

interface DriveRowProps {
  drive: TrimDriveInfo
  locale: string
  selected: boolean
  runState: RunState
  result?: TrimRunResult
  busy: boolean
  onToggle: () => void
  showLog: boolean
  onToggleLog: () => void
}

function DriveRow({
  drive,
  locale,
  selected,
  runState,
  result,
  busy,
  onToggle,
  showLog,
  onToggleLog
}: DriveRowProps) {
  const { t } = useTranslation('disk')
  const name = driveName(drive)
  const recommended = drive.status === 'recommended'
  const media = drive.mediaType === 'Unknown' ? t('trimMediaUnknown') : drive.mediaType
  const details = result ? [result.summary, result.log].filter(Boolean).join('\n\n') : ''
  return (
    <>
      <TableRow recommended={recommended} selected={selected}>
        <TableCell className="w-8">
          <Checkbox
            checked={selected}
            onChange={onToggle}
            label={t('trimSelectDrive', { drive: name })}
            disabled={!isSelectable(drive) || runState === 'running' || busy}
          />
        </TableCell>
        <TableCell>
          <span className="flex items-center gap-1.5 font-medium">
            {name}
            {drive.isEncrypted && (
              <Lock
                className="shrink-0 text-[var(--text-muted)]"
                size={12}
                strokeWidth={1.75}
                role="img"
                aria-label={t('trimEncrypted')}
              />
            )}
          </span>
          <span className="block text-[length:var(--text-12)] text-[var(--text-muted)] tabular-nums">
            {[drive.filesystem, formatBytes(drive.totalSize)].filter(Boolean).join(' · ')}
          </span>
        </TableCell>
        <TableCell muted className="whitespace-nowrap">
          {[media, drive.busType && drive.busType !== drive.mediaType ? drive.busType : null]
            .filter(Boolean)
            .join(' · ')}
        </TableCell>
        <TableCell muted className="whitespace-nowrap">
          {drive.lastTrimAt ? lastTrimText(drive.lastTrimAt, locale) : t('trimNeverRecorded')}
        </TableCell>
        <TableCell className="min-w-56">
          {runState === 'running' ? (
            <span className="flex flex-col gap-1.5">
              <span className="text-[length:var(--text-13)]">{t('trimRun.running')}</span>
              <span className="block w-40 max-w-full">
                <ProgressBar indeterminate label={t('trimProgressLabel', { drive: name })} />
              </span>
            </span>
          ) : result ? (
            <RunResultCell
              result={result}
              hasDetails={details !== ''}
              showLog={showLog}
              onToggleLog={onToggleLog}
            />
          ) : (
            <StatusCell drive={drive} />
          )}
        </TableCell>
      </TableRow>
      {showLog && details && (
        <tr>
          <td colSpan={5} className="pb-3">
            <pre className="m-0 max-h-40 overflow-auto rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--bg-subtle)] p-3 font-mono text-[length:var(--text-12)] whitespace-pre-wrap text-[var(--text-muted)]">
              {details}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}

function StatusCell({ drive }: { drive: TrimDriveInfo }) {
  const { t } = useTranslation('disk')
  const reason = trimReason(drive)
  const text =
    reason.key === 'discard'
      ? t('trimReason.discard', { size: formatBytes(reason.bytes) })
      : t(`trimReason.${reason.key}`)
  return (
    <span className="flex flex-col gap-0.5">
      <Tag tone={drive.status === 'recommended' ? 'recommended' : 'neutral'}>
        {t(`trimStatus.${drive.status}`)}
      </Tag>
      <span className="text-[length:var(--text-12)] text-[var(--text-muted)]">{text}</span>
    </span>
  )
}

function RunResultCell({
  result,
  hasDetails,
  showLog,
  onToggleLog
}: {
  result: TrimRunResult
  hasDetails: boolean
  showLog: boolean
  onToggleLog: () => void
}) {
  const { t } = useTranslation('disk')
  const state = trimRunState(result)
  const tone = state === 'done' ? 'ok' : state === 'failed' ? 'danger' : 'neutral'
  const detail =
    state === 'failed' && result.exitCode !== null
      ? t('trimRunDetail.failedCode', { code: result.exitCode })
      : t(`trimRunDetail.${state}`)
  return (
    <span className="flex flex-col items-start gap-0.5">
      <Tag tone={tone}>{t(`trimRun.${state}`)}</Tag>
      <span className="text-[length:var(--text-12)] text-[var(--text-muted)]">{detail}</span>
      {state === 'failed' && hasDetails && (
        <Button variant="ghost" className="mt-1" onClick={onToggleLog} aria-expanded={showLog}>
          {showLog ? t('hideLog') : t('showLog')}
        </Button>
      )}
    </span>
  )
}
