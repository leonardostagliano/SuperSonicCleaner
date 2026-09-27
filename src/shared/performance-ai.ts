/** Closed numerical inference contract. No original IDs, names, dates or free text. */
export interface PerformanceAiMetric {
  median: number
  max: number
  /** Relative offsets of the actual non-null observations behind this aggregate. */
  sampleTimesMs: number[]
}
export interface PerformanceAiWindow {
  sampleTimesMs: number[]
  cpuPercent: PerformanceAiMetric | null
  memoryPercent: PerformanceAiMetric | null
  memoryUsedBytes: PerformanceAiMetric | null
  diskReadBytesPerSec: PerformanceAiMetric | null
  diskWriteBytesPerSec: PerformanceAiMetric | null
  processes: Array<{
    id: string
    processCpuPercent: PerformanceAiMetric | null
    processMemoryBytes: PerformanceAiMetric | null
  }>
}
export interface PerformanceAiRequest {
  source: 'performance'
  durationMs: number
  logicalCores: number
  totalMemoryBytes: number
  sampleCount: number
  expectedSamples: number
  interrupted: 0 | 1
  omittedProcessCount: number
  windows: PerformanceAiWindow[]
}
