import { create } from 'zustand'
import type { KuduSettings } from '@shared/types'

interface SettingsState {
  settings: KuduSettings
  loaded: boolean
  setSettings: (settings: KuduSettings) => void
  updateSettings: (partial: Partial<KuduSettings>) => void
  saveSettings: (partial: Partial<KuduSettings>) => Promise<void>
}

export const defaultSettings: KuduSettings = {
  theme: 'system',
  dashboardView: 'simple',
  language: 'en',
  minimizeToTray: false,
  showNotificationOnComplete: true,
  showThreatNotifications: true,
  runAtStartup: false,
  autoUpdate: true,
  autoRestart: false,
  updateCheckIntervalHours: 4,
  softwareUpdaterNotifications: true,
  scheduleNudgeDismissed: false,
  preferElevatedLaunch: false,
  cleaner: {
    skipRecentMinutes: 60,
    secureDelete: false,
    closeBrowsersBeforeClean: false,
    createRestorePoint: false,
    protectRecycleBin: true,
    keepDeletionLog: false
  },
  exclusions: [],
  ignoredSoftwareUpdates: [],
  ignoredDriverUpdates: [],
  backupPath: '',
  backupMode: 'targeted',
  schedule: {
    enabled: false,
    frequency: 'weekly',
    day: 1,
    hour: 9
  },
  schedules: [],
  windowsPackageManager: 'winget',
  windowsPackageManagers: ['winget', 'choco', 'scoop', 'npm'],
  gameMode: {
    enabledOptimizations: [
      'svc-wsearch',
      'svc-sysmain',
      'proc-kill-updaters',
      'mem-clear-standby',
      'sys-focus-assist',
      'sys-power-plan',
      'sys-prevent-sleep',
      'sys-disable-game-bar',
      'sys-disable-fse-opt',
      'net-flush-dns'
    ],
    customProcessKillList: [],
    autoDetect: false,
    autoDeactivate: true,
    customGameProcesses: []
  },
  registryIgnoredTweaks: [],
  malwareAllowlist: []
}

type SettingField = { key: string; parent?: 'cleaner' | 'schedule' | 'gameMode'; value: unknown }
type PendingField = { value: unknown; status: 'pending' | 'saved' | 'failed' }

function fields(partial: Partial<KuduSettings>): SettingField[] {
  return Object.entries(partial).flatMap<SettingField>(([key, value]) =>
    key === 'cleaner' || key === 'schedule' || key === 'gameMode'
      ? Object.entries(value ?? {}).map(([child, value]) => ({ key: child, parent: key, value }))
      : [{ key, value }]
  )
}

function fieldValue(settings: KuduSettings, field: SettingField): unknown {
  const source = field.parent ? settings[field.parent] : settings
  return (source as unknown as Record<string, unknown>)[field.key]
}

function fieldPatch(entries: SettingField[]): Partial<KuduSettings> {
  const patch: Record<string, unknown> = {}
  for (const { key, parent, value } of entries) {
    const target = parent ? ((patch[parent] ??= {}) as Record<string, unknown>) : patch
    target[key] = value
  }
  return patch as Partial<KuduSettings>
}

function mergeSettings(settings: KuduSettings, partial: Partial<KuduSettings>): KuduSettings {
  return {
    ...settings,
    ...partial,
    cleaner: { ...settings.cleaner, ...(partial.cleaner ?? {}) },
    schedule: { ...settings.schedule, ...(partial.schedule ?? {}) },
    schedules: partial.schedules ?? settings.schedules,
    gameMode: { ...settings.gameMode, ...(partial.gameMode ?? {}) }
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  // Keep a history per field until its overlapping saves settle. A failed save
  // must not undo a newer edit, including another field in the same section.
  const pending = new Map<string, { field: SettingField; base: unknown; changes: PendingField[] }>()
  const keyOf = (field: SettingField) => `${field.parent ?? ''}.${field.key}`
  const visible = (entry: { base: unknown; changes: PendingField[] }) => {
    const latest = [...entry.changes].reverse().find((change) => change.status !== 'failed')
    return latest ? latest.value : entry.base
  }
  return {
    settings: defaultSettings,
    loaded: false,
    setSettings: (settings) =>
      set({
        settings: mergeSettings(
          settings,
          fieldPatch(
            [...pending.values()].map((entry) => ({ ...entry.field, value: visible(entry) }))
          )
        ),
        loaded: true
      }),
    updateSettings: (partial) => {
      for (const field of fields(partial)) pending.delete(keyOf(field))
      set((s) => ({ settings: mergeSettings(s.settings, partial) }))
    },
    saveSettings: async (partial) => {
      const changed = fields(partial).filter(
        (field) => !Object.is(fieldValue(get().settings, field), field.value)
      )
      if (!changed.length) return
      const changes = changed.map((field) => {
        const key = keyOf(field)
        const entry = pending.get(key) ?? {
          field,
          base: fieldValue(get().settings, field),
          changes: []
        }
        const change: PendingField = { value: field.value, status: 'pending' }
        entry.changes.push(change)
        pending.set(key, entry)
        return { key, entry, change }
      })
      const patch = fieldPatch(changed)
      set((s) => ({ settings: mergeSettings(s.settings, patch) }))
      let saved = false
      try {
        if (!window.kudu?.settingsSet) throw new Error('Settings bridge unavailable')
        await window.kudu.settingsSet(patch)
        saved = true
      } finally {
        const settled: SettingField[] = []
        for (const { key, entry, change } of changes) {
          if (pending.get(key) !== entry) continue
          change.status = saved ? 'saved' : 'failed'
          while (entry.changes[0] && entry.changes[0].status !== 'pending') {
            const first = entry.changes.shift()!
            if (first.status === 'saved') entry.base = first.value
          }
          settled.push({ ...entry.field, value: visible(entry) })
          if (!entry.changes.length) pending.delete(key)
        }
        set((s) => ({ settings: mergeSettings(s.settings, fieldPatch(settled)) }))
      }
    }
  }
})

/** Re-fetch settings from main process into the store */
export function refreshSettings(): void {
  window.kudu
    ?.settingsGet?.()
    .then((settings) => {
      useSettingsStore.getState().setSettings(settings)
    })
    .catch(() => {})
}

// Hydrate settings eagerly so pages that depend on them
// don't see stale defaults before the user visits Settings.
if (typeof window !== 'undefined' && window.kudu) {
  refreshSettings()
}
