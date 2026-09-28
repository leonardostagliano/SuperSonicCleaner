import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UpdateProgress } from '@shared/types'
import { ProgressCard } from '@/components/software/SoftwareBlocks'
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
    <ProgressCard
      title={t('softwareUpdater.updatingProgress', {
        app,
        current: progress.current,
        total: progress.total
      })}
      meta={`${progress.percent}%`}
      value={progress.percent / 100}
      detail={step || undefined}
      tone={progress.status === 'failed' ? 'danger' : 'neutral'}
    >
      {elapsed !== undefined && (
        <p className="sw-progress-note">
          {t('softwareUpdater.elapsed', { time: formatElapsed(elapsed) })}
        </p>
      )}
      {elapsed !== undefined && elapsed >= SLOW_INSTALL_HINT_MS && (
        <p className="sw-progress-note">{t('softwareUpdater.slowInstallHint')}</p>
      )}
      {progress.status === 'failed' && (
        <p className="sw-progress-note sw-danger-text">
          {t('softwareUpdater.failedToUpdate', { app })}
        </p>
      )}
    </ProgressCard>
  )
}
