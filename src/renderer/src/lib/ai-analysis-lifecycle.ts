import { useAiAnalysisStore } from '@/stores/ai-analysis-store'
import { useScanStore } from '@/stores/scan-store'
import { useLargeFileStore } from '@/stores/large-file-store'
import { useDuplicateStore } from '@/stores/duplicate-store'
import { useDiskStore } from '@/stores/disk-store'

/** Invalidate stale recommendations even when their page is not mounted. */
export function initAiAnalysisSources() {
  const sync = () => {
    const ai = useAiAnalysisStore.getState()
    ai.sync('cleaner', useScanStore.getState().results)
    ai.sync('large-files', useLargeFileStore.getState().result)
    ai.sync('duplicates', useDuplicateStore.getState().result)
    const disk = useDiskStore.getState()
    ai.sync('disk', disk.data ? (disk.breadcrumb.at(-1) ?? disk.data) : null)
  }
  const unsubscribes = [useScanStore, useLargeFileStore, useDuplicateStore, useDiskStore].map(
    (source) => source.subscribe(sync)
  )
  sync()
  return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
}
