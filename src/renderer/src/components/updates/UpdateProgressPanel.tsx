import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import type { UpdateProgress } from '@shared/types'
import { formatElapsed, SLOW_INSTALL_HINT_MS } from '@/lib/update-summary'

/** The current time, refreshed every second while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

/**
 * Progress of a software update run. Besides the batch position it shows what
 * the package manager last reported and how long the current install has been
 * running, so a slow installer reads as busy rather than stuck.
 */
export function UpdateProgressPanel({ progress }: { progress: UpdateProgress }) {
  const { t } = useTranslation('updates')
  const running = progress.status === 'in-progress'
  const now = useNow(running)
  const app = progress.currentAppName || progress.currentApp
  const elapsed = running && progress.startedAt ? now - progress.startedAt : undefined
  const step =
    [progress.detail, progress.stepPercent !== undefined ? `${progress.stepPercent}%` : undefined]
      .filter(Boolean)
      .join(' · ') ||
    // An elevated attempt prints nothing we can read: say what is going on instead
    (running && progress.elevated ? t('softwareUpdater.elevatedStep') : '')

  return (
    <div
      className="mb-5 rounded-2xl p-4"
      style={{
        background: 'rgba(245,158,11,0.04)',
        border: '1px solid var(--accent-muted-bg)'
      }}
    >
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-400" strokeWidth={2} />
          <span className="truncate text-[13px] font-medium text-zinc-200" title={app}>
            {t('softwareUpdater.updatingProgress', {
              app,
              current: progress.current,
              total: progress.total
            })}
          </span>
        </div>
        <span className="shrink-0 text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>
          {progress.percent}%
        </span>
      </div>
      <div
        className="h-1.5 w-full rounded-full overflow-hidden"
        style={{ background: 'var(--bg-hover-2)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${progress.percent}%`,
            background: 'linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)'
          }}
        />
      </div>
      {(step || elapsed !== undefined) && (
        <div
          className="mt-2 flex items-center justify-between gap-3 text-[11px]"
          style={{ color: 'var(--text-secondary)' }}
        >
          <span className="truncate" title={step}>
            {step}
          </span>
          {elapsed !== undefined && (
            <span className="shrink-0 font-mono">
              {t('softwareUpdater.elapsed', { time: formatElapsed(elapsed) })}
            </span>
          )}
        </div>
      )}
      {elapsed !== undefined && elapsed >= SLOW_INSTALL_HINT_MS && (
        <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {t('softwareUpdater.slowInstallHint')}
        </p>
      )}
      {progress.status === 'failed' && (
        <p className="mt-2 text-[11px] text-red-400">
          {t('softwareUpdater.failedToUpdate', { app })}
        </p>
      )}
    </div>
  )
}
