import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  REDUCED_MOTION_QUERY,
  prefersReducedMotion,
  subscribeReducedMotion,
  useReducedMotion
} from './useReducedMotion'

type Listener = (event: { matches: boolean }) => void

/** A matchMedia stand-in that records its listeners and can fire `change`. */
function fakeMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>()
  const queries: string[] = []
  const list = {
    matches: initial,
    addEventListener: vi.fn((type: string, listener: Listener) => {
      if (type === 'change') listeners.add(listener)
    }),
    removeEventListener: vi.fn((type: string, listener: Listener) => {
      if (type === 'change') listeners.delete(listener)
    })
  }
  const matchMedia = vi.fn((query: string) => {
    queries.push(query)
    return list
  })
  const change = (matches: boolean) => {
    list.matches = matches
    for (const listener of [...listeners]) listener({ matches })
  }
  return { matchMedia, list, listeners, queries, change }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('prefersReducedMotion', () => {
  it('reads the reduced-motion media query', () => {
    const media = fakeMatchMedia(true)
    expect(prefersReducedMotion(media.matchMedia)).toBe(true)
    expect(media.queries).toEqual([REDUCED_MOTION_QUERY])
    expect(REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)')
  })

  it('is false when motion is allowed', () => {
    expect(prefersReducedMotion(fakeMatchMedia(false).matchMedia)).toBe(false)
  })

  it('is false without matchMedia (no window, old engines)', () => {
    expect(prefersReducedMotion(undefined)).toBe(false)
  })
})

describe('subscribeReducedMotion', () => {
  it('reports each change of the preference', () => {
    const media = fakeMatchMedia(false)
    const seen: boolean[] = []
    subscribeReducedMotion(media.matchMedia, (reduced) => seen.push(reduced))
    media.change(true)
    media.change(false)
    expect(seen).toEqual([true, false])
    expect(media.list.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('stops listening once unsubscribed', () => {
    const media = fakeMatchMedia(false)
    const onChange = vi.fn()
    const unsubscribe = subscribeReducedMotion(media.matchMedia, onChange)
    expect(media.listeners.size).toBe(1)
    unsubscribe()
    expect(media.listeners.size).toBe(0)
    expect(media.list.removeEventListener).toHaveBeenCalledWith(
      'change',
      media.list.addEventListener.mock.calls[0][1]
    )
    media.change(true)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('is a no-op without matchMedia', () => {
    const onChange = vi.fn()
    const unsubscribe = subscribeReducedMotion(undefined, onChange)
    expect(() => unsubscribe()).not.toThrow()
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('useReducedMotion', () => {
  const Probe = () => createElement('span', null, String(useReducedMotion()))

  it('returns the current preference on first render', () => {
    vi.stubGlobal('window', { matchMedia: fakeMatchMedia(true).matchMedia })
    expect(renderToStaticMarkup(createElement(Probe))).toBe('<span>true</span>')
    vi.stubGlobal('window', { matchMedia: fakeMatchMedia(false).matchMedia })
    expect(renderToStaticMarkup(createElement(Probe))).toBe('<span>false</span>')
  })

  it('falls back to motion allowed without a window', () => {
    expect(renderToStaticMarkup(createElement(Probe))).toBe('<span>false</span>')
  })
})
