import { randomUUID } from 'node:crypto'
import {
  DIAGNOSTIC_METRICS,
  diagnosticId,
  validDiagnosticRecording,
  validDiagnosticReport,
  type DiagnosticAiReport,
  type DiagnosticRecording,
  type DiagnosticProcess
} from '../../shared/performance-diagnostics'
import type {
  PerformanceAiMetric,
  PerformanceAiRequest,
  PerformanceAiWindow
} from '../../shared/performance-ai'

const SYSTEM_METRICS = DIAGNOSTIC_METRICS.slice(0, 5) as Array<
  Exclude<(typeof DIAGNOSTIC_METRICS)[number], 'processCpuPercent' | 'processMemoryBytes'>
>
const processKey = (p: DiagnosticProcess) => JSON.stringify([p.pid, p.startedAt, p.name])
const aggregate = (
  points: Array<{ t: number; value: number | null }>
): PerformanceAiMetric | null => {
  const valid = points.filter((p): p is { t: number; value: number } => p.value !== null)
  if (!valid.length) return null
  const values = valid.map((p) => p.value).sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  return {
    median: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
    max: values.at(-1)!,
    sampleTimesMs: valid.map((p) => p.t)
  }
}

/** The original recording and process identities never cross the inference boundary. */
export function preparePerformanceAi(recording: DiagnosticRecording, interrupted: boolean) {
  if (!validDiagnosticRecording(recording) || !recording.samples.length)
    throw new Error('invalid-metadata')
  const known = new Map<
    string,
    { sampleIndex: number; processIndex: number; cpu: number; memory: number }
  >()
  recording.samples.forEach((sample, sampleIndex) => {
    sample.processes.forEach((process, processIndex) => {
      const key = processKey(process)
      const prior = known.get(key)
      known.set(key, {
        sampleIndex: prior?.sampleIndex ?? sampleIndex,
        processIndex: prior?.processIndex ?? processIndex,
        cpu: Math.max(prior?.cpu ?? 0, process.cpuPercent ?? 0),
        memory: Math.max(prior?.memory ?? 0, process.memoryBytes ?? 0)
      })
    })
  })
  const selected = [...known.entries()]
    .sort((a, b) => b[1].cpu - a[1].cpu || b[1].memory - a[1].memory)
    .slice(0, 24)
  const ids = new Map(selected.map(([key]) => [key, randomUUID()]))
  const processRefs: DiagnosticAiReport['processRefs'] = selected.map(([key, ref]) => ({
    id: ids.get(key)!,
    sampleIndex: ref.sampleIndex,
    processIndex: ref.processIndex
  }))
  const buckets = new Map<number, DiagnosticRecording['samples']>()
  for (const sample of recording.samples) {
    const bucket = Math.min(179, Math.floor(sample.t / 5000))
    const samples = buckets.get(bucket) ?? []
    samples.push(sample)
    buckets.set(bucket, samples)
  }
  const windows: PerformanceAiWindow[] = [...buckets.values()].map((samples) => {
    const metrics = Object.fromEntries(
      SYSTEM_METRICS.map((metric) => [
        metric,
        aggregate(samples.map((s) => ({ t: s.t, value: s[metric] })))
      ])
    ) as Pick<PerformanceAiWindow, (typeof SYSTEM_METRICS)[number]>
    return {
      sampleTimesMs: samples.map((s) => s.t),
      ...metrics,
      processes: selected.flatMap(([key]) => {
        const points = samples.flatMap((sample) => {
          const process = sample.processes.find((p) => processKey(p) === key)
          return process ? [{ t: sample.t, process }] : []
        })
        return points.length
          ? [
              {
                id: ids.get(key)!,
                processCpuPercent: aggregate(
                  points.map((p) => ({ t: p.t, value: p.process.cpuPercent }))
                ),
                processMemoryBytes: aggregate(
                  points.map((p) => ({ t: p.t, value: p.process.memoryBytes }))
                )
              }
            ]
          : []
      })
    }
  })
  const request = validatePerformanceAiRequest({
    source: 'performance',
    durationMs: recording.durationMs,
    logicalCores: recording.system.logicalCores,
    totalMemoryBytes: recording.system.totalMemoryBytes,
    sampleCount: recording.samples.length,
    expectedSamples: Math.floor(recording.durationMs / 1000) + 1,
    interrupted: interrupted ? 1 : 0,
    omittedProcessCount: Math.max(0, known.size - selected.length),
    windows
  })
  return { request, processRefs }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid-metadata')
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (
    Object.keys(value).length !== allowed.length ||
    Object.keys(value).some((k) => !allowed.includes(k))
  )
    throw new Error('invalid-metadata')
}
function number(value: unknown, max: number, integer = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw new Error('invalid-metadata')
  return value
}
function times(value: unknown, duration: number): number[] {
  if (!Array.isArray(value) || !value.length || value.length > 901)
    throw new Error('invalid-metadata')
  return value.map((t, i) => {
    const n = number(t, duration, true)
    if (i && n <= value[i - 1]) throw new Error('invalid-metadata')
    return n
  })
}

export function validatePerformanceAiRequest(input: unknown): PerformanceAiRequest {
  const request = record(input)
  keys(request, [
    'source',
    'durationMs',
    'logicalCores',
    'totalMemoryBytes',
    'sampleCount',
    'expectedSamples',
    'interrupted',
    'omittedProcessCount',
    'windows'
  ])
  if (
    request.source !== 'performance' ||
    !Array.isArray(request.windows) ||
    !request.windows.length ||
    request.windows.length > 180
  )
    throw new Error('invalid-metadata')
  const durationMs = number(request.durationMs, 900000, true)
  const logicalCores = number(request.logicalCores, 1024, true)
  const totalMemoryBytes = number(request.totalMemoryBytes, 2 ** 50)
  const sampleCount = number(request.sampleCount, 901, true)
  const expectedSamples = number(request.expectedSamples, 901, true)
  if (
    !logicalCores ||
    !totalMemoryBytes ||
    !sampleCount ||
    expectedSamples !== Math.floor(durationMs / 1000) + 1
  )
    throw new Error('invalid-metadata')
  const interrupted = number(request.interrupted, 1, true) as 0 | 1
  const omittedProcessCount = number(request.omittedProcessCount, 4505, true)
  let previous = -1
  let count = 0
  const processIds = new Set<string>()
  const windows = request.windows.map((value) => {
    const window = record(value)
    keys(window, ['sampleTimesMs', ...SYSTEM_METRICS, 'processes'])
    const sampleTimesMs = times(window.sampleTimesMs, durationMs)
    if (sampleTimesMs[0] <= previous) throw new Error('invalid-metadata')
    previous = sampleTimesMs.at(-1)!
    count += sampleTimesMs.length
    const metric = (inputMetric: unknown, max: number): PerformanceAiMetric | null => {
      if (inputMetric === null) return null
      const m = record(inputMetric)
      keys(m, ['median', 'max', 'sampleTimesMs'])
      const median = number(m.median, max)
      const peak = number(m.max, max)
      const validTimes = times(m.sampleTimesMs, durationMs)
      if (median > peak || validTimes.some((t) => !sampleTimesMs.includes(t)))
        throw new Error('invalid-metadata')
      return { median, max: peak, sampleTimesMs: validTimes }
    }
    const metrics = Object.fromEntries(
      SYSTEM_METRICS.map((key) => [
        key,
        metric(
          window[key],
          key.endsWith('Percent') ? 100 : key === 'memoryUsedBytes' ? totalMemoryBytes : 2 ** 50
        )
      ])
    ) as Pick<PerformanceAiWindow, (typeof SYSTEM_METRICS)[number]>
    if (!Array.isArray(window.processes) || window.processes.length > 24)
      throw new Error('invalid-metadata')
    const seen = new Set<string>()
    const processes = window.processes.map((value) => {
      const p = record(value)
      keys(p, ['id', 'processCpuPercent', 'processMemoryBytes'])
      if (!diagnosticId(p.id) || seen.has(p.id)) throw new Error('invalid-metadata')
      seen.add(p.id)
      processIds.add(p.id)
      return {
        id: p.id,
        processCpuPercent: metric(p.processCpuPercent, 100),
        processMemoryBytes: metric(p.processMemoryBytes, 2 ** 50)
      }
    })
    return { sampleTimesMs, ...metrics, processes }
  })
  if (count !== sampleCount || processIds.size > 24) throw new Error('invalid-metadata')
  return {
    source: 'performance',
    durationMs,
    logicalCores,
    totalMemoryBytes,
    sampleCount,
    expectedSamples,
    interrupted,
    omittedProcessCount,
    windows
  }
}

type AiAnswer = Pick<DiagnosticAiReport, 'summary' | 'findings' | 'limitations'>
export function performanceAiResponseSchema(
  request: PerformanceAiRequest
): Record<string, unknown> {
  const ids = [...new Set(request.windows.flatMap((w) => w.processes.map((p) => p.id)))]
  const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength })
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'findings', 'limitations'],
    properties: {
      summary: text(1500),
      limitations: { type: 'array', maxItems: 6, items: text(500) },
      findings: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'title',
            'confidence',
            'observation',
            'interpretation',
            'nextSteps',
            'evidence'
          ],
          properties: {
            title: text(160),
            confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
            observation: text(1200),
            interpretation: text(1200),
            nextSteps: { type: 'array', minItems: 1, maxItems: 5, items: text(400) },
            evidence: {
              type: 'array',
              minItems: 1,
              maxItems: 5,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['metric', 'startMs', 'endMs', 'processId'],
                properties: {
                  metric: { type: 'string', enum: [...DIAGNOSTIC_METRICS] },
                  startMs: { type: 'integer', minimum: 0, maximum: request.durationMs },
                  endMs: { type: 'integer', minimum: 0, maximum: request.durationMs },
                  processId: { type: ['string', 'null'], enum: [null, ...ids] }
                }
              }
            }
          }
        }
      }
    }
  }
}

export function parsePerformanceAiResult(text: string, request: PerformanceAiRequest): AiAnswer {
  try {
    if (text.length > 100000) throw new Error('invalid-response')
    const value = record(JSON.parse(text))
    keys(value, ['summary', 'findings', 'limitations'])
    if (
      !validDiagnosticReport(
        {
          ...value,
          version: 1,
          source: 'local',
          analyzerVersion: 'validation',
          generatedAt: 'validation'
        },
        request.durationMs
      ) ||
      (value.limitations as unknown[]).length > 6
    )
      throw new Error('invalid-response')
    const answer = value as unknown as AiAnswer
    for (const finding of answer.findings) {
      keys(record(finding), [
        'title',
        'confidence',
        'observation',
        'interpretation',
        'nextSteps',
        'evidence'
      ])
      for (const evidence of finding.evidence) {
        keys(record(evidence), ['metric', 'startMs', 'endMs', 'processId'])
        const validTimes = request.windows.flatMap((window) => {
          const metric = evidence.metric.startsWith('process')
            ? window.processes.find((p) => p.id === evidence.processId)?.[
                evidence.metric as 'processCpuPercent' | 'processMemoryBytes'
              ]
            : evidence.processId === null
              ? window[evidence.metric as (typeof SYSTEM_METRICS)[number]]
              : null
          return metric?.sampleTimesMs ?? []
        })
        if (!validTimes.includes(evidence.startMs) || !validTimes.includes(evidence.endMs))
          throw new Error('invalid-response')
      }
    }
    return answer
  } catch {
    throw new Error('invalid-response')
  }
}

export function performanceAiInstructions(italian: boolean): string {
  return [
    'Analyze a recorded performance timeline using only numeric, pseudonymous aggregates. No tools or actions are available.',
    'Each up-to-five-second window reports median and max, not raw values. sampleTimesMs are the actual relative offsets of non-null observations; never interpolate missing data or treat null as zero.',
    'Correlate CPU, memory, I/O, recovery after peaks and sustained load. Process IDs are opaque and only recorded top processes are represented; absence does not imply zero activity.',
    'Separate measured observations from possible explanations. Rank findings and next manual checks by usefulness. State uncertainty; correlation does not establish causation.',
    'Do not claim disk saturation, failing hardware or a memory leak from throughput or one short timeline. Do not invent application names, filenames, paths, commands, host details or unmeasured metrics.',
    'Evidence endpoints must be actual sampleTimesMs of the cited metric and process, with processId null for system metrics. Never invent an ID. Findings require supporting evidence.',
    'Explain gaps, missing counters, omitted processes, short duration and interrupted=1 as limitations. A recording shorter than 30 seconds or with less than 80% coverage cannot support high-confidence overall conclusions.',
    'When mentioning a process in prose, use its complete opaque UUID exactly so the local UI can resolve it. IDs may group indistinguishable process instances when a start time was unavailable.',
    'Return only JSON matching the schema. At most six limitations. Offer manual checks, never destructive or automatic actions.',
    italian ? 'Write all prose in Italian.' : 'Write all prose in English.'
  ].join(' ')
}
