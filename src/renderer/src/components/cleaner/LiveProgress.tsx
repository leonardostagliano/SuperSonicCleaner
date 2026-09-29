import type { ReactNode } from 'react'
import { ProgressBar } from '@/components/ui'
import './pulizia.css'

export interface LiveProgressProps {
  /** What the bar measures: its accessible name. */
  label: string
  /** 0..1; undefined draws an indeterminate bar. */
  value?: number
  /** The stage in words ("Browsers, 2 of 9"): shown and announced. */
  step?: string
  /** The progress in steps of ten, announced with the stage but not shown. */
  announcedPercent?: string
  /** The path or entry being read: shown, never announced. */
  detail?: string
  /** Running counts and notes: shown, never announced. */
  children?: ReactNode
}

/**
 * A progress block where only the stage line is a live region. It changes with the stage
 * or a ten-percent step, so screen readers are not read every path and count that the
 * scanners and the cleaner report several times a second.
 */
export function LiveProgress({
  label,
  value,
  step,
  announcedPercent,
  detail,
  children
}: LiveProgressProps) {
  return (
    <div className="pulizia-progress">
      <ProgressBar value={value} label={label} />
      <p className={step ? 'pulizia-progress-step' : 'sr-only'} role="status">
        {step}
        {announcedPercent && (
          <span className="sr-only">
            {step ? ' · ' : ''}
            {announcedPercent}
          </span>
        )}
      </p>
      {detail && (
        <p className="pulizia-progress-path" title={detail}>
          {detail}
        </p>
      )}
      {children}
    </div>
  )
}
