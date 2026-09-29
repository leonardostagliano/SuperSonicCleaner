import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DriveInfo } from '@shared/types'
import { StorageSection } from './ReportSections'

const drives = vi.hoisted(() => ({ state: { drives: [] as unknown[], status: 'loading' } }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } })
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('@/stores/drives-store', () => ({
  useDrivesStore: (select: (s: typeof drives.state) => unknown) => select(drives.state)
}))
vi.mock('@/stores/history-store', () => ({ useHistoryStore: () => [] }))
vi.mock('@/stores/settings-store', () => ({ useSettingsStore: () => undefined }))

const render = () => renderToStaticMarkup(createElement(StorageSection))
const shape = (markup: string) =>
  ['home-drive-top', 'role="progressbar"', 'home-drive-figures'].map((part) =>
    markup.includes(part)
  )

describe('StorageSection', () => {
  beforeEach(() => {
    drives.state = { drives: [], status: 'loading' }
  })

  it('keeps the shape of a drive row while the drives are read, so the page does not jump', () => {
    const loading = render()
    expect(loading).toContain('storage.reading')
    expect(shape(loading)).toEqual([true, true, true])

    drives.state = {
      status: 'ready',
      drives: [
        {
          letter: 'C:',
          label: 'Windows',
          isSystem: true,
          totalSize: 100,
          usedSpace: 40,
          freeSpace: 60
        } as unknown as DriveInfo
      ]
    }
    expect(shape(render())).toEqual([true, true, true])
  })

  it('says the drives are unavailable in one line', () => {
    drives.state = { drives: [], status: 'unavailable' }
    const markup = render()
    expect(markup).toContain('storage.unavailable')
    expect(markup).not.toContain('role="progressbar"')
  })
})
