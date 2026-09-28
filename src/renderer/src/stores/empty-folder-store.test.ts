import { beforeEach, describe, expect, it } from 'vitest'
import { useEmptyFolderStore } from './empty-folder-store'

describe('empty-folder-store deletion record', () => {
  beforeEach(() => {
    useEmptyFolderStore.getState().reset()
    useEmptyFolderStore.getState().setDeleteMode('recycle')
  })

  it('keeps when the last deletion finished and where the files went', () => {
    const before = Date.now()
    const store = useEmptyFolderStore.getState()
    store.setDeleteResult({ deleted: 1, failed: 0, errors: [] }, 'permanent')
    const state = useEmptyFolderStore.getState()
    expect(state.deletedMode).toBe('permanent')
    expect(state.deletedAt).toBeGreaterThanOrEqual(before)
  })

  it('records the current mode by default and forgets it on reset', () => {
    const store = useEmptyFolderStore.getState()
    store.setDeleteResult({ deleted: 1, failed: 0, errors: [] })
    expect(useEmptyFolderStore.getState().deletedMode).toBe('recycle')
    store.reset()
    expect(useEmptyFolderStore.getState().deletedAt).toBeNull()
    expect(useEmptyFolderStore.getState().deletedMode).toBeNull()
  })
})
