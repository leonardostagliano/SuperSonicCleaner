import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, nativeTheme } from 'electron'
import { NOTCH_IPC, NOTCH_MOTION_MS, type NotchState } from '../../shared/desktop-notch'
import { initDesktopNotch } from './desktop-notch'
import { perfMonitor } from './perf-monitor'

const mocks = vi.hoisted(() => ({
  current: null as unknown,
  position: null as { displayId: number; x: number; y: number } | null,
  stopSnapshots: vi.fn(),
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
}))

vi.mock('node:fs', () => ({
  readFileSync: () => JSON.stringify({ enabled: true, pinned: false, position: mocks.position }),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn()
}))
vi.mock('node:fs/promises', () => ({ statfs: async () => ({ blocks: 100, bsize: 1, bfree: 50 }) }))
vi.mock('./settings-store', () => ({
  getDataDir: () => 'test',
  getSettings: () => ({ theme: 'dark', language: 'en' })
}))
vi.mock('./perf-monitor', () => ({
  perfMonitor: { subscribeSnapshots: vi.fn(() => mocks.stopSnapshots) }
}))
vi.mock('electron', () => {
  class Window {
    bounds = { x: 0, y: 0, width: 0, height: 0 }
    shape: { x: number; y: number; width: number; height: number }[] = []
    destroyed = false
    visible = false
    minimized = false
    listeners = new Map<string, () => void>()
    webContents = {
      mainFrame: {},
      isDestroyed: () => false,
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn()
    }
    constructor(bounds: { x: number; y: number; width: number; height: number }) {
      this.bounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
      mocks.current = this
    }
    on(name: string, callback: () => void) {
      this.listeners.set(name, callback)
    }
    removeListener(name: string) {
      this.listeners.delete(name)
    }
    isDestroyed() {
      return this.destroyed
    }
    isVisible() {
      return this.visible
    }
    isMinimized() {
      return this.minimized
    }
    show() {
      this.visible = true
      this.listeners.get('show')?.()
    }
    showInactive() {
      this.show()
    }
    hide() {
      this.visible = false
      this.listeners.get('hide')?.()
    }
    minimize() {
      this.minimized = true
      this.listeners.get('minimize')?.()
    }
    restore() {
      this.minimized = false
      this.listeners.get('restore')?.()
    }
    getBounds() {
      return this.bounds
    }
    setBounds(bounds: typeof this.bounds) {
      this.bounds = bounds
    }
    setShape(rects: typeof this.shape) {
      this.shape = rects
    }
    setPosition(x: number, y: number) {
      this.bounds = { ...this.bounds, x, y }
    }
    loadURL() {
      return Promise.resolve()
    }
    loadFile() {
      return Promise.resolve()
    }
    destroy() {
      this.destroyed = true
      this.listeners.get('closed')?.()
    }
    close() {
      this.destroy()
    }
  }
  const display = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
  return {
    BrowserWindow: Window,
    ipcMain: {
      handle: (name: string, callback: (event: unknown, ...args: unknown[]) => unknown) =>
        mocks.handlers.set(name, callback),
      removeHandler: (name: string) => mocks.handlers.delete(name)
    },
    nativeTheme: { shouldUseDarkColors: true, on: vi.fn(), removeListener: vi.fn() },
    screen: {
      getPrimaryDisplay: () => display,
      getAllDisplays: () => [display],
      getDisplayMatching: () => display,
      on: vi.fn(),
      removeListener: vi.fn()
    },
    app: { getPath: () => '/', on: vi.fn(), removeListener: vi.fn() }
  }
})

const invoke = (name: string, ...args: unknown[]) => {
  const window = mocks.current as InstanceType<typeof BrowserWindow>
  const sender = window.webContents
  return mocks.handlers.get(name)?.({ sender, senderFrame: sender.mainFrame }, ...args)
}
const emit = (window: BrowserWindow, name: string) => {
  const target = window as unknown as { listeners: Map<string, () => void> }
  target.listeners.get(name)?.()
}
const beginMove = (window: BrowserWindow) => emit(window, 'move')
/** The OS move loop of a drag by the grip on Windows: 'will-move' … 'move' … 'moved'. */
const dragTo = (window: BrowserWindow, x: number, y: number) => {
  emit(window, 'will-move')
  window.setPosition(x, y)
  emit(window, 'move')
}
const TAB = { x: 280, y: 264, width: 64, height: 202 }
const CANVAS = { width: 624, height: 730 }
const readyToShow = (window: BrowserWindow) => {
  const readyWindow = window as unknown as { listeners: Map<string, () => void> }
  readyWindow.listeners.get('ready-to-show')?.()
}
const shapeOf = (window: BrowserWindow) =>
  (window as unknown as { shape: { x: number; y: number; width: number; height: number }[] }).shape

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  mocks.handlers.clear()
  mocks.current = null
  mocks.position = null
  vi.clearAllMocks()
})

describe('desktop notch motion lifecycle', () => {
  beforeEach(() => {
    // The shape API is used on Windows and Linux, but intentionally skipped on macOS.
    vi.stubGlobal('process', { ...process, platform: 'win32' })
  })

  it('keeps native bounds fixed without shaping the window on macOS', () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' })
    vi.useFakeTimers()
    const dispose = initDesktopNotch(
      () => null,
      () => {}
    )
    const window = mocks.current as InstanceType<typeof BrowserWindow>
    const bounds = window.getBounds()
    // No window region on macOS: the window stays the panel, not the larger canvas.
    expect(bounds).toMatchObject({ width: 344, height: 466 })
    expect(shapeOf(window)).toEqual([])

    invoke(NOTCH_IPC.EXPANDED, true)
    expect(window.getBounds()).toEqual(bounds)
    expect(shapeOf(window)).toEqual([])
    invoke(NOTCH_IPC.EXPANDED, false)
    invoke(NOTCH_IPC.COLLAPSE_FINISHED)
    expect(window.getBounds()).toEqual(bounds)
    expect(shapeOf(window)).toEqual([])
    dispose()
  })

  it('keeps native bounds fixed and narrows the input region only after closing', () => {
    vi.useFakeTimers()
    const dispose = initDesktopNotch(
      () => null,
      () => {}
    )
    const window = mocks.current as InstanceType<typeof BrowserWindow>
    const bounds = window.getBounds()
    expect(bounds).toMatchObject(CANVAS)
    expect(shapeOf(window)).toEqual([TAB])

    invoke(NOTCH_IPC.EXPANDED, true)
    expect(window.getBounds()).toEqual(bounds)
    expect(shapeOf(window)).toMatchObject([{ width: 344, height: 466 }])
    invoke(NOTCH_IPC.EXPANDED, false)
    expect(window.getBounds()).toEqual(bounds)
    invoke(NOTCH_IPC.MOVE, 10, 0)
    expect(window.getBounds()).toMatchObject(CANVAS)
    invoke(NOTCH_IPC.COLLAPSE_FINISHED)
    expect(window.getBounds()).toMatchObject(CANVAS)
    expect(shapeOf(window)).toEqual([TAB])
    dispose()
  })

  it('cancels a pending shrink when hover opens the notch again', () => {
    vi.useFakeTimers()
    const dispose = initDesktopNotch(
      () => null,
      () => {}
    )
    const window = mocks.current as InstanceType<typeof BrowserWindow>
    invoke(NOTCH_IPC.EXPANDED, true)
    invoke(NOTCH_IPC.EXPANDED, false)
    invoke(NOTCH_IPC.EXPANDED, true)
    vi.advanceTimersByTime(NOTCH_MOTION_MS + 200)
    invoke(NOTCH_IPC.COLLAPSE_FINISHED)
    expect(window.getBounds()).toMatchObject(CANVAS)
    expect(shapeOf(window)).toMatchObject([{ width: 344, height: 466 }])
    dispose()
  })

  it('honors hover after a drag cooldown at a clamped bottom-right anchor', () => {
    vi.useFakeTimers()
    mocks.position = { displayId: 1, x: 0.984, y: 0.987 }
    const dispose = initDesktopNotch(
      () => null,
      () => {}
    )
    const window = mocks.current as InstanceType<typeof BrowserWindow>
    const offset = (invoke(NOTCH_IPC.GET) as NotchState).compactOffset
    expect(offset.x).toBeGreaterThan(0)
    expect(offset.y).toBeGreaterThan(0)
    expect(shapeOf(window)).toEqual([TAB])
    beginMove(window)
    invoke(NOTCH_IPC.EXPANDED, true)
    expect(window.getBounds()).toMatchObject(CANVAS)
    expect(shapeOf(window)).toEqual([TAB])
    vi.advanceTimersByTime(650)
    expect(window.getBounds()).toMatchObject(CANVAS)
    expect(shapeOf(window)).toEqual([
      { x: TAB.x - offset.x, y: TAB.y - offset.y, width: 344, height: 466 }
    ])
    dispose()
  })

  it('cancels an opening queued during drag when the pointer leaves', () => {
    vi.useFakeTimers()
    const dispose = initDesktopNotch(
      () => null,
      () => {}
    )
    const window = mocks.current as InstanceType<typeof BrowserWindow>
    beginMove(window)
    invoke(NOTCH_IPC.EXPANDED, true)
    invoke(NOTCH_IPC.EXPANDED, false)
    vi.advanceTimersByTime(700)
    expect(window.getBounds()).toMatchObject(CANVAS)
    expect(shapeOf(window)).toEqual([TAB])
    dispose()
  })

  it('persists a dragged compact tab using its visible anchor, not the full viewport origin', () => {
    vi.useFakeTimers()
    mocks.position = { displayId: 1, x: 1, y: 1 }
    const dispose = initDesktopNotch(
      () => null,
      () => {}
    )
    const window = mocks.current as InstanceType<typeof BrowserWindow>
    const before = window.getBounds()
    const beforeShape = shapeOf(window)[0]
    invoke(NOTCH_IPC.MOVE, -10, -10)
    const after = window.getBounds()
    const afterShape = shapeOf(window)[0]
    expect(after.width).toBe(before.width)
    expect(after.height).toBe(before.height)
    expect(after.x + afterShape.x).toBe(before.x + beforeShape.x - 10)
    expect(after.y + afterShape.y).toBe(before.y + beforeShape.y - 10)
    const offset = (invoke(NOTCH_IPC.GET) as NotchState).compactOffset
    invoke(NOTCH_IPC.EXPANDED, true)
    vi.advanceTimersByTime(650)
    expect(shapeOf(window)).toEqual([
      { x: TAB.x - offset.x, y: TAB.y - offset.y, width: 344, height: 466 }
    ])
    dispose()
  })

  it('leaves a dragged tab where it was dropped and only then restores its input region', () => {
    vi.useFakeTimers()
    mocks.position = { displayId: 1, x: 1, y: 1 }
    const dispose = initDesktopNotch(
      () => null,
      () => {}
    )
    const window = mocks.current as InstanceType<typeof BrowserWindow>
    const send = vi.mocked(window.webContents.send)
    const themeChanged = vi.mocked(nativeTheme.on).mock.calls[0][1] as () => void
    const start = window.getBounds()
    expect((invoke(NOTCH_IPC.GET) as NotchState).compactOffset).toEqual({ x: 280, y: 264 })

    // Windows keeps the region in physical pixels: on a display with another scale it
    // would crop the tab, so the drag runs without one.
    dragTo(window, start.x - 500, start.y - 300)
    expect(shapeOf(window)).toEqual([])
    themeChanged()
    vi.advanceTimersByTime(1000)
    expect(send).not.toHaveBeenCalled()
    expect(window.getBounds()).toMatchObject({ x: start.x - 500, y: start.y - 300 })

    emit(window, 'moved')
    // The panel now opens to the right and below, but the tab stays where it was dropped.
    expect(window.getBounds()).toEqual({ ...start, x: start.x - 500, y: start.y - 300 })
    expect(shapeOf(window)).toEqual([TAB])
    const state = send.mock.lastCall?.[1] as NotchState
    expect(state.compactOffset).toEqual({ x: 0, y: 0 })
    dispose()
  })

  it('snaps a tab dropped past the edge of the screen back onto it', () => {
    vi.useFakeTimers()
    mocks.position = { displayId: 1, x: 1, y: 0.5 }
    const dispose = initDesktopNotch(
      () => null,
      () => {}
    )
    const window = mocks.current as InstanceType<typeof BrowserWindow>
    const start = window.getBounds()
    dragTo(window, start.x + 40, start.y)
    emit(window, 'moved')
    expect(window.getBounds()).toEqual(start)
    expect(shapeOf(window)).toEqual([TAB])
    dispose()
  })

  it('shows only while the main window is hidden or minimized, including when the notch is open', () => {
    vi.useFakeTimers()
    const main = new BrowserWindow({ width: 800, height: 600 })
    main.show()
    const dispose = initDesktopNotch(
      () => main,
      () => {}
    )
    const notch = mocks.current as InstanceType<typeof BrowserWindow>
    readyToShow(notch)
    expect(notch.isVisible()).toBe(false)
    expect(perfMonitor.subscribeSnapshots).not.toHaveBeenCalled()

    main.hide()
    expect(notch.isVisible()).toBe(true)
    expect(perfMonitor.subscribeSnapshots).toHaveBeenCalledTimes(1)
    invoke(NOTCH_IPC.EXPANDED, true)
    expect((invoke(NOTCH_IPC.GET) as NotchState).expanded).toBe(true)
    main.show()
    expect(notch.isVisible()).toBe(false)
    expect(mocks.stopSnapshots).toHaveBeenCalledTimes(1)
    main.minimize()
    expect(notch.isVisible()).toBe(true)
    expect(perfMonitor.subscribeSnapshots).toHaveBeenCalledTimes(2)
    main.restore()
    expect(notch.isVisible()).toBe(false)
    expect(mocks.stopSnapshots).toHaveBeenCalledTimes(2)
    expect((invoke(NOTCH_IPC.GET) as NotchState).enabled).toBe(true)
    dispose()
    expect((main as unknown as { listeners: Map<string, () => void> }).listeners.has('show')).toBe(
      false
    )
  })
})
