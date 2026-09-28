import { describe, expect, it } from 'vitest'
import { shredReasonKey, shredderTotals } from './shredder-view'
import { formatCount, formatDateTime, formatPercent } from './storage-tools-format'

describe('shredReasonKey', () => {
  it('maps the fixed reasons of the main process to translation keys', () => {
    expect(shredReasonKey('Protected system path — shredding blocked')).toBe('protected')
    expect(shredReasonKey('File changed while being shredded — skipped')).toBe('changed')
    expect(shredReasonKey('Cancelled before the overwrite finished — file was not deleted')).toBe(
      'cancelled'
    )
    expect(shredReasonKey('File was not verified during collection — skipped')).toBe('unverified')
  })

  it('leaves operating-system errors to be shown as they are', () => {
    expect(shredReasonKey("EBUSY: resource busy or locked, open 'C:\\x.log'")).toBeNull()
    expect(shredReasonKey('Unknown error')).toBeNull()
  })
})

describe('shredderTotals', () => {
  it('adds the sizes and counts files and folders separately', () => {
    expect(
      shredderTotals([
        { path: 'C:\\a\\one.txt', name: 'one.txt', size: 100, isDirectory: false },
        { path: 'C:\\a\\dir', name: 'dir', size: 2048, isDirectory: true },
        { path: 'C:\\a\\two.txt', name: 'two.txt', size: 50, isDirectory: false }
      ])
    ).toEqual({ bytes: 2198, files: 2, folders: 1 })
  })

  it('is empty for an empty list', () => {
    expect(shredderTotals([])).toEqual({ bytes: 0, files: 0, folders: 0 })
  })
})

describe('storage tool formatting', () => {
  it('groups counts in the UI language with Latin digits', () => {
    // Italian groups from five digits (CLDR minimum grouping digits = 2).
    expect(formatCount(12402, 'it')).toBe('12.402')
    expect(formatCount(1402, 'en')).toBe('1,402')
    expect(formatCount(12402, 'ar')).toMatch(/^12.402$/)
  })

  it('falls back to English for a locale Intl rejects', () => {
    expect(formatCount(1402, 'not a locale!')).toBe('1,402')
    expect(formatDateTime(0, 'not a locale!')).toMatch(/1970|1969/)
    expect(formatPercent(0.5, 'not a locale!')).toBe('50%')
  })

  it('rounds percentages to whole numbers in the language pattern', () => {
    expect(formatPercent(0.349, 'en')).toBe('35%')
    expect(formatPercent(1, 'it')).toMatch(/^100\s?%$/)
    expect(formatPercent(0.349, 'ar')).toMatch(/35/)
  })

  it('writes date and time with Latin digits', () => {
    const text = formatDateTime(new Date(2026, 8, 12, 18, 40), 'it')
    expect(text).toContain('12')
    expect(text).toContain('2026')
    expect(text).toContain('18:40')
    expect(formatDateTime(new Date(2026, 8, 12, 18, 40), 'ar')).toMatch(/[0-9]/)
  })
})
