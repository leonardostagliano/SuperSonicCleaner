import { BrowserWindow, ipcMain, nativeTheme, screen } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { join, parse } from 'node:path'
import { app } from 'electron'
import {
  NOTCH_COMPACT,
  NOTCH_IPC,
  NOTCH_MOTION_MS,
  type NotchMetrics,
  type NotchPosition,
  type NotchState
} from '../../shared/desktop-notch'
import { getDataDir, getSettings } from './settings-store'
import { perfMonitor } from './perf-monitor'
import { notchLayout, restoreNotchBounds, saveNotchPosition } from './notch-position'

interface NotchConfig {
  enabled: boolean
  pinned: boolean
  position: NotchPosition | null
}

export function initDesktopNotch(
  getMainWindow: () => BrowserWindow | null,
  openMainWindow: () => void
): () => void {
  const configPath = join(getDataDir(), 'desktop-notch.json')
  let config: NotchConfig = { enabled: false, pinned: false, position: null }
  try {
    const data = JSON.parse(readFileSync(configPath, 'utf8'))
    const position = data.position
    config = {
      enabled: data.enabled === true,
      pinned: data.pinned === true,
      position:
        position &&
        Number.isFinite(position.displayId) &&
        Number.isFinite(position.x) &&
        Number.isFinite(position.y)
          ? { displayId: position.displayId, x: position.x, y: position.y }
          : null
    }
  } catch {
    /* First run or invalid geometry: use a visible default. */
  }

  let win: BrowserWindow | null = null
  let observedMain: BrowserWindow | null = null
  let notchReady = false
  let expanded = config.pinned
  let metrics: NotchMetrics | null = null
  let disk: NotchMetrics['disk'] = null
  let unsubscribe: (() => void) | null = null
  let diskTimer: ReturnType<typeof setInterval> | null = null
  let moveTimer: ReturnType<typeof setTimeout> | null = null
  let collapseTimer: ReturnType<typeof setTimeout> | null = null
  let expandTimer: ReturnType<typeof setTimeout> | null = null
  let shrinkTimer: ReturnType<typeof setTimeout> | null = null
  let dragTimer: ReturnType<typeof setTimeout> | null = null
  let dragging = false
  let movingUntil = 0
  let placingUntil = 0
  let shuttingDown = false
  let diskRunning = false

  const persist = () => {
    try {
      mkdirSync(getDataDir(), { recursive: true })
      writeFileSync(`${configPath}.tmp`, JSON.stringify(config))
      renameSync(`${configPath}.tmp`, configPath)
    } catch (error) {
      console.error('Could not save desktop notch settings:', error)
    }
  }
  const layout = () => {
    const availableDisplays = displays()
    const compact = restoreNotchBounds(config.position, availableDisplays, false)
    const open = restoreNotchBounds(config.position, availableDisplays, true)
    // macOS has no window region, so there the window stays the size of the panel.
    return { compact, open, ...notchLayout(compact, open, process.platform !== 'darwin') }
  }
  const state = (): NotchState => {
    const settings = getSettings()
    const { compact, open, panel } = layout()
    return {
      enabled: config.enabled,
      pinned: config.pinned,
      expanded,
      compactOffset: { x: compact.x - open.x, y: compact.y - open.y },
      panelOrigin: { x: panel.x, y: panel.y },
      theme:
        settings.theme === 'system'
          ? nativeTheme.shouldUseDarkColors
            ? 'dark'
            : 'light'
          : settings.theme,
      language: settings.language,
      metrics
    }
  }
  const broadcast = () => {
    // A drag ends with a broadcast; repainting the tab while the OS moves it only adds work.
    if (dragging) return
    for (const target of [win, getMainWindow()]) {
      if (target && !target.isDestroyed() && !target.webContents.isDestroyed()) {
        try {
          target.webContents.send(NOTCH_IPC.STATE, state())
        } catch {
          /* Window closing. */
        }
      }
    }
  }
  const displays = () => {
    const primary = screen.getPrimaryDisplay()
    return [primary, ...screen.getAllDisplays().filter((display) => display.id !== primary.id)]
  }
  const syncVisibility = () => {
    if (!win || win.isDestroyed() || !notchReady) return
    const main = getMainWindow()
    const mainOpen = main && !main.isDestroyed() && main.isVisible() && !main.isMinimized()
    if (!config.enabled || mainOpen) {
      if (win.isVisible()) win.hide()
      stopMetrics()
    } else if (!win.isVisible()) {
      win.showInactive()
      startMetrics()
    } else {
      startMetrics()
    }
  }
  const watchMainVisibility = (main: BrowserWindow) => {
    main.on('show', syncVisibility)
    main.on('hide', syncVisibility)
    main.on('minimize', syncVisibility)
    main.on('restore', syncVisibility)
    main.on('closed', syncVisibility)
  }
  const unwatchMainVisibility = (main: BrowserWindow) => {
    main.removeListener('show', syncVisibility)
    main.removeListener('hide', syncVisibility)
    main.removeListener('minimize', syncVisibility)
    main.removeListener('restore', syncVisibility)
    main.removeListener('closed', syncVisibility)
  }
  const observeMain = () => {
    const current = getMainWindow()
    const next = current && !current.isDestroyed() ? current : null
    if (next === observedMain) {
      syncVisibility()
      return
    }
    if (observedMain) unwatchMainVisibility(observedMain)
    observedMain = next
    if (observedMain) watchMainVisibility(observedMain)
    syncVisibility()
  }
  const place = () => {
    if (!win || win.isDestroyed() || dragging) return
    const bounds = layout().window
    placingUntil = Date.now() + 200
    const current = win.getBounds()
    if (
      current.x !== bounds.x ||
      current.y !== bounds.y ||
      current.width !== bounds.width ||
      current.height !== bounds.height
    )
      win.setBounds(bounds)
    shapeWindow()
  }
  const shapeWindow = () => {
    if (!win || win.isDestroyed() || dragging) return
    if (process.platform === 'darwin') return
    const { tab, panel } = layout()
    win.setShape([expanded || shrinkTimer ? panel : tab])
  }
  const cancelShrink = () => {
    if (shrinkTimer) clearTimeout(shrinkTimer)
    shrinkTimer = null
  }
  const finishCollapse = () => {
    if (expanded || !shrinkTimer) return
    cancelShrink()
    shapeWindow()
  }
  const beginCollapse = () => {
    if (config.pinned || !expanded) return
    expanded = false
    broadcast()
    // Keep the full input region until the renderer has finished sliding out.
    // The timer is a fallback for a crashed or throttled renderer.
    shrinkTimer = setTimeout(finishCollapse, NOTCH_MOTION_MS + 120)
  }
  const rememberPosition = () => {
    if (!win || win.isDestroyed()) return
    const bounds = win.getBounds()
    const { tab } = layout()
    const onScreen = { ...NOTCH_COMPACT, x: bounds.x + tab.x, y: bounds.y + tab.y }
    config.position = saveNotchPosition(onScreen, screen.getDisplayMatching(onScreen))
    persist()
  }
  /** Saves a move that has not settled yet (debounce pending or a drag still running). */
  const flushPosition = () => {
    if (!moveTimer && !dragging) return
    if (moveTimer) clearTimeout(moveTimer)
    moveTimer = null
    rememberPosition()
  }
  const settle = () => {
    rememberPosition()
    place()
    broadcast()
  }
  // A drag by the grip is the OS move loop ('will-move' … 'moved'). Nothing is placed,
  // shaped or repainted until it ends, so the window just follows the pointer. The input
  // region is dropped for the drag: Windows keeps it in physical pixels, so on a display
  // with another scale factor it would crop the tab.
  const beginDrag = () => {
    if (dragTimer) clearTimeout(dragTimer)
    // Fallback for a move loop that never reports its end.
    dragTimer = setTimeout(endDrag, 10000)
    if (dragging || !win || win.isDestroyed()) return
    if (moveTimer) clearTimeout(moveTimer)
    moveTimer = null
    win.setShape([])
    dragging = true
  }
  const endDrag = () => {
    if (dragTimer) clearTimeout(dragTimer)
    dragTimer = null
    if (!dragging) return
    dragging = false
    settle()
  }
  const cancelCollapse = () => {
    if (collapseTimer) clearTimeout(collapseTimer)
    collapseTimer = null
  }
  const cancelExpand = () => {
    if (expandTimer) clearTimeout(expandTimer)
    expandTimer = null
  }
  const expandWhenStationary = () => {
    cancelExpand()
    if (!win || win.isDestroyed() || !config.enabled) return
    const delay = movingUntil - Date.now()
    if (delay > 0) {
      expandTimer = setTimeout(expandWhenStationary, delay + 20)
      return
    }
    if (expanded) return
    expanded = true
    cancelShrink()
    shapeWindow()
    broadcast()
  }
  const collapseWhenStationary = () => {
    cancelCollapse()
    const delay = movingUntil - Date.now()
    if (delay > 0) {
      collapseTimer = setTimeout(collapseWhenStationary, delay + 50)
      return
    }
    beginCollapse()
  }
  const refreshDisk = async () => {
    if (diskRunning) return
    diskRunning = true
    try {
      const volume = process.platform === 'win32' ? parse(app.getPath('home')).root : '/'
      const stats = await statfs(volume)
      const total = stats.blocks * stats.bsize
      const used = Math.max(0, total - stats.bfree * stats.bsize)
      disk = total > 0 ? { percent: (used / total) * 100, used, total, volume } : null
    } catch {
      disk = null
    } finally {
      diskRunning = false
    }
  }
  const stopMetrics = () => {
    unsubscribe?.()
    unsubscribe = null
    if (diskTimer) clearInterval(diskTimer)
    diskTimer = null
  }
  const startMetrics = () => {
    if (unsubscribe) return
    void refreshDisk()
    diskTimer = setInterval(() => void refreshDisk(), 30000)
    unsubscribe = perfMonitor.subscribeSnapshots((snapshot) => {
      metrics = {
        timestamp: snapshot.timestamp,
        cpu: snapshot.cpu.overall,
        memory: {
          percent: snapshot.memory.percent,
          used: snapshot.memory.usedBytes,
          total: snapshot.memory.totalBytes
        },
        disk
      }
      broadcast()
    })
  }
  const create = () => {
    if (win && !win.isDestroyed()) return
    expanded = config.pinned
    notchReady = false
    win = new BrowserWindow({
      ...layout().window,
      title: 'SuperSonicCleaner · Desktop monitor',
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        additionalArguments: ['--kudu-desktop-notch']
      }
    })
    // The OS shrinks a new window that is taller than the work area and a non-resizable
    // window keeps that size, so the full canvas is set again once it exists.
    place()
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.on('ready-to-show', () => {
      notchReady = true
      if (config.enabled) {
        syncVisibility()
        broadcast()
      }
    })
    if (process.platform === 'win32') {
      // On macOS 'moved' is an alias of 'move'; there the debounce below settles a drag.
      win.on('will-move', beginDrag)
      win.on('moved', endDrag)
    }
    win.on('move', () => {
      if (Date.now() < placingUntil) return
      movingUntil = Date.now() + 600
      if (dragging) return
      if (moveTimer) clearTimeout(moveTimer)
      moveTimer = setTimeout(() => {
        moveTimer = null
        settle()
      }, 400)
    })
    win.on('closed', () => {
      win = null
      notchReady = false
      if (dragTimer) clearTimeout(dragTimer)
      dragTimer = null
      dragging = false
      cancelCollapse()
      cancelExpand()
      cancelShrink()
      stopMetrics()
      if (!shuttingDown) {
        config.enabled = false
        persist()
        broadcast()
      }
    })
    if (process.env.ELECTRON_RENDERER_URL) {
      const url = new URL(process.env.ELECTRON_RENDERER_URL)
      url.searchParams.set('desktop-notch', '1')
      void win.loadURL(url.toString())
    } else {
      void win.loadFile(join(__dirname, '../renderer/index.html'), {
        query: { 'desktop-notch': '1' }
      })
    }
  }
  const allowed = (event: Electron.IpcMainInvokeEvent) => {
    const main = getMainWindow()
    return (
      event.senderFrame === event.sender.mainFrame &&
      (event.sender === win?.webContents ||
        (!!main && !main.isDestroyed() && event.sender === main.webContents))
    )
  }
  const overlayOnly = (event: Electron.IpcMainInvokeEvent) =>
    allowed(event) && event.sender === win?.webContents
  ipcMain.handle(NOTCH_IPC.GET, (event) => {
    if (!allowed(event)) throw new Error('Unknown notch client')
    return state()
  })
  ipcMain.handle(NOTCH_IPC.VISIBLE, (event, visible: unknown) => {
    if (!allowed(event) || typeof visible !== 'boolean') return
    config.enabled = visible
    persist()
    if (visible) create()
    else {
      cancelExpand()
      flushPosition()
      win?.close()
      stopMetrics()
    }
    broadcast()
  })
  ipcMain.handle(NOTCH_IPC.PINNED, (event, pinned: unknown) => {
    if (!overlayOnly(event) || typeof pinned !== 'boolean') return
    config.pinned = pinned
    cancelCollapse()
    if (pinned) cancelExpand()
    if (pinned) cancelShrink()
    if (pinned) expanded = true
    persist()
    shapeWindow()
    broadcast()
  })
  ipcMain.handle(NOTCH_IPC.EXPANDED, (event, value: unknown) => {
    if (!overlayOnly(event) || typeof value !== 'boolean') return
    cancelCollapse()
    if (!value) {
      cancelExpand()
      collapseWhenStationary()
      return
    }
    expandWhenStationary()
  })
  ipcMain.handle(NOTCH_IPC.COLLAPSE_FINISHED, (event) => {
    if (overlayOnly(event)) finishCollapse()
  })
  ipcMain.handle(NOTCH_IPC.MOVE, (event, dx: unknown, dy: unknown) => {
    if (
      !overlayOnly(event) ||
      !win ||
      !Number.isInteger(dx) ||
      !Number.isInteger(dy) ||
      Math.abs(dx as number) > 50 ||
      Math.abs(dy as number) > 50
    )
      return
    const bounds = win.getBounds()
    win.setPosition(bounds.x + (dx as number), bounds.y + (dy as number))
    rememberPosition()
    place()
    broadcast()
  })
  ipcMain.handle(NOTCH_IPC.OPEN, (event) => {
    if (overlayOnly(event)) openMainWindow()
  })
  nativeTheme.on('updated', broadcast)
  const reposition = () => {
    place()
    broadcast()
  }
  screen.on('display-added', reposition)
  screen.on('display-removed', reposition)
  screen.on('display-metrics-changed', reposition)
  const onWindowCreated = () => {
    setImmediate(() => {
      if (!shuttingDown) observeMain()
    })
  }
  app.on('browser-window-created', onWindowCreated)
  observeMain()
  if (config.enabled) create()

  return () => {
    shuttingDown = true
    cancelCollapse()
    cancelExpand()
    cancelShrink()
    flushPosition()
    stopMetrics()
    win?.destroy()
    if (observedMain) unwatchMainVisibility(observedMain)
    app.removeListener('browser-window-created', onWindowCreated)
    nativeTheme.removeListener('updated', broadcast)
    screen.removeListener('display-added', reposition)
    screen.removeListener('display-removed', reposition)
    screen.removeListener('display-metrics-changed', reposition)
    for (const channel of Object.values(NOTCH_IPC)) ipcMain.removeHandler(channel)
  }
}
