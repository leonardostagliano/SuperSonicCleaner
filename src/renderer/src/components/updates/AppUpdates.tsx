import { AlertCircle, ArrowUpRight, Check, Download, RefreshCw, RotateCw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { APP_RELEASES_URL } from '@shared/app-release'
import { usePlatform } from '@/hooks/usePlatform'
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
    <button
      type="button"
      className={`pulse-button ${available || downloaded ? 'pulse-primary' : ''}`}
      disabled={pending}
      aria-busy={pending}
      onClick={() => void action()}
    >
      <Icon size={15} className={pending ? 'animate-spin' : undefined} aria-hidden="true" />
      {label}
    </button>
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
      <Download size={18} aria-hidden="true" />
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
      <button type="button" className="pulse-text-button" onClick={() => navigate('/about')}>
        {t('releaseNotes')}
      </button>
      <UpdateAction />
      <button
        type="button"
        className="app-update-dismiss"
        onClick={dismiss}
        aria-label={t('updateLater')}
        title={t('updateLater')}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </aside>
  )
}

export function AppUpdateCard() {
  const { t, i18n } = useTranslation('settings')
  const { isPortable } = usePlatform()
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
  const Icon =
    status.state === 'error' ? AlertCircle : status.state === 'not-available' ? Check : Download

  return (
    <section className="app-update-card" aria-labelledby="app-update-heading">
      <div className="app-update-card-heading">
        <span className="app-update-icon">
          <Icon size={22} aria-hidden="true" />
        </span>
        <div>
          <h2 id="app-update-heading">{t('appUpdatesTitle')}</h2>
          <p>{t('updateChannelDescription')}</p>
        </div>
        <span className="app-release-channel">{t('stableChannel')}</span>
      </div>
      <div className="app-update-status" role="status" aria-live="polite">
        {busy && <RefreshCw size={16} className="animate-spin" aria-hidden="true" />}
        <span>{label}</span>
      </div>
      {status.state === 'error' && (
        <p className="app-update-error" role="alert">
          {status.error}
        </p>
      )}
      {status.state === 'downloading' && (
        <progress className="app-update-progress" value={progress} max={100} aria-label={label} />
      )}
      {isPortable && <p className="app-update-help">{t('portableUpdatesDesc')}</p>}
      {status.state === 'downloaded' && (
        <p className="app-update-help">{t('updateRestartDescription')}</p>
      )}
      <div className="app-update-actions">
        {!isPortable && <UpdateAction />}
        <a className="pulse-text-button" href={APP_RELEASES_URL} target="_blank" rel="noreferrer">
          {t(isPortable ? 'portableDownload' : 'viewReleases')}
          <ArrowUpRight size={15} aria-hidden="true" />
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
    </section>
  )
}
