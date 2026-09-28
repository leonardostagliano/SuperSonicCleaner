import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PrivacySetting } from '@shared/types'
import itLocale from '@/locales/it/hardening.json'
import enLocale from '@/locales/en/hardening.json'
import { localizeSetting, localizeSettings, settingLabel } from './privacy-view'

const setting = (over: Partial<PrivacySetting>): PrivacySetting => ({
  id: 'cortana',
  category: 'search',
  label: 'Cortana',
  description: 'Disable Cortana — stops background resource usage and data collection',
  enabled: false,
  reversible: true,
  requiresAdmin: false,
  ...over
})

// A t() that knows the Italian keys and, like i18next, falls back to defaultValue.
const settingsIt = itLocale.privacy.settings as Record<
  string,
  { label: string; description: string }
>
const t = (key: string, options: { defaultValue: string }) => {
  const m = /^privacy\.settings\.([\w-]+)\.(label|description)$/.exec(key)
  return (m && settingsIt[m[1]]?.[m[2] as 'label' | 'description']) ?? options.defaultValue
}

describe('privacy setting copy', () => {
  it('shows a known setting in the UI language, by id', () => {
    const local = localizeSetting(t, setting({}))
    expect(local.label).toBe('Cortana')
    expect(local.description).toBe(settingsIt.cortana.description)
    expect(local.description).not.toMatch(/Disable/)
    expect(settingLabel(t, { id: 'telemetry-level', label: 'Windows Telemetry' })).toBe(
      'Telemetria di Windows'
    )
  })

  it("keeps main's text for a setting the locale files do not know", () => {
    const unknown = setting({ id: 'new-setting', label: 'New Setting', description: 'Main text' })
    expect(localizeSetting(t, unknown)).toMatchObject({
      label: 'New Setting',
      description: 'Main text'
    })
  })

  it('keeps every other field', () => {
    const [local] = localizeSettings(t, [setting({ enabled: true, dependsOn: 'x' })])
    expect(local).toMatchObject({ id: 'cortana', enabled: true, dependsOn: 'x' })
  })

  it('has an Italian and an English label and description for every setting main defines', () => {
    const root = join(__dirname, '../../../../..')
    const sources = [
      'src/main/ipc/privacy-shield.ipc.ts',
      'src/main/platform/darwin/privacy.ts',
      'src/main/platform/linux/privacy.ts'
    ]
    const ids = sources.flatMap((file) =>
      [...readFileSync(join(root, file), 'utf8').matchAll(/\bid: '([^']+)',\s*category:/g)].map(
        (m) => m[1]
      )
    )
    expect(ids.length).toBeGreaterThan(90)
    const settingsEn = enLocale.privacy.settings as Record<
      string,
      { label: string; description: string }
    >
    const missing = ids.filter(
      (id) =>
        !settingsIt[id]?.label ||
        !settingsIt[id]?.description ||
        !settingsEn[id]?.label ||
        !settingsEn[id]?.description
    )
    expect(missing).toEqual([])
  })
})
