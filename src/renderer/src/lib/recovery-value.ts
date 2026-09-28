import type { RecoveryTarget, RecoveryValue } from '@shared/recovery'

/** One translatable part of a recorded value, in the `history` namespace. */
export interface ValuePart {
  key: string
  params?: Record<string, string | number>
}

const START_TYPES = ['boot', 'system', 'automatic', 'manual', 'disabled'] as const

/**
 * A recorded before/after value in words instead of raw JSON: a registry DWORD with
 * its hex form, a scheduled task's state, a service's start type, delayed start and
 * running state. Values that do not match their target fall back to the raw text.
 */
export function describeRecoveryValue(target: RecoveryTarget, value: RecoveryValue): ValuePart[] {
  if (value === null) return [{ key: 'recovery.value.absent' }]
  if (target.kind === 'registry-dword' && typeof value === 'number') {
    const hex = (value >>> 0).toString(16).toUpperCase().padStart(8, '0')
    return [{ key: 'recovery.value.dword', params: { value, hex } }]
  }
  if (target.kind === 'task-enabled' && typeof value === 'boolean') {
    return [{ key: value ? 'recovery.value.taskEnabled' : 'recovery.value.taskDisabled' }]
  }
  if (target.kind === 'service-start' && typeof value === 'object') {
    const start = START_TYPES[value.start]
    const parts: ValuePart[] = [
      start
        ? { key: `recovery.value.start.${start}` }
        : { key: 'recovery.value.raw', params: { value: String(value.start) } }
    ]
    if (value.delayed === 1) parts.push({ key: 'recovery.value.delayed' })
    parts.push({ key: value.running ? 'recovery.value.running' : 'recovery.value.stopped' })
    return parts
  }
  return [{ key: 'recovery.value.raw', params: { value: JSON.stringify(value) } }]
}
