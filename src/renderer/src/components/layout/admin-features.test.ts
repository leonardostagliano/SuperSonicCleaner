import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ADMIN_FEATURES, adminFeatures, joinList } from './admin-features'

const locales = path.resolve(__dirname, '../../locales')
const labels = (lang: string) =>
  JSON.parse(fs.readFileSync(path.join(locales, lang, 'common.json'), 'utf8'))
    .adminBannerFeatures as Record<string, string>

describe('adminFeatures', () => {
  it('lists what Windows gates behind administrator rights', () => {
    expect(adminFeatures('win32')).toEqual([
      'systemCleanup',
      'windowsRepair',
      'trim',
      'restorePoints',
      'registryRestore',
      'machinePrivacy',
      'contextMenu',
      'gameModeServices',
      'bootTrace'
    ])
  })

  it('lists what Linux gates behind root', () => {
    expect(adminFeatures('linux')).toEqual(['linuxSystemCleanup', 'trim', 'linuxSecurity'])
  })

  it('has nothing for macOS, which never shows the banner', () => {
    expect(adminFeatures('darwin')).toEqual([])
  })

  it('has an Italian and an English label for every feature', () => {
    const keys = new Set([...ADMIN_FEATURES.win32, ...ADMIN_FEATURES.linux])
    for (const lang of ['it', 'en']) {
      const map = labels(lang)
      for (const key of keys) expect(map[key], `${lang}: ${key}`).toBeTruthy()
      expect(Object.keys(map).sort()).toEqual([...keys].sort())
    }
  })
})

describe('joinList', () => {
  it('joins with the language conjunction', () => {
    expect(joinList(['a', 'b', 'c'], 'it')).toBe('a, b e c')
    expect(joinList(['a', 'b', 'c'], 'en')).toBe('a, b, and c')
    expect(joinList(['a'], 'en')).toBe('a')
  })
})
