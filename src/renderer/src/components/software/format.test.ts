import { describe, expect, it } from 'vitest'
import { formatClock, formatDateTime, joinFacts } from './format'

const at = new Date(2026, 8, 12, 18, 40)

describe('formatDateTime', () => {
  it('writes day, short month, year and time in the UI language', () => {
    expect(formatDateTime(at, 'it')).toBe('12 set 2026, 18:40')
    // ICU versions differ on the English abbreviation ("Sep" or "Sept").
    expect(formatDateTime(at.getTime(), 'en-GB')).toMatch(/^12 Sept? 2026, 18:40$/)
  })

  it('keeps Latin digits in languages with other numbering systems', () => {
    expect(formatDateTime(at, 'ar')).toMatch(/2026/)
    expect(formatDateTime(at, 'ar')).not.toMatch(/[٠-٩]/)
  })

  it('returns an empty string for an invalid date', () => {
    expect(formatDateTime('not a date', 'it')).toBe('')
  })

  it('falls back to English for an unknown locale tag', () => {
    expect(formatDateTime(at.toISOString(), 'xx-invalid-@@')).toContain('2026')
  })
})

describe('formatClock', () => {
  it('writes hours and minutes', () => {
    expect(formatClock(at, 'it')).toBe('18:40')
  })
})

describe('joinFacts', () => {
  it('joins the non-empty parts with a middle dot', () => {
    expect(joinFacts(['6 principali', '', false, null, undefined, '9 patch'])).toBe(
      '6 principali · 9 patch'
    )
  })

  it('returns an empty string when nothing is left', () => {
    expect(joinFacts([false, ''])).toBe('')
  })
})
