import { afterEach, describe, expect, it, vi } from 'vitest'
import * as si from 'systeminformation'
import { adapterCounters, counterRates, NetworkThroughput } from './network-throughput'

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

  it('reports a missing adapter, broken output or impossible counters as a failure', () => {
    expect(adapterCounters(json, 'Ethernet')).toBeNull()
    expect(adapterCounters('', 'Wi-Fi')).toBeNull()
    expect(adapterCounters('Get-NetAdapterStatistics : Access denied', 'Wi-Fi')).toBeNull()
    expect(
      adapterCounters(JSON.stringify({ Name: 'Wi-Fi', ReceivedBytes: -1, SentBytes: 6 }), 'Wi-Fi')
    ).toBeNull()
    expect(adapterCounters(JSON.stringify({ Name: 'Wi-Fi', SentBytes: 6 }), 'Wi-Fi')).toBeNull()
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

  it('asks for a new interface when the adapter is missing or its statistics fail', async () => {
    const { network, defaultInterface, readCounters } = setup('win32')
    readCounters.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('timeout'))
    expect(await network.read(0)).toBeNull()
    expect(await network.read(5000)).toBeNull()
    expect(defaultInterface.invalidate).toHaveBeenCalledTimes(2)
  })

  it('primes again after a reset instead of averaging over the pause', async () => {
    const { network, readCounters, advance } = setup('win32')
    readCounters.mockResolvedValue({ rxBytes: 1000, txBytes: 1000 })
    await network.read(0)
    network.reset()
    advance(60_000)
    readCounters.mockResolvedValue({ rxBytes: 61_000, txBytes: 1000 })
    expect(await network.read(60_000)).toEqual({ rxBytesPerSec: 0, txBytesPerSec: 0 })
  })

  it('does not keep a reading that settles after a reset as the next baseline', async () => {
    const { network, readCounters, advance } = setup('win32')
    let settle!: (counters: { rxBytes: number; txBytes: number }) => void
    readCounters.mockReturnValueOnce(new Promise((resolve) => (settle = resolve)))
    const inFlight = network.read(0)
    network.reset()
    settle({ rxBytes: 1000, txBytes: 1000 })
    await inFlight
    advance(60_000)
    readCounters.mockResolvedValueOnce({ rxBytes: 61_000, txBytes: 1000 })
    expect(await network.read(60_000)).toEqual({ rxBytesPerSec: 0, txBytesPerSec: 0 })
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
