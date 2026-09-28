import { describe, expect, it } from 'vitest'
import { layoutTreemap } from './treemap'

const other = (count: number) => `${count} other`
const area = (r: { w: number; h: number }) => r.w * r.h

describe('layoutTreemap', () => {
  it('fills the whole map with areas proportional to the sizes', () => {
    const rects = layoutTreemap(
      [
        { name: 'a', size: 50 },
        { name: 'b', size: 30 },
        { name: 'c', size: 20 }
      ],
      other
    )
    expect(rects.map((r) => r.name)).toEqual(['a', 'b', 'c'])
    const total = rects.reduce((s, r) => s + area(r), 0)
    expect(total).toBeCloseTo(100 * 100, 6)
    expect(area(rects[0]) / total).toBeCloseTo(0.5, 6)
    expect(area(rects[2]) / total).toBeCloseTo(0.2, 6)
  })

  it('groups items under 1.5 % into one "other" tile', () => {
    const rects = layoutTreemap(
      [
        { name: 'big', size: 1000 },
        { name: 'tiny1', size: 5 },
        { name: 'tiny2', size: 5 }
      ],
      other
    )
    expect(rects.map((r) => r.name)).toEqual(['big', '2 other'])
    expect(rects[1].other).toBe(true)
    expect(rects[0].other).toBeUndefined()
  })

  it('draws nothing for empty or zero-sized input', () => {
    expect(layoutTreemap([], other)).toEqual([])
    expect(layoutTreemap([{ name: 'x', size: 0 }], other)).toEqual([])
  })
})
