import { useTranslation } from 'react-i18next'
import { CheckCircle2, Clock, X, XCircle } from 'lucide-react'
import type { UpdateSummary } from '@/lib/update-summary'

const TONES = {
  success: { bg: 'rgba(34,197,94,0.06)', border: 'rgba(34,197,94,0.1)' },
  warning: { bg: 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.14)' },
  error: { bg: 'rgba(239,68,68,0.06)', border: 'rgba(239,68,68,0.1)' }
}

/**
 * What the last update run did, app by app: which were updated (and to which
 * version), which are still installing in the background, and which failed
 * and why. It stays until the user dismisses it.
 */
export function UpdateSummaryBanner({
  summary,
  packageManagerName,
  onDismiss
}: {
  summary: UpdateSummary
  packageManagerName: string | null
  onDismiss: () => void
}) {
  const { t } = useTranslation('updates')
  const { updated, pending, failed } = summary
  if (updated.length + pending.length + failed.length === 0) return null
  const tone = failed.length ? 'error' : pending.length ? 'warning' : 'success'
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'warning' ? Clock : XCircle
  const iconColor =
    tone === 'success' ? 'text-green-500' : tone === 'warning' ? 'text-amber-400' : 'text-red-500'

  const counts = [
    updated.length > 0 && (
      <span key="updated" className="text-green-400">
        {updated.length !== 1
          ? t('softwareUpdater.updateResultAppsUpdatedPlural', { count: updated.length })
          : t('softwareUpdater.updateResultAppsUpdated', { count: updated.length })}
      </span>
    ),
    pending.length > 0 && (
      <span key="pending" className="text-amber-400">
        {t('softwareUpdater.updateResultPending', { count: pending.length })}
      </span>
    ),
    failed.length > 0 && (
      <span key="failed" className="text-red-400">
        {t('softwareUpdater.updateResultFailed', { count: failed.length })}
      </span>
    )
  ].filter(Boolean)

  return (
    <div
      role="status"
      className="mb-5 flex items-start gap-3 rounded-2xl p-4"
      style={{ background: TONES[tone].bg, border: `1px solid ${TONES[tone].border}` }}
    >
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconColor}`} strokeWidth={1.8} />
      <div className="min-w-0 flex-1 text-[13px] text-zinc-200">
        <div>
          {counts.map((node, i) => (
            <span key={i}>
              {i > 0 && <span> — </span>}
              {node}
            </span>
          ))}
        </div>
        <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto pr-1 text-[12px]">
          {updated.map((e) => (
            <li key={e.key} className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" strokeWidth={2} />
              <span className="truncate font-medium text-zinc-200" title={e.name}>
                {e.name}
              </span>
              {e.fromVersion && e.toVersion && (
                <span className="shrink-0 font-mono" style={{ color: 'var(--text-muted)' }}>
                  {e.fromVersion} → {e.toVersion}
                </span>
              )}
            </li>
          ))}
          {pending.map((e) => (
            <li key={e.key} className="flex items-start gap-2">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" strokeWidth={2} />
              <span style={{ color: 'var(--text-secondary)' }}>
                {t('softwareUpdater.resultPending', { app: e.name })}
              </span>
            </li>
          ))}
          {failed.map((e) => {
            const isInstallerChange = e.reason?.toLowerCase().includes('installer type changed')
            return (
              <li key={e.key} className="flex items-start gap-2">
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" strokeWidth={2} />
                <div className="min-w-0">
                  <span style={{ color: 'var(--text-muted)' }}>
                    <span className="font-medium text-zinc-200">{e.name}</span>: {e.reason}
                  </span>
                  {isInstallerChange && packageManagerName && (
                    <div
                      className="mt-1.5 rounded-lg px-3 py-2 font-mono text-[11px] text-zinc-300 select-all cursor-text"
                      style={{
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid var(--border-medium)'
                      }}
                    >
                      {packageManagerName} uninstall {e.appId}
                      <br />
                      {packageManagerName} install {e.appId}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('softwareUpdater.dismiss')}
        title={t('softwareUpdater.dismiss')}
        className="shrink-0 rounded-lg p-1 text-zinc-400 transition-colors hover:text-zinc-200"
        style={{ background: 'transparent' }}
      >
        <X className="h-4 w-4" strokeWidth={2} />
      </button>
    </div>
  )
}
