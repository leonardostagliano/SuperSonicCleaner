import { describe, expect, it } from 'vitest'
import { receiptsListView } from './cleanup-receipts-view'

describe('receiptsListView', () => {
  it('describes the receipts once: in the empty state when there are none', () => {
    expect(receiptsListView({ loading: false, count: 0, error: false })).toEqual({
      empty: true,
      toolbarDescription: false
    })
  })

  it('keeps the description in the toolbar next to a list, while loading and after an error', () => {
    const shown = { empty: false, toolbarDescription: true }
    expect(receiptsListView({ loading: false, count: 3, error: false })).toEqual(shown)
    expect(receiptsListView({ loading: true, count: 0, error: false })).toEqual(shown)
    expect(receiptsListView({ loading: false, count: 0, error: true })).toEqual(shown)
  })
})
