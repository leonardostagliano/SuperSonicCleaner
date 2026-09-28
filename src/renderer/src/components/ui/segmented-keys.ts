export type TextDirection = 'ltr' | 'rtl'

/** Forward (+1) or backward (−1) per arrow key; Left and Right follow the reading direction. */
const arrowStep = (key: string, dir: TextDirection): number | null => {
  switch (key) {
    case 'ArrowDown':
      return 1
    case 'ArrowUp':
      return -1
    case 'ArrowRight':
      return dir === 'rtl' ? -1 : 1
    case 'ArrowLeft':
      return dir === 'rtl' ? 1 : -1
    default:
      return null
  }
}

/**
 * The option a key moves to in a radio group (Segmented): arrows wrap around, Home and
 * End jump to the ends, Left and Right are swapped in RTL. Returns null for keys that do
 * not navigate and when there are no options. An index outside the options (nothing
 * selected) starts before the first: forward goes to the first, backward to the last.
 */
export function nextSegmentIndex(
  key: string,
  index: number,
  count: number,
  dir: TextDirection = 'ltr'
): number | null {
  if (count <= 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  const step = arrowStep(key, dir)
  if (step === null) return null
  if (index < 0 || index >= count) return step > 0 ? 0 : count - 1
  return (index + step + count) % count
}
