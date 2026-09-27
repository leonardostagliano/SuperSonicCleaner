import { describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import { packageRelease } from './package-release'

const unsigned = {
  RUNNER_OS: 'macOS',
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  CSC_LINK: '',
  CSC_KEY_PASSWORD: '',
  APPLE_ID: '',
  APPLE_APP_SPECIFIC_PASSWORD: '',
  APPLE_TEAM_ID: ''
}
const signed = {
  ...unsigned,
  CSC_LINK: 'synthetic-certificate.p12',
  CSC_KEY_PASSWORD: ' synthetic password ',
  APPLE_ID: 'release@example.invalid',
  APPLE_APP_SPECIFIC_PASSWORD: 'synthetic-apple-password',
  APPLE_TEAM_ID: 'SYNTHETIC'
}
const args = ['--mac', '--publish', 'never']
const runner = () =>
  vi.fn(
    (_command: string, _args: string[], _options: { env: NodeJS.ProcessEnv; stdio: string }) => ({
      status: 0
    })
  )

describe('release packaging credentials', () => {
  it.each(['', ' \t\n', undefined])(
    'removes an empty or absent certificate before electron-builder sees it (%j)',
    (link) => {
      const env = { ...unsigned, CSC_LINK: link }
      const run = runner()
      expect(packageRelease(args, env, run)).toBe(0)
      const [command, childArgs, options] = run.mock.calls[0]
      expect(command).toBe(process.execPath)
      expect(childArgs[0]).toMatch(/electron-builder[/\\]cli\.js$/)
      expect(childArgs.slice(1)).toEqual([...args, '-c.mac.notarize=false'])
      expect(options.env).not.toHaveProperty('CSC_LINK')
      expect(options.env).not.toHaveProperty('CSC_KEY_PASSWORD')
      expect(options.env.CSC_IDENTITY_AUTO_DISCOVERY).toBe('false')
      expect(env).toHaveProperty('CSC_LINK', link)
      expect(args).toEqual(['--mac', '--publish', 'never'])
    }
  )

  it('makes the installed builder resolve no certificate instead of the checkout directory', () => {
    const probe = `
      const { PlatformPackager } = require('app-builder-lib')
      const context = { info: { config: {} }, platformSpecificBuildOptions: {} }
      const link = PlatformPackager.prototype.getCscLink.call(context)
      process.stdout.write(JSON.stringify({ link: link ?? null }))
    `
    let resolved: unknown
    const run = (_command: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
      const result = spawnSync(process.execPath, ['-e', probe], {
        cwd: resolve(__dirname, '..'),
        env: options.env,
        encoding: 'utf8',
        timeout: 15_000,
        windowsHide: true
      })
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
      resolved = JSON.parse(result.stdout)
      return result
    }
    packageRelease(args, { ...process.env, ...unsigned }, run)
    expect(resolved).toEqual({ link: null })
  }, 20_000)

  it('preserves configured signing and notarization credentials exactly', () => {
    const run = runner()
    packageRelease(args, signed, run)
    expect(run.mock.calls[0][1].slice(1)).toEqual(args)
    expect(run.mock.calls[0][2].env).toEqual(signed)
  })

  it.each(['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'])(
    'keeps certificate signing but disables notarization when %s is missing',
    (missing) => {
      const run = runner()
      packageRelease(args, { ...signed, [missing]: '' }, run)
      expect(run.mock.calls[0][1].slice(1)).toEqual([...args, '-c.mac.notarize=false'])
      expect(run.mock.calls[0][2].env.CSC_LINK).toBe(signed.CSC_LINK)
      expect(run.mock.calls[0][2].env.CSC_KEY_PASSWORD).toBe(signed.CSC_KEY_PASSWORD)
    }
  )

  it.each(['Windows', 'Linux'])('does not add macOS overrides on %s', (platform) => {
    const run = runner()
    const platformArgs = [platform === 'Windows' ? '--win' : '--linux', '--publish', 'never']
    packageRelease(platformArgs, { ...unsigned, RUNNER_OS: platform }, run)
    expect(run.mock.calls[0][1].slice(1)).toEqual(platformArgs)
    expect(run.mock.calls[0][2].env).not.toHaveProperty('CSC_LINK')
  })

  it('preserves configured Windows signing', () => {
    const run = runner()
    const env = { ...signed, RUNNER_OS: 'Windows' }
    const platformArgs = ['--win', '--publish', 'never']
    packageRelease(platformArgs, env, run)
    expect(run.mock.calls[0][1].slice(1)).toEqual(platformArgs)
    expect(run.mock.calls[0][2].env).toEqual(env)
  })

  it('propagates packaging failures, termination, and spawn errors', () => {
    expect(packageRelease(args, unsigned, () => ({ status: 9 }))).toBe(9)
    expect(packageRelease(args, unsigned, () => ({ status: null }))).toBe(1)
    const error = new Error('Cannot start electron-builder')
    expect(() => packageRelease(args, unsigned, () => ({ error }))).toThrow(error)
  })

  it.each(['automatic-release', 'release'])(
    '%s uses the tested packaging entry point',
    (workflow) => {
      const config = load(
        readFileSync(resolve(__dirname, `../.github/workflows/${workflow}.yml`), 'utf8')
      ) as { jobs: { build: { steps: { run?: string; env?: Record<string, string> }[] } } }
      const step = config.jobs.build.steps.find((entry) =>
        entry.run?.includes('node scripts/package-release.js')
      )
      expect(step).toBeDefined()
      expect(step?.run).toContain('--publish never')
      expect(step?.env?.CSC_IDENTITY_AUTO_DISCOVERY).toBe('false')
    }
  )
})
