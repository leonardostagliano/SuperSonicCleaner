import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Segmented } from '@/components/ui/Segmented'
import { useSettingsStore } from '@/stores/settings-store'
import { SimpleDashboard } from '@/components/dashboard/SimpleDashboard'
import { SystemReport } from '@/components/dashboard/SystemReport'
import '@/components/dashboard/dashboard.css'

type View = 'simple' | 'advanced'

/** Home: the simple, goal-guided view or the advanced system report. */
export function DashboardPage() {
  const { t } = useTranslation('dashboard')
  const view = useSettingsStore((s): View =>
    s.settings.dashboardView === 'advanced' ? 'advanced' : 'simple'
  )
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const saveInFlight = useRef(false)

  const changeView = async (next: View) => {
    // The one-click clean reports into the advanced view: keep it while it runs.
    if (next === view || busy || saveInFlight.current) return
    saveInFlight.current = true
    setSaving(true)
    try {
      await window.kudu.settingsSet({ dashboardView: next })
      updateSettings({ dashboardView: next })
    } catch {
      toast.error(t('view.saveFailed'))
    } finally {
      saveInFlight.current = false
      setSaving(false)
    }
  }

  return (
    <div className="dashboard-view">
      <div className="dashboard-view-toolbar" aria-busy={saving || busy}>
        <span>{t('view.home')}</span>
        <Segmented
          label={t('view.label')}
          value={view}
          onChange={(next) => void changeView(next)}
          options={[
            { value: 'simple', label: t('view.simple') },
            { value: 'advanced', label: t('view.advanced') }
          ]}
        />
      </div>
      {view === 'simple' ? (
        <SimpleDashboard onAdvanced={() => void changeView('advanced')} switching={saving} />
      ) : (
        <SystemReport onBusyChange={setBusy} />
      )}
    </div>
  )
}
