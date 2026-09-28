import { describe, expect, it } from 'vitest'
import { formatCount, formatDateTime, formatElapsed, formatShare, listPreview } from './format'

const NBSP = ' '

describe('formatCount', () => {
  it('groups thousands as the UI language does, with Latin digits', () => {
    expect(formatCount(12512, 'it')).toBe('12.512')
    expect(formatCount(1512, 'en')).toBe('1,512')
    expect(formatCount(1512, 'de')).toBe('1.512')
    expect(formatCount(1512, 'ar')).not.toMatch(/[٠-٩]/)
  })
})

describe('formatShare', () => {
  it('rounds to a whole percent from 10 %, one decimal below', () => {
    expect(formatShare(0.4567, 'en')).toBe('46%')
    expect(formatShare(0.0456, 'en')).toBe('4.6%')
    expect(formatShare(0.04, 'it')).toBe('4,0%')
    expect(formatShare(0, 'en')).toBe('0.0%')
  })

  it('never shows a real share as zero', () => {
    expect(formatShare(0.0002, 'en')).toBe('< 0.1%')
    expect(formatShare(0.0002, 'it')).toBe('< 0,1%')
  })
})

describe('formatElapsed', () => {
  it('uses seconds with one decimal under a minute', () => {
    expect(formatElapsed(4200, 'it')).toBe(`4,2${NBSP}s`)
    expect(formatElapsed(40, 'it')).toBe(`0,1${NBSP}s`)
  })

  it('uses minutes and whole seconds from a minute', () => {
    expect(formatElapsed(125_000, 'it')).toBe(`2${NBSP}min 5${NBSP}s`)
  })
})

describe('formatDateTime', () => {
  it('writes day, month, year and time in the UI language', () => {
    const at = new Date(2026, 8, 12, 18, 40).getTime()
    expect(formatDateTime(at, 'it')).toBe('12 set 2026, 18:40')
  })
})

describe('listPreview', () => {
  const more = (count: number) => `+${count}`
  it('lists up to three items', () => {
    expect(listPreview(['a', 'b', 'c'], more)).toBe('a, b, c')
  })

  it('names the first three and counts the rest', () => {
    expect(listPreview(['a', 'b', 'c', 'd', 'e'], more)).toBe('a, b, c +2')
  })
})
