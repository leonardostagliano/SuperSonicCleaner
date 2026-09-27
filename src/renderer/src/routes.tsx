import { lazy, type ComponentType, type LazyExoticComponent, type ReactElement } from 'react'

interface PageEntry {
  load: () => Promise<Record<string, unknown>>
  exportName: string
}

const entry = (load: PageEntry['load'], exportName: string): PageEntry => ({ load, exportName })

/** Code for every page except Home, loaded on first visit (or earlier, by prefetch). */
export const PAGE_ENTRIES: Record<string, PageEntry> = {
  '/cleaner': entry(() => import('./pages/CleanerPage'), 'CleanerPage'),
  '/registry': entry(() => import('./pages/RegistryPage'), 'RegistryPage'),
  '/context-menu': entry(() => import('./pages/ContextMenuCleanerPage'), 'ContextMenuCleanerPage'),
  '/startup': entry(() => import('./pages/StartupPage'), 'StartupPage'),
  '/storage-history': entry(() => import('./pages/StorageHistoryPage'), 'StorageHistoryPage'),
  '/disk': entry(() => import('./pages/DiskAnalyzerPage'), 'DiskAnalyzerPage'),
  '/duplicates': entry(() => import('./pages/DuplicateFinderPage'), 'DuplicateFinderPage'),
  '/large-files': entry(() => import('./pages/LargeFileFinderPage'), 'LargeFileFinderPage'),
  '/empty-folders': entry(() => import('./pages/EmptyFolderCleanerPage'), 'EmptyFolderCleanerPage'),
  '/file-shredder': entry(() => import('./pages/FileShredderPage'), 'FileShredderPage'),
  '/disk-repair': entry(() => import('./pages/DiskRepairPage'), 'DiskRepairPage'),
  '/disk-maintenance': entry(() => import('./pages/DiskMaintenancePage'), 'DiskMaintenancePage'),
  '/network': entry(() => import('./pages/NetworkCleanupPage'), 'NetworkCleanupPage'),
  '/malware': entry(() => import('./pages/MalwareScannerPage'), 'MalwareScannerPage'),
  '/game-mode': entry(() => import('./pages/GameModePage'), 'GameModePage'),
  '/performance-diagnostics': entry(
    () => import('./pages/PerformanceDiagnosticsPage'),
    'PerformanceDiagnosticsPage'
  ),
  '/performance': entry(() => import('./pages/PerformanceMonitorPage'), 'PerformanceMonitorPage'),
  '/uninstaller': entry(() => import('./pages/UninstallerPage'), 'UninstallerPage'),
  '/history': entry(() => import('./pages/HistoryPage'), 'HistoryPage'),
  '/recovery': entry(() => import('./pages/RecoveryPage'), 'RecoveryPage'),
  '/settings': entry(() => import('./pages/SettingsPage'), 'SettingsPage'),
  '/about': entry(() => import('./pages/AboutPage'), 'AboutPage'),
  '/ai': entry(() => import('./pages/AiAnalysisPage'), 'AiAnalysisPage'),
  '/privacy': entry(() => import('./pages/PrivacyShieldPage'), 'PrivacyShieldPage'),
  '/services': entry(() => import('./pages/ServiceManagerPage'), 'ServiceManagerPage'),
  '/firewall': entry(() => import('./pages/FirewallAuditPage'), 'FirewallAuditPage'),
  '/debloater': entry(() => import('./pages/DebloaterPage'), 'DebloaterPage'),
  '/updates': entry(() => import('./pages/SoftwareUpdaterPage'), 'SoftwareUpdaterPage'),
  '/schedules': entry(() => import('./pages/SchedulesPage'), 'SchedulesPage'),
  '/drivers': entry(() => import('./pages/DriverManagerPage'), 'DriverManagerPage')
}

const loaded = new Map<string, Promise<unknown>>()

/** Start downloading a page's code; repeated calls reuse the first load. */
export function prefetchRoute(path: string): void {
  const page = PAGE_ENTRIES[path]
  if (!page || loaded.has(path)) return
  loaded.set(
    path,
    page.load().catch(() => {
      loaded.delete(path)
    })
  )
}

/** Warm every page in the background, one at a time, when the renderer is idle. */
export function prefetchAllRoutes(): void {
  const queue = Object.keys(PAGE_ENTRIES)
  const next = () => {
    const path = queue.shift()
    if (!path) return
    prefetchRoute(path)
    const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200))
    idle(next)
  }
  next()
}

function loadPageComponent(page: PageEntry): LazyExoticComponent<ComponentType> {
  return lazy(async () => ({ default: (await page.load())[page.exportName] as ComponentType }))
}

/**
 * The lazy component currently registered per route. React's `lazy()` calls its
 * loader only once per instance and remembers a rejection forever, so a failed
 * chunk can only be retried by swapping in a brand-new instance (`retryPageLoad`),
 * not by calling the loader again on the same one.
 */
const currentPage = new Map<string, LazyExoticComponent<ComponentType>>(
  Object.entries(PAGE_ENTRIES).map(([path, page]) => [path, loadPageComponent(page)])
)

/**
 * Drops the cached lazy component for `path` so the next mount re-attempts the
 * chunk download from scratch instead of re-throwing the same rejection. Used
 * by the page-level error boundary's "try again" action.
 */
export function retryPageLoad(path: string): void {
  const page = PAGE_ENTRIES[path]
  if (!page) return
  currentPage.set(path, loadPageComponent(page))
}

/**
 * One stable component per route: it re-reads `currentPage` on every mount, so
 * remounting it after `retryPageLoad` (e.g. when the page-level error boundary
 * clears its error) renders the freshly created lazy component. Kept as a plain
 * function (not React.lazy) so it can also be called directly in tests.
 */
export const LazyPages: Record<string, () => ReactElement> = Object.fromEntries(
  Object.keys(PAGE_ENTRIES).map((path) => {
    function RoutePage() {
      const Current = currentPage.get(path)!
      return <Current />
    }
    return [path, RoutePage]
  })
)

/** Holds the page's place while its code loads, so nothing below it jumps. */
export function PageSkeleton() {
  return <div className="page-skeleton" aria-busy="true" />
}
