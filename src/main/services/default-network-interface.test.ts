import { describe, expect, it, vi } from 'vitest'
import * as os from 'os'
import type { NetworkInterfaceInfo } from 'os'
import { execFile } from 'child_process'
import {
  DefaultInterfaceCache,
  INTERFACE_REFRESH_MS,
  INTERFACE_RETRY_MS,
  firstExternalInterface,
  interfaceWithAddress,
  parseDarwinDefaultRoute,
  parseLinuxDefaultRoute,
  parseWindowsDefaultRoute,
  resolveDefaultInterface
} from './default-network-interface'

vi.mock('os', () => ({ networkInterfaces: vi.fn(() => ({})) }))
vi.mock('child_process', () => ({ execFile: vi.fn() }))

const address = (ip: string, internal = false, scopeid?: number) =>
  ({
    address: ip,
    netmask: '255.255.255.0',
    family: ip.includes(':') ? 'IPv6' : 'IPv4',
    mac: '00:11:22:33:44:55',
    internal,
    cidr: null,
    ...(scopeid === undefined ? {} : { scopeid })
  }) as NetworkInterfaceInfo

const NETSTAT = [
  '===========================================================================',
  'Interface List',
  ' 12...00 11 22 33 44 55 ......Intel(R) Wi-Fi 6 AX201 160MHz',
  '  1...........................Software Loopback Interface 1',
  '===========================================================================',
  '',
  'IPv4 Route Table',
  '===========================================================================',
  'Active Routes:',
  'Network Destination        Netmask          Gateway       Interface  Metric',
  '          0.0.0.0          0.0.0.0      192.168.1.1    192.168.1.23     50',
  '          0.0.0.0          0.0.0.0         10.8.0.1        10.8.0.6     25',
  '        127.0.0.0        255.0.0.0         On-link         127.0.0.1    331',
  '      192.168.1.0    255.255.255.0         On-link      192.168.1.23    306',
  '===========================================================================',
  'Persistent Routes:',
  '  Network Address          Netmask  Gateway Address  Metric',
  '          0.0.0.0          0.0.0.0      192.168.1.1  Default',
  '===========================================================================',
  '',
  'IPv6 Route Table',
  '===========================================================================',
  'Active Routes:',
  ' If Metric Network Destination      Gateway',
  ' 12    306 ::/0                     fe80::1',
  '===========================================================================',
  'Persistent Routes:',
  '  None'
].join('\r\n')

describe('default route parsing', () => {
  it('takes the interface address of the lowest-metric IPv4 default route from netstat -r', () => {
    expect(parseWindowsDefaultRoute(NETSTAT)).toBe('10.8.0.6')
    expect(parseWindowsDefaultRoute(NETSTAT.replace('     25', '     75'))).toBe('192.168.1.23')
  })

  it('ignores on-link, persistent and IPv6 rows and reports no route when there is none', () => {
    const noDefault = NETSTAT.split('\r\n')
      .filter((line) => !/^\s*0\.0\.0\.0\s+0\.0\.0\.0\s.*\d$/.test(line))
      .join('\r\n')
    expect(parseWindowsDefaultRoute(noDefault)).toBeNull()
    expect(parseWindowsDefaultRoute('')).toBeNull()
  })

  it('takes the device of the lowest-metric default route from ip route', () => {
    const output = [
      'default via 192.168.1.1 dev wlp2s0 proto dhcp src 192.168.1.23 metric 600',
      'default via 10.0.0.1 dev enp3s0 proto static metric 100',
      '192.168.1.0/24 dev wlp2s0 proto kernel scope link src 192.168.1.23 metric 600'
    ].join('\n')
    expect(parseLinuxDefaultRoute(output)).toBe('enp3s0')
    expect(parseLinuxDefaultRoute('default dev tun0 scope link\n')).toBe('tun0')
    expect(parseLinuxDefaultRoute('')).toBeNull()
  })

  it('takes the interface line from route -n get default', () => {
    const output = [
      '   route to: default',
      'destination: default',
      '       mask: default',
      '    gateway: 192.168.1.1',
      '  interface: en0',
      '      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING,GLOBAL>'
    ].join('\n')
    expect(parseDarwinDefaultRoute(output)).toBe('en0')
    expect(parseDarwinDefaultRoute('route: writing to routing socket: not in table')).toBeNull()
  })
})

describe('interface lookup', () => {
  const interfaces = {
    'Loopback Pseudo-Interface 1': [address('127.0.0.1', true)],
    'vEthernet (WSL)': [address('fe80::5', false, 40), address('172.20.0.1')],
    'Wi-Fi': [address('fe80::1', false, 12), address('192.168.1.23')]
  }

  it('maps a route address to the adapter that owns it', () => {
    expect(interfaceWithAddress(interfaces, '192.168.1.23')).toBe('Wi-Fi')
    expect(interfaceWithAddress(interfaces, '10.9.9.9')).toBeNull()
  })

  it('falls back like systeminformation: lowest IPv6 scope id, then the first external adapter', () => {
    expect(firstExternalInterface(interfaces)).toBe('Wi-Fi')
    expect(
      firstExternalInterface({
        lo: [address('127.0.0.1', true)],
        eth0: [address('10.0.0.2')],
        eth1: [address('10.0.1.2')]
      })
    ).toBe('eth0')
    expect(firstExternalInterface({ lo: [address('127.0.0.1', true)] })).toBeNull()
  })

  // Adapter names on localized Windows, as os.networkInterfaces() reports them
  const localized = {
    'Connessione alla rete locale (LAN) 2': [address('10.0.0.5')],
    'Wi\u2011Fi': [address('192.168.1.23')], // non-breaking hyphen
    'Ethernet \u2014 Ufficio': [address('172.16.0.9')], // em dash
    '\u0421\u0435\u0442\u044c': [address('10.8.0.6')] // Cyrillic 'network'
  }

  it('maps route addresses to non-ASCII adapter names unchanged', () => {
    expect(interfaceWithAddress(localized, '10.0.0.5')).toBe('Connessione alla rete locale (LAN) 2')
    expect(interfaceWithAddress(localized, '192.168.1.23')).toBe('Wi\u2011Fi')
    expect(interfaceWithAddress(localized, '172.16.0.9')).toBe('Ethernet \u2014 Ufficio')
    expect(interfaceWithAddress(localized, '10.8.0.6')).toBe('\u0421\u0435\u0442\u044c')
  })

  it('resolves the Windows default route to a non-ASCII adapter name', async () => {
    vi.mocked(os.networkInterfaces).mockReturnValue(localized)
    vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
      const done = args.at(-1) as (error: null, result: { stdout: string }) => void
      done(null, { stdout: NETSTAT })
    }) as never)
    // The lowest-metric default route goes out through 10.8.0.6
    expect(await resolveDefaultInterface('win32')).toBe('\u0421\u0435\u0442\u044c')
    expect(execFile).toHaveBeenCalledWith(
      'netstat',
      ['-r'],
      expect.anything(),
      expect.any(Function)
    )
  })
})

describe('default interface cache', () => {
  const setup = (names: Array<string | null>, present = (name: string) => name !== 'gone') => {
    const resolve = vi.fn(async () => names.shift() ?? null)
    return { cache: new DefaultInterfaceCache(resolve, present), resolve }
  }

  it('resolves once, then answers from the cache until the refresh interval passes', async () => {
    const { cache, resolve } = setup(['Wi-Fi', 'Ethernet'])
    expect(await cache.get(0)).toBe('Wi-Fi')
    expect(await cache.get(INTERFACE_REFRESH_MS - 1)).toBe('Wi-Fi')
    expect(resolve).toHaveBeenCalledTimes(1)
    // A due refresh runs in the background; the cached name answers meanwhile
    expect(await cache.get(INTERFACE_REFRESH_MS)).toBe('Wi-Fi')
    expect(resolve).toHaveBeenCalledTimes(2)
    await new Promise((settle) => setTimeout(settle, 0))
    expect(await cache.get(INTERFACE_REFRESH_MS + 1)).toBe('Ethernet')
  })

  it('shares one lookup between concurrent callers', async () => {
    const { cache, resolve } = setup(['Wi-Fi'])
    expect(await Promise.all([cache.get(0), cache.get(1)])).toEqual(['Wi-Fi', 'Wi-Fi'])
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('looks again after a stats failure, but not more often than the retry interval', async () => {
    const { cache, resolve } = setup(['Wi-Fi', 'Ethernet'])
    await cache.get(0)
    cache.invalidate()
    expect(await cache.get(INTERFACE_RETRY_MS - 1)).toBe('Wi-Fi')
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(await cache.get(INTERFACE_RETRY_MS)).toBe('Ethernet')
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(await cache.get(INTERFACE_RETRY_MS * 2)).toBe('Ethernet')
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('treats a cached adapter that disappeared like a failure', async () => {
    const { cache, resolve } = setup(['gone', 'Ethernet'])
    expect(await cache.get(0)).toBe('gone')
    expect(await cache.get(INTERFACE_RETRY_MS)).toBe('Ethernet')
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('retries a failed or empty lookup after the retry interval', async () => {
    const resolve = vi
      .fn<() => Promise<string | null>>()
      .mockRejectedValueOnce(new Error('netstat failed'))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('Wi-Fi')
    const cache = new DefaultInterfaceCache(resolve, () => true)
    expect(await cache.get(0)).toBeNull()
    expect(await cache.get(1)).toBeNull()
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(await cache.get(INTERFACE_RETRY_MS)).toBeNull()
    expect(await cache.get(INTERFACE_RETRY_MS * 2)).toBe('Wi-Fi')
  })
})
