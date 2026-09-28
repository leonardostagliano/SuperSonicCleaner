import { describe, expect, it } from 'vitest'
import type { DiskRepairResult } from '@shared/types'
import { repairOutcome } from './repair-view'

const result = (over: Partial<DiskRepairResult>): DiskRepairResult => ({
  tool: 'sfc',
  success: false,
  exitCode: null,
  summary: { key: 'disk:repairResult.completed', params: { tool: 'SFC' } },
  log: '',
  requiresReboot: false,
  needsAdmin: false,
  ...over
})

describe('repairOutcome', () => {
  it('is ok only when the tool reported success', () => {
    expect(repairOutcome(result({ success: true, exitCode: 0 }))).toBe('ok')
    expect(repairOutcome(result({ success: false, exitCode: 87 }))).toBe('failed')
  })

  it('treats a run blocked by missing administrator rights as not started', () => {
    expect(repairOutcome(result({ needsAdmin: true }))).toBe('blocked')
  })
})
