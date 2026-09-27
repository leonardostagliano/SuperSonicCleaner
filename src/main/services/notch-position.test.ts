import { describe, expect, it } from 'vitest'
import { restoreNotchBounds, saveNotchPosition } from './notch-position'

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
