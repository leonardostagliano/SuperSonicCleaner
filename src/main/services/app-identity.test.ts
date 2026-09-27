import { describe, expect, it } from 'vitest'
import { join, resolve } from 'path'
import { APP_NAME, resolveProfileDirectory } from './app-identity'

const appData = resolve('profile-test-data')
const selected = join(appData, 'explicit development profile')

describe('application profile isolation', () => {
  it('uses a distinct product directory by default', () => {
    expect(resolveProfileDirectory([], appData)).toBe(join(appData, 'SuperSonicCleaner'))
    expect(resolveProfileDirectory([], appData)).not.toBe(join(appData, 'Kudu'))
    expect(APP_NAME).toBe('SuperSonicCleaner')
  })

  it('accepts the renamed flag and preserves the legacy alias', () => {
    for (const flag of ['--supersonic-cleaner-data-dir', '--kudu-data-dir']) {
      expect(resolveProfileDirectory([`${flag}=${selected}`], appData)).toBe(selected)
      expect(resolveProfileDirectory([flag, selected], appData)).toBe(selected)
    }
  })

  it('preserves explicitly selected Electron development profiles', () => {
    expect(resolveProfileDirectory([`--user-data-dir=${selected}`], appData)).toBe(selected)
  })

  it('prefers the current alias over legacy flags irrespective of argument order', () => {
    expect(
      resolveProfileDirectory(
        [`--kudu-data-dir=${join(appData, 'old')}`, `--supersonic-cleaner-data-dir=${selected}`],
        appData
      )
    ).toBe(selected)
  })

  it('ignores empty or relative profile overrides', () => {
    for (const args of [
      ['--supersonic-cleaner-data-dir='],
      ['--supersonic-cleaner-data-dir=relative'],
      ['--supersonic-cleaner-data-dir']
    ]) {
      expect(resolveProfileDirectory(args, appData)).toBe(join(appData, APP_NAME))
    }
  })
})
