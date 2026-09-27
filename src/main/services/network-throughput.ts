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

/** Byte counters of adapter `name` in Get-NetAdapterStatistics JSON (one object or a list). */
export function adapterCounters(json: string, name: string): Counters | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
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

/** Bytes per second between two readings of one interface, or null to prime.
 * A counter that went backwards (adapter reset) counts as zero, as in systeminformation. */
export function counterRates(
  previous: CounterReading | null,
  next: CounterReading
): NetworkRates | null {
  const elapsed = previous && previous.iface === next.iface ? next.at - previous.at : 0
  if (!previous || !(elapsed > 0)) return null
  const perSecond = (delta: number) => (delta > 0 ? delta / (elapsed / 1000) : 0)
  return {
    rxBytesPerSec: perSecond(next.rxBytes - previous.rxBytes),
    txBytesPerSec: perSecond(next.txBytes - previous.txBytes)
  }
}

/** Get-NetAdapterStatistics in an asynchronous PowerShell, the query systeminformation runs. */
export async function readWindowsAdapterCounters(name: string): Promise<Counters | null> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', psUtf8(ADAPTER_STATISTICS)],
    { timeout: 30_000, windowsHide: true }
  )
  return adapterCounters(stdout, name)
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

  /** Current rates, zero while priming; null without an interface or when its statistics failed. */
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
    const counters = await this.readCounters(iface).catch(() => null)
    if (!counters) {
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
