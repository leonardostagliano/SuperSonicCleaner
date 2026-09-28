import {
  NOTCH_ANCHOR,
  NOTCH_CANVAS,
  NOTCH_COMPACT,
  NOTCH_EXPANDED,
  type NotchPosition
} from '../../shared/desktop-notch'
export { NOTCH_COMPACT, NOTCH_EXPANDED } from '../../shared/desktop-notch'
interface Area {
  x: number
  y: number
  width: number
  height: number
}
interface DisplayArea {
  id: number
  workArea: Area
}
const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), Math.max(0, max))

export function restoreNotchBounds(
  position: NotchPosition | null,
  displays: DisplayArea[],
  expanded: boolean
): Area {
  const display = displays.find((item) => item.id === position?.displayId) ?? displays[0]
  const area = display.workArea
  const size = expanded ? NOTCH_EXPANDED : NOTCH_COMPACT
  const relativeX = position ? clamp(position.x, 1) : 0.96
  const relativeY = position ? clamp(position.y, 1) : 0.25
  return {
    x: Math.round(
      area.x + clamp(relativeX * (area.width - NOTCH_COMPACT.width), area.width - size.width)
    ),
    y: Math.round(
      area.y + clamp(relativeY * (area.height - NOTCH_COMPACT.height), area.height - size.height)
    ),
    width: Math.min(size.width, area.width),
    height: Math.min(size.height, area.height)
  }
}

/**
 * Window geometry for the on-screen tab (`compact`) and panel (`open`); `tab` and `panel`
 * are in window coordinates. With `canvas` (where a window region clips input: Windows,
 * Linux) the window is NOTCH_CANVAS with the tab at NOTCH_ANCHOR. Without it (macOS) a
 * larger window would block clicks around the tab, so the window is the panel itself.
 */
export function notchLayout(
  compact: Area,
  open: Area,
  canvas: boolean
): { window: Area; tab: Area; panel: Area } {
  const offset = { x: compact.x - open.x, y: compact.y - open.y }
  const origin = canvas
    ? { x: NOTCH_ANCHOR.x - offset.x, y: NOTCH_ANCHOR.y - offset.y }
    : { x: 0, y: 0 }
  return {
    window: {
      x: open.x - origin.x,
      y: open.y - origin.y,
      width: canvas ? NOTCH_CANVAS.width : open.width,
      height: canvas ? NOTCH_CANVAS.height : open.height
    },
    tab: {
      x: origin.x + offset.x,
      y: origin.y + offset.y,
      width: compact.width,
      height: compact.height
    },
    panel: { ...origin, width: open.width, height: open.height }
  }
}

export function saveNotchPosition(bounds: Area, display: DisplayArea): NotchPosition {
  const area = display.workArea
  return {
    displayId: display.id,
    x: clamp((bounds.x - area.x) / Math.max(1, area.width - NOTCH_COMPACT.width), 1),
    y: clamp((bounds.y - area.y) / Math.max(1, area.height - NOTCH_COMPACT.height), 1)
  }
}
