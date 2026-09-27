import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { APP_ID, APP_NAME } from './app-identity'
import { getWindowsRelaunchArgs, windowsArgument } from '../platform/win32/elevation'

function pinnedExecutable(executable: string, resourcesPath?: string): string {
  // Electron can report a sandbox alias for execPath even when resourcesPath
  // points at the real packaged directory. A pin must outlive that alias.
  const sibling = resourcesPath && join(dirname(resourcesPath), basename(executable))
  for (const candidate of [sibling, executable]) {
    if (!candidate || !existsSync(candidate)) continue
    try {
      return realpathSync.native(candidate)
    } catch {
      // Keep trying the remaining candidate.
    }
  }
  return executable
}

/** Pinning must retain the app entry/profile, including when running through Electron in dev. */
export function windowsAppDetails(
  options: Parameters<typeof getWindowsRelaunchArgs>[0] & {
    iconPath: string
    resourcesPath?: string
  }
): Electron.AppDetailsOptions {
  const executable = options.isPackaged
    ? pinnedExecutable(options.executable, options.resourcesPath)
    : options.executable
  return {
    appId: APP_ID,
    appIconPath: options.iconPath,
    appIconIndex: 0,
    relaunchDisplayName: APP_NAME,
    relaunchCommand: [executable, ...getWindowsRelaunchArgs(options)].map(windowsArgument).join(' ')
  }
}
