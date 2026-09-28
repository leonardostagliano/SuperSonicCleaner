import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ChevronRight,
  FileDown,
  FolderOpen,
  FolderPlus,
  Trash2,
  X
} from 'lucide-react'
import { StorageTrendChart } from '@/components/perf/StorageTrendChart'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
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
  TableRow
} from '@/components/ui'
import { formatBytes, NO_VALUE } from '@/lib/utils'
import { formatCount, formatDateTime } from '@/lib/storage-tools-format'
import { ipcErrorDetail, latestSnapshot, trendView } from '@/lib/storage-history-view'
import type { StorageScope } from '@shared/storage-history'

/** Reason tokens the scanner emits; anything else is free-form error text shown verbatim. */
const knownReasons = new Set([
  'limit',
  'changed',
  'inaccessible',
  'excluded',
  'cancelled',
  'unavailable'
])

/** Form controls on tokens (no shared field primitive yet). */
const FIELD =
  'h-9 min-w-0 rounded-[var(--radius-control)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[length:var(--text-13)] text-[var(--text-primary)] disabled:opacity-50'
const LINK =
  'inline-flex items-center gap-1 text-[length:var(--text-13)] text-[var(--text-secondary)] underline decoration-[var(--border-strong)] underline-offset-[3px] hover:text-[var(--text-primary)]'
const NOTE = 'm-0 text-[length:var(--text-12)] leading-normal text-[var(--text-muted)]'

const signed = (bytes: number) => `${bytes >= 0 ? '+' : '−'}${formatBytes(Math.abs(bytes))}`

export function StorageHistoryPage() {
  const { t, i18n } = useTranslation('disk')
  const locale = i18n.language
  const [scopeId, setScopeId] = useState(''),
    [offset, setOffset] = useState(0)
  const [data, setData] = useState<Awaited<
    ReturnType<typeof window.kudu.storageHistoryList>
  > | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [before, setBefore] = useState(''),
    [after, setAfter] = useState(''),
    [page, setPage] = useState(0)
  const [comparison, setComparison] = useState<Awaited<
    ReturnType<typeof window.kudu.storageHistoryCompare>
  > | null>(null)
  const [deleting, setDeleting] = useState<{ id: string; scope: boolean } | null>(null)
  // The form mounts only while its disclosure is open (closed content still gets layout boxes).
  const [settingsOpen, setSettingsOpen] = useState(false)
  const refresh = useCallback(async () => {
    const result = await window.kudu.storageHistoryList(scopeId, offset)
    setData(result)
    if (!scopeId && result.scopes[0]) setScopeId(result.scopes[0].id)
  }, [scopeId, offset])
  useEffect(() => {
    let mounted = true
    const read = async () => {
      try {
        const result = await window.kudu.storageHistoryList(scopeId, offset)
        if (mounted) {
          setData(result)
          setError('')
          setLoading(false)
          if (!scopeId && result.scopes[0]) setScopeId(result.scopes[0].id)
        }
      } catch (e) {
        if (mounted) {
          setError(e instanceof Error ? e.message : t('storage.loadError'))
          setLoading(false)
        }
      }
    }
    void read()
    const timer = setInterval(() => void read(), 5000)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [scopeId, offset, t])
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('storage.actionError'))
    } finally {
      setBusy(false)
    }
  }
  const compare = async (nextPage = 0) => {
    setPage(nextPage)
    await run(async () =>
      setComparison(await window.kudu.storageHistoryCompare(before, after, nextPage))
    )
  }
  const addFolder = () =>
    void run(async () => {
      const added = await window.kudu.storageHistoryAdd()
      if (added) {
        setScopeId(added.id)
        setOffset(0)
      }
    })

  const scopes = data?.scopes ?? []
  const snapshots = data?.snapshots ?? []
  const scope = scopes.find((s) => s.id === scopeId)
  const capture = data?.capture
  const capturedScope = capture && scopes.find((s) => s.id === capture.scopeId)
  const latest = latestSnapshot(snapshots)
  const trend = trendView(snapshots)
  const when = (id: string) => {
    const s = snapshots.find((x) => x.id === id)
    return s ? formatDateTime(s.createdAt, locale) : NO_VALUE
  }
  const sizeOf = (s: (typeof snapshots)[number]) =>
    s.status === 'unavailable'
      ? t('storage.unavailable')
      : `${formatBytes(s.totalBytes)}${s.status === 'partial' || s.status === 'cancelled' ? '+' : ''}`
  const deletingSnapshot = deleting && !deleting.scope ? deleting.id : ''

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t('storage.title')}
        description={t('storage.description')}
        action={
          <Button
            variant={scopes.length ? 'secondary' : 'primary'}
            size="lg"
            icon={FolderPlus}
            disabled={busy}
            onClick={addFolder}
          >
            {t('storage.add')}
          </Button>
        }
      />

      {error && (
        <Card role="alert" className="flex items-start gap-3">
          <AlertTriangle
            className="mt-0.5 shrink-0 text-[var(--signal-danger-text)]"
            size={16}
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[length:var(--text-13)]">
              {loading || !data ? t('storage.loadError') : t('storage.actionError')}
            </p>
            <p className={`${NOTE} mt-0.5 break-words`}>{ipcErrorDetail(error)}</p>
          </div>
          <Button
            variant="ghost"
            icon={X}
            aria-label={t('storage.dismissError')}
            title={t('storage.dismissError')}
            onClick={() => setError('')}
          />
        </Card>
      )}

      {loading && (
        <p role="status" className={NOTE}>
          {t('storage.loading')}
        </p>
      )}

      {!loading && !error && scopes.length === 0 && (
        <EmptyState
          title={t('storage.emptyTitle')}
          description={t('storage.emptyDescription')}
          checks={[
            { title: t('storage.checks.readTitle'), detail: t('storage.checks.readDetail') },
            { title: t('storage.checks.skipTitle'), detail: t('storage.checks.skipDetail') },
            { title: t('storage.checks.keptTitle'), detail: t('storage.checks.keptDetail') }
          ]}
        />
      )}

      {scopes.length > 0 && (
        <Section
          title={t('storage.folderSection')}
          actions={
            <label className="flex min-w-0 items-center gap-2">
              <span className="text-[length:var(--text-13)] text-[var(--text-secondary)]">
                {t('storage.folder')}
              </span>
              <select
                className={`${FIELD} max-w-[18rem]`}
                value={scopeId}
                onChange={(e) => {
                  setScopeId(e.target.value)
                  setOffset(0)
                  setBefore('')
                  setAfter('')
                  setComparison(null)
                }}
              >
                <option value="">{t('storage.choose')}</option>
                {scopes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          }
        >
          {scope ? (
            <div className="flex flex-col gap-3">
              <div>
                <p className="m-0 font-mono text-[length:var(--text-12)] break-all text-[var(--text-secondary)]">
                  {scope.path}
                </p>
                <p className="m-0 mt-1 text-[length:var(--text-13)] tabular-nums">
                  {latest
                    ? t('storage.latest', {
                        time: formatDateTime(latest.createdAt, locale),
                        size: sizeOf(latest),
                        status: t('storage.status.' + latest.status)
                      })
                    : t('storage.noSnapshot')}
                </p>
              </div>
              {capture && (
                <div role="status" className="flex max-w-xl flex-col gap-2">
                  <p className="m-0 text-[length:var(--text-13)] text-[var(--text-secondary)]">
                    {capture.scopeId === scope.id
                      ? t('storage.capturing', {
                          time: formatDateTime(capture.startedAt, locale)
                        })
                      : t('storage.capturingOther', {
                          folder: capturedScope?.name ?? capturedScope?.path ?? capture.scopeId,
                          time: formatDateTime(capture.startedAt, locale)
                        })}
                  </p>
                  <ProgressBar indeterminate label={t('storage.captureProgressLabel')} />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {capture ? (
                  <Button
                    icon={X}
                    onClick={() =>
                      void window.kudu.storageHistoryCancel().catch((e) => setError(String(e)))
                    }
                  >
                    {t('storage.cancel')}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await window.kudu.storageHistoryCapture(scope.id)
                        setOffset(0)
                      })
                    }
                  >
                    {t('storage.capture')}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={busy || !!capture}
                  onClick={() => setDeleting({ id: scope.id, scope: true })}
                >
                  {t('storage.removeFolder')}
                </Button>
              </div>
              <details
                className="border-t border-[var(--border-default)] pt-3"
                open={settingsOpen}
                onToggle={(e) => setSettingsOpen(e.currentTarget.open)}
              >
                <summary className="cursor-pointer text-[length:var(--text-13)] font-semibold text-[var(--text-primary)]">
                  {t('storage.settings')}
                </summary>
                {settingsOpen && (
                  <ScopeSettings
                    key={scope.id}
                    scope={scope}
                    disabled={busy}
                    save={(config) =>
                      run(() => window.kudu.storageHistoryConfigure(scope.id, config))
                    }
                  />
                )}
              </details>
              <p className={NOTE}>{t('storage.privacy')}</p>
            </div>
          ) : (
            <p className={NOTE}>{t('storage.chooseHint')}</p>
          )}
        </Section>
      )}

      {scope && (
        <>
          {trend.kind === 'chart' ? (
            <StorageTrendChart snapshots={snapshots} />
          ) : (
            <Section title={t('storage.trendTitle')}>
              <p className="m-0 text-[length:var(--text-13)] text-[var(--text-secondary)] tabular-nums">
                {trend.kind === 'none'
                  ? t('storage.trendNone')
                  : trend.kind === 'one'
                    ? t('storage.trendOne', { size: formatBytes(trend.bytes) })
                    : t('storage.trendFlat', {
                        count: trend.count,
                        size: formatBytes(trend.bytes)
                      })}
              </p>
            </Section>
          )}

          <Section
            title={t('storage.snapshots')}
            meta={data?.total ? t('storage.snapshotsMeta', { count: data.total }) : undefined}
          >
            {!snapshots.length ? (
              <p className={NOTE}>{t('storage.empty')}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <TableHeaderCell>{t('storage.time')}</TableHeaderCell>
                    <TableHeaderCell>{t('storage.coverage')}</TableHeaderCell>
                    <TableHeaderCell numeric>{t('storage.logicalSize')}</TableHeaderCell>
                    <TableHeaderCell numeric>{t('storage.free')}</TableHeaderCell>
                    <TableHeaderCell>{t('storage.compareCol')}</TableHeaderCell>
                    <TableHeaderCell>
                      <span className="sr-only">{t('storage.actions')}</span>
                    </TableHeaderCell>
                  </TableHead>
                  <tbody>
                    {snapshots.map((s) => (
                      <TableRow key={s.id} selected={before === s.id || after === s.id}>
                        <TableCell className="whitespace-nowrap">
                          {formatDateTime(s.createdAt, locale)}
                          <span className={`${NOTE} block`}>
                            {t('storage.duration', { seconds: Math.round(s.durationMs / 1000) })}
                          </span>
                        </TableCell>
                        <TableCell>
                          {t('storage.status.' + s.status)}
                          {s.reason && (
                            <span className={`${NOTE} block`}>
                              {knownReasons.has(s.reason)
                                ? t('storage.reason.' + s.reason)
                                : s.reason}
                            </span>
                          )}
                          {s.skipped > 0 && (
                            <span className={`${NOTE} block`}>
                              {t('storage.skipped', { count: s.skipped })}
                            </span>
                          )}
                        </TableCell>
                        <TableCell numeric>{sizeOf(s)}</TableCell>
                        <TableCell numeric>
                          {s.volumeFree === null
                            ? t('storage.unavailable')
                            : formatBytes(s.volumeFree)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className="flex gap-1">
                            <Button
                              variant="ghost"
                              aria-pressed={before === s.id}
                              disabled={busy}
                              onClick={() => {
                                setBefore(s.id)
                                setComparison(null)
                              }}
                            >
                              {t('storage.before')}
                            </Button>
                            <Button
                              variant="ghost"
                              aria-pressed={after === s.id}
                              disabled={busy}
                              onClick={() => {
                                setAfter(s.id)
                                setComparison(null)
                              }}
                            >
                              {t('storage.after')}
                            </Button>
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              icon={FileDown}
                              aria-label={t('storage.export')}
                              title={t('storage.export')}
                              disabled={busy}
                              onClick={() => void run(() => window.kudu.storageHistoryExport(s.id))}
                            />
                            <Button
                              variant="ghost"
                              icon={Trash2}
                              aria-label={t('storage.deleteSnapshot')}
                              title={t('storage.deleteSnapshot')}
                              disabled={busy || !!capture}
                              onClick={() => setDeleting({ id: s.id, scope: false })}
                            />
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
            {!!data?.total && data.total > 50 && (
              <div className="mt-3 flex items-center gap-3">
                <Button
                  variant="ghost"
                  disabled={busy || offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 50))}
                >
                  {t('storage.previous')}
                </Button>
                <span className="text-[length:var(--text-13)] text-[var(--text-secondary)] tabular-nums">
                  {t('storage.pageRange', {
                    from: formatCount(offset + 1, locale),
                    to: formatCount(Math.min(offset + 50, data.total), locale),
                    total: formatCount(data.total, locale)
                  })}
                </span>
                <Button
                  variant="ghost"
                  disabled={busy || offset + 50 >= data.total}
                  onClick={() => setOffset(offset + 50)}
                >
                  {t('storage.next')}
                </Button>
              </div>
            )}
          </Section>

          <Section
            title={t('storage.compare')}
            actions={
              <Button
                disabled={busy || !before || !after || before === after}
                onClick={() => void compare()}
              >
                {t('storage.compareButton')}
              </Button>
            }
          >
            <p className="m-0 text-[length:var(--text-13)] text-[var(--text-secondary)]">
              {t('storage.compareHint')}
            </p>
            <p className="m-0 mt-1 text-[length:var(--text-13)] tabular-nums">
              {t('storage.compareSelection', {
                before: before ? when(before) : NO_VALUE,
                after: after ? when(after) : NO_VALUE
              })}
            </p>
            {comparison && !comparison.comparable && (
              <p role="status" className="m-0 mt-3 text-[length:var(--text-13)]">
                {t('storage.comparisonReason.' + comparison.reason)}
              </p>
            )}
            {comparison?.comparable && (
              <div className="mt-4 flex flex-col gap-3">
                <p className="m-0 font-[family-name:var(--font-display)] text-[length:var(--text-20)] leading-tight font-semibold tracking-[-0.01em] tabular-nums">
                  {t('storage.totalChangeValue', { delta: signed(comparison.delta ?? 0) })}
                </p>
                <p className={NOTE}>{t('storage.overlap')}</p>
                {comparison.rows.length ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHead>
                        <TableHeaderCell>{t('storage.folder')}</TableHeaderCell>
                        <TableHeaderCell>{t('storage.change')}</TableHeaderCell>
                        <TableHeaderCell numeric>{t('storage.before')}</TableHeaderCell>
                        <TableHeaderCell numeric>{t('storage.after')}</TableHeaderCell>
                        <TableHeaderCell numeric>{t('storage.delta')}</TableHeaderCell>
                        <TableHeaderCell>
                          <span className="sr-only">{t('storage.actions')}</span>
                        </TableHeaderCell>
                      </TableHead>
                      <tbody>
                        {comparison.rows.map((row) => (
                          <TableRow key={row.path}>
                            <TableCell className="max-w-sm font-mono text-[length:var(--text-12)] break-all">
                              {row.path}
                            </TableCell>
                            <TableCell muted className="whitespace-nowrap">
                              {t('storage.changeType.' + row.change)}
                            </TableCell>
                            <TableCell numeric>
                              {row.before === null ? NO_VALUE : formatBytes(row.before)}
                            </TableCell>
                            <TableCell numeric>
                              {row.after === null ? NO_VALUE : formatBytes(row.after)}
                            </TableCell>
                            <TableCell numeric>{signed(row.delta)}</TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                icon={FolderOpen}
                                aria-label={t('storage.open')}
                                title={t('storage.open')}
                                disabled={busy || row.after === null}
                                onClick={() =>
                                  void run(() => window.kudu.storageHistoryOpen(after, row.path))
                                }
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                ) : (
                  <p className="m-0 text-[length:var(--text-13)]">{t('storage.noChanges')}</p>
                )}
                {comparison.total > 50 && (
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      disabled={busy || page === 0}
                      onClick={() => void compare(Math.max(0, page - 50))}
                    >
                      {t('storage.previous')}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy || page + 50 >= comparison.total}
                      onClick={() => void compare(page + 50)}
                    >
                      {t('storage.next')}
                    </Button>
                  </div>
                )}
                <p className="m-0 flex flex-wrap gap-x-4 gap-y-1">
                  <Link className={LINK} to="/cleaner">
                    {t('storage.openCleaner')}
                    <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
                  </Link>
                  <Link className={LINK} to="/history">
                    {t('storage.openActivity')}
                    <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
                  </Link>
                </p>
              </div>
            )}
          </Section>

          <Section title={t('storage.projection')}>
            {data?.projection ? (
              <>
                <p className="m-0 text-[length:var(--text-13)] tabular-nums">
                  {t('storage.projectionValue', {
                    days: formatCount(Math.round(data.projection.daysRemaining), locale),
                    growth: formatBytes(data.projection.bytesPerDay)
                  })}
                </p>
                <p className="m-0 mt-1 text-[length:var(--text-13)] text-[var(--text-secondary)] tabular-nums">
                  {t('storage.projectionRange', {
                    min: formatCount(Math.round(data.projection.earliestDays), locale),
                    max: formatCount(Math.round(data.projection.latestDays), locale),
                    count: data.projection.observations
                  })}
                </p>
              </>
            ) : (
              <p className="m-0 text-[length:var(--text-13)] text-[var(--text-secondary)]">
                {t('storage.noProjection')}
              </p>
            )}
            <p className={`${NOTE} mt-2`}>{t('storage.projectionCaution')}</p>
          </Section>
        </>
      )}

      {scopes.length > 0 && (
        <p className="m-0">
          <Link className={LINK} to="/disk">
            {t('storage.overview')}
            <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </p>
      )}

      <ConfirmDialog
        open={!!deleting}
        variant="danger"
        title={
          deleting?.scope
            ? t('storage.deleteScopeTitle', { folder: scope?.name ?? scope?.path ?? '' })
            : t('storage.deleteSnapshotTitle', { time: when(deletingSnapshot) })
        }
        description={deleting?.scope ? t('storage.deleteScopeConfirm') : t('storage.deleteConfirm')}
        confirmLabel={
          deleting?.scope ? t('storage.deleteScopeButton') : t('storage.deleteSnapshot')
        }
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const item = deleting!
          setDeleting(null)
          void run(async () => {
            await window.kudu.storageHistoryDelete(item.id, item.scope)
            setBefore('')
            setAfter('')
            setComparison(null)
            setOffset(0)
            if (item.scope) setScopeId('')
          })
        }}
      />
    </div>
  )
}

function ScopeSettings({
  scope,
  disabled,
  save
}: {
  scope: StorageScope
  disabled: boolean
  save: (
    config: Pick<StorageScope, 'daily' | 'growthAlertBytes' | 'freeAlertPercent'>
  ) => Promise<void>
}) {
  const { t } = useTranslation('disk')
  const [daily, setDaily] = useState(scope.daily),
    [growth, setGrowth] = useState(
      scope.growthAlertBytes === null ? '' : String(scope.growthAlertBytes / 1073741824)
    ),
    [free, setFree] = useState(
      scope.freeAlertPercent === null ? '' : String(scope.freeAlertPercent)
    )
  return (
    <form
      className="mt-3 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void save({
          daily,
          growthAlertBytes: growth ? Math.round(Number(growth) * 1073741824) : null,
          freeAlertPercent: free ? Number(free) : null
        })
      }}
    >
      <label className="flex items-center gap-2 text-[length:var(--text-13)]">
        <Checkbox
          checked={daily}
          disabled={disabled}
          onChange={setDaily}
          label={t('storage.daily')}
        />
        {t('storage.daily')}
      </label>
      <p className={NOTE}>{t('storage.dailyHint')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[length:var(--text-13)] text-[var(--text-secondary)]">
          {t('storage.growthAlert')}
          <input
            className={FIELD}
            type="number"
            min={0.01}
            max={900000}
            step={0.01}
            value={growth}
            onChange={(e) => setGrowth(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-[length:var(--text-13)] text-[var(--text-secondary)]">
          {t('storage.freeAlert')}
          <input
            className={FIELD}
            type="number"
            min={1}
            max={100}
            step={1}
            value={free}
            onChange={(e) => setFree(e.target.value)}
          />
        </label>
      </div>
      <div>
        <Button type="submit" disabled={disabled}>
          {t('storage.save')}
        </Button>
      </div>
    </form>
  )
}
