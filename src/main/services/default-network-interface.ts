import * as os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

type Interfaces = NodeJS.Dict<os.NetworkInterfaceInfo[]>

/** Re-resolve a working default interface this often, to follow Wi-Fi/Ethernet/VPN switches. */
export const INTERFACE_REFRESH_MS = 5 * 60_000
/** After a failed lookup or failed stats, look again no sooner than this. */
export const INTERFACE_RETRY_MS = 30_000

/**
 * Interface address of the IPv4 default route in `netstat -r` output (Windows).
 * Like systeminformation, only all-numeric `0.0.0.0 0.0.0.0 gateway interface metric`
 * rows count; with several, the lowest metric wins, as it does for routing.
 */
export function parseWindowsDefaultRoute(output: string): string | null {
  let best: { address: string; metric: number } | null = null
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (!line.startsWith('0.0.0.0 0.0.0.0 ') || /[a-z]/i.test(line)) continue
    const parts = line.split(' ')
    if (parts.length < 5) continue
    const metric = Number(parts[parts.length - 1])
    const address = parts[parts.length - 2]
    if (!best || metric < best.metric) best = { address, metric }
  }
  return best?.address ?? null
}

/** Device of the lowest-metric default route in `ip route show default` output (Linux). */
export function parseLinuxDefaultRoute(output: string): string | null {
  let best: { device: string; metric: number } | null = null
  for (const line of output.split('\n')) {
    if (!line.startsWith('default')) continue
    const device = /\bdev\s+(\S+)/.exec(line)?.[1]
    if (!device) continue
    const metric = Number(/\bmetric\s+(\d+)/.exec(line)?.[1] ?? 0)
    if (!best || metric < best.metric) best = { device, metric }
  }
  return best?.device ?? null
}

/** Interface line of `route -n get default` output (macOS). */
export function parseDarwinDefaultRoute(output: string): string | null {
  return /^\s*interface:\s*(\S+)/m.exec(output)?.[1] ?? null
}

/** Adapter that owns `address`; os.networkInterfaces() keys are the adapter names. */
export function interfaceWithAddress(interfaces: Interfaces, address: string): string | null {
  for (const [name, entries] of Object.entries(interfaces)) {
    if (entries?.some((entry) => entry.address === address)) return name
  }
  return null
}

/** systeminformation's fallback: the external adapter with the lowest IPv6 scope id, else the first one. */
export function firstExternalInterface(interfaces: Interfaces): string | null {
  let first: string | null = null
  let best: { name: string; scopeid: number } | null = null
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue
      first ??= name
      if (entry.scopeid && (!best || entry.scopeid < best.scopeid))
        best = { name, scopeid: entry.scopeid }
    }
  }
  return best?.name ?? first
}

/**
 * The default network interface, looked up with an asynchronous child process.
 * systeminformation finds it with execSync on every networkStats() call, which
 * blocked main's event loop for seconds while the Performance page sampled.
 */
export async function resolveDefaultInterface(
  platform: NodeJS.Platform = process.platform
): Promise<string | null> {
  const options = { timeout: 10_000, windowsHide: true }
  try {
    if (platform === 'win32') {
      const { stdout } = await execFileAsync('netstat', ['-r'], options)
      const address = parseWindowsDefaultRoute(stdout)
      const name = address && interfaceWithAddress(os.networkInterfaces(), address)
      if (name) return name
    } else if (platform === 'linux') {
      const { stdout } = await execFileAsync('ip', ['route', 'show', 'default'], options)
      const name = parseLinuxDefaultRoute(stdout)
      if (name) return name
    } else if (platform === 'darwin') {
      const { stdout } = await execFileAsync('route', ['-n', 'get', 'default'], options)
      const name = parseDarwinDefaultRoute(stdout)
      if (name) return name
    }
  } catch {
    // No route tool or no default route: fall back to the first external adapter
  }
  return firstExternalInterface(os.networkInterfaces())
}

/**
 * Default interface for the app session. The first lookup is awaited; later
 * refreshes (every few minutes, or sooner after a failure) run in the
 * background while the cached name keeps answering. Lookups only happen when
 * a caller asks, so nothing runs while nobody samples.
 */
export class DefaultInterfaceCache {
  private name: string | null = null
  private attemptedAt = -Infinity
  private failed = false
  private pending: Promise<string | null> | null = null

  constructor(
    private readonly lookup: () => Promise<string | null> = resolveDefaultInterface,
    private readonly present: (name: string) => boolean = (name) =>
      !!os.networkInterfaces()[name]?.length
  ) {}

  async get(now: number): Promise<string | null> {
    if (this.name !== null && !this.present(this.name)) this.failed = true
    if (!this.pending && this.due(now)) this.refresh(now)
    // Stale answers beat none: only the first lookup, or one replacing a failed name, is awaited
    if (this.pending && (this.name === null || this.failed)) return this.pending
    return this.name
  }

  /** Stats for the cached interface failed: look it up again soon. */
  invalidate(): void {
    this.failed = true
  }

  private due(now: number): boolean {
    const wait = this.failed || this.name === null ? INTERFACE_RETRY_MS : INTERFACE_REFRESH_MS
    return now - this.attemptedAt >= wait
  }

  private refresh(now: number): void {
    this.attemptedAt = now
    this.pending = this.lookup()
      .catch(() => null)
      .then((name) => {
        this.pending = null
        if (name !== null) {
          this.name = name
          this.failed = false
        }
        return this.name
      })
  }
}
