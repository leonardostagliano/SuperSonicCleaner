import type { DiskRepairResult } from '@shared/types'

export type RepairTool = DiskRepairResult['tool']

/**
 * How a finished repair tool reads on the page: 'ok' only for a run the tool reported as
 * successful (green is for verified results), 'blocked' when it never started for lack of
 * administrator rights (a state, not an error), 'failed' otherwise.
 */
export function repairOutcome(result: DiskRepairResult): 'ok' | 'blocked' | 'failed' {
  if (result.needsAdmin) return 'blocked'
  return result.success ? 'ok' : 'failed'
}
