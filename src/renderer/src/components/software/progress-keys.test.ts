import { beforeAll, describe, expect, it } from 'vitest'
import i18next from 'i18next'
import itContextMenu from '@/locales/it/contextMenu.json'
import enContextMenu from '@/locales/en/contextMenu.json'
import itUpdates from '@/locales/it/updates.json'
import enUpdates from '@/locales/en/updates.json'
import { progressText } from '@/lib/progress-label'
import type { ContextMenuAction } from '@shared/types'

// The main process sends these keys (context-menu-cleaner.ipc.ts, driver-manager.ipc.ts);
// the Software pages turn them into text with progressText.
const CONTEXT_MENU_ACTIONS: ContextMenuAction[] = ['disable', 'enable', 'delete']
const DRIVER_PHASES = [
  'enumerating',
  'analyzing',
  'querying',
  'preparing',
  'downloading',
  'installing'
]

const i18n = i18next.createInstance()

beforeAll(async () => {
  await i18n.init({
    lng: 'it',
    fallbackLng: false,
    resources: {
      it: { contextMenu: itContextMenu, updates: itUpdates },
      en: { contextMenu: enContextMenu, updates: enUpdates }
    },
    ns: ['contextMenu', 'updates'],
    interpolation: { escapeValue: false }
  })
})

describe('progress lines sent by the main process', () => {
  it('translate every context-menu action with the entry name', async () => {
    for (const lng of ['it', 'en']) {
      await i18n.changeLanguage(lng)
      for (const action of CONTEXT_MENU_ACTIONS) {
        const text = progressText(i18n.t, {
          key: `contextMenu:progress.${action}`,
          params: { name: 'Open with Code' }
        })
        expect(text, `${lng} ${action}`).toContain('Open with Code')
        expect(text).not.toContain('contextMenu:')
      }
      expect(progressText(i18n.t, { key: 'contextMenu:progress.backup' })).not.toContain(
        'progress.backup'
      )
    }
  })

  it('translate the known context-menu error reasons', async () => {
    for (const lng of ['it', 'en']) {
      await i18n.changeLanguage(lng)
      for (const reason of ['protected', 'adminRequired', 'cancelled', 'notFound']) {
        const text = progressText(i18n.t, { key: `contextMenu:errors.${reason}` })
        expect(text, `${lng} ${reason}`).not.toContain('errors.')
      }
    }
  })

  it('translate every driver phase', async () => {
    for (const lng of ['it', 'en']) {
      await i18n.changeLanguage(lng)
      for (const phase of DRIVER_PHASES) {
        const text = progressText(i18n.t, { key: `updates:driverManager.progress.${phase}` })
        expect(text, `${lng} ${phase}`).not.toContain('driverManager.progress')
      }
    }
  })

  it('reads in Italian', async () => {
    await i18n.changeLanguage('it')
    expect(
      progressText(i18n.t, { key: 'contextMenu:progress.disable', params: { name: '7-Zip' } })
    ).toBe('Disattivazione di 7-Zip…')
  })
})
