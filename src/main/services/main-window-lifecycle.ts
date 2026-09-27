import type { BrowserWindow } from 'electron'

/** Reopen the existing main window, or replace one that has been closed. */
export function openMainWindow(window: BrowserWindow | null, createWindow: () => void): void {
  if (!window || window.isDestroyed()) {
    createWindow()
    return
  }

  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()
}
