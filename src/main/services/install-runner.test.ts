import { describe, it, expect, afterEach } from 'vitest'
import {
  attachedInstallCount,
  readProgress,
  runInstallCommand,
  waitForAttachedInstalls
} from './install-runner'

// Real child processes: the runner's contract is about process lifetime, which
// a mocked spawn cannot prove.
const node = process.execPath
const leftRunning: number[] = []

afterEach(() => {
  for (const pid of leftRunning.splice(0)) {
    // Never 0 or negative: those address the test runner itself (or its group)
    if (!(pid > 0)) continue
    try {
      process.kill(pid)
    } catch {
      // Already gone
    }
  }
})

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('runInstallCommand', () => {
  it('streams output as it arrives and reports the exit code', async () => {
    const chunks: string[] = []
    const run = await runInstallCommand(
      node,
      [
        '-e',
        "process.stdout.write('Downloading\\r\\n  10%\\r  60%\\r'); setTimeout(() => { process.stdout.write('Installing\\r\\n'); process.exit(3) }, 50)"
      ],
      { waitLimitMs: 10_000, onOutput: (text) => chunks.push(text) }
    )

    expect(run.code).toBe(3)
    expect(run.timedOut).toBe(false)
    expect(run.stdout).toContain('Installing')
    expect(chunks.join('')).toBe(run.stdout)
    expect(run.pid).toBeGreaterThan(0)
    await expect(run.exited).resolves.toBeUndefined()
  })

  it('stops waiting at the limit but leaves the process running', async () => {
    const chunks: string[] = []
    const run = await runInstallCommand(
      node,
      ['-e', "setInterval(() => process.stdout.write('tick\\n'), 20)"],
      { waitLimitMs: 1_500, onOutput: (text) => chunks.push(text) }
    )
    leftRunning.push(run.pid ?? 0)

    expect(run.timedOut).toBe(true)
    expect(run.code).toBeNull()
    expect(run.pid).toBeGreaterThan(0)
    expect(isAlive(run.pid!)).toBe(true)
    expect(chunks.length).toBeGreaterThan(0)

    // It keeps writing into the drained pipe without dying, and nothing more
    // is reported for an item the caller has already moved past
    const seen = chunks.length
    await sleep(200)
    expect(isAlive(run.pid!)).toBe(true)
    expect(chunks.length).toBe(seen)
  })

  it('tells the caller when a process it left running finally exits', async () => {
    const run = await runInstallCommand(node, ['-e', 'setTimeout(() => {}, 1200)'], {
      waitLimitMs: 300
    })
    leftRunning.push(run.pid ?? 0)
    expect(run.timedOut).toBe(true)

    let exited = false
    void run.exited.then(() => (exited = true))
    await sleep(50)
    expect(exited).toBe(false)
    await run.exited
    expect(isAlive(run.pid!)).toBe(false)
  })

  it('lists a process left running that would die with the app, until it exits', async () => {
    const attached = await runInstallCommand(node, ['-e', 'setTimeout(() => {}, 1200)'], {
      waitLimitMs: 300
    })
    const detached = await runInstallCommand(node, ['-e', 'setTimeout(() => {}, 1200)'], {
      waitLimitMs: 300,
      detached: true
    })
    leftRunning.push(attached.pid ?? 0, detached.pid ?? 0)

    // Only the attached one is at risk when the app exits
    expect(attachedInstallCount()).toBe(1)
    await waitForAttachedInstalls()
    expect(isAlive(attached.pid!)).toBe(false)
    expect(attachedInstallCount()).toBe(0)
  })

  it('stops waiting, without killing, when the caller aborts', async () => {
    const controller = new AbortController()
    const pending = runInstallCommand(node, ['-e', 'setInterval(() => {}, 1000)'], {
      waitLimitMs: 30_000,
      signal: controller.signal
    })
    setTimeout(() => controller.abort(), 300)
    const run = await pending
    leftRunning.push(run.pid ?? 0)

    expect(run.timedOut).toBe(true)
    expect(isAlive(run.pid!)).toBe(true)
  })

  it('settles once the process exits even if something else keeps its output pipe open', async () => {
    // The child hands its stdout to a grandchild that outlives it — as an
    // installer launched by a package manager can. Detached, so the child's
    // own exit does not take the grandchild with it.
    const script = [
      "const { spawn } = require('child_process')",
      "const g = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: ['ignore', 'inherit', 'inherit'], detached: true })",
      "console.log('grandchild ' + g.pid)",
      'g.unref()',
      'process.exit(0)'
    ].join(';')
    const started = Date.now()
    const run = await runInstallCommand(node, ['-e', script], { waitLimitMs: 15_000 })
    const grandchild = Number(/grandchild (\d+)/.exec(run.stdout)?.[1] ?? 0)
    leftRunning.push(grandchild)

    expect(run.timedOut).toBe(false)
    expect(run.code).toBe(0)
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it('reports a command that cannot be started', async () => {
    const run = await runInstallCommand('definitely-not-a-real-command-xyz', [], {
      waitLimitMs: 5_000
    })
    expect(run.code).toBeNull()
    expect(run.timedOut).toBe(false)
    expect(run.error?.code).toBe('ENOENT')
    await expect(run.exited).resolves.toBeUndefined()
  })
})

describe('readProgress', () => {
  it('takes the latest status line and the download readout that follows it', () => {
    const out =
      'Found Microsoft PowerToys [XP89DCGQ3K6VLD] Version 0.101.2362.0\r\n' +
      'Downloading https://cdn.example.com/cachedpackages/1/file\r\n' +
      '  ██████▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  10.0 MB /  40.0 MB\r' +
      '  ████████████████▒▒▒▒▒▒▒▒▒▒▒▒▒▒  20.0 MB /  40.0 MB'
    expect(readProgress(out)).toEqual({ detail: 'Downloading', percent: 50 })
  })

  it('drops a finished readout once the tool moves on to the next step', () => {
    const out =
      'Download in corso https://cdn.example.com/file\r\n' +
      '  ██████████████████████████████  40,0 MB / 40,0 MB\r\n' +
      'Hash del programma di installazione verificato\r\n' +
      "Avvio dell'installazione del pacchetto in corso...\r\n" +
      '  -\r  \\\r  |\r  /\r'
    expect(readProgress(out)).toEqual({
      detail: "Avvio dell'installazione del pacchetto in corso..."
    })
  })

  it('reads the status lines winget 1.29+ prints to a pipe (no bars at all)', () => {
    const out =
      'Trovato Microsoft PowerToys [XP89DCGQ3K6VLD] Versione 0.101.2362.0\r\n' +
      'Il pacchetto è concesso in licenza dal proprietario.\r\n' +
      'Download in corso https://cdn.storeedgefd.dsx.mp.microsoft.com/file\r\n' +
      'Hash del programma di installazione verificato\r\n' +
      "Avvio dell'installazione del pacchetto in corso...\r\n"
    expect(readProgress(out)).toEqual({
      detail: "Avvio dell'installazione del pacchetto in corso..."
    })
  })

  it('reads a percentage-only bar', () => {
    const out = 'Installing\r\n  ███████████████▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  52%'
    expect(readProgress(out)).toEqual({ detail: 'Installing', percent: 52 })
  })

  it('handles mixed size units', () => {
    const out = 'Downloading\r\n  ▒▒▒  512 KB / 2.00 MB'
    expect(readProgress(out)).toEqual({ detail: 'Downloading', percent: 25 })
  })

  it('keeps the last complete readout when the newest one was cut mid-write', () => {
    const out = 'Downloading\r\n  ████████▒▒▒▒  10.0 MB / 40.0 MB\r  ████████████▒▒  20.0 M'
    expect(readProgress(out)).toEqual({ detail: 'Downloading', percent: 25 })
  })

  it('reads a spinner that carries a message without the spinning glyph', () => {
    const frames = ['-', '\\', '|', '/'].map(
      (g) => `\r   ${g} Waiting for another install/uninstall to complete...`
    )
    const details = frames.map((_, i) => readProgress(frames.slice(0, i + 1).join('')).detail)
    expect(new Set(details)).toEqual(
      new Set(['Waiting for another install/uninstall to complete...'])
    )
  })

  it('keeps a status line that carries its own percentage (choco)', () => {
    const out = 'Progress: Downloading git.install 2.45.1... 45%\r\n'
    expect(readProgress(out)).toEqual({
      detail: 'Progress: Downloading git.install 2.45.1... 45%'
    })
  })

  it('strips terminal escape sequences', () => {
    expect(readProgress('\x1B[2K\x1B[1GStarting package install...\r\n')).toEqual({
      detail: 'Starting package install...'
    })
    expect(readProgress('\x1B]9;4;1;40\x07\x1B[?25lInstalling\r\n')).toEqual({
      detail: 'Installing'
    })
  })

  it('shortens very long lines', () => {
    const { detail } = readProgress('x'.repeat(500))
    expect(detail!.length).toBeLessThanOrEqual(160)
    expect(detail!.endsWith('…')).toBe(true)
  })

  it('returns nothing for spinner-only output', () => {
    expect(readProgress('   -\r   \\\r   |\r')).toEqual({})
    expect(readProgress('')).toEqual({})
  })
})
