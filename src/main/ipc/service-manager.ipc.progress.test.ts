import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promisify } from 'util'
import type { ServiceScanProgress } from '../../shared/types'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() }
}))
vi.mock('../services/recovery-store', () => ({ recordRecoveryChanges: vi.fn() }))
vi.mock('../services/recovery', () => ({ readServiceStates: vi.fn() }))
vi.mock('../services/exec-utf8', () => ({ psUtf8: (cmd: string) => cmd }))
vi.mock('../platform', () => ({ getPlatform: () => ({ services: {} }) }))

const mockExecFile = vi.fn()
// promisify(execFile) resolves to { stdout, stderr }: the mock carries the same custom symbol.
vi.mock('child_process', () => {
  const fn = (...args: unknown[]) => mockExecFile(...args)
  ;(fn as any)[promisify.custom] = (cmd: string, args: string[], opts?: unknown) =>
    new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      mockExecFile(cmd, args, opts, (err: Error | null, stdout: string, stderr: string) => {
        if (err) reject(err)
        else resolve({ stdout, stderr })
      })
    })
  return { execFile: fn }
})

import { scanServices } from './service-manager.ipc'

const originalPlatform = process.platform
const setPlatform = (p: string) =>
  Object.defineProperty(process, 'platform', { value: p, configurable: true })

beforeEach(() => {
  setPlatform('win32')
  mockExecFile.mockReset()
  // First call lists the services, the second one their dependencies.
  mockExecFile
    .mockImplementationOnce((_cmd, _args, _opts, cb) =>
      cb(null, 'SVC|Spooler|Print Spooler|Running|Auto|Queues print jobs|True\n', '')
    )
    .mockImplementationOnce((_cmd, _args, _opts, cb) => cb(null, 'DEP|Spooler|RPCSS|\n', ''))
})

afterEach(() => {
  setPlatform(originalPlatform)
})

describe('scanServices progress', () => {
  it('sends translatable steps and plain service names, never English sentences', async () => {
    const progress: ServiceScanProgress[] = []
    const result = await scanServices((data) => progress.push(data))

    expect(result.services.map((s) => s.name)).toEqual(['Spooler'])
    expect(progress[0]).toEqual({
      phase: 'enumerating',
      current: 0,
      total: 0,
      currentService: { key: 'hardening:serviceManager.progressOneRequest' }
    })
    expect(progress[1]).toEqual({
      phase: 'classifying',
      current: 0,
      total: 1,
      currentService: { key: 'hardening:serviceManager.progressDependencies' }
    })
    expect(progress[2]).toEqual({
      phase: 'classifying',
      current: 0,
      total: 1,
      currentService: 'Print Spooler'
    })
  })
})
