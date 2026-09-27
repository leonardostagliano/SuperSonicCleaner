import { describe, it, expect } from 'vitest'
import { cpuModelName } from './cpu-model'

describe('cpuModelName', () => {
  it('prefers the full OS model name, with ® and ™', () => {
    expect(
      cpuModelName('Intel', 'Gen Intel® Core™ i7-1355U', '13th Gen Intel(R) Core(TM) i7-1355U')
    ).toBe('13th Gen Intel® Core™ i7-1355U')
  })

  it('does not repeat the vendor when the brand already names it', () => {
    expect(cpuModelName('AMD', 'AMD Ryzen 7 7840U w/ Radeon 780M Graphics')).toBe(
      'AMD Ryzen 7 7840U w/ Radeon 780M Graphics'
    )
  })

  it('adds the vendor when the brand does not name it', () => {
    expect(cpuModelName('Apple', 'M3 Pro')).toBe('Apple M3 Pro')
  })

  it('copes with missing parts', () => {
    expect(cpuModelName('', 'Core i5')).toBe('Core i5')
    expect(cpuModelName('Intel', '')).toBe('Intel')
    expect(cpuModelName('Intel', 'Core i5', '   ')).toBe('Intel Core i5')
  })
})
