import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDiagnosticsStore, type DiagnosticsApi } from './diagnostics-store'
import { diagnosticsFixture } from '../dev-preview/diagnostics-fixture'
import type { DiagnosticSession } from '@shared/performance-diagnostics'

const sample = (): DiagnosticSession => ({
  title: 'Synthetic recording',
  notes: 'Original note',
  pinned: false,
  state: 'saved',
  report: null,
  recording: {
    version: 1,
    recordId: '00000000-0000-4000-8000-000000000002',
    startedAt: new Date().toISOString(),
    durationMs: 1000,
    system: {
      platform: 'win32',
      cpuModel: 'Synthetic CPU',
      logicalCores: 4,
      totalMemoryBytes: 4096,
      osVersion: 'Test'
    },
    samples: []
  }
})
function setup() {
  const session = sample()
  const fixture = diagnosticsFixture(session, false, () => true)
  const api = {
    diagnosticsStatus: vi.fn(async () => fixture.diagnosticsStatus()),
    diagnosticsGet: vi.fn(async (id: string) => fixture.diagnosticsGet(id)),
    diagnosticsAnalyze: vi.fn(async (id: string, language: 'en' | 'it') =>
      fixture.diagnosticsAnalyze(id, language)
    ),
    aiAnalysisStatus: vi.fn(async () => ({ connected: true, available: true })),
    diagnosticsAiAnalyze: vi.fn(async (id: string, language: 'en' | 'it') =>
      fixture.diagnosticsAiAnalyze(id, language)
    ),
    diagnosticsAiCancel: vi.fn(async () => fixture.diagnosticsAiCancel()),
    diagnosticsStart: vi.fn(async (seconds: number, processes: boolean) =>
      fixture.diagnosticsStart(seconds, processes)
    ),
    diagnosticsStop: vi.fn(async () => fixture.diagnosticsStop()),
    diagnosticsEdit: vi.fn(async (...args: Parameters<DiagnosticsApi['diagnosticsEdit']>) =>
      fixture.diagnosticsEdit(...args)
    ),
    diagnosticsRemove: vi.fn(async (id: string) => fixture.diagnosticsRemove(id)),
    diagnosticsExport: vi.fn(async (id: string) => fixture.diagnosticsExport(id))
  }
  const store = createDiagnosticsStore(() => api)
  return { store, api, fixture, id: session.recording.recordId }
}
afterEach(() => vi.useRealTimers())

describe('diagnostic recording controls', () => {
  it('requires opt-in, keeps an AI run and draft across view changes, then reloads its own report', async () => {
    const { store, api, fixture, id } = setup()
    await store.getState().select(id)
    await store.getState().analyzeAi(id, 'it')
    expect(api.diagnosticsAiAnalyze).not.toHaveBeenCalled()
    store.getState().toggleAi()
    await store.getState().checkAiConnection()
    store.getState().setDraft('notes', 'Keep this draft')
    let finish!: () => void
    api.diagnosticsAiAnalyze.mockImplementationOnce(async (recordId, language) => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return fixture.diagnosticsAiAnalyze(recordId, language)
    })
    const pending = store.getState().analyzeAi(id, 'it')
    expect(store.getState().busy).toBe('analyzeAi')
    await store.getState().select(null)
    expect(store.getState().selectedId).toBe(id)
    finish()
    await pending
    expect(store.getState()).toMatchObject({
      busy: null,
      notes: 'Keep this draft',
      feedback: 'aiAnalysisSaved',
      session: { aiReport: { source: 'codex', language: 'it' }, report: null }
    })
    const reopened = createDiagnosticsStore(() => api)
    await reopened.getState().select(id)
    expect(reopened.getState().session?.aiReport?.source).toBe('codex')
  })

  it('cancels only on explicit request and maps wrapped fixed errors without showing raw text', async () => {
    const { store, api, id } = setup()
    await store.getState().select(id)
    store.getState().toggleAi()
    await store.getState().checkAiConnection()
    let reject!: (reason: Error) => void
    api.diagnosticsAiAnalyze.mockImplementationOnce(
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise
        })
    )
    const pending = store.getState().analyzeAi(id, 'en')
    await store.getState().cancelAi()
    expect(api.diagnosticsAiCancel).toHaveBeenCalledTimes(1)
    expect(store.getState()).toMatchObject({ busy: 'analyzeAi', aiCancelling: true })
    reject(new Error("Error invoking remote method 'diagnosticsAiAnalyze': Error: cancelled"))
    await pending
    expect(store.getState()).toMatchObject({
      busy: null,
      aiCancelling: false,
      aiErrorCode: 'cancelled'
    })
    api.diagnosticsAiAnalyze.mockRejectedValueOnce(new Error('private upstream contents'))
    await store.getState().analyzeAi(id, 'en')
    expect(store.getState().aiErrorCode).toBe('analysis-failed')
    await store.getState().select(null)
    expect(store.getState().aiErrorCode).toBeNull()
  })

  it('shows a report that was saved just before cancellation completed', async () => {
    const { store, api, fixture, id } = setup()
    await store.getState().select(id)
    store.getState().toggleAi()
    await store.getState().checkAiConnection()
    let finish!: () => void
    api.diagnosticsAiAnalyze.mockImplementationOnce(async (recordId, language) => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return fixture.diagnosticsAiAnalyze(recordId, language)
    })
    const pending = store.getState().analyzeAi(id, 'en')
    await store.getState().cancelAi()
    finish()
    await pending
    expect(store.getState()).toMatchObject({
      busy: null,
      aiCancelling: false,
      feedback: 'aiAnalysisSaved',
      session: { aiReport: { source: 'codex' } }
    })
  })

  it('keeps analysis busy and draft details when all view subscribers leave, then reopens the saved report', async () => {
    const { store, api, fixture, id } = setup()
    await store.getState().select(id)
    store.getState().setDraft('title', 'Unsaved title')
    store.getState().setDraft('notes', 'Unsaved notes')
    let finish!: () => void
    api.diagnosticsAnalyze.mockImplementationOnce(async (recordId, language) => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return fixture.diagnosticsAnalyze(recordId, language)
    })
    const unsubscribe = store.subscribe(() => {})
    const pending = store.getState().analyze('it')
    expect(store.getState().busy).toBe('analyze')
    unsubscribe()
    await store.getState().select(null)
    expect(store.getState().selectedId).toBe(id)
    finish()
    await pending
    expect(store.getState()).toMatchObject({
      busy: null,
      title: 'Unsaved title',
      notes: 'Unsaved notes',
      feedback: 'analysisSaved',
      session: { report: { source: 'local', language: 'it' } }
    })
    expect(api.diagnosticsStatus).toHaveBeenCalled()
    await store.getState().save()
    const reopened = createDiagnosticsStore(() => api)
    await reopened.getState().select(id)
    expect(reopened.getState()).toMatchObject({
      title: 'Unsaved title',
      notes: 'Unsaved notes',
      session: { report: { source: 'local', language: 'it' } }
    })
  })

  it('rejects analysis during capture and keeps the previous report on an analysis failure', async () => {
    const { store, api, id } = setup()
    await store.getState().select(id)
    await store.getState().analyze('en')
    const report = store.getState().session!.report
    api.diagnosticsAnalyze.mockRejectedValueOnce(new Error('Disk full'))
    await store.getState().analyze('it')
    await store.getState().refresh()
    expect(store.getState()).toMatchObject({ error: true, busy: null, session: { report } })
    await store.getState().start(120, false)
    api.diagnosticsAnalyze.mockClear()
    await store.getState().analyze('en')
    expect(api.diagnosticsAnalyze).not.toHaveBeenCalled()
    await store.getState().stop()
  })

  it('coalesces slow polls so repeated ticks cannot invalidate every response', async () => {
    const { store, api, fixture } = setup()
    let finish!: (value: ReturnType<typeof fixture.diagnosticsStatus>) => void
    api.diagnosticsStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const first = store.getState().refresh()
    const second = store.getState().refresh()
    const third = store.getState().refresh()
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(api.diagnosticsStatus).toHaveBeenCalledTimes(1)
    finish(fixture.diagnosticsStatus())
    await first
    expect(store.getState().status?.rows).toHaveLength(1)
    await store.getState().refresh()
    expect(api.diagnosticsStatus).toHaveBeenCalledTimes(2)
  })
  it('discards a poll started before saving and guarantees a fresh post-save snapshot', async () => {
    const { store, api, fixture, id } = setup()
    await store.getState().select(id)
    const oldStatus = fixture.diagnosticsStatus()
    let finish!: (value: typeof oldStatus) => void
    api.diagnosticsStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const poll = store.getState().refresh()
    store.getState().setDraft('title', 'New saved title')
    const saving = store.getState().save()
    await Promise.resolve()
    finish(oldStatus)
    await Promise.all([poll, saving])
    expect(api.diagnosticsStatus).toHaveBeenCalledTimes(2)
    expect(store.getState().status?.rows[0].title).toBe('New saved title')
    expect(store.getState()).toMatchObject({ busy: null, feedback: 'detailsSaved' })
  })
  it('saves normalized details and reopens the persisted values after changing selection', async () => {
    const { store, id, api } = setup()
    await store.getState().select(id)
    store.getState().setDraft('title', '  Edited recording  ')
    store.getState().setDraft('notes', 'A note\nwith two lines')
    await store.getState().save()
    expect(store.getState()).toMatchObject({
      title: 'Edited recording',
      feedback: 'detailsSaved',
      error: false
    })
    await store.getState().select(null)
    await store.getState().select(id)
    expect(store.getState()).toMatchObject({
      title: 'Edited recording',
      notes: 'A note\nwith two lines'
    })
    const reopened = createDiagnosticsStore(() => api)
    await reopened.getState().select(id)
    expect(reopened.getState().title).toBe('Edited recording')
  })
  it('keeps the draft across Stop and saves it only after the recording has finished', async () => {
    const { store, api } = setup()
    await store.getState().start(120, false)
    store.getState().setDraft('title', 'Draft during capture')
    store.getState().setDraft('notes', 'Keep this text')
    await store.getState().save()
    await store.getState().togglePinned()
    await store.getState().remove()
    expect(api.diagnosticsEdit).not.toHaveBeenCalled()
    expect(api.diagnosticsRemove).not.toHaveBeenCalled()
    await store.getState().stop()
    expect(store.getState()).toMatchObject({
      title: 'Draft during capture',
      notes: 'Keep this text',
      session: { state: 'saved' }
    })
    await store.getState().save()
    expect(api.diagnosticsEdit).toHaveBeenCalledExactlyOnceWith(store.getState().selectedId, {
      title: 'Draft during capture',
      notes: 'Keep this text',
      pinned: false
    })
  })
  it('preserves a draft when the duration expires without a Stop click', async () => {
    vi.useFakeTimers()
    const { store } = setup()
    await store.getState().start(120, false)
    store.getState().setDraft('title', 'Timer draft')
    vi.setSystemTime(Date.now() + 120000)
    await store.getState().refresh()
    expect(store.getState()).toMatchObject({ title: 'Timer draft', session: { state: 'saved' } })
  })
  it('keeps a save failure visible through successful polling and allows retry', async () => {
    const { store, id, api } = setup()
    await store.getState().select(id)
    store.getState().setDraft('title', 'Retry title')
    api.diagnosticsEdit.mockRejectedValueOnce(new Error('Disk unavailable'))
    await store.getState().save()
    await store.getState().refresh()
    expect(store.getState()).toMatchObject({ error: true, title: 'Retry title', feedback: null })
    await store.getState().save()
    expect(store.getState()).toMatchObject({ error: false, feedback: 'detailsSaved' })
  })
  it('pins without discarding a draft and protects pinned recordings from deletion', async () => {
    const { store, id, api } = setup()
    await store.getState().select(id)
    store.getState().setDraft('notes', 'Unsaved note')
    await store.getState().togglePinned()
    expect(store.getState()).toMatchObject({
      notes: 'Unsaved note',
      session: { pinned: true, notes: 'Original note' }
    })
    await store.getState().remove()
    expect(api.diagnosticsRemove).not.toHaveBeenCalled()
    await store.getState().togglePinned()
    await store.getState().remove()
    expect(store.getState()).toMatchObject({ selectedId: null, session: null, feedback: 'removed' })
    expect(store.getState().status?.rows).toHaveLength(0)
  })
  it('reports export cancellation, success and failure separately', async () => {
    const { store, id, api } = setup()
    await store.getState().select(id)
    api.diagnosticsExport.mockResolvedValueOnce(false)
    await store.getState().export()
    expect(store.getState()).toMatchObject({ feedback: 'exportCancelled', error: false })
    await store.getState().export()
    expect(store.getState().feedback).toBe('exported')
    api.diagnosticsExport.mockRejectedValueOnce(new Error('Cannot write'))
    await store.getState().export()
    expect(store.getState()).toMatchObject({ feedback: null, error: true })
  })
  it('ignores stale detail responses and never edits a previous selection while loading', async () => {
    const { store, id, api } = setup()
    let resolveOld!: (value: DiagnosticSession) => void
    api.diagnosticsGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        })
    )
    const old = store.getState().select(id)
    const other = {
      ...sample(),
      title: 'Second recording',
      recording: { ...sample().recording, recordId: '00000000-0000-4000-8000-000000000003' }
    }
    api.diagnosticsGet.mockResolvedValueOnce(other)
    await store.getState().select(other.recording.recordId)
    resolveOld(sample())
    await old
    expect(store.getState()).toMatchObject({
      selectedId: other.recording.recordId,
      title: 'Second recording'
    })
    api.diagnosticsGet.mockImplementationOnce(() => new Promise(() => {}))
    void store.getState().select(id)
    await store.getState().save()
    expect(api.diagnosticsEdit).not.toHaveBeenCalled()
    expect(store.getState().session).toBeNull()
  })
  it('serializes action clicks and locks selection until a save settles', async () => {
    const { store, id, api } = setup()
    await store.getState().select(id)
    let finish!: () => void
    api.diagnosticsEdit.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    store.getState().setDraft('title', 'One save')
    const first = store.getState().save()
    await store.getState().save()
    await store.getState().togglePinned()
    await store.getState().select(null)
    expect(api.diagnosticsEdit).toHaveBeenCalledTimes(1)
    expect(store.getState()).toMatchObject({ busy: 'save', selectedId: id })
    finish()
    await first
    expect(store.getState().busy).toBeNull()
  })
})
