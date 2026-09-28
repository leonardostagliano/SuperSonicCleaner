import { describe, expect, it } from 'vitest'
import { describeRecoveryValue } from './recovery-value'

const dword = { kind: 'registry-dword', key: 'HKCU\\Software\\Test', name: 'Enabled' } as const
const task = { kind: 'task-enabled', name: '\\Microsoft\\Windows\\Test' } as const
const service = { kind: 'service-start', name: 'DiagTrack' } as const

describe('describeRecoveryValue', () => {
  it('says when the value did not exist', () => {
    expect(describeRecoveryValue(dword, null)).toEqual([{ key: 'recovery.value.absent' }])
  })

  it('shows a DWORD with its hex form', () => {
    expect(describeRecoveryValue(dword, 255)).toEqual([
      { key: 'recovery.value.dword', params: { value: 255, hex: '000000FF' } }
    ])
    expect(describeRecoveryValue(dword, 0xffffffff)[0].params?.hex).toBe('FFFFFFFF')
  })

  it('names the state of a scheduled task', () => {
    expect(describeRecoveryValue(task, true)).toEqual([{ key: 'recovery.value.taskEnabled' }])
    expect(describeRecoveryValue(task, false)).toEqual([{ key: 'recovery.value.taskDisabled' }])
  })

  it('names the start type, delayed start and running state of a service', () => {
    expect(describeRecoveryValue(service, { start: 2, delayed: 1, running: true })).toEqual([
      { key: 'recovery.value.start.automatic' },
      { key: 'recovery.value.delayed' },
      { key: 'recovery.value.running' }
    ])
    expect(describeRecoveryValue(service, { start: 4, delayed: null, running: false })).toEqual([
      { key: 'recovery.value.start.disabled' },
      { key: 'recovery.value.stopped' }
    ])
  })

  it('falls back to the raw value when it does not match the target', () => {
    expect(describeRecoveryValue(task, 3)).toEqual([
      { key: 'recovery.value.raw', params: { value: '3' } }
    ])
    expect(describeRecoveryValue(service, { start: 9, delayed: 0, running: false })[0]).toEqual({
      key: 'recovery.value.raw',
      params: { value: '9' }
    })
  })
})
