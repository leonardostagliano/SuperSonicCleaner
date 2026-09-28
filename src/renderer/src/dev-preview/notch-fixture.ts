import type { KuduSettings } from '@shared/types'
import { NOTCH_ANCHOR, NOTCH_CANVAS, NOTCH_MOTION_MS, type NotchState } from '@shared/desktop-notch'

/** Browser QA only; never starts a collector or changes desktop window state. */
export function installNotchPreview(settings: KuduSettings) {
  const query = new URLSearchParams(location.search)
  const overlay = query.has('desktop-notch')
  const GB = 1024 ** 3
  const listeners = new Set<(state: NotchState) => void>()
  let shrinkTimer: ReturnType<typeof setTimeout> | null = null
  const compactOffset = query.get('notch-anchor') === 'corner' ? { x: 250, y: 253 } : { x: 0, y: 0 }
  let state: NotchState = {
    enabled: overlay,
    pinned: overlay && query.get('notch-state') !== 'compact',
    expanded: overlay && query.get('notch-state') !== 'compact',
    compactOffset,
    // As on Windows: a canvas with the tab at NOTCH_ANCHOR.
    panelOrigin: { x: NOTCH_ANCHOR.x - compactOffset.x, y: NOTCH_ANCHOR.y - compactOffset.y },
    theme: settings.theme === 'light' ? 'light' : 'dark',
    language: settings.language,
    metrics: {
      timestamp: Date.now(),
      cpu: 24,
      memory: { percent: 58, used: 18.6 * GB, total: 32 * GB },
      disk: { percent: 72, used: 720 * GB, total: 1000 * GB, volume: 'C:\\' }
    }
  }
  const notify = () => {
    state = {
      ...state,
      metrics: state.metrics ? { ...state.metrics, timestamp: Date.now() } : null
    }
    if (overlay) document.documentElement.style.width = `${NOTCH_CANVAS.width}px`
    listeners.forEach((listener) => listener(state))
  }
  window.kuduNotch = {
    getState: async () => state,
    onState: (callback) => {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },
    setVisible: async (enabled) => {
      state = { ...state, enabled }
      notify()
    },
    setPinned: async (pinned) => {
      state = { ...state, pinned, expanded: pinned || state.expanded }
      notify()
    },
    setExpanded: async (expanded) => {
      if (expanded && shrinkTimer) clearTimeout(shrinkTimer)
      if (expanded) shrinkTimer = null
      state = { ...state, expanded: state.pinned || expanded }
      if (!state.expanded && !shrinkTimer)
        shrinkTimer = setTimeout(() => {
          shrinkTimer = null
          notify()
        }, NOTCH_MOTION_MS + 120)
      notify()
    },
    finishCollapse: async () => {
      if (state.expanded) return
      if (shrinkTimer) clearTimeout(shrinkTimer)
      shrinkTimer = null
      notify()
    },
    move: async () => {},
    openApp: async () => {
      location.href = location.pathname
    }
  }
  if (query.get('notch-data') === 'empty') state.metrics = null
  if (query.get('notch-data') === 'limits' && state.metrics) {
    state.metrics = {
      ...state.metrics,
      cpu: 100,
      memory: { percent: 100, used: 1024 * GB, total: 1024 * GB },
      disk: {
        percent: 100,
        used: 16000 * GB,
        total: 16000 * GB,
        volume: '/Volumes/Very long external storage volume'
      }
    }
  }
  notify()
  if (overlay) window.setInterval(notify, 2000)
}
