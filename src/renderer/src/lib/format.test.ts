import { describe, it, expect, beforeAll } from 'vitest'
import i18next from 'i18next'
import { formatBytes, formatSpeed, NO_VALUE } from './format'

const GiB = 1024 ** 3
/** Tests read better with a normal space; the output uses a non-breaking one. */
const nb = (s: string) => s.replace(' ', ' ')

beforeAll(async () => {
  await i18next.init({ lng: 'en', resources: {} })
})

describe('formatBytes', () => {
  it('keeps whole bytes below 1000', () => {
    expect(formatBytes(0, 'en')).toBe(nb('0 B'))
    expect(formatBytes(500, 'en')).toBe(nb('500 B'))
    expect(formatBytes(999, 'en')).toBe(nb('999 B'))
  })

  it('shows exactly three significant digits from 1 KB up', () => {
    expect(formatBytes(1024, 'en')).toBe(nb('1.00 KB'))
    expect(formatBytes(1536, 'en')).toBe(nb('1.50 KB'))
    expect(formatBytes(22.14 * GiB, 'en')).toBe(nb('22.1 GB'))
    expect(formatBytes(113.09 * GiB, 'en')).toBe(nb('113 GB'))
    expect(formatBytes(1024 ** 4, 'en')).toBe(nb('1.00 TB'))
    expect(formatBytes(1024 ** 5, 'en')).toBe(nb('1.00 PB'))
  })

  it('never needs four integer digits: the unit steps up at 1000', () => {
    expect(formatBytes(1000, 'en')).toBe(nb('0.977 KB'))
    expect(formatBytes(1000 * GiB, 'en')).toBe(nb('0.977 TB'))
    expect(formatBytes(1023.99 * GiB, 'en')).toBe(nb('1.00 TB'))
    expect(formatBytes(999.96 * 1024, 'en')).toBe(nb('0.977 MB'))
  })

  it('uses the language decimal separator and Latin digits', () => {
    expect(formatBytes(1536, 'it')).toBe(nb('1,50 KB'))
    expect(formatBytes(22.14 * GiB, 'de')).toBe(nb('22,1 GB'))
    expect(formatBytes(1536, 'ar')).toMatch(/^[0-9][0-9.,]*\u00a0KB$/)
  })

  it('defaults to the UI language', () => {
    expect(formatBytes(1536)).toBe(nb('1.50 KB'))
  })

  it('handles negative and non-finite values', () => {
    expect(formatBytes(-1536, 'en')).toBe(nb('-1.50 KB'))
    expect(formatBytes(Number.NaN, 'en')).toBe(nb('0 B'))
  })

  it('falls back to English for a malformed locale tag', () => {
    expect(formatBytes(1536, '@@')).toBe(nb('1.50 KB'))
  })
})

describe('formatSpeed', () => {
  it('formats rates with the same rules', () => {
    expect(formatSpeed(0, 'en')).toBe(nb('0 B/s'))
    expect(formatSpeed(-100, 'en')).toBe(nb('0 B/s'))
    expect(formatSpeed(500, 'en')).toBe(nb('500 B/s'))
    expect(formatSpeed(1024, 'en')).toBe(nb('1.00 KB/s'))
    expect(formatSpeed(1024 ** 2, 'en')).toBe(nb('1.00 MB/s'))
    expect(formatSpeed(1536, 'it')).toBe(nb('1,50 KB/s'))
  })
})

describe('NO_VALUE', () => {
  it('is an em dash', () => {
    expect(NO_VALUE).toBe('—')
  })
})
