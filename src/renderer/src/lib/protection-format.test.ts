import { describe, expect, it } from 'vitest'
import {
  formatCount,
  formatDateTime,
  formatDay,
  formatPercent,
  formatSeconds,
  formatTime
} from './protection-format'

const NBSP = ' '

describe('protection-format', () => {
  it('groups whole numbers in the UI language', () => {
    expect(formatCount(12345, 'it')).toBe('12.345')
    expect(formatCount(12345, 'en')).toBe('12,345')
    expect(formatCount(7.6, 'en')).toBe('8')
  })

  it('keeps Latin digits for Arabic', () => {
    expect(formatCount(12345, 'ar')).toMatch(/^[0-9.,٬\s]+$/)
    expect(formatSeconds(4200, 'ar')).toMatch(/[0-9]/)
  })

  it('shows seconds with one decimal', () => {
    expect(formatSeconds(42300, 'it')).toBe('42,3')
    expect(formatSeconds(42300, 'en')).toBe('42.3')
    expect(formatSeconds(-5, 'en')).toBe('0.0')
  })

  it('formats a share as a whole percentage with a non-breaking space where the language has one', () => {
    expect(formatPercent(0.456, 'en')).toBe('46%')
    expect(formatPercent(0.456, 'de')).toBe(`46${NBSP}%`)
    expect(formatPercent(2, 'en')).toBe('100%')
    expect(formatPercent(Number.NaN, 'en')).toBe('0%')
  })

  it('formats dates and times, and gives an empty string for invalid input', () => {
    const when = new Date(2026, 8, 12, 18, 40)
    expect(formatDateTime(when, 'it')).toContain('18:40')
    expect(formatDateTime(when, 'it')).toContain('2026')
    expect(formatDay(when, 'en')).toContain('2026')
    expect(formatTime(when, 'it')).toBe('18:40')
    expect(formatDateTime('not a date', 'it')).toBe('')
    expect(formatDay('', 'it')).toBe('')
    expect(formatTime('x', 'it')).toBe('')
  })
})
