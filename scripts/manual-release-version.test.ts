import { describe, expect, it } from 'vitest'
import { manualReleaseVersion } from './manual-release-version'

describe('manual release versions after automatic releases', () => {
  it('uses remote release tags when package.json is behind', () => {
    expect(manualReleaseVersion('3.4.0', 'patch', ['v3.4.0', 'v3.4.1'])).toBe('3.4.2')
    expect(manualReleaseVersion('3.4.0', 'minor', ['v3.10.1', 'v3.9.9'])).toBe('3.11.0')
    expect(manualReleaseVersion('3.4.0', 'major', ['v4.0.0'])).toBe('5.0.0')
  })

  it('respects a newer declared version and ignores nonstable tags', () => {
    expect(manualReleaseVersion('4.0.0', 'patch', ['v3.5.0', 'v9.0.0-beta.1', 'unrelated'])).toBe(
      '4.0.1'
    )
    expect(manualReleaseVersion('3.4.0', 'patch', [])).toBe('3.4.1')
  })

  it('rejects invalid bump names before files are changed', () => {
    expect(() => manualReleaseVersion('3.4.0', 'invalid', [])).toThrow('Expected patch')
  })
})
