/**
 * Counters no longer count up (spec 3.5): the value is shown as measured, at once.
 * Kept as a pass-through with the old signature so existing callers compile; the lanes
 * drop their uses and Task C1 deletes the hook.
 * @deprecated Render the value directly.
 */
export function useAnimatedCounter(target: number, _duration = 800): number {
  return target
}
