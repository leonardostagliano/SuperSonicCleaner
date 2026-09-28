import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FileText, RefreshCw, Download } from 'lucide-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { Link } from 'react-router-dom'
import type { CleanupReceipt, CleanupReceiptItem } from '@shared/cleanup-receipts'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { Receipt } from '@/components/shared/Receipt'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/Table'
import { receiptsListView } from '@/lib/cleanup-receipts-view'
import { formatBytes } from '@/lib/utils'

type StoredReceipt = CleanupReceipt & { retryable: number }
const COUNTS = ['selected', 'attempted', 'deleted', 'skipped', 'failed'] as const
const statusKey = (r: StoredReceipt) =>
  r.failed || r.skipped ? 'receipts.withIssues' : 'receipts.complete'
export function CleanupReceipts() {
  const { t } = useTranslation('history')
  const [receipts, setReceipts] = useState<StoredReceipt[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [details, setDetails] = useState<{ items: CleanupReceiptItem[]; total: number }>({
    items: [],
    total: 0
  })
  const [retry, setRetry] = useState<StoredReceipt | null>(null)
  const [clear, setClear] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const next = await window.kudu.cleanupReceipts()
      setReceipts(next)
      setSelected((current) =>
        next.some((r) => r.id === current) ? current : (next[0]?.id ?? null)
      )
      setError('')
    } catch {
      setError(t('receipts.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    let cancelled = false
    setDetails({ items: [], total: 0 })
    setDetailsLoading(!!selected)
    if (selected)
      window.kudu
        .cleanupReceiptDetails(selected, page)
        .then((data) => {
          if (!cancelled) setDetails(data)
        })
        .catch(() => {
          if (!cancelled) setError(t('receipts.loadError'))
        })
        .finally(() => {
          if (!cancelled) setDetailsLoading(false)
        })
    return () => {
      cancelled = true
    }
  }, [selected, page, t])
  const receipt = receipts.find((r) => r.id === selected)
  const view = receiptsListView({ loading, count: receipts.length, error: !!error })
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await action()
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('receipts.actionError'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="cleanup-receipts space-y-4" aria-label={t('receipts.title')}>
      <div className="flex flex-wrap items-center gap-3">
        <Button icon={RefreshCw} busy={loading} disabled={busy} onClick={() => void load()}>
          {t('receipts.refresh')}
        </Button>
        <Button
          variant="ghost"
          disabled={busy || (!receipts.length && !error)}
          onClick={() => setClear(true)}
        >
          {t('clearButton')}
        </Button>
        {view.toolbarDescription && (
          <p className="text-sm text-[var(--text-muted)]">{t('receipts.description')}</p>
        )}
      </div>
      {error && <ErrorAlert message={error} />}
      {loading && (
        <p role="status" className="text-sm text-[var(--text-muted)]">
          {t('receipts.loading')}
        </p>
      )}
      {view.empty && (
        <EmptyState
          icon={FileText}
          title={t('receipts.empty')}
          description={t('receipts.description')}
        />
      )}
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div className="max-h-[650px] space-y-2 overflow-auto">
          {receipts.map((r) => (
            <button
              key={r.id}
              className="w-full rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--card-bg)] px-4 py-3 text-start transition-colors hover:bg-[var(--bg-hover)] aria-pressed:border-[var(--border-stronger)] aria-pressed:bg-[var(--bg-active)]"
              aria-pressed={selected === r.id}
              onClick={() => {
                setSelected(r.id)
                setPage(0)
              }}
            >
              <Receipt
                compact
                title={new Date(r.startedAt).toLocaleString()}
                value={formatBytes(r.removedBytes)}
                facts={[r.categories.map((c) => c.name).join(', '), r.origin, t(statusKey(r))]}
              />
            </button>
          ))}
        </div>
        {receipt && (
          <div className="min-w-0 space-y-4">
            <Receipt
              title={t(statusKey(receipt))}
              value={t('receipts.bytes', { size: formatBytes(receipt.removedBytes) })}
              facts={[
                new Date(receipt.startedAt).toLocaleString(),
                ...COUNTS.map((key) => `${t('receipts.' + key)}: ${receipt[key].toLocaleString()}`)
              ]}
              skipped={
                receipt.reasons
                  .map((r) => `${r.reason}: ${r.count.toLocaleString()}`)
                  .join(' · ') || undefined
              }
            />
            <Card className="min-w-0 space-y-4">
              <p>
                {t('receipts.selectionContext', {
                  found: receipt.found ?? '—',
                  unselected: receipt.unselected ?? '—'
                })}
              </p>
              <p className="text-sm text-[var(--text-muted)]">{t('receipts.units')}</p>
              {receipt.volumeChanges?.map((volume) => (
                <p key={volume.volume}>
                  {t('receipts.volumeDelta', {
                    volume: volume.volume,
                    size: (volume.delta < 0 ? '−' : '+') + formatBytes(Math.abs(volume.delta))
                  })}
                </p>
              ))}
              {!!receipt.unknownSizeItems && (
                <p>{t('receipts.unknownSize', { count: receipt.unknownSizeItems })}</p>
              )}
              {receipt.parentId && (
                <p>
                  {t('receipts.retryOf')}{' '}
                  <button
                    className="underline"
                    onClick={() => {
                      setSelected(receipt.parentId!)
                      setPage(0)
                    }}
                  >
                    {receipt.parentId}
                  </button>
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  icon={Download}
                  disabled={busy}
                  onClick={() => void run(() => window.kudu.cleanupReceiptExport(receipt.id))}
                >
                  {t('receipts.export')}
                </Button>
                <Button disabled={busy || !receipt.retryable} onClick={() => setRetry(receipt)}>
                  {t('receipts.retry', { count: receipt.retryable })}
                </Button>
                <Link className="ui-button" data-variant="secondary" data-size="md" to="/cleaner">
                  {t('receipts.rescan')}
                </Link>
              </div>
              <p className="text-sm">{t('receipts.retryLifetime')}</p>
              {!receipt.pathLogging && <p className="text-sm">{t('receipts.pathsOff')}</p>}
              {detailsLoading && <p role="status">{t('receipts.loading')}</p>}
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <TableHeaderCell>{t('receipts.item')}</TableHeaderCell>
                    <TableHeaderCell>{t('receipts.outcome')}</TableHeaderCell>
                    <TableHeaderCell>{t('receipts.reason')}</TableHeaderCell>
                    <TableHeaderCell numeric>{t('receipts.removed')}</TableHeaderCell>
                  </TableHead>
                  <tbody>
                    {details.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="max-w-xs break-all">
                          {item.path ?? item.category}
                        </TableCell>
                        <TableCell>{t('receipts.' + item.outcome)}</TableCell>
                        <TableCell muted className="break-all">
                          {item.reason || '—'}
                        </TableCell>
                        <TableCell numeric>{formatBytes(item.removedBytes)}</TableCell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  disabled={detailsLoading || !page}
                  onClick={() => setPage(page - 1)}
                >
                  {t('receipts.previous')}
                </Button>
                <span className="tabular-nums">
                  {page + 1} / {Math.max(1, Math.ceil(details.total / 50))}
                </span>
                <Button
                  variant="ghost"
                  disabled={detailsLoading || (page + 1) * 50 >= details.total}
                  onClick={() => setPage(page + 1)}
                >
                  {t('receipts.next')}
                </Button>
              </div>
              {!!receipt.detailsTruncated && (
                <p>{t('receipts.truncated', { count: receipt.detailsTruncated })}</p>
              )}
            </Card>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={!!retry}
        onCancel={() => setRetry(null)}
        title={t('receipts.retryTitle')}
        description={t('receipts.retryDescription')}
        confirmLabel={t('receipts.retryConfirm')}
        onConfirm={() => {
          const id = retry!.id
          setRetry(null)
          void run(async () => {
            const result = await window.kudu.cleanupReceiptRetry(id)
            if (result.receiptSaved === false) throw new Error(t('receipts.saveError'))
            if (result.receiptId) {
              setSelected(result.receiptId)
              setPage(0)
            }
          })
        }}
      />
      <ConfirmDialog
        open={clear}
        variant="danger"
        onCancel={() => setClear(false)}
        title={t('receipts.clearTitle')}
        description={t('receipts.clearDescription')}
        confirmLabel={t('clearButton')}
        onConfirm={() => {
          setClear(false)
          setSelected(null)
          void run(() => window.kudu.cleanupReceiptsClear())
        }}
      />
    </section>
  )
}
