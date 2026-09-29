import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer
} from 'recharts'
import type { PerfSnapshot } from '@shared/types'
import { buildTimeSeries } from '@/lib/performance-chart'
import { formatSpeed } from '@/lib/utils'
import { chartBody, formatClock, formatPercent } from './perf-summary'

interface TimeSeriesChartProps {
  history: PerfSnapshot[]
  timeRange: '60s' | '5m' | '15m'
  dataKey: 'cpu' | 'memory' | 'disk'
  label: string
  /** The series can never be measured here: one sentence instead of waiting. */
  unavailable?: string
}

const NBSP = '\u00a0'
const MB = 1048576
/** Smaller movements read as one sentence: percentage points, or MB/s for the disk. */
const MIN_SPREAD = { percent: 2, disk: 0.1 }
const PERCENT_TICKS = [0, 50, 100]
/** A flat fill at 10 % under the line; charts use no gradients. */
const FILL_OPACITY = 0.1

export const TimeSeriesChart = memo(function TimeSeriesChart({
  history,
  timeRange,
  dataKey,
  label,
  unavailable
}: TimeSeriesChartProps) {
  const { t, i18n } = useTranslation('performance')
  const locale = i18n.language
  const data = useMemo(
    () => buildTimeSeries(history, timeRange, dataKey),
    [history, timeRange, dataKey]
  )
  const isDisk = dataKey === 'disk'
  const values = isDisk
    ? data.flatMap((point) => [point.read ?? null, point.write ?? null])
    : data.map((point) => point.value ?? null)
  const body = chartBody(values, isDisk ? MIN_SPREAD.disk : MIN_SPREAD.percent)
  const format = (value: number) =>
    isDisk ? formatSpeed(value * MB, locale) : formatPercent(value, locale)
  const since = data.length ? formatClock(data[0].time, locale) : ''

  let sentence = ''
  if (body.kind === 'waiting') sentence = unavailable ?? t('waitingForSample')
  else if (body.kind === 'single') sentence = t('chartSinglePoint')
  else if (body.kind === 'flat') {
    const min = format(body.min)
    const max = format(body.max)
    sentence =
      min === max
        ? t('chartFlatSingle', { value: min, time: since })
        : t('chartFlat', { min, max, time: since })
  }

  return (
    <figure className="perf-chart" aria-label={label}>
      <figcaption className="perf-chart-head">
        <span className="perf-chart-title">
          {label}
          {isDisk && <span className="perf-chart-unit">{t('chartDiskUnit')}</span>}
        </span>
        {isDisk && (
          <span className="perf-chart-legend">
            <span data-series="1">{t('chartDiskReadName')}</span>
            <span data-series="2">{t('chartDiskWriteName')}</span>
          </span>
        )}
      </figcaption>
      {body.kind === 'chart' ? (
        <div className="perf-chart-body">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <AreaChart
              data={data}
              margin={{ top: 6, right: 4, bottom: 0, left: 0 }}
              accessibilityLayer
            >
              <CartesianGrid vertical={false} stroke="var(--border-default)" />
              <XAxis dataKey="time" hide type="number" domain={['dataMin', 'dataMax']} />
              <YAxis
                domain={isDisk ? [0, 'auto'] : [0, 100]}
                ticks={isDisk ? undefined : PERCENT_TICKS}
                width={44}
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                tickFormatter={(value: number) => (isDisk ? String(value) : format(value))}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--flyout-bg)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 'var(--radius-control)',
                  fontSize: 'var(--text-12)',
                  color: 'var(--text-primary)'
                }}
                labelFormatter={(value) => formatClock(Number(value), locale)}
                formatter={(value) => [format(Number(value))]}
              />
              {isDisk ? (
                <>
                  <Area
                    type="linear"
                    dataKey="read"
                    stroke="var(--chart-1)"
                    fill="var(--chart-1)"
                    fillOpacity={FILL_OPACITY}
                    strokeWidth={1.75}
                    isAnimationActive={false}
                    name={t('chartDiskReadName')}
                  />
                  <Area
                    type="linear"
                    dataKey="write"
                    stroke="var(--chart-2)"
                    fill="none"
                    strokeWidth={1.75}
                    isAnimationActive={false}
                    name={t('chartDiskWriteName')}
                  />
                </>
              ) : (
                <Area
                  type="linear"
                  dataKey="value"
                  stroke="var(--chart-1)"
                  fill="var(--chart-1)"
                  fillOpacity={FILL_OPACITY}
                  strokeWidth={1.75}
                  isAnimationActive={false}
                  name={label}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="perf-chart-note">{sentence}</p>
      )}
      <p className="perf-chart-times">
        <span>{data.length > 1 ? since : NBSP}</span>
        <span>{data.length > 1 ? formatClock(data[data.length - 1].time, locale) : NBSP}</span>
      </p>
    </figure>
  )
})
