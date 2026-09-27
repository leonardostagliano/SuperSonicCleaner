import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { IPC } from '../../shared/channels'
import { DiagnosticsStore } from '../services/diagnostics-store'
import { registerPerformanceDiagnosticsIpc } from './performance-diagnostics.ipc'
import type { DiagnosticSession } from '../../shared/performance-diagnostics'

const mocks = vi.hoisted(() => ({
  dir: '',
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  seal: vi.fn(),
  open: vi.fn(),
  dialog: vi.fn()
}))
vi.mock('electron', () => ({
  app: { getPath: () => mocks.dir, once: vi.fn() },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      mocks.handlers.set(channel, handler)
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (...args: unknown[]) => mocks.seal(...args),
    decryptString: (...args: unknown[]) => mocks.open(...args)
  },
  dialog: { showSaveDialog: (...args: unknown[]) => mocks.dialog(...args) }
}))
vi.mock('systeminformation', () => ({ fsStats: vi.fn(), processes: vi.fn(), mem: vi.fn() }))

let session: DiagnosticSession
let store: DiagnosticsStore
const call = (action: string, id?: unknown, value?: unknown) =>
  mocks.handlers.get(IPC.DIAGNOSTICS)!({}, action, id, value)
beforeEach(async () => {
  mocks.dir = await mkdtemp(join(tmpdir(), 'supersonic-diagnostics-ipc-'))
  mocks.handlers.clear()
  mocks.dialog.mockReset()
  const key = randomBytes(32)
  mocks.seal.mockImplementation((value: string) => {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()])
  })
  mocks.open.mockImplementation((value: Buffer) => {
    const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
    cipher.setAuthTag(value.subarray(-16))
    return Buffer.concat([cipher.update(value.subarray(12, -16)), cipher.final()]).toString()
  })
  store = new DiagnosticsStore(join(mocks.dir, 'performance-diagnostics'), mocks.seal, mocks.open)
  session = {
    title: 'Synthetic recording',
    notes: 'Original note',
    pinned: false,
    state: 'saved',
    report: null,
    recording: {
      version: 1,
      recordId: randomUUID(),
      startedAt: new Date().toISOString(),
      durationMs: 1000,
      system: {
        platform: 'win32',
        cpuModel: 'Test CPU',
        logicalCores: 4,
        totalMemoryBytes: 4096,
        osVersion: 'Test'
      },
      samples: [
        {
          t: 0,
          cpuPercent: 20,
          memoryPercent: 25,
          memoryUsedBytes: 1024,
          diskReadBytesPerSec: null,
          diskWriteBytesPerSec: null,
          processes: []
        }
      ]
    }
  }
  Object.assign(session, { upload: { account: 'retired-test-account' } })
  await store.save(session, true)
  registerPerformanceDiagnosticsIpc()
})
afterEach(async () => {
  expect(dirname(resolve(mocks.dir))).toBe(resolve(tmpdir()))
  await rm(mocks.dir, { recursive: true, force: true })
})

describe('local diagnostic IPC workflows', () => {
  it('saves a local report encrypted, preserves concurrent details, reopens it and includes it in export', async () => {
    const id = session.recording.recordId
    const [report] = await Promise.all([
      call('analyze', id, 'it'),
      call('edit', id, { title: 'Analyzed recording', notes: 'Saved note', pinned: true })
    ])
    expect(report).toMatchObject({ source: 'local', language: 'it' })
    registerPerformanceDiagnosticsIpc()
    expect(await call('get', id)).toMatchObject({
      title: 'Analyzed recording',
      notes: 'Saved note',
      pinned: true,
      report
    })
    const encrypted = await readFile(join(mocks.dir, 'performance-diagnostics', id + '.record'))
    expect(encrypted.toString()).not.toContain('Analizzati localmente')
    const filePath = join(mocks.dir, 'report-export.json')
    mocks.dialog.mockResolvedValue({ canceled: false, filePath })
    await call('export', id)
    expect(JSON.parse(await readFile(filePath, 'utf8')).report).toEqual(report)
  })

  it('surfaces report persistence errors and invalid language without replacing the previous report', async () => {
    const id = session.recording.recordId
    const previous = await call('analyze', id, 'en')
    mocks.seal.mockImplementationOnce(() => {
      throw new Error('Synthetic write failure')
    })
    await expect(call('analyze', id, 'it')).rejects.toThrow('Synthetic write failure')
    expect(await call('get', id)).toMatchObject({ report: previous })
    await expect(call('analyze', id, 'invalid')).rejects.toThrow('Invalid analysis language')
    expect(await call('get', id)).toMatchObject({ report: previous })
  })

  it('persists edited details in encrypted storage and reloads them through a new service instance', async () => {
    const id = session.recording.recordId
    await call('edit', id, {
      title: '  Saved title  ',
      notes: 'Saved note\nsecond line',
      pinned: false
    })
    expect(await call('get', id)).toMatchObject({
      title: 'Saved title',
      notes: 'Saved note\nsecond line'
    })
    registerPerformanceDiagnosticsIpc()
    expect(await call('get', id)).toMatchObject({
      title: 'Saved title',
      notes: 'Saved note\nsecond line'
    })
    const bytes = await readFile(join(mocks.dir, 'performance-diagnostics', id + '.record'))
    expect(bytes.toString()).not.toContain('Saved title')
    expect(await call('status')).toMatchObject({
      rows: [expect.objectContaining({ id, title: 'Saved title' })]
    })
  })
  it('pins persistently, rejects deletion while pinned, and deletes only the selected unpinned recording', async () => {
    const id = session.recording.recordId
    await call('edit', id, { title: session.title, notes: session.notes, pinned: true })
    await expect(call('remove', id)).rejects.toThrow('Unpin')
    registerPerformanceDiagnosticsIpc()
    expect(await call('get', id)).toMatchObject({ pinned: true })
    await call('edit', id, { title: session.title, notes: session.notes, pinned: false })
    await call('remove', id)
    expect(await call('status')).toMatchObject({ rows: [] })
    await expect(call('get', id)).rejects.toThrow()
  })
  it('exports the saved title and notes to the chosen file without retired account metadata', async () => {
    const id = session.recording.recordId
    await call('edit', id, { title: 'Export title', notes: 'Export note', pinned: false })
    const filePath = join(mocks.dir, 'synthetic-export.json')
    mocks.dialog.mockResolvedValue({ canceled: false, filePath })
    expect(await call('export', id)).toBe(true)
    const payload = JSON.parse(await readFile(filePath, 'utf8'))
    expect(Object.keys(payload).sort()).toEqual([
      'notes',
      'recording',
      'report',
      'title',
      'version'
    ])
    expect(payload).toMatchObject({ title: 'Export title', notes: 'Export note', version: 1 })
    expect(JSON.stringify(payload)).not.toContain('retired-test-account')
  })
  it('returns cancellation separately and surfaces write failure without reporting an export', async () => {
    const id = session.recording.recordId
    mocks.dialog.mockResolvedValueOnce({ canceled: true })
    expect(await call('export', id)).toBe(false)
    mocks.dialog.mockResolvedValueOnce({
      canceled: false,
      filePath: join(mocks.dir, 'missing', 'export.json')
    })
    await expect(call('export', id)).rejects.toThrow()
    expect(await call('get', id)).toMatchObject({ title: session.title })
  })
  it('rejects invalid IDs and invalid details without altering the saved recording', async () => {
    await expect(
      call('edit', '../outside', { title: 'x', notes: '', pinned: false })
    ).rejects.toThrow('Invalid recording ID')
    await expect(
      call('edit', session.recording.recordId, { title: ' ', notes: '', pinned: false })
    ).rejects.toThrow('Invalid recording details')
    await expect(
      call('edit', session.recording.recordId, {
        title: 'x',
        notes: 'n'.repeat(2001),
        pinned: false
      })
    ).rejects.toThrow('Invalid recording details')
    expect(await call('get', session.recording.recordId)).toMatchObject({
      title: session.title,
      notes: session.notes
    })
  })
})
