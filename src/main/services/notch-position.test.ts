import { describe, expect, it } from 'vitest'
import { notchLayout, restoreNotchBounds, saveNotchPosition } from './notch-position'

const primary = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
const secondary = { id: 2, workArea: { x: -1280, y: -300, width: 1280, height: 980 } }

describe('desktop notch placement', () => {
  it('restores a user position on a monitor with negative coordinates', () => {
    const bounds = { x: -1000, y: -100, width: 64, height: 202 }
    expect(
      restoreNotchBounds(saveNotchPosition(bounds, secondary), [primary, secondary], false)
    ).toEqual(bounds)
  })
  it('keeps the expanded panel visible at the bottom right without changing the saved anchor', () => {
    const position = { displayId: 1, x: 1, y: 1 }
    expect(restoreNotchBounds(position, [primary], true)).toEqual({
      x: 1576,
      y: 574,
      width: 344,
      height: 466
    })
    expect(restoreNotchBounds(position, [primary], false)).toEqual({
      x: 1856,
      y: 838,
      width: 64,
      height: 202
    })
  })
  it('recovers a disconnected monitor onto the primary work area', () => {
    const bounds = restoreNotchBounds({ displayId: 2, x: 0.7, y: 0.8 }, [primary], true)
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1920)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(1040)
  })
  it('clamps saved positions when the work area changes', () => {
    expect(restoreNotchBounds({ displayId: 1, x: 2, y: -1 }, [primary], false)).toEqual({
      x: 1856,
      y: 0,
      width: 64,
      height: 202
    })
  })
})

describe('desktop notch canvas', () => {
  const layout = (x: number, y: number, canvas = true) => {
    const position = { displayId: 1, x, y }
    const compact = restoreNotchBounds(position, [primary], false)
    const open = restoreNotchBounds(position, [primary], true)
    return { compact, open, ...notchLayout(compact, open, canvas) }
  }

  it('keeps the tab at the same point of the window wherever the panel opens', () => {
    const corner = layout(1, 1)
    const middle = layout(0.4, 0.3)
    expect(corner.tab).toEqual({ x: 280, y: 264, width: 64, height: 202 })
    expect(middle.tab).toEqual(corner.tab)
    expect(corner.window).toMatchObject({ width: 624, height: 730 })
    expect(corner.window.x + corner.tab.x).toBe(corner.compact.x)
    expect(corner.window.y + corner.tab.y).toBe(corner.compact.y)
  })

  it('draws the panel where it opened before the canvas existed', () => {
    for (const [x, y] of [
      [1, 1],
      [0, 0],
      [0.4, 0.3],
      [0.97, 0.5]
    ]) {
      const { open, window, panel } = layout(x, y)
      expect({ ...panel, x: window.x + panel.x, y: window.y + panel.y }).toEqual(open)
      expect(panel.x).toBeGreaterThanOrEqual(0)
      expect(panel.y).toBeGreaterThanOrEqual(0)
      expect(panel.x + panel.width).toBeLessThanOrEqual(window.width)
      expect(panel.y + panel.height).toBeLessThanOrEqual(window.height)
    }
  })

  it('makes the window the panel itself where no region clips input', () => {
    const { compact, open, window, tab, panel } = layout(1, 1, false)
    expect(window).toEqual(open)
    expect(panel).toEqual({ x: 0, y: 0, width: 344, height: 466 })
    expect({ ...tab, x: window.x + tab.x, y: window.y + tab.y }).toEqual(compact)
  })
})
