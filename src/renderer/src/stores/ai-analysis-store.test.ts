import { describe, expect, it, vi } from 'vitest'
import type { AiAnalysisResult } from '@shared/ai-analysis'
import { createAiAnalysisStore } from './ai-analysis-store'

function setup() {
  let resolve!: (result: AiAnalysisResult) => void
  let reject!: (error: Error) => void
  const pending = new Promise<AiAnalysisResult>((done, fail) => {
    resolve = done
    reject = fail
  })
  const api = {
    aiAnalysisStatus: vi.fn().mockResolvedValue({ available: true, connected: true }),
    aiAnalysisRun: vi.fn(() => pending),
    aiAnalysisCancel: vi.fn().mockResolvedValue(undefined)
  }
  const store = createAiAnalysisStore(() => api)
  return { store, api, resolve, reject }
}
const candidates = [{ path: 'C:\\private-name\\invented.pdf', size: 1024 }]
const result: AiAnalysisResult = { summary: 'Synthetic report', recommendations: [] }

describe('AI operation lifetime', () => {
  it('retains a pending request and its result across panel remounts with the same revision', async () => {
    const { store, api, resolve } = setup()
    const revision = {}
    store.getState().sync('cleaner', revision)
    store.getState().toggle('cleaner')
    await store.getState().checkConnection()
    const run = store.getState().analyze('cleaner', candidates)
    store.getState().sync('cleaner', revision)
    store.getState().sync('duplicates', {})
    expect(api.aiAnalysisCancel).not.toHaveBeenCalled()
    expect(store.getState().activeSource).toBe('cleaner')
    resolve(result)
    await run
    store.getState().sync('cleaner', revision)
    expect(store.getState().sessions.cleaner.result).toEqual(result)
    expect(store.getState().sessions.cleaner.localPaths.size).toBe(1)
    expect(JSON.stringify(api.aiAnalysisRun.mock.calls)).not.toContain('private-name')
    expect(JSON.stringify(api.aiAnalysisRun.mock.calls)).not.toContain('invented.pdf')
  })

  it('invalidates a late response when a new scan replaces the source', async () => {
    const { store, api, resolve } = setup()
    store.getState().toggle('cleaner')
    await store.getState().checkConnection()
    const run = store.getState().analyze('cleaner', candidates)
    store.getState().sync('cleaner', [])
    expect(api.aiAnalysisCancel).toHaveBeenCalledOnce()
    resolve(result)
    await run
    expect(store.getState().sessions.cleaner.result).toBeNull()
    expect(store.getState().sessions.cleaner.localPaths.size).toBe(0)
  })

  it('allows only one backend request and only its owner can cancel it', async () => {
    const { store, api, resolve } = setup()
    store.getState().toggle('cleaner')
    store.getState().toggle('disk')
    await store.getState().checkConnection()
    const run = store.getState().analyze('cleaner', candidates)
    await store.getState().analyze('disk', candidates)
    store.getState().cancel('disk')
    store.getState().toggle('disk')
    expect(api.aiAnalysisRun).toHaveBeenCalledOnce()
    expect(api.aiAnalysisCancel).not.toHaveBeenCalled()
    store.getState().cancel('cleaner')
    store.getState().cancel('cleaner')
    expect(api.aiAnalysisCancel).toHaveBeenCalledOnce()
    resolve(result)
    await run
    expect(store.getState().activeSource).toBeNull()
    expect(store.getState().sessions.cleaner.result).toBeNull()
  })

  it('retains a failed operation for the returning page and releases the busy state', async () => {
    const { store, reject } = setup()
    store.getState().toggle('cleaner')
    await store.getState().checkConnection()
    const run = store.getState().analyze('cleaner', candidates)
    reject(new Error('Synthetic failure'))
    await run
    expect(store.getState().sessions.cleaner.error).toBe(true)
    expect(store.getState().activeSource).toBeNull()
  })

  it.each(['replacement', 'disable'] as const)(
    'ignores a late cancellation error after source %s',
    async (change) => {
      const { store, api, resolve } = setup()
      let rejectCancel!: (error: Error) => void
      api.aiAnalysisCancel.mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            rejectCancel = reject
          })
      )
      store.getState().sync('cleaner', {})
      store.getState().toggle('cleaner')
      await store.getState().checkConnection()
      const run = store.getState().analyze('cleaner', candidates)
      if (change === 'replacement') store.getState().sync('cleaner', {})
      else store.getState().toggle('cleaner')
      rejectCancel(new Error('Synthetic cancellation failure'))
      await Promise.resolve()
      expect(store.getState().sessions.cleaner.error).toBe(false)
      resolve(result)
      await run
      expect(store.getState().sessions.cleaner.error).toBe(false)
      expect(store.getState().sessions.cleaner.result).toBeNull()
    }
  )
})
