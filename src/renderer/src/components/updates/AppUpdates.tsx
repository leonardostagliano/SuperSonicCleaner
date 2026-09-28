import { AlertCircle, Check, Download, RefreshCw, RotateCw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { APP_RELEASES_URL } from '@shared/app-release'
import { Button, ProgressBar, Section } from '@/components/ui'
import { usePlatform } from '@/hooks/usePlatform'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useAppUpdateStore } from '@/stores/app-update-store'
import './app-updates.css'

function UpdateAction() {
  const { t } = useTranslation('settings')
  const { status, pending, check, download, install } = useAppUpdateStore()
  if (status.state === 'checking' || status.state === 'downloading') return null
  const available = status.state === 'available'
  const downloaded = status.state === 'downloaded'
  const action = available ? download : downloaded ? install : check
  const Icon = available ? Download : downloaded ? RotateCw : RefreshCw
  const label = available
    ? t('download')
    : downloaded
      ? t('restartAndInstall', { version: status.version })
      : status.state === 'error'
        ? t('retry')
        : t('checkForUpdates')
  return (
    <Button
      variant={available || downloaded ? 'primary' : 'secondary'}
      icon={Icon}
      busy={pending}
      onClick={() => void action()}
    >
      {label}
    </Button>
  )
}

export function AppUpdateNotice() {
  const { t } = useTranslation('settings')
  const navigate = useNavigate()
  const { isPortable } = usePlatform()
  const { status, dismissedVersion, dismiss } = useAppUpdateStore()
  if (
    isPortable ||
    !status.version ||
    status.version === dismissedVersion ||
    !['available', 'downloading', 'downloaded'].includes(status.state)
  )
    return null

  return (
    <aside className="app-update-notice" aria-label={t('appUpdatesTitle')}>
      <Download
        className="app-update-notice-icon"
        size={16}
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <div className="app-update-notice-copy" role="status">
        <strong>
          {status.state === 'downloaded'
            ? t('updateReady')
            : t('versionAvailable', { version: status.version })}
        </strong>
        <span>
          {status.state === 'downloading'
            ? t('downloading', { progress: Math.round(status.progress ?? 0) })
            : t('updateNoticeDescription')}
        </span>
      </div>
      <Button variant="ghost" onClick={() => navigate('/about')}>
        {t('releaseNotes')}
      </Button>
      <UpdateAction />
      <Button
        variant="ghost"
        icon={X}
        onClick={dismiss}
        aria-label={t('updateLater')}
        title={t('updateLater')}
      />
    </aside>
  )
}

export function AppUpdateCard() {
  const { t, i18n } = useTranslation('settings')
  const { isPortable } = usePlatform()
  const reducedMotion = useReducedMotion()
  const status = useAppUpdateStore((s) => s.status)
  const progress = Math.max(0, Math.min(100, Math.round(status.progress ?? 0)))
  const busy = status.state === 'checking' || status.state === 'downloading'
  const label = isPortable
    ? t('portableUpdateStatus')
    : status.state === 'checking'
      ? t('checkingForUpdates')
      : status.state === 'not-available'
        ? t('upToDate')
        : status.state === 'available'
          ? t('versionAvailable', { version: status.version })
          : status.state === 'downloading'
            ? t('downloading', { progress })
            : status.state === 'downloaded'
              ? t('updateReady')
              : status.state === 'error'
                ? t('updateFailed')
                : t('updateCheckDescription')
  // Green only for the verified "up to date", red only for an error.
  const Icon = busy
    ? RefreshCw
    : status.state === 'error'
      ? AlertCircle
      : status.state === 'not-available'
        ? Check
        : Download
  const iconTone =
    status.state === 'error'
      ? 'app-update-status-error'
      : status.state === 'not-available' && !isPortable
        ? 'app-update-status-ok'
        : undefined
  const External = icons.external

  return (
    <Section title={t('appUpdatesTitle')} meta={t('stableChannel')} className="app-update-card">
      <p className="app-update-help">{t('updateChannelDescription')}</p>
      <div className="app-update-status" role="status" aria-live="polite">
        <Icon
          size={16}
          strokeWidth={1.75}
          className={cn(iconTone, busy && !reducedMotion && 'ui-spin')}
          aria-hidden="true"
        />
        <span>{label}</span>
      </div>
      {status.state === 'error' && (
        <p className="app-update-error" role="alert">
          {status.error}
        </p>
      )}
      {status.state === 'downloading' && (
        <div className="app-update-progress">
          <ProgressBar value={progress / 100} label={label} />
        </div>
      )}
      {isPortable && <p className="app-update-help">{t('portableUpdatesDesc')}</p>}
      {status.state === 'downloaded' && (
        <p className="app-update-help">{t('updateRestartDescription')}</p>
      )}
      <div className="app-update-actions">
        {!isPortable && <UpdateAction />}
        <a
          className="ui-button"
          data-variant="ghost"
          data-size="md"
          href={APP_RELEASES_URL}
          target="_blank"
          rel="noreferrer"
        >
          <span className="ui-button-label">
            {t(isPortable ? 'portableDownload' : 'viewReleases')}
          </span>
          <External className="ui-button-icon" size={16} strokeWidth={1.75} aria-hidden="true" />
        </a>
      </div>
      {status.checkedAt && !isPortable && (
        <p className="app-update-help">
          {t('lastUpdateCheck', { time: new Date(status.checkedAt).toLocaleString(i18n.language) })}
        </p>
      )}
      {status.releaseNotes && (
        <details className="app-release-notes">
          <summary>{t('releaseNotes')}</summary>
          <div>{status.releaseNotes}</div>
        </details>
      )}
    </Section>
  )
}
