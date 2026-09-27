import { describe, expect, it } from 'vitest'
import { analyzeDiagnosticRecording } from './local-diagnostic-analysis'
import { validDiagnosticReport, type DiagnosticRecording } from './performance-diagnostics'

function recording(): DiagnosticRecording {
  return {
    version: 1,
    recordId: '00000000-0000-4000-8000-000000000002',
    startedAt: '2026-09-26T10:00:00.000Z',
    durationMs: 60000,
    system: {
      platform: 'win32',
      cpuModel: 'Synthetic CPU',
      logicalCores: 8,
      totalMemoryBytes: 4096,
      osVersion: 'Test'
    },
    samples: Array.from({ length: 61 }, (_, i) => ({
      t: i * 1000,
      cpuPercent: 40,
      memoryPercent: 25,
      memoryUsedBytes: 1024,
      diskReadBytesPerSec: i % 5 === 1 ? 1024 ** 2 : null,
      diskWriteBytesPerSec: i % 5 === 1 ? 0 : null,
      processes: []
    }))
  }
}

describe('local diagnostic analysis', () => {
  it('documents sustained threshold loads with bounded evidence intervals', () => {
    const data = recording()
    for (const sample of data.samples) {
      sample.cpuPercent = sample.t <= 30000 ? 85 : 40
      sample.memoryPercent = 90
    }
    const report = analyzeDiagnosticRecording(data, 'en')
    expect(report.findings[0].title).toBe('CPU: sustained high usage')
    expect(report.findings[0].evidence).toEqual([
      { metric: 'cpuPercent', startMs: 0, endMs: 30000 }
    ])
    expect(report.findings[1].title).toBe('Memory: sustained high usage')
    expect(report.findings[1].evidence[0]).toMatchObject({ startMs: 0, endMs: 60000 })
    expect(validDiagnosticReport(report, data.durationMs)).toBe(true)
  })

  it('distinguishes peaks and values just below the sustained threshold', () => {
    const data = recording()
    data.samples.forEach((sample) => {
      sample.cpuPercent = 84.9
    })
    data.samples[17].cpuPercent = 95
    const report = analyzeDiagnosticRecording(data, 'en')
    expect(report.findings[0].title).toBe('CPU: observed peak')
    expect(report.findings[0].evidence).toEqual([
      { metric: 'cpuPercent', startMs: 17000, endMs: 17000 }
    ])
    expect(report.summary).toContain('No sustained high-usage intervals')
  })

  it('breaks sustained runs at missing values and long gaps instead of interpolating', () => {
    const data = recording()
    data.samples.forEach((sample) => {
      sample.cpuPercent = 99
    })
    data.samples[30].cpuPercent = null
    expect(analyzeDiagnosticRecording(data, 'en').findings[0].title).toBe('CPU: observed peak')
    data.samples = data.samples.filter((sample) => sample.t !== 30000)
    expect(analyzeDiagnosticRecording(data, 'en').findings[0].title).toBe('CPU: observed peak')
  })

  it('does not mistake clustered samples for full coverage or average missing values as zero', () => {
    const data = recording()
    data.samples.forEach((sample, i) => {
      sample.t = i
      sample.cpuPercent = 99
    })
    const report = analyzeDiagnosticRecording(data, 'en')
    expect(report.summary).toContain('insufficient data')
    expect(report.findings[0].observation).toContain('mean 99%')
    expect(report.findings[0].observation).toContain('coverage 0.9%')
    expect(report.findings[0].confidence).toBe('low')
  })

  it('reports missing measurements and short recordings honestly', () => {
    const data = recording()
    data.durationMs = 1000
    data.samples = data.samples.slice(0, 2).map((sample) => ({
      ...sample,
      cpuPercent: null,
      memoryPercent: null,
      memoryUsedBytes: null,
      diskReadBytesPerSec: null,
      diskWriteBytesPerSec: null
    }))
    const report = analyzeDiagnosticRecording(data, 'en')
    expect(report.summary).toContain('insufficient data')
    expect(report.findings).toEqual([])
    expect(report.limitations.join(' ')).toContain('CPU 0%, memory 0%')
    expect(report.limitations.join(' ')).toContain('No disk measurements')
    expect(validDiagnosticReport(report, data.durationMs)).toBe(true)
  })

  it('describes disk throughput without diagnosing saturation or missing counters as healthy zeros', () => {
    const data = recording()
    data.samples.forEach((sample) => {
      sample.diskReadBytesPerSec = sample.t === 1000 ? 900 * 1024 ** 2 : null
      sample.diskWriteBytesPerSec = null
    })
    const finding = analyzeDiagnosticRecording(data, 'en').findings[2]
    expect(finding.observation).toContain('mean 900 MiB/s')
    expect(finding.observation).toContain('(1 valid measurements)')
    expect(finding.observation).not.toContain('Write:')
    expect(finding.interpretation).toContain('does not indicate disk saturation')
    expect(finding.confidence).toBe('low')
  })

  it('produces localized reports without copying process names or mutating the recording', () => {
    const data = recording()
    data.samples[0].processes.push({
      pid: 123,
      name: 'private-process.exe',
      startedAt: null,
      cpuPercent: 90,
      memoryBytes: 128
    })
    const original = structuredClone(data)
    const report = analyzeDiagnosticRecording(data, 'it', true)
    expect(report).toMatchObject({ source: 'local', language: 'it' })
    expect(report.summary).toContain('Analizzati localmente')
    expect(report.limitations.join(' ')).toContain('Registrazione interrotta')
    expect(JSON.stringify(report)).not.toContain('private-process')
    expect(data).toEqual(original)
    expect(validDiagnosticReport(report, data.durationMs)).toBe(true)
    data.samples[0].cpuPercent = Number.NaN
    expect(() => analyzeDiagnosticRecording(data, 'en')).toThrow('Invalid diagnostic recording')
  })
})
