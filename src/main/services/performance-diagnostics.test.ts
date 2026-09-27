import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'crypto'
import { DiagnosticsStore } from './diagnostics-store'
import {
  DiagnosticsRecorder,
  diagnosticCpu,
  diagnosticProcesses,
  measurement
} from './diagnostics-recorder'
import { PerformanceDiagnostics } from './performance-diagnostics'
import {
  diagnosticStats,
  validDiagnosticRecording,
  validDiagnosticReport
} from '../../shared/performance-diagnostics'
import type { DiagnosticSession } from '../../shared/performance-diagnostics'

vi.mock('systeminformation', () => ({
  fsStats: vi.fn(async () => ({ rx_sec: -1, wx_sec: -1 })),
  processes: vi.fn(async () => ({ list: [] })),
  mem: vi.fn(async () => ({ total: 4096, available: 3072, active: 1024 }))
}))

function session(): DiagnosticSession {
  const sample = {
    t: 0,
    cpuPercent: 50,
    memoryPercent: 25,
    memoryUsedBytes: 1024,
    diskReadBytesPerSec: null,
    diskWriteBytesPerSec: null,
    processes: [
      { pid: 123, name: 'private-app.exe', startedAt: null, cpuPercent: 30, memoryBytes: 512 }
    ]
  }
  return {
    recording: {
      version: 1,
      recordId: randomUUID(),
      startedAt: '2026-09-13T10:00:00.000Z',
      durationMs: 1000,
      system: {
        platform: 'win32',
        cpuModel: 'Test CPU',
        logicalCores: 8,
        totalMemoryBytes: 4096,
        osVersion: '10.0'
      },
      samples: [sample, { ...sample, t: 1000 }]
    },
    title: 'Test',
    notes: 'private note',
    pinned: false,
    state: 'saved',
    report: null
  }
}
let dir: string
let store: DiagnosticsStore
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kudu-diagnostics-test-'))
  const key = randomBytes(32)
  store = new DiagnosticsStore(
    dir,
    (value) => {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()])
    },
    (value) => {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      decipher.setAuthTag(value.subarray(-16))
      return Buffer.concat([decipher.update(value.subarray(12, -16)), decipher.final()]).toString()
    }
  )
})
afterEach(async () => {
  vi.useRealTimers()
  await rm(dir, { recursive: true, force: true })
})

describe('recording privacy and persistence', () => {
  it('preserves legacy recordings without exposing retired account metadata', async () => {
    const s = session()
    const report = {
      version: 1,
      analyzerVersion: 'legacy',
      generatedAt: new Date().toISOString(),
      summary: 'Existing report',
      findings: [],
      limitations: []
    }
    Object.assign(s, {
      report: undefined,
      cloud: { report },
      upload: { account: 'private-account', digest: 'private-digest' }
    })
    await store.save(s, true)
    const file = join(dir, s.recording.recordId + '.record')
    const original = await readFile(file)
    const service = new PerformanceDiagnostics(store)
    const restored = await service.get(s.recording.recordId)
    expect(restored.report).toEqual(report)
    expect(restored).not.toHaveProperty('cloud')
    expect(restored).not.toHaveProperty('upload')
    expect(await readFile(file)).toEqual(original)
    await service.remove(s.recording.recordId)
    expect(await store.list()).toHaveLength(0)
  })
  it('round trips encrypted sessions and rejects tampering and path IDs', async () => {
    const s = session()
    await store.save(s, true)
    expect((await readFile(join(dir, `${s.recording.recordId}.record`))).toString()).not.toContain(
      'private-app'
    )
    expect(await store.get(s.recording.recordId)).toEqual(s)
    await expect(store.get('../outside')).rejects.toThrow('Invalid recording ID')
    await writeFile(join(dir, `${s.recording.recordId}.record`), 'corrupt')
    await expect(store.get(s.recording.recordId)).rejects.toThrow()
  })
  it('serializes capacity checks and protects pinned records and deleted IDs', async () => {
    const sessions = Array.from({ length: 31 }, session)
    const results = await Promise.allSettled(sessions.map((s) => store.save(s, true)))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(30)
    const s = sessions[0]
    s.pinned = true
    await store.save(s)
    await expect(store.remove(s.recording.recordId)).rejects.toThrow('Unpin')
    s.pinned = false
    await store.save(s)
    await store.remove(s.recording.recordId)
    await expect(store.save(s)).rejects.toThrow()
    expect(await store.list()).toHaveLength(29)
  })
  it('skips unreadable files without disabling the feature and allows removing them', async () => {
    const s = session()
    await store.save(s, true)
    const corrupt = randomUUID()
    await writeFile(join(dir, `${corrupt}.record`), 'corrupt')
    const service = new PerformanceDiagnostics(store)
    expect((await service.status()).rows.map((r) => r.id)).toEqual([s.recording.recordId])
    await store.remove(corrupt)
    await expect(store.remove(corrupt)).rejects.toThrow()
  })
  it('reopens a checkpoint as interrupted after restart', async () => {
    const s = session()
    s.state = 'recording'
    await store.save(s, true)
    const service = new PerformanceDiagnostics(store)
    await service.ready()
    expect((await service.get(s.recording.recordId)).state).toBe('interrupted')
    expect((await service.get(s.recording.recordId)).recording.samples).toHaveLength(2)
  })
})

describe('measurement semantics', () => {
  it('does not turn unsupported counters or counter resets into healthy zeros', () => {
    expect(measurement(-1)).toBeNull()
    expect(measurement(NaN)).toBeNull()
    expect(measurement(0)).toBe(0)
    expect(diagnosticCpu({ idle: 100, total: 200 }, { idle: 90, total: 250 })).toBeNull()
    expect(diagnosticCpu({ idle: 100, total: 200 }, { idle: 125, total: 300 })).toBe(75)
    const s = session()
    s.recording.samples[0].cpuPercent = null
    expect(diagnosticStats(s.recording).cpuMean).toBe(50)
    s.recording.durationMs = 5000
    expect(diagnosticStats(s.recording).missingTicks).toBe(4)
  })
  it('strips paths and preserves start time to distinguish reused process IDs', () => {
    const list = diagnosticProcesses([
      {
        pid: 10,
        name: 'C:\\Users\\private\\app.exe',
        cpu: 40,
        memRss: 512,
        started: '2026-09-13T10:00:00Z'
      },
      { pid: 10, name: '/home/private/app', cpu: -1, memRss: 256, started: '2026-09-13T10:01:00Z' }
    ])
    expect(list[0].name).toBe('app.exe')
    expect(list[1].name).toBe('app')
    expect(list[0].startedAt).not.toBe(list[1].startedAt)
    expect(list[1].cpuPercent).toBeNull()
    // systeminformation reports memRss in KiB; the payload is labelled in bytes.
    expect(list[0].memoryBytes).toBe(512 * 1024)
  })
  it('rejects unordered or unbounded recordings and malformed report evidence', () => {
    const s = session()
    s.recording.samples[1].t = 0
    expect(validDiagnosticRecording(s.recording)).toBe(false)
    expect(
      validDiagnosticReport(
        {
          version: 1,
          analyzerVersion: 'v1',
          generatedAt: new Date().toISOString(),
          summary: 'x',
          limitations: [],
          findings: [
            {
              title: 'x',
              confidence: 'high',
              observation: 'x',
              interpretation: 'x',
              nextSteps: ['x'],
              evidence: [{ metric: 'cpuPercent', startMs: 1000, endMs: 0 }]
            }
          ]
        },
        1000
      )
    ).toBe(false)
  })
})

describe('local recording lifecycle', () => {
  it('rejects analysis while a recording is active and reports an interrupted checkpoint honestly', async () => {
    const s = session()
    await store.save(s, true)
    const service = new PerformanceDiagnostics(store)
    await service.ready()
    service.recorder.active = { ...s, state: 'recording' }
    await expect(service.analyze(s.recording.recordId, 'en')).rejects.toThrow('Stop the recording')
    expect((await store.get(s.recording.recordId)).report).toBeNull()
    service.recorder.active = null
    await store.save({ ...s, state: 'interrupted' })
    const report = await service.analyze(s.recording.recordId, 'en')
    expect(report.limitations.join(' ')).toContain('Interrupted recording')
    expect((await store.get(s.recording.recordId)).report).toEqual(report)
  })

  it('records independently, stops coherently, and does not collect processes by default', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance', 'Date'] })
    const r = new DiagnosticsRecorder(store)
    const id = await r.start(120, false)
    await vi.advanceTimersByTimeAsync(2500)
    await r.stop()
    const s = await store.get(id)
    expect(s.state).toBe('saved')
    expect(s.recording.samples.length).toBeGreaterThanOrEqual(2)
    expect(s.recording.samples.every((x) => x.processes.length === 0)).toBe(true)
    expect(validDiagnosticRecording(s.recording)).toBe(true)
    const count = s.recording.samples.length
    await vi.advanceTimersByTimeAsync(5000)
    expect((await store.get(id)).recording.samples).toHaveLength(count)
  })
})
