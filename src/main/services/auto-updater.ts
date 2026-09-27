import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC } from '../../shared/channels'
import { getSettings } from './settings-store'
import { retargetAppImageLaunchers } from './appimage-launchers'
import { isPortable } from './portable'
import type { UpdateStatus } from '../../shared/types'

let status: UpdateStatus = { state: 'idle' }
let checkInterval: ReturnType<typeof setInterval> | null = null

function releaseDetails(info: {
  version: string
  releaseNotes?: string | { version: string; note: string | null }[] | null
}): Pick<UpdateStatus, 'version' | 'releaseNotes' | 'checkedAt'> {
  const notes = Array.isArray(info.releaseNotes)
    ? info.releaseNotes.map((entry) => `${entry.version}\n${entry.note ?? ''}`).join('\n\n')
    : (info.releaseNotes ?? '')
  return {
    version: info.version,
    releaseNotes: notes.slice(0, 24000),
    checkedAt: new Date().toISOString()
  }
}

function broadcast(s: UpdateStatus): void {
  status = s
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    // isDestroyed() returns false while the render frame is mid-teardown,
    // so .send() still throws "Render frame was disposed before WebFrameMain
    // could be accessed". Swallow it — there's no recipient anyway, and the
    // unhandled stack trace was the loudest signal in issue #148, masking
    // the actual renderer crash.
    try {
      win.webContents.send(IPC.UPDATER_STATUS, s)
    } catch {
      /* renderer gone — nothing to deliver to */
    }
  }
}

/** electron-updater only supports AppImage on Linux and NSIS on Windows. */
function shouldSkipUpdater(): boolean {
  if (process.platform === 'linux' && !process.env.APPIMAGE) return true
  if (isPortable()) return true
  return false
}

function skipReason(): string {
  if (!app.isPackaged) return 'Updates are unavailable in development builds'
  if (process.platform === 'linux' && !process.env.APPIMAGE) {
    return 'In-app updates require the AppImage build (deb/package installs use your package manager)'
  }
  if (isPortable()) {
    return 'Portable builds require manual updates. Download the latest portable build from GitHub Releases.'
  }
  return 'Updates are unavailable for this package format'
}

export function initAutoUpdater(): void {
  if (!app.isPackaged) return

  if (shouldSkipUpdater()) {
    console.log('Auto-updater: skipping (unsupported package format)')
    return
  }

  const settings = getSettings()
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false
  autoUpdater.autoDownload = settings.autoUpdate
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    broadcast({ state: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    broadcast({ state: 'available', ...releaseDetails(info) })
  })

  autoUpdater.on('update-not-available', () => {
    broadcast({ state: 'not-available', checkedAt: new Date().toISOString() })
  })

  autoUpdater.on('download-progress', (prog) => {
    broadcast({ ...status, state: 'downloading', progress: Math.round(prog.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    const details = releaseDetails(info)
    broadcast({
      ...status,
      state: 'downloaded',
      ...details,
      releaseNotes: details.releaseNotes || status.releaseNotes,
      progress: 100
    })
    // Auto-restart only if the user opted in.
    const current = getSettings()
    if (current.autoRestart) {
      console.log(
        `Auto-updater: auto-restart enabled, installing v${info.version} and restarting...`
      )
      autoUpdater.quitAndInstall(true, true)
    }
  })

  autoUpdater.on('error', (err) => {
    broadcast({ ...status, state: 'error', error: err?.message || 'Update failed' })
  })

  // Versioned → stable AppImage rename leaves .desktop Exec= on the deleted path (#401).
  // Must stay sync: this fires inside quitAndInstall before the process exits.
  autoUpdater.on('appimage-filename-updated', (newFile: string) => {
    const oldFile = process.env.APPIMAGE
    if (typeof newFile !== 'string' || !oldFile || oldFile === newFile) return
    try {
      retargetAppImageLaunchers(oldFile, newFile)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('Auto-updater: failed to retarget desktop launchers:', message)
    }
  })

  // Check on startup
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('Auto-updater check failed:', err?.message || err)
  })

  // Periodic background checks
  startPeriodicChecks(settings.updateCheckIntervalHours)
}

function startPeriodicChecks(intervalHours: number): void {
  if (checkInterval) clearInterval(checkInterval)
  if (intervalHours <= 0) return
  const ms = intervalHours * 60 * 60 * 1000
  checkInterval = setInterval(() => {
    const settings = getSettings()
    autoUpdater.autoDownload = settings.autoUpdate
    checkForUpdates().catch((err) => {
      console.error('Auto-updater periodic check failed:', err?.message || err)
    })
  }, ms)
}

/** Call when the user changes updateCheckIntervalHours at runtime */
export function updateCheckInterval(hours: number): void {
  if (!app.isPackaged || shouldSkipUpdater()) return
  startPeriodicChecks(hours)
}

export function checkForUpdates(): Promise<void> {
  if (['checking', 'downloading', 'downloaded'].includes(status.state)) return Promise.resolve()
  // About → Check for updates used to resolve with no status change when the
  // package format is unsupported (common on Linux .deb), so the button looked dead.
  if (!app.isPackaged || shouldSkipUpdater()) {
    broadcast({ state: 'error', error: skipReason() })
    return Promise.resolve()
  }
  return autoUpdater
    .checkForUpdates()
    .then(() => {})
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      broadcast({ state: 'error', error: message || 'Update check failed' })
    })
}

export function downloadUpdate(): Promise<void> {
  if (!app.isPackaged || shouldSkipUpdater()) {
    broadcast({ state: 'error', error: skipReason() })
    return Promise.resolve()
  }
  if (status.state !== 'available') return Promise.resolve()
  broadcast({ ...status, state: 'downloading', progress: 0 })
  return autoUpdater
    .downloadUpdate()
    .then(() => {})
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      broadcast({ state: 'error', error: message || 'Update download failed' })
    })
}

export function installUpdate(): void {
  if (!app.isPackaged || shouldSkipUpdater()) return
  if (status.state !== 'downloaded') return
  autoUpdater.quitAndInstall(true, true)
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export function setAutoDownload(enabled: boolean): void {
  if (!app.isPackaged || shouldSkipUpdater()) return
  autoUpdater.autoDownload = enabled
}
