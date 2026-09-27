import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { DriveInfo } from '@shared/types'
import { mergeSystemDrive, useDrivesStore } from './drives-store'

const drive = (letter: string, extra: Partial<DriveInfo> = {}): DriveInfo => ({
  letter,
  label: `Disk ${letter}`,
  isSystem: letter === 'C',
  totalSize: 100,
  freeSpace: 40,
  usedSpace: 60,
  ...extra
})

function stubKudu(api: Record<string, unknown>) {
  vi.stubGlobal('window', { kudu: api })
}

beforeEach(() => useDrivesStore.setState({ drives: [], status: 'idle' }))
afterEach(() => vi.unstubAllGlobals())

describe('mergeSystemDrive', () => {
  it('refreshes the system entry, keeping the list label', () => {
    const merged = mergeSystemDrive(
      [drive('C', { label: 'Windows' }), drive('D')],
      drive('C', { label: 'C', freeSpace: 10 })
    )
    expect(merged[0]).toMatchObject({ letter: 'C', label: 'Windows', freeSpace: 10 })
    expect(merged[1].letter).toBe('D')
  })

  it('adds the system drive when the list has none', () => {
    expect(mergeSystemDrive([drive('D')], drive('C')).map((d) => d.letter)).toEqual(['C', 'D'])
  })
})

describe('useDrivesStore.refresh', () => {
  it('shows the fresh system drive over a cached list', async () => {
    stubKudu({
      diskSystemDrive: vi.fn(async () => drive('C', { freeSpace: 5 })),
      diskDrives: vi.fn(async () => [drive('C', { label: 'Windows', freeSpace: 40 }), drive('D')])
    })
    await useDrivesStore.getState().refresh()
    const { drives, status } = useDrivesStore.getState()
    expect(status).toBe('ready')
    expect(drives.find((d) => d.isSystem)).toMatchObject({ label: 'Windows', freeSpace: 5 })
    expect(drives).toHaveLength(2)
  })

  it('keeps showing the last drives while revalidating', async () => {
    useDrivesStore.setState({ drives: [drive('C')], status: 'ready' })
    let release: () => void = () => {}
    stubKudu({
      diskSystemDrive: vi.fn(() => new Promise((r) => (release = () => r(null)))),
      diskDrives: vi.fn(async () => [drive('C')])
    })
    const pending = useDrivesStore.getState().refresh()
    expect(useDrivesStore.getState().status).toBe('ready')
    release()
    await pending
  })

  it('runs one refresh at a time', async () => {
    const diskDrives = vi.fn(async () => [drive('C')])
    stubKudu({ diskSystemDrive: vi.fn(async () => null), diskDrives })
    await Promise.all([useDrivesStore.getState().refresh(), useDrivesStore.getState().refresh()])
    expect(diskDrives).toHaveBeenCalledTimes(1)
  })

  it('passes fresh through to diskDrives', async () => {
    const diskDrives = vi.fn(async () => [drive('C')])
    stubKudu({ diskSystemDrive: vi.fn(async () => null), diskDrives })
    await useDrivesStore.getState().refresh({ fresh: true })
    expect(diskDrives).toHaveBeenCalledWith({ fresh: true })
  })

  it('reports unavailable when nothing is known', async () => {
    stubKudu({
      diskSystemDrive: vi.fn(async () => null),
      diskDrives: vi.fn(async () => {
        throw new Error('boom')
      })
    })
    await useDrivesStore.getState().refresh()
    expect(useDrivesStore.getState().status).toBe('unavailable')
  })
})
