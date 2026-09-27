import type { BrowserWindow } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { openMainWindow } from './main-window-lifecycle'

function windowState(
  options: { destroyed?: boolean; minimized?: boolean; visible?: boolean } = {}
) {
  const window = {
    isDestroyed: vi.fn(() => options.destroyed ?? false),
    isMinimized: vi.fn(() => options.minimized ?? false),
    isVisible: vi.fn(() => options.visible ?? true),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn()
  }
  return window
}

describe('opening the main window', () => {
  it('shows and focuses a window hidden in the tray', () => {
    const window = windowState({ visible: false })
    const createWindow = vi.fn()

    openMainWindow(window as unknown as BrowserWindow, createWindow)

    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    expect(window.restore).not.toHaveBeenCalled()
    expect(createWindow).not.toHaveBeenCalled()
  })

  it('restores a minimized window before focusing it', () => {
    const window = windowState({ minimized: true, visible: false })

    openMainWindow(window as unknown as BrowserWindow, vi.fn())

    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    expect(window.restore.mock.invocationCallOrder[0]).toBeLessThan(
      window.focus.mock.invocationCallOrder[0]!
    )
  })

  it.each([null, windowState({ destroyed: true })])(
    'creates a new window when the previous one is missing or destroyed',
    (window) => {
      const createWindow = vi.fn()

      openMainWindow(window as BrowserWindow | null, createWindow)

      expect(createWindow).toHaveBeenCalledOnce()
      if (window) {
        expect(window.isMinimized).not.toHaveBeenCalled()
        expect(window.show).not.toHaveBeenCalled()
      }
    }
  )

  it('reuses a newly created window on a repeated open action', () => {
    let current: BrowserWindow | null = null
    const created = windowState({ visible: false })
    const createWindow = vi.fn(() => {
      current = created as unknown as BrowserWindow
    })

    openMainWindow(current, createWindow)
    openMainWindow(current, createWindow)

    expect(createWindow).toHaveBeenCalledOnce()
    expect(created.show).toHaveBeenCalledOnce()
  })
})
