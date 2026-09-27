import { diagnosticId, validDiagnosticDetails } from '../../shared/performance-diagnostics'
import type { DiagnosticSession, DiagnosticSummary } from '../../shared/performance-diagnostics'
import { DiagnosticsRecorder } from './diagnostics-recorder'
import { DiagnosticsStore } from './diagnostics-store'
import { analyzeDiagnosticRecording } from '../../shared/local-diagnostic-analysis'
import type { DiagnosticReport, DiagnosticAiReport } from '../../shared/performance-diagnostics'
import { analyzePerformanceWithCodex } from './codex-connection'
import { parsePerformanceAiResult, preparePerformanceAi } from './performance-ai-policy'

export class PerformanceDiagnostics {
  readonly recorder: DiagnosticsRecorder
  private initialized: Promise<void> | null = null
  private mutation: Promise<unknown> = Promise.resolve()
  constructor(readonly store: DiagnosticsStore) {
    this.recorder = new DiagnosticsRecorder(store)
  }
  async ready(): Promise<void> {
    if (!this.initialized)
      this.initialized = (async () => {
        for (const row of await this.store.list()) {
          if (row.state === 'recording') {
            const s = await this.store.get(row.id)
            s.state = 'interrupted'
            await this.store.save(s)
          }
        }
      })().catch((e) => {
        this.initialized = null
        throw e
      })
    return this.initialized
  }
  private change<T>(work: () => Promise<T>): Promise<T> {
    const next = this.mutation.then(work, work)
    this.mutation = next.catch(() => {})
    return next
  }
  async status(): Promise<{
    rows: DiagnosticSummary[]
    activeId: string | null
    elapsedMs: number
    error: string | null
  }> {
    await this.ready()
    const active = this.recorder.active
    return {
      rows: await this.store.list(),
      activeId: active?.recording.recordId ?? null,
      elapsedMs: active?.recording.durationMs ?? 0,
      error: this.recorder.error
    }
  }
  async start(seconds: unknown, processes: unknown): Promise<string> {
    await this.ready()
    return this.recorder.start(seconds, processes)
  }
  async get(id: string): Promise<DiagnosticSession> {
    const s = await this.load(id)
    return {
      recording: s.recording,
      title: s.title,
      notes: s.notes,
      pinned: s.pinned,
      state: s.state,
      report: s.report,
      ...(s.aiReport ? { aiReport: s.aiReport } : {})
    }
  }
  private async load(id: string): Promise<DiagnosticSession> {
    await this.ready()
    if (this.recorder.active?.recording.recordId === id)
      return structuredClone(this.recorder.active)
    return this.store.get(id)
  }
  private async saved(id: string): Promise<DiagnosticSession> {
    if (!diagnosticId(id) || this.recorder.active?.recording.recordId === id)
      throw new Error('Stop the recording before changing it.')
    return this.load(id)
  }
  edit(id: string, value: unknown): Promise<void> {
    return this.change(async () => {
      if (!validDiagnosticDetails(value)) throw new Error('Invalid recording details')
      const s = await this.saved(id)
      await this.store.save({
        ...s,
        title: value.title.trim(),
        notes: value.notes,
        pinned: value.pinned
      })
    })
  }
  analyze(id: string, language: unknown): Promise<DiagnosticReport> {
    return this.change(async () => {
      if (language !== 'en' && language !== 'it') throw new Error('Invalid analysis language')
      const session = await this.saved(id)
      if (session.state === 'recording') throw new Error('Stop the recording before analyzing it.')
      const report = analyzeDiagnosticRecording(
        session.recording,
        language,
        session.state === 'interrupted'
      )
      await this.store.save({ ...session, report })
      return report
    })
  }
  remove(id: string): Promise<void> {
    return this.change(async () => {
      await this.saved(id)
      await this.store.remove(id)
    })
  }

  async analyzeAi(id: string, language: unknown, signal: AbortSignal): Promise<DiagnosticAiReport> {
    if (language !== 'en' && language !== 'it') throw new Error('invalid-metadata')
    if (signal.aborted) throw new Error('cancelled')
    if (!diagnosticId(id) || this.recorder.active?.recording.recordId === id)
      throw new Error('invalid-metadata')
    const session = await this.saved(id)
    if (session.state === 'recording') throw new Error('invalid-metadata')
    const prepared = preparePerformanceAi(session.recording, session.state === 'interrupted')
    const text = await analyzePerformanceWithCodex(prepared.request, {
      italian: language === 'it',
      signal
    })
    if (signal.aborted) throw new Error('cancelled')
    const result = parsePerformanceAiResult(text, prepared.request)
    const aiReport: DiagnosticAiReport = {
      ...result,
      version: 1,
      source: 'codex',
      language,
      analyzerVersion: 'codex-metrics/1.0.0',
      generatedAt: new Date().toISOString(),
      processRefs: prepared.processRefs,
      limitations: [
        ...result.limitations,
        language === 'it'
          ? 'L’AI ha ricevuto solo metriche aggregate e ID opachi; nomi, percorsi e contenuti sono rimasti sul dispositivo.'
          : 'AI received only aggregated metrics and opaque IDs; names, paths and contents remained on this device.',
        language === 'it'
          ? 'Le interpretazioni sono ipotesi da verificare: correlazione e throughput non dimostrano la causa né la saturazione del disco. Senza orario di avvio, processi con lo stesso ID e nome possono essere indistinguibili.'
          : 'Interpretations are hypotheses to check: correlation and throughput do not establish a cause or disk saturation. Without start times, processes with the same ID and name may be indistinguishable.'
      ]
    }
    return this.change(async () => {
      if (signal.aborted) throw new Error('cancelled')
      // Load again after inference: retain edits/pins and never resurrect a deleted recording.
      const current = await this.saved(id)
      if (signal.aborted) throw new Error('cancelled')
      await this.store.save({ ...current, aiReport }, false, signal)
      return aiReport
    })
  }
}
