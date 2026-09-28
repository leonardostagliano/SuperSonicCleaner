import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, createRef, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Trash2 } from 'lucide-react'
import {
  Button,
  Card,
  Checkbox,
  ListRow,
  ProgressBar,
  Section,
  Segmented,
  Switch,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tag
} from './index'

const html = (element: ReactElement) => renderToStaticMarkup(element)
const count = (markup: string, needle: string) => markup.split(needle).length - 1

describe('Button', () => {
  it('defaults to a secondary 32 px button that never submits a form by accident', () => {
    const markup = html(createElement(Button, null, 'Analizza'))
    expect(markup).toContain('class="ui-button"')
    expect(markup).toContain('data-variant="secondary"')
    expect(markup).toContain('data-size="md"')
    expect(markup).toContain('type="button"')
    expect(markup).toContain('<span class="ui-button-label">Analizza</span>')
    expect(markup).not.toContain('disabled')
  })

  it('passes variant, size, type, className and native attributes through', () => {
    const markup = html(
      createElement(
        Button,
        { variant: 'danger', size: 'lg', type: 'submit', className: 'mt-2', title: 'x' },
        'Elimina 2,34 GB'
      )
    )
    expect(markup).toContain('data-variant="danger"')
    expect(markup).toContain('data-size="lg"')
    expect(markup).toContain('type="submit"')
    expect(markup).toContain('class="ui-button mt-2"')
    expect(markup).toContain('title="x"')
  })

  it('draws the icon at 16 px with a 1.75 stroke before the label', () => {
    const markup = html(createElement(Button, { icon: Trash2 }, 'Elimina'))
    expect(markup.indexOf('<svg')).toBeLessThan(markup.indexOf('ui-button-label'))
    expect(markup).toContain('width="16"')
    expect(markup).toContain('stroke-width="1.75"')
    expect(markup).toContain('aria-hidden="true"')
  })

  it('busy: the spinner replaces the icon, the label stays, the button is disabled', () => {
    const markup = html(createElement(Button, { icon: Trash2, busy: true }, 'Elimina'))
    expect(count(markup, '<svg')).toBe(1)
    expect(markup).toContain('lucide-loader-circle')
    expect(markup).toContain('ui-spin')
    expect(markup).toContain('width="16"')
    expect(markup).not.toContain('lucide-trash')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('aria-busy="true"')
    // Same 16 px slot as the icon and the same label: the width does not change.
    expect(markup).toContain('<span class="ui-button-label">Elimina</span>')
    expect(markup).not.toContain('data-inline-busy')
  })

  it('busy without an icon: a 12 px glyph joins the visible label inside the same width', () => {
    const markup = html(createElement(Button, { busy: true }, 'Pulisci 2,34 GB'))
    // The label stays visible and in the accessibility tree: never hidden, never covered.
    expect(markup).toContain('<span class="ui-button-label">Pulisci 2,34 GB</span>')
    expect(markup).not.toMatch(/ui-button-label-busy|spinner-overlay|visibility/)
    expect(count(markup, '<svg')).toBe(1)
    expect(markup.indexOf('<svg')).toBeLessThan(markup.indexOf('ui-button-label'))
    expect(markup).toContain('width="12"')
    // The glyph and its gap take the side padding (see ui.css), so the width is unchanged.
    expect(markup).toContain('data-inline-busy=""')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('disabled=""')
  })

  it('idle buttons carry no busy state', () => {
    const markup = html(createElement(Button, { busy: false }, 'Pulisci'))
    expect(markup).not.toMatch(/aria-busy|data-inline-busy|disabled|<svg/)
  })

  describe('under prefers-reduced-motion', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })
    const reduceMotion = () =>
      vi.stubGlobal('window', {
        matchMedia: (query: string) => ({
          matches: query === '(prefers-reduced-motion: reduce)',
          addEventListener: () => {},
          removeEventListener: () => {}
        })
      })

    it('shows a static hourglass in place of the spinning glyph, with or without an icon', () => {
      reduceMotion()
      for (const props of [{ icon: Trash2, busy: true }, { busy: true }]) {
        const markup = html(createElement(Button, props, 'Pulisci 2,34 GB'))
        expect(markup).toContain('lucide-hourglass')
        expect(markup).not.toMatch(/ui-spin|lucide-loader-circle/)
        expect(markup).toContain('<span class="ui-button-label">Pulisci 2,34 GB</span>')
        expect(markup).toContain('aria-busy="true"')
      }
    })

    it('keeps idle buttons unchanged', () => {
      reduceMotion()
      expect(html(createElement(Button, { icon: Trash2 }, 'Elimina'))).toContain('lucide-trash')
    })
  })

  it('marks icon-only buttons so they stay square', () => {
    const markup = html(createElement(Button, { icon: Trash2, 'aria-label': 'Elimina' }))
    expect(markup).toContain('data-icon-only=""')
    expect(markup).not.toContain('ui-button-label')
  })

  it('forwards its ref to the button element', () => {
    expect((Button as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for('react.forward_ref')
    )
    const ref = createRef<HTMLButtonElement>()
    expect(() => html(createElement(Button, { ref }, 'x'))).not.toThrow()
  })
})

describe('Card and Section', () => {
  it('renders a flat card with the requested element', () => {
    expect(html(createElement(Card, { as: 'li', id: 'a' }, 'x'))).toBe(
      '<li id="a" class="ui-card">x</li>'
    )
    expect(html(createElement(Card, { className: 'mt-3' }, 'x'))).toBe(
      '<div class="ui-card mt-3">x</div>'
    )
  })

  it('labels the section with its 15 px title and shows meta and actions on the right', () => {
    const markup = html(
      createElement(
        Section,
        {
          title: 'Controlli',
          meta: '2 da eseguire',
          metaTone: 'recommended',
          actions: createElement(Button, null, 'Rivedi'),
          id: 'checks'
        },
        'rows'
      )
    )
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(markup)?.[1]
    expect(labelledBy).toBeTruthy()
    expect(markup).toContain(`<h2 id="${labelledBy}" class="ui-section-title">Controlli</h2>`)
    expect(markup).toMatch(/^<section id="checks"/)
    expect(markup).toContain('class="ui-card ui-section"')
    expect(markup).toContain('<span class="ui-section-meta" data-tone="recommended">2 da eseguire')
    expect(markup).toContain('Rivedi')
    expect(markup.indexOf('ui-section-head')).toBeLessThan(markup.indexOf('rows'))
  })

  it('omits the aside without meta or actions and defaults the meta tone to neutral', () => {
    expect(html(createElement(Section, { title: 'A' }, 'x'))).not.toContain('ui-section-aside')
    expect(html(createElement(Section, { title: 'A', meta: 'letto 2 s fa' }, 'x'))).toContain(
      'data-tone="neutral"'
    )
  })
})

describe('Tag', () => {
  it.each(['recommended', 'ok', 'danger', 'neutral'] as const)('renders the %s tone', (tone) => {
    expect(html(createElement(Tag, { tone }, 'Consigliato'))).toBe(
      `<span class="ui-tag" data-tone="${tone}">Consigliato</span>`
    )
  })
})

describe('Table primitives', () => {
  const table = () =>
    html(
      createElement(
        Table,
        { className: 'mt-2' },
        createElement(
          TableHead,
          null,
          createElement(TableHeaderCell, null, 'Categoria'),
          createElement(TableHeaderCell, { numeric: true }, 'Dimensione')
        ),
        createElement(
          'tbody',
          null,
          createElement(
            TableRow,
            { recommended: true, selected: true },
            createElement(TableCell, null, 'Cestino'),
            createElement(TableCell, { numeric: true }, '312 MB'),
            createElement(TableCell, { muted: true }, 'svuotamento definitivo')
          ),
          createElement(TableRow, null, createElement(TableCell, null, 'Miniature'))
        )
      )
    )

  it('wraps the header cells in one header row with column scope', () => {
    const markup = table()
    expect(markup).toContain('<table class="ui-table mt-2"><thead><tr><th scope="col">Categoria')
    expect(markup).toContain('<th scope="col" data-numeric="true">Dimensione</th></tr></thead>')
  })

  it('marks recommended and selected rows, numeric and muted cells', () => {
    const markup = table()
    expect(markup).toContain('<tr data-recommended="true" data-selected="true">')
    expect(markup).toContain('<td data-numeric="true">312 MB</td>')
    expect(markup).toContain('<td data-muted="true">svuotamento definitivo</td>')
    expect(markup).toContain('<tr><td>Miniature</td></tr>')
  })

  it('ListRow carries the same recommended marker', () => {
    expect(html(createElement(ListRow, { recommended: true }, 'x'))).toBe(
      '<div class="ui-list-row" data-recommended="true">x</div>'
    )
    expect(html(createElement(ListRow, null, 'x'))).toBe('<div class="ui-list-row">x</div>')
  })
})

describe('ProgressBar', () => {
  it('exposes the value and scales the fill, never its width', () => {
    const markup = html(createElement(ProgressBar, { value: 0.42, label: 'Analisi' }))
    expect(markup).toContain('role="progressbar"')
    expect(markup).toContain('aria-label="Analisi"')
    expect(markup).toContain('aria-valuenow="42"')
    expect(markup).toContain('transform:scaleX(0.42)')
    expect(markup).not.toContain('width')
    expect(markup).toContain('data-tone="neutral"')
  })

  it('clamps the value to 0..1', () => {
    expect(html(createElement(ProgressBar, { value: 3, label: 'x' }))).toContain('scaleX(1)')
    expect(html(createElement(ProgressBar, { value: -1, label: 'x' }))).toContain('scaleX(0)')
  })

  it('is indeterminate when asked, without a value, or with a non-finite value', () => {
    for (const props of [{ indeterminate: true, value: 0.5 }, {}, { value: Number.NaN }]) {
      const markup = html(createElement(ProgressBar, { ...props, label: 'x' }))
      expect(markup).toContain('data-indeterminate="true"')
      expect(markup).not.toContain('aria-valuenow')
      expect(markup).not.toContain('style=')
    }
  })

  it('supports the danger tone', () => {
    expect(html(createElement(ProgressBar, { value: 0.95, tone: 'danger', label: 'x' }))).toContain(
      'data-tone="danger"'
    )
  })
})

describe('Switch', () => {
  it('is a labelled button with role switch', () => {
    const on = html(
      createElement(Switch, { checked: true, onChange: vi.fn(), label: 'Avvio', id: 's' })
    )
    expect(on).toContain('type="button"')
    expect(on).toContain('role="switch"')
    expect(on).toContain('id="s"')
    expect(on).toContain('aria-checked="true"')
    expect(on).toContain('aria-label="Avvio"')
    const off = html(
      createElement(Switch, { checked: false, onChange: vi.fn(), label: 'Avvio', disabled: true })
    )
    expect(off).toContain('aria-checked="false"')
    expect(off).toContain('disabled=""')
  })
})

describe('Segmented', () => {
  const options = [
    { value: 'dark', label: 'Scuro' },
    { value: 'light', label: 'Chiaro' },
    { value: 'system', label: 'Sistema' }
  ] as const

  it('is a labelled radiogroup with one tab stop on the selected option', () => {
    const markup = html(
      createElement(Segmented<'dark' | 'light' | 'system'>, {
        options: [...options],
        value: 'light',
        onChange: vi.fn(),
        label: 'Tema'
      })
    )
    expect(markup).toContain('role="radiogroup" aria-label="Tema"')
    expect(count(markup, 'role="radio"')).toBe(3)
    expect(markup).toContain('aria-checked="true" tabindex="0" class="ui-segmented-option">Chiaro')
    expect(count(markup, 'tabindex="-1"')).toBe(2)
  })

  it('keeps the first option reachable when the value matches none', () => {
    const markup = html(
      createElement(Segmented<string>, {
        options: [...options],
        value: 'other',
        onChange: vi.fn(),
        label: 'Tema'
      })
    )
    expect(markup).toContain('tabindex="0" class="ui-segmented-option">Scuro')
    expect(markup).not.toContain('aria-checked="true"')
  })
})

describe('Checkbox', () => {
  it('is a native, labelled checkbox', () => {
    const markup = html(
      createElement(Checkbox, { checked: true, onChange: vi.fn(), label: 'Cestino' })
    )
    expect(markup).toContain('type="checkbox"')
    expect(markup).toContain('class="ui-checkbox"')
    expect(markup).toContain('checked=""')
    expect(markup).toContain('aria-label="Cestino"')
    const disabled = html(
      createElement(Checkbox, {
        checked: false,
        indeterminate: true,
        onChange: vi.fn(),
        label: 'Tutto',
        disabled: true
      })
    )
    expect(disabled).toContain('disabled=""')
    expect(disabled).not.toContain('checked=""')
  })
})
