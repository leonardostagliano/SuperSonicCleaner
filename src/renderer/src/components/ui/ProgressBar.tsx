export interface ProgressBarProps {
  /** 0..1. Leave it out (or pass `indeterminate`) when the amount is unknown. */
  value?: number
  indeterminate?: boolean
  /** 'danger' only for a real problem (a load above 90 %, a failing operation). */
  tone?: 'neutral' | 'danger'
  /** The accessible name: what is progressing. */
  label: string
}

/** A flat bar. The fill moves with transform: scaleX(), never with a width transition. */
export function ProgressBar({
  value,
  indeterminate = false,
  tone = 'neutral',
  label
}: ProgressBarProps) {
  const known = !indeterminate && typeof value === 'number' && Number.isFinite(value)
  const unknown = !known
  const fraction = known ? Math.min(1, Math.max(0, value as number)) : 0
  return (
    <div
      className="ui-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={unknown ? undefined : Math.round(fraction * 100)}
      data-tone={tone}
      data-indeterminate={unknown || undefined}
    >
      <span
        className="ui-progress-fill"
        style={unknown ? undefined : { transform: `scaleX(${fraction})` }}
      />
    </div>
  )
}
