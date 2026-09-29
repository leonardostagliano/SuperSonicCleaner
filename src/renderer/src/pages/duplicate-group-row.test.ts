import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DuplicateGroup } from '@shared/types'
import { DuplicateGroupRow } from './DuplicateFinderPage'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } })
}))
vi.mock('@/components/ai/AiAnalysisPanel', () => ({ AiAnalysisPanel: () => null }))

const group: DuplicateGroup = {
  hash: 'aaaa',
  fullHash: 'aaaa',
  fileSize: 1000,
  files: [
    { path: '/a.bin', size: 1000, lastModified: 0 },
    { path: '/b.bin', size: 1000, lastModified: 0 }
  ],
  reclaimableSpace: 1000
}

/** Each copy's row: whether it carries the amber rule, and its status tag. */
function rows(selected: string[]) {
  const markup = renderToStaticMarkup(
    createElement(DuplicateGroupRow, {
      group,
      expanded: true,
      onToggle: () => {},
      selectedPaths: new Set(selected),
      onTogglePath: () => {}
    })
  )
  return [...markup.matchAll(/<tr([^>]*)>(.*?)<\/tr>/g)].slice(1).map(([, attrs, body]) => ({
    rule: attrs.includes('data-recommended'),
    tag: body.match(/(keepTag|recommendedTag|hardLinkedTag)/)?.[1] ?? null
  }))
}

describe('DuplicateGroupRow', () => {
  it('draws the amber rule on the recommended copy of the default selection', () => {
    expect(rows(['/b.bin'])).toEqual([
      { rule: false, tag: 'keepTag' },
      { rule: true, tag: 'recommendedTag' }
    ])
  })

  it('moves the rule with the tag when the other copy is selected instead', () => {
    // The second copy now stays: it must not keep the "recommended for deletion" rule.
    expect(rows(['/a.bin'])).toEqual([
      { rule: false, tag: null },
      { rule: false, tag: 'keepTag' }
    ])
  })
})
