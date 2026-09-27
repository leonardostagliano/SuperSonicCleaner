import { ipcRenderer } from 'electron'
import { NOTCH_IPC, type DesktopNotchAPI, type NotchState } from '../shared/desktop-notch'

export const notchApi: DesktopNotchAPI = {
  getState: () => ipcRenderer.invoke(NOTCH_IPC.GET),
  setVisible: (visible) => ipcRenderer.invoke(NOTCH_IPC.VISIBLE, visible),
  setPinned: (pinned) => ipcRenderer.invoke(NOTCH_IPC.PINNED, pinned),
  setExpanded: (expanded) => ipcRenderer.invoke(NOTCH_IPC.EXPANDED, expanded),
  finishCollapse: () => ipcRenderer.invoke(NOTCH_IPC.COLLAPSE_FINISHED),
  move: (dx, dy) => ipcRenderer.invoke(NOTCH_IPC.MOVE, dx, dy),
  openApp: () => ipcRenderer.invoke(NOTCH_IPC.OPEN),
  onState: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, state: NotchState) => callback(state)
    ipcRenderer.on(NOTCH_IPC.STATE, handler)
    return () => ipcRenderer.removeListener(NOTCH_IPC.STATE, handler)
  }
}
