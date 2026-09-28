export interface PageExperience {
  /** The page's scope sentence is `experience:routes.<key>`. */
  key: string
}

// PageHeader shows the scope sentence when a page passes no description of its own.
export const pageExperiences: Record<string, PageExperience> = {
  '/storage-history': { key: 'storageHistory' },
  '/recovery': { key: 'recovery' },
  '/performance-diagnostics': { key: 'diagnostics' },
  '/cleaner': { key: 'cleaner' },
  '/registry': { key: 'registry' },
  '/context-menu': { key: 'contextMenu' },
  '/startup': { key: 'startup' },
  '/disk': { key: 'disk' },
  '/duplicates': { key: 'duplicates' },
  '/large-files': { key: 'largeFiles' },
  '/empty-folders': { key: 'emptyFolders' },
  '/file-shredder': { key: 'shredder' },
  '/disk-repair': { key: 'repair' },
  '/disk-maintenance': { key: 'maintenance' },
  '/network': { key: 'network' },
  '/malware': { key: 'malware' },
  '/game-mode': { key: 'gameMode' },
  '/performance': { key: 'performance' },
  '/uninstaller': { key: 'uninstaller' },
  '/history': { key: 'history' },
  '/settings': { key: 'settings' },
  '/about': { key: 'about' },
  '/privacy': { key: 'privacy' },
  '/services': { key: 'services' },
  '/firewall': { key: 'firewall' },
  '/debloater': { key: 'debloater' },
  '/updates': { key: 'updates' },
  '/schedules': { key: 'schedules' },
  '/drivers': { key: 'drivers' }
}
