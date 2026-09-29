import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  createRestorePoint: false,
  history: vi.fn(),
  state: {
    setStatus: vi.fn(),
    setResults: vi.fn(),
    addResults: vi.fn(),
    setProgress: vi.fn(),
    setScannedAt: vi.fn(),
    setScannedCategories: vi.fn(),
    setStoppedEarly: vi.fn(),
    setFailedCategories: vi.fn()
  }
}))
vi.mock('@/stores/scan-store', () => ({ useScanStore: { getState: () => mocks.state } }))
vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: {
    getState: () => ({
      settings: {
        cleaner: { createRestorePoint: mocks.createRestorePoint, protectRecycleBin: true }
      }
    })
  },
  refreshSettings: vi.fn()
}))
vi.mock('@/stores/history-store', () => ({
  useHistoryStore: { getState: () => ({ addEntry: mocks.history }) }
}))
vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() }
}))
import { CleanerType } from '@shared/enums'
import { runSchedule } from './useScheduledScan'
const payload = {
  scheduleId: 'one',
  runId: 'run-token',
  scheduleName: 'Test',
  tasks: ['cleaner:system'],
  autoApply: true
}
const result = (subcategory: string, id: string) => ({
  category: 'System',
  subcategory,
  itemCount: 1,
  totalSize: 10,
  items: [{ id, size: 10 }]
})
const api = {
  scheduleAuthorize: vi.fn(),
  createRestorePoint: vi.fn(),
  scheduleRunComplete: vi.fn(),
  notifyScheduledScanComplete: vi.fn(),
  systemScan: vi.fn(),
  systemClean: vi.fn(),
  browserScan: vi.fn(),
  registryScan: vi.fn(),
  registryFix: vi.fn(),
  recycleBinScan: vi.fn()
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.createRestorePoint = false
  vi.stubGlobal('window', { kudu: api })
  api.scheduleAuthorize.mockReset().mockResolvedValue({ allowed: true, reason: null })
  api.systemScan.mockResolvedValue([result('Cache', 'one'), result('Logs', 'two')])
  api.systemClean.mockResolvedValue({ filesDeleted: 1, totalCleaned: 10, errors: [] })
  api.registryScan.mockResolvedValue([{ id: 'registry-id' }])
  api.registryFix.mockResolvedValue({ fixed: 1, failed: 0 })
})
afterEach(() => vi.unstubAllGlobals())
it('runs tasks in the saved order and restricts cleanup to fresh matching categories', async () => {
  await runSchedule({
    ...payload,
    tasks: ['registry', 'cleaner:system'],
    cleanerSubcategories: { 'cleaner:system': ['Logs'] }
  })
  expect(api.registryFix).toHaveBeenCalledBefore(api.systemScan)
  expect(api.systemClean).toHaveBeenCalledWith(['two'])
  expect(api.scheduleRunComplete).toHaveBeenCalledWith('one', 'success', 'run-token')
})
it('records the cleaner categories it read and when it finished', async () => {
  api.registryScan.mockRejectedValue(new Error('boom'))
  await runSchedule({ ...payload, tasks: ['cleaner:system', 'registry'] })
  expect(mocks.state.setScannedAt).toHaveBeenNthCalledWith(1, null)
  expect(mocks.state.setScannedAt).toHaveBeenLastCalledWith(expect.any(Number))
  expect(mocks.state.setScannedCategories).toHaveBeenLastCalledWith([CleanerType.System])
  expect(mocks.state.setStoppedEarly).toHaveBeenLastCalledWith(false)
})
it('reports a cleaner category whose scan failed, replacing an earlier list', async () => {
  // Category names are translated; the key stands in for the text.
  const i18next = (await import('i18next')).default
  const t = vi.spyOn(i18next, 't').mockImplementation(((key: string) => key) as never)
  api.browserScan.mockRejectedValue(new Error('boom'))
  await runSchedule({ ...payload, tasks: ['cleaner:system', 'cleaner:browsers'] })
  t.mockRestore()
  expect(mocks.state.setFailedCategories).toHaveBeenNthCalledWith(1, [])
  expect(mocks.state.setFailedCategories).toHaveBeenLastCalledWith(['cleaner:categoryBrowsers'])
  expect(mocks.state.setScannedCategories).toHaveBeenLastCalledWith([CleanerType.System])
})
it('marks the results as partial when the conditions change during the run', async () => {
  api.scheduleAuthorize
    .mockResolvedValueOnce({ allowed: true })
    .mockResolvedValueOnce({ allowed: true })
    .mockResolvedValue({ allowed: false, reason: 'game-mode' })
  await runSchedule(payload)
  expect(mocks.state.setScannedCategories).toHaveBeenLastCalledWith([CleanerType.System])
  expect(mocks.state.setStoppedEarly).toHaveBeenLastCalledWith(true)
  expect(mocks.state.setScannedAt).toHaveBeenLastCalledWith(expect.any(Number))
})
it('defers a queued run if eligibility changes before execution', async () => {
  api.scheduleAuthorize.mockResolvedValue({ allowed: false, reason: 'power' })
  await runSchedule(payload)
  expect(api.systemScan).not.toHaveBeenCalled()
  expect(api.scheduleRunComplete).toHaveBeenCalledWith('one', 'deferred', 'run-token')
  // A deferred run never touched the Cleaner's last results.
  expect(mocks.state.setScannedCategories).not.toHaveBeenCalled()
  expect(mocks.state.setStoppedEarly).not.toHaveBeenCalled()
})
it('rechecks immediately before mutation and records partial work without cleaning', async () => {
  api.scheduleAuthorize
    .mockResolvedValueOnce({ allowed: true })
    .mockResolvedValueOnce({ allowed: true })
    .mockResolvedValue({ allowed: false, reason: 'game-mode' })
  await runSchedule(payload)
  expect(api.systemScan).toHaveBeenCalledTimes(1)
  expect(api.systemClean).not.toHaveBeenCalled()
  expect(api.scheduleRunComplete).toHaveBeenCalledWith('one', 'partial', 'run-token')
  expect(mocks.history).toHaveBeenCalledWith(
    expect.objectContaining({ totalItemsFound: 2, totalItemsCleaned: 0, errorCount: 1 })
  )
})
it('honors empty scope and the existing Recycle Bin protection', async () => {
  await runSchedule({
    ...payload,
    tasks: ['cleaner:system', 'cleaner:recycleBin'],
    cleanerSubcategories: { 'cleaner:system': [] }
  })
  expect(api.systemClean).not.toHaveBeenCalled()
  expect(api.recycleBinScan).not.toHaveBeenCalled()
})
it('never auto-applies cache resets or native maintenance', async () => {
  api.systemScan.mockResolvedValue([
    {
      ...result('Temp', 'plain'),
      itemCount: 3,
      items: [
        { id: 'plain', size: 10 },
        { id: 'prefetch', size: 10, cacheReset: true },
        { id: 'dism', size: 0, cleanupAction: 'windows-components' }
      ]
    }
  ])
  await runSchedule(payload)
  expect(api.systemClean).toHaveBeenCalledWith(['plain'])
})
it('skips cleanup when only opt-in items were found', async () => {
  api.systemScan.mockResolvedValue([
    { ...result('Prefetch', 'prefetch'), items: [{ id: 'prefetch', size: 10, cacheReset: true }] }
  ])
  await runSchedule(payload)
  expect(api.systemClean).not.toHaveBeenCalled()
  expect(api.scheduleRunComplete).toHaveBeenCalledWith('one', 'success', 'run-token')
})
it('creates the restore point just before the first clean', async () => {
  mocks.createRestorePoint = true
  await runSchedule(payload)
  expect(api.createRestorePoint).toHaveBeenCalledTimes(1)
  expect(api.createRestorePoint).toHaveBeenCalledBefore(api.systemClean)
})
it('rechecks eligibility after the restore point and before cleaning', async () => {
  mocks.createRestorePoint = true
  let restorePointDone = false
  api.createRestorePoint.mockImplementation(async () => {
    restorePointDone = true
  })
  api.scheduleAuthorize.mockImplementation(async () =>
    restorePointDone ? { allowed: false, reason: 'power' } : { allowed: true, reason: null }
  )
  await runSchedule(payload)
  expect(api.createRestorePoint).toHaveBeenCalledTimes(1)
  expect(api.systemClean).not.toHaveBeenCalled()
})
it('skips the restore point when nothing will be cleaned', async () => {
  mocks.createRestorePoint = true
  api.systemScan.mockResolvedValue([
    { ...result('Prefetch', 'prefetch'), items: [{ id: 'prefetch', size: 10, cacheReset: true }] }
  ])
  await runSchedule(payload)
  expect(api.createRestorePoint).not.toHaveBeenCalled()
})
it('reports returned cleanup failures as partial instead of success', async () => {
  api.systemClean.mockResolvedValue({ filesDeleted: 0, totalCleaned: 0, errors: ['locked'] })
  await runSchedule(payload)
  expect(api.scheduleRunComplete).toHaveBeenCalledWith('one', 'partial', 'run-token')
})
it('files history under the task that actually ran when a workflow stops early', async () => {
  api.scheduleAuthorize
    .mockResolvedValueOnce({ allowed: true })
    .mockResolvedValueOnce({ allowed: true })
    .mockResolvedValueOnce({ allowed: true })
    .mockResolvedValue({ allowed: false, reason: 'power' })
  await runSchedule({ ...payload, tasks: ['registry', 'cleaner:system'] })
  expect(api.registryFix).toHaveBeenCalledTimes(1)
  expect(api.systemScan).not.toHaveBeenCalled()
  expect(mocks.history).toHaveBeenCalledWith(expect.objectContaining({ type: 'registry' }))
  expect(api.scheduleRunComplete).toHaveBeenCalledWith('one', 'partial', 'run-token')
})
it('names the apps a scheduled update touched, in a toast that stays and on the updates page', async () => {
  const { toast } = await import('sonner')
  const { useUpdaterStore } = await import('@/stores/updater-store')
  const i18next = (await import('i18next')).default
  const enUpdates = (await import('@/locales/en/updates.json')).default
  await i18next.init({
    lng: 'en',
    resources: { en: { updates: enUpdates } },
    ns: ['updates'],
    defaultNS: 'updates',
    interpolation: { escapeValue: false }
  })
  const app = (id: string, source: string, name: string) => ({
    id,
    source,
    name,
    currentVersion: '1.0',
    availableVersion: '2.0',
    severity: 'major',
    selected: true
  })
  const scan = [
    app('AnyDesk.AnyDesk', 'winget', 'AnyDesk'),
    app('XP89DCGQ3K6VLD', 'msstore', 'Microsoft PowerToys')
  ]
  const kudu = {
    ...api,
    softwareUpdateCheck: vi.fn().mockResolvedValue({ apps: scan }),
    softwareUpdateRun: vi.fn().mockResolvedValue({
      succeeded: 1,
      failed: 0,
      updated: [{ appId: 'AnyDesk.AnyDesk', name: 'AnyDesk', source: 'winget' }],
      pending: [{ appId: 'XP89DCGQ3K6VLD', name: 'Microsoft PowerToys', source: 'msstore' }],
      errors: []
    })
  }
  vi.stubGlobal('window', { kudu })
  useUpdaterStore.getState().setApps(scan as never)

  await runSchedule({ ...payload, tasks: ['software-update'] })

  // Names go to main, so progress and results can use them
  expect(kudu.softwareUpdateRun).toHaveBeenCalledWith([
    { id: 'AnyDesk.AnyDesk', source: 'winget', name: 'AnyDesk' },
    { id: 'XP89DCGQ3K6VLD', source: 'msstore', name: 'Microsoft PowerToys' }
  ])
  // Still installing: a warning that stays until dismissed
  expect(toast.warning).toHaveBeenCalledWith(
    '1 of 2 apps updated',
    expect.objectContaining({ duration: Infinity, closeButton: true })
  )
  const options = vi.mocked(toast.warning).mock.calls[0][1] as {
    description: { props: { children: { props: { children: string } }[] } }
  }
  expect(options.description.props.children.map((line) => line.props.children)).toEqual([
    'Updated: AnyDesk',
    'Still installing: Microsoft PowerToys'
  ])
  const { updateSummary, apps } = useUpdaterStore.getState()
  expect(updateSummary?.updated.map((e) => e.name)).toEqual(['AnyDesk'])
  expect(updateSummary?.pending.map((e) => e.name)).toEqual(['Microsoft PowerToys'])
  // The updated app leaves the list; the one still installing stays
  expect(apps.map((a) => a.id)).toEqual(['XP89DCGQ3K6VLD'])
  // An install with no outcome yet is not a clean success
  expect(kudu.scheduleRunComplete).toHaveBeenCalledWith('one', 'partial', 'run-token')
})
