import { create } from 'zustand'
import type { AiAnalysisResult, AiAnalysisSource, AiAnalysisStatus } from '@shared/ai-analysis'
import { buildAiAnalysisRequest, type LocalAiCandidate } from '@/components/ai/ai-metadata'

interface Session {
  enabled: boolean
  revision: unknown
  result: AiAnalysisResult | null
  error: boolean
  omitted: number
  localPaths: Map<string, string>
}
const emptySession = (): Session => ({
  enabled: false,
  revision: undefined,
  result: null,
  error: false,
  omitted: 0,
  localPaths: new Map()
})
type Api = Pick<Window['kudu'], 'aiAnalysisStatus' | 'aiAnalysisRun' | 'aiAnalysisCancel'>
interface State {
  sessions: Record<AiAnalysisSource, Session>
  connection: AiAnalysisStatus | null
  checking: boolean
  activeSource: AiAnalysisSource | null
  cancelling: boolean
  sync(source: AiAnalysisSource, revision: unknown): void
  toggle(source: AiAnalysisSource): void
  checkConnection(): Promise<void>
  analyze(source: AiAnalysisSource, candidates: LocalAiCandidate[]): Promise<void>
  cancel(source: AiAnalysisSource): void
}

/** An AI request belongs to the app session, never to the mounted page. */
export function createAiAnalysisStore(api: () => Api) {
  let generation = 0
  let checking: Promise<void> | null = null
  return create<State>((set, get) => {
    const patch = (source: AiAnalysisSource, values: Partial<Session>) =>
      set((s) => ({ sessions: { ...s.sessions, [source]: { ...s.sessions[source], ...values } } }))
    const clear = (source: AiAnalysisSource) =>
      patch(source, { result: null, error: false, omitted: 0, localPaths: new Map() })
    return {
      sessions: {
        cleaner: emptySession(),
        'large-files': emptySession(),
        duplicates: emptySession(),
        disk: emptySession()
      },
      connection: null,
      checking: false,
      activeSource: null,
      cancelling: false,
      sync: (source, revision) => {
        if (get().sessions[source].revision === revision) return
        if (get().activeSource === source) get().cancel(source)
        clear(source)
        patch(source, { revision })
      },
      toggle: (source) => {
        const enabled = !get().sessions[source].enabled
        patch(source, { enabled })
        if (enabled) void get().checkConnection()
        else {
          get().cancel(source)
          clear(source)
        }
      },
      checkConnection: () => {
        if (checking) return checking
        set({ checking: true })
        checking = (async () => {
          try {
            set({ connection: await api().aiAnalysisStatus() })
          } catch {
            set({ connection: { connected: false, available: false } })
          } finally {
            checking = null
            set({ checking: false })
          }
        })()
        return checking
      },
      analyze: async (source, candidates) => {
        const { connection, activeSource, sessions } = get()
        if (
          activeSource ||
          !sessions[source].enabled ||
          !connection?.available ||
          !connection.connected
        )
          return
        const prepared = buildAiAnalysisRequest(source, candidates)
        if (!prepared.request.items.length) return
        const current = ++generation
        clear(source)
        patch(source, { localPaths: prepared.localPaths, omitted: prepared.omitted })
        set({ activeSource: source, cancelling: false })
        try {
          const result = await api().aiAnalysisRun(prepared.request)
          if (current === generation) patch(source, { result })
        } catch {
          if (current === generation) patch(source, { error: true })
        } finally {
          // A replacement cannot start until the previous bridge call has settled.
          set({ activeSource: null, cancelling: false })
        }
      },
      cancel: (source) => {
        if (get().activeSource !== source || get().cancelling) return
        const revision = get().sessions[source].revision
        const current = ++generation
        clear(source)
        set({ cancelling: true })
        void api()
          .aiAnalysisCancel()
          .catch(() => {
            const state = get()
            if (
              current === generation &&
              state.activeSource === source &&
              state.sessions[source].enabled &&
              state.sessions[source].revision === revision
            )
              patch(source, { error: true })
          })
      }
    }
  })
}

export const useAiAnalysisStore = createAiAnalysisStore(() => window.kudu)
