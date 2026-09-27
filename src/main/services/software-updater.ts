import { execFile } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import type {
  PackageManagerName,
  PackageManagerStatus,
  UpdatableApp,
  UpToDateApp,
  UpdateCheckResult,
  UpdateProgress,
  UpdateRequestItem,
  UpdateResult,
  UpdateResultItem,
  UpdateSeverity,
  WindowsPackageManager
} from '../../shared/types'
import { isAdmin } from './elevation'
import { psUtf8 } from './exec-utf8'
import { readProgress, runInstallCommand, type InstallRun } from './install-runner'
import { getSettings } from './settings-store'

const execFileAsync = promisify(execFile)

/**
 * How long an upgrade is waited on. Large installers can legitimately take
 * well over ten minutes — an MSI costing thousands of files on a disk shared
 * with antivirus scanning, say. Once the limit passes the upgrade is reported
 * as still running and left alone: it is never killed or retried on top of
 * itself (see install-runner).
 */
const UPGRADE_WAIT_LIMIT = 30 * 60 * 1000

/**
 * How long a UAC prompt may wait for an answer. Until it is accepted nothing
 * is installing, so running out here is a failure, not "still installing".
 */
const ELEVATION_CONSENT_LIMIT = 5 * 60 * 1000

/** Printed by the elevation wrapper once Windows has started the elevated process. */
const ELEVATED_STARTED = 'SSC-ELEVATED-PROCESS-STARTED'

/** Outcome of upgrading one package. */
interface UpgradeOutcome {
  success: boolean
  error?: string
  /** Still running when the wait ran out; `exited` settles when it finally ends. */
  pending?: boolean
  exited?: Promise<void>
}

const stillRunning = (exited?: Promise<void>): UpgradeOutcome => ({
  success: false,
  pending: true,
  exited
})

const APPROVAL_NOT_GIVEN = 'Administrator approval was not given'

/** Receives a package manager's output as it streams in. */
type OutputSink = (text: string) => void

/** A step update read from a package manager's output. */
interface StepUpdate {
  detail?: string
  stepPercent?: number
  /** The attempt runs as administrator; Windows may be asking the user to approve it. */
  elevated?: boolean
}

/** Where an upgrade pipeline reports what it is doing. */
interface UpgradeReporter {
  /** Output of the attempt in progress, as it streams in. */
  output: OutputSink
  /** A new attempt starts: the previous attempt's status line no longer applies. */
  newAttempt: (elevated?: boolean) => void
}

/** Recent output kept for finding the latest status line behind the progress bars. */
const OUTPUT_TAIL = 8 * 1024

/**
 * Turn a package manager's streamed output into step updates: the latest
 * status line and progress-bar percentage, reported whenever either changes.
 * The percentage is a whole number, so a step sends at most ~100 updates.
 */
function followOutput(report: (step: StepUpdate) => void): UpgradeReporter {
  let tail = ''
  let lastDetail: string | undefined
  let lastPercent: number | undefined
  return {
    output: (text) => {
      tail += text
      if (tail.length > OUTPUT_TAIL) {
        // Drop the partial line the cut leaves at the front
        const cut = tail.slice(-OUTPUT_TAIL)
        const lineEnd = cut.search(/[\r\n]/)
        tail = lineEnd >= 0 ? cut.slice(lineEnd + 1) : cut
      }
      const read = readProgress(tail)
      // A tail holding only progress bars still belongs to the last status line
      const detail = read.detail ?? lastDetail
      const percent = read.percent
      if (detail === lastDetail && percent === lastPercent) return
      lastDetail = detail
      lastPercent = percent
      report({ detail, stepPercent: percent })
    },
    newAttempt: (elevated = false) => {
      tail = ''
      lastDetail = undefined
      lastPercent = undefined
      report(elevated ? { elevated: true } : {})
    }
  }
}

/**
 * Upgrades left running when the wait ran out, by manager, until their
 * process exits. While one runs, its manager is not started again: the same
 * package would install twice, and winget (like choco) runs one install at a
 * time, so any other package would only queue behind it — for the whole wait
 * — and then be reported as still running too.
 */
const stillInstalling = new Map<WindowsPackageManager, Map<string, string>>()

function rememberStillInstalling(
  manager: WindowsPackageManager,
  appId: string,
  name: string,
  exited: Promise<void>
): void {
  let apps = stillInstalling.get(manager)
  if (!apps) stillInstalling.set(manager, (apps = new Map()))
  apps.set(appId, name)
  void exited.then(() => {
    apps.delete(appId)
    if (apps.size === 0 && stillInstalling.get(manager) === apps) stillInstalling.delete(manager)
  })
}

/** Exported for tests: forget upgrades left running by earlier runs. */
export function resetStillInstalling(): void {
  stillInstalling.clear()
}

/**
 * Run `exe args` elevated through a UAC prompt and wait for it. The wrapper
 * prints a marker once Windows has started the elevated process, which tells
 * "waiting for the user to approve" apart from "installing": an unanswered
 * prompt is given up on after ELEVATION_CONSENT_LIMIT (`approved: false`),
 * an approved process gets the full UPGRADE_WAIT_LIMIT. The process's exit
 * code is passed through.
 */
async function runElevated(
  exe: string,
  args: string
): Promise<{ run: InstallRun; approved: boolean }> {
  // Escape single quotes for PowerShell single-quoted strings ('' is the escape for ')
  const safeExe = exe.replace(/'/g, "''")
  const safeArgs = args.replace(/'/g, "''")
  const consent = new AbortController()
  let approved = false
  let seen = ''
  const consentTimer = setTimeout(() => {
    if (!approved) consent.abort()
  }, ELEVATION_CONSENT_LIMIT)
  const run = await runInstallCommand(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      psUtf8(
        `$p = Start-Process '${safeExe}' -ArgumentList '${safeArgs}' -Verb RunAs -PassThru -WindowStyle Hidden; ` +
          `if (-not $p) { exit 1 }; $null = $p.Handle; [Console]::Out.WriteLine('${ELEVATED_STARTED}'); ` +
          `$p.WaitForExit(); exit $p.ExitCode`
      )
    ],
    {
      waitLimitMs: UPGRADE_WAIT_LIMIT,
      signal: consent.signal,
      onOutput: (text) => {
        if (approved) return
        seen += text
        approved = seen.includes(ELEVATED_STARTED)
        // Keep just enough to catch a marker split across chunks
        seen = seen.slice(-ELEVATED_STARTED.length)
      }
    }
  )
  clearTimeout(consentTimer)
  approved ||= run.stdout.includes(ELEVATED_STARTED)
  return { run: { ...run, stdout: run.stdout.replace(ELEVATED_STARTED, '') }, approved }
}

/** Display name for a requested package: the scan's name, else its id. */
function displayName(item: UpdateRequestItem): string {
  return item.name?.trim() || item.id
}

/**
 * Progress reporter for one package of a batch. Every event carries the
 * package's name and start time; `in-progress` events count the packages
 * finished before this one, the others count this one as finished too.
 */
function itemProgress(
  onProgress: (progress: UpdateProgress) => void,
  item: { appId: string; name: string },
  position: number,
  total: number
): (status: UpdateProgress['status'], step?: StepUpdate) => void {
  const startedAt = Date.now()
  return (status, step = {}) => {
    const finished = status === 'in-progress' ? position - 1 : position
    onProgress({
      phase: 'updating',
      current: position,
      total,
      currentApp: item.appId,
      currentAppName: item.name,
      percent: Math.round((finished / total) * 100),
      status,
      startedAt,
      ...(step.detail !== undefined ? { detail: step.detail } : {}),
      ...(step.stepPercent !== undefined ? { stepPercent: step.stepPercent } : {}),
      ...(step.elevated ? { elevated: true } : {})
    })
  }
}

export function cleanOutput(str: string): string {
  // Strip ANSI escape sequences
  let cleaned = str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
  // Handle \r (carriage return) used by spinners: for each line segment,
  // keep only the text after the last \r (since \r overwrites from the start).
  // Lines ending with \r\n produce a trailing empty part after split — use
  // the last non-empty part instead.
  cleaned = cleaned
    .split('\n')
    .map((line) => {
      const parts = line.split('\r')
      for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i].trim()) return parts[i]
      }
      return ''
    })
    .join('\n')
  return cleaned
}

export function computeSeverity(current: string, available: string): UpdateSeverity {
  const parse = (v: string): [number, number, number] | null => {
    const m = v.match(/^(\d+)\.(\d+)(?:\.(\d+))?/)
    if (!m) return null
    return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3] ?? '0')]
  }

  const c = parse(current)
  const a = parse(available)
  if (!c || !a) return 'unknown'

  if (a[0] > c[0]) return 'major'
  if (a[0] === c[0] && a[1] > c[1]) return 'minor'
  if (a[0] === c[0] && a[1] === c[1] && a[2] > c[2]) return 'patch'
  return 'unknown'
}

/**
 * Build an empty check result. `error` records why the scan produced nothing
 * (CLI missing, timed out, crashed) so the UI can distinguish "nothing is
 * outdated" from "we never got an answer" — see #462.
 */
function emptyResult(
  packageManagerAvailable: boolean,
  packageManagerName: PackageManagerName | null,
  error?: string
): UpdateCheckResult {
  return {
    apps: [],
    upToDate: [],
    totalCount: 0,
    majorCount: 0,
    minorCount: 0,
    patchCount: 0,
    packageManagerAvailable,
    packageManagerName,
    managers: packageManagerName
      ? [
          {
            name: packageManagerName,
            available: packageManagerAvailable,
            outdatedCount: 0,
            ...(error ? { error } : {})
          }
        ]
      : []
  }
}

/** Last non-empty line of a CLI's output, trimmed for display. */
function lastOutputLine(raw: string, fallback: string): string {
  const line = cleanOutput(raw).trim().split('\n').filter(Boolean).pop()?.trim() || fallback
  return line.length > 200 ? line.slice(0, 200) + '…' : line
}

/** Describe an execFile rejection: timeout, missing binary, or last output line. */
function describeExecError(err: any, fallback: string): string {
  if (err?.killed || err?.signal) return 'timed out'
  if (err?.code === 'ENOENT') return 'command not found'
  return lastOutputLine(err?.stderr || err?.stdout || err?.message || '', fallback)
}

/** Describe an install run that produced no verdict: missing binary, or last output line. */
function describeRunFailure(run: InstallRun, fallback: string): string {
  if (run.error?.code === 'ENOENT') return 'command not found'
  return lastOutputLine(run.stderr || run.stdout || run.error?.message || '', fallback)
}

/** Build a single-manager check result with derived counts + status. */
function buildResult(
  name: PackageManagerName,
  apps: UpdatableApp[],
  upToDate: UpToDateApp[],
  error?: string
): UpdateCheckResult {
  return {
    apps,
    upToDate,
    totalCount: apps.length,
    majorCount: apps.filter((a) => a.severity === 'major').length,
    minorCount: apps.filter((a) => a.severity === 'minor').length,
    patchCount: apps.filter((a) => a.severity === 'patch').length,
    packageManagerAvailable: true,
    packageManagerName: name,
    managers: [{ name, available: true, outdatedCount: apps.length, ...(error ? { error } : {}) }]
  }
}

/**
 * Strip a trailing version-like suffix from a display name.
 * Winget display names often include the installed version
 * (e.g. "HandBrake 1.11.0") because that is how the app registers in ARP.
 */
export function stripTrailingVersion(name: string): string {
  return name.replace(/\s+v?\d+[\d.]*\s*$/, '').trim()
}

// ─── Winget (Windows) ───────────────────────────────────────

/** A column of a winget table: its header text and start display column. */
interface WingetColumn {
  label: string
  start: number
}

/**
 * Codepoint ranges the console renders two cells wide (CJK, Hangul, kana,
 * fullwidth forms, emoji). Winget pads its table to display columns, so a
 * Japanese header like `名前  ID  バージョン` occupies far more terminal
 * columns than it does UTF-16 code units — slicing rows by string index would
 * shear every column after it.
 */
const WIDE_CHAR_RANGES: [number, number][] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd]
]

/** Terminal cells a single codepoint occupies: 0 (combining), 1, or 2. */
function charWidth(code: number): number {
  if (code >= 0x0300 && code <= 0x036f) return 0
  for (const [lo, hi] of WIDE_CHAR_RANGES) {
    if (code >= lo && code <= hi) return 2
  }
  return 1
}

/** Terminal cells a string occupies. */
export function displayWidth(text: string): number {
  let width = 0
  for (const ch of text) width += charWidth(ch.codePointAt(0) as number)
  return width
}

/**
 * Slice a line by *display* columns rather than string indexes. A wide
 * character straddling a boundary is kept with the column it starts in.
 */
export function sliceByDisplayColumns(line: string, startCol: number, endCol: number): string {
  let col = 0
  let out = ''
  for (const ch of line) {
    if (col >= endCol) break
    if (col >= startCol) out += ch
    col += charWidth(ch.codePointAt(0) as number)
  }
  return out
}

interface WingetTable {
  /** Column offsets, left to right, as laid out in the header line. */
  columns: WingetColumn[]
  /** Data rows (everything after the separator up to the first summary line). */
  rows: string[]
}

/**
 * English column headers, used to map columns by name when available. Winget
 * localises its headers (e.g. `Nome  ID  Versione  Disponibile  Origine` on
 * Italian systems), so non-English output falls back to positional columns —
 * the column order is fixed regardless of language. Matching only English
 * headers is what made #462 report "everything is up to date" on non-English
 * machines: the table was never found.
 */
const WINGET_COLUMN_NAMES = ['name', 'id', 'version', 'available', 'source'] as const
type WingetColumnName = (typeof WINGET_COLUMN_NAMES)[number]

/**
 * Locate the table in `winget upgrade` / `winget list` output without relying
 * on the language of the column headers. The header is the line immediately
 * above the first dashes-only separator, and columns start wherever a header
 * token starts. Rows stop at the first trailing summary line ("11 upgrades
 * available.", "7 packages have version numbers that cannot be determined.",
 * or their translations) — every summary line starts with a count and, unlike
 * a real row, has no single-token Id in the Id column.
 */
export function locateWingetTable(stdout: string, minColumns: number): WingetTable | null {
  const lines = cleanOutput(stdout).split(/\r?\n/)

  let separatorIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (/^-{3,}\s*$/.test(lines[i]) && lines[i - 1].trim()) {
      separatorIdx = i
      break
    }
  }
  if (separatorIdx === -1) return null

  const header = lines[separatorIdx - 1]
  const columns: WingetColumn[] = []
  for (const m of header.matchAll(/\S+/g)) {
    columns.push({ label: m[0], start: displayWidth(header.slice(0, m.index ?? 0)) })
  }
  if (columns.length < minColumns) return null

  const idStart = columns[1].start
  const idEnd = columns[2].start
  const rows: string[] = []
  for (let i = separatorIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    if (/^\d+\s/.test(line)) {
      const idCell = sliceByDisplayColumns(line, idStart, idEnd).trim()
      if (!idCell || /\s/.test(idCell) || /\.\s*$/.test(line)) break
    }
    rows.push(line)
  }
  return { columns, rows }
}

/**
 * Resolve each logical column's [start, end) range. English headers are
 * matched by name; anything else uses the fixed winget column order.
 */
function resolveWingetColumns(
  columns: WingetColumn[]
): Partial<Record<WingetColumnName, [number, number]>> {
  const ranges: Partial<Record<WingetColumnName, [number, number]>> = {}
  const rangeAt = (i: number): [number, number] => [
    columns[i].start,
    i + 1 < columns.length ? columns[i + 1].start : Number.MAX_SAFE_INTEGER
  ]

  // Only trust names when every header is a known English one — German, for
  // instance, keeps "Name"/"ID"/"Version" but localises the rest.
  const englishHeader = columns.every((c) =>
    WINGET_COLUMN_NAMES.includes(c.label.toLowerCase() as WingetColumnName)
  )
  for (let i = 0; i < columns.length; i++) {
    const key = englishHeader ? columns[i].label.toLowerCase() : WINGET_COLUMN_NAMES[i]
    if (WINGET_COLUMN_NAMES.includes(key as WingetColumnName)) {
      ranges[key as WingetColumnName] = rangeAt(i)
    }
  }
  return ranges
}

function cell(line: string, range: [number, number] | undefined): string {
  if (!range) return ''
  return sliceByDisplayColumns(line, range[0], range[1]).trim()
}

/** winget prefixes versions with "> " or "< " when the installed version is uncertain. */
function stripVersionMarker(version: string): string {
  return version.replace(/^[<>]\s+/, '')
}

export function parseWingetUpgradeOutput(stdout: string): UpdatableApp[] {
  // Name  Id  Version  Available  Source — all five are always present
  const table = locateWingetTable(stdout, 5)
  if (!table) return []
  const cols = resolveWingetColumns(table.columns)
  if (!cols.name || !cols.id || !cols.version || !cols.available || !cols.source) return []

  const apps: UpdatableApp[] = []
  for (const line of table.rows) {
    const name = cell(line, cols.name)
    const id = cell(line, cols.id)
    const version = stripVersionMarker(cell(line, cols.version))
    const available = stripVersionMarker(cell(line, cols.available))
    const source = cell(line, cols.source)

    // Package ids never contain whitespace — a "cell" that does is wrapped
    // prose from a footer we failed to recognise, not a package.
    if (!id || /\s/.test(id) || !version || !available) continue
    // When winget reports "< X" for the installed version and X matches the
    // available version, it cannot determine the real version — the app is
    // likely already up to date, so skip it.
    if (version === available) continue

    apps.push({
      id,
      name: stripTrailingVersion(name) || id,
      currentVersion: version,
      availableVersion: available,
      source: source || 'winget',
      severity: computeSeverity(version, available),
      selected: true
    })
  }
  return apps
}

export function parseWingetListOutput(stdout: string): UpToDateApp[] {
  // Name  Id  Version [Available] [Source] — the last two columns are only
  // present when at least one row has something to put in them.
  const table = locateWingetTable(stdout, 3)
  if (!table) return []
  const cols = resolveWingetColumns(table.columns)
  if (!cols.name || !cols.id || !cols.version) return []

  const apps: UpToDateApp[] = []
  for (const line of table.rows) {
    const name = cell(line, cols.name)
    const id = cell(line, cols.id)
    const version = stripVersionMarker(cell(line, cols.version))
    const source = cell(line, cols.source)

    if (!id || !version || version === 'Unknown') continue
    // Skip ARP entries (not real winget packages)
    if (id.startsWith('ARP\\')) continue

    apps.push({ id, name: stripTrailingVersion(name) || id, version, source: source || 'winget' })
  }
  return apps
}

/** Version component of an MSIX package folder (`Name_1.22.10_x64__hash`). */
function packageVersion(folder: string): string {
  return folder.split('_')[1] ?? ''
}

/** Compare dotted numeric versions; returns <0, 0 or >0 like a sort comparator. */
export function comparePackageVersions(a: string, b: string): number {
  const pa = a.split('.')
  const pb = b.split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (parseInt(pa[i] ?? '0', 10) || 0) - (parseInt(pb[i] ?? '0', 10) || 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * Places winget may live when it is not on PATH. Kudu runs elevated
 * (requireAdministrator); when UAC elevates under a different account than
 * the logged-in user, that account's PATH lacks the `WindowsApps` alias
 * directory and a bare `winget` fails with ENOENT even though the tool works
 * fine from the user's own terminal. The package directory under Program
 * Files is readable by administrators and holds the real executable.
 */
function wingetPathCandidates(): string[] {
  const candidates: string[] = []
  const localAppData = process.env.LOCALAPPDATA
  if (localAppData) {
    candidates.push(join(localAppData, 'Microsoft', 'WindowsApps', 'winget.exe'))
  }
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const windowsApps = join(programFiles, 'WindowsApps')
  try {
    // Highest version first so a stale side-by-side package is not picked.
    // Compare version components numerically — lexicographic ordering would
    // rank 1.9 above 1.10.
    const packages = readdirSync(windowsApps)
      .filter((d) => /^Microsoft\.DesktopAppInstaller_.*_8wekyb3d8bbwe$/i.test(d))
      .sort((a, b) => comparePackageVersions(packageVersion(b), packageVersion(a)))
    for (const pkg of packages) {
      candidates.push(join(windowsApps, pkg, 'winget.exe'))
    }
  } catch {
    // Not admin, or no Store packages installed
  }
  return candidates.filter((p) => existsSync(p))
}

/** Resolved winget executable, cached once a probe succeeds. */
let wingetExe: string | null = null

/**
 * Find a working winget executable: PATH first, then the known install
 * locations. Returns null when none of them respond to `--version`.
 */
export async function resolveWinget(): Promise<string | null> {
  if (wingetExe) return wingetExe
  for (const candidate of ['winget', ...wingetPathCandidates()]) {
    try {
      await execFileAsync(candidate, ['--version'], { timeout: 10_000, windowsHide: true })
      wingetExe = candidate
      return candidate
    } catch {
      // Try the next location
    }
  }
  return null
}

/** Exported for tests: forget the cached winget location. */
export function resetWingetCache(): void {
  wingetExe = null
}

/**
 * winget exit codes that mean "nothing to report" rather than "something went
 * wrong". Node surfaces the HRESULT as an unsigned 32-bit exit code.
 */
const WINGET_NOTHING_TO_DO_CODES = new Set([
  0x8a150014, // APPINSTALLER_CLI_ERROR_NO_APPLICATIONS_FOUND
  0x8a15002b // APPINSTALLER_CLI_ERROR_UPDATE_NOT_APPLICABLE
])

function isWingetNothingToDo(code: unknown): boolean {
  return typeof code === 'number' && WINGET_NOTHING_TO_DO_CODES.has(code >>> 0)
}

/**
 * The scan alone is fast, but winget refreshes stale source indexes first and
 * the msstore source in particular can take well over a minute on a slow
 * connection. A timeout here used to be reported as "everything is up to
 * date" (#462); it is now surfaced as an error instead, but give winget
 * enough time that it rarely comes to that.
 */
const WINGET_CHECK_TIMEOUT = 3 * 60 * 1000

async function checkForUpdatesWinget(): Promise<UpdateCheckResult> {
  const winget = await resolveWinget()
  if (!winget) {
    return emptyResult(false, 'winget', 'winget was not found or did not start')
  }

  let stdout: string
  // Set when winget did not finish cleanly. Whatever rows it managed to print
  // are still returned, but flagged: a table cut off by a timeout or a source
  // failure is not a complete answer.
  let scanError: string | undefined
  try {
    const result = await execFileAsync(
      winget,
      ['upgrade', '--accept-source-agreements', '--disable-interactivity'],
      { timeout: WINGET_CHECK_TIMEOUT, maxBuffer: 10 * 1024 * 1024, windowsHide: true }
    )
    stdout = result.stdout
  } catch (err: any) {
    // winget may exit with non-zero code even on success (e.g. 0x8A150014 = no updates)
    // but still produce valid output in stdout
    stdout = err?.stdout ?? ''
    if (!isWingetNothingToDo(err?.code)) {
      scanError = describeExecError(err, 'winget upgrade failed')
      if (locateWingetTable(stdout, 5) === null) return emptyResult(true, 'winget', scanError)
    }
  }

  const apps = parseWingetUpgradeOutput(stdout)

  // Also get the full list of winget-tracked apps to show "up to date" ones
  let upToDate: UpToDateApp[] = []
  try {
    let listStdout = ''
    try {
      const listResult = await execFileAsync(
        winget,
        ['list', '--source', 'winget', '--accept-source-agreements', '--disable-interactivity'],
        { timeout: WINGET_CHECK_TIMEOUT, maxBuffer: 10 * 1024 * 1024, windowsHide: true }
      )
      listStdout = listResult.stdout
    } catch (err: any) {
      if (err?.stdout) listStdout = err.stdout
    }
    if (listStdout) {
      const allApps = parseWingetListOutput(listStdout)
      const outdatedIds = new Set(apps.map((a) => a.id))
      upToDate = allApps.filter((a) => !outdatedIds.has(a.id))
    }
  } catch {
    // Non-critical — just skip the up-to-date list
  }

  return buildResult('winget', apps, upToDate, scanError)
}

const WINGET_UPGRADE_ARGS = [
  '--accept-source-agreements',
  '--accept-package-agreements',
  '--disable-interactivity',
  '--silent',
  '--include-unknown'
]

/**
 * Non-zero winget exit codes that still mean the upgrade went through. The
 * exit code is the source of truth: winget's output is localised, so matching
 * English text reported every upgrade on a non-English Windows as failed
 * (#475).
 */
const WINGET_UPGRADE_OK_CODES = new Set([
  0x8a150109, // APPINSTALLER_CLI_ERROR_INSTALL_REBOOT_REQUIRED_TO_FINISH
  0x8a15010b, // APPINSTALLER_CLI_ERROR_INSTALL_REBOOT_INITIATED
  // Nothing newer to install — typically the app was updated since the scan,
  // so the requested end state already holds
  0x8a15002b // APPINSTALLER_CLI_ERROR_UPDATE_NOT_APPLICABLE
])

function isWingetUpgradeOk(code: number): boolean {
  const unsigned = code >>> 0
  return unsigned === 0 || WINGET_UPGRADE_OK_CODES.has(unsigned)
}

const WINGET_TECH_MISMATCH = 0x8a15008e // APPINSTALLER_CLI_ERROR_UPDATE_INSTALL_TECHNOLOGY_MISMATCH
const WINGET_REQUIRES_ADMIN = 0x8a150019 // APPINSTALLER_CLI_ERROR_COMMAND_REQUIRES_ADMIN

/**
 * Failures that neither an elevated nor a forced retry can fix, with a message
 * to show in place of winget's (possibly localised) last output line.
 */
const WINGET_FINAL_FAILURES = new Map<number, string>([
  [
    WINGET_TECH_MISMATCH,
    'Installer type changed — uninstall this app manually then install the new version'
  ],
  [0x8a150056, 'The installer cannot run as administrator'],
  [0x8a15007d, 'Cannot update a per-user install from an administrator context'],
  [0x8a150101, 'The app is running — close it and try again'],
  [0x8a150102, 'Another installation is in progress — try again later'],
  [0x8a150103, 'Files are in use — close the app and try again'],
  [0x8a150105, 'Not enough disk space'],
  [0x8a150106, 'Not enough memory — close other apps and try again'],
  [0x8a150107, 'No network connection'],
  [0x8a15010a, 'Restart your PC, then try again'],
  [0x8a15010c, 'The installation was cancelled'],
  [0x8a15010e, 'A newer version is already installed'],
  [0x8a15010f, 'Blocked by organisation policy'],
  [0x8a150111, 'The app is in use by another application — close it and try again']
])

/** Readable messages for failures that are still worth retrying. */
const WINGET_FAILURE_MESSAGES = new Map<number, string>([
  [0x8a150014, 'Package not found in the winget sources'],
  [0x8a15010d, 'Another version of this app is already installed'],
  [0x8a150114, 'The installer does not support upgrading this app']
])

/**
 * English-only fallbacks, kept for older winget builds whose exit codes are
 * less reliable. Never the only signal: see WINGET_UPGRADE_OK_CODES.
 */
const SUCCESS_PATTERNS = [
  'successfully installed',
  'successfully upgraded',
  'installer succeeded',
  'no available upgrade'
]

const FAILURE_PATTERNS = [
  'installer failed',
  'no package found',
  'no applicable update',
  'another version of this application',
  'installer aborted',
  'install technology is different'
]

const ELEVATION_HINTS = [
  'access is denied',
  'administrator',
  'elevation',
  'requires admin',
  'run as admin',
  '0x80070005' // E_ACCESSDENIED
]

interface WingetAttempt {
  success: boolean
  output: string
  /** winget's exit code as an unsigned HRESULT; undefined if it never exited. */
  code?: number
  /** Still running when the wait ran out; winget and its installer were left alone. */
  timedOut?: boolean
  /** Settles when the process left running exits. */
  exited?: Promise<void>
}

/** Attempt a single winget upgrade, judged by exit code first. */
async function attemptWingetUpgrade(
  appId: string,
  extraArgs: string[] = [],
  onOutput?: OutputSink
): Promise<WingetAttempt> {
  // Validate appId format to prevent argument injection (e.g. --source flags)
  if (!/^[\w][\w.\-]{0,200}$/.test(appId)) {
    return { success: false, output: 'Invalid app ID format' }
  }
  const winget = (await resolveWinget()) ?? 'winget'
  const run = await runInstallCommand(
    winget,
    ['upgrade', appId, ...WINGET_UPGRADE_ARGS, ...extraArgs],
    // Detached so an install left running outlives the app: with --silent,
    // winget installs MSI packages in its own process, and killing it would
    // cancel the install. winget is fine without a console of its own.
    { waitLimitMs: UPGRADE_WAIT_LIMIT, onOutput, detached: process.platform === 'win32' }
  )
  if (run.timedOut) {
    return { success: false, output: run.stdout, timedOut: true, exited: run.exited }
  }
  if (run.code === null) {
    // Never started: there is no verdict to read
    return { success: false, output: run.stdout || describeRunFailure(run, 'Unknown error') }
  }
  const upgradeStdout = run.stdout
  const code = run.code >>> 0

  if (isWingetUpgradeOk(code)) {
    return { success: true, output: upgradeStdout, code }
  }

  const output = cleanOutput(upgradeStdout).toLowerCase()
  const wasSuccessful = SUCCESS_PATTERNS.some((p) => output.includes(p))
  const hasClearFailure = FAILURE_PATTERNS.some((p) => output.includes(p))
  return { success: wasSuccessful && !hasClearFailure, output: upgradeStdout, code }
}

function isFinalWingetFailure(result: WingetAttempt): boolean {
  if (result.code !== undefined && WINGET_FINAL_FAILURES.has(result.code)) return true
  return cleanOutput(result.output).toLowerCase().includes('install technology is different')
}

/**
 * Whether a failed upgrade is worth retrying elevated. Output text only helps
 * on an English system, so any failure without a known non-permission cause
 * qualifies — matching what the English "installer failed" hint used to do.
 */
function mightNeedElevation(result: WingetAttempt): boolean {
  const lowerOutput = cleanOutput(result.output).toLowerCase()
  if (ELEVATION_HINTS.some((h) => lowerOutput.includes(h))) return true
  if (FAILURE_PATTERNS.some((p) => lowerOutput.includes(p))) return true
  if (result.code === undefined) return false
  return result.code === WINGET_REQUIRES_ADMIN || !WINGET_FAILURE_MESSAGES.has(result.code)
}

/** User-facing reason for a failed upgrade: known cause first, then winget's last line. */
function describeWingetFailure(result: WingetAttempt): string {
  if (result.code !== undefined) {
    const known = WINGET_FINAL_FAILURES.get(result.code) ?? WINGET_FAILURE_MESSAGES.get(result.code)
    if (known) return known
  }
  const line = lastOutputLine(result.output, 'Upgrade failed')
  if (result.code === undefined) return line
  const hex = `0x${result.code.toString(16)}`
  return line.toLowerCase().includes(hex) ? line : `${line} (${hex})`
}

/** An elevated attempt; `approvalMissing` when the UAC prompt went unanswered. */
interface ElevatedAttempt {
  success: boolean
  output: string
  timedOut?: boolean
  exited?: Promise<void>
  approvalMissing?: boolean
}

/** Retry a failed upgrade with elevation using PowerShell Start-Process -Verb RunAs */
async function attemptElevatedUpgrade(appId: string): Promise<ElevatedAttempt> {
  // Validate appId format to prevent injection — winget IDs are alphanumeric with dots, dashes, underscores
  if (!/^[\w][\w.\-]{0,200}$/.test(appId)) {
    return { success: false, output: 'Invalid app ID format' }
  }

  try {
    const winget = (await resolveWinget()) ?? 'winget'
    const args = ['upgrade', appId, ...WINGET_UPGRADE_ARGS, '--force'].join(' ')
    const { run, approved } = await runElevated(winget, args)
    if (run.timedOut) {
      // Approved: the elevated winget outlived the wait and is still
      // installing, leave it be. Not approved: nothing was installed.
      return approved
        ? { success: false, output: '', timedOut: true, exited: run.exited }
        : { success: false, output: APPROVAL_NOT_GIVEN, approvalMissing: true }
    }
    // winget's exit code is passed through, so a reboot-pending success
    // lands here too — let the rescan below judge it. Anything else (a
    // denied UAC prompt included) is a failed attempt.
    if (run.code === null || !isWingetUpgradeOk(run.code)) {
      return { success: false, output: describeRunFailure(run, 'Elevated upgrade failed') }
    }
    const stdout = run.stdout
    // We can't reliably capture stdout from the elevated process, so verify
    // by checking if winget still lists this app as upgradeable
    let checkStdout: string
    try {
      const checkResult = await execFileAsync(
        winget,
        ['upgrade', '--accept-source-agreements', '--disable-interactivity', '--include-unknown'],
        { timeout: WINGET_CHECK_TIMEOUT, maxBuffer: 10 * 1024 * 1024, windowsHide: true }
      )
      checkStdout = checkResult.stdout
    } catch (err: any) {
      // With nothing left to upgrade winget exits non-zero — that is the success case
      if (!isWingetNothingToDo(err?.code)) throw err
      checkStdout = err?.stdout ?? ''
    }
    const stillNeedsUpgrade = checkStdout.includes(appId)
    return {
      success: !stillNeedsUpgrade,
      output: stillNeedsUpgrade ? 'App still needs upgrade after elevated attempt' : stdout
    }
  } catch (err: any) {
    // The verifying rescan failed
    return { success: false, output: err?.message || 'Elevated upgrade failed' }
  }
}

/**
 * Run a single app through the winget upgrade pipeline: normal → elevated →
 * force. An attempt still running when the wait runs out ends the pipeline:
 * a retry would start a second install on top of the one in progress. So
 * does an unanswered UAC prompt, which could still be accepted later.
 */
async function upgradeAppWinget(
  appId: string,
  alreadyAdmin: boolean,
  reporter?: UpgradeReporter
): Promise<UpgradeOutcome> {
  // First attempt: normal upgrade
  const result = await attemptWingetUpgrade(appId, [], reporter?.output)
  if (result.success) return { success: true }
  if (result.timedOut) return stillRunning(result.exited)

  // Installer technology changed, app in use, no network…: retrying can't help
  if (isFinalWingetFailure(result)) {
    return { success: false, error: describeWingetFailure(result) }
  }

  // If not already admin, retry with elevation
  if (!alreadyAdmin && mightNeedElevation(result)) {
    reporter?.newAttempt(true)
    const elevated = await attemptElevatedUpgrade(appId)
    if (elevated.success) return { success: true }
    if (elevated.timedOut) return stillRunning(elevated.exited)
    if (elevated.approvalMissing) return { success: false, error: APPROVAL_NOT_GIVEN }
  }

  // If still failed, retry once with --force (handles version mismatch issues)
  reporter?.newAttempt()
  const retryResult = await attemptWingetUpgrade(appId, ['--force'], reporter?.output)
  if (retryResult.success) return { success: true }
  if (retryResult.timedOut) return stillRunning(retryResult.exited)

  // Report the first attempt: the retries' output is less specific
  return { success: false, error: describeWingetFailure(result) }
}

// ─── Chocolatey (Windows) ──────────────────────────────────

/** Chocolatey package ID: alphanumeric, dots, hyphens, underscores */
const CHOCO_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,200}$/

async function isChocoAvailable(): Promise<boolean> {
  try {
    await execFileAsync('choco', ['--version'], {
      timeout: 10_000,
      windowsHide: true
    })
    return true
  } catch {
    return false
  }
}

/**
 * Parse `choco outdated --limit-output` output.
 * Format: packageId|currentVersion|availableVersion|pinned
 */
export function parseChocoOutdatedOutput(stdout: string): UpdatableApp[] {
  const apps: UpdatableApp[] = []
  for (const line of cleanOutput(stdout).split(/\r?\n/)) {
    if (!line.trim()) continue
    const parts = line.split('|')
    if (parts.length < 4) continue
    const [id, currentVersion, availableVersion, pinned] = parts
    if (!id || !currentVersion || !availableVersion) continue
    // Skip pinned packages
    if (pinned?.trim().toLowerCase() === 'true') continue
    // Skip if versions match (already up to date)
    if (currentVersion.trim() === availableVersion.trim()) continue
    apps.push({
      id: id.trim(),
      name: id.trim(),
      currentVersion: currentVersion.trim(),
      availableVersion: availableVersion.trim(),
      source: 'choco',
      severity: computeSeverity(currentVersion.trim(), availableVersion.trim()),
      selected: true
    })
  }
  return apps
}

/**
 * Parse `choco list --limit-output` output.
 * Format: packageId|version
 */
export function parseChocoListOutput(stdout: string): UpToDateApp[] {
  const apps: UpToDateApp[] = []
  for (const line of cleanOutput(stdout).split(/\r?\n/)) {
    if (!line.trim()) continue
    const parts = line.split('|')
    if (parts.length < 2) continue
    const [id, version] = parts
    if (!id || !version) continue
    apps.push({ id: id.trim(), name: id.trim(), version: version.trim(), source: 'choco' })
  }
  return apps
}

async function checkForUpdatesChoco(): Promise<UpdateCheckResult> {
  const available = await isChocoAvailable()
  if (!available) {
    return emptyResult(false, 'choco')
  }

  try {
    let stdout = ''
    try {
      const result = await execFileAsync('choco', ['outdated', '--limit-output'], {
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true
      })
      stdout = result.stdout
    } catch (err: any) {
      if (err?.stdout) {
        stdout = err.stdout
      } else {
        return emptyResult(true, 'choco')
      }
    }

    const apps = parseChocoOutdatedOutput(stdout)

    // Get the full list of installed packages to show "up to date" ones
    let upToDate: UpToDateApp[] = []
    try {
      let listStdout = ''
      try {
        const listResult = await execFileAsync('choco', ['list', '--limit-output'], {
          timeout: 60_000,
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true
        })
        listStdout = listResult.stdout
      } catch (err: any) {
        if (err?.stdout) listStdout = err.stdout
      }
      if (listStdout) {
        const allApps = parseChocoListOutput(listStdout)
        const outdatedIds = new Set(apps.map((a) => a.id))
        upToDate = allApps.filter((a) => !outdatedIds.has(a.id))
      }
    } catch {
      // Non-critical — just skip the up-to-date list
    }

    return buildResult('choco', apps, upToDate)
  } catch {
    return emptyResult(true, 'choco')
  }
}

const CHOCO_SUCCESS_PATTERNS = ['was successful', 'has been successfully', 'upgraded 1/']

const CHOCO_FAILURE_PATTERNS = [
  'was not successful',
  'not installed',
  'cannot find path',
  'unable to find'
]

const CHOCO_ELEVATION_HINTS = [
  'access to the path',
  'access is denied',
  'administrator',
  'run as admin',
  'elevated permissions'
]

interface ChocoAttempt {
  success: boolean
  output: string
  /** Still running when the wait ran out; choco was left alone. */
  timedOut?: boolean
  /** Settles when the process left running exits. */
  exited?: Promise<void>
  /** The UAC prompt of an elevated attempt went unanswered. */
  approvalMissing?: boolean
}

/** Attempt a single choco upgrade and return {success, output} */
async function attemptChocoUpgrade(
  appId: string,
  extraArgs: string[] = [],
  onOutput?: OutputSink
): Promise<ChocoAttempt> {
  if (!CHOCO_ID_PATTERN.test(appId)) {
    return { success: false, output: 'Invalid package ID format' }
  }
  // Note: no --limit-output here — verbose output is needed for success/failure pattern detection.
  // Not detached: choco prints nothing at all without a console of its own.
  const run = await runInstallCommand('choco', ['upgrade', appId, '-y', ...extraArgs], {
    waitLimitMs: UPGRADE_WAIT_LIMIT,
    onOutput
  })
  if (run.timedOut) {
    return { success: false, output: run.stdout, timedOut: true, exited: run.exited }
  }
  const upgradeStdout = run.stdout
  if (!upgradeStdout) return { success: false, output: describeRunFailure(run, 'Unknown error') }

  const output = cleanOutput(upgradeStdout).toLowerCase()
  const wasSuccessful = CHOCO_SUCCESS_PATTERNS.some((p) => output.includes(p))
  const hasClearFailure = CHOCO_FAILURE_PATTERNS.some((p) => output.includes(p))

  if (wasSuccessful && !hasClearFailure) {
    return { success: true, output: upgradeStdout }
  }
  return { success: false, output: upgradeStdout }
}

/** Retry a failed choco upgrade with elevation using PowerShell Start-Process -Verb RunAs */
async function attemptElevatedChocoUpgrade(appId: string): Promise<ChocoAttempt> {
  if (!CHOCO_ID_PATTERN.test(appId)) {
    return { success: false, output: 'Invalid package ID format' }
  }

  try {
    const args = ['upgrade', appId, '-y', '--force'].join(' ')
    const { run, approved } = await runElevated('choco', args)
    if (run.timedOut) {
      // Approved: the elevated choco outlived the wait and is still
      // upgrading, leave it be. Not approved: nothing was installed.
      return approved
        ? { success: false, output: '', timedOut: true, exited: run.exited }
        : { success: false, output: APPROVAL_NOT_GIVEN, approvalMissing: true }
    }
    if (run.code !== 0) {
      return { success: false, output: describeRunFailure(run, 'Elevated upgrade failed') }
    }
    // Verify by checking if choco still lists this app as outdated
    const checkResult = await execFileAsync('choco', ['outdated', '--limit-output'], {
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    })
    const stillNeedsUpgrade = checkResult.stdout
      .split(/\r?\n/)
      .some((line) => line.startsWith(appId + '|'))
    return {
      success: !stillNeedsUpgrade,
      output: stillNeedsUpgrade
        ? 'Package still needs upgrade after elevated attempt'
        : 'Elevated upgrade succeeded'
    }
  } catch (err: any) {
    return { success: false, output: err?.message || 'Elevated upgrade failed' }
  }
}

/**
 * Run a single app through the choco upgrade pipeline: normal → elevated →
 * force. As with winget, an attempt still running when the wait runs out is
 * left alone rather than retried, and so is an unanswered UAC prompt.
 */
async function upgradeAppChoco(
  appId: string,
  alreadyAdmin: boolean,
  reporter?: UpgradeReporter
): Promise<UpgradeOutcome> {
  // First attempt: normal upgrade
  let result = await attemptChocoUpgrade(appId, [], reporter?.output)
  if (result.timedOut) return stillRunning(result.exited)

  // If failed and not already admin, check for elevation hints before prompting
  if (!result.success && !alreadyAdmin) {
    const lowerOutput = cleanOutput(result.output).toLowerCase()
    const looksLikeElevationIssue =
      CHOCO_ELEVATION_HINTS.some((h) => lowerOutput.includes(h)) ||
      CHOCO_FAILURE_PATTERNS.some((p) => lowerOutput.includes(p))

    if (looksLikeElevationIssue) {
      reporter?.newAttempt(true)
      result = await attemptElevatedChocoUpgrade(appId)
      if (result.timedOut) return stillRunning(result.exited)
      if (result.approvalMissing) return { success: false, error: APPROVAL_NOT_GIVEN }
    }
  }

  // If still failed, retry once with --force (handles version mismatch issues)
  if (!result.success) {
    reporter?.newAttempt()
    const retryResult = await attemptChocoUpgrade(appId, ['--force'], reporter?.output)
    if (retryResult.timedOut) return stillRunning(retryResult.exited)
    if (retryResult.success) result = retryResult
  }

  if (result.success) return { success: true }

  const lastLine = cleanOutput(result.output).trim().split('\n').pop() || 'Upgrade failed'
  return {
    success: false,
    error: lastLine.length > 200 ? lastLine.slice(0, 200) + '...' : lastLine
  }
}

// ─── Shim runner (scoop / npm) ─────────────────────────────

/**
 * Run a `.cmd` shim tool (scoop, npm) via cmd.exe.
 *
 * These tools ship as `.cmd`/`.ps1` shims, not native `.exe`, so `execFile`
 * can't resolve a bare name. We route through `cmd.exe` rather than
 * `powershell.exe` on purpose: PowerShell command resolution can pick the
 * `.ps1` shim (npm.ps1 / scoop.ps1), which fails under the default
 * Restricted / AllSigned execution policy before the tool ever runs. cmd.exe
 * resolves the `.cmd` shim via PATHEXT (which excludes `.ps1`), and those
 * shims invoke PowerShell with their own bypass, so they work regardless of
 * the machine's execution policy.
 *
 * `chcp 65001` forces UTF-8 output. Callers MUST validate any dynamic argument
 * (app id) against the tool's id pattern first; shim ids contain no cmd.exe
 * metacharacters, so building the command line is safe.
 */
async function runShim(tool: 'scoop' | 'npm', args: string[], timeout = 60_000): Promise<string> {
  const cmdLine = `chcp 65001>nul && ${tool} ${args.join(' ')}`
  const { stdout } = await execFileAsync('cmd.exe', ['/d', '/v:off', '/s', '/c', cmdLine], {
    timeout,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
    windowsVerbatimArguments: true
  })
  return stdout
}

// ─── Scoop (Windows) ────────────────────────────────────────

/** Scoop app name: lowercase alphanumeric, hyphens, dots, underscores, plus */
const SCOOP_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,200}$/

const runScoop = (args: string[], timeout = 60_000): Promise<string> =>
  runShim('scoop', args, timeout)

async function isScoopAvailable(): Promise<boolean> {
  try {
    const out = await runScoop(['--version'], 15_000)
    // scoop --version prints its git revision; any non-empty output means it ran
    return out.trim().length > 0
  } catch {
    return false
  }
}

/**
 * Parse `scoop status` table output.
 * Columns: Name | Installed Version | Latest Version | Missing Dependencies | Info
 * Version strings never contain spaces, so the "Latest Version" cell is read as
 * its first whitespace-delimited token — robust against trailing columns.
 */
export function parseScoopStatus(stdout: string): UpdatableApp[] {
  const lines = cleanOutput(stdout).split(/\r?\n/)

  let headerIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (/Installed Version/i.test(lines[i]) && /Latest Version/i.test(lines[i])) {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) return []

  const header = lines[headerIdx]
  const installedStart = header.indexOf('Installed Version')
  const latestStart = header.indexOf('Latest Version')
  if (installedStart < 0 || latestStart < 0) return []

  let start = headerIdx + 1
  // Skip the dashes separator row that Format-Table emits under the header
  if (start < lines.length && /^[-\s]+$/.test(lines[start])) start++

  const apps: UpdatableApp[] = []
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue

    const name = line.substring(0, installedStart).trim()
    const currentVersion = line.substring(installedStart, latestStart).trim()
    const availableVersion = line.substring(latestStart).trim().split(/\s+/)[0] ?? ''

    if (!name || !availableVersion) continue
    if (currentVersion === availableVersion) continue

    apps.push({
      id: name,
      name,
      currentVersion,
      availableVersion,
      source: 'scoop',
      severity: computeSeverity(currentVersion, availableVersion),
      selected: true
    })
  }
  return apps
}

/**
 * Parse `scoop export` JSON into the installed list.
 * Modern scoop emits `{ apps: [{ Name, Version, Source }] }`; some builds emit a
 * bare array. Both shapes are handled; anything else yields an empty list.
 */
export function parseScoopExport(stdout: string): UpToDateApp[] {
  let data: unknown
  try {
    data = JSON.parse(stdout)
  } catch {
    return []
  }

  const entries: any[] = Array.isArray(data)
    ? data
    : Array.isArray((data as any)?.apps)
      ? (data as any).apps
      : []

  const apps: UpToDateApp[] = []
  for (const entry of entries) {
    const name = entry?.Name ?? entry?.name
    const version = entry?.Version ?? entry?.version ?? ''
    if (!name) continue
    apps.push({ id: name, name, version, source: 'scoop' })
  }
  return apps
}

async function checkForUpdatesScoop(): Promise<UpdateCheckResult> {
  if (!(await isScoopAvailable())) return emptyResult(false, 'scoop')

  try {
    // Refresh bucket manifests first. `scoop status` compares installed
    // versions against the *local* bucket checkout, so a stale checkout reports
    // apps as up to date even when newer versions exist. `scoop update` with no
    // app argument only updates Scoop and its buckets — it never upgrades an
    // installed app — so it's safe to run during a read-only check. Best-effort:
    // if the refresh fails (offline, etc.) we still read whatever status we can.
    try {
      await runScoop(['update'], 120_000)
    } catch {
      // Bucket refresh failed — fall through and read status against local manifests.
    }

    // `scoop status` compares installed versions against the refreshed manifests
    let statusStdout = ''
    try {
      statusStdout = await runScoop(['status'], 120_000)
    } catch (err: any) {
      if (err?.stdout) statusStdout = err.stdout
      else return emptyResult(true, 'scoop')
    }

    const apps = parseScoopStatus(statusStdout)

    let upToDate: UpToDateApp[] = []
    try {
      const exportStdout = await runScoop(['export'], 60_000)
      const allApps = parseScoopExport(exportStdout)
      const outdatedIds = new Set(apps.map((a) => a.id))
      upToDate = allApps.filter((a) => !outdatedIds.has(a.id))
    } catch {
      // Non-critical — just skip the up-to-date list
    }

    return buildResult('scoop', apps, upToDate)
  } catch {
    return emptyResult(true, 'scoop')
  }
}

const truncateError = (msg: string): string => (msg.length > 200 ? msg.slice(0, 200) + '...' : msg)

/**
 * Decide whether a `scoop update` succeeded from its output and exit status.
 * Exported for tests. `nonZeroExit` is true when scoop exited nonzero (stdout
 * may still carry progress). Ambiguous output is only assumed successful on a
 * clean exit — a nonzero exit with no explicit success marker is a failure, so
 * a broken update can't be masked by partial progress output. Exported for tests.
 */
export function classifyScoopUpdate(
  output: string,
  nonZeroExit: boolean,
  stderrMsg = ''
): { success: boolean; error?: string } {
  const cleaned = cleanOutput(output)
  const lower = cleaned.toLowerCase()
  // scoop prints "'app' was updated" / "was installed" on success; "is already
  // installed" means it's up to date (also a success from the user's view)
  if (/(was updated|was installed|is already installed|latest version)/.test(lower)) {
    return { success: true }
  }
  if (/error|failed|couldn't|could not/.test(lower)) {
    return {
      success: false,
      error: truncateError(cleaned.trim().split('\n').pop() || 'Update failed')
    }
  }
  // Nonzero exit with no explicit success marker → treat as a failure rather
  // than letting ambiguous progress output mask it. stderr is the best signal.
  if (nonZeroExit) {
    return {
      success: false,
      error: truncateError(stderrMsg || cleaned.trim().split('\n').pop() || 'Update failed')
    }
  }
  // Clean exit with ambiguous output — assume success
  return { success: true }
}

/** Attempt a single `scoop update <app>` */
async function upgradeAppScoop(appId: string): Promise<{ success: boolean; error?: string }> {
  if (!SCOOP_ID_PATTERN.test(appId)) {
    return { success: false, error: 'Invalid app name format' }
  }
  let output = ''
  let nonZeroExit = false
  let stderrMsg = ''
  try {
    output = await runScoop(['update', appId], 10 * 60 * 1000)
  } catch (err: any) {
    // A nonzero exit still often carries useful progress on stdout; keep it,
    // but remember the failure and preserve stderr for diagnostics.
    nonZeroExit = true
    stderrMsg = err?.stderr ? cleanOutput(err.stderr).trim() : ''
    if (err?.stdout) output = err.stdout
    else return { success: false, error: stderrMsg || err?.message || 'Unknown error' }
  }

  return classifyScoopUpdate(output, nonZeroExit, stderrMsg)
}

// ─── npm global (Windows) ───────────────────────────────────

/** npm package name incl. scoped (@scope/name); npm enforces the rest */
const NPM_ID_PATTERN = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]{0,200}$/i

const runNpm = (args: string[], timeout = 60_000): Promise<string> => runShim('npm', args, timeout)

async function isNpmAvailable(): Promise<boolean> {
  try {
    const out = await runNpm(['--version'], 15_000)
    return /\d+\.\d+/.test(out)
  } catch {
    return false
  }
}

/**
 * Parse `npm outdated -g --json` output.
 * Shape: `{ "pkg": { "current": "1.0.0", "wanted": "1.2.0", "latest": "2.0.0" } }`
 */
export function parseNpmOutdated(stdout: string): UpdatableApp[] {
  let data: Record<string, { current?: string; wanted?: string; latest?: string }>
  try {
    data = JSON.parse(stdout)
  } catch {
    return []
  }
  if (!data || typeof data !== 'object') return []

  const apps: UpdatableApp[] = []
  for (const [name, info] of Object.entries(data)) {
    const current = info?.current ?? ''
    const available = info?.latest ?? info?.wanted ?? ''
    if (!available) continue
    if (current && current === available) continue
    apps.push({
      id: name,
      name,
      currentVersion: current || '—',
      availableVersion: available,
      source: 'npm',
      severity: computeSeverity(current, available),
      selected: true
    })
  }
  return apps
}

/**
 * Parse `npm ls -g --depth=0 --json` output into the installed list.
 * Shape: `{ "dependencies": { "pkg": { "version": "1.0.0" } } }`
 */
export function parseNpmListGlobal(stdout: string): UpToDateApp[] {
  let data: { dependencies?: Record<string, { version?: string }> }
  try {
    data = JSON.parse(stdout)
  } catch {
    return []
  }
  const deps = data?.dependencies
  if (!deps || typeof deps !== 'object') return []

  const apps: UpToDateApp[] = []
  for (const [name, info] of Object.entries(deps)) {
    apps.push({ id: name, name, version: info?.version ?? '', source: 'npm' })
  }
  return apps
}

async function checkForUpdatesNpm(): Promise<UpdateCheckResult> {
  if (!(await isNpmAvailable())) return emptyResult(false, 'npm')

  try {
    // `npm outdated` exits non-zero when packages are outdated, but still
    // emits JSON on stdout — recover it from the error like the other managers.
    let outdatedStdout = ''
    try {
      outdatedStdout = await runNpm(['outdated', '-g', '--json'], 90_000)
    } catch (err: any) {
      outdatedStdout = err?.stdout ?? ''
    }

    const apps = parseNpmOutdated(outdatedStdout)

    let upToDate: UpToDateApp[] = []
    try {
      let listStdout = ''
      try {
        listStdout = await runNpm(['ls', '-g', '--depth=0', '--json'], 60_000)
      } catch (err: any) {
        // npm ls exits non-zero on peer-dep warnings but still prints JSON
        listStdout = err?.stdout ?? ''
      }
      const allApps = parseNpmListGlobal(listStdout)
      const outdatedIds = new Set(apps.map((a) => a.id))
      upToDate = allApps.filter((a) => !outdatedIds.has(a.id))
    } catch {
      // Non-critical — just skip the up-to-date list
    }

    return buildResult('npm', apps, upToDate)
  } catch {
    return emptyResult(true, 'npm')
  }
}

/** Attempt a single `npm install -g <pkg>@latest` */
async function upgradeAppNpm(appId: string): Promise<{ success: boolean; error?: string }> {
  if (!NPM_ID_PATTERN.test(appId)) {
    return { success: false, error: 'Invalid package name format' }
  }
  try {
    await runNpm(['install', '-g', `${appId}@latest`], 10 * 60 * 1000)
    return { success: true }
  } catch (err: any) {
    const output = cleanOutput(err?.stderr || err?.stdout || err?.message || 'Unknown error')
    const lastLine = output.trim().split('\n').pop() || 'Update failed'
    return {
      success: false,
      error: lastLine.length > 200 ? lastLine.slice(0, 200) + '...' : lastLine
    }
  }
}

// ─── Windows: aggregation dispatcher ───────────────────────

const WINDOWS_MANAGERS: WindowsPackageManager[] = ['winget', 'choco', 'scoop', 'npm']

const WINDOWS_CHECKERS: Record<WindowsPackageManager, () => Promise<UpdateCheckResult>> = {
  winget: checkForUpdatesWinget,
  choco: checkForUpdatesChoco,
  scoop: checkForUpdatesScoop,
  npm: checkForUpdatesNpm
}

/** Managers the user has enabled for aggregation (all supported when unset). */
function enabledWindowsManagers(): WindowsPackageManager[] {
  const configured = getSettings().windowsPackageManagers
  if (!configured || configured.length === 0) return WINDOWS_MANAGERS
  return WINDOWS_MANAGERS.filter((m) => configured.includes(m))
}

/**
 * Scan every enabled Windows manager concurrently and merge the results into a
 * single list. Each app keeps its `source`, so it can be routed back to its
 * owning manager on update (UniGetUI-style aggregation).
 */
async function checkForUpdatesWindows(): Promise<UpdateCheckResult> {
  const enabled = enabledWindowsManagers()
  const results = await Promise.all(
    enabled.map((m) =>
      WINDOWS_CHECKERS[m]().catch((err) =>
        emptyResult(false, m, describeExecError(err, `${m} check failed`))
      )
    )
  )

  const apps = results.flatMap((r) => r.apps)
  const upToDate = results.flatMap((r) => r.upToDate)
  const managers: PackageManagerStatus[] = results.map((r, i) => {
    const error = r.managers[0]?.error
    return {
      name: enabled[i],
      available: r.packageManagerAvailable,
      outdatedCount: r.apps.length,
      ...(error ? { error } : {})
    }
  })

  return {
    apps,
    upToDate,
    totalCount: apps.length,
    majorCount: apps.filter((a) => a.severity === 'major').length,
    minorCount: apps.filter((a) => a.severity === 'minor').length,
    patchCount: apps.filter((a) => a.severity === 'patch').length,
    packageManagerAvailable: managers.some((m) => m.available),
    packageManagerName: managers.find((m) => m.available)?.name ?? null,
    managers
  }
}

/**
 * Upgrade a single package with the pipeline appropriate to its manager.
 * winget and choco report their progress to `reporter`; the shim tools do not.
 */
function upgradeWindowsApp(
  source: WindowsPackageManager,
  appId: string,
  alreadyAdmin: boolean,
  reporter?: UpgradeReporter
): Promise<UpgradeOutcome> {
  switch (source) {
    case 'winget':
      return upgradeAppWinget(appId, alreadyAdmin, reporter)
    case 'choco':
      return upgradeAppChoco(appId, alreadyAdmin, reporter)
    case 'scoop':
      return upgradeAppScoop(appId)
    case 'npm':
      return upgradeAppNpm(appId)
  }
}

/**
 * Group Windows update items by their routing manager, preserving a stable
 * manager order. Each entry keeps its *original* source so failures can be
 * reported under the source the renderer keyed the row by: a winget-owned
 * package from a non-manager source (e.g. `msstore`) routes through winget but
 * must be reported as `msstore`, or the renderer's `source␟id` lookup won't
 * match it. Exported for tests.
 */
export function groupWindowsUpdateItems(
  items: UpdateRequestItem[]
): Map<WindowsPackageManager, Array<{ id: string; source: string; name: string }>> {
  const groups = new Map<
    WindowsPackageManager,
    Array<{ id: string; source: string; name: string }>
  >()
  for (const item of items) {
    const manager = WINDOWS_MANAGERS.includes(item.source as WindowsPackageManager)
      ? (item.source as WindowsPackageManager)
      : 'winget' // default routing for un-tagged / winget-owned sources (msstore, etc.)
    const list = groups.get(manager) ?? []
    list.push({ id: item.id, source: item.source || manager, name: displayName(item) })
    groups.set(manager, list)
  }
  return groups
}

/**
 * Update packages spanning multiple managers. Items are grouped by their
 * `source`, then each manager's packages are upgraded in turn while a single
 * progress stream is reported across the whole batch.
 */
async function runUpdatesWindows(
  items: UpdateRequestItem[],
  onProgress: (progress: UpdateProgress) => void
): Promise<UpdateResult> {
  const alreadyAdmin = isAdmin()
  const total = items.length
  let position = 0
  const updated: UpdateResultItem[] = []
  const pending: UpdateResultItem[] = []
  const errors: UpdateResult['errors'] = []

  const groups = groupWindowsUpdateItems(items)

  for (const manager of WINDOWS_MANAGERS) {
    const entries = groups.get(manager)
    if (!entries?.length) continue

    for (const { id: appId, source, name } of entries) {
      position++
      const item: UpdateResultItem = { appId, name, source }
      const report = itemProgress(onProgress, item, position, total)

      // An upgrade of this manager left running (by this run or an earlier
      // one) is still going: never start the same package twice, and don't
      // queue others behind it
      const running = stillInstalling.get(manager)
      if (running?.has(appId)) {
        pending.push(item)
        report('pending')
        continue
      }
      if (running?.size) {
        const blocker = running.values().next().value
        errors.push({
          ...item,
          reason: `Not started: ${blocker} is still installing — update again once it finishes`
        })
        report('failed')
        continue
      }

      report('in-progress')
      const result = await upgradeWindowsApp(
        manager,
        appId,
        alreadyAdmin,
        followOutput((step) => report('in-progress', step))
      )

      if (result.success) {
        updated.push(item)
        report('done')
      } else if (result.pending) {
        pending.push(item)
        if (result.exited) rememberStillInstalling(manager, appId, name, result.exited)
        report('pending')
      } else {
        errors.push({ ...item, reason: result.error || 'Upgrade failed' })
        report('failed')
      }
    }
  }

  return { succeeded: updated.length, failed: errors.length, updated, pending, errors }
}

// ─── Homebrew (macOS) ───────────────────────────────────────

/** Brew formula/cask name: lowercase alphanumeric, hyphens, dots, underscores, optional tap prefix */
const BREW_ID_PATTERN = /^[a-z0-9][a-z0-9@._+-]*(\/[a-z0-9][a-z0-9@._+-]*)?$/

interface BrewOutdatedFormula {
  name: string
  installed_versions: string[]
  current_version: string
}

interface BrewOutdatedCask {
  name: string
  token: string
  installed_versions: string
  current_version: string
}

interface BrewOutdatedJson {
  formulae: BrewOutdatedFormula[]
  casks: BrewOutdatedCask[]
}

interface BrewInfoFormula {
  name: string
  installed: { version: string }[]
  versions: { stable: string }
}

interface BrewInfoCask {
  token: string
  installed: string | null
  version: string
}

interface BrewInfoJson {
  formulae: BrewInfoFormula[]
  casks: BrewInfoCask[]
}

/**
 * Brew install locations to probe, in priority order. macOS GUI apps inherit
 * PATH from launchd (typically just /usr/bin:/bin:/usr/sbin:/sbin) and never
 * read the user's shell rc files, so a bare `brew` lookup fails even when
 * brew is installed and on the user's interactive shell PATH. We probe the
 * standard install locations first, then fall back to a PATH lookup so
 * non-standard installs still work when the user launched Kudu from a shell.
 */
export const BREW_PATH_CANDIDATES = [
  '/opt/homebrew/bin/brew', // Apple Silicon default
  '/usr/local/bin/brew', // Intel default
  'brew' // PATH lookup fallback
]

let cachedBrewPath: string | null | undefined

/** Resolve the path to the brew executable, or null if brew is not installed. */
async function resolveBrewPath(): Promise<string | null> {
  if (cachedBrewPath !== undefined) return cachedBrewPath
  for (const candidate of BREW_PATH_CANDIDATES) {
    try {
      await execFileAsync(candidate, ['--version'], { timeout: 10_000 })
      cachedBrewPath = candidate
      return candidate
    } catch {
      /* try next candidate */
    }
  }
  cachedBrewPath = null
  return null
}

export function parseBrewOutdatedJson(stdout: string): UpdatableApp[] {
  let data: BrewOutdatedJson
  try {
    data = JSON.parse(stdout)
  } catch {
    return []
  }

  const apps: UpdatableApp[] = []

  for (const f of data.formulae ?? []) {
    const currentVersion = f.installed_versions?.[0] ?? ''
    apps.push({
      id: f.name,
      name: f.name,
      currentVersion,
      availableVersion: f.current_version,
      source: 'brew',
      severity: computeSeverity(currentVersion, f.current_version),
      selected: true
    })
  }

  for (const c of data.casks ?? []) {
    const id = c.token || c.name
    const currentVersion = typeof c.installed_versions === 'string' ? c.installed_versions : ''
    apps.push({
      id,
      name: id,
      currentVersion,
      availableVersion: c.current_version,
      source: 'brew',
      severity: computeSeverity(currentVersion, c.current_version),
      selected: true
    })
  }

  return apps
}

export function parseBrewInstalledJson(stdout: string): UpToDateApp[] {
  let data: BrewInfoJson
  try {
    data = JSON.parse(stdout)
  } catch {
    return []
  }

  const apps: UpToDateApp[] = []

  for (const f of data.formulae ?? []) {
    const version = f.installed?.[0]?.version ?? f.versions?.stable ?? ''
    if (!version) continue
    apps.push({ id: f.name, name: f.name, version, source: 'brew' })
  }

  for (const c of data.casks ?? []) {
    const version = c.installed ?? c.version ?? ''
    if (!version) continue
    apps.push({ id: c.token, name: c.token, version, source: 'brew' })
  }

  return apps
}

async function checkForUpdatesBrew(): Promise<UpdateCheckResult> {
  const brewPath = await resolveBrewPath()
  if (!brewPath) {
    return emptyResult(false, 'brew')
  }

  try {
    // Get outdated packages as JSON
    let outdatedStdout = ''
    try {
      const result = await execFileAsync(brewPath, ['outdated', '--json=v2'], {
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024
      })
      outdatedStdout = result.stdout
    } catch (err: any) {
      if (err?.stdout) {
        outdatedStdout = err.stdout
      } else {
        return emptyResult(true, 'brew')
      }
    }

    const apps = parseBrewOutdatedJson(outdatedStdout)

    // Get all installed packages for the "up to date" list
    let upToDate: UpToDateApp[] = []
    try {
      let infoStdout = ''
      try {
        const infoResult = await execFileAsync(brewPath, ['info', '--json=v2', '--installed'], {
          timeout: 60_000,
          maxBuffer: 10 * 1024 * 1024
        })
        infoStdout = infoResult.stdout
      } catch (err: any) {
        if (err?.stdout) infoStdout = err.stdout
      }
      if (infoStdout) {
        const allApps = parseBrewInstalledJson(infoStdout)
        const outdatedIds = new Set(apps.map((a) => a.id))
        upToDate = allApps.filter((a) => !outdatedIds.has(a.id))
      }
    } catch {
      // Non-critical — just skip the up-to-date list
    }

    return buildResult('brew', apps, upToDate)
  } catch {
    return emptyResult(true, 'brew')
  }
}

/** Attempt a single brew upgrade */
async function attemptBrewUpgrade(name: string): Promise<{ success: boolean; error?: string }> {
  if (!BREW_ID_PATTERN.test(name) || name.length > 200) {
    return { success: false, error: 'Invalid package name format' }
  }

  const brewPath = await resolveBrewPath()
  if (!brewPath) {
    return { success: false, error: 'brew not found' }
  }

  try {
    await execFileAsync(brewPath, ['upgrade', name], {
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024
    })
    return { success: true }
  } catch (err: any) {
    const output = cleanOutput(err?.stderr || err?.stdout || err?.message || 'Unknown error')
    const lastLine = output.trim().split('\n').pop() || 'Upgrade failed'
    return {
      success: false,
      error: lastLine.length > 200 ? lastLine.slice(0, 200) + '...' : lastLine
    }
  }
}

async function runUpdatesBrew(
  items: UpdateResultItem[],
  onProgress: (progress: UpdateProgress) => void
): Promise<UpdateResult> {
  const updated: UpdateResultItem[] = []
  const errors: UpdateResult['errors'] = []
  const total = items.length

  // brew doesn't handle parallel upgrades well — run sequentially
  for (let i = 0; i < total; i++) {
    const item = items[i]
    const report = itemProgress(onProgress, item, i + 1, total)
    report('in-progress')

    const result = await attemptBrewUpgrade(item.appId)

    if (result.success) {
      updated.push(item)
      report('done')
    } else {
      errors.push({ ...item, reason: result.error || 'Upgrade failed' })
      report('failed')
    }
  }

  return { succeeded: updated.length, failed: errors.length, updated, pending: [], errors }
}

// ─── Linux (apt / dnf / pacman) ─────────────────────────────

type LinuxPM = 'apt' | 'dnf' | 'pacman'

async function detectLinuxPackageManager(): Promise<LinuxPM | null> {
  const candidates: Array<{ name: LinuxPM; paths: string[] }> = [
    { name: 'apt', paths: ['/usr/bin/apt', '/bin/apt'] },
    { name: 'dnf', paths: ['/usr/bin/dnf', '/bin/dnf'] },
    { name: 'pacman', paths: ['/usr/bin/pacman', '/bin/pacman'] }
  ]
  for (const { name, paths } of candidates) {
    for (const p of paths) {
      try {
        await execFileAsync(p, ['--version'], { timeout: 3_000 })
        return name
      } catch {
        /* not found */
      }
    }
  }
  return null
}

/** Linux package name: alphanumeric (mixed case for RPM), hyphens, dots, underscores, plus, colons (for arch qualifiers) */
const LINUX_PKG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9.+\-_:]{0,200}$/

// ── apt ──

/**
 * Parse `apt list --upgradable` output.
 * Format: package/distro version_new arch [upgradable from: version_old]
 */
export function parseAptUpgradable(stdout: string): UpdatableApp[] {
  const apps: UpdatableApp[] = []
  for (const line of stdout.split('\n')) {
    // Skip the "Listing..." header and empty lines
    if (!line.trim() || line.startsWith('Listing')) continue
    // e.g. "curl/jammy-updates 7.81.0-1ubuntu1.16 amd64 [upgradable from: 7.81.0-1ubuntu1.15]"
    const match = line.match(/^(\S+?)\/\S+\s+(\S+)\s+\S+\s+\[upgradable from:\s+(\S+?)\]/)
    if (!match) continue
    const [, name, availableVersion, currentVersion] = match
    apps.push({
      id: name,
      name,
      currentVersion,
      availableVersion,
      source: 'apt',
      severity: computeSeverity(currentVersion, availableVersion),
      selected: true
    })
  }
  return apps
}

/** Parse `dpkg-query -W` output into up-to-date list */
export function parseDpkgInstalled(stdout: string): UpToDateApp[] {
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, version] = line.split('\t')
      return { id: name, name, version: version ?? '', source: 'apt' }
    })
}

async function checkForUpdatesApt(): Promise<UpdateCheckResult> {
  try {
    // Refresh package cache (may fail without root — that's OK, uses stale cache)
    try {
      await execFileAsync('/usr/bin/apt-get', ['update', '-qq'], { timeout: 60_000 })
    } catch {
      /* non-root: use existing cache */
    }

    let upgradableStdout = ''
    try {
      const result = await execFileAsync('/usr/bin/apt', ['list', '--upgradable'], {
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024
      })
      upgradableStdout = result.stdout
    } catch (err: any) {
      if (err?.stdout) upgradableStdout = err.stdout
      else return emptyResult(true, 'apt')
    }

    const apps = parseAptUpgradable(upgradableStdout)

    // Get installed packages for the "up to date" list
    let upToDate: UpToDateApp[] = []
    try {
      const { stdout: dpkgOut } = await execFileAsync(
        '/usr/bin/dpkg-query',
        ['-W', '-f', '${Package}\t${Version}\n'],
        { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
      )
      const allInstalled = parseDpkgInstalled(dpkgOut)
      const outdatedIds = new Set(apps.map((a) => a.id))
      upToDate = allInstalled.filter((a) => !outdatedIds.has(a.id))
    } catch {
      /* non-critical */
    }

    return buildResult('apt', apps, upToDate)
  } catch {
    return emptyResult(true, 'apt')
  }
}

// ── dnf ──

/**
 * Parse `dnf check-update` output.
 * Format: package.arch   version   repo
 * dnf exits with code 100 when updates are available.
 */
export function parseDnfCheckUpdate(stdout: string): UpdatableApp[] {
  const apps: UpdatableApp[] = []
  for (const line of stdout.split('\n')) {
    if (!line.trim() || line.startsWith('Last metadata') || line.startsWith('Obsoleting')) continue
    // e.g. "curl.x86_64    7.76.1-23.el9    baseos"
    // Use greedy match so we split on the LAST dot (arch never contains dots)
    const match = line.match(/^(\S+)\.(\w+)\s+(\S+)\s+(\S+)/)
    if (!match) continue
    const [, nameWithoutArch, , availableVersion, repo] = match
    apps.push({
      id: nameWithoutArch,
      name: nameWithoutArch,
      currentVersion: '', // filled in below
      availableVersion,
      source: repo || 'dnf',
      severity: 'unknown',
      selected: true
    })
  }
  return apps
}

async function checkForUpdatesDnf(): Promise<UpdateCheckResult> {
  try {
    // dnf check-update exits 100 when updates are available
    let checkStdout = ''
    try {
      const result = await execFileAsync('/usr/bin/dnf', ['check-update', '-q'], {
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024
      })
      checkStdout = result.stdout
    } catch (err: any) {
      checkStdout = err?.stdout ?? ''
    }

    const apps = parseDnfCheckUpdate(checkStdout)

    // Get installed versions to fill in currentVersion and build up-to-date list
    const upToDate: UpToDateApp[] = []
    try {
      const { stdout: rpmOut } = await execFileAsync(
        '/usr/bin/rpm',
        ['-qa', '--queryformat', '%{NAME}\t%{VERSION}-%{RELEASE}\n'],
        { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
      )

      const installedMap = new Map<string, string>()
      for (const line of rpmOut.trim().split('\n')) {
        if (!line.trim()) continue
        const [name, version] = line.split('\t')
        installedMap.set(name, version ?? '')
      }

      // Fill in current versions and compute severity
      for (const app of apps) {
        const current = installedMap.get(app.id)
        if (current) {
          app.currentVersion = current
          app.severity = computeSeverity(current, app.availableVersion)
        }
      }

      // Build up-to-date list
      const outdatedIds = new Set(apps.map((a) => a.id))
      for (const [name, version] of installedMap) {
        if (!outdatedIds.has(name)) {
          upToDate.push({ id: name, name, version, source: 'dnf' })
        }
      }
    } catch {
      /* non-critical */
    }

    return buildResult('dnf', apps, upToDate)
  } catch {
    return emptyResult(true, 'dnf')
  }
}

// ── pacman ──

/**
 * Parse `pacman -Qu` output.
 * Format: package old_version -> new_version
 */
export function parsePacmanQu(stdout: string): UpdatableApp[] {
  const apps: UpdatableApp[] = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    // e.g. "curl 7.87.0-1 -> 7.88.0-1"
    const match = line.match(/^(\S+)\s+(\S+)\s+->\s+(\S+)/)
    if (!match) continue
    const [, name, currentVersion, availableVersion] = match
    apps.push({
      id: name,
      name,
      currentVersion,
      availableVersion,
      source: 'pacman',
      severity: computeSeverity(currentVersion, availableVersion),
      selected: true
    })
  }
  return apps
}

async function checkForUpdatesPacman(): Promise<UpdateCheckResult> {
  try {
    // Sync database first
    try {
      await execFileAsync('/usr/bin/pacman', ['-Sy'], { timeout: 60_000 })
    } catch {
      /* may need root — use stale db */
    }

    let quStdout = ''
    try {
      const result = await execFileAsync('/usr/bin/pacman', ['-Qu'], {
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024
      })
      quStdout = result.stdout
    } catch (err: any) {
      // pacman -Qu exits 1 when no updates available
      if (err?.stdout) quStdout = err.stdout
    }

    const apps = parsePacmanQu(quStdout)

    // Get all installed for up-to-date list
    const upToDate: UpToDateApp[] = []
    try {
      const { stdout: qOut } = await execFileAsync('/usr/bin/pacman', ['-Q'], {
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024
      })
      const outdatedIds = new Set(apps.map((a) => a.id))
      for (const line of qOut.trim().split('\n')) {
        if (!line.trim()) continue
        const [name, version] = line.split(' ')
        if (name && !outdatedIds.has(name)) {
          upToDate.push({ id: name, name, version: version ?? '', source: 'pacman' })
        }
      }
    } catch {
      /* non-critical */
    }

    return buildResult('pacman', apps, upToDate)
  } catch {
    return emptyResult(true, 'pacman')
  }
}

// ── Linux: check dispatcher ──

async function checkForUpdatesLinux(): Promise<UpdateCheckResult> {
  const pm = await detectLinuxPackageManager()
  if (!pm) return emptyResult(false, null)
  if (pm === 'apt') return checkForUpdatesApt()
  if (pm === 'dnf') return checkForUpdatesDnf()
  return checkForUpdatesPacman()
}

// ── Linux: run updates ──

async function attemptLinuxUpgrade(
  pm: LinuxPM,
  appId: string
): Promise<{ success: boolean; error?: string }> {
  if (!LINUX_PKG_PATTERN.test(appId)) {
    return { success: false, error: 'Invalid package name format' }
  }

  try {
    if (pm === 'apt') {
      await execFileAsync('/usr/bin/apt-get', ['install', '-y', '-qq', appId], {
        timeout: 10 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024
      })
    } else if (pm === 'dnf') {
      await execFileAsync('/usr/bin/dnf', ['upgrade', '-y', '-q', appId], {
        timeout: 10 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024
      })
    } else {
      await execFileAsync('/usr/bin/pacman', ['-S', '--noconfirm', appId], {
        timeout: 10 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024
      })
    }
    return { success: true }
  } catch (err: any) {
    const output = cleanOutput(err?.stderr || err?.stdout || err?.message || 'Unknown error')
    const lastLine = output.trim().split('\n').pop() || 'Upgrade failed'
    return {
      success: false,
      error: lastLine.length > 200 ? lastLine.slice(0, 200) + '...' : lastLine
    }
  }
}

async function runUpdatesLinux(
  items: UpdateResultItem[],
  onProgress: (progress: UpdateProgress) => void
): Promise<UpdateResult> {
  const pm = await detectLinuxPackageManager()
  if (!pm) return emptyUpdateResult()

  const updated: UpdateResultItem[] = []
  const errors: UpdateResult['errors'] = []
  const total = items.length

  // Run sequentially — apt/dnf/pacman don't handle parallel installs
  for (let i = 0; i < total; i++) {
    const item = items[i]
    const report = itemProgress(onProgress, item, i + 1, total)
    report('in-progress')

    const result = await attemptLinuxUpgrade(pm, item.appId)

    if (result.success) {
      updated.push(item)
      report('done')
    } else {
      errors.push({ ...item, reason: result.error || 'Upgrade failed' })
      report('failed')
    }
  }

  return { succeeded: updated.length, failed: errors.length, updated, pending: [], errors }
}

// ─── Platform-dispatched exports ────────────────────────────

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  if (process.platform === 'darwin') return checkForUpdatesBrew()
  if (process.platform === 'win32') return checkForUpdatesWindows()
  if (process.platform === 'linux') return checkForUpdatesLinux()
  return emptyResult(false, null)
}

/** A result for a run that upgraded nothing. */
export function emptyUpdateResult(): UpdateResult {
  return { succeeded: 0, failed: 0, updated: [], pending: [], errors: [] }
}

export async function runUpdates(
  items: UpdateRequestItem[],
  onProgress: (progress: UpdateProgress) => void
): Promise<UpdateResult> {
  if (process.platform === 'win32') return runUpdatesWindows(items, onProgress)
  // Single-manager platforms ignore per-item source — every id belongs to the
  // one active manager.
  const named = items.map((i) => ({ appId: i.id, name: displayName(i) }))
  if (process.platform === 'darwin') return runUpdatesBrew(named, onProgress)
  if (process.platform === 'linux') return runUpdatesLinux(named, onProgress)
  return emptyUpdateResult()
}

/** Winget package id: alphanumeric plus dot/dash/underscore */
const WINGET_ID_PATTERN = /^[\w][\w.\-]{0,200}$/

/** Validate an app ID for the current platform's package manager */
export function isValidAppId(id: string): boolean {
  if (process.platform === 'darwin') return BREW_ID_PATTERN.test(id) && id.length <= 200
  if (process.platform === 'linux') return LINUX_PKG_PATTERN.test(id)
  return WINGET_ID_PATTERN.test(id)
}

/**
 * Validate an app ID against the pattern of the manager that owns it. Needed
 * for aggregation: npm scoped names (`@scope/pkg`) and Scoop names containing
 * `+` are valid for their manager but rejected by the winget/legacy pattern.
 */
export function isValidAppIdForSource(id: string, source: string): boolean {
  switch (source) {
    case 'winget':
      return WINGET_ID_PATTERN.test(id)
    case 'choco':
      return CHOCO_ID_PATTERN.test(id)
    case 'scoop':
      return SCOOP_ID_PATTERN.test(id)
    case 'npm':
      return NPM_ID_PATTERN.test(id)
    case 'brew':
      return BREW_ID_PATTERN.test(id) && id.length <= 200
    case 'apt':
    case 'dnf':
    case 'pacman':
      return LINUX_PKG_PATTERN.test(id)
    default:
      return isValidAppId(id)
  }
}
