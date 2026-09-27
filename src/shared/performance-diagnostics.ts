export const DIAGNOSTIC_METRICS = [
  'cpuPercent',
  'memoryPercent',
  'memoryUsedBytes',
  'diskReadBytesPerSec',
  'diskWriteBytesPerSec',
  'processCpuPercent',
  'processMemoryBytes'
] as const
export type DiagnosticMetric = (typeof DIAGNOSTIC_METRICS)[number]
export interface DiagnosticProcess {
  pid: number
  name: string
  startedAt: string | null
  cpuPercent: number | null
  memoryBytes: number | null
}
export interface DiagnosticSample {
  t: number
  cpuPercent: number | null
  memoryPercent: number | null
  memoryUsedBytes: number | null
  diskReadBytesPerSec: number | null
  diskWriteBytesPerSec: number | null
  processes: DiagnosticProcess[]
}
export interface DiagnosticRecording {
  version: 1
  recordId: string
  startedAt: string
  durationMs: number
  system: {
    platform: 'win32' | 'darwin' | 'linux'
    cpuModel: string
    logicalCores: number
    totalMemoryBytes: number
    osVersion: string
  }
  samples: DiagnosticSample[]
}
export interface DiagnosticReport {
  version: 1
  source?: 'local'
  language?: 'en' | 'it'
  analyzerVersion: string
  generatedAt: string
  summary: string
  findings: {
    title: string
    confidence: 'low' | 'medium' | 'high'
    observation: string
    interpretation: string
    nextSteps: string[]
    evidence: { metric: DiagnosticMetric; startMs: number; endMs: number }[]
  }[]
  limitations: string[]
}
export interface DiagnosticAiReport extends Omit<DiagnosticReport, 'source' | 'findings'> {
  source: 'codex'
  findings: Array<
    Omit<DiagnosticReport['findings'][number], 'evidence'> & {
      evidence: Array<
        DiagnosticReport['findings'][number]['evidence'][number] & { processId: string | null }
      >
    }
  >
  /** Local-only pointers into this recording; never included in an inference request. */
  processRefs: Array<{ id: string; sampleIndex: number; processIndex: number }>
}
export interface DiagnosticSession {
  recording: DiagnosticRecording
  title: string
  notes: string
  pinned: boolean
  state: 'recording' | 'saved' | 'interrupted'
  report: DiagnosticReport | null
  aiReport?: DiagnosticAiReport | null
}
export type DiagnosticSummary = Pick<DiagnosticSession, 'title' | 'pinned' | 'state'> & {
  id: string
  startedAt: string
  durationMs: number
  samples: number
}

export type DiagnosticDetails = Pick<DiagnosticSession, 'title' | 'notes' | 'pinned'>

export function validDiagnosticDetails(value: unknown): value is DiagnosticDetails {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const details = value as Record<string, unknown>
  return (
    typeof details.title === 'string' &&
    !!details.title.trim() &&
    details.title.length <= 120 &&
    typeof details.notes === 'string' &&
    details.notes.length <= 2000 &&
    typeof details.pinned === 'boolean'
  )
}

/** Explicit export fields prevent retired account metadata from leaving local storage. */
export function diagnosticExportPayload(session: DiagnosticSession) {
  return {
    version: 1,
    title: session.title,
    notes: session.notes,
    recording: session.recording,
    report: session.report,
    ...(session.aiReport ? { aiReport: session.aiReport } : {})
  }
}

export function diagnosticId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
}
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max
const numeric = (v: unknown, max: number): boolean =>
  v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max)
const strings = (v: unknown, maxItems: number, maxLength: number): v is string[] =>
  Array.isArray(v) && v.length <= maxItems && v.every((s) => text(s, maxLength))

export function validDiagnosticReport(v: unknown, duration: number): v is DiagnosticReport {
  if (
    !object(v) ||
    v.version !== 1 ||
    (v.source !== undefined && v.source !== 'local') ||
    (v.language !== undefined && v.language !== 'en' && v.language !== 'it') ||
    !text(v.analyzerVersion, 80) ||
    !text(v.generatedAt, 40) ||
    !text(v.summary, 1500) ||
    !strings(v.limitations, 8, 500) ||
    !Array.isArray(v.findings) ||
    v.findings.length > 8
  )
    return false
  return v.findings.every(
    (f) =>
      object(f) &&
      text(f.title, 160) &&
      ['low', 'medium', 'high'].includes(String(f.confidence)) &&
      text(f.observation, 1200) &&
      text(f.interpretation, 1200) &&
      strings(f.nextSteps, 5, 400) &&
      f.nextSteps.length > 0 &&
      Array.isArray(f.evidence) &&
      f.evidence.length > 0 &&
      f.evidence.length <= 5 &&
      f.evidence.every(
        (e) =>
          object(e) &&
          DIAGNOSTIC_METRICS.includes(e.metric as DiagnosticMetric) &&
          typeof e.startMs === 'number' &&
          Number.isInteger(e.startMs) &&
          typeof e.endMs === 'number' &&
          Number.isInteger(e.endMs) &&
          e.startMs >= 0 &&
          e.endMs >= e.startMs &&
          e.endMs <= duration
      )
  )
}

export function validDiagnosticAiReport(
  value: unknown,
  recording: DiagnosticRecording
): value is DiagnosticAiReport {
  if (
    !object(value) ||
    value.source !== 'codex' ||
    !validDiagnosticReport({ ...value, source: 'local' }, recording.durationMs) ||
    !Array.isArray(value.processRefs) ||
    value.processRefs.length > 24
  )
    return false
  const ids = new Set<string>()
  for (const ref of value.processRefs) {
    if (
      !object(ref) ||
      !diagnosticId(ref.id) ||
      ids.has(ref.id) ||
      typeof ref.sampleIndex !== 'number' ||
      !Number.isInteger(ref.sampleIndex) ||
      typeof ref.processIndex !== 'number' ||
      !Number.isInteger(ref.processIndex) ||
      !recording.samples[ref.sampleIndex]?.processes[ref.processIndex]
    )
      return false
    ids.add(ref.id)
  }
  return (value.findings as DiagnosticAiReport['findings']).every((finding) =>
    finding.evidence.every((evidence) =>
      evidence.metric.startsWith('process')
        ? typeof evidence.processId === 'string' && ids.has(evidence.processId)
        : evidence.processId === null
    )
  )
}

export function validDiagnosticRecording(v: unknown): v is DiagnosticRecording {
  if (
    !object(v) ||
    v.version !== 1 ||
    !diagnosticId(v.recordId) ||
    !text(v.startedAt, 40) ||
    !Number.isFinite(Date.parse(v.startedAt)) ||
    typeof v.durationMs !== 'number' ||
    !Number.isInteger(v.durationMs) ||
    v.durationMs < 0 ||
    v.durationMs > 900000 ||
    !object(v.system) ||
    !['win32', 'darwin', 'linux'].includes(String(v.system.platform)) ||
    !text(v.system.cpuModel, 160) ||
    !text(v.system.osVersion, 160) ||
    typeof v.system.totalMemoryBytes !== 'number' ||
    v.system.totalMemoryBytes <= 0 ||
    !numeric(v.system.totalMemoryBytes, 2 ** 50) ||
    typeof v.system.logicalCores !== 'number' ||
    !Number.isInteger(v.system.logicalCores) ||
    v.system.logicalCores < 1 ||
    v.system.logicalCores > 1024 ||
    !Array.isArray(v.samples) ||
    v.samples.length > 901
  )
    return false
  let previous = -1
  return v.samples.every((s) => {
    if (
      !object(s) ||
      typeof s.t !== 'number' ||
      !Number.isInteger(s.t) ||
      s.t <= previous ||
      s.t > (v.durationMs as number)
    )
      return false
    previous = s.t
    return (
      numeric(s.cpuPercent, 100) &&
      numeric(s.memoryPercent, 100) &&
      numeric(s.memoryUsedBytes, (v.system as DiagnosticRecording['system']).totalMemoryBytes) &&
      numeric(s.diskReadBytesPerSec, 2 ** 50) &&
      numeric(s.diskWriteBytesPerSec, 2 ** 50) &&
      Array.isArray(s.processes) &&
      s.processes.length <= 5 &&
      s.processes.every(
        (p) =>
          object(p) &&
          typeof p.pid === 'number' &&
          Number.isInteger(p.pid) &&
          p.pid > 0 &&
          p.pid <= 2147483647 &&
          text(p.name, 80) &&
          !/[\\/\u0000-\u001f]/.test(p.name) &&
          (p.startedAt === null ||
            (text(p.startedAt, 40) && Number.isFinite(Date.parse(p.startedAt)))) &&
          numeric(p.cpuPercent, 100) &&
          numeric(p.memoryBytes, 2 ** 50)
      )
    )
  })
}

export function diagnosticStats(r: DiagnosticRecording): {
  cpuMean: number | null
  memoryMean: number | null
  missingTicks: number
} {
  const mean = (key: 'cpuPercent' | 'memoryPercent'): number | null => {
    const values = r.samples.map((s) => s[key]).filter((v): v is number => v !== null)
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
  }
  return {
    cpuMean: mean('cpuPercent'),
    memoryMean: mean('memoryPercent'),
    missingTicks: Math.max(0, Math.floor(r.durationMs / 1000) + 1 - r.samples.length)
  }
}
