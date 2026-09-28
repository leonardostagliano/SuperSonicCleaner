/** Where the pointer is on the notch: the drag grip, the compact readouts, or anywhere else. */
export type NotchHoverZone = 'grip' | 'readouts' | 'other'

/** Classifies the element under the pointer (a pointerover/pointermove target). */
export function notchHoverZone(target: EventTarget | null): NotchHoverZone {
  const element = target as Pick<Element, 'closest'> | null
  if (typeof element?.closest !== 'function') return 'other'
  if (element.closest('.notch-drag')) return 'grip'
  if (element.closest('.notch-compact-values')) return 'readouts'
  return 'other'
}

export interface NotchHoverInput {
  /** The panel is open or opening. */
  expanded: boolean
  /** The native window has shrunk back to the compact tab. */
  nativeCompact: boolean
  /** Escape turned hover-expansion off until the pointer leaves the notch. */
  dismissed: boolean
  /** A pointer button is held, so the grip is being dragged. */
  pressed: boolean
  zone: NotchHoverZone
}

/**
 * Hovering opens the compact tab only over its readouts. The grip is for dragging:
 * entering over it, or dragging from it, never expands; moving on to the readouts does.
 * Edges and transparent corners do nothing, so approaching the grip cannot open the panel.
 */
export function hoverExpands({
  expanded,
  nativeCompact,
  dismissed,
  pressed,
  zone
}: NotchHoverInput): boolean {
  return !expanded && nativeCompact && !dismissed && !pressed && zone === 'readouts'
}
