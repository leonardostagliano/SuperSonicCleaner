import { describe, it, expect, vi } from 'vitest'
import { createDriveCache, readSystemDrive } from './system-drive'
import type { DriveInfo } from '../../shared/types'

const drive = (letter: string, extra: Partial<DriveInfo> = {}): DriveInfo => ({
  letter,
  label: `Disk ${letter}`,
  isSystem: letter === 'C',
  totalSize: 100,
  freeSpace: 40,
  usedSpace: 60,
  ...extra
})

describe('createDriveCache', () => {
  it('reuses the list within the TTL and reloads after it', async () => {
    let now = 0
    const load = vi.fn(async () => [drive('C')])
    const cache = createDriveCache(load, 30_000, () => now)
    await cache.get()
    now = 29_999
    await cache.get()
    expect(load).toHaveBeenCalledTimes(1)
    now = 30_000
    await cache.get()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('shares one load between concurrent callers', async () => {
    const load = vi.fn(async () => [drive('C')])
    const cache = createDriveCache(load)
    await Promise.all([cache.get(), cache.get(), cache.get()])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed load', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('powershell'))
      .mockResolvedValue([drive('C')])
    const cache = createDriveCache(load)
    await expect(cache.get()).rejects.toThrow('powershell')
    await expect(cache.get()).resolves.toHaveLength(1)
  })

  it('does not cache an empty result', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([drive('C')])
    const cache = createDriveCache(load)
    await expect(cache.get()).resolves.toEqual([])
    await expect(cache.get()).resolves.toHaveLength(1)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('peeks at the cached list without loading it', async () => {
    const load = vi.fn(async () => [drive('C')])
    const cache = createDriveCache(load)
    expect(cache.peek()).toBeNull()
    expect(load).not.toHaveBeenCalled()
    await cache.get()
    expect(cache.peek()).toHaveLength(1)
  })

  it('reloads after invalidate', async () => {
    const load = vi.fn(async () => [drive('C')])
    const cache = createDriveCache(load)
    await cache.get()
    cache.invalidate()
    await cache.get()
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('readSystemDrive', () => {
  const statfsFn = vi.fn(async () => ({ bsize: 4096, blocks: 1000, bavail: 250 }))

  it('reads the Windows system drive with statfs', async () => {
    const result = await readSystemDrive({
      env: { SystemDrive: 'D:' },
      platform: 'win32',
      statfsFn
    })
    expect(statfsFn).toHaveBeenCalledWith('D:\\')
    expect(result).toEqual({
      letter: 'D',
      label: 'D',
      isSystem: true,
      totalSize: 4096 * 1000,
      freeSpace: 4096 * 250,
      usedSpace: 4096 * 750
    })
  })

  it('keeps the label of a known drive', async () => {
    const result = await readSystemDrive({
      env: { SystemDrive: 'C:' },
      platform: 'win32',
      statfsFn,
      knownDrives: [drive('C', { label: 'Windows' })]
    })
    expect(result?.label).toBe('Windows')
  })

  it('returns null off Windows and when statfs fails', async () => {
    expect(await readSystemDrive({ platform: 'linux', statfsFn })).toBeNull()
    const failing = vi.fn(async () => {
      throw new Error('EPERM')
    })
    expect(await readSystemDrive({ platform: 'win32', env: {}, statfsFn: failing })).toBeNull()
  })
})
