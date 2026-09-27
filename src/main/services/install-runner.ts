/**
 * Run a package manager's install or upgrade command and follow its progress.
 *
 * `execFile` (and `spawnTrackedLines`) kill the process when their timeout
 * fires. That is the wrong move for an install: killing winget or choco never
 * stops the installer they launched — it keeps running orphaned while the
 * caller reports a failure and retries on top of it — and killing a live MSI
 * or package transaction can leave the app half-updated. Here the wait limit
 * only ends the wait: the promise settles with `timedOut: true` and the
 * process is left to finish on its own, its remaining output drained and
 * discarded so it never blocks on a full pipe.
 *
 * On Windows, libuv puts every child it spawns in a kill-on-close job, so a
 * process left running still dies when the app exits — unless it was started
 * `detached`. Callers detach the tools that cope without a console (winget);
 * the others are listed by `waitForAttachedInstalls` so an exiting CLI can
 * wait for them instead of cancelling them.
 */

import { spawn, type ChildProcess } from 'child_process'
import type { Socket } from 'net'
import { ConsoleOutputDecoder } from './exec-utf8'

export interface InstallRun {
  /** Exit code; null when the process never exited in time or never started. */
  code: number | null
  stdout: string
  stderr: string
  /** The wait ran out (or was stopped). The process was left running. */
  timedOut: boolean
  /** Why the process could not be started (e.g. ENOENT). */
  error?: NodeJS.ErrnoException
  /** Process id, when it started. */
  pid?: number
  /** Settles once the process has exited: already for a finished run, later for one left running. */
  exited: Promise<void>
}

export interface InstallRunOptions {
  /** How long to wait for the process to exit before leaving it running. */
  waitLimitMs: number
  /** Receives each piece of decoded stdout as it arrives, until the run settles. */
  onOutput?: (text: string) => void
  /** Stops the wait early, exactly like the wait limit: the process is left running. */
  signal?: AbortSignal
  /** Start outside the app's lifetime, so a process left running survives the app exiting. */
  detached?: boolean
  windowsVerbatimArguments?: boolean
}

/** Retained output per stream; older text is dropped first. */
const MAX_OUTPUT = 10 * 1024 * 1024

/**
 * After the process exits, how long its output pipes get to close. A child it
 * launched (an installer) can inherit them and keep them open long after.
 */
const EXIT_DRAIN_MS = 1_000

/** Processes left running that still die with the app (not detached). */
const attachedLeftRunning = new Set<Promise<void>>()

/** Wait until every process left running that would die with the app has exited. */
export async function waitForAttachedInstalls(): Promise<void> {
  while (attachedLeftRunning.size > 0) await Promise.all([...attachedLeftRunning])
}

/** How many processes left running would die if the app exited now. */
export function attachedInstallCount(): number {
  return attachedLeftRunning.size
}

function keepTail(acc: string, text: string): string {
  const next = acc + text
  return next.length > MAX_OUTPUT ? next.slice(next.length - MAX_OUTPUT) : next
}

export function runInstallCommand(
  file: string,
  args: string[],
  opts: InstallRunOptions
): Promise<InstallRun> {
  return new Promise((resolve) => {
    let markExited: () => void = () => {}
    const exited = new Promise<void>((r) => (markExited = r))

    let child: ChildProcess
    try {
      child = spawn(file, args, {
        windowsHide: true,
        detached: opts.detached,
        windowsVerbatimArguments: opts.windowsVerbatimArguments
      })
    } catch (err) {
      markExited()
      resolve({
        code: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        error: err as NodeJS.ErrnoException,
        exited
      })
      return
    }

    const outDecoder = new ConsoleOutputDecoder()
    const errDecoder = new ConsoleOutputDecoder()
    let stdout = ''
    let stderr = ''
    let settled = false
    let drainTimer: NodeJS.Timeout | undefined

    const stopWaiting = (): void => {
      if (settled) return
      // Let the app exit without waiting on it; the listeners below keep
      // draining (and discarding) whatever it still prints.
      child.unref()
      ;(child.stdout as Socket | null)?.unref?.()
      ;(child.stderr as Socket | null)?.unref?.()
      if (!opts.detached) {
        attachedLeftRunning.add(exited)
        void exited.then(() => attachedLeftRunning.delete(exited))
      }
      finish({ code: null, timedOut: true })
    }

    const waitTimer = setTimeout(stopWaiting, opts.waitLimitMs)
    opts.signal?.addEventListener('abort', stopWaiting, { once: true })

    function finish(run: Pick<InstallRun, 'code' | 'timedOut' | 'error'>): void {
      if (settled) return
      settled = true
      clearTimeout(waitTimer)
      clearTimeout(drainTimer)
      opts.signal?.removeEventListener('abort', stopWaiting)
      resolve({ ...run, stdout, stderr, pid: child.pid, exited })
    }

    /** The process has finished: take what is left in the decoders, then settle. */
    const finishExited = (code: number | null): void => {
      if (settled) return
      const tail = outDecoder.end()
      if (tail) {
        stdout = keepTail(stdout, tail)
        opts.onOutput?.(tail)
      }
      stderr = keepTail(stderr, errDecoder.end())
      finish({ code, timedOut: false })
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return
      const text = outDecoder.write(chunk)
      if (!text) return
      stdout = keepTail(stdout, text)
      opts.onOutput?.(text)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (settled) return
      stderr = keepTail(stderr, errDecoder.write(chunk))
    })

    child.on('error', (error) => {
      markExited()
      finish({ code: null, timedOut: false, error })
    })
    child.on('exit', (code) => {
      markExited()
      if (settled) return
      drainTimer = setTimeout(() => finishExited(code), EXIT_DRAIN_MS)
    })
    child.on('close', (code) => {
      markExited()
      finishExited(code)
    })
  })
}

// ─── Progress readout ───────────────────────────────────────

const OSC_ESCAPE = /\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g
const CSI_ESCAPE = /\x1B\[[0-9;?]*[ -/]*[@-~]/g
const BAR_GLYPHS = /[█▓▒░]/g
const SPINNER_ONLY = /^[-\\|/\s]*$/
const SPINNER_PREFIX = /^[-\\|/]\s+(?=\S)/
const SIZE_READOUT = /^([\d.,]+)\s*(B|KB|MB|GB|TB)\s*\/\s*([\d.,]+)\s*(B|KB|MB|GB|TB)$/i
const PERCENT_READOUT = /^(\d{1,3}(?:[.,]\d+)?)\s*%$/
const URL = /\bhttps?:\/\/\S+/gi
const MAX_DETAIL = 160

const UNIT_BYTES: Record<string, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4
}

const toNumber = (s: string): number => parseFloat(s.replace(',', '.'))

/** Percentage shown by a progress readout, or undefined if it shows none. */
function readoutPercent(rest: string): number | undefined {
  const size = SIZE_READOUT.exec(rest)
  if (size) {
    const done = toNumber(size[1]) * UNIT_BYTES[size[2].toUpperCase()]
    const total = toNumber(size[3]) * UNIT_BYTES[size[4].toUpperCase()]
    if (!(total > 0)) return undefined
    return Math.max(0, Math.min(100, Math.round((done / total) * 100)))
  }
  const pct = PERCENT_READOUT.exec(rest)
  if (pct) return Math.max(0, Math.min(100, Math.round(toNumber(pct[1]))))
  return undefined
}

/**
 * What a package manager is doing right now, read from the tail of its
 * output: the latest status line, as the tool printed it (winget and choco
 * speak the user's language, so nothing here depends on English wording), and
 * the percentage of the progress bar drawn after it, if any. A bar followed
 * by a newer status line belongs to a finished step and is ignored.
 *
 * winget 1.29+ draws no bars or spinners into a pipe, only status lines;
 * older builds and choco still draw them.
 */
export function readProgress(output: string): { detail?: string; percent?: number } {
  const segments = output
    .replace(OSC_ESCAPE, '')
    .replace(CSI_ESCAPE, '')
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  let percent: number | undefined
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]
    if (SPINNER_ONLY.test(seg)) continue

    const rest = seg.replace(BAR_GLYPHS, '').trim()
    const isReadout = rest !== seg || SIZE_READOUT.test(rest) || PERCENT_READOUT.test(rest)
    if (isReadout) {
      // The newest readout that can be read wins: the very newest may have
      // been cut mid-write at a chunk boundary
      if (percent === undefined) percent = readoutPercent(rest)
      continue
    }

    // A spinner frame that carries a message: keep the message, not the glyph
    const detail = seg.replace(SPINNER_PREFIX, '').replace(URL, '').replace(/\s+/g, ' ').trim()
    if (!detail) continue
    const shown = detail.length > MAX_DETAIL ? detail.slice(0, MAX_DETAIL - 1) + '…' : detail
    return percent === undefined ? { detail: shown } : { detail: shown, percent }
  }
  return percent === undefined ? {} : { percent }
}
