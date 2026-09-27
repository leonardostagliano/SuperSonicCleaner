import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  analyze: vi.fn(),
  status: vi.fn(),
  quit: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) =>
      mocks.handlers.set(channel, handler)
  },
  app: { once: mocks.quit }
}))
vi.mock('../services/codex-connection', () => ({
  analyzeMetadataWithCodex: mocks.analyze,
  getCodexConnectionStatus: mocks.status,
  aiErrorCode: (error: Error) => (error.message === 'cancelled' ? 'cancelled' : 'analysis-failed')
}))
vi.mock('../services/settings-store', () => ({ getSettings: () => ({ language: 'it' }) }))

import { registerAiAnalysisIpc } from './ai-analysis.ipc'
import { IPC } from '../../shared/channels'
import type { WindowGetter } from './index'

const request = {
  source: 'large-files',
  items: [
    {
      id: 'bd66b758-c2cd-435a-b5a6-3145ecfda98f',
      fileType: 'video',
      sizeBytes: 1000,
      modifiedAgeDays: 365,
      accessedAgeDays: null
    }
  ]
}
let window: EventEmitter & {
  isDestroyed(): boolean
  webContents: EventEmitter & { mainFrame: object }
}
let event: { sender: typeof window.webContents; senderFrame: object }
function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return Promise.resolve().then(() => mocks.handlers.get(channel)!(...args))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  const contents = Object.assign(new EventEmitter(), { mainFrame: {} })
  window = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents: contents })
  event = { sender: contents, senderFrame: contents.mainFrame }
  registerAiAnalysisIpc((() => window) as WindowGetter)
  mocks.status.mockResolvedValue({ available: true, connected: true })
  mocks.analyze.mockResolvedValue(
    JSON.stringify({ summary: 'Review manually.', recommendations: [] })
  )
})

describe('AI analysis IPC authorization', () => {
  it('deduplicates account checks and cancels the check when its window closes', async () => {
    let signal: AbortSignal | undefined
    mocks.status.mockImplementation((input: AbortSignal) => {
      signal = input
      return new Promise((resolve) =>
        input.addEventListener('abort', () =>
          resolve({ connected: false, available: true, errorCode: 'cancelled' })
        )
      )
    })
    const first = invoke(IPC.AI_ANALYSIS_STATUS, event)
    const second = invoke(IPC.AI_ANALYSIS_STATUS, event)
    await vi.waitFor(() => expect(signal).toBeDefined())
    expect(mocks.status).toHaveBeenCalledOnce()
    window.emit('closed')
    await expect(first).resolves.toMatchObject({ errorCode: 'cancelled' })
    await expect(second).resolves.toMatchObject({ errorCode: 'cancelled' })
    expect(window.webContents.listenerCount('destroyed')).toBe(0)
  })
  it.each([IPC.AI_ANALYSIS_STATUS, IPC.AI_ANALYSIS_RUN, IPC.AI_ANALYSIS_CANCEL])(
    'rejects a different window or an embedded frame for %s',
    async (channel) => {
      await expect(
        invoke(channel, { ...event, sender: new EventEmitter() }, request)
      ).rejects.toThrow('unauthorized')
      await expect(invoke(channel, { ...event, senderFrame: {} }, request)).rejects.toThrow(
        'unauthorized'
      )
      expect(mocks.analyze).not.toHaveBeenCalled()
      expect(mocks.status).not.toHaveBeenCalled()
    }
  )
  it('rejects a filename field before the connection receives any data', async () => {
    await expect(
      invoke(IPC.AI_ANALYSIS_RUN, event, {
        ...request,
        items: [{ ...request.items[0], filename: 'private.txt' }]
      })
    ).rejects.toThrow('invalid-metadata')
    expect(mocks.analyze).not.toHaveBeenCalled()
  })
  it('holds a single run until cancellation cleanup settles and removes lifecycle listeners', async () => {
    let signal: AbortSignal | undefined
    let finish: (() => void) | undefined
    mocks.analyze.mockImplementation((_request, options) => {
      signal = options.signal
      return new Promise((_resolve, reject) => {
        finish = () => reject(new Error('cancelled'))
      })
    })
    const first = invoke(IPC.AI_ANALYSIS_RUN, event, request)
    const failure = expect(first).rejects.toThrow('cancelled')
    await vi.waitFor(() => expect(signal).toBeDefined())
    await expect(invoke(IPC.AI_ANALYSIS_RUN, event, request)).rejects.toThrow('busy')
    await invoke(IPC.AI_ANALYSIS_CANCEL, event)
    expect(signal?.aborted).toBe(true)
    await expect(invoke(IPC.AI_ANALYSIS_RUN, event, request)).rejects.toThrow('busy')
    finish!()
    await failure
    expect(window.listenerCount('closed')).toBe(0)
    expect(window.webContents.listenerCount('destroyed')).toBe(0)
    expect(window.webContents.listenerCount('did-start-navigation')).toBe(0)
  })
  it.each(['closed', 'destroyed', 'render-process-gone', 'did-start-navigation'])(
    'cancels the request on %s',
    async (eventName) => {
      let signal: AbortSignal | undefined
      mocks.analyze.mockImplementation((_request, options) => {
        signal = options.signal
        return new Promise((_resolve, reject) =>
          signal!.addEventListener('abort', () => reject(new Error('cancelled')))
        )
      })
      const run = invoke(IPC.AI_ANALYSIS_RUN, event, request)
      const failure = expect(run).rejects.toThrow('cancelled')
      await vi.waitFor(() => expect(signal).toBeDefined())
      if (eventName === 'closed') window.emit(eventName)
      else if (eventName === 'did-start-navigation')
        window.webContents.emit(eventName, { isMainFrame: true, isSameDocument: false })
      else window.webContents.emit(eventName)
      await failure
      expect(signal?.aborted).toBe(true)
    }
  )
  it.each([IPC.AI_ANALYSIS_RUN, IPC.AI_ANALYSIS_STATUS])(
    'preserves %s across hash routes but still cancels a later document navigation',
    async (channel) => {
      let signal: AbortSignal | undefined
      const pending = (input: AbortSignal) => {
        signal = input
        return new Promise((_resolve, reject) => {
          input.addEventListener('abort', () => reject(new Error('cancelled')))
        })
      }
      mocks.status.mockImplementation(pending)
      mocks.analyze.mockImplementation((_request, options) => pending(options.signal))
      const run = invoke(channel, event, request)
      const failure = expect(run).rejects.toThrow('cancelled')
      await vi.waitFor(() => expect(signal).toBeDefined())
      window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
      window.webContents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
      window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
      expect(signal?.aborted).toBe(false)
      expect(window.webContents.listenerCount('did-start-navigation')).toBe(1)
      window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
      await failure
      expect(signal?.aborted).toBe(true)
      expect(window.webContents.listenerCount('did-start-navigation')).toBe(0)
    }
  )
  it('returns only a fixed error code for private upstream diagnostics', async () => {
    mocks.analyze.mockRejectedValue(new Error('private account and local path'))
    await expect(invoke(IPC.AI_ANALYSIS_RUN, event, request)).rejects.toThrow(/^analysis-failed$/)
  })
})
