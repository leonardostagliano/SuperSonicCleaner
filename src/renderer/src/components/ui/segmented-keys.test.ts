import { describe, expect, it } from 'vitest'
import { nextSegmentIndex } from './segmented-keys'

describe('nextSegmentIndex', () => {
  it('moves forward with ArrowRight and ArrowDown, back with ArrowLeft and ArrowUp (LTR)', () => {
    expect(nextSegmentIndex('ArrowRight', 0, 3, 'ltr')).toBe(1)
    expect(nextSegmentIndex('ArrowDown', 1, 3, 'ltr')).toBe(2)
    expect(nextSegmentIndex('ArrowLeft', 2, 3, 'ltr')).toBe(1)
    expect(nextSegmentIndex('ArrowUp', 1, 3, 'ltr')).toBe(0)
  })

  it('reverses Left and Right in RTL, where the next option sits on the left', () => {
    expect(nextSegmentIndex('ArrowLeft', 0, 3, 'rtl')).toBe(1)
    expect(nextSegmentIndex('ArrowRight', 1, 3, 'rtl')).toBe(0)
  })

  it('keeps Up and Down independent of the reading direction', () => {
    expect(nextSegmentIndex('ArrowDown', 0, 3, 'rtl')).toBe(1)
    expect(nextSegmentIndex('ArrowUp', 1, 3, 'rtl')).toBe(0)
  })

  it('wraps around at both ends', () => {
    expect(nextSegmentIndex('ArrowRight', 2, 3, 'ltr')).toBe(0)
    expect(nextSegmentIndex('ArrowLeft', 0, 3, 'ltr')).toBe(2)
    expect(nextSegmentIndex('ArrowDown', 2, 3, 'rtl')).toBe(0)
    expect(nextSegmentIndex('ArrowUp', 0, 3, 'rtl')).toBe(2)
    expect(nextSegmentIndex('ArrowLeft', 2, 3, 'rtl')).toBe(0)
    expect(nextSegmentIndex('ArrowRight', 0, 3, 'rtl')).toBe(2)
  })

  it('jumps to the first and last option with Home and End in both directions', () => {
    for (const dir of ['ltr', 'rtl'] as const) {
      expect(nextSegmentIndex('Home', 2, 4, dir)).toBe(0)
      expect(nextSegmentIndex('End', 0, 4, dir)).toBe(3)
    }
  })

  it('defaults to LTR', () => {
    expect(nextSegmentIndex('ArrowRight', 0, 3)).toBe(1)
  })

  it('ignores keys that do not navigate', () => {
    for (const key of ['Enter', ' ', 'Tab', 'a', 'PageDown', 'Escape']) {
      expect(nextSegmentIndex(key, 1, 3, 'ltr')).toBeNull()
    }
  })

  it('stays on a single option and returns null without options', () => {
    expect(nextSegmentIndex('ArrowRight', 0, 1, 'ltr')).toBe(0)
    expect(nextSegmentIndex('End', 0, 1, 'ltr')).toBe(0)
    expect(nextSegmentIndex('ArrowRight', 0, 0, 'ltr')).toBeNull()
    expect(nextSegmentIndex('Home', 0, 0, 'ltr')).toBeNull()
  })

  it('treats an index outside the options (no selection) as a start before the first', () => {
    // The group's tab stop falls back to the first option when the value matches none.
    expect(nextSegmentIndex('ArrowRight', -1, 3, 'ltr')).toBe(0)
    expect(nextSegmentIndex('ArrowLeft', -1, 3, 'ltr')).toBe(2)
  })
})
