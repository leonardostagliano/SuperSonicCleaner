// What a launch without administrator (root) rights cannot do, per platform. Each entry
// names the check in the main process that refuses the action, so the list stays tied to
// the code. macOS never shows the banner. Labels: `common:adminBannerFeatures.<key>`.

export type AdminFeature =
  | 'systemCleanup'
  | 'windowsRepair'
  | 'trim'
  | 'restorePoints'
  | 'registryRestore'
  | 'machinePrivacy'
  | 'contextMenu'
  | 'gameModeServices'
  | 'bootTrace'
  | 'linuxSystemCleanup'
  | 'linuxSecurity'

export const ADMIN_FEATURES: Record<'win32' | 'linux', readonly AdminFeature[]> = {
  win32: [
    'systemCleanup', // system-cleaner.ipc (needsAdmin rules), managed-cleanup (components, delivery optimization)
    'windowsRepair', // disk-analyzer.ipc: runSfc, runDism, runChkdsk
    'trim', // disk-trim.ipc
    'restorePoints', // restore-point: createRestorePoint
    'registryRestore', // registry-backups: restoreRegistryBackup
    'machinePrivacy', // privacy-shield.ipc: requiresAdmin settings (policies, services, tasks, browsers)
    'contextMenu', // context-menu-cleaner.ipc: HKCR entries
    'gameModeServices', // game-mode.ipc: service changes
    'bootTrace' // startup-manager.ipc: getBootTrace
  ],
  linux: [
    'linuxSystemCleanup', // system-cleaner.ipc (needsAdmin /var rules), managed-cleanup: journal-vacuum
    'trim', // disk-trim.ipc
    'linuxSecurity' // platform/linux/privacy: sysctl settings, GNOME connectivity, core dumps, SSH
  ]
}

/** The features unavailable without elevation on this platform; none on macOS. */
export function adminFeatures(platform: string): readonly AdminFeature[] {
  return platform === 'win32' || platform === 'linux' ? ADMIN_FEATURES[platform] : []
}

/** "a, b e c" in the UI language. */
export function joinList(items: readonly string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { type: 'conjunction' }).format(items)
  } catch {
    return items.join(', ')
  }
}
