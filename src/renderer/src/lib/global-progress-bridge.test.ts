import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DuplicateScanProgress } from '@shared/types'
import { useDuplicateStore } from '@/stores/duplicate-store'
import { initGlobalProgressBridge } from './global-progress-bridge'

const progress: DuplicateScanProgress = {
  phase: 'walking',
  currentPath: 'C:\\sample',
  filesScanned: 12,
  duplicatesFound: 2,
  reclaimableSpace: 100,
  progress: 40
}

describe('global progress bridge', () => {
  let callbacks: Map<string, Set<(value: unknown) => void>>
  let unsubscribeCount: number

  beforeEach(() => {
    useDuplicateStore.getState().reset()
    callbacks = new Map()
    unsubscribeCount = 0
    vi.stubGlobal('window', {
      kudu: new Proxy(
        {},
        {
          get: (_target, name: string) => (callback: (value: unknown) => void) => {
            const listeners = callbacks.get(name) ?? new Set()
            listeners.add(callback)
            callbacks.set(name, listeners)
            return () => {
              listeners.delete(callback)
              unsubscribeCount++
            }
          }
        }
      )
    })
  })

  const emit = (callbacks: Map<string, Set<(value: unknown) => void>>, value: unknown) => {
    callbacks.get('onDuplicatesProgress')?.forEach((callback) => callback(value))
  }

  it('updates an active scan without a page and ignores late events after completion', () => {
    const dispose = initGlobalProgressBridge()
    const store = useDuplicateStore.getState()
    store.setStatus('scanning')
    emit(callbacks, progress)
    expect(useDuplicateStore.getState().progress).toEqual(progress)

    // Completion may arrive while another route is displayed. The final
    // result remains authoritative even if a late IPC progress event follows.
    store.setStatus('complete')
    store.setProgress(null)
    emit(callbacks, { ...progress, progress: 100 })
    expect(useDuplicateStore.getState().progress).toBeNull()
    expect(useDuplicateStore.getState().status).toBe('complete')
    dispose()
  })

  it('shares one listener across mounts and disposes once after the last cleanup', () => {
    const first = initGlobalProgressBridge()
    const second = initGlobalProgressBridge()
    expect(callbacks.get('onDuplicatesProgress')?.size).toBe(1)
    first()
    expect(callbacks.get('onDuplicatesProgress')?.size).toBe(1)
    second()
    second()
    expect(callbacks.get('onDuplicatesProgress')?.size).toBe(0)
    expect(unsubscribeCount).toBeGreaterThan(0)

    const strictModeRemount = initGlobalProgressBridge()
    expect(callbacks.get('onDuplicatesProgress')?.size).toBe(1)
    strictModeRemount()
  })
})
