import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, handler)
  }
}))
vi.mock('../services/settings-store', () => ({
  getSettings: () => ({ exclusions: [], cleaner: { secureDelete: false } })
}))
vi.mock('../services/cleanup-receipts', () => ({
  recordNativeCleanup: (_label: string, run: () => unknown) => run()
}))
vi.mock('../services/privacy-traces', () => ({
  scanPrivacyTraces: vi.fn(async () => [{ itemCount: 3, totalSize: 2048 }]),
  cleanPrivacyTraces: vi.fn()
}))
vi.mock('../services/privacy-traces-shell', () => ({ findShellHistoryTraces: vi.fn() }))
vi.mock('../services/privacy-traces-linux', () => ({ findLinuxRecentFileTraces: vi.fn() }))
vi.mock('../services/privacy-traces-macos', () => ({
  findMacQuarantineTraces: vi.fn(),
  findMacRecentItemTraces: vi.fn()
}))
vi.mock('../services/privacy-traces-windows', () => ({
  findWindowsRecentTraces: vi.fn(),
  findWindowsRegistryTraces: vi.fn()
}))

import { IPC } from '../../shared/channels'
import { registerPrivacyTracesIpc } from './privacy-traces.ipc'

describe('privacy traces scan progress', () => {
  const send = vi.fn()

  beforeEach(() => {
    handlers.clear()
    send.mockReset()
    registerPrivacyTracesIpc(() => ({ isDestroyed: () => false, webContents: { send } }) as never)
  })

  it('sends no English status text, so the renderer shows its own category label', async () => {
    await handlers.get(IPC.PRIVACY_TRACES_SCAN)?.({})
    const progress = send.mock.calls
      .filter(([channel]) => channel === IPC.SCAN_PROGRESS)
      .map(
        ([, payload]) => payload as { currentPath: string; progress: number; itemsFound: number }
      )
    expect(progress).toHaveLength(2)
    expect(progress.map((p) => p.currentPath)).toEqual(['', ''])
    expect(progress[1]).toMatchObject({ progress: 100, itemsFound: 3 })
  })
})
