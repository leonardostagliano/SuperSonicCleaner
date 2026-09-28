import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, Download, Monitor, Moon, Sun } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Sidebar } from './Sidebar'
import { AdminBanner } from './AdminBanner'
import { AppUpdateNotice } from '@/components/updates/AppUpdates'
import { NotchToggle } from '@/components/notch/NotchToggle'
import { useSettingsStore } from '@/stores/settings-store'
import { useAppUpdateStore } from '@/stores/app-update-store'
import { usePlatform } from '@/hooks/usePlatform'
import logoSrc from '@/assets/logo.png'
import { BrandWordmark } from '@/components/shared/BrandWordmark'
import './shell.css'

/** `inert` while a modal (onboarding) covers the shell, so neither focus nor clicks reach it. */
export function AppShell({ children, inert }: { children: React.ReactNode; inert?: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation('settings')
  const { platform } = usePlatform()
  const updateState = useAppUpdateStore((s) => s.status.state)
  const hasUpdate = updateState === 'available' || updateState === 'downloaded'
  const mainRef = useRef<HTMLElement>(null)
  // Each page starts at its top, not at the previous page's scroll position
  useLayoutEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [location.pathname])
  const handleSkip = useCallback((e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault()
    const el = document.getElementById('main-content')
    if (el) {
      el.focus()
      el.scrollIntoView()
    }
  }, [])

  return (
    <div className="app-shell h-screen overflow-hidden" data-platform={platform} inert={inert}>
      <a href="#main-content" className="skip-nav" onClick={handleSkip}>
        {t('skipToContent')}
      </a>
      <header className="app-titlebar drag-region" aria-label="SuperSonicCleaner">
        <div className="app-brand">
          <img src={logoSrc} alt="SuperSonicCleaner" className="brand-icon" />
          <BrandWordmark />
        </div>
        <div className="app-titlebar-drag flex-1" aria-hidden="true" />
        <div className="app-titlebar-actions no-drag flex h-full items-center">
          <button
            className="shell-version"
            type="button"
            onClick={() => navigate('/about')}
            aria-label={`${t('appVersion', { version: __APP_VERSION__ })} · ${t('sectionAbout')}`}
          >
            {hasUpdate && <Download size={12} strokeWidth={1.75} aria-hidden="true" />}
            <span>v{__APP_VERSION__}</span>
            {hasUpdate && <i aria-hidden="true" />}
          </button>
          <NotchToggle />
          <AppearanceMenu />
        </div>
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <AdminBanner />
          <AppUpdateNotice />
          <main
            ref={mainRef}
            id="main-content"
            data-route={location.pathname}
            tabIndex={-1}
            className="app-content relative flex-1 overflow-y-auto outline-none"
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}

type ThemeMode = 'system' | 'light' | 'dark'

function AppearanceMenu() {
  const { t } = useTranslation('settings')
  const theme = useSettingsStore((s) => s.settings.theme)
  const saveSettings = useSettingsStore((s) => s.saveSettings)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const options: { id: ThemeMode; label: string; description: string; icon: typeof Sun }[] = [
    {
      id: 'system',
      label: t('appearanceSystem'),
      description: t('appearanceSystemDescription'),
      icon: Monitor
    },
    {
      id: 'light',
      label: t('appearanceLight'),
      description: t('appearanceLightDescription'),
      icon: Sun
    },
    {
      id: 'dark',
      label: t('appearanceDark'),
      description: t('appearanceDarkDescription'),
      icon: Moon
    }
  ]
  const active = options.find((option) => option.id === theme) ?? options[0]
  const ActiveIcon = active.icon

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const selectTheme = async (nextTheme: ThemeMode) => {
    if (saving) return
    setSaving(true)
    try {
      await saveSettings({ theme: nextTheme })
      setOpen(false)
      triggerRef.current?.focus()
    } catch {
      toast.error(t('appearanceSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      setOpen(false)
      if (event.key === 'Escape') {
        event.preventDefault()
        triggerRef.current?.focus()
      }
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []
    )
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        ref={triggerRef}
        type="button"
        className="titlebar-icon-button"
        aria-label={t('appearanceCurrent', { theme: active.label })}
        aria-expanded={open}
        aria-haspopup="menu"
        title={t('appearanceCurrent', { theme: active.label })}
        onClick={() => setOpen((value) => !value)}
      >
        <ActiveIcon className="h-4 w-4" strokeWidth={1.75} />
      </button>
      {open && (
        <div
          className="appearance-menu"
          role="menu"
          aria-label={t('appearance')}
          onKeyDown={handleKeyDown}
        >
          <div className="appearance-menu-label">{t('appearance')}</div>
          {options.map((option) => {
            const Icon = option.icon
            const selected = option.id === theme
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                disabled={saving}
                onClick={() => void selectTheme(option.id)}
              >
                <span className="appearance-option-icon">
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <b>{option.label}</b>
                  <small>{option.description}</small>
                </span>
                {selected && <Check className="appearance-menu-check h-4 w-4" strokeWidth={2} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
