import { describe, expect, it } from 'vitest'
import { hoverExpands, notchHoverZone, type NotchHoverInput } from './notch-hover'

/** A stand-in element whose ancestors carry the given classes. */
const element = (...classes: string[]) => ({
  closest: (selector: string) => (classes.includes(selector.slice(1)) ? {} : null)
})

const compact: NotchHoverInput = {
  expanded: false,
  nativeCompact: true,
  dismissed: false,
  pressed: false,
  zone: 'readouts'
}

describe('notchHoverZone', () => {
  it('finds the grip from any element inside it', () => {
    expect(notchHoverZone(element('notch-drag') as unknown as EventTarget)).toBe('grip')
  })

  it('finds the readouts', () => {
    expect(notchHoverZone(element('notch-compact-values') as unknown as EventTarget)).toBe(
      'readouts'
    )
  })

  it('treats the edge, corners and non-elements as other', () => {
    expect(notchHoverZone(element('notch-compact-content') as unknown as EventTarget)).toBe('other')
    expect(notchHoverZone(null)).toBe('other')
    expect(notchHoverZone({} as EventTarget)).toBe('other')
  })
})

describe('hoverExpands', () => {
  it('expands when the pointer reaches the readouts of the compact tab', () => {
    expect(hoverExpands(compact)).toBe(true)
  })

  it('does not expand when the pointer enters over the grip', () => {
    expect(hoverExpands({ ...compact, zone: 'grip' })).toBe(false)
  })

  it('expands when the pointer moves from the grip on to the readouts', () => {
    const path = (['grip', 'readouts'] as const).map((zone) => hoverExpands({ ...compact, zone }))
    expect(path).toEqual([false, true])
  })

  it('never expands while dragging from the grip, even over the readouts', () => {
    expect(hoverExpands({ ...compact, zone: 'grip', pressed: true })).toBe(false)
    expect(hoverExpands({ ...compact, zone: 'readouts', pressed: true })).toBe(false)
  })

  it('does not expand from the edge or a transparent corner', () => {
    expect(hoverExpands({ ...compact, zone: 'other' })).toBe(false)
  })

  it('respects Escape until the pointer leaves', () => {
    expect(hoverExpands({ ...compact, dismissed: true })).toBe(false)
  })

  it('waits for the window to finish shrinking and ignores an open panel', () => {
    expect(hoverExpands({ ...compact, nativeCompact: false })).toBe(false)
    expect(hoverExpands({ ...compact, expanded: true })).toBe(false)
  })
})
