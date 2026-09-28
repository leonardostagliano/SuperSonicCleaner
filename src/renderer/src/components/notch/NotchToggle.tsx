import { useEffect, useState } from 'react'
import { icons } from '@/lib/icons'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export function NotchToggle() {
  const { t } = useTranslation('notch')
  const [enabled, setEnabled] = useState(false)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    const api = window.kuduNotch
    if (!api) return
    let active = true
    let eventSeen = false
    const off = api.onState((state) => {
      eventSeen = true
      setEnabled(state.enabled)
    })
    void api
      .getState()
      .then((state) => {
        if (active && !eventSeen) setEnabled(state.enabled)
      })
      .catch(() => {})
    return () => {
      active = false
      off()
    }
  }, [])
  const toggle = async () => {
    if (!window.kuduNotch || pending) return
    setPending(true)
    try {
      await window.kuduNotch.setVisible(!enabled)
    } catch {
      toast.error(t('failed'))
    } finally {
      setPending(false)
    }
  }
  return (
    <button
      type="button"
      className="titlebar-icon-button"
      aria-pressed={enabled}
      aria-label={t(enabled ? 'disable' : 'enable')}
      title={`${t(enabled ? 'disable' : 'enable')} · ${t('visibilityHint')}`}
      disabled={pending || !window.kuduNotch}
      onClick={() => void toggle()}
    >
      <icons.performance className="h-4 w-4" strokeWidth={1.75} />
    </button>
  )
}
