import { NOTCH_COMPACT, NOTCH_EXPANDED, type NotchPosition } from '../../shared/desktop-notch'
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

export function saveNotchPosition(bounds: Area, display: DisplayArea): NotchPosition {
  const area = display.workArea
  return {
    displayId: display.id,
    x: clamp((bounds.x - area.x) / Math.max(1, area.width - NOTCH_COMPACT.width), 1),
    y: clamp((bounds.y - area.y) / Math.max(1, area.height - NOTCH_COMPACT.height), 1)
  }
}
