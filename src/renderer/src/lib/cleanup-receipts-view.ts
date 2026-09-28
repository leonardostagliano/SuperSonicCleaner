/**
 * What the cleanup receipts view shows around its list. With no receipts the empty
 * state carries the description, so the toolbar leaves it out: it is said once.
 */
export function receiptsListView(state: { loading: boolean; count: number; error: boolean }): {
  empty: boolean
  toolbarDescription: boolean
} {
  const empty = !state.loading && state.count === 0 && !state.error
  return { empty, toolbarDescription: !empty }
}
