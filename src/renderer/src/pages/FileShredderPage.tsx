import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { File, FilePlus2, Folder, FolderOpen, FolderPlus, RotateCcw, X } from 'lucide-react'
import type { ShredderResult } from '@shared/types'
import { formatBytes } from '@/lib/utils'
import { icons } from '@/lib/icons'
import { formatCount, formatDateTime, formatPercent } from '@/lib/storage-tools-format'
import { shredReasonKey, shredderTotals } from '@/lib/shredder-view'
import { useFileShredderStore } from '@/stores/file-shredder-store'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { Receipt } from '@/components/shared/Receipt'
import {
  Button,
  Card,
  ProgressBar,
  Section,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow
} from '@/components/ui'

/** When each result arrived; the store keeps the result, the receipt needs its time. */
const finishedAt = new WeakMap<ShredderResult, number>()

export function FileShredderPage() {
  const { t, i18n } = useTranslation('fileShredder')
  const store = useFileShredderStore()
  const [showConfirm, setShowConfirm] = useState(false)
  const locale = i18n.language
  const count = (value: number) => formatCount(value, locale)

  const totals = useMemo(() => shredderTotals(store.entries), [store.entries])
  const size = formatBytes(totals.bytes)
  const items = store.entries.length
  const shredding = store.status === 'shredding'
  const complete = store.status === 'complete'
  const result = store.result

  const handleAddFiles = async () => {
    const entries = await window.kudu?.shredderSelectFiles?.()
    if (entries?.length) store.addEntries(entries)
  }

  const handleAddFolders = async () => {
    const entries = await window.kudu?.shredderSelectFolders?.()
    if (entries?.length) store.addEntries(entries)
  }

  const handleShred = async () => {
    setShowConfirm(false)
    store.setStatus('shredding')
    try {
      const paths = store.entries.map((e) => e.path)
      const outcome = await window.kudu?.shredderShred?.(paths)
      if (outcome) {
        finishedAt.set(outcome, Date.now())
        store.setResult(outcome)
        const shredded = { count: outcome.shredded, files: count(outcome.shredded) }
        const destroyed = formatBytes(outcome.bytesShredded)
        if (outcome.cancelled) {
          // Back to idle so the remaining entries stay visible for another try
          store.setStatus('idle')
          if (outcome.shredded > 0)
            toast.success(t('shredCancelled', { ...shredded, size: destroyed }))
        } else {
          store.setStatus('complete')
          if (outcome.shredded > 0)
            toast.success(t('shredSuccess', { ...shredded, size: destroyed }))
        }
        if (outcome.failed > 0) {
          toast.error(t('shredFailed', { count: outcome.failed, failed: count(outcome.failed) }))
        }
      }
    } catch {
      store.setStatus('idle')
    }
  }

  const handleCancel = async () => {
    await window.kudu?.shredderCancel?.()
  }

  const headerAction = complete ? (
    <Button variant="primary" size="lg" icon={RotateCcw} onClick={() => store.reset()}>
      {t('shredAnother')}
    </Button>
  ) : shredding ? undefined : (
    <>
      <Button
        variant={items === 0 ? 'primary' : 'secondary'}
        size="lg"
        icon={FilePlus2}
        onClick={handleAddFiles}
      >
        {t('addFiles')}
      </Button>
      <Button size="lg" icon={FolderPlus} onClick={handleAddFolders}>
        {t('addFolders')}
      </Button>
    </>
  )

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={t('pageTitle')} description={t('pageDescription')} action={headerAction} />

      {shredding && (
        <Section
          title={t('progressTitle')}
          meta={
            store.progress
              ? formatPercent(Math.min(100, store.progress.progress) / 100, locale)
              : undefined
          }
          actions={
            <Button icon={X} onClick={handleCancel}>
              {t('cancelShred')}
            </Button>
          }
        >
          <ProgressBar
            label={t('progressLabel')}
            value={store.progress ? Math.min(100, store.progress.progress) / 100 : undefined}
          />
          {store.progress && (
            <p className="mt-3 text-[length:var(--text-13)] text-[var(--text-secondary)] tabular-nums">
              {t('progressFiles', {
                done: count(store.progress.filesShredded),
                total: count(store.progress.totalFiles),
                doneSize: formatBytes(store.progress.bytesShredded),
                totalSize: formatBytes(store.progress.totalBytes)
              })}
            </p>
          )}
          {store.progress?.currentPath && (
            <p
              className="mt-1 truncate font-mono text-[length:var(--text-12)] text-[var(--text-muted)]"
              title={store.progress.currentPath}
            >
              {store.progress.currentPath}
            </p>
          )}
          <p className="mt-3 text-[length:var(--text-12)] text-[var(--text-muted)]">
            {t('cancelNote')}
          </p>
        </Section>
      )}

      {result && !shredding && (complete || result.cancelled) && (
        <ShredReceipt result={result} locale={locale} />
      )}

      {store.status === 'idle' && items > 0 && (
        <>
          <Card className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="min-w-0">
              <p className="font-[family-name:var(--font-display)] text-[length:var(--text-20)] font-semibold leading-tight tracking-[-0.01em] tabular-nums">
                {t('summaryValue', { size })}
              </p>
              <p className="mt-1 text-[length:var(--text-13)] text-[var(--text-secondary)] tabular-nums">
                {t('summaryItems', { count: items, items: count(items) })}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" icon={X} onClick={() => store.clearEntries()}>
                {t('clearAll')}
              </Button>
              <Button
                variant="primary"
                size="lg"
                icon={icons.shredder}
                onClick={() => setShowConfirm(true)}
              >
                {t('shredSize', { size })}
              </Button>
            </div>
          </Card>

          <Card className="overflow-x-auto">
            <Table>
              <TableHead>
                <TableHeaderCell>{t('colPath')}</TableHeaderCell>
                <TableHeaderCell>{t('colType')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('colSize')}</TableHeaderCell>
                <TableHeaderCell>
                  <span className="sr-only">{t('colActions')}</span>
                </TableHeaderCell>
              </TableHead>
              <tbody>
                {store.entries.map((entry) => {
                  const Kind = entry.isDirectory ? Folder : File
                  return (
                    <TableRow key={entry.path}>
                      <TableCell className="max-w-0 w-full">
                        <span className="flex min-w-0 items-center gap-2">
                          <Kind
                            className="shrink-0 text-[var(--text-muted)]"
                            size={16}
                            strokeWidth={1.75}
                            aria-hidden="true"
                          />
                          <span
                            className="truncate font-mono text-[length:var(--text-12)]"
                            title={entry.path}
                          >
                            {entry.path}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell muted className="whitespace-nowrap">
                        {entry.isDirectory ? t('folder') : t('file')}
                      </TableCell>
                      <TableCell numeric>{formatBytes(entry.size)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            icon={FolderOpen}
                            aria-label={t('openLocation')}
                            title={t('openLocation')}
                            onClick={() => window.kudu?.shredderOpenLocation?.(entry.path)}
                          />
                          <Button
                            variant="ghost"
                            icon={X}
                            aria-label={t('remove')}
                            title={t('remove')}
                            onClick={() => store.removeEntry(entry.path)}
                          />
                        </span>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {store.status === 'idle' && items === 0 && !result && (
        <EmptyState
          title={t('emptyTitle')}
          description={t('emptyDescription')}
          checks={[
            { title: t('checks.protectedTitle'), detail: t('checks.protectedDetail') },
            { title: t('checks.changedTitle'), detail: t('checks.changedDetail') },
            { title: t('checks.linksTitle'), detail: t('checks.linksDetail') }
          ]}
        />
      )}

      <ConfirmDialog
        open={showConfirm}
        onConfirm={handleShred}
        onCancel={() => setShowConfirm(false)}
        title={t('confirmTitle', { count: items, items: count(items), size })}
        description={t('confirmBody')}
        details={store.entries.map((e) => e.path).join('\n')}
        variant="danger"
        confirmLabel={t('shredSize', { size })}
      />
    </div>
  )
}

/** The outcome of the last run: completed or stopped, with the files it could not destroy. */
function ShredReceipt({ result, locale }: { result: ShredderResult; locale: string }) {
  const { t } = useTranslation('fileShredder')
  const when = finishedAt.get(result)
  const facts = [
    t('receiptFiles', { count: result.shredded, files: formatCount(result.shredded, locale) }),
    when ? formatDateTime(when, locale) : '',
    result.cancelled ? t('receiptCurrentKept') : t('receiptIrreversible')
  ]
  return (
    <>
      <Receipt
        title={result.cancelled ? t('receiptCancelledTitle') : t('receiptTitle')}
        value={t('receiptValue', { size: formatBytes(result.bytesShredded) })}
        facts={facts}
        skipped={
          result.failed > 0
            ? t('receiptFailed', {
                count: result.failed,
                failed: formatCount(result.failed, locale)
              })
            : undefined
        }
      />
      {result.errors.length > 0 && (
        <Section title={t('failuresTitle')}>
          <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <TableHeaderCell>{t('colPath')}</TableHeaderCell>
                <TableHeaderCell>{t('colReason')}</TableHeaderCell>
              </TableHead>
              <tbody>
                {result.errors.map((error) => {
                  const key = shredReasonKey(error.reason)
                  return (
                    <TableRow key={`${error.path}|${error.reason}`}>
                      <TableCell className="break-all font-mono text-[length:var(--text-12)]">
                        {error.path}
                      </TableCell>
                      <TableCell muted>{key ? t(`reason.${key}`) : error.reason}</TableCell>
                    </TableRow>
                  )
                })}
              </tbody>
            </Table>
          </div>
        </Section>
      )}
    </>
  )
}
