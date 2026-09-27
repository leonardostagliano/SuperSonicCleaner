import { app, dialog, ipcMain, safeStorage } from 'electron'
import { join } from 'path'
import { writeFile } from 'fs/promises'
import { IPC } from '../../shared/channels'
import { diagnosticId, diagnosticExportPayload } from '../../shared/performance-diagnostics'
import { DiagnosticsStore } from '../services/diagnostics-store'
import { PerformanceDiagnostics } from '../services/performance-diagnostics'
import { aiErrorCode } from '../services/codex-connection'
import type { WindowGetter } from './index'

export function registerPerformanceDiagnosticsIpc(getWindow: WindowGetter = () => null): void {
  const service = new PerformanceDiagnostics(
    new DiagnosticsStore(
      join(app.getPath('userData'), 'performance-diagnostics'),
      (value) => {
        if (
          !safeStorage.isEncryptionAvailable() ||
          (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
        )
          throw new Error(
            'Secure local storage is unavailable. Enable your system keyring before recording.'
          )
        return safeStorage.encryptString(value)
      },
      (value) => safeStorage.decryptString(value)
    )
  )
  let active: AbortController | null = null
  const assertSender = (event: Electron.IpcMainInvokeEvent) => {
    const window = getWindow()
    if (
      !window ||
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error('unauthorized')
    return window
  }
  ipcMain.handle(IPC.DIAGNOSTICS_AI_ANALYZE, async (event, id: unknown, language: unknown) => {
    const window = assertSender(event)
    if (active) throw new Error('busy')
    if (!diagnosticId(id) || (language !== 'en' && language !== 'it'))
      throw new Error('invalid-metadata')
    const controller = new AbortController()
    active = controller
    const cancel = () => controller.abort()
    const cancelNavigation = (details: Electron.WebContentsDidStartNavigationEventParams) => {
      if (details.isMainFrame && !details.isSameDocument) cancel()
    }
    window.once('closed', cancel)
    event.sender.once('destroyed', cancel)
    event.sender.once('render-process-gone', cancel)
    event.sender.on('did-start-navigation', cancelNavigation)
    try {
      return await service.analyzeAi(id, language, controller.signal)
    } catch (error) {
      // IPC exposes only fixed codes, never provider diagnostics or local paths.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(aiErrorCode(error))
    } finally {
      window.removeListener('closed', cancel)
      event.sender.removeListener('destroyed', cancel)
      event.sender.removeListener('render-process-gone', cancel)
      event.sender.removeListener('did-start-navigation', cancelNavigation)
      if (active === controller) active = null
    }
  })
  ipcMain.handle(IPC.DIAGNOSTICS_AI_CANCEL, (event) => {
    assertSender(event)
    active?.abort()
  })
  app.once('before-quit', () => active?.abort())
  ipcMain.handle(IPC.DIAGNOSTICS, async (_event, action: unknown, id: unknown, value: unknown) => {
    if (action === 'status') return service.status()
    if (action === 'start') return service.start(id, value)
    if (action === 'stop') return service.recorder.stop()
    if (!diagnosticId(id)) throw new Error('Invalid recording ID')
    switch (action) {
      case 'get':
        return service.get(id)
      case 'edit':
        return service.edit(id, value)
      case 'analyze':
        return service.analyze(id, value)
      case 'remove':
        return service.remove(id)
      case 'export': {
        const s = await service.get(id)
        const result = await dialog.showSaveDialog({
          title: 'Export diagnostic recording',
          defaultPath: `supersonic-cleaner-diagnostic-${id}.json`,
          filters: [{ name: 'JSON', extensions: ['json'] }]
        })
        if (result.canceled || !result.filePath) return false
        // Export contains sensitive process names if collected; never export account/key hashes.
        await writeFile(
          result.filePath,
          JSON.stringify(diagnosticExportPayload(s), null, 2),
          'utf8'
        )
        return true
      }
      default:
        throw new Error('Unknown diagnostics action')
    }
  })
}
