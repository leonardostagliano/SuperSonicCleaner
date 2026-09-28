export interface ScanStage {
  key: string
  label: string
  state: 'done' | 'current' | 'todo'
}

/** Mark the stages before `current` done and the rest to do; unknown stages are all to do. */
export function stagesFor(
  order: readonly string[],
  current: string | undefined,
  label: (key: string) => string
): ScanStage[] {
  const at = current ? order.indexOf(current) : -1
  return order.map((key, index) => ({
    key,
    label: label(key),
    state: at === -1 || index > at ? 'todo' : index === at ? 'current' : 'done'
  }))
}
