import { describe, it, expect, vi } from 'vitest'
import { PAGE_ENTRIES, prefetchRoute, retryPageLoad, LazyPages } from './routes'

const ROUTED = [
  '/cleaner',
  '/registry',
  '/context-menu',
  '/startup',
  '/storage-history',
  '/disk',
  '/duplicates',
  '/large-files',
  '/empty-folders',
  '/file-shredder',
  '/disk-repair',
  '/disk-maintenance',
  '/network',
  '/malware',
  '/game-mode',
  '/performance-diagnostics',
  '/performance',
  '/uninstaller',
  '/history',
  '/recovery',
  '/settings',
  '/about',
  '/ai',
  '/privacy',
  '/services',
  '/firewall',
  '/debloater',
  '/updates',
  '/schedules',
  '/drivers'
]

describe('lazy routes', () => {
  it('has a loader for every routed page except Home', () => {
    expect(Object.keys(PAGE_ENTRIES).sort()).toEqual([...ROUTED].sort())
  })

  it('loads a page module once however often it is prefetched', async () => {
    const load = vi.fn(async () => ({ TestPage: () => null }))
    PAGE_ENTRIES['/__test'] = { load, exportName: 'TestPage' }
    prefetchRoute('/__test')
    prefetchRoute('/__test')
    await Promise.resolve()
    expect(load).toHaveBeenCalledTimes(1)
    delete PAGE_ENTRIES['/__test']
  })

  it('retries a prefetch that failed', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({})
    PAGE_ENTRIES['/__retry'] = { load, exportName: 'X' }
    prefetchRoute('/__retry')
    await new Promise((r) => setTimeout(r, 0))
    prefetchRoute('/__retry')
    expect(load).toHaveBeenCalledTimes(2)
    delete PAGE_ENTRIES['/__retry']
  })

  it('ignores unknown paths', () => {
    expect(() => prefetchRoute('/nope')).not.toThrow()
  })

  it('retries a page load that failed by creating a fresh lazy component', () => {
    // React's `lazy()` calls its loader once per instance and remembers a
    // rejection forever, so the only way to make a page whose chunk failed to
    // load try again is to swap in a brand-new lazy component for that route
    // — reusing the same one would just re-throw the cached rejection.
    const before = LazyPages['/about']()
    retryPageLoad('/about')
    const after = LazyPages['/about']()
    expect(after.type).not.toBe(before.type)
  })

  it('does nothing when retrying an unknown path', () => {
    expect(() => retryPageLoad('/nope')).not.toThrow()
  })
})
