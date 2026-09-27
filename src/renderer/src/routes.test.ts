import { describe, it, expect, vi } from 'vitest'
import { PAGE_ENTRIES, prefetchRoute } from './routes'

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
})
