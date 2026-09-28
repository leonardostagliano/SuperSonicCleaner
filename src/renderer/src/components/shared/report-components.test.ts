import { describe, expect, it, vi } from 'vitest'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { History } from 'lucide-react'
import { EmptyState } from './EmptyState'
import { ConfirmDialog } from './ConfirmDialog'
import { Receipt } from './Receipt'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => `t:${key}` })
}))

const html = (element: ReactElement) => renderToStaticMarkup(element)
const count = (markup: string, needle: string) => markup.split(needle).length - 1

describe('EmptyState', () => {
  it('keeps the old call sites working: icon, title, description, action', () => {
    const markup = html(
      createElement(EmptyState, {
        icon: History,
        title: 'Nessuna cronologia',
        description: 'Le operazioni compariranno qui.',
        action: createElement('button', null, 'Analizza')
      })
    )
    expect(markup).toContain('<h2 class="ui-empty-title">Nessuna cronologia</h2>')
    expect(markup).toContain('<p class="ui-empty-description">Le operazioni compariranno qui.</p>')
    expect(markup).toContain('<div class="ui-empty-action"><button>Analizza</button></div>')
    // One 24 px neutral icon; no illustration, no decorative kind badge, no grid backdrop.
    expect(count(markup, '<svg')).toBe(1)
    expect(markup).toContain('width="24"')
    expect(markup).toContain('stroke-width="1.75"')
    expect(markup).not.toMatch(/pulse-tool-art|pulse-empty-kind|empty-state/)
  })

  it('is one flat card with only a title when nothing else is given', () => {
    const markup = html(createElement(EmptyState, { title: 'Non ancora analizzato' }))
    expect(markup).toBe(
      '<div class="ui-empty"><div class="ui-card ui-empty-status"><div class="ui-empty-text">' +
        '<h2 class="ui-empty-title">Non ancora analizzato</h2></div></div></div>'
    )
  })

  it('lists "what is checked" in a titled section', () => {
    const checks = [
      { title: 'File temporanei', detail: 'Temp di Windows e dell’utente' },
      { title: 'Cache', detail: 'Chrome, Edge, Firefox' },
      { title: 'Cestino e registri', detail: 'Cestino, log di Windows Update' }
    ]
    const markup = html(
      createElement(EmptyState, { title: 'Non ancora analizzato', checks, className: 'mt-4' })
    )
    expect(markup).toMatch(/^<div class="ui-empty mt-4">/)
    expect(markup).toContain('class="ui-section-title">t:whatIsChecked</h2>')
    expect(count(markup, 'class="ui-empty-check"')).toBe(3)
    expect(markup).toContain(
      '<span class="ui-empty-check-title">Cache</span><span class="ui-empty-check-detail">Chrome, Edge, Firefox</span>'
    )
  })

  it('shows no checks section for an empty list', () => {
    expect(html(createElement(EmptyState, { title: 'x', checks: [] }))).not.toContain('ui-section')
  })
})

describe('ConfirmDialog', () => {
  const base = {
    open: true,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    title: 'Eliminare 1.512 file (2,34 GB)?',
    description: 'Non è reversibile: i file non vanno nel Cestino.'
  }
  const confirmButton = (markup: string) =>
    /<button[^>]*>(?:(?!<button).)*$/.exec(markup)?.[0] ?? ''

  it('renders nothing while closed', () => {
    expect(html(createElement(ConfirmDialog, { ...base, open: false }))).toBe('')
  })

  it('is a labelled, described modal dialog on the flyout tokens', () => {
    const markup = html(createElement(ConfirmDialog, base))
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(markup)?.[1]
    const describedBy = /aria-describedby="([^"]+)"/.exec(markup)?.[1]
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain(`<h2 id="${labelledBy}" class="ui-dialog-title">${base.title}</h2>`)
    expect(markup).toContain(`<p id="${describedBy}" class="ui-dialog-body">`)
    expect(markup).toContain('class="ui-dialog-scrim"')
    expect(markup).not.toMatch(/backdrop|blur|rgba|glass-card|animate-scale-in/)
  })

  it('cancel is ghost; confirm repeats the action and is primary by default', () => {
    const markup = html(createElement(ConfirmDialog, { ...base, confirmLabel: 'Elimina 2,34 GB' }))
    expect(markup).toContain('data-variant="ghost"')
    expect(markup).toContain('t:cancel')
    expect(confirmButton(markup)).toContain('data-variant="primary"')
    expect(confirmButton(markup)).toContain('Elimina 2,34 GB')
  })

  it('is red only for irreversible actions: warning renders as default', () => {
    const danger = html(createElement(ConfirmDialog, { ...base, variant: 'danger' }))
    expect(confirmButton(danger)).toContain('data-variant="danger"')
    expect(danger).toContain('class="ui-dialog" data-variant="danger"')
    const warning = html(createElement(ConfirmDialog, { ...base, variant: 'warning' }))
    expect(confirmButton(warning)).toContain('data-variant="primary"')
    expect(warning).not.toContain('data-variant="danger"')
    expect(warning).not.toContain('<svg')
  })

  it('falls back to the generic label and shows details in their own block', () => {
    const markup = html(createElement(ConfirmDialog, { ...base, details: 'C:\\a\nC:\\b' }))
    expect(confirmButton(markup)).toContain('t:confirm')
    expect(markup).toContain('<p class="ui-dialog-details">C:\\a\nC:\\b</p>')
  })
})

describe('Receipt', () => {
  it('shows title, value, facts, what was skipped and links', () => {
    const markup = html(
      createElement(Receipt, {
        title: 'Pulizia completata',
        value: '2,31 GB liberati',
        facts: ['1.402 file eliminati', '12 set 2026, 18:40', '', 'non reversibile'],
        skipped: '110 file saltati perché in uso (29 MB)',
        links: createElement('a', { href: '#/history' }, 'Apri in Cronologia')
      })
    )
    expect(markup).toMatch(/^<article class="ui-card ui-receipt">/)
    expect(markup).toContain('<h2 class="ui-receipt-title">Pulizia completata</h2>')
    expect(markup).toContain('<p class="ui-receipt-value">2,31 GB liberati</p>')
    expect(markup).toContain(
      '<p class="ui-receipt-facts">1.402 file eliminati · 12 set 2026, 18:40 · non reversibile</p>'
    )
    expect(markup).toContain(
      '110 file saltati perché in uso (29 MB) <span class="ui-receipt-links"><a href="#/history">'
    )
    expect(markup).not.toContain('!')
  })

  it('leaves out the optional parts', () => {
    const markup = html(createElement(Receipt, { title: 'Pulizia completata', facts: [] }))
    expect(markup).toBe(
      '<article class="ui-card ui-receipt"><h2 class="ui-receipt-title">Pulizia completata</h2></article>'
    )
  })

  it('compact: one line of phrasing content, usable inside a button', () => {
    const markup = html(
      createElement(Receipt, {
        compact: true,
        title: 'Pulizia · 12 set 2026, 18:40',
        value: '2,31 GB',
        facts: ['1.402 file', 'non reversibile']
      })
    )
    expect(markup).toBe(
      '<span class="ui-receipt" data-compact=""><span class="ui-receipt-title">Pulizia · 12 set 2026, 18:40</span>' +
        '<span class="ui-receipt-facts">1.402 file · non reversibile</span>' +
        '<span class="ui-receipt-value">2,31 GB</span></span>'
    )
  })
})
