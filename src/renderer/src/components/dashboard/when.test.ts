import { describe, expect, it } from 'vitest'
import { driveName, formatCount, formatDateTime, formatPercent, formatWhen } from './when'

// Local noon, so "today" and "yesterday" do not depend on the machine's time zone.
const NOW = new Date(2026, 8, 28, 12, 0).getTime()
const MIN = 60_000
const DAY = 86_400_000

describe('formatWhen', () => {
  it('says "now" under a minute and counts minutes under an hour', () => {
    expect(formatWhen(NOW - 20_000, NOW, 'en')).toBe('now')
    expect(formatWhen(NOW - 5 * MIN, NOW, 'it')).toBe('5 minuti fa')
  })

  it('gives the time for today, then days for the last week', () => {
    expect(formatWhen(new Date(2026, 8, 28, 9, 12).getTime(), NOW, 'it')).toBe('oggi, 09:12')
    expect(formatWhen(NOW - DAY, NOW, 'it')).toBe('ieri')
    expect(formatWhen(NOW - 3 * DAY, NOW, 'it')).toBe('3 giorni fa')
  })

  it('gives the date after a week, with the year only when it differs', () => {
    const sameYear = formatWhen(new Date(2026, 8, 12, 18, 40).getTime(), NOW, 'it')
    expect(sameYear).toMatch(/12 set/)
    expect(sameYear).toMatch(/18:40/)
    expect(sameYear).not.toMatch(/2026/)
    expect(formatWhen(new Date(2025, 11, 3, 8, 5).getTime(), NOW, 'it')).toMatch(/2025/)
  })

  it('keeps Latin digits in Arabic', () => {
    expect(formatWhen(NOW - 3 * DAY, NOW, 'ar')).toMatch(/3/)
  })
})

describe('formatDateTime', () => {
  it('writes the full date and time', () => {
    const text = formatDateTime(new Date(2026, 8, 12, 18, 40).getTime(), 'it')
    expect(text).toMatch(/12 set 2026/)
    expect(text).toMatch(/18:40/)
  })
})

describe('formatCount', () => {
  it('groups digits in the language style with Latin digits', () => {
    expect(formatCount(1402, 'it')).toBe('1402')
    expect(formatCount(14020, 'it')).toBe('14.020')
    expect(formatCount(1402, 'en')).toBe('1,402')
    expect(formatCount(1402, 'ar')).toMatch(/1.?402/)
  })
})

describe('formatPercent', () => {
  it('rounds and clamps in the language style', () => {
    expect(formatPercent(55.6, 'en')).toBe('56%')
    expect(formatPercent(120, 'en')).toBe('100%')
    expect(formatPercent(-3, 'en')).toBe('0%')
    expect(formatPercent(70, 'de')).toMatch(/^70\s%$/)
  })
})

describe('driveName', () => {
  it('adds the colon to a drive letter and keeps mount paths', () => {
    expect(driveName({ letter: 'C', label: 'Windows' })).toBe('C: · Windows')
    expect(driveName({ letter: 'D', label: '' })).toBe('D:')
    expect(driveName({ letter: '/', label: 'root' })).toBe('/ · root')
  })
})
