import './recovery-page.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { AlertTriangle, Download, FolderOpen, RefreshCw } from 'lucide-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button, Card, Section, Tag, type TagTone } from '@/components/ui'
import { formatBytes, NO_VALUE } from '@/lib/utils'
import { icons } from '@/lib/icons'
import { formatCount, formatDateTime } from '@/lib/history-report'
import { describeRecoveryValue } from '@/lib/recovery-value'
import { usePlatform } from '@/hooks/usePlatform'
import type { RecoveryEntry, RegistryBackup } from '@shared/recovery'

/** Drop Electron's "Error invoking remote method '…': Error:" prefix from IPC rejections. */
const ipcMessage = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    ''
  )

type RecoveryList = Awaited<ReturnType<typeof window.kudu.recoveryList>>

/** First page of the last visit: shown at once next time while it revalidates. */
let lastFirstPage: { data: RecoveryList; registry: RegistryBackup[] } | null = null

const PAGE_SIZE = 50

/** Colour only where the state is a verified result or needs action. */
const statusTone: Record<RecoveryEntry['status'], TagTone> = {
  pending: 'neutral',
  ready: 'neutral',
  restored: 'ok',
  failed: 'danger',
  conflict: 'neutral'
}

export function RecoveryPage() {
  const { t, i18n } = useTranslation('history')
  const locale = i18n.language
  const [data, setData] = useState<RecoveryList | null>(lastFirstPage?.data ?? null)
  const [offset, setOffset] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [remove, setRemove] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<RecoveryEntry | null>(null)
  const isWin = usePlatform().platform === 'win32'
  const [registryBackups, setRegistryBackups] = useState<RegistryBackup[]>(
    lastFirstPage?.registry ?? []
  )
  const [registryConfirm, setRegistryConfirm] = useState<RegistryBackup | null>(null)
  // Restoring a registry backup always needs elevation; null until known.
  const [elevated, setElevated] = useState<boolean | null>(null)
  useEffect(() => {
    if (!isWin) return
    window.kudu
      .elevationCheck()
      .then((value) => setElevated(!!value))
      .catch(() => setElevated(false))
  }, [isWin])
  const [registryResults, setRegistryResults] = useState<
    Record<string, { ok: boolean; message: string }>
  >({})
  // Only the newest request may update the page: a slower earlier page load must
  // not overwrite the result of a later one.
  const request = useRef(0)
  const refresh = useCallback(async () => {
    const token = ++request.current
    setLoading(true)
    try {
      const [result, registry] = await Promise.all([
        window.kudu.recoveryList(offset),
        isWin ? window.kudu.recoveryRegistryBackups() : Promise.resolve([])
      ])
      if (token !== request.current) return
      setData(result)
      setRegistryBackups(registry)
      if (offset === 0) lastFirstPage = { data: result, registry }
      setError('')
    } catch (e) {
      if (token !== request.current) return
      setError(e instanceof Error ? e.message : t('recovery.loadError'))
    }
    setLoading(false)
  }, [offset, t, isWin])
  useEffect(() => {
    void refresh()
  }, [refresh])
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('recovery.failed'))
    } finally {
      setBusy(false)
    }
  }
  const restoreRegistry = async (backup: RegistryBackup) => {
    setBusy(true)
    let outcome: { ok: boolean; message: string }
    try {
      const result = await window.kudu.recoveryRegistryRestore(backup.name)
      outcome = {
        ok: true,
        message: result.preRestoreBackup
          ? t('recovery.registryBackups.restored', { file: result.preRestoreBackup })
          : t('recovery.registryBackups.restoredNoBackup')
      }
    } catch (e) {
      outcome = {
        ok: false,
        message: t('recovery.registryBackups.failed', { error: ipcMessage(e) })
      }
    }
    setRegistryResults((results) => ({ ...results, [backup.name]: outcome }))
    await refresh()
    setBusy(false)
  }
  const count = (n: number) => formatCount(n, locale)
  // Until the first result (or error) arrives, the list and the backups below it are
  // unknown: a placeholder holds their place and they mount with the result, so
  // nothing already painted has to move.
  const settled = data !== null || !loading
  const backupCount = data ? (isWin ? registryBackups.length : data.backups.length) : null
  const hasEntries = !!data && (data.entries.length > 0 || data.unreadable.length > 0)

  return (
    <div className="recovery-page">
      <PageHeader
        title={t('recovery.title')}
        description={t('routes.recovery', { ns: 'experience' })}
        action={
          <>
            {/* While a known result revalidates it stays on screen; this button spins. */}
            <Button icon={RefreshCw} busy={loading} disabled={busy} onClick={() => void refresh()}>
              {t('recovery.refresh')}
            </Button>
            <Button
              variant="ghost"
              icon={Download}
              disabled={busy || !data?.total}
              onClick={() => void run(() => window.kudu.recoveryExport())}
            >
              {t('recovery.export')}
            </Button>
          </>
        }
      />

      <div className="recovery-stack">
        {/* Reserved from the first frame: the values swap from "—" without moving anything. */}
        <Card className="recovery-summary" aria-busy={loading}>
          <dl className="recovery-facts">
            <div>
              <dt>{t('recovery.summary.recorded')}</dt>
              <dd>{data ? count(data.total) : NO_VALUE}</dd>
            </div>
            <div>
              <dt>
                {t(isWin ? 'recovery.summary.registryBackups' : 'recovery.summary.backupFiles')}
              </dt>
              <dd>{backupCount === null ? NO_VALUE : count(backupCount)}</dd>
            </div>
          </dl>
          <p className="recovery-note">{t('recovery.limits')}</p>
        </Card>

        {error && (
          <Card className="recovery-alert" role="alert">
            <AlertTriangle size={16} strokeWidth={1.75} aria-hidden="true" />
            <p>{error}</p>
          </Card>
        )}

        {data?.gameMode && (data.gameMode.active || data.gameMode.pendingRestore) && (
          <Section
            title={t('recovery.gameMode')}
            actions={
              <Link className="ui-button" data-variant="secondary" data-size="md" to="/game-mode">
                {t('recovery.openGameMode')}
              </Link>
            }
          >
            <p className="recovery-text">
              {data.gameMode.pendingReason || t('recovery.gameModeDescription')}
            </p>
          </Section>
        )}

        {!settled && (
          <Card className="recovery-loading">
            <p role="status">{t('recovery.loading')}</p>
          </Card>
        )}

        {data && !hasEntries && (
          <EmptyState
            icon={icons.recovery}
            title={t('recovery.emptyTitle')}
            description={t('recovery.empty')}
          />
        )}

        {data && hasEntries && (
          <Section
            title={t('recovery.changesTitle')}
            meta={t('recovery.range', {
              from: count(offset + 1),
              to: count(Math.min(offset + PAGE_SIZE, data.total)),
              total: count(data.total)
            })}
          >
            <div className="recovery-list" aria-busy={loading}>
              {data.unreadable.map((id) => (
                <article key={id} className="recovery-entry">
                  <p className="recovery-text">{t('recovery.unreadable')}</p>
                  <div className="recovery-actions">
                    <Button variant="ghost" disabled={busy} onClick={() => setRemove(id)}>
                      {t('recovery.remove')}
                    </Button>
                  </div>
                </article>
              ))}
              {data.entries.map((entry) => (
                <RecoveryEntryRow
                  key={entry.id}
                  entry={entry}
                  busy={busy}
                  onRestore={() => setConfirm(entry)}
                  onRemove={() => setRemove(entry.id)}
                />
              ))}
            </div>
            {data.total > PAGE_SIZE && (
              <div className="recovery-pager">
                <Button
                  variant="ghost"
                  disabled={busy || loading || !offset}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  {t('recovery.previous')}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy || loading || offset + PAGE_SIZE >= data.total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  {t('recovery.next')}
                </Button>
              </div>
            )}
          </Section>
        )}

        {settled && (
          <Section
            title={t(isWin ? 'recovery.registryBackups.title' : 'recovery.backups')}
            actions={
              <Button
                icon={FolderOpen}
                disabled={busy}
                onClick={() => void run(() => window.kudu.recoveryOpenBackups())}
              >
                {t('recovery.openBackups')}
              </Button>
            }
          >
            <p className="recovery-text">
              {t(isWin ? 'recovery.registryBackups.description' : 'recovery.backupDescription')}
            </p>
            <div className="recovery-list">
              {!isWin &&
                data?.backups.map((b) => (
                  <p key={b.name} className="recovery-backup-line">
                    <span className="recovery-mono">{b.name}</span>
                    <span>
                      {formatBytes(b.size)} · {formatDateTime(b.modifiedAt, locale)}
                    </span>
                  </p>
                ))}
              {isWin && data && !registryBackups.length && (
                <p className="recovery-text recovery-muted">
                  {t('recovery.registryBackups.empty')}
                </p>
              )}
              {registryBackups.map((backup) => (
                <RegistryBackupRow
                  key={backup.name}
                  backup={backup}
                  result={registryResults[backup.name]}
                  busy={busy}
                  elevated={elevated}
                  onRestore={() => setRegistryConfirm(backup)}
                  onShow={() => void run(() => window.kudu.recoveryShowBackup(backup.name))}
                />
              ))}
            </div>
          </Section>
        )}
      </div>

      <ConfirmDialog
        open={!!remove}
        variant="danger"
        onCancel={() => setRemove(null)}
        title={t('recovery.removeTitle')}
        description={t('recovery.removeDescription')}
        confirmLabel={t('recovery.remove')}
        onConfirm={() => {
          const id = remove!
          setRemove(null)
          void run(() => window.kudu.recoveryRemove(id))
        }}
      />
      <ConfirmDialog
        open={!!registryConfirm}
        onCancel={() => setRegistryConfirm(null)}
        title={t('recovery.registryBackups.confirmTitle')}
        description={t('recovery.registryBackups.confirmDescription')}
        details={
          registryConfirm
            ? keyLines(registryConfirm, 50, (n) =>
                t('recovery.registryBackups.moreKeys', { count: n, formatted: count(n) })
              ).join('\n')
            : undefined
        }
        confirmLabel={
          registryConfirm
            ? t('recovery.registryBackups.confirmLabel', {
                count: registryConfirm.keyCount,
                formatted: count(registryConfirm.keyCount)
              })
            : undefined
        }
        onConfirm={() => {
          const backup = registryConfirm!
          setRegistryConfirm(null)
          void restoreRegistry(backup)
        }}
      />
      <ConfirmDialog
        open={!!confirm}
        onCancel={() => setConfirm(null)}
        title={t('recovery.confirmTitle')}
        description={t('recovery.confirmDescription')}
        details={confirm?.label}
        confirmLabel={t('recovery.restore')}
        onConfirm={() => {
          const id = confirm!.id
          setConfirm(null)
          void run(() => window.kudu.recoveryRestore(id))
        }}
      />
    </div>
  )
}

function RecoveryEntryRow({
  entry,
  busy,
  onRestore,
  onRemove
}: {
  entry: RecoveryEntry
  busy: boolean
  onRestore: () => void
  onRemove: () => void
}) {
  const { t, i18n } = useTranslation('history')
  const describe = (value: RecoveryEntry['before']) =>
    describeRecoveryValue(entry.target, value)
      .map((part) => t(part.key, part.params))
      .join(' · ')
  return (
    <article className="recovery-entry">
      <div className="recovery-entry-head">
        <h3 className="recovery-entry-title">{entry.label}</h3>
        <Tag tone={statusTone[entry.status]}>{t('recovery.status.' + entry.status)}</Tag>
      </div>
      <p className="recovery-meta">
        {t('recovery.source.' + entry.source)} · {formatDateTime(entry.createdAt, i18n.language)}
      </p>
      <p className="recovery-mono">
        {entry.target.kind === 'registry-dword'
          ? entry.target.key + ' / ' + entry.target.name
          : entry.target.name}
      </p>
      <dl className="recovery-states">
        <div>
          <dt>{t('recovery.before')}</dt>
          <dd>{describe(entry.before)}</dd>
        </div>
        <div>
          <dt>{t('recovery.after')}</dt>
          <dd>{describe(entry.after)}</dd>
        </div>
      </dl>
      {entry.error && (
        <p className="recovery-error" role="status">
          {entry.error}
        </p>
      )}
      <div className="recovery-actions">
        <Button disabled={busy || entry.status === 'restored'} onClick={onRestore}>
          {t('recovery.restore')}
        </Button>
        {entry.status !== 'pending' && (
          <Button variant="ghost" disabled={busy} onClick={onRemove}>
            {t('recovery.remove')}
          </Button>
        )}
      </div>
    </article>
  )
}

/** Up to `limit` top-level keys, plus a "+N more" line for the rest. */
function keyLines(
  backup: RegistryBackup,
  limit: number,
  more: (count: number) => string
): string[] {
  const lines = backup.keys.slice(0, limit)
  if (backup.keyCount > lines.length) lines.push(more(backup.keyCount - lines.length))
  return lines
}

function RegistryBackupRow({
  backup,
  result,
  busy,
  elevated,
  onRestore,
  onShow
}: {
  backup: RegistryBackup
  result?: { ok: boolean; message: string }
  busy: boolean
  elevated: boolean | null
  onRestore: () => void
  onShow: () => void
}) {
  const { t, i18n } = useTranslation('history')
  const locale = i18n.language
  // The main process refuses unelevated restores; say so instead of offering one.
  const needsAdmin = backup.restorable && backup.requiresAdmin && elevated === false
  return (
    <article className="recovery-entry">
      <div className="recovery-entry-head">
        <h3 className="recovery-entry-title recovery-mono">{backup.name}</h3>
        {backup.restorable ? (
          <Button
            disabled={busy || needsAdmin}
            title={needsAdmin ? t('recovery.registryBackups.requiresAdmin') : undefined}
            onClick={onRestore}
          >
            {t('recovery.registryBackups.restore')}
          </Button>
        ) : (
          <Button variant="ghost" disabled={busy} onClick={onShow}>
            {t('recovery.registryBackups.showInFolder')}
          </Button>
        )}
      </div>
      <p className="recovery-meta">
        {t('recovery.registryBackups.source.' + backup.source)} ·{' '}
        {formatDateTime(backup.modifiedAt, locale)} · {formatBytes(backup.size)}
        {needsAdmin ? ' · ' + t('recovery.registryBackups.requiresAdmin') : ''}
      </p>
      <ul className="recovery-keys">
        {keyLines(backup, 5, (n) =>
          t('recovery.registryBackups.moreKeys', { count: n, formatted: formatCount(n, locale) })
        ).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {backup.blocked && (
        <p className="recovery-text recovery-muted">
          {t('recovery.registryBackups.blocked.' + backup.blocked)}
        </p>
      )}
      {result && (
        <p
          role={result.ok ? 'status' : 'alert'}
          className={result.ok ? 'recovery-text' : 'recovery-error'}
        >
          {result.message}
        </p>
      )}
    </article>
  )
}
