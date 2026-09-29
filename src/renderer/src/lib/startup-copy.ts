import type { PlatformInfo } from '@shared/types'

/**
 * The Startup page's scope sentence and empty-state text for each platform, which reads
 * its entries from different places: the registry, the Startup folder and Task Scheduler
 * on Windows; the LaunchAgents folders and the login items on macOS; the autostart
 * folder, the systemd user services and @reboot cron entries on Linux.
 */
export const STARTUP_COPY = {
  win32: { description: 'pageDescription', empty: 'emptyStateDescription' },
  darwin: { description: 'pageDescriptionMac', empty: 'emptyStateDescriptionMac' },
  linux: { description: 'pageDescriptionLinux', empty: 'emptyStateDescriptionLinux' }
} as const satisfies Record<PlatformInfo['platform'], { description: string; empty: string }>
