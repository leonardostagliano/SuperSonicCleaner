import { useEffect } from 'react'
import { acquireTelemetry, useTelemetryStore } from '@/stores/telemetry-store'

export type { QuickSample } from '@/stores/telemetry-store'

/** Live CPU and memory for Home; samples persist across navigation. */
export function useQuickTelemetry() {
  const current = useTelemetryStore((s) => s.current)
  const samples = useTelemetryStore((s) => s.samples)
  useEffect(() => acquireTelemetry(), [])
  return { current, samples }
}
