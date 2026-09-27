import { execFileSync } from 'child_process'
import { win32 } from 'path'
import type { PlatformElevation } from '../types'
import { DATA_DIRECTORY_ARGUMENT } from '../../services/app-identity'

let _isAdmin: boolean | null = null

// Check the security token inherited from Kudu rather than probing a Windows
// service. `net session` also requires the Server (LanmanServer) service, so it
// reports access denied on elevated systems where that service is disabled.
const ADMIN_TOKEN_CHECK = [
  '$identity = [Security.Principal.WindowsIdentity]::GetCurrent()',
  '$principal = [Security.Principal.WindowsPrincipal]::new($identity)',
  '$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
  'if ($isAdmin) { exit 0 }',
  'exit 1'
].join('; ')

interface WindowsRelaunchOptions {
  executable: string
  userDataDir: string
  isPackaged: boolean
  appPath: string
  argv?: string[]
  cwd?: string
  parentPid?: number
}

export function getWindowsRelaunchArgs(options: WindowsRelaunchOptions): string[] {
  const args: string[] = []
  if (!options.isPackaged) {
    // Electron's executable alone opens its default welcome screen. The first
    // application argument can be either a project directory or a built entry.
    const entry = (options.argv ?? process.argv)[1]
    args.push(
      win32.resolve(
        options.cwd ?? process.cwd(),
        entry && !entry.startsWith('-') ? entry : options.appPath
      )
    )
  }
  args.push(`${DATA_DIRECTORY_ARGUMENT}${options.userDataDir}`)
  return args
}

function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function windowsArgument(value: string): string {
  // Start-Process joins ArgumentList before invoking CreateProcess. Preserve
  // quotes and trailing backslashes using Windows command-line escaping.
  const escaped = value
    .replace(/(\\*)"/g, (_match, slashes: string) => `${slashes}${slashes}\\"`)
    .replace(/\\+$/, (slashes) => `${slashes}${slashes}`)
  return `"${escaped}"`
}

export function buildWindowsElevationCommand(options: WindowsRelaunchOptions): string {
  const args = getWindowsRelaunchArgs(options).map(windowsArgument).join(' ')
  // The elevated helper waits for the old process to exit before starting the
  // app, so packaged builds can acquire the single-instance lock reliably.
  const helper = [
    "$ErrorActionPreference = 'Stop'",
    `Wait-Process -Id ${options.parentPid ?? process.pid} -ErrorAction SilentlyContinue`,
    `Start-Process -FilePath ${powershellQuote(options.executable)} -ArgumentList ${powershellQuote(args)} -WorkingDirectory ${powershellQuote(options.cwd ?? process.cwd())} -ErrorAction Stop`
  ].join('; ')
  const encoded = Buffer.from(helper, 'utf16le').toString('base64')
  // ErrorAction Stop makes a declined UAC prompt a non-zero PowerShell exit;
  // the IPC caller then leaves the current application running.
  return `Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile -NonInteractive -EncodedCommand ${encoded}' -Verb RunAs -WindowStyle Hidden -ErrorAction Stop`
}

export function createWin32Elevation(): PlatformElevation {
  return {
    isAdmin(): boolean {
      if (_isAdmin !== null) return _isAdmin

      try {
        execFileSync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', ADMIN_TOKEN_CHECK],
          { stdio: 'ignore', timeout: 5000, windowsHide: true }
        )
        _isAdmin = true
      } catch {
        _isAdmin = false
      }

      return _isAdmin
    }
  }
}
