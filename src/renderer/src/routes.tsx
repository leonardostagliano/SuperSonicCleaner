import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

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

/**
 * Warm every page in the background: one page's download starts per idle period.
 * Each load is not awaited, so the downloads themselves may overlap.
 */
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

export const LazyPages: Record<string, LazyExoticComponent<ComponentType>> = Object.fromEntries(
  Object.entries(PAGE_ENTRIES).map(([path, page]) => [
    path,
    lazy(async () => ({ default: (await page.load())[page.exportName] as ComponentType }))
  ])
)

/** Holds the page's place while its code loads, so nothing below it jumps. */
export function PageSkeleton() {
  return <div className="page-skeleton" aria-busy="true" />
}

/**
 * True when `error` looks like a failed lazy-chunk import rather than a page
 * throwing during its own render. The distinction matters because browsers
 * permanently memoize a rejected dynamic `import()` for a given URL for the
 * life of the document: re-mounting the same (or even a brand-new) lazy
 * component can never recover from this, so a chunk-load failure needs a full
 * window reload, while a page that threw during render can simply be
 * re-rendered by resetting the boundary that caught it.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'ChunkLoadError') return true
  const message = error.message ?? ''
  return (
    message.includes('dynamically imported module') ||
    message.includes('Importing a module script failed')
  )
}
