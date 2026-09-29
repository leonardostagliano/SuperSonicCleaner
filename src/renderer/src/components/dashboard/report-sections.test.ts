import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { HomeCheck } from './home-checks'
import { ChecksSection } from './ReportSections'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' }
  })
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('@/stores/drives-store', () => ({ useDrivesStore: () => [] }))
vi.mock('@/stores/history-store', () => ({ useHistoryStore: () => [] }))
vi.mock('@/stores/settings-store', () => ({ useSettingsStore: () => undefined }))

const check = (over: Partial<HomeCheck>): HomeCheck => ({
  id: 'malware',
  input: { id: 'malware', lastRun: null },
  state: { id: 'malware', recommended: false, reason: null },
  result: 'No threats found',
  resultTone: 'ok',
  when: '10 days ago',
  path: '/malware',
  ...over
})

describe('ChecksSection', () => {
  it('labels a recommended row in words, not only with the amber rule', () => {
    const markup = renderToStaticMarkup(
      createElement(ChecksSection, {
        checks: [
          check({ state: { id: 'malware', recommended: true, reason: 'stale' } }),
          check({
            id: 'privacy',
            input: { id: 'privacy', lastRun: null },
            state: { id: 'privacy', recommended: false, reason: null },
            path: '/privacy'
          })
        ],
        onAnalyzeCleanup: () => {},
        disabled: false
      })
    )
    const rows = markup.split('<tr').slice(2)
    expect(rows).toHaveLength(2)
    const nameCell = (row: string) => row.match(/home-check-name[^>]*>(.*?)<\/td>/)?.[1] ?? ''
    expect(nameCell(rows[0])).toContain('checks.names.malware')
    expect(nameCell(rows[0])).toContain('simple.recommended')
    expect(nameCell(rows[1])).not.toContain('simple.recommended')
  })
})
