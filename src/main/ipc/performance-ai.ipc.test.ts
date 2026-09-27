import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../shared/channels'
import type { DiagnosticSession, DiagnosticAiReport } from '../../shared/performance-diagnostics'
import type { PerformanceAiRequest } from '../../shared/performance-ai'

const mocks = vi.hoisted(() => ({
  dir: '',
  handlers: new Map<string, (...args: any[]) => any>(),
  analyze: vi.fn(),
  seal: vi.fn(),
  open: vi.fn(),
  saveDialog: vi.fn(),
  quit: undefined as (() => void) | undefined
}))
vi.mock('electron', () => ({
  app: {
    getPath: () => mocks.dir,
    once: (_event: string, cb: () => void) => {
      mocks.quit = cb
    }
  },
  ipcMain: {
    handle: (channel: string, cb: (...args: any[]) => any) => mocks.handlers.set(channel, cb)
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (value: string) => mocks.seal(value),
    decryptString: (value: Buffer) => mocks.open(value)
  },
  dialog: { showSaveDialog: () => mocks.saveDialog() }
}))
vi.mock('systeminformation', () => ({ fsStats: vi.fn(), processes: vi.fn(), mem: vi.fn() }))
vi.mock('../services/codex-connection', async (original) => ({
  ...(await original<typeof import('../services/codex-connection')>()),
  analyzePerformanceWithCodex: mocks.analyze
}))
import { registerPerformanceDiagnosticsIpc } from './performance-diagnostics.ipc'
import { DiagnosticsStore } from '../services/diagnostics-store'
import { PerformanceDiagnostics } from '../services/performance-diagnostics'

let session: DiagnosticSession
let store: DiagnosticsStore
let sender: EventEmitter & { mainFrame: object }
let window: EventEmitter & { webContents: typeof sender; isDestroyed: () => boolean }
const event = () => ({ sender, senderFrame: sender.mainFrame })
const call = (action: string, id = session.recording.recordId, value?: unknown) =>
  mocks.handlers.get(IPC.DIAGNOSTICS)!({}, action, id, value)
const analyze = () =>
  mocks.handlers.get(IPC.DIAGNOSTICS_AI_ANALYZE)!(
    event(),
    session.recording.recordId,
    'en'
  ) as Promise<DiagnosticAiReport>
const cancel = () => mocks.handlers.get(IPC.DIAGNOSTICS_AI_CANCEL)!(event())
const reconnect = () => registerPerformanceDiagnosticsIpc(() => window as never)
const reply = (request: PerformanceAiRequest) =>
  JSON.stringify({
    summary: 'Synthetic AI finding',
    findings: [
      {
        title: 'Observed CPU activity',
        confidence: 'low',
        observation: 'Numeric samples show CPU activity.',
        interpretation: 'Possible workload; the cause is unknown.',
        nextSteps: ['Compare a longer recording.'],
        evidence: [
          {
            metric: 'processCpuPercent',
            startMs: 0,
            endMs: 1000,
            processId: request.windows[0].processes[0].id
          }
        ]
      }
    ],
    limitations: ['Synthetic short recording.']
  })

beforeEach(async () => {
  mocks.dir = await mkdtemp(join(tmpdir(), 'supersonic-performance-ai-'))
  mocks.handlers.clear()
  mocks.analyze.mockReset()
  const key = randomBytes(32)
  mocks.seal.mockImplementation((text: string) => {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()])
  })
  mocks.open.mockImplementation((buffer: Buffer) => {
    const cipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12))
    cipher.setAuthTag(buffer.subarray(-16))
    return Buffer.concat([cipher.update(buffer.subarray(12, -16)), cipher.final()]).toString()
  })
  store = new DiagnosticsStore(join(mocks.dir, 'performance-diagnostics'), mocks.seal, mocks.open)
  sender = Object.assign(new EventEmitter(), { mainFrame: {} })
  window = Object.assign(new EventEmitter(), { webContents: sender, isDestroyed: () => false })
  session = {
    title: 'PRIVATE_TITLE',
    notes: 'PRIVATE_NOTES',
    pinned: false,
    state: 'saved',
    report: null,
    recording: {
      version: 1,
      recordId: randomUUID(),
      startedAt: '2026-01-01T10:00:00Z',
      durationMs: 1000,
      system: {
        platform: 'win32',
        cpuModel: 'PRIVATE_CPU',
        osVersion: 'PRIVATE_OS',
        logicalCores: 4,
        totalMemoryBytes: 4096
      },
      samples: [0, 1000].map((t) => ({
        t,
        cpuPercent: 75,
        memoryPercent: 25,
        memoryUsedBytes: 1024,
        diskReadBytesPerSec: null,
        diskWriteBytesPerSec: null,
        processes: [
          {
            pid: 9876543,
            name: 'PRIVATE_PROCESS.exe',
            startedAt: null,
            cpuPercent: 50,
            memoryBytes: 512
          }
        ]
      }))
    }
  }
  await store.save(session, true)
  reconnect()
})
afterEach(async () => {
  expect(dirname(resolve(mocks.dir))).toBe(resolve(tmpdir()))
  await rm(mocks.dir, { recursive: true, force: true })
})

describe('performance AI IPC and persistence', () => {
  it('keeps local and AI reports separately, encrypts/reopens/exports AI, and preserves concurrent detail edits', async () => {
    const local = await call('analyze', undefined, 'en')
    let finish!: () => void
    mocks.analyze.mockImplementation(
      (request: PerformanceAiRequest) =>
        new Promise<string>((resolve) => {
          finish = () => resolve(reply(request))
        })
    )
    const pending = analyze()
    await vi.waitFor(() => expect(mocks.analyze).toHaveBeenCalledOnce())
    expect(JSON.stringify(mocks.analyze.mock.calls[0][0])).not.toContain('PRIVATE_')
    expect(JSON.stringify(mocks.analyze.mock.calls[0][0])).not.toContain('9876543')
    await call('edit', undefined, {
      title: 'Edited during analysis',
      notes: 'Keep these notes',
      pinned: true
    })
    finish()
    const report = await pending
    expect(report).toMatchObject({ source: 'codex', language: 'en' })
    reconnect()
    const restored = await call('get')
    expect(restored).toMatchObject({
      title: 'Edited during analysis',
      notes: 'Keep these notes',
      pinned: true,
      report: local,
      aiReport: report
    })
    expect(report.processRefs).toEqual([
      { id: report.findings[0].evidence[0].processId, sampleIndex: 0, processIndex: 0 }
    ])
    const raw = await readFile(
      join(mocks.dir, 'performance-diagnostics', session.recording.recordId + '.record')
    )
    expect(raw.toString()).not.toContain('Synthetic AI finding')
    const filePath = join(mocks.dir, 'synthetic-export.json')
    mocks.saveDialog.mockResolvedValue({ canceled: false, filePath })
    await call('export')
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({
      report: local,
      aiReport: report
    })
  })

  it('rejects parallel runs and discards a late response after cancellation', async () => {
    let finish!: () => void
    mocks.analyze.mockImplementation(
      (request: PerformanceAiRequest) =>
        new Promise<string>((resolve) => {
          finish = () => resolve(reply(request))
        })
    )
    const pending = analyze()
    await vi.waitFor(() => expect(mocks.analyze).toHaveBeenCalledOnce())
    await expect(analyze()).rejects.toThrow('busy')
    await cancel()
    expect(mocks.analyze.mock.calls[0][1].signal.aborted).toBe(true)
    finish()
    await expect(pending).rejects.toThrow('cancelled')
    expect((await call('get')).aiReport).toBeUndefined()
    expect(sender.listenerCount('destroyed')).toBe(0)
  })

  it('honors cancellation after inference while staging the encrypted report', async () => {
    mocks.analyze.mockImplementation((request: PerformanceAiRequest) => reply(request))
    const encrypt = mocks.seal.getMockImplementation()!
    mocks.seal.mockImplementationOnce((text: string) => {
      queueMicrotask(() => void cancel())
      return encrypt(text)
    })
    await expect(analyze()).rejects.toThrow('cancelled')
    expect((await call('get')).aiReport).toBeUndefined()
  })

  it('does not resurrect a recording deleted during inference', async () => {
    let finish!: () => void
    mocks.analyze.mockImplementation(
      (request: PerformanceAiRequest) =>
        new Promise<string>((resolve) => {
          finish = () => resolve(reply(request))
        })
    )
    const pending = analyze()
    await vi.waitFor(() => expect(mocks.analyze).toHaveBeenCalledOnce())
    await call('remove')
    finish()
    await expect(pending).rejects.toThrow('analysis-failed')
    await expect(call('get')).rejects.toThrow()
    expect((await call('status')).rows).toEqual([])
  })

  it('permits same-document navigation but cancels on renderer loss', async () => {
    let finish!: () => void
    mocks.analyze.mockImplementation(
      (request: PerformanceAiRequest) =>
        new Promise<string>((resolve) => {
          finish = () => resolve(reply(request))
        })
    )
    const pending = analyze()
    await vi.waitFor(() => expect(mocks.analyze).toHaveBeenCalledOnce())
    const signal = mocks.analyze.mock.calls[0][1].signal as AbortSignal
    sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    expect(signal.aborted).toBe(false)
    sender.emit('render-process-gone')
    expect(signal.aborted).toBe(true)
    finish()
    await expect(pending).rejects.toThrow('cancelled')
    expect((await call('get')).aiReport).toBeUndefined()
  })

  it('rejects other windows, subframes, invalid arguments and active recordings before inference', async () => {
    const handler = mocks.handlers.get(IPC.DIAGNOSTICS_AI_ANALYZE)!
    await expect(
      handler({ ...event(), sender: {} }, session.recording.recordId, 'en')
    ).rejects.toThrow('unauthorized')
    await expect(
      handler({ ...event(), senderFrame: {} }, session.recording.recordId, 'en')
    ).rejects.toThrow('unauthorized')
    await expect(handler(event(), '../private', 'en')).rejects.toThrow('invalid-metadata')
    await expect(handler(event(), session.recording.recordId, 'invalid')).rejects.toThrow(
      'invalid-metadata'
    )
    const service = new PerformanceDiagnostics(store)
    service.recorder.active = { ...session, state: 'recording' }
    await expect(
      service.analyzeAi(session.recording.recordId, 'en', new AbortController().signal)
    ).rejects.toThrow('invalid-metadata')
    expect(mocks.analyze).not.toHaveBeenCalled()
  })

  it('sanitizes unexpected provider errors and keeps the earlier report on invalid evidence', async () => {
    const local = await call('analyze', undefined, 'en')
    mocks.analyze.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_DIAGNOSTICS'))
    await expect(analyze()).rejects.toThrow(/^analysis-failed$/)
    mocks.analyze.mockImplementation((request: PerformanceAiRequest) => {
      const value = JSON.parse(reply(request))
      value.findings[0].evidence[0].endMs = 999
      return JSON.stringify(value)
    })
    await expect(analyze()).rejects.toThrow('invalid-response')
    expect(await call('get')).toMatchObject({ report: local })
    expect((await call('get')).aiReport).toBeUndefined()
  })
})
