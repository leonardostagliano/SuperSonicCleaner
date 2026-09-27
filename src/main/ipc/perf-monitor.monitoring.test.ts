import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../shared/channels'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  service: { startMonitoring: vi.fn(), stopMonitoring: vi.fn() }
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, callback: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(channel, callback)
  }
}))
vi.mock('../services/perf-monitor', () => ({ perfMonitor: mocks.service }))

import { registerPerfMonitorIpc } from './perf-monitor.ipc'

class FakeWebContents extends EventEmitter {
  destroyed = false
  isDestroyed = () => this.destroyed
}

let page: FakeWebContents
let win: EventEmitter & { id: number; webContents: FakeWebContents }
const start = () => mocks.handlers.get(IPC.PERF_START_MONITORING)!({ sender: page })
const stop = () => mocks.handlers.get(IPC.PERF_STOP_MONITORING)!({ sender: page })
const navigate = (details: { isMainFrame: boolean; isSameDocument: boolean }) =>
  page.emit('did-start-navigation', details)
const hideAndShow = () => {
  win.emit('hide')
  win.emit('show')
}

beforeEach(() => {
  mocks.handlers.clear()
  mocks.service.startMonitoring.mockReset()
  mocks.service.stopMonitoring.mockReset()
  page = new FakeWebContents()
  win = Object.assign(new EventEmitter(), { id: 1, webContents: page })
  registerPerfMonitorIpc(() => win as unknown as Electron.BrowserWindow)
})

describe('perf monitoring across renderer reloads', () => {
  it('stops when its page reloads, and showing the window does not restart it', () => {
    start()
    expect(mocks.service.startMonitoring).toHaveBeenCalledTimes(1)
    navigate({ isMainFrame: true, isSameDocument: false })
    expect(mocks.service.stopMonitoring).toHaveBeenCalledTimes(1)
    hideAndShow()
    expect(mocks.service.startMonitoring).toHaveBeenCalledTimes(1)
  })

  it('keeps monitoring through in-page route changes and subframe navigations', () => {
    start()
    navigate({ isMainFrame: true, isSameDocument: true })
    navigate({ isMainFrame: false, isSameDocument: false })
    expect(mocks.service.stopMonitoring).not.toHaveBeenCalled()
    hideAndShow()
    expect(mocks.service.startMonitoring).toHaveBeenCalledTimes(2)
  })

  it('stops when the renderer process goes away or the page is destroyed', () => {
    start()
    page.emit('render-process-gone', {}, { reason: 'crashed' })
    expect(mocks.service.stopMonitoring).toHaveBeenCalledTimes(1)
    start()
    page.destroyed = true
    page.emit('destroyed')
    expect(mocks.service.stopMonitoring).toHaveBeenCalledTimes(2)
  })

  it('leaves an explicitly stopped monitor alone and watches each page only once', () => {
    start()
    start()
    expect(page.listenerCount('did-start-navigation')).toBe(1)
    stop()
    navigate({ isMainFrame: true, isSameDocument: false })
    expect(mocks.service.stopMonitoring).toHaveBeenCalledTimes(1)
  })
})
