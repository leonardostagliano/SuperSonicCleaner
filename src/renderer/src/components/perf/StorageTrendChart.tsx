import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from 'recharts'
import type { StorageSnapshotSummary } from '@shared/storage-history'
import { Section } from '@/components/ui/Card'
import { storageTrend } from '@/lib/storage-trend'
import { trendAxisLabel } from '@/lib/storage-history-view'
import { formatDateTime } from '@/lib/storage-tools-format'
import { formatBytes } from '@/lib/utils'

/**
 * Folder size across comparable complete snapshots. The page renders it only when
 * trendView() says there is a trend (at least two snapshots that differ); with fewer
 * than two points it draws nothing.
 */
export function StorageTrendChart({ snapshots }: { snapshots: StorageSnapshotSummary[] }) {
  const { t, i18n } = useTranslation('experience')
  const locale = i18n.language
  const data = useMemo(() => storageTrend(snapshots), [snapshots])
  if (data.length < 2) return null
  const axisLabel = trendAxisLabel(data[data.length - 1].time - data[0].time, locale)
  return (
    <Section title={t('storageTrend.title')}>
      <p className="m-0 mb-3 text-[length:var(--text-12)] leading-normal text-[var(--text-muted)]">
        {t('storageTrend.description')}
      </p>
      {/* The chart is always drawn left to right, whatever the language's direction. */}
      <div className="h-[210px] min-w-0" dir="ltr">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart
            data={data}
            margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
            accessibilityLayer
          >
            <CartesianGrid vertical={false} stroke="var(--border-default)" />
            <XAxis
              dataKey="time"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(time) => axisLabel(Number(time))}
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              domain={[0, 'auto']}
              tickFormatter={(value) => formatBytes(Number(value))}
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={72}
            />
            <Tooltip
              labelFormatter={(time) => formatDateTime(Number(time), locale)}
              formatter={(value) => [formatBytes(Number(value)), t('storageTrend.size')]}
              contentStyle={{
                background: 'var(--flyout-bg)',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-control)',
                fontSize: 'var(--text-12)',
                color: 'var(--text-primary)'
              }}
            />
            <Line
              dataKey="bytes"
              name={t('storageTrend.size')}
              type="linear"
              stroke="var(--chart-1)"
              strokeWidth={1.75}
              dot={{ r: 3, fill: 'var(--card-bg)', stroke: 'var(--chart-1)', strokeWidth: 1.75 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Section>
  )
}
