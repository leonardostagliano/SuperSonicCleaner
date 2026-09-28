import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { meterTone } from './perf-summary'

const NBSP = '\u00a0'

interface GaugeCardProps {
  label: string
  /** A load gauge: 0-100 with a meter; null until the first sample. */
  percent?: number | null
  /** A rate gauge without a meter ("1,20 MB/s"); null until it is measured. */
  value?: string | null
  /** One line under the value; hidden while waiting. */
  detail?: string
  /** Replaces the waiting line when the value cannot be measured on this system. */
  note?: string
}

/**
 * One column of "Carico attuale": the value, a line of detail and, for loads, a flat
 * meter (neutral, red above 90 %). Until a value exists it says so instead of a dash.
 * `data-gauge-value` marks only a real value (scripts/ui-audit/perf.mjs times it).
 */
export const GaugeCard = memo(function GaugeCard({
  label,
  percent,
  value = null,
  detail,
  note
}: GaugeCardProps) {
  const { t } = useTranslation('performance')
  const isLoad = percent !== undefined
  const reading =
    percent === null || percent === undefined || !Number.isFinite(percent)
      ? null
      : Math.max(0, Math.min(100, percent))
  const waiting = isLoad ? reading === null : value === null
  return (
    <div className="perf-gauge">
      <h3 className="perf-gauge-label">{label}</h3>
      <p className="perf-gauge-value">
        {waiting ? (
          <span className="perf-gauge-waiting">{note ?? t('waitingForSample')}</span>
        ) : (
          <strong data-gauge-value>
            {isLoad ? Math.round(reading as number) : value}
            {isLoad && <small>%</small>}
          </strong>
        )}
      </p>
      <p className="perf-gauge-detail">{waiting || !detail ? NBSP : detail}</p>
      {isLoad &&
        (reading === null ? (
          // An empty track keeps the meter's place; nothing is measured yet.
          <span className="ui-progress" aria-hidden="true">
            <span className="ui-progress-fill" />
          </span>
        ) : (
          <ProgressBar value={reading / 100} tone={meterTone(reading)} label={label} />
        ))}
    </div>
  )
})
