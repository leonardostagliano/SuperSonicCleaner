import { describe, expect, it } from 'vitest'
import type { DiagnosticAiReport, DiagnosticRecording } from '@shared/performance-diagnostics'
import { resolveAiProcessReferences } from './resolve-ai-process-references'

describe('local AI process references', () => {
  it('resolves known full IDs once and leaves unknown IDs intact', () => {
    const known = '00000000-0000-4000-8000-000000000001'
    const second = '00000000-0000-4000-8000-000000000002'
    const unknown = '00000000-0000-4000-8000-000000000003'
    const recording = {
      samples: [{ processes: [{ name: `Editor ${second}` }, { name: 'Browser' }] }]
    } as DiagnosticRecording
    const report = {
      source: 'codex',
      processRefs: [
        { id: known, sampleIndex: 0, processIndex: 0 },
        { id: second, sampleIndex: 0, processIndex: 1 }
      ]
    } as DiagnosticAiReport
    expect(
      resolveAiProcessReferences(`${known} then ${second} then ${unknown}`, report, recording)
    ).toBe(`Editor ${second} then Browser then ${unknown}`)
  })
})
