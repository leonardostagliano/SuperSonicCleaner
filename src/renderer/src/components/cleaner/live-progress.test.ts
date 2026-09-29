import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LiveProgress } from './LiveProgress'

/** The markup of the only element announced to screen readers. */
const liveRegion = (markup: string) => {
  const match = markup.match(/<(\w+)[^>]*role="status"[^>]*>(.*?)<\/\1>/)
  return match?.[2] ?? null
}

describe('LiveProgress', () => {
  const markup = renderToStaticMarkup(
    createElement(
      LiveProgress,
      {
        label: 'Scanning',
        value: 0.43,
        step: 'Browsers, 2 of 9',
        announcedPercent: '40%',
        detail: 'C:\\Users\\me\\AppData\\Local\\Temp\\file.tmp'
      },
      createElement('p', null, '12 items found · 3.40 MB')
    )
  )

  it('announces the stage and a rounded percentage in a single status line', () => {
    expect(liveRegion(markup)).toContain('Browsers, 2 of 9')
    expect(liveRegion(markup)).toContain('40%')
    expect(markup).not.toContain('aria-live')
    expect(markup.split('role="status"')).toHaveLength(2)
  })

  it('shows the path and the counts outside the announced line', () => {
    expect(markup).toContain('file.tmp')
    expect(markup).toContain('12 items found')
    expect(liveRegion(markup)).not.toContain('file.tmp')
    expect(liveRegion(markup)).not.toContain('12 items found')
  })

  it('keeps the status line when there is no stage, hidden from view', () => {
    const bare = renderToStaticMarkup(
      createElement(LiveProgress, { label: 'Fixing', value: 0.5, announcedPercent: '50%' })
    )
    expect(bare).toMatch(/<p class="sr-only" role="status">/)
    expect(liveRegion(bare)).toContain('50%')
  })
})
