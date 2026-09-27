import { afterEach, describe, expect, it, vi } from 'vitest'
import { initAiAnalysisSources } from './ai-analysis-lifecycle'
import { useScanStore } from '@/stores/scan-store'
import { useAiAnalysisStore } from '@/stores/ai-analysis-store'

afterEach(() => vi.restoreAllMocks())

describe('AI source lifecycle', () => {
  it('observes scan replacement without a page and disposes before StrictMode remount', () => {
    const sync = vi.spyOn(useAiAnalysisStore.getState(), 'sync')
    const dispose = initAiAnalysisSources()
    sync.mockClear()
    const nextResults: ReturnType<typeof useScanStore.getState>['results'] = []
    useScanStore.setState({ results: nextResults })
    expect(sync).toHaveBeenCalledWith('cleaner', nextResults)
    dispose()
    sync.mockClear()
    useScanStore.setState({ results: [] })
    expect(sync).not.toHaveBeenCalled()
    const disposeAgain = initAiAnalysisSources()
    sync.mockClear()
    useScanStore.setState({ results: [] })
    expect(sync.mock.calls.filter(([source]) => source === 'cleaner')).toHaveLength(1)
    disposeAgain()
  })
})
