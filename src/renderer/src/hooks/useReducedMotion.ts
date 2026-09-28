import { useSyncExternalStore } from 'react'

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** The part of `MediaQueryList` the hook relies on, so tests can pass a stand-in. */
interface MotionQueryList {
  matches: boolean
  addEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void
  removeEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void
}
export type MatchMediaImpl = (query: string) => MotionQueryList

/** True when the system asks for reduced motion. Without `matchMedia`, motion is allowed. */
export function prefersReducedMotion(matchMediaImpl: MatchMediaImpl | undefined): boolean {
  return matchMediaImpl?.(REDUCED_MOTION_QUERY).matches === true
}

/** Calls `onChange` whenever the preference changes; returns the unsubscribe function. */
export function subscribeReducedMotion(
  matchMediaImpl: MatchMediaImpl | undefined,
  onChange: (reduced: boolean) => void
): () => void {
  const list = matchMediaImpl?.(REDUCED_MOTION_QUERY)
  if (!list) return () => {}
  const listener = (event: { matches: boolean }) => onChange(event.matches)
  list.addEventListener('change', listener)
  return () => list.removeEventListener('change', listener)
}

const windowMatchMedia = (): MatchMediaImpl | undefined =>
  typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? undefined
    : (query) => window.matchMedia(query)

const subscribe = (onStoreChange: () => void) =>
  subscribeReducedMotion(windowMatchMedia(), onStoreChange)
const getSnapshot = () => prefersReducedMotion(windowMatchMedia())

/** Follows `prefers-reduced-motion: reduce` live, for motion that CSS alone cannot switch off. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
