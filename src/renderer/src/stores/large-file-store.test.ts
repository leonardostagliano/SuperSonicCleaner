import { beforeEach, describe, expect, it } from 'vitest'
import { useLargeFileStore } from './large-file-store'

describe('large-file-store deletion record', () => {
  beforeEach(() => {
    useLargeFileStore.getState().reset()
    useLargeFileStore.getState().setDeleteMode('recycle')
  })

  it('keeps when the last deletion finished and where the files went', () => {
    const before = Date.now()
    const store = useLargeFileStore.getState()
    store.setDeleteResult({ deleted: 1, failed: 0, spaceRecovered: 10, errors: [] }, 'permanent')
    const state = useLargeFileStore.getState()
    expect(state.deletedMode).toBe('permanent')
    expect(state.deletedAt).toBeGreaterThanOrEqual(before)
  })

  it('records the current mode by default and forgets it on reset', () => {
    const store = useLargeFileStore.getState()
    store.setDeleteResult({ deleted: 1, failed: 0, spaceRecovered: 10, errors: [] })
    expect(useLargeFileStore.getState().deletedMode).toBe('recycle')
    store.reset()
    expect(useLargeFileStore.getState().deletedAt).toBeNull()
    expect(useLargeFileStore.getState().deletedMode).toBeNull()
  })
})
