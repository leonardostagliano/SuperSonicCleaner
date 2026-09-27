import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '@shared/types'
import { useAppUpdateStore } from './app-update-store'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe('app-update-store', () => {
  beforeEach(() => {
    useAppUpdateStore.setState({
      status: { state: 'idle' },
      pending: false,
      dismissedVersion: null
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps a live event when an earlier status snapshot resolves afterward', async () => {
    const snapshot = deferred<UpdateStatus>()
    const unsubscribe = vi.fn()
    let publishStatus!: (status: UpdateStatus) => void
    vi.stubGlobal('window', {
      kudu: {
        updaterGetStatus: vi.fn(() => snapshot.promise),
        onUpdaterStatus: vi.fn((callback: (status: UpdateStatus) => void) => {
          publishStatus = callback
          return unsubscribe
        })
      }
    })

    const cleanup = useAppUpdateStore.getState().init()
    publishStatus({ state: 'available', version: '2.0.0' })
    snapshot.resolve({ state: 'checking' })
    await snapshot.promise

    expect(useAppUpdateStore.getState().status).toEqual({ state: 'available', version: '2.0.0' })
    cleanup()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('ignores a pending snapshot and later events after cleanup', async () => {
    const snapshot = deferred<UpdateStatus>()
    const unsubscribe = vi.fn()
    let publishStatus!: (status: UpdateStatus) => void
    vi.stubGlobal('window', {
      kudu: {
        updaterGetStatus: vi.fn(() => snapshot.promise),
        onUpdaterStatus: vi.fn((callback: (status: UpdateStatus) => void) => {
          publishStatus = callback
          return unsubscribe
        })
      }
    })

    const cleanup = useAppUpdateStore.getState().init()
    cleanup()
    snapshot.resolve({ state: 'available', version: '2.0.0' })
    await snapshot.promise
    publishStatus({ state: 'downloaded', version: '2.0.0' })

    expect(useAppUpdateStore.getState().status).toEqual({ state: 'idle' })
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('surfaces a failed IPC action and clears pending', async () => {
    const updaterCheck = vi.fn().mockRejectedValue(new Error('Update service unavailable'))
    vi.stubGlobal('window', { kudu: { updaterCheck } })

    await useAppUpdateStore.getState().check()

    expect(updaterCheck).toHaveBeenCalledOnce()
    expect(useAppUpdateStore.getState()).toMatchObject({
      pending: false,
      status: { state: 'error', error: 'Update service unavailable' }
    })
  })

  it('invokes an action once when clicked twice while pending', async () => {
    const request = deferred<void>()
    const updaterDownload = vi.fn(() => request.promise)
    vi.stubGlobal('window', { kudu: { updaterDownload } })

    const firstClick = useAppUpdateStore.getState().download()
    const secondClick = useAppUpdateStore.getState().download()

    expect(updaterDownload).toHaveBeenCalledOnce()
    expect(useAppUpdateStore.getState().pending).toBe(true)
    await secondClick
    request.resolve(undefined)
    await firstClick
    expect(useAppUpdateStore.getState().pending).toBe(false)
  })

  it('dismisses the current version and allows the next version to be dismissed separately', () => {
    useAppUpdateStore.getState().setStatus({ state: 'available', version: '2.0.0' })
    useAppUpdateStore.getState().dismiss()
    expect(useAppUpdateStore.getState().dismissedVersion).toBe('2.0.0')

    useAppUpdateStore.getState().setStatus({ state: 'available', version: '2.1.0' })
    expect(useAppUpdateStore.getState().dismissedVersion).toBe('2.0.0')

    useAppUpdateStore.getState().dismiss()
    expect(useAppUpdateStore.getState().dismissedVersion).toBe('2.1.0')
  })
})
