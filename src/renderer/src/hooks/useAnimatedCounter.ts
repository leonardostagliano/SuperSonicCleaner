import { useEffect, useRef, useState } from 'react'

/** Repaint budget: 30 updates a second reads as smooth; 165 Hz renders were waste. */
const FRAME_MS = 1000 / 30

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

export function useAnimatedCounter(target: number, duration = 800): number {
  const reduced = prefersReducedMotion()
  const [value, setValue] = useState(reduced ? target : 0)
  const current = useRef(value)

  useEffect(() => {
    if (reduced) {
      current.current = target
      setValue(target)
      return
    }
    const from = current.current
    let start: number | null = null
    let lastPaint = -Infinity
    let rafId = 0
    const animate = (now: number) => {
      start ??= now
      const progress = Math.min((now - start) / duration, 1)
      const next = from + (target - from) * (1 - Math.pow(1 - progress, 3))
      current.current = next
      if (progress === 1 || now - lastPaint >= FRAME_MS) {
        lastPaint = now
        setValue(next)
      }
      if (progress < 1) rafId = requestAnimationFrame(animate)
    }
    rafId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafId)
  }, [target, duration, reduced])

  return value
}
