import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC } from '../../shared/channels'
import {
  aiErrorCode,
  analyzeMetadataWithCodex,
  getCodexConnectionStatus
} from '../services/codex-connection'
import { parseAiResult, validateAiMetadata } from '../services/ai-metadata-policy'
import { getSettings } from '../services/settings-store'
import type { WindowGetter } from './index'

export function registerAiAnalysisIpc(getWindow: WindowGetter): void {
  let active: AbortController | null = null
  let status: ReturnType<typeof getCodexConnectionStatus> | null = null
  let statusController: AbortController | null = null
  const assertSender = (event: IpcMainInvokeEvent) => {
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
  ipcMain.handle(IPC.AI_ANALYSIS_STATUS, (event) => {
    const window = assertSender(event)
    // Collapse repeated UI refreshes into a single login-only check.
    if (!status) {
      const controller = new AbortController()
      statusController = controller
      const cancel = () => controller.abort()
      const cancelNavigation = (details: Electron.WebContentsDidStartNavigationEventParams) => {
        if (details.isMainFrame && !details.isSameDocument) cancel()
      }
      window.once('closed', cancel)
      event.sender.once('destroyed', cancel)
      event.sender.once('render-process-gone', cancel)
      event.sender.on('did-start-navigation', cancelNavigation)
      status = getCodexConnectionStatus(controller.signal).finally(() => {
        window.removeListener('closed', cancel)
        event.sender.removeListener('destroyed', cancel)
        event.sender.removeListener('render-process-gone', cancel)
        event.sender.removeListener('did-start-navigation', cancelNavigation)
        status = null
        statusController = null
      })
    }
    return status
  })
  ipcMain.handle(IPC.AI_ANALYSIS_RUN, async (event, input: unknown) => {
    const window = assertSender(event)
    if (active) throw new Error('busy')
    const request = validateAiMetadata(input)
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
      const text = await analyzeMetadataWithCodex(request, {
        italian: getSettings().language === 'it',
        signal: controller.signal
      })
      return parseAiResult(text, request)
    } catch (error) {
      // Only fixed codes cross IPC; retaining the original cause can expose account diagnostics.
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
  ipcMain.handle(IPC.AI_ANALYSIS_CANCEL, (event) => {
    assertSender(event)
    active?.abort()
  })
  app.once('before-quit', () => {
    active?.abort()
    statusController?.abort()
  })
}
