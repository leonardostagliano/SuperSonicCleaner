import type { DiagnosticSession, DiagnosticSummary } from '@shared/performance-diagnostics'
import { diagnosticExportPayload, validDiagnosticDetails } from '@shared/performance-diagnostics'
import { analyzeDiagnosticRecording } from '@shared/local-diagnostic-analysis'

function downloadRecording(session: DiagnosticSession): boolean {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(diagnosticExportPayload(session), null, 2)], {
      type: 'application/json'
    })
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `supersonic-cleaner-diagnostic-${session.recording.recordId}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}

// Browser-only workflow simulation. No measurements leave this page.
export function diagnosticsFixture(
  sample: DiagnosticSession,
  empty: boolean,
  exportSession = downloadRecording
) {
  const sessions = new Map<string, DiagnosticSession>()
  if (!empty) sessions.set(sample.recording.recordId, structuredClone(sample))
  let activeId: string | null = null
  let started = 0
  let duration = 120000
  let includeProcesses = false
  const get = (id: string) => {
    const session = sessions.get(id)
    if (!session) throw new Error('Preview recording not found')
    return session
  }
  const capture = () => {
    if (!activeId) return
    const session = get(activeId)
    const elapsed = Math.min(duration, Date.now() - started)
    session.recording.durationMs = elapsed
    session.recording.samples = Array.from({ length: Math.floor(elapsed / 1000) + 1 }, (_, i) => ({
      t: i * 1000,
      cpuPercent: i >= 10 && i <= 55 ? 91 : 24,
      memoryPercent: 42,
      memoryUsedBytes: session.recording.system.totalMemoryBytes * 0.42,
      diskReadBytesPerSec: i % 5 === 1 ? 2 * 1024 ** 2 : null,
      diskWriteBytesPerSec: i % 5 === 1 ? 1024 ** 2 : null,
      processes: includeProcesses ? (sample.recording.samples[0]?.processes ?? []) : []
    }))
  }
  const finish = () => {
    if (!activeId) return
    capture()
    const session = get(activeId)
    session.state = 'saved'
    activeId = null
  }
  return {
    diagnosticsStatus: () => {
      capture()
      if (activeId && Date.now() - started >= duration) finish()
      return {
        rows: [...sessions.values()].map((s): DiagnosticSummary => ({
          id: s.recording.recordId,
          title: s.title,
          pinned: s.pinned,
          state: s.state,
          startedAt: s.recording.startedAt,
          durationMs: s.recording.durationMs,
          samples: s.recording.samples.length
        })),
        activeId,
        elapsedMs: activeId ? Date.now() - started : 0,
        error: null
      }
    },
    diagnosticsGet: (id: string) => structuredClone(get(id)),
    diagnosticsStart: (seconds: number, processes: boolean) => {
      if (![120, 300, 900].includes(seconds) || typeof processes !== 'boolean')
        throw new Error('Choose a supported recording duration')
      if (activeId) throw new Error('A recording is already active')
      if (sessions.size >= 30) throw new Error('Recording capacity reached')
      const session = structuredClone(sample)
      session.recording.recordId = crypto.randomUUID()
      session.recording.startedAt = new Date().toISOString()
      session.recording.durationMs = 0
      session.recording.samples = []
      session.title = 'Performance recording'
      session.notes = ''
      session.state = 'recording'
      session.report = null
      session.aiReport = null
      activeId = session.recording.recordId
      started = Date.now()
      duration = seconds * 1000
      includeProcesses = processes
      sessions.set(activeId, session)
      return activeId
    },
    diagnosticsStop: finish,
    diagnosticsAnalyze: (id: string, language: 'en' | 'it') => {
      if (id === activeId) throw new Error('Stop the recording before analyzing it.')
      const session = get(id)
      const report = analyzeDiagnosticRecording(
        session.recording,
        language,
        session.state === 'interrupted'
      )
      session.report = report
      return structuredClone(report)
    },
    diagnosticsAiAnalyze: (id: string, language: 'en' | 'it') => {
      if (id === activeId) throw new Error('Stop the recording before analyzing it.')
      const session = get(id)
      const local = analyzeDiagnosticRecording(
        session.recording,
        language,
        session.state === 'interrupted'
      )
      session.aiReport = {
        ...local,
        source: 'codex',
        summary:
          language === 'it'
            ? 'Esempio di rapporto Codex basato sulle misurazioni di anteprima.'
            : 'Sample Codex report based on preview measurements.',
        findings: local.findings.map((finding) => ({
          ...finding,
          evidence: finding.evidence.map((evidence) => ({ ...evidence, processId: null }))
        })),
        processRefs: []
      }
      return structuredClone(session.aiReport)
    },
    diagnosticsAiCancel: () => undefined,
    diagnosticsEdit: (id: string, details: { title: string; notes: string; pinned: boolean }) => {
      if (id === activeId) throw new Error('Stop the recording before changing it.')
      if (!validDiagnosticDetails(details)) throw new Error('Invalid recording details')
      Object.assign(get(id), { ...details, title: details.title.trim() })
    },
    diagnosticsRemove: (id: string) => {
      if (id === activeId) throw new Error('Stop the recording before changing it.')
      if (get(id).pinned) throw new Error('Unpin this recording before deleting it.')
      sessions.delete(id)
    },
    diagnosticsExport: (id: string) => {
      return exportSession(structuredClone(get(id)))
    }
  }
}
