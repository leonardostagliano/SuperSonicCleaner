import type { DiagnosticAiReport, DiagnosticRecording } from '@shared/performance-diagnostics'

const PROCESS_ID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi

/** Resolve only references present in the saved local map; render the result as plain text. */
export function resolveAiProcessReferences(
  text: string,
  report: DiagnosticAiReport,
  recording: DiagnosticRecording
): string {
  const names = new Map(
    report.processRefs.flatMap((ref) => {
      const process = recording.samples[ref.sampleIndex]?.processes[ref.processIndex]
      return process ? [[ref.id.toLowerCase(), process.name] as const] : []
    })
  )
  return text.replace(PROCESS_ID, (id) => names.get(id.toLowerCase()) ?? id)
}
