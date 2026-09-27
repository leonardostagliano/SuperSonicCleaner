export interface BackgroundScanTask {
  shouldRun: () => boolean
  run: () => Promise<void>
}

const STARTUP_DELAY_MS = 15_000
const QUIET_PERIOD_MS = 3_000
const RETRY_DELAY_MS = 1_000
const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel'] as const

/** Defer optional startup checks, then run them one at a time while the UI is
 * quiet and no foreground scan is active. Explicit user actions never join this queue. */
export function deferBackgroundScans(
  tasks: readonly BackgroundScanTask[],
  isBusy: () => boolean
): () => void {
  let disposed = false
  let next = 0
  let lastInput = performance.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  let idleHandle: number | undefined
  const onInput = () => {
    lastInput = performance.now()
  }
  for (const event of INPUT_EVENTS) window.addEventListener(event, onInput, { passive: true })

  const dispose = () => {
    disposed = true
    clearTimeout(timer)
    if (idleHandle !== undefined) window.cancelIdleCallback(idleHandle)
    for (const event of INPUT_EVENTS) window.removeEventListener(event, onInput)
  }

  const schedule = (delay: number) => {
    if (disposed) return
    timer = setTimeout(() => {
      if (
        typeof window.requestIdleCallback === 'function' &&
        typeof window.cancelIdleCallback === 'function'
      ) {
        idleHandle = window.requestIdleCallback(() => void step())
      } else {
        void step()
      }
    }, delay)
  }

  const step = async () => {
    idleHandle = undefined
    if (disposed) return
    if (isBusy() || performance.now() - lastInput < QUIET_PERIOD_MS) {
      schedule(RETRY_DELAY_MS)
      return
    }
    // Recheck at execution time: manual checks and changed preferences can make
    // a queued task unnecessary before its turn arrives.
    while (next < tasks.length && !tasks[next].shouldRun()) next++
    if (next === tasks.length) {
      dispose()
      return
    }
    const task = tasks[next++]
    try {
      await task.run()
    } catch {
      // A failed optional check must not prevent the next one from running.
    } finally {
      if (next === tasks.length) dispose()
      else schedule(QUIET_PERIOD_MS)
    }
  }

  schedule(STARTUP_DELAY_MS)
  return dispose
}
