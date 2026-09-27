import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deferBackgroundScans } from './deferred-background-scans'

let idleCallbacks: Map<number, () => void>
let nextIdle: number
let browser: EventTarget & {
  requestIdleCallback: ReturnType<typeof vi.fn>
  cancelIdleCallback: ReturnType<typeof vi.fn>
}
const cleanups: Array<() => void> = []

async function flushIdle(): Promise<void> {
  const pending = [...idleCallbacks]
  idleCallbacks.clear()
  for (const [, callback] of pending) callback()
  await Promise.resolve()
  await Promise.resolve()
}

function start(...args: Parameters<typeof deferBackgroundScans>): void {
  cleanups.push(deferBackgroundScans(...args))
}

beforeEach(() => {
  vi.useFakeTimers()
  idleCallbacks = new Map()
  nextIdle = 0
  browser = Object.assign(new EventTarget(), {
    requestIdleCallback: vi.fn((callback: () => void) => {
      const id = ++nextIdle
      idleCallbacks.set(id, callback)
      return id
    }),
    cancelIdleCallback: vi.fn((id: number) => idleCallbacks.delete(id))
  })
  vi.stubGlobal('window', browser)
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('optional startup scan scheduling', () => {
  it('waits for startup and browser idle, then serializes slow scans with a gap', async () => {
    let finish!: () => void
    const first = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const second = vi.fn().mockResolvedValue(undefined)
    start(
      [
        { shouldRun: () => true, run: first },
        { shouldRun: () => true, run: second }
      ],
      () => false
    )
    await vi.advanceTimersByTimeAsync(14_999)
    expect(first).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(first).not.toHaveBeenCalled()
    await flushIdle()
    expect(first).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(60_000)
    await flushIdle()
    expect(second).not.toHaveBeenCalled()
    finish()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(2_999)
    expect(second).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await flushIdle()
    expect(second).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('yields to existing foreground work and recent interaction', async () => {
    let busy = true
    const run = vi.fn().mockResolvedValue(undefined)
    start([{ shouldRun: () => true, run }], () => busy)
    await vi.advanceTimersByTimeAsync(15_000)
    await flushIdle()
    expect(run).not.toHaveBeenCalled()
    busy = false
    browser.dispatchEvent(new Event('pointerdown'))
    await vi.advanceTimersByTimeAsync(1_000)
    await flushIdle()
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2_000)
    await flushIdle()
    expect(run).toHaveBeenCalledOnce()
  })

  it('rechecks preferences and manual completion before launching queued work', async () => {
    let reminders = true
    let manuallyChecked = false
    const software = vi.fn().mockResolvedValue(undefined)
    const drivers = vi.fn().mockResolvedValue(undefined)
    start(
      [
        { shouldRun: () => reminders, run: software },
        { shouldRun: () => !manuallyChecked, run: drivers }
      ],
      () => false
    )
    reminders = false
    manuallyChecked = true
    await vi.advanceTimersByTimeAsync(15_000)
    await flushIdle()
    expect(software).not.toHaveBeenCalled()
    expect(drivers).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels both startup timers and idle callbacks across effect remounts', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const tasks = [{ shouldRun: () => true, run }]
    start(tasks, () => false)
    cleanups.at(-1)!()
    start(tasks, () => false)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(idleCallbacks.size).toBe(1)
    cleanups.at(-1)!()
    expect(idleCallbacks.size).toBe(0)
    await flushIdle()
    expect(run).not.toHaveBeenCalled()
    start(tasks, () => false)
    await vi.advanceTimersByTimeAsync(15_000)
    await flushIdle()
    expect(run).toHaveBeenCalledOnce()
  })

  it('does not start another scan after cleanup during an in-flight request', async () => {
    let finish!: () => void
    const second = vi.fn().mockResolvedValue(undefined)
    start(
      [
        {
          shouldRun: () => true,
          run: () => new Promise<void>((resolve) => (finish = resolve))
        },
        { shouldRun: () => true, run: second }
      ],
      () => false
    )
    await vi.advanceTimersByTimeAsync(15_000)
    await flushIdle()
    cleanups.at(-1)!()
    finish()
    await vi.advanceTimersByTimeAsync(60_000)
    await flushIdle()
    expect(second).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('continues to the next optional check after a failed scan', async () => {
    const second = vi.fn().mockResolvedValue(undefined)
    start(
      [
        { shouldRun: () => true, run: vi.fn().mockRejectedValue(new Error('Synthetic failure')) },
        { shouldRun: () => true, run: second }
      ],
      () => false
    )
    await vi.advanceTimersByTimeAsync(15_000)
    await flushIdle()
    await vi.advanceTimersByTimeAsync(3_000)
    await flushIdle()
    expect(second).toHaveBeenCalledOnce()
  })

  it('keeps the startup delay when idle callbacks are unavailable', async () => {
    vi.stubGlobal('window', new EventTarget())
    const run = vi.fn().mockResolvedValue(undefined)
    start([{ shouldRun: () => true, run }], () => false)
    await vi.advanceTimersByTimeAsync(14_999)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
