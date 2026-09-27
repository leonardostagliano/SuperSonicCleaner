import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { RTL_LANGUAGES } from './lib/languages'
import { useScheduledScan } from './hooks/useScheduledScan'
import { AppShell } from './components/layout/AppShell'
import { DashboardPage } from './pages/DashboardPage'
import { useStatsStore } from './stores/stats-store'
import { useHistoryStore } from './stores/history-store'
import { useAppUpdateStore } from './stores/app-update-store'
import { useBackgroundScans } from './hooks/useBackgroundScans'
import { usePlatformLoader, PlatformContext } from './hooks/usePlatform'
import { initGameModeStore } from './stores/game-mode-store'
import { useSettingsStore } from './stores/settings-store'
import { initAiAnalysisSources } from './lib/ai-analysis-lifecycle'
import { initGlobalProgressBridge } from './lib/global-progress-bridge'
import { LazyPages, PageSkeleton, prefetchAllRoutes, retryPageLoad } from './routes'
import i18nInstance from './i18n'

const Onboarding = lazy(() =>
  import('./components/Onboarding').then((m) => ({ default: m.Onboarding }))
)

export function App() {
  const { i18n } = useTranslation()
  const loadHistory = useHistoryStore((s) => s.load)
  const historyLoaded = useHistoryStore((s) => s.loaded)
  const recomputeStats = useStatsStore((s) => s.recompute)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingChecked, setOnboardingChecked] = useState(false)
  const theme = useSettingsStore((s) => s.settings.theme)

  useEffect(() => {
    const stopProgress = initGlobalProgressBridge()
    const stopAiSources = initAiAnalysisSources()
    return () => {
      stopProgress()
      stopAiSources()
    }
  }, [])

  // Apply theme class to <html> element
  useEffect(() => {
    const root = document.documentElement
    const apply = (mode: 'dark' | 'light') => {
      root.classList.remove('dark', 'light')
      root.classList.add(mode)
      window.kudu?.windowSetChromeTheme?.(mode)
    }
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      apply(mq.matches ? 'dark' : 'light')
      const handler = (e: MediaQueryListEvent) => apply(e.matches ? 'dark' : 'light')
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    } else {
      apply(theme ?? 'dark')
    }
  }, [theme])

  // Keep direction and language in sync: hyphenation and screen readers use `lang`
  useEffect(() => {
    document.documentElement.dir = RTL_LANGUAGES.includes(i18n.language) ? 'rtl' : 'ltr'
    document.documentElement.lang = i18n.language || 'en'
  }, [i18n.language])

  useEffect(() => {
    const p = window.kudu?.onboardingGet?.()
    if (p) {
      p.then((done) => {
        setShowOnboarding(!done)
        setOnboardingChecked(true)
      }).catch((err) => {
        // Fail open — a broken check must not lock the user out of the app —
        // but say so, since it also means onboarding is skipped silently.
        console.error('[onboarding] could not read completion state:', err)
        setOnboardingChecked(true)
      })
    } else {
      setOnboardingChecked(true)
    }
  }, [])

  const handleOnboardingComplete = async () => {
    setShowOnboarding(false)
    try {
      await window.kudu?.onboardingSet?.(true)
    } catch (err) {
      // Swallowing this is what let the wizard come back on every launch with
      // nothing to go on (issue #269). The main process forwards renderer
      // console errors into kudu.log.
      console.error('[onboarding] failed to persist completion:', err)
    }
  }

  useEffect(() => {
    if (!historyLoaded) loadHistory()
  }, [historyLoaded, loadHistory])

  useEffect(() => {
    if (historyLoaded) recomputeStats()
  }, [historyLoaded, recomputeStats])

  const platformInfo = usePlatformLoader()

  useScheduledScan()

  // Run software-update & driver-update scans silently in the background
  useBackgroundScans()

  // Initialize app update checker on mount
  const initAppUpdate = useAppUpdateStore((s) => s.init)
  useEffect(() => {
    const cleanup = initAppUpdate()
    return cleanup
  }, [initAppUpdate])

  // Hydrate Game Mode status so the sidebar badge works on all pages
  useEffect(() => {
    initGameModeStore()
  }, [])

  // Warm the other pages' code once the first view has settled
  useEffect(() => {
    const timer = setTimeout(prefetchAllRoutes, 3000)
    return () => clearTimeout(timer)
  }, [])

  if (!onboardingChecked) {
    return (
      <div
        className="flex h-screen w-screen items-center justify-center"
        style={{ background: '#09090b' }}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="h-16 w-16 rounded-2xl" aria-hidden="true" />
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-amber-500" />
        </div>
      </div>
    )
  }

  return (
    <PlatformContext value={platformInfo}>
      <HashRouter>
        <PageTitleUpdater />
        {showOnboarding && (
          <Suspense fallback={null}>
            <Onboarding onComplete={handleOnboardingComplete} />
          </Suspense>
        )}
        <AppShell>
          <RoutedContent />
        </AppShell>
        <Toaster
          position="bottom-right"
          theme={theme === 'system' ? 'system' : theme}
          toastOptions={{
            style: {
              background: 'var(--toast-bg)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid var(--border-strong)',
              color: 'var(--toast-text)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 var(--glass-inset)'
            }
          }}
        />
      </HashRouter>
    </PlatformContext>
  )
}

// Maps routes to page titles for the window/tab title.
// Every route title is sourced from the same translations as its page or nav item.
const ROUTE_TITLES: Record<string, { key: string }> = {
  '/ai': { key: 'ai:title' },
  '/': { key: 'dashboard' },
  '/cleaner': { key: 'cleaner:pageTitle' },
  '/registry': { key: 'registry:pageTitle' },
  '/context-menu': { key: 'contextMenu:pageTitle' },
  '/startup': { key: 'startup:pageTitle' },
  '/storage-history': { key: 'disk:storage.title' },
  '/disk': { key: 'disk:pageTitle' },
  '/duplicates': { key: 'duplicates:pageTitle' },
  '/large-files': { key: 'largeFiles:pageTitle' },
  '/empty-folders': { key: 'emptyFolders:pageTitle' },
  '/file-shredder': { key: 'fileShredder:pageTitle' },
  '/disk-repair': { key: 'disk:repairTitle' },
  '/disk-maintenance': { key: 'disk:maintenanceTitle' },
  '/network': { key: 'network:pageTitle' },
  '/malware': { key: 'malware:pageTitle' },
  '/game-mode': { key: 'gameMode:pageTitle' },
  '/performance': { key: 'performance:pageTitle' },
  '/uninstaller': { key: 'uninstaller:pageTitle' },
  '/history': { key: 'history:pageTitle' },
  '/recovery': { key: 'history:recovery.title' },
  '/settings': { key: 'settings:pageTitle' },
  '/about': { key: 'settings:sectionAbout' },
  '/privacy': { key: 'hardening:privacy.pageTitle' },
  '/services': { key: 'hardening:serviceManager.pageTitle' },
  '/firewall': { key: 'firewallAudit' },
  '/debloater': { key: 'hardening:debloater.pageTitle' },
  '/updates': { key: 'updates:softwareUpdater.pageTitle' },
  '/schedules': { key: 'schedules:pageTitle' },
  '/drivers': { key: 'updates:driverManager.pageTitle' }
}

function PageTitleUpdater() {
  const location = useLocation()
  const { t } = useTranslation('sidebar')
  useEffect(() => {
    const entry = ROUTE_TITLES[location.pathname]
    let name: string | null = null
    if (entry) {
      name = t(entry.key)
    }
    document.title = name ? `${name} - SuperSonicCleaner` : 'SuperSonicCleaner'
  }, [location.pathname, t])
  return null
}

/**
 * Wraps the routed pages in a content-scoped error boundary keyed on the
 * pathname: a page whose chunk fails to load, or that throws while rendering,
 * is caught here instead of reaching the app-wide boundary in main.tsx — so
 * the sidebar and header stay usable — and navigating to another page mounts
 * a fresh boundary, clearing any previous error.
 */
function RoutedContent() {
  const location = useLocation()
  return (
    <PageErrorBoundary key={location.pathname} path={location.pathname}>
      <Suspense fallback={<PageSkeleton />}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          {Object.entries(LazyPages).map(([path, Page]) => (
            <Route key={path} path={path} element={<Page />} />
          ))}
          {/* Legacy redirect */}
          <Route path="/hardening" element={<Navigate to="/privacy" replace />} />
          <Route path="/updater" element={<Navigate to="/updates" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </PageErrorBoundary>
  )
}

interface PageErrorBoundaryState {
  error: Error | null
}

/**
 * Same look as the app-wide `ErrorBoundary` in main.tsx, scoped to the content
 * area instead of the whole renderer. "Try again" recreates the lazy component
 * for this route (`retryPageLoad`) so a chunk whose `import()` rejected is
 * actually retried rather than re-thrown from React's cached rejection; the
 * last-resort button reloads the window, same as the app-wide boundary.
 */
class PageErrorBoundary extends Component<
  { path: string; children: ReactNode },
  PageErrorBoundaryState
> {
  state: PageErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  handleRetry = () => {
    retryPageLoad(this.props.path)
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      // Same hardcoded colors as the app-wide boundary — CSS variables may not
      // be loaded when the error boundary triggers, which would make the text
      // invisible.
      return (
        <div
          style={{
            padding: 32,
            color: '#fafafa',
            fontFamily: 'system-ui',
            background: '#09090b'
          }}
        >
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
          <pre style={{ color: '#a1a1aa', fontSize: 13, whiteSpace: 'pre-wrap' }}>
            {this.state.error.message}
          </pre>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              onClick={this.handleRetry}
              style={{
                padding: '8px 16px',
                background: '#27272a',
                color: '#fafafa',
                border: '1px solid #3f3f46',
                borderRadius: 6,
                cursor: 'pointer'
              }}
            >
              {i18nInstance.t('settings:retry')}
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 16px',
                background: '#27272a',
                color: '#fafafa',
                border: '1px solid #3f3f46',
                borderRadius: 6,
                cursor: 'pointer'
              }}
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
