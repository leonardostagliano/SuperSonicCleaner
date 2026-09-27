import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldAlert, X } from 'lucide-react'
import { usePlatform } from '@/hooks/usePlatform'
import { useSettingsStore } from '@/stores/settings-store'

export function AdminBanner() {
  const { t } = useTranslation('common')
  const { platform } = usePlatform()
  const loaded = useSettingsStore((s) => s.loaded)
  const preferElevatedLaunch = useSettingsStore((s) => s.settings.preferElevatedLaunch ?? false)
  const dismissedVersion = useSettingsStore((s) => s.settings.adminBannerDismissedVersion ?? '')
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const [visible, setVisible] = useState(false)
  const autoRelaunchTried = useRef(false)

  useEffect(() => {
    window.kudu.elevationCheck().then((elevated) => {
      if (elevated) return
      setVisible(true)
      if (!loaded || !preferElevatedLaunch || autoRelaunchTried.current) return
      autoRelaunchTried.current = true
      window.kudu.elevationRelaunch()
    })
  }, [loaded, preferElevatedLaunch])

  // Dismissal holds until the app is updated
  const dismiss = () => {
    updateSettings({ adminBannerDismissedVersion: __APP_VERSION__ })
    window.kudu.settingsSet({ adminBannerDismissedVersion: __APP_VERSION__ }).catch(() => {})
  }

  // On macOS the relaunch-as-admin flow doesn't work properly — hide the banner entirely
  if (platform === 'darwin') return null
  if (!visible || !loaded || dismissedVersion === __APP_VERSION__) return null

  return (
    <div
      role="status"
      className="admin-banner flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm"
      style={{
        background: 'var(--accent-muted-bg)',
        border: '1px solid var(--accent-muted-border)'
      }}
    >
      <ShieldAlert
        size={18}
        className="shrink-0"
        style={{ color: 'var(--warning)' }}
        aria-hidden="true"
      />
      <span className="text-zinc-300">{t('adminBannerMessage')}</span>
      <button
        onClick={() => window.kudu.elevationRelaunch()}
        className="ml-1 shrink-0 rounded-lg px-3 py-1 text-xs font-semibold transition-colors"
        style={{ background: 'var(--accent-muted-bg)', color: 'var(--warning)' }}
      >
        {t('relaunchAsAdmin')}
      </button>
      <button
        onClick={dismiss}
        aria-label={t('dismiss', 'Dismiss')}
        className="ml-auto shrink-0 text-zinc-600 transition-colors hover:text-zinc-400"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
