import { describe, expect, it } from 'vitest'
import enStartup from '@/locales/en/startup.json'
import itStartup from '@/locales/it/startup.json'
import { STARTUP_COPY } from './startup-copy'

describe('STARTUP_COPY', () => {
  it('names a scope and an empty-state text for each platform in en and it', () => {
    for (const keys of Object.values(STARTUP_COPY)) {
      for (const key of [keys.description, keys.empty]) {
        expect(enStartup).toHaveProperty([key])
        expect(itStartup).toHaveProperty([key])
      }
    }
  })

  it('describes the sources each platform really reads', () => {
    const en = enStartup as Record<string, string>
    expect(en[STARTUP_COPY.win32.description]).toMatch(/registry/)
    for (const platform of ['darwin', 'linux'] as const) {
      const { description, empty } = STARTUP_COPY[platform]
      expect(en[description]).not.toMatch(/registry|Task Scheduler|app name/)
      expect(en[empty]).not.toMatch(/registry|Task Scheduler/)
    }
    expect(en[STARTUP_COPY.darwin.description]).toMatch(/LaunchAgents/)
    expect(en[STARTUP_COPY.linux.description]).toMatch(/systemd/)
  })
})
