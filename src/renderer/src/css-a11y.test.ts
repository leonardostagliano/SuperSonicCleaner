// Accessibility rules that live in stylesheets: a visible focus ring on menu options,
// checkbox and switch states that survive Windows High Contrast, and chart times laid
// out in the same direction as the chart. The test reads the CSS files themselves.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = (file: string) =>
  readFileSync(path.resolve(__dirname, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The declarations of every rule whose selector list includes `selector`. */
function declarationsFor(source: string, selector: string): string[] {
  const bodies: string[] = []
  for (const [, selectors, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.split(',').some((s) => s.trim() === selector)) bodies.push(body)
  }
  return bodies
}

/** The text of an `@media (…)` block, nested rules included. */
function mediaBlock(source: string, query: string): string {
  const start = source.indexOf(`@media ${query}`)
  if (start < 0) return ''
  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1)
  }
  return ''
}

describe('menu options', () => {
  it.each([
    ['components/software/software.css', '.sw-menu .sw-menu-item:focus-visible'],
    ['components/cleaner/pulizia.css', '.pulizia-menu-item:focus-visible']
  ])('%s draws a focus ring on the focused option', (file, selector) => {
    const rules = declarationsFor(css(file), selector)
    expect(rules.length).toBeGreaterThan(0)
    expect(rules.join(';')).not.toMatch(/outline\s*:\s*none/)
    expect(rules.join(';')).toMatch(/outline\s*:\s*2px solid var\(--focus\)/)
  })
})

describe('forced colors', () => {
  const block = mediaBlock(css('components/ui/ui.css'), '(forced-colors: active)')

  it('draws the checkbox states with system colours', () => {
    expect(block).toContain('.ui-checkbox:checked')
    expect(block).toContain('.ui-checkbox:indeterminate')
    expect(block).toMatch(/\.ui-checkbox::before\s*\{[^}]*HighlightText/)
    expect(block).toMatch(/forced-color-adjust\s*:\s*none/)
  })

  it('keeps the switch thumb visible', () => {
    expect(block).toMatch(/\.ui-switch[^{]*\{[^}]*--ui-switch-thumb\s*:\s*CanvasText/)
    expect(block).toMatch(/\.ui-switch\[aria-checked='true'\][^{]*\{[^}]*HighlightText/)
  })
})

describe('chart times', () => {
  it('are laid out left to right like the chart they label', () => {
    expect(declarationsFor(css('components/perf/perf.css'), '.perf-chart-times').join(';')).toMatch(
      /direction\s*:\s*ltr/
    )
  })
})
