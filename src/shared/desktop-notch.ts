export const NOTCH_COMPACT = { width: 64, height: 202 }
export const NOTCH_EXPANDED = { width: 344, height: 466 }
/**
 * The notch window is a transparent canvas with the compact tab always at this point and
 * room for the panel on any side of it. Re-placing the panel then only changes where the
 * renderer draws it, so the tab cannot jump when a drag ends.
 */
export const NOTCH_ANCHOR = {
  x: NOTCH_EXPANDED.width - NOTCH_COMPACT.width,
  y: NOTCH_EXPANDED.height - NOTCH_COMPACT.height
}
export const NOTCH_CANVAS = {
  width: NOTCH_EXPANDED.width + NOTCH_ANCHOR.x,
  height: NOTCH_EXPANDED.height + NOTCH_ANCHOR.y
}
export const NOTCH_MOTION_MS = 160

export interface NotchPosition {
  displayId: number
  x: number
  y: number
}

export interface NotchMetrics {
  timestamp: number
  cpu: number
  memory: { percent: number; used: number; total: number }
  disk: { percent: number; used: number; total: number; volume: string } | null
}

export interface NotchState {
  enabled: boolean
  pinned: boolean
  expanded: boolean
  /** The compact tab's position inside the panel. */
  compactOffset: { x: number; y: number }
  /** The panel's position inside the window. */
  panelOrigin: { x: number; y: number }
  theme: 'dark' | 'light'
  language: string
  metrics: NotchMetrics | null
}

export interface DesktopNotchAPI {
  getState(): Promise<NotchState>
  setVisible(visible: boolean): Promise<void>
  setPinned(pinned: boolean): Promise<void>
  setExpanded(expanded: boolean): Promise<void>
  finishCollapse(): Promise<void>
  move(dx: number, dy: number): Promise<void>
  openApp(): Promise<void>
  onState(callback: (state: NotchState) => void): () => void
}

export const NOTCH_IPC = {
  GET: 'notch:get',
  VISIBLE: 'notch:visible',
  PINNED: 'notch:pinned',
  EXPANDED: 'notch:expanded',
  COLLAPSE_FINISHED: 'notch:collapse-finished',
  MOVE: 'notch:move',
  OPEN: 'notch:open',
  STATE: 'notch:state'
} as const
