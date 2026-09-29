import { describe, expect, it } from 'vitest'
import { NAV_FADE_PX, navFade } from './nav-fade'

const nav = (scrollTop: number, hidden: number) => ({
  scrollTop,
  clientHeight: 660,
  scrollHeight: 660 + hidden
})

describe('navFade', () => {
  it('fades nothing when the whole list fits', () => {
    expect(navFade(nav(0, 0))).toEqual({ top: 0, bottom: 0 })
  })

  it('leaves the last row sharp when only its rest and the padding are hidden', () => {
    // German at 900 px: the second line of the last group sits right at the edge.
    expect(navFade(nav(0, 20))).toEqual({ top: 0, bottom: 0 })
    expect(navFade(nav(0, NAV_FADE_PX))).toEqual({ top: 0, bottom: 0 })
  })

  it('fades the full length when at least a row is hidden, as before', () => {
    expect(navFade(nav(0, 120))).toEqual({ top: 0, bottom: NAV_FADE_PX })
    expect(navFade(nav(120, 120))).toEqual({ top: NAV_FADE_PX, bottom: 0 })
    expect(navFade(nav(60, 120))).toEqual({ top: NAV_FADE_PX, bottom: NAV_FADE_PX })
  })

  it('grows the fade with what is hidden, so it never appears all at once', () => {
    expect(navFade(nav(0, NAV_FADE_PX + 8))).toEqual({ top: 0, bottom: 8 })
    expect(navFade(nav(NAV_FADE_PX + 5, 200))).toEqual({ top: 5, bottom: NAV_FADE_PX })
  })
})
