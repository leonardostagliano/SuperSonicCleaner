// WCAG contrast of the report tokens in both themes. The test reads
// design-tokens.css itself, so a token edit that breaks a pair fails here.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

type Rgba = { r: number; g: number; b: number; a: number }
type Theme = 'dark' | 'light'

const source = readFileSync(path.resolve(__dirname, 'design-tokens.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
)

/** Custom properties of every top-level `selector { … }` block, later declarations winning. */
function declarations(selector: ':root' | '.light'): Record<string, string> {
  const vars: Record<string, string> = {}
  const blocks = new RegExp(`(?:^|\\})\\s*${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g')
  for (const [, body] of source.matchAll(blocks)) {
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      vars[name] = value.trim()
    }
  }
  return vars
}

const root = declarations(':root')
const themes: Record<Theme, Record<string, string>> = {
  dark: root,
  light: { ...root, ...declarations('.light') }
}

function resolveToken(vars: Record<string, string>, name: string): string {
  let value = vars[name]
  for (let depth = 0; value !== undefined && depth < 10; depth++) {
    const ref = /^var\((--[\w-]+)(?:\s*,\s*(.+))?\)$/.exec(value)
    if (!ref) return value
    value = vars[ref[1]] ?? ref[2]
  }
  throw new Error(`${name} does not resolve to a value`)
}

function parseHex(value: string): Rgba {
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value)?.[1]
  if (!hex) throw new Error(`not a hex colour: ${value}`)
  const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex
  const channel = (i: number): number => parseInt(full.slice(i * 2, i * 2 + 2), 16)
  return {
    r: channel(0),
    g: channel(1),
    b: channel(2),
    a: full.length === 8 ? channel(3) / 255 : 1
  }
}

/** `top` painted over an opaque `bottom`. */
function over(top: Rgba, bottom: Rgba): Rgba {
  const mix = (t: number, b: number): number => t * top.a + b * (1 - top.a)
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 }
}

function luminance({ r, g, b }: Rgba): number {
  const linear = (c: number): number => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function ratio(fg: Rgba, bg: Rgba): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Contrast of token `fg` on token `bg`; translucent colours are composited first. */
function contrast(theme: Theme, fg: string, bg: string): number {
  const vars = themes[theme]
  const page = parseHex(resolveToken(vars, '--page-bg'))
  const background = over(parseHex(resolveToken(vars, bg)), page)
  return ratio(over(parseHex(resolveToken(vars, fg)), background), background)
}

const pairs = (fgs: string[], bgs: string[], min: number): [string, string, number][] =>
  fgs.flatMap((fg) => bgs.map((bg): [string, string, number] => [fg, bg, min]))

const PAIRS: [string, string, number][] = [
  ...pairs(
    ['--text-primary', '--text-secondary', '--text-muted'],
    ['--page-bg', '--card-bg', '--surface'],
    4.5
  ),
  ...pairs(
    ['--signal-rec-text', '--signal-ok-text', '--signal-danger-text'],
    ['--page-bg', '--card-bg'],
    4.5
  ),
  ['--primary-fg', '--primary-bg', 4.5],
  ['--danger-button-fg', '--danger-button-bg', 4.5],
  // Control edges and chart series are non-text: 3:1.
  ['--border-strong', '--card-bg', 3],
  ['--chart-1', '--card-bg', 3],
  ['--chart-2', '--card-bg', 3]
]

describe('design token contrast', () => {
  it('computes WCAG ratios', () => {
    expect(ratio(parseHex('#000'), parseHex('#fff'))).toBeCloseTo(21, 5)
    expect(ratio(parseHex('#767676'), parseHex('#ffffff'))).toBeGreaterThan(4.5)
    expect(ratio(parseHex('#777777'), parseHex('#ffffff'))).toBeLessThan(4.5)
    expect(over(parseHex('#ffffff80'), parseHex('#000000')).r).toBeCloseTo(128, 5)
  })

  for (const theme of ['dark', 'light'] as const) {
    it.each(PAIRS)(`${theme}: %s on %s reaches %s:1`, (fg, bg, min) => {
      const value = contrast(theme, fg, bg)
      expect(value, `${theme} ${fg} on ${bg} = ${value.toFixed(2)}:1`).toBeGreaterThanOrEqual(min)
    })
  }
})
