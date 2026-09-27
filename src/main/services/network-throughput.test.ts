import { afterEach, describe, expect, it, vi } from 'vitest'
import * as si from 'systeminformation'
import {
  adapterCounters,
  counterRates,
  MAX_RATE_WINDOW_MS,
  NetworkThroughput,
  READER_MAX_BACKOFF_MS,
  readerBackoffMs,
  runPowerShellUtf8
} from './network-throughput'

vi.mock('systeminformation', () => ({ networkStats: vi.fn() }))

afterEach(() => vi.clearAllMocks())

describe('Windows adapter counters', () => {
  const json = JSON.stringify([
    { Name: 'vEthernet (WSL)', ReceivedBytes: 10, SentBytes: 20 },
    { Name: 'Wi-Fi', ReceivedBytes: 1_000_000, SentBytes: 250_000 }
  ])

  it('reads the named adapter from Get-NetAdapterStatistics JSON, one object or a list', () => {
    expect(adapterCounters(json, 'wi-fi')).toEqual({ rxBytes: 1_000_000, txBytes: 250_000 })
    expect(
      adapterCounters(
        JSON.stringify({ Name: 'Ethernet', ReceivedBytes: 5, SentBytes: 6 }),
        'Ethernet'
      )
    ).toEqual({ rxBytes: 5, txBytes: 6 })
  })

  it('reports a missing adapter, no adapters at all or impossible counters as not found', () => {
    expect(adapterCounters(json, 'Ethernet')).toBeNull()
    expect(adapterCounters('', 'Wi-Fi')).toBeNull()
    expect(adapterCounters('\r\n', 'Wi-Fi')).toBeNull()
    expect(
      adapterCounters(JSON.stringify({ Name: 'Wi-Fi', ReceivedBytes: -1, SentBytes: 6 }), 'Wi-Fi')
    ).toBeNull()
    expect(adapterCounters(JSON.stringify({ Name: 'Wi-Fi', SentBytes: 6 }), 'Wi-Fi')).toBeNull()
  })

  it('throws when the query printed something other than JSON, so the reader can back off', () => {
    expect(() =>
      adapterCounters('Get-NetAdapterStatistics : The term is not recognized', 'Wi-Fi')
    ).toThrow()
  })

  // Names as os.networkInterfaces() and Get-NetAdapter report them on localized Windows
  const NON_ASCII = [
    'Connessione alla rete locale (LAN) 2',
    'Wi\u2011Fi', // non-breaking hyphen
    'Ethernet \u2014 Ufficio', // em dash
    '\u0421\u0435\u0442\u044c' // Cyrillic 'network'
  ]

  it('matches non-ASCII adapter names, raw or JSON-escaped, and ignores case beyond ASCII', () => {
    const list = NON_ASCII.map((Name, i) => ({ Name, ReceivedBytes: i + 1, SentBytes: i + 10 }))
    const raw = JSON.stringify(list)
    // Windows PowerShell may escape characters in ConvertTo-Json output
    const escaped = raw.replace(
      /[^\x20-\x7e]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
    )
    expect(escaped).not.toBe(raw)
    for (const [i, name] of NON_ASCII.entries()) {
      expect(adapterCounters(raw, name)).toEqual({ rxBytes: i + 1, txBytes: i + 10 })
      expect(adapterCounters(escaped, name)).toEqual({ rxBytes: i + 1, txBytes: i + 10 })
    }
    expect(adapterCounters(raw, '\u0441\u0435\u0442\u044c')).toEqual({ rxBytes: 4, txBytes: 13 })
    // A plain hyphen is a different adapter, not a near match
    expect(adapterCounters(raw, 'Wi-Fi')).toBeNull()
    // A byte-order mark in front of the output is not part of the JSON
    expect(adapterCounters('\ufeff' + raw, 'Wi\u2011Fi')).toEqual({ rxBytes: 2, txBytes: 11 })
  })

  it.skipIf(process.platform !== 'win32')(
    'keeps non-ASCII adapter names intact through the UTF-8 PowerShell output',
    async () => {
      const objects = NON_ASCII.map(
        (name, i) =>
          `[pscustomobject]@{ Name = '${name}'; ReceivedBytes = ${i + 1}; SentBytes = ${i + 10} }`
      ).join(', ')
      const stdout = await runPowerShellUtf8(
        `@(${objects}) | Select-Object Name,ReceivedBytes,SentBytes | ConvertTo-Json -Compress`
      )
      for (const [i, name] of NON_ASCII.entries()) {
        expect(adapterCounters(stdout, name)).toEqual({ rxBytes: i + 1, txBytes: i + 10 })
      }
    },
    120_000
  )
})

describe('counter reader back-off', () => {
  it('doubles the wait after each failed query, up to a few minutes', () => {
    expect(readerBackoffMs(0)).toBe(0)
    expect(readerBackoffMs(1)).toBe(10_000)
    expect(readerBackoffMs(2)).toBe(20_000)
    expect(readerBackoffMs(5)).toBe(160_000)
    expect(readerBackoffMs(6)).toBe(READER_MAX_BACKOFF_MS)
    expect(readerBackoffMs(60)).toBe(READER_MAX_BACKOFF_MS)
    expect(READER_MAX_BACKOFF_MS).toBe(5 * 60_000)
  })
})

describe('counter rates', () => {
  const reading = (rxBytes: number, txBytes: number, at: number, iface = 'Wi-Fi') => ({
    iface,
    rxBytes,
    txBytes,
    at
  })

  it('primes on the first reading, after an interface switch or a clock that did not move', () => {
    expect(counterRates(null, reading(0, 0, 0))).toBeNull()
    expect(counterRates(reading(0, 0, 0), reading(100, 100, 1000, 'Ethernet'))).toBeNull()
    expect(counterRates(reading(0, 0, 1000), reading(100, 100, 1000))).toBeNull()
  })

  it('primes instead of averaging over a window longer than a paused poll', () => {
    expect(counterRates(reading(0, 0, 0), reading(6000, 0, MAX_RATE_WINDOW_MS))).toEqual({
      rxBytesPerSec: 6000 / (MAX_RATE_WINDOW_MS / 1000),
      txBytesPerSec: 0
    })
    expect(counterRates(reading(0, 0, 0), reading(6000, 0, MAX_RATE_WINDOW_MS + 1))).toBeNull()
  })

  it('divides byte deltas by the measured window and counts a counter reset as zero', () => {
    expect(counterRates(reading(1000, 500, 0), reading(11_000, 3000, 5000))).toEqual({
      rxBytesPerSec: 2000,
      txBytesPerSec: 500
    })
    expect(counterRates(reading(1000, 500, 0), reading(10, 1500, 2000))).toEqual({
      rxBytesPerSec: 0,
      txBytesPerSec: 500
    })
  })
})

describe('default interface throughput', () => {
  const setup = (platform: NodeJS.Platform, iface: string | null = 'Wi-Fi') => {
    let clock = 0
    const defaultInterface = { get: vi.fn(async () => iface), invalidate: vi.fn() }
    const readCounters =
      vi.fn<(name: string) => Promise<{ rxBytes: number; txBytes: number } | null>>()
    const network = new NetworkThroughput({
      platform,
      defaultInterface,
      readCounters,
      now: () => clock
    })
    return { network, defaultInterface, readCounters, advance: (ms: number) => (clock += ms) }
  }

  it('reads Windows counters for the cached default interface without systeminformation', async () => {
    const { network, readCounters, advance } = setup('win32')
    readCounters.mockResolvedValueOnce({ rxBytes: 0, txBytes: 0 })
    expect(await network.read(0)).toEqual({ rxBytesPerSec: 0, txBytesPerSec: 0 })
    advance(5000)
    readCounters.mockResolvedValueOnce({ rxBytes: 50_000, txBytes: 10_000 })
    expect(await network.read(5000)).toEqual({ rxBytesPerSec: 10_000, txBytesPerSec: 2000 })
    expect(readCounters).toHaveBeenCalledWith('Wi-Fi')
    expect(si.networkStats).not.toHaveBeenCalled()
  })

  it('asks for a new interface when the adapter is missing from the statistics', async () => {
    const { network, defaultInterface, readCounters } = setup('win32')
    readCounters.mockResolvedValueOnce(null)
    expect(await network.read(0)).toBeNull()
    expect(defaultInterface.invalidate).toHaveBeenCalledTimes(1)
  })

  it('backs off a failing statistics query instead of retrying on every poll', async () => {
    const { network, defaultInterface, readCounters } = setup('win32')
    // e.g. no NetAdapter module (Server Core) or a PowerShell that timed out
    readCounters.mockRejectedValue(new Error('Get-NetAdapterStatistics is not recognized'))
    expect(await network.read(0)).toBeNull()
    expect(await network.read(5000)).toBeNull()
    expect(readCounters).toHaveBeenCalledTimes(1)
    expect(await network.read(10_000)).toBeNull()
    expect(readCounters).toHaveBeenCalledTimes(2)
    expect(await network.read(29_999)).toBeNull()
    expect(readCounters).toHaveBeenCalledTimes(2)
    expect(await network.read(30_000)).toBeNull()
    expect(readCounters).toHaveBeenCalledTimes(3)
    // The interface was never the problem
    expect(defaultInterface.invalidate).not.toHaveBeenCalled()
    let at = 30_000
    for (let i = 0; i < 10; i++) await network.read((at += READER_MAX_BACKOFF_MS))
    const calls = readCounters.mock.calls.length
    expect(await network.read(at + READER_MAX_BACKOFF_MS - 1)).toBeNull()
    expect(readCounters).toHaveBeenCalledTimes(calls)
    // One success clears the back-off
    readCounters.mockResolvedValue({ rxBytes: 0, txBytes: 0 })
    at += READER_MAX_BACKOFF_MS
    expect(await network.read(at)).toEqual({ rxBytesPerSec: 0, txBytesPerSec: 0 })
    readCounters.mockRejectedValueOnce(new Error('timeout'))
    await network.read(at + 5000)
    expect(await network.read(at + 15_000)).not.toBeNull()
  })

  it('primes again after a reset instead of averaging over the pause', async () => {
    const { network, readCounters, advance } = setup('win32')
    readCounters.mockResolvedValue({ rxBytes: 1000, txBytes: 1000 })
    await network.read(0)
    network.reset()
    advance(10_000)
    readCounters.mockResolvedValue({ rxBytes: 11_000, txBytes: 1000 })
    expect(await network.read(10_000)).toEqual({ rxBytesPerSec: 0, txBytesPerSec: 0 })
  })

  it('does not keep a reading that settles after a reset as the next baseline', async () => {
    const { network, readCounters, advance } = setup('win32')
    let settle!: (counters: { rxBytes: number; txBytes: number }) => void
    readCounters.mockReturnValueOnce(new Promise((resolve) => (settle = resolve)))
    const inFlight = network.read(0)
    network.reset()
    settle({ rxBytes: 1000, txBytes: 1000 })
    await inFlight
    advance(10_000)
    readCounters.mockResolvedValueOnce({ rxBytes: 11_000, txBytes: 1000 })
    expect(await network.read(10_000)).toEqual({ rxBytesPerSec: 0, txBytesPerSec: 0 })
  })

  it('reads nothing without a default interface', async () => {
    const { network, readCounters } = setup('win32', null)
    expect(await network.read(0)).toBeNull()
    expect(readCounters).not.toHaveBeenCalled()
  })

  it('names the interface for systeminformation elsewhere, so it never looks it up itself', async () => {
    const { network, readCounters } = setup('linux', 'wlp2s0')
    vi.mocked(si.networkStats).mockResolvedValueOnce([
      { rx_sec: 300, tx_sec: 100 },
      { rx_sec: null, tx_sec: -1 }
    ] as never)
    expect(await network.read(0)).toEqual({ rxBytesPerSec: 300, txBytesPerSec: 100 })
    expect(si.networkStats).toHaveBeenCalledWith('wlp2s0')
    expect(readCounters).not.toHaveBeenCalled()
  })
})
