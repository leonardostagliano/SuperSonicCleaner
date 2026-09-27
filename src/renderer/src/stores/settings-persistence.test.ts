import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('window', { kudu: undefined })

import { defaultSettings, useSettingsStore } from './settings-store'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

const state = () => useSettingsStore.getState()
const write = vi.fn()
const save = (partial: Parameters<ReturnType<typeof state>['saveSettings']>[0]) =>
  state()
    .saveSettings(partial)
    .then(
      () => true,
      () => false
    )

beforeEach(() => {
  write.mockReset()
  vi.stubGlobal('window', { kudu: { settingsSet: write } })
  useSettingsStore.setState({ settings: structuredClone(defaultSettings), loaded: true })
})

describe('settings persistence and optimistic rollback', () => {
  it('keeps a successful change after reading the persisted settings back', async () => {
    let persisted = structuredClone(defaultSettings)
    write.mockImplementation(async (patch) => {
      persisted = { ...persisted, ...patch }
    })
    expect(await save({ theme: 'light' })).toBe(true)
    state().setSettings(structuredClone(persisted))
    expect(state().settings.theme).toBe('light')
  })

  it('restores a rejected save while keeping a concurrent successful field', async () => {
    const first = deferred()
    const second = deferred()
    write.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const theme = save({ theme: 'dark' })
    const language = save({ language: 'it' })
    expect(state().settings).toMatchObject({ theme: 'dark', language: 'it' })
    second.resolve()
    expect(await language).toBe(true)
    first.reject(new Error('disk full'))
    expect(await theme).toBe(false)
    expect(state().settings).toMatchObject({ theme: 'system', language: 'it' })
  })

  it('does not undo a newer change to the same field when an earlier save fails', async () => {
    const first = deferred()
    const second = deferred()
    write.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const firstSave = save({ theme: 'dark' })
    const secondSave = save({ theme: 'light' })
    first.reject(new Error('failed'))
    expect(await firstSave).toBe(false)
    expect(state().settings.theme).toBe('light')
    second.resolve()
    expect(await secondSave).toBe(true)
    expect(state().settings.theme).toBe('light')
  })

  it('restores the original persisted value when two overlapping saves fail', async () => {
    const first = deferred()
    const second = deferred()
    write.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const firstSave = save({ theme: 'dark' })
    const secondSave = save({ theme: 'light' })
    // Even reversed completion must not resurrect the failed optimistic value.
    second.reject(new Error('second failed'))
    expect(await secondSave).toBe(false)
    expect(state().settings.theme).toBe('dark')
    first.reject(new Error('first failed'))
    expect(await firstSave).toBe(false)
    expect(state().settings.theme).toBe('system')
  })

  it('restores the latest successful value when a subsequent save fails', async () => {
    const first = deferred()
    const second = deferred()
    write.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const firstSave = save({ theme: 'dark' })
    const secondSave = save({ theme: 'light' })
    first.resolve()
    expect(await firstSave).toBe(true)
    second.reject(new Error('failed'))
    expect(await secondSave).toBe(false)
    expect(state().settings.theme).toBe('dark')
  })

  it('saves only changed nested fields and never persists another pending toggle accidentally', async () => {
    const first = deferred()
    const second = deferred()
    write.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const firstSave = save({ cleaner: { ...state().settings.cleaner, secureDelete: true } })
    const secondSave = save({ cleaner: { ...state().settings.cleaner, keepDeletionLog: true } })
    expect(write.mock.calls).toEqual([
      [{ cleaner: { secureDelete: true } }],
      [{ cleaner: { keepDeletionLog: true } }]
    ])
    second.resolve()
    expect(await secondSave).toBe(true)
    first.reject(new Error('failed'))
    expect(await firstSave).toBe(false)
    expect(state().settings.cleaner).toEqual({
      ...defaultSettings.cleaner,
      secureDelete: false,
      keepDeletionLog: true
    })
  })

  it('preserves a pending choice when settings are hydrated again', async () => {
    const pending = deferred()
    write.mockReturnValueOnce(pending.promise)
    const saving = save({ language: 'it' })
    state().setSettings({ ...structuredClone(defaultSettings), backupPath: '/backups' })
    expect(state().settings).toMatchObject({ language: 'it', backupPath: '/backups' })
    pending.reject(new Error('failed'))
    expect(await saving).toBe(false)
    expect(state().settings).toMatchObject({ language: 'en', backupPath: '/backups' })
  })

  it('does not revert a field explicitly updated by another control', async () => {
    const pending = deferred()
    write.mockReturnValueOnce(pending.promise)
    const saving = save({ theme: 'dark' })
    state().updateSettings({ theme: 'light' })
    pending.reject(new Error('failed'))
    expect(await saving).toBe(false)
    expect(state().settings.theme).toBe('light')
  })

  it('rolls back when no persistence bridge is available', async () => {
    vi.stubGlobal('window', { kudu: undefined })
    expect(await save({ autoUpdate: false })).toBe(false)
    expect(state().settings.autoUpdate).toBe(true)
  })
})
