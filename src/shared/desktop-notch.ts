export const NOTCH_COMPACT = { width: 64, height: 202 }
export const NOTCH_EXPANDED = { width: 344, height: 466 }
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
  compactOffset: { x: number; y: number }
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
