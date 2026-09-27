import { create } from 'zustand'
import type { AiAnalysisStatus } from '@shared/ai-analysis'
import type {
  DiagnosticAiReport,
  DiagnosticSession,
  DiagnosticSummary
} from '@shared/performance-diagnostics'

type Status = {
  rows: DiagnosticSummary[]
  activeId: string | null
  elapsedMs: number
  error: string | null
}
type Operation = 'start' | 'stop' | 'save' | 'pin' | 'export' | 'remove' | 'analyze' | 'analyzeAi'
type Feedback =
  | 'detailsSaved'
  | 'recordingSaved'
  | 'pinnedSaved'
  | 'unpinnedSaved'
  | 'exported'
  | 'exportCancelled'
  | 'removed'
  | 'analysisSaved'
  | 'aiAnalysisSaved'
export interface DiagnosticsApi {
  aiAnalysisStatus(): Promise<AiAnalysisStatus>
  diagnosticsAiAnalyze(id: string, language: 'en' | 'it'): Promise<DiagnosticAiReport>
  diagnosticsAiCancel(): Promise<void>
  diagnosticsStatus(): Promise<Status>
  diagnosticsGet(id: string): Promise<DiagnosticSession>
  diagnosticsAnalyze(
    id: string,
    language: 'en' | 'it'
  ): Promise<NonNullable<DiagnosticSession['report']>>
  diagnosticsStart(seconds: number, processes: boolean): Promise<string>
  diagnosticsStop(): Promise<void>
  diagnosticsEdit(
    id: string,
    details: { title: string; notes: string; pinned: boolean }
  ): Promise<void>
  diagnosticsRemove(id: string): Promise<void>
  diagnosticsExport(id: string): Promise<boolean>
}
const AI_ERROR_CODES = [
  'codex-not-found',
  'codex-version-unsupported',
  'not-connected',
  'codex-unavailable',
  'unsafe-configuration',
  'busy',
  'cancelled',
  'timeout',
  'invalid-metadata',
  'invalid-response',
  'analysis-failed'
] as const

function aiErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return (
    AI_ERROR_CODES.find((code) => message === code || message.endsWith(`Error: ${code}`)) ??
    'analysis-failed'
  )
}
interface State {
  status: Status | null
  selectedId: string | null
  session: DiagnosticSession | null
  title: string
  notes: string
  loading: boolean
  busy: Operation | null
  error: boolean
  statusError: boolean
  feedback: Feedback | null
  aiEnabled: boolean
  aiConnection: AiAnalysisStatus | null
  aiChecking: boolean
  aiCancelling: boolean
  aiErrorCode: string | null
  toggleAi(): void
  checkAiConnection(): Promise<void>
  analyzeAi(id: string, language: 'en' | 'it'): Promise<void>
  cancelAi(): Promise<void>
  refresh(): Promise<void>
  select(id: string | null): Promise<void>
  setDraft(field: 'title' | 'notes', value: string): void
  start(seconds: number, processes: boolean): Promise<void>
  stop(): Promise<void>
  save(): Promise<void>
  analyze(language: 'en' | 'it'): Promise<void>
  togglePinned(): Promise<void>
  remove(): Promise<void>
  export(): Promise<void>
}

export function createDiagnosticsStore(api: () => DiagnosticsApi) {
  let selectionRevision = 0
  let statusRevision = 0
  let statusInFlight: Promise<void> | null = null
  let aiCheckInFlight: Promise<void> | null = null
  return create<State>((set, get) => {
    const loadSelected = async (preserveDraft: boolean) => {
      const id = get().selectedId
      if (!id) return
      const revision = ++selectionRevision
      set({ loading: true })
      try {
        const session = await api().diagnosticsGet(id)
        if (revision !== selectionRevision || get().selectedId !== id) return
        set({
          session,
          loading: false,
          ...(preserveDraft ? {} : { title: session.title, notes: session.notes })
        })
      } catch {
        if (revision === selectionRevision) set({ loading: false, error: true })
      }
    }
    const perform = async (busy: Operation, work: () => Promise<void>) => {
      if (get().busy) return
      statusRevision++ // A poll started before the mutation must not restore stale rows.
      set({ busy, error: false, feedback: null })
      try {
        await work()
        // Wait out an invalidated pre-mutation poll, then read a fresh snapshot.
        await statusInFlight
        await get().refresh()
      } catch {
        set({ error: true })
      } finally {
        set({ busy: null })
      }
    }
    const selected = () => {
      const { session, selectedId, loading } = get()
      return !loading && session?.recording.recordId === selectedId ? session : null
    }
    const editable = () => {
      const session = selected()
      return session &&
        session.state !== 'recording' &&
        get().status?.activeId !== session.recording.recordId
        ? session
        : null
    }
    return {
      status: null,
      selectedId: null,
      session: null,
      title: '',
      notes: '',
      loading: false,
      busy: null,
      error: false,
      statusError: false,
      feedback: null,
      aiEnabled: false,
      aiConnection: null,
      aiChecking: false,
      aiCancelling: false,
      aiErrorCode: null,
      toggleAi: () => {
        if (get().busy === 'analyzeAi') return
        const aiEnabled = !get().aiEnabled
        set({ aiEnabled, aiErrorCode: null })
        if (aiEnabled) void get().checkAiConnection()
      },
      checkAiConnection: () => {
        if (aiCheckInFlight) return aiCheckInFlight
        set({ aiChecking: true })
        aiCheckInFlight = (async () => {
          try {
            set({ aiConnection: await api().aiAnalysisStatus() })
          } catch {
            set({ aiConnection: { connected: false, available: false } })
          } finally {
            aiCheckInFlight = null
            set({ aiChecking: false })
          }
        })()
        return aiCheckInFlight
      },
      analyzeAi: async (id, language) => {
        const session = editable()
        const { aiConnection, aiEnabled } = get()
        if (
          get().busy ||
          !session ||
          session.recording.recordId !== id ||
          !aiEnabled ||
          !aiConnection?.available ||
          !aiConnection.connected
        )
          return
        statusRevision++
        set({ busy: 'analyzeAi', aiCancelling: false, aiErrorCode: null, feedback: null })
        try {
          const aiReport = await api().diagnosticsAiAnalyze(id, language)
          // The report is persisted by main. The draft is deliberately untouched.
          set({ session: { ...session, aiReport }, feedback: 'aiAnalysisSaved' })
          await statusInFlight
          await get().refresh()
        } catch (error) {
          set({ aiErrorCode: aiErrorCode(error) })
        } finally {
          set({ busy: null, aiCancelling: false })
        }
      },
      cancelAi: async () => {
        if (get().busy !== 'analyzeAi' || get().aiCancelling) return
        set({ aiCancelling: true })
        try {
          await api().diagnosticsAiCancel()
        } catch {
          set({ aiErrorCode: 'analysis-failed', aiCancelling: false })
        }
      },
      refresh: () => {
        if (statusInFlight) return statusInFlight
        const revision = statusRevision
        statusInFlight = (async () => {
          try {
            const status = await api().diagnosticsStatus()
            if (revision !== statusRevision) return
            const { session, selectedId } = get()
            set({ status, statusError: false })
            // Keep a typed draft when a timer or Stop completes this recording.
            const row = status.rows.find((value) => value.id === selectedId)
            if (session && row && session.state !== row.state) await loadSelected(true)
          } catch {
            if (revision === statusRevision) set({ statusError: true })
          } finally {
            statusInFlight = null
          }
        })()
        return statusInFlight
      },
      select: async (id) => {
        if (get().busy) return
        if (id === get().selectedId && get().session) return
        selectionRevision++
        set({
          selectedId: id,
          session: null,
          title: '',
          notes: '',
          loading: !!id,
          error: false,
          feedback: null,
          aiErrorCode: null
        })
        if (id) await loadSelected(false)
      },
      setDraft: (field, value) => {
        if (!get().busy) set({ [field]: value, feedback: null })
      },
      start: (seconds, processes) =>
        perform('start', async () => {
          const id = await api().diagnosticsStart(seconds, processes)
          selectionRevision++
          set({ selectedId: id, session: null, title: '', notes: '', aiErrorCode: null })
          await loadSelected(false)
        }),
      stop: () =>
        perform('stop', async () => {
          await api().diagnosticsStop()
          await loadSelected(true)
          set({ feedback: 'recordingSaved' })
        }),
      save: async () => {
        const session = editable()
        const { title, notes } = get()
        if (!session || !title.trim()) return
        await perform('save', async () => {
          const details = { title: title.trim(), notes, pinned: session.pinned }
          await api().diagnosticsEdit(session.recording.recordId, details)
          set({
            session: { ...session, ...details },
            title: details.title,
            notes: details.notes,
            feedback: 'detailsSaved'
          })
        })
      },
      togglePinned: async () => {
        const session = editable()
        if (!session) return
        await perform('pin', async () => {
          const pinned = !session.pinned
          await api().diagnosticsEdit(session.recording.recordId, {
            title: session.title,
            notes: session.notes,
            pinned
          })
          // Pinning changes persisted metadata, never the user's unsaved draft.
          set({
            session: { ...session, pinned },
            feedback: pinned ? 'pinnedSaved' : 'unpinnedSaved'
          })
        })
      },
      analyze: async (language) => {
        const session = editable()
        if (!session) return
        await perform('analyze', async () => {
          const report = await api().diagnosticsAnalyze(session.recording.recordId, language)
          // Analysis uses saved measurements, not the title/notes draft. Keep it
          // available if the user leaves this view while the report is saved.
          set({ session: { ...session, report }, feedback: 'analysisSaved' })
        })
      },
      remove: async () => {
        const session = editable()
        if (!session || session.pinned) return
        await perform('remove', async () => {
          await api().diagnosticsRemove(session.recording.recordId)
          selectionRevision++
          set({ selectedId: null, session: null, title: '', notes: '', feedback: 'removed' })
        })
      },
      export: async () => {
        const session = selected()
        if (!session) return
        await perform('export', async () => {
          const exported = await api().diagnosticsExport(session.recording.recordId)
          set({ feedback: exported ? 'exported' : 'exportCancelled' })
        })
      }
    }
  })
}

export const useDiagnosticsStore = createDiagnosticsStore(() => window.kudu)
