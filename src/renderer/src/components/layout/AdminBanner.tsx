import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { icons } from '@/lib/icons'
import { usePlatform } from '@/hooks/usePlatform'
import { useSettingsStore } from '@/stores/settings-store'

// The first elevation check can take seconds (on Windows it starts PowerShell), and
// the banner sits in the page flow: remember the last answer so a non-elevated launch
// shows it from the first frame instead of pushing the page down when the check returns.
const LAST_UNELEVATED_KEY = 'ssc-admin-banner-last-unelevated'

function rememberUnelevated(unelevated: boolean): void {
  try {
    localStorage.setItem(LAST_UNELEVATED_KEY, unelevated ? '1' : '0')
  } catch {
    // No storage: the banner simply appears once the check returns.
  }
}

function lastLaunchUnelevated(): boolean {
  try {
    // macOS never shows the banner, and the platform itself is only known asynchronously.
    return !/Mac/.test(navigator.userAgent) && localStorage.getItem(LAST_UNELEVATED_KEY) === '1'
  } catch {
    return false
  }
}

/** The relaunched instance is expected to be elevated, so it starts without the banner. */
function relaunchElevated(): void {
  rememberUnelevated(false)
  window.kudu.elevationRelaunch()
}

export function AdminBanner() {
  const { t } = useTranslation('common')
  const { platform } = usePlatform()
  const loaded = useSettingsStore((s) => s.loaded)
  const preferElevatedLaunch = useSettingsStore((s) => s.settings.preferElevatedLaunch ?? false)
  const dismissedVersion = useSettingsStore((s) => s.settings.adminBannerDismissedVersion ?? '')
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const [visible, setVisible] = useState(lastLaunchUnelevated)
  const autoRelaunchTried = useRef(false)

  useEffect(() => {
    window.kudu.elevationCheck().then((elevated) => {
      rememberUnelevated(!elevated)
      setVisible(!elevated)
      if (elevated) return
      if (!loaded || !preferElevatedLaunch || autoRelaunchTried.current) return
      autoRelaunchTried.current = true
      relaunchElevated()
    })
  }, [loaded, preferElevatedLaunch])

  // Dismissal holds until the app is updated
  const dismiss = () => {
    updateSettings({ adminBannerDismissedVersion: __APP_VERSION__ })
    window.kudu?.settingsSet?.({ adminBannerDismissedVersion: __APP_VERSION__ }).catch(() => {})
  }

  // On macOS the relaunch-as-admin flow doesn't work properly — hide the banner entirely
  if (platform === 'darwin') return null
  if (!visible || !loaded || dismissedVersion === __APP_VERSION__) return null

  return (
    <div role="status" className="admin-banner">
      <icons.warning
        className="admin-banner-icon"
        size={16}
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <p className="admin-banner-text">
        {t('adminBannerMessage', {
          features: t(
            platform === 'linux' ? 'adminBannerFeaturesLinux' : 'adminBannerFeaturesWindows'
          )
        })}
      </p>
      <div className="admin-banner-actions">
        <Button onClick={relaunchElevated}>{t('relaunchAsAdmin')}</Button>
        <Button
          variant="ghost"
          icon={X}
          aria-label={t('dismiss')}
          title={t('dismiss')}
          onClick={dismiss}
        />
      </div>
    </div>
  )
}
