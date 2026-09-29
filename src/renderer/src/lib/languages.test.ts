import { describe, expect, it } from 'vitest'
import { toastPlacement } from './languages'

describe('toastPlacement', () => {
  it('keeps toasts at the end of the reading direction', () => {
    expect(toastPlacement('en')).toEqual({ position: 'bottom-right', dir: 'ltr' })
    expect(toastPlacement('it')).toEqual({ position: 'bottom-right', dir: 'ltr' })
    expect(toastPlacement('ar')).toEqual({ position: 'bottom-left', dir: 'rtl' })
    expect(toastPlacement('he')).toEqual({ position: 'bottom-left', dir: 'rtl' })
  })
})
