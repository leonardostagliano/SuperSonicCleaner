import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { DiagnosticRecording } from '../../shared/performance-diagnostics'
import { validDiagnosticAiReport } from '../../shared/performance-diagnostics'
import {
  parsePerformanceAiResult,
  performanceAiResponseSchema,
  preparePerformanceAi,
  validatePerformanceAiRequest
} from './performance-ai-policy'
import { metadataInferenceBody, validateMetadataSse } from './metadata-inference-proxy'

function recording(): DiagnosticRecording {
  return {
    version: 1,
    recordId: randomUUID(),
    startedAt: '2026-01-01T10:00:00Z',
    durationMs: 6000,
    system: {
      platform: 'win32',
      cpuModel: 'SECRET_CPU_MODEL',
      logicalCores: 4,
      totalMemoryBytes: 4096,
      osVersion: 'SECRET_OS_VERSION'
    },
    samples: [0, 1000, 6000].map((t, i) => ({
      t,
      cpuPercent: [0, 90, 30][i],
      memoryPercent: 25,
      memoryUsedBytes: 1024,
      diskReadBytesPerSec: null,
      diskWriteBytesPerSec: null,
      processes: [
        {
          pid: 7654321,
          name: 'SECRET_PROCESS.exe',
          startedAt: '2026-01-01T09:00:00Z',
          cpuPercent: 25,
          memoryBytes: 256
        }
      ]
    }))
  }
}
function answer() {
  return {
    summary: 'Synthetic observation',
    findings: [
      {
        title: 'CPU peak',
        confidence: 'low',
        observation: 'A peak was recorded.',
        interpretation: 'The cause is not established.',
        nextSteps: ['Compare a longer recording.'],
        evidence: [
          { metric: 'cpuPercent', startMs: 0, endMs: 1000, processId: null as string | null }
        ]
      }
    ],
    limitations: ['Short recording with gaps.']
  }
}
describe('performance inference privacy and grounding', () => {
  it('creates fresh opaque IDs and transmits only numerical aggregates, never local identities', () => {
    const source = recording()
    const prepared = preparePerformanceAi(source, false)
    const body = metadataInferenceBody(prepared.request, 'test-model', true) as Record<
      string,
      unknown
    >
    const serialized = JSON.stringify(body)
    for (const secret of [
      'SECRET_',
      source.recordId,
      source.startedAt,
      '7654321',
      'processRefs',
      'sampleIndex',
      'processIndex'
    ])
      expect(serialized).not.toContain(secret)
    expect(body).toMatchObject({
      tools: [],
      tool_choice: 'none',
      parallel_tool_calls: false,
      store: false
    })
    expect(prepared.processRefs).toEqual([
      { id: prepared.request.windows[0].processes[0].id, sampleIndex: 0, processIndex: 0 }
    ])
    expect(preparePerformanceAi(source, false).processRefs[0].id).not.toBe(
      prepared.processRefs[0].id
    )
    const schema = performanceAiResponseSchema(prepared.request) as any
    expect(schema.properties.findings.items.properties.evidence.items.properties.processId).toEqual(
      {
        type: ['string', 'null'],
        enum: [null, prepared.processRefs[0].id]
      }
    )
  })

  it('preserves real zeros, missing measurements and observation gaps', () => {
    const source = recording()
    source.samples[1].memoryPercent = null
    const { request } = preparePerformanceAi(source, true)
    expect(request).toMatchObject({ sampleCount: 3, expectedSamples: 7, interrupted: 1 })
    expect(request.windows).toHaveLength(2)
    expect(request.windows[0]).toMatchObject({
      sampleTimesMs: [0, 1000],
      cpuPercent: { median: 45, max: 90, sampleTimesMs: [0, 1000] },
      memoryPercent: { median: 25, max: 25, sampleTimesMs: [0] },
      diskReadBytesPerSec: null
    })
    expect(request.windows[1].sampleTimesMs).toEqual([6000])
  })

  it('bounds full-length recordings and process identities while retaining local pointers', () => {
    const source = recording()
    source.durationMs = 900000
    source.samples = Array.from({ length: 901 }, (_, i) => ({
      ...source.samples[0],
      t: i * 1000,
      processes: [{ ...source.samples[0].processes[0], pid: i + 1, name: 'Private-' + i }]
    }))
    const prepared = preparePerformanceAi(source, false)
    expect(prepared.request.windows).toHaveLength(180)
    expect(prepared.processRefs).toHaveLength(24)
    expect(prepared.request.omittedProcessCount).toBe(877)
    expect(prepared.request.windows.at(-1)?.sampleTimesMs.at(-1)).toBe(900000)
    expect(JSON.stringify(prepared.request)).not.toContain('Private-')
  })

  it('rejects arbitrary fields, impossible counters and injected metric names', () => {
    const { request } = preparePerformanceAi(recording(), false)
    expect(() => validatePerformanceAiRequest({ ...request, title: 'private' })).toThrow(
      'invalid-metadata'
    )
    const changed = structuredClone(request)
    Object.assign(changed.windows[0], { path: 'private' })
    expect(() => validatePerformanceAiRequest(changed)).toThrow('invalid-metadata')
    const impossible = structuredClone(request)
    impossible.windows[0].memoryUsedBytes!.max = request.totalMemoryBytes + 1
    expect(() => validatePerformanceAiRequest(impossible)).toThrow('invalid-metadata')
    const badCounter = structuredClone(request)
    badCounter.windows[0].cpuPercent!.median = NaN
    expect(() => validatePerformanceAiRequest(badCounter)).toThrow('invalid-metadata')
  })

  it('accepts evidence only at supplied observations of an available metric and known process', () => {
    const { request } = preparePerformanceAi(recording(), false)
    expect(parsePerformanceAiResult(JSON.stringify(answer()), request)).toEqual(answer())
    const unknownTime = answer()
    unknownTime.findings[0].evidence[0].endMs = 3000
    expect(() => parsePerformanceAiResult(JSON.stringify(unknownTime), request)).toThrow(
      'invalid-response'
    )
    const missing = answer()
    missing.findings[0].evidence[0].metric = 'diskReadBytesPerSec'
    expect(() => parsePerformanceAiResult(JSON.stringify(missing), request)).toThrow(
      'invalid-response'
    )
    const process = answer()
    process.findings[0].evidence[0].metric = 'processCpuPercent'
    process.findings[0].evidence[0].processId = randomUUID()
    expect(() => parsePerformanceAiResult(JSON.stringify(process), request)).toThrow(
      'invalid-response'
    )
    process.findings[0].evidence[0].processId = request.windows[0].processes[0].id
    expect(parsePerformanceAiResult(JSON.stringify(process), request)).toEqual(process)
    process.findings[0].evidence[0].startMs = 6000
    expect(() => parsePerformanceAiResult(JSON.stringify(process), request)).toThrow(
      'invalid-response'
    )
  })

  it('retains the complete-stream no-tools boundary for performance responses', () => {
    const { request } = preparePerformanceAi(recording(), false)
    const response = {
      type: 'response.completed',
      response: {
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: JSON.stringify(answer()) }]
          }
        ]
      }
    }
    const sse = 'data: ' + JSON.stringify(response) + '\n\n'
    expect(validateMetadataSse(sse, request)).toBe(JSON.stringify(answer()))
    const unsafe =
      'data: ' +
      JSON.stringify({
        type: 'response.output_item.done',
        item: { type: 'function_call', name: 'shell' }
      }) +
      '\n\n'
    expect(() => validateMetadataSse(unsafe + sse, request)).toThrow('tools-blocked')
  })

  it('validates local process pointers on report reload', () => {
    const source = recording()
    const prepared = preparePerformanceAi(source, false)
    const report = {
      ...answer(),
      version: 1,
      source: 'codex',
      language: 'en',
      analyzerVersion: 'test',
      generatedAt: new Date().toISOString(),
      processRefs: prepared.processRefs
    }
    expect(validDiagnosticAiReport(report, source)).toBe(true)
    report.processRefs[0].sampleIndex = 999
    expect(validDiagnosticAiReport(report, source)).toBe(false)
  })
})
