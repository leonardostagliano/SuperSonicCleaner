import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Regression tests for #462: the winget scan must never turn a failure (CLI
// not found, timeout, crash) or a localised table into "everything is up to
// date". Every scenario runs the real checkForUpdates() over a mocked winget.

const mockExecFile = vi.fn()
vi.mock('child_process', async () => {
  const { promisify } = await import('util')
  // Mirror the real execFile's promisify shape: resolve { stdout, stderr }
  // and attach stdout/stderr to rejections.
  const execFile = (...args: unknown[]): unknown => mockExecFile(...args)
  Object.defineProperty(execFile, promisify.custom, {
    value: (file: string, args: string[], opts: unknown) =>
      new Promise((resolve, reject) => {
        mockExecFile(file, args, opts, (err: unknown, stdout: string, stderr: string) => {
          if (err) reject(err)
          else resolve({ stdout, stderr })
        })
      })
  })
  return { execFile }
})
const mockExistsSync = vi.fn(() => false)
vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readdirSync: () => []
}))
vi.mock('./elevation', () => ({ isAdmin: () => false }))
vi.mock('./settings-store', () => ({
  getSettings: () => ({ windowsPackageManagers: ['winget'] })
}))
// Upgrades run through the install runner; keep its real output parser
const mockRunInstall = vi.fn()
vi.mock('./install-runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./install-runner')>()
  return { ...actual, runInstallCommand: (...args: unknown[]) => mockRunInstall(...args) }
})

import {
  checkForUpdates,
  resetStillInstalling,
  resetWingetCache,
  runUpdates
} from './software-updater'
import type { InstallRun, InstallRunOptions } from './install-runner'
import type { UpdateProgress } from '../../shared/types'

type ExecCb = (err: unknown, stdout: string, stderr: string) => void

interface Scripted {
  stdout?: string
  /** Reject with this error (its stdout is attached like execFile does). */
  error?: Record<string, unknown>
  /** The install runner stopped waiting; the process is still going. */
  timedOut?: boolean
  /** Output streamed to the runner's onOutput before it settles. */
  chunks?: string[]
  /** When a process left running (timedOut) exits; never, by default. */
  exited?: Promise<void>
}

/** The install runner's view of a scripted response. */
function toInstallRun(s: Scripted): InstallRun {
  const stdout = s.stdout ?? ''
  const exited = Promise.resolve()
  if (s.timedOut) {
    return {
      code: null,
      stdout,
      stderr: '',
      timedOut: true,
      exited: s.exited ?? new Promise<void>(() => {})
    }
  }
  if (!s.error) return { code: 0, stdout, stderr: '', timedOut: false, exited }
  if (typeof s.error.code === 'number') {
    return { code: s.error.code, stdout, stderr: '', timedOut: false, exited }
  }
  return {
    code: null,
    stdout,
    stderr: '',
    timedOut: false,
    error: Object.assign(new Error('failed'), { code: s.error.code as string }),
    exited
  }
}

/** Printed by the elevation wrapper once Windows started the elevated process. */
const ELEVATED_STARTED = 'SSC-ELEVATED-PROCESS-STARTED\r\n'

/** Route each winget invocation to a scripted response keyed by subcommand. */
function scriptWinget(responses: Record<string, Scripted>): void {
  mockExecFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: ExecCb) => {
    const key = args[0]
    const scripted = responses[key]
    if (!scripted) {
      cb(Object.assign(new Error(`unexpected ${file} ${key}`), { code: 'ENOENT' }), '', '')
      return
    }
    if (scripted.error) {
      const err = Object.assign(new Error(String(scripted.error.message ?? 'failed')), {
        stdout: scripted.stdout ?? '',
        stderr: '',
        ...scripted.error
      })
      cb(err, scripted.stdout ?? '', '')
      return
    }
    cb(null, scripted.stdout ?? '', '')
  })
}

const UPGRADE_TABLE = [
  'Name                Id                       Version        Available       Source',
  '------------------------------------------------------------------------------------',
  'Adobe Acrobat DC    XPDP273C0XHQH2           20.006.20042   26.001.21691    msstore',
  'GitHub CLI          GitHub.cli               2.100.0        2.101.0         winget',
  '2 upgrades available.',
  ''
].join('\r\n')

const originalPlatform = process.platform

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'win32' })
  resetWingetCache()
  mockExecFile.mockReset()
  mockRunInstall.mockReset()
  resetStillInstalling()
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform })
})

describe('checkForUpdates (winget)', () => {
  it('reports outdated packages from the upgrade table', async () => {
    scriptWinget({ '--version': { stdout: 'v1.9.0' }, upgrade: { stdout: UPGRADE_TABLE } })

    const result = await checkForUpdates()
    expect(result.apps.map((a) => a.id)).toEqual(['XPDP273C0XHQH2', 'GitHub.cli'])
    expect(result.managers).toEqual([{ name: 'winget', available: true, outdatedCount: 2 }])
  })

  it('flags winget as errored when it cannot be started', async () => {
    scriptWinget({})

    const result = await checkForUpdates()
    expect(result.apps).toEqual([])
    expect(result.packageManagerAvailable).toBe(false)
    expect(result.managers[0]).toMatchObject({
      name: 'winget',
      available: false,
      error: expect.stringContaining('not found')
    })
  })

  it('falls back to a known install path when winget is not on PATH', async () => {
    const calls: string[] = []
    mockExecFile.mockImplementation((file: string, args: string[], _o: unknown, cb: ExecCb) => {
      calls.push(file)
      if (file === 'winget') {
        cb(Object.assign(new Error('spawn winget ENOENT'), { code: 'ENOENT' }), '', '')
      } else if (args[0] === '--version') {
        cb(null, 'v1.9.0', '')
      } else {
        cb(null, args[0] === 'upgrade' ? UPGRADE_TABLE : '', '')
      }
    })
    vi.stubEnv('LOCALAPPDATA', 'C:\\Users\\me\\AppData\\Local')
    mockExistsSync.mockReturnValue(true)

    const result = await checkForUpdates()
    expect(result.apps).toHaveLength(2)
    expect(calls.some((f) => /WindowsApps[\\/]winget\.exe$/.test(f))).toBe(true)

    mockExistsSync.mockReturnValue(false)
    vi.unstubAllEnvs()
  })

  it('reports a timeout instead of "up to date"', async () => {
    scriptWinget({
      '--version': { stdout: 'v1.9.0' },
      upgrade: { stdout: '   -\r   \\r', error: { killed: true, signal: 'SIGTERM' } }
    })

    const result = await checkForUpdates()
    expect(result.apps).toEqual([])
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.managers[0]).toMatchObject({ name: 'winget', error: 'timed out' })
  })

  it('surfaces the last output line when winget exits with an unknown error', async () => {
    scriptWinget({
      '--version': { stdout: 'v1.9.0' },
      upgrade: {
        stdout:
          'Failed in attempting to update the source: winget\r\nAn unexpected error occurred while executing the command:\r\n0x8a15000f : Data required by the source is missing\r\n',
        error: { code: 0x8a15000f }
      }
    })

    const result = await checkForUpdates()
    expect(result.apps).toEqual([])
    expect(result.managers[0].error).toContain('0x8a15000f')
  })

  it('treats the "no applications found" exit code as nothing outdated', async () => {
    scriptWinget({
      '--version': { stdout: 'v1.9.0' },
      upgrade: {
        stdout: 'No installed package found matching input criteria.\r\n',
        error: { code: 0x8a150014 }
      },
      list: { stdout: '' }
    })

    const result = await checkForUpdates()
    expect(result.apps).toEqual([])
    expect(result.managers[0]).toEqual({ name: 'winget', available: true, outdatedCount: 0 })
  })

  it('keeps partial rows but flags the scan when winget is killed mid-table', async () => {
    scriptWinget({
      '--version': { stdout: 'v1.9.0' },
      upgrade: { stdout: UPGRADE_TABLE, error: { killed: true, signal: 'SIGTERM' } }
    })

    const result = await checkForUpdates()
    expect(result.apps).toHaveLength(2)
    expect(result.managers[0]).toMatchObject({ outdatedCount: 2, error: 'timed out' })
  })

  it('flags a source failure even when a table was printed', async () => {
    scriptWinget({
      '--version': { stdout: 'v1.9.0' },
      upgrade: {
        stdout: 'Failed in attempting to update the source: msstore\r\n' + UPGRADE_TABLE,
        error: { code: 0x8a15000f }
      }
    })

    const result = await checkForUpdates()
    expect(result.apps).toHaveLength(2)
    expect(result.managers[0].error).toBeDefined()
  })

  it('still parses the table when winget exits non-zero after printing it', async () => {
    scriptWinget({
      '--version': { stdout: 'v1.9.0' },
      upgrade: { stdout: UPGRADE_TABLE, error: { code: 0x8a150014 } }
    })

    const result = await checkForUpdates()
    expect(result.apps).toHaveLength(2)
    expect(result.managers[0].error).toBeUndefined()
  })
})

// Regression tests for #475: an upgrade is judged by winget's exit code, not
// by English output text, so a localised Windows reports real results.
describe('runUpdates (winget)', () => {
  const ITALIAN_SUCCESS = [
    'Trovato DLSS Updater [Recol.DLSSUpdater] Versione 3.1.0',
    'Download in corso https://example.com/DLSS.Updater.3.1.0.exe',
    'Installazione riuscita',
    ''
  ].join('\r\n')

  interface Call {
    file: string
    args: string[]
    opts?: InstallRunOptions
  }

  /**
   * Script winget: `upgrade <id>` runs through `attempts` in order (the last
   * one repeats), the bare `upgrade` rescan returns `rescan`, and the
   * elevated PowerShell run returns `elevatedRun`. Upgrades go through the
   * install runner, everything else through execFile; both share the script.
   */
  function scriptUpgrade(
    attempts: Scripted[],
    rescan: Scripted = { stdout: '' },
    elevatedRun: Scripted = { stdout: '' }
  ): Call[] {
    const calls: Call[] = []
    let attempt = 0
    const respond = (file: string, args: string[]): Scripted => {
      if (file === 'powershell.exe') return elevatedRun
      if (args[0] === '--version') return { stdout: 'v1.9.0' }
      if (args[0] === 'upgrade' && args[1]?.startsWith('--')) return rescan
      if (args[0] === 'upgrade') return attempts[Math.min(attempt++, attempts.length - 1)]
      return { stdout: '' }
    }
    mockExecFile.mockImplementation((file: string, args: string[], _o: unknown, cb: ExecCb) => {
      calls.push({ file, args })
      const scripted = respond(file, args)
      if (scripted.error) {
        cb(
          Object.assign(new Error('failed'), { stdout: scripted.stdout ?? '' }, scripted.error),
          scripted.stdout ?? '',
          ''
        )
      } else {
        cb(null, scripted.stdout ?? '', '')
      }
    })
    mockRunInstall.mockImplementation(
      async (file: string, args: string[], opts: InstallRunOptions) => {
        calls.push({ file, args, opts })
        const scripted = respond(file, args)
        for (const chunk of scripted.chunks ?? []) opts.onOutput?.(chunk)
        return toInstallRun(scripted)
      }
    )
    return calls
  }

  const upgradeCalls = (calls: Call[]): Call[] =>
    calls.filter((c) => c.args[0] === 'upgrade' && !c.args[1]?.startsWith('--'))
  const elevated = (calls: Call[]): boolean => calls.some((c) => c.file === 'powershell.exe')
  const update = (id = 'Recol.DLSSUpdater', name?: string, onProgress = () => {}) =>
    runUpdates([{ id, source: 'winget', ...(name ? { name } : {}) }], onProgress)
  const DLSS = { appId: 'Recol.DLSSUpdater', name: 'Recol.DLSSUpdater', source: 'winget' }

  it('counts a clean exit as success whatever language winget speaks', async () => {
    const calls = scriptUpgrade([{ stdout: ITALIAN_SUCCESS }])

    const result = await update()
    expect(result).toEqual({ succeeded: 1, failed: 0, updated: [DLSS], pending: [], errors: [] })
    expect(upgradeCalls(calls)).toHaveLength(1)
  })

  it('counts "restart required to finish" as success', async () => {
    scriptUpgrade([{ stdout: ITALIAN_SUCCESS, error: { code: 0x8a150109 } }])

    const result = await update()
    expect(result.succeeded).toBe(1)
  })

  it('counts "no applicable update" as success: the app is already current', async () => {
    const calls = scriptUpgrade([
      { stdout: 'Nessun aggiornamento disponibile.\r\n', error: { code: 0x8a15002b } }
    ])

    const result = await update()
    expect(result).toEqual({ succeeded: 1, failed: 0, updated: [DLSS], pending: [], errors: [] })
    expect(upgradeCalls(calls)).toHaveLength(1)
  })

  it('does not retry a failure that retrying cannot fix', async () => {
    const calls = scriptUpgrade([
      { stdout: "L'applicazione è in esecuzione.\r\n", error: { code: 0x8a150101 } }
    ])

    const result = await update()
    expect(result.failed).toBe(1)
    expect(result.errors[0].reason).toBe('The app is running — close it and try again')
    expect(upgradeCalls(calls)).toHaveLength(1)
    expect(elevated(calls)).toBe(false)
  })

  it('retries an unknown localised failure elevated, then forced, and shows the exit code', async () => {
    const calls = scriptUpgrade(
      [{ stdout: 'Programma di installazione non riuscito: 1603\r\n', error: { code: 1603 } }],
      { stdout: UPGRADE_TABLE.replace('GitHub.cli', 'Recol.DLSSUpdater') }
    )

    const result = await update()
    expect(elevated(calls)).toBe(true)
    expect(upgradeCalls(calls).map((c) => c.args.includes('--force'))).toEqual([false, true])
    expect(result.errors[0].reason).toBe('Programma di installazione non riuscito: 1603 (0x643)')
  })

  it('treats an empty rescan after an elevated upgrade as success', async () => {
    scriptUpgrade([{ stdout: 'Accesso negato.\r\n', error: { code: 0x80070005 } }], {
      stdout: 'Nessun pacchetto installato trovato.\r\n',
      error: { code: 0x8a150014 }
    })

    const result = await update()
    expect(result).toEqual({ succeeded: 1, failed: 0, updated: [DLSS], pending: [], errors: [] })
  })

  it('accepts a reboot-pending exit from the elevated run', async () => {
    const calls = scriptUpgrade(
      [{ stdout: 'Accesso negato.\r\n', error: { code: 0x80070005 } }],
      { stdout: 'Nessun pacchetto installato trovato.\r\n', error: { code: 0x8a150014 } },
      // PowerShell hands back winget's HRESULT as a signed exit code
      { error: { code: 0x8a150109 | 0 } }
    )

    const result = await update()
    expect(result).toEqual({ succeeded: 1, failed: 0, updated: [DLSS], pending: [], errors: [] })
    expect(upgradeCalls(calls).some((c) => c.args.includes('--force'))).toBe(false)
  })

  // A large installer (PowerToys from the Store) outlived the old 10-minute
  // timeout: winget was killed, its installer kept running orphaned, and the
  // --force retry reported "no applicable update" — counted as a success while
  // the install was still going.
  it('gives an install up to 30 minutes', async () => {
    const calls = scriptUpgrade([{ stdout: ITALIAN_SUCCESS }])

    await update()
    expect(upgradeCalls(calls)[0].opts?.waitLimitMs).toBe(30 * 60 * 1000)
  })

  it('reports an install that outlasts the wait as still running, without retrying it', async () => {
    const calls = scriptUpgrade([
      { stdout: "Avvio dell'installazione del pacchetto in corso...\r\n", timedOut: true }
    ])

    const result = await update('XP89DCGQ3K6VLD', 'Microsoft PowerToys')
    expect(result).toEqual({
      succeeded: 0,
      failed: 0,
      updated: [],
      pending: [{ appId: 'XP89DCGQ3K6VLD', name: 'Microsoft PowerToys', source: 'winget' }],
      errors: []
    })
    expect(upgradeCalls(calls)).toHaveLength(1)
    expect(elevated(calls)).toBe(false)
  })

  it('does not force a retry while an elevated install is still running', async () => {
    const calls = scriptUpgrade(
      [{ stdout: 'Accesso negato.\r\n', error: { code: 0x80070005 } }],
      { stdout: '' },
      { timedOut: true, chunks: [ELEVATED_STARTED] }
    )

    const result = await update()
    expect(result.pending).toEqual([DLSS])
    expect(result.failed).toBe(0)
    expect(upgradeCalls(calls).some((c) => c.args.includes('--force'))).toBe(false)
    const elevatedRun = calls.find((c) => c.file === 'powershell.exe')
    expect(elevatedRun?.opts?.waitLimitMs).toBe(30 * 60 * 1000)
  })

  // Until the UAC prompt is accepted nothing installs: an unanswered prompt
  // is a failure, and a --force retry could run alongside a late approval
  it('gives up on an unanswered UAC prompt, without calling it installing or retrying', async () => {
    const calls = scriptUpgrade(
      [{ stdout: 'Accesso negato.\r\n', error: { code: 0x80070005 } }],
      { stdout: '' },
      { timedOut: true }
    )

    const result = await update()
    expect(result.pending).toEqual([])
    expect(result.errors).toEqual([{ ...DLSS, reason: 'Administrator approval was not given' }])
    expect(upgradeCalls(calls).some((c) => c.args.includes('--force'))).toBe(false)
  })

  it('runs winget detached, so an install left running outlives the app', async () => {
    const calls = scriptUpgrade([{ stdout: ITALIAN_SUCCESS }])

    await update()
    expect(upgradeCalls(calls)[0].opts?.detached).toBe(true)
  })

  it('replaces a failed attempt’s last line with an administrator notice while elevated', async () => {
    scriptUpgrade(
      [
        {
          stdout: 'Programma di installazione non riuscito: 1603\r\n',
          chunks: ['Programma di installazione non riuscito: 1603\r\n'],
          error: { code: 1603 }
        }
      ],
      { stdout: '' },
      { stdout: '', chunks: [ELEVATED_STARTED] }
    )
    const events: UpdateProgress[] = []

    await update('Recol.DLSSUpdater', 'DLSS Updater', (p) => events.push(p))

    const stale = events.findIndex((e) => e.detail?.includes('1603'))
    const elevatedEvent = events.findIndex((e) => e.elevated)
    expect(stale).toBeGreaterThanOrEqual(0)
    expect(elevatedEvent).toBeGreaterThan(stale)
    expect(events[elevatedEvent].detail).toBeUndefined()
  })

  it('reports a forced retry that outlasts the wait as still running', async () => {
    scriptUpgrade(
      [
        { stdout: 'Programma di installazione non riuscito: 1603\r\n', error: { code: 1603 } },
        { stdout: '', timedOut: true }
      ],
      { stdout: UPGRADE_TABLE.replace('GitHub.cli', 'Recol.DLSSUpdater') }
    )

    const result = await update()
    expect(result.pending).toEqual([DLSS])
    expect(result.errors).toEqual([])
  })

  it('names each package in results and progress, falling back to its id', async () => {
    scriptUpgrade([{ stdout: "L'applicazione è in esecuzione.\r\n", error: { code: 0x8a150101 } }])
    const events: UpdateProgress[] = []

    const failed = await update('XP89DCGQ3K6VLD', 'Microsoft PowerToys', (p) => events.push(p))
    expect(failed.errors[0]).toMatchObject({ appId: 'XP89DCGQ3K6VLD', name: 'Microsoft PowerToys' })
    expect(events.map((e) => e.currentAppName)).toEqual([
      'Microsoft PowerToys',
      'Microsoft PowerToys'
    ])

    scriptUpgrade([{ stdout: ITALIAN_SUCCESS }])
    const unnamed = await update('XP89DCGQ3K6VLD')
    expect(unnamed.updated[0].name).toBe('XP89DCGQ3K6VLD')
  })

  it('streams what winget is doing into the progress events', async () => {
    scriptUpgrade([
      {
        stdout: ITALIAN_SUCCESS,
        chunks: [
          'Download in corso https://example.com/file\r\n',
          '  ████████▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  1.00 MB / 4.00 MB'
        ]
      }
    ])
    const events: UpdateProgress[] = []

    await update('Recol.DLSSUpdater', 'DLSS Updater', (p) => events.push(p))

    const running = events.filter((e) => e.status === 'in-progress')
    expect(running[0]).toMatchObject({ current: 1, total: 1, currentAppName: 'DLSS Updater' })
    expect(typeof running[0].startedAt).toBe('number')
    expect(running).toContainEqual(
      expect.objectContaining({ detail: 'Download in corso', stepPercent: 25 })
    )
    // Every event for the item carries the same start time
    expect(new Set(events.map((e) => e.startedAt)).size).toBe(1)
    expect(events[events.length - 1]).toMatchObject({ status: 'done', percent: 100 })
  })

  it('keeps the status line on screen through a long stretch of spinner output', async () => {
    const spinner = ['\r  -', '\r  \\', '\r  |', '\r  /'].join('').repeat(1500)
    scriptUpgrade([
      {
        stdout: ITALIAN_SUCCESS,
        chunks: ["Avvio dell'installazione del pacchetto in corso...\r\n", spinner, spinner]
      }
    ])
    const events: UpdateProgress[] = []

    await update('Recol.DLSSUpdater', 'DLSS Updater', (p) => events.push(p))

    const withDetail = events.filter((e) => e.status === 'in-progress' && e.detail)
    expect(withDetail).toHaveLength(1)
    expect(withDetail[0].detail).toBe("Avvio dell'installazione del pacchetto in corso...")
  })

  /** Script upgrades per package id: each id runs through its own attempts. */
  function scriptById(byId: Record<string, Scripted[]>): Call[] {
    const calls: Call[] = []
    const next: Record<string, number> = {}
    const respond = (file: string, args: string[]): Scripted => {
      if (args[0] === '--version') return { stdout: 'v1.9.0' }
      if (file === 'powershell.exe' || args[1]?.startsWith('--')) return { stdout: '' }
      const attempts = byId[args[1]] ?? [{ stdout: '' }]
      const i = next[args[1]] ?? 0
      next[args[1]] = i + 1
      return attempts[Math.min(i, attempts.length - 1)]
    }
    mockExecFile.mockImplementation((file: string, args: string[], _o: unknown, cb: ExecCb) => {
      calls.push({ file, args })
      cb(null, respond(file, args).stdout ?? '', '')
    })
    mockRunInstall.mockImplementation(
      async (file: string, args: string[], opts: InstallRunOptions) => {
        calls.push({ file, args, opts })
        const scripted = respond(file, args)
        for (const chunk of scripted.chunks ?? []) opts.onOutput?.(chunk)
        return toInstallRun(scripted)
      }
    )
    return calls
  }

  // winget runs one install at a time: behind an install left running, every
  // other package would queue for the whole wait and then be "still running" too
  it('does not queue other winget packages behind an install left running', async () => {
    const calls = scriptById({
      XP89DCGQ3K6VLD: [{ stdout: '', timedOut: true }],
      'Git.Git': [{ stdout: ITALIAN_SUCCESS }],
      git: [{ stdout: 'Chocolatey upgraded 0/1 packages.' }]
    })
    const events: UpdateProgress[] = []

    const result = await runUpdates(
      [
        { id: 'XP89DCGQ3K6VLD', source: 'msstore', name: 'Microsoft PowerToys' },
        { id: 'Git.Git', source: 'winget', name: 'Git' },
        { id: 'git', source: 'choco', name: 'Git (choco)' }
      ],
      (p) => events.push(p)
    )

    expect(result.pending).toEqual([
      { appId: 'XP89DCGQ3K6VLD', name: 'Microsoft PowerToys', source: 'msstore' }
    ])
    expect(result.updated).toEqual([])
    expect(result.errors).toEqual([
      {
        appId: 'Git.Git',
        name: 'Git',
        source: 'winget',
        reason:
          'Not started: Microsoft PowerToys is still installing — update again once it finishes'
      },
      {
        appId: 'git',
        name: 'Git (choco)',
        source: 'choco',
        reason: 'Chocolatey upgraded 0/1 packages.'
      }
    ])
    // Git.Git was never handed to winget; the choco package was
    expect(upgradeCalls(calls).map((c) => [c.file, c.args[1]])).toEqual([
      ['winget', 'XP89DCGQ3K6VLD'],
      ['choco', 'git'],
      ['choco', 'git']
    ])
    expect(events.filter((e) => e.status !== 'in-progress').map((e) => e.status)).toEqual([
      'pending',
      'failed',
      'failed'
    ])
    const choco = events.find((e) => e.currentApp === 'git')
    expect(choco).toMatchObject({ current: 3, total: 3, currentAppName: 'Git (choco)' })
    expect(choco?.detail).toBeUndefined()
  })

  it('never starts a package that is still installing from an earlier run', async () => {
    let finish: () => void = () => {}
    const exited = new Promise<void>((r) => (finish = r))
    const calls = scriptById({
      XP89DCGQ3K6VLD: [{ stdout: '', timedOut: true, exited }, { stdout: ITALIAN_SUCCESS }],
      'Git.Git': [{ stdout: ITALIAN_SUCCESS }]
    })
    const powertoys = { id: 'XP89DCGQ3K6VLD', source: 'msstore', name: 'Microsoft PowerToys' }
    const git = { id: 'Git.Git', source: 'winget', name: 'Git' }

    await runUpdates([powertoys], () => {})
    const again = await runUpdates([powertoys], () => {})
    const other = await runUpdates([git], () => {})
    expect(again.pending).toHaveLength(1)
    expect(other.errors[0].reason).toContain('Microsoft PowerToys is still installing')
    expect(upgradeCalls(calls)).toHaveLength(1)

    // Once it exits, both can run again
    finish()
    await exited
    await Promise.resolve()
    const later = await runUpdates([powertoys, git], () => {})
    expect(later.updated.map((u) => u.appId)).toEqual(['XP89DCGQ3K6VLD', 'Git.Git'])
  })
})

describe('runUpdates (choco)', () => {
  interface ChocoCall {
    file: string
    args: string[]
    opts?: InstallRunOptions
  }

  /** choco and its elevated PowerShell wrapper run through `attempts` in call order. */
  function scriptChoco(attempts: Scripted[]): ChocoCall[] {
    const calls: ChocoCall[] = []
    let attempt = 0
    const respond = (): Scripted => attempts[Math.min(attempt++, attempts.length - 1)]
    mockRunInstall.mockImplementation(
      async (file: string, args: string[], opts: InstallRunOptions) => {
        calls.push({ file, args, opts })
        const scripted = respond()
        for (const chunk of scripted.chunks ?? []) opts.onOutput?.(chunk)
        return toInstallRun(scripted)
      }
    )
    mockExecFile.mockImplementation((file: string, args: string[], _o: unknown, cb: ExecCb) => {
      calls.push({ file, args })
      cb(null, '', '')
    })
    return calls
  }

  const GIT = { appId: 'git', name: 'Git', source: 'choco' }
  const update = () => runUpdates([{ id: 'git', source: 'choco', name: 'Git' }], () => {})
  const DENIED = { stdout: "Access to the path 'C:\\ProgramData\\chocolatey\\lib' is denied." }

  it('reports an upgrade that outlasts the wait as still running, without retrying it', async () => {
    const calls = scriptChoco([
      { stdout: 'Progress: Downloading git 2.45.1... 45%', timedOut: true }
    ])

    const result = await update()
    expect(result.pending).toEqual([GIT])
    expect(result.failed).toBe(0)
    expect(calls).toHaveLength(1)
    // Waited as long as winget is, but not detached: choco prints nothing without a console
    expect(calls[0].opts?.waitLimitMs).toBe(30 * 60 * 1000)
    expect(calls[0].opts?.detached).toBeFalsy()
  })

  it('does not force a retry while an elevated upgrade is still running', async () => {
    const calls = scriptChoco([DENIED, { timedOut: true, chunks: [ELEVATED_STARTED] }])

    const result = await update()
    expect(result.pending).toEqual([GIT])
    expect(result.failed).toBe(0)
    expect(calls.map((c) => c.file)).toEqual(['choco', 'powershell.exe'])
    expect(calls[1].opts?.waitLimitMs).toBe(30 * 60 * 1000)
  })

  it('gives up on an unanswered UAC prompt without retrying', async () => {
    const calls = scriptChoco([DENIED, { timedOut: true }])

    const result = await update()
    expect(result.pending).toEqual([])
    expect(result.errors).toEqual([{ ...GIT, reason: 'Administrator approval was not given' }])
    expect(calls.map((c) => c.file)).toEqual(['choco', 'powershell.exe'])
  })

  it('reports a forced retry that outlasts the wait as still running', async () => {
    const calls = scriptChoco([
      { stdout: 'Chocolatey upgraded 0/1 packages.' },
      { stdout: '', timedOut: true }
    ])

    const result = await update()
    expect(result.pending).toEqual([GIT])
    expect(result.errors).toEqual([])
    expect(calls.map((c) => c.args.includes('--force'))).toEqual([false, true])
  })

  it('names an upgraded package in the result', async () => {
    scriptChoco([{ stdout: 'Chocolatey upgraded 1/1 packages.' }])

    const result = await update()
    expect(result).toEqual({
      succeeded: 1,
      failed: 0,
      updated: [{ appId: 'git', name: 'Git', source: 'choco' }],
      pending: [],
      errors: []
    })
  })
})
