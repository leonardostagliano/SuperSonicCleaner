import * as si from 'systeminformation'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { PerfSnapshot } from '../../shared/types'
import { psUtf8 } from './exec-utf8'
import { DefaultInterfaceCache } from './default-network-interface'

const execFileAsync = promisify(execFile)

export type NetworkRates = PerfSnapshot['network']
type Counters = { rxBytes: number; txBytes: number }
export type CounterReading = Counters & { iface: string; at: number }

const ADAPTER_STATISTICS =
  'Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes | ConvertTo-Json -Compress'

/** Longest window a rate may average over: a longer gap means sampling paused, so prime again. */
export const MAX_RATE_WINDOW_MS = 60_000
/** Longest wait between attempts while the statistics query keeps failing. */
export const READER_MAX_BACKOFF_MS = 5 * 60_000

/** Wait before the next statistics query after `failures` failed ones in a row. */
export function readerBackoffMs(failures: number): number {
  return failures > 0 ? Math.min(READER_MAX_BACKOFF_MS, 5000 * 2 ** failures) : 0
}

/**
 * Byte counters of adapter `name` in Get-NetAdapterStatistics JSON (one object or
 * a list); null when the adapter is not listed. Names are compared exactly apart
 * from case, so localized names (accents, Cyrillic, typographic dashes) must
 * arrive intact: the query runs with UTF-8 output. Throws when the output is not
 * JSON at all, i.e. the query itself failed.
 */
export function adapterCounters(json: string, name: string): Counters | null {
  // trim() also drops a byte-order mark; no output at all means no adapters
  const text = json.trim()
  if (!text) return null
  const parsed: unknown = JSON.parse(text)
  const wanted = name.toLowerCase()
  for (const entry of Array.isArray(parsed) ? parsed : [parsed]) {
    if (!entry || typeof entry !== 'object') continue
    const { Name, ReceivedBytes, SentBytes } = entry as Record<string, unknown>
    if (typeof Name !== 'string' || Name.toLowerCase() !== wanted) continue
    const valid = (value: unknown): value is number =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0
    return valid(ReceivedBytes) && valid(SentBytes)
      ? { rxBytes: ReceivedBytes, txBytes: SentBytes }
      : null
  }
  return null
}

/** Bytes per second between two readings of one interface, or null to prime (first
 * reading, interface switch, or a gap over MAX_RATE_WINDOW_MS). A counter that went
 * backwards (adapter reset) counts as zero, as in systeminformation. */
export function counterRates(
  previous: CounterReading | null,
  next: CounterReading
): NetworkRates | null {
  const elapsed = previous && previous.iface === next.iface ? next.at - previous.at : 0
  if (!previous || !(elapsed > 0) || elapsed > MAX_RATE_WINDOW_MS) return null
  const perSecond = (delta: number) => (delta > 0 ? delta / (elapsed / 1000) : 0)
  return {
    rxBytesPerSec: perSecond(next.rxBytes - previous.rxBytes),
    txBytesPerSec: perSecond(next.txBytes - previous.txBytes)
  }
}

/** Stdout of a PowerShell script run asynchronously with UTF-8 output, so non-ASCII text survives. */
export async function runPowerShellUtf8(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', psUtf8(script)],
    { timeout: 30_000, windowsHide: true }
  )
  return stdout
}

/** Get-NetAdapterStatistics in an asynchronous PowerShell, the query systeminformation runs. */
export async function readWindowsAdapterCounters(name: string): Promise<Counters | null> {
  return adapterCounters(await runPowerShellUtf8(ADAPTER_STATISTICS), name)
}

type Options = {
  platform?: NodeJS.Platform
  defaultInterface?: Pick<DefaultInterfaceCache, 'get' | 'invalidate'>
  readCounters?: (name: string) => Promise<Counters | null>
  now?: () => number
}

/**
 * Throughput of the default network interface without a synchronous child
 * process on main's event loop. systeminformation looks the interface up with
 * execSync when none is named, and on Windows its networkStats() also scans
 * every adapter with several execSync calls (netstat, ipconfig, netsh) the
 * first time and after any change, so Windows reads the counters directly.
 */
export class NetworkThroughput {
  private last: CounterReading | null = null
  private epoch = 0
  private readerFailures = 0
  private readerRetryAt = -Infinity
  private readonly platform: NodeJS.Platform
  private readonly defaultInterface: Pick<DefaultInterfaceCache, 'get' | 'invalidate'>
  private readonly readCounters: (name: string) => Promise<Counters | null>
  private readonly now: () => number

  constructor(options: Options = {}) {
    this.platform = options.platform ?? process.platform
    this.defaultInterface = options.defaultInterface ?? new DefaultInterfaceCache()
    this.readCounters = options.readCounters ?? readWindowsAdapterCounters
    this.now = options.now ?? (() => performance.now())
  }

  /** Current rates, zero while priming; null without an interface, when its statistics
   * failed, or while a failing statistics query is backing off. */
  async read(now: number): Promise<NetworkRates | null> {
    const epoch = this.epoch
    const iface = await this.defaultInterface.get(now)
    if (!iface) return null
    if (this.platform !== 'win32') {
      // Named, systeminformation's Linux and macOS readers stay asynchronous
      const stats = await si.networkStats(iface)
      if (!stats.length) {
        this.defaultInterface.invalidate()
        return null
      }
      return {
        rxBytesPerSec: stats.reduce((sum, entry) => sum + Math.max(0, entry.rx_sec || 0), 0),
        txBytesPerSec: stats.reduce((sum, entry) => sum + Math.max(0, entry.tx_sec || 0), 0)
      }
    }
    // A query that keeps failing (no NetAdapter module, e.g. Server Core) is retried
    // less and less often rather than on every poll
    if (now < this.readerRetryAt) return null
    let counters: Counters | null
    try {
      counters = await this.readCounters(iface)
    } catch {
      this.readerFailures++
      this.readerRetryAt = now + readerBackoffMs(this.readerFailures)
      return null
    }
    this.readerFailures = 0
    this.readerRetryAt = -Infinity
    if (!counters) {
      // The query works but does not list this adapter: look the interface up again
      this.defaultInterface.invalidate()
      return null
    }
    const reading = { iface, ...counters, at: this.now() }
    // A reading that outlived a reset belongs to the paused session
    if (epoch !== this.epoch) return null
    const rates = counterRates(this.last, reading)
    this.last = reading
    return rates ?? { rxBytesPerSec: 0, txBytesPerSec: 0 }
  }

  /** Sampling paused: the next reading primes instead of averaging over the pause. */
  reset(): void {
    this.epoch++
    this.last = null
  }
}
