import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CleanerType, ScanStatus } from '@shared/enums'
import type { ProgressData, ScanResult } from '@shared/types'
import { useScanStore } from '@/stores/scan-store'
import { lastCheckRun, useCheckRunsStore } from '@/stores/check-runs-store'
import { cancelCleanerScan, startCleanerScan } from './cleaner-scan'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function result(category: CleanerType, id: string): ScanResult[] {
  return [
    {
      category,
      subcategory: 'cache',
      items: [
        {
          id,
          path: `C:\\temp\\${id}`,
          category,
          subcategory: 'cache',
          size: 100,
          lastModified: Date.now(),
          selected: true
        }
      ],
      totalSize: 100,
      itemCount: 1
    }
  ]
}

const categories = [
  { type: CleanerType.System, label: 'System' },
  { type: CleanerType.Browser, label: 'Browser' }
]

describe('cleaner scan lifecycle', () => {
  let listeners: Set<(progress: ProgressData) => void>
  let systemScan: ReturnType<typeof vi.fn>
  let browserScan: ReturnType<typeof vi.fn>
  let unsubscribe: ReturnType<typeof vi.fn>

  beforeEach(() => {
    useScanStore.getState().reset()
    useCheckRunsStore.setState({ runs: {} })
    listeners = new Set()
    unsubscribe = vi.fn()
    systemScan = vi.fn().mockResolvedValue(result(CleanerType.System, 'system'))
    browserScan = vi.fn().mockResolvedValue(result(CleanerType.Browser, 'browser'))
    vi.stubGlobal('window', {
      kudu: {
        systemScan: (...args: unknown[]) => systemScan(...args),
        browserScan: (...args: unknown[]) => browserScan(...args),
        onScanProgress: (callback: (progress: ProgressData) => void) => {
          listeners.add(callback)
          return () => {
            listeners.delete(callback)
            unsubscribe()
          }
        }
      }
    })
  })

  it('keeps the scan and real engine progress alive without a mounted page', async () => {
    const system = deferred<ScanResult[]>()
    const browser = deferred<ScanResult[]>()
    systemScan.mockReturnValue(system.promise)
    browserScan.mockReturnValue(browser.promise)

    const running = startCleanerScan(categories)
    await Promise.resolve()
    expect(useScanStore.getState().status).toBe(ScanStatus.Scanning)
    expect(useScanStore.getState().scanningCategory).toBe(CleanerType.System)
    expect(listeners.size).toBe(1)

    for (const listener of listeners) {
      listener({
        phase: 'scanning',
        category: CleanerType.System,
        currentPath: 'C:\\temp',
        progress: 50,
        itemsFound: 2,
        sizeFound: 200
      })
    }
    expect(useScanStore.getState().progress?.progress).toBe(25)
    for (const listener of listeners) {
      listener({
        phase: 'scanning',
        category: CleanerType.System,
        currentPath: 'C:\\temp',
        progress: 0,
        itemsFound: 2,
        sizeFound: 200
      })
    }
    expect(useScanStore.getState().progress?.progress).toBe(25)

    system.resolve(result(CleanerType.System, 'system'))
    await vi.waitFor(() => expect(browserScan).toHaveBeenCalledTimes(1))
    expect(useScanStore.getState().progress?.progress).toBe(50)
    browser.resolve(result(CleanerType.Browser, 'browser'))
    await running

    expect(useScanStore.getState().results).toHaveLength(2)
    expect(useScanStore.getState().status).toBe(ScanStatus.Complete)
    expect(useScanStore.getState().scanningCategory).toBeNull()
    expect(listeners.size).toBe(0)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('cancels between categories and permits a clean restart', async () => {
    const system = deferred<ScanResult[]>()
    systemScan.mockReturnValueOnce(system.promise)
    const running = startCleanerScan(categories)
    await Promise.resolve()

    cancelCleanerScan()
    expect(useScanStore.getState().scanCancelRequested).toBe(true)
    expect(startCleanerScan(categories)).toBe(running)
    system.resolve(result(CleanerType.System, 'first'))
    await running
    expect(browserScan).not.toHaveBeenCalled()
    expect(useScanStore.getState().results).toHaveLength(1)
    expect(useScanStore.getState().scanCancelRequested).toBe(false)

    await startCleanerScan(categories)
    expect(systemScan).toHaveBeenCalledTimes(2)
    expect(browserScan).toHaveBeenCalledTimes(1)
    expect(useScanStore.getState().results).toHaveLength(2)
    expect(useScanStore.getState().status).toBe(ScanStatus.Complete)
  })

  it('passes a scanner step label through and records when the scan finished', async () => {
    const system = deferred<ScanResult[]>()
    systemScan.mockReturnValue(system.promise)
    const running = startCleanerScan(categories)
    await Promise.resolve()
    expect(useScanStore.getState().scannedAt).toBeNull()

    for (const listener of listeners) {
      listener({
        phase: 'scanning',
        category: CleanerType.System,
        currentPath: '',
        label: { key: 'cleaner:progress.pathEntries' },
        progress: 0,
        itemsFound: 0,
        sizeFound: 0
      })
    }
    const progress = useScanStore.getState().progress
    expect(progress?.label).toEqual({ key: 'cleaner:progress.pathEntries' })
    // Without a path the category label stays the fallback text.
    expect(progress?.currentPath).toBe('System')

    system.resolve(result(CleanerType.System, 'system'))
    await running
    expect(useScanStore.getState().scannedAt).toEqual(expect.any(Number))
  })

  it('records a scan time for a partial list stopped after a category', async () => {
    const system = deferred<ScanResult[]>()
    systemScan.mockReturnValueOnce(system.promise)
    const running = startCleanerScan(categories)
    await Promise.resolve()
    cancelCleanerScan()
    system.resolve(result(CleanerType.System, 'only'))
    await running
    expect(browserScan).not.toHaveBeenCalled()
    expect(useScanStore.getState().scannedAt).toEqual(expect.any(Number))
    expect(useScanStore.getState().status).toBe(ScanStatus.Complete)
  })

  it('records a completed cleanup check when the analysis finds a real result', async () => {
    await startCleanerScan(categories)
    expect(useScanStore.getState().status).toBe(ScanStatus.Complete)
    expect(lastCheckRun('cleanup')).toEqual(expect.any(Number))
  })

  // X1 fix 2: "Complete" with nothing but failures is not a completed check.
  it('does not record a cleanup check when every category fails', async () => {
    systemScan.mockRejectedValue(new Error('boom'))
    browserScan.mockRejectedValue(new Error('boom'))
    await startCleanerScan(categories)
    expect(useScanStore.getState().status).toBe(ScanStatus.Complete)
    expect(useScanStore.getState().failedCategories).toEqual(['System', 'Browser'])
    expect(lastCheckRun('cleanup')).toBeNull()
  })

  it('records a cleanup check when at least one category succeeds despite another failing', async () => {
    systemScan.mockRejectedValue(new Error('boom'))
    await startCleanerScan(categories)
    expect(useScanStore.getState().status).toBe(ScanStatus.Complete)
    expect(useScanStore.getState().failedCategories).toEqual(['System'])
    expect(lastCheckRun('cleanup')).toEqual(expect.any(Number))
  })

  it('does not record a cleanup check when the run was cancelled', async () => {
    const system = deferred<ScanResult[]>()
    systemScan.mockReturnValueOnce(system.promise)
    const running = startCleanerScan(categories)
    await Promise.resolve()
    cancelCleanerScan()
    system.resolve(result(CleanerType.System, 'only'))
    await running
    expect(useScanStore.getState().status).toBe(ScanStatus.Complete)
    expect(lastCheckRun('cleanup')).toBeNull()
  })

  it('does not record a cleanup check for a scan cancelled before anything completed', async () => {
    const running = startCleanerScan(categories)
    cancelCleanerScan()
    await running
    expect(useScanStore.getState().status).toBe(ScanStatus.Idle)
    expect(systemScan).not.toHaveBeenCalled()
    expect(lastCheckRun('cleanup')).toBeNull()
  })
})
