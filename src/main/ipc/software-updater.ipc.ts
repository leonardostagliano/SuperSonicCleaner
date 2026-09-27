import { ipcMain } from 'electron'
import { IPC } from '../../shared/channels'
import { checkForUpdates, runUpdates } from '../services/software-updater'
import { trackMainWork } from '../services/main-work'
import { addSoftwareIcons } from '../services/software-icons'
import type { WindowGetter } from './index'
import type {
  UpdateCheckResult,
  UpdateProgress,
  UpdateRequestItem,
  UpdateResult
} from '../../shared/types'

const emptyResult = (): UpdateResult => ({
  succeeded: 0,
  failed: 0,
  updated: [],
  pending: [],
  errors: []
})

/** Longest display name passed through; names from a scan are far shorter. */
const MAX_NAME_LENGTH = 200

/** A display name safe to echo back in progress, results and CLI logs. */
function cleanName(name: unknown): string | undefined {
  if (typeof name !== 'string') return undefined
  const cleaned = name
    .replace(/\p{Cc}/gu, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
  return cleaned || undefined
}

export function registerSoftwareUpdaterIpc(getWindow: WindowGetter): void {
  const sendProgress = (data: UpdateProgress): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC.SOFTWARE_UPDATE_PROGRESS, data)
  }

  ipcMain.handle(IPC.SOFTWARE_UPDATE_CHECK, async (): Promise<UpdateCheckResult> => {
    return addSoftwareIcons(await checkForUpdates())
  })

  ipcMain.handle(
    IPC.SOFTWARE_UPDATE_RUN,
    async (_event, items: UpdateRequestItem[]): Promise<UpdateResult> => {
      if (!Array.isArray(items) || items.length === 0) return emptyResult()
      // Per-manager upgrade functions each validate the id against a strict
      // pattern; here we only enforce basic shape and bounds.
      const safeItems: UpdateRequestItem[] = items
        .filter(
          (it): it is UpdateRequestItem =>
            !!it &&
            typeof it.id === 'string' &&
            it.id.length > 0 &&
            it.id.length < 200 &&
            typeof it.source === 'string' &&
            it.source.length < 40
        )
        .map((it) => {
          const name = cleanName(it.name)
          return { id: it.id, source: it.source, ...(name ? { name } : {}) }
        })
      if (safeItems.length === 0) return emptyResult()
      return trackMainWork(runUpdates(safeItems, sendProgress))
    }
  )
}
