import type { LucideIcon } from 'lucide-react'
import type { TFunction } from 'i18next'
import { icons } from './icons'

/** One sidebar entry: a page, or a group that opens a submenu. */
export interface NavLeaf {
  path: string
  /** i18n key. A `ns:` prefix picks its namespace; otherwise `ns`, else `sidebar`. */
  labelKey: string
  /** English fallback shown when the key has no translation. */
  label: string
  icon: LucideIcon
  ns?: string
}

export interface NavGroupItem extends NavLeaf {
  children?: NavLeaf[]
}

export interface NavGroup {
  headingKey?: string
  heading?: string
  items: NavGroupItem[]
}

/**
 * The sidebar's main navigation, in display order. Platform feature filters stay
 * in the Sidebar: this is the full list, so crumbs work for every page.
 */
export const navGroups: NavGroup[] = [
  {
    items: [
      { icon: icons.home, labelKey: 'dashboard', label: 'Home', path: '/' },
      {
        icon: icons.clean,
        labelKey: 'cleaner',
        label: 'Clean up',
        path: '/cleaner',
        children: [
          {
            icon: icons.clean,
            labelKey: 'cleaner:pageTitle',
            label: 'System Cleaner',
            path: '/cleaner'
          },
          {
            icon: icons.registry,
            labelKey: 'registry:pageTitle',
            label: 'Registry',
            path: '/registry'
          },
          {
            icon: icons.startup,
            labelKey: 'startup:pageTitle',
            label: 'Startup',
            path: '/startup'
          },
          {
            icon: icons.network,
            labelKey: 'network:pageTitle',
            label: 'Network',
            path: '/network'
          },
          {
            icon: icons.schedule,
            labelKey: 'schedules:pageTitle',
            label: 'Automatic Care',
            path: '/schedules'
          }
        ]
      },
      {
        icon: icons.protection,
        labelKey: 'securityHeading',
        label: 'Protection',
        path: '/malware',
        children: [
          {
            icon: icons.malware,
            labelKey: 'malware:pageTitle',
            label: 'Malware Scanner',
            path: '/malware'
          },
          {
            icon: icons.privacy,
            labelKey: 'hardening:privacy.pageTitle',
            label: 'Privacy',
            path: '/privacy'
          },
          {
            icon: icons.firewall,
            labelKey: 'firewallAudit',
            label: 'Firewall Audit',
            path: '/firewall'
          }
        ]
      },
      {
        icon: icons.performance,
        labelKey: 'performance',
        label: 'Performance',
        path: '/performance',
        children: [
          {
            icon: icons.performance,
            labelKey: 'performance:pageTitle',
            label: 'Live Performance',
            path: '/performance'
          },
          {
            icon: icons.diagnostics,
            labelKey: 'diagnostics:title',
            label: 'Diagnostics',
            path: '/performance-diagnostics'
          },
          {
            icon: icons.services,
            labelKey: 'hardening:serviceManager.pageTitle',
            label: 'Services',
            path: '/services'
          },
          { icon: icons.gameMode, labelKey: 'gameMode', label: 'Game Mode', path: '/game-mode' }
        ]
      }
    ]
  },
  {
    headingKey: 'maintainHeading',
    items: [
      {
        icon: icons.software,
        labelKey: 'software',
        label: 'Software',
        path: '/software',
        children: [
          {
            icon: icons.updates,
            labelKey: 'updates:softwareUpdater.pageTitle',
            label: 'Software Updates',
            path: '/updates'
          },
          {
            icon: icons.drivers,
            labelKey: 'updates:driverManager.pageTitle',
            label: 'Driver Updates',
            path: '/drivers'
          },
          {
            icon: icons.uninstall,
            labelKey: 'uninstaller:pageTitle',
            label: 'Uninstaller',
            path: '/uninstaller'
          },
          {
            icon: icons.debloat,
            labelKey: 'hardening:debloater.pageTitle',
            label: 'Bloatware Remover',
            path: '/debloater'
          },
          {
            icon: icons.contextMenu,
            labelKey: 'contextMenu:pageTitle',
            label: 'Context Menu',
            path: '/context-menu'
          }
        ]
      },
      {
        icon: icons.storage,
        labelKey: 'diskTools',
        label: 'Storage',
        path: '/disk',
        children: [
          {
            icon: icons.storage,
            labelKey: 'disk:pageTitle',
            label: 'Storage Overview',
            path: '/disk'
          },
          {
            icon: icons.duplicates,
            labelKey: 'duplicates:pageTitle',
            label: 'Duplicate Finder',
            path: '/duplicates'
          },
          {
            icon: icons.largeFiles,
            labelKey: 'largeFiles:pageTitle',
            label: 'Large File Finder',
            path: '/large-files'
          },
          {
            icon: icons.emptyFolders,
            labelKey: 'emptyFolders:pageTitle',
            label: 'Empty Folder Cleaner',
            path: '/empty-folders'
          },
          {
            icon: icons.shredder,
            labelKey: 'fileShredder:pageTitle',
            label: 'File Shredder',
            path: '/file-shredder'
          },
          {
            icon: icons.repair,
            labelKey: 'disk:repairTitle',
            label: 'Windows Repair',
            path: '/disk-repair'
          },
          {
            icon: icons.maintenance,
            labelKey: 'disk:maintenanceTitle',
            label: 'Disk Maintenance',
            path: '/disk-maintenance'
          },
          {
            icon: icons.storageHistory,
            labelKey: 'disk:storage.title',
            label: 'Storage History',
            path: '/storage-history'
          }
        ]
      },
      {
        icon: icons.history,
        labelKey: 'activityAndRecovery',
        label: 'Activity & Recovery',
        path: '/history',
        children: [
          { icon: icons.history, labelKey: 'history', label: 'Activity', path: '/history' },
          {
            icon: icons.recovery,
            labelKey: 'history:recovery.title',
            label: 'Recovery Centre',
            path: '/recovery'
          }
        ]
      }
    ]
  }
]

/** The group pinned to the bottom of the sidebar. The Sidebar adds the update badge. */
export const bottomNavItems: NavGroupItem[] = [
  {
    icon: icons.settings,
    labelKey: 'settings',
    label: 'Preferences',
    path: '/settings',
    children: [
      {
        icon: icons.settings,
        labelKey: 'settings:pageTitle',
        label: 'Preferences',
        path: '/settings'
      },
      { icon: icons.ai, labelKey: 'ai:title', label: 'AI analysis', path: '/ai' },
      {
        icon: icons.about,
        labelKey: 'settings:sectionAbout',
        label: 'About & Updates',
        path: '/about'
      }
    ]
  }
]

const allItems = (): NavGroupItem[] => [...navGroups.flatMap((g) => g.items), ...bottomNavItems]

/**
 * "Group › Page" for a page inside a sidebar group; null for Home, other top-level
 * entries and unknown routes, which have no crumb.
 */
export function crumbFor(pathname: string): { group: NavGroupItem; item: NavLeaf } | null {
  for (const group of allItems()) {
    const item = group.children?.find((child) => child.path === pathname)
    if (item) return { group, item }
  }
  return null
}

/** The sidebar entry for a page, top-level or inside a group. */
export function navLeafFor(pathname: string): NavLeaf | null {
  return crumbFor(pathname)?.item ?? allItems().find((item) => item.path === pathname) ?? null
}

/** The translated label of a sidebar entry. */
export function navLabel(t: TFunction, leaf: NavLeaf): string {
  return t(leaf.labelKey, { ns: leaf.ns ?? 'sidebar', defaultValue: leaf.label })
}
