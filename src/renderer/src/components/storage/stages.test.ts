import { describe, expect, it } from 'vitest'
import { stagesFor } from './stages'

const order = ['walking', 'grouping', 'partial-hash', 'full-hash'] as const
const label = (key: string) => `l:${key}`

describe('stagesFor', () => {
  it('marks earlier stages done, the current one current and later ones to do', () => {
    expect(stagesFor(order, 'partial-hash', label).map((s) => s.state)).toEqual([
      'done',
      'done',
      'current',
      'todo'
    ])
    expect(stagesFor(order, 'walking', label)[0]).toEqual({
      key: 'walking',
      label: 'l:walking',
      state: 'current'
    })
  })

  it('shows every stage to do before the first progress event or for an unknown stage', () => {
    expect(stagesFor(order, undefined, label).every((s) => s.state === 'todo')).toBe(true)
    expect(stagesFor(order, 'complete', label).every((s) => s.state === 'todo')).toBe(true)
  })
})
