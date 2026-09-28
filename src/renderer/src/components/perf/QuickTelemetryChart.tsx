import { useTranslation } from 'react-i18next'
import type { QuickSample } from '@/hooks/useQuickTelemetry'

/** Gridlines in viewBox units (height 120) with the labels drawn on them. */
const HEIGHT = 120
const TOP = 6
const BOTTOM = 114
const GRID = [
  { y: TOP, label: '100%' },
  { y: (TOP + BOTTOM) / 2, label: '50%' },
  { y: BOTTOM, label: '0%' }
]
const SERIES = [
  { key: 'cpu', colour: 'var(--chart-1)', labelKey: 'resources.cpu' },
  { key: 'memory', colour: 'var(--chart-2)', labelKey: 'resources.memoryShort' }
] as const

/** CPU and memory of this session as two flat lines; a sentence until there are two samples. */
export function QuickTelemetryChart({ samples }: { samples: QuickSample[] }) {
  const { t } = useTranslation('dashboard')
  const span = samples.length > 1 ? samples.at(-1)!.at - samples[0].at : 0
  const points = (key: 'cpu' | 'memory') =>
    samples
      .map((sample) => {
        const x = ((sample.at - samples[0].at) / Math.max(1, span)) * 720
        const y = BOTTOM - (Math.max(0, Math.min(100, sample[key])) / 100) * (BOTTOM - TOP)
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  const seconds = Math.round(span / 1000)
  const ready = samples.length > 1
  return (
    <figure className="home-chart">
      <figcaption className="home-chart-legend">
        <span className="home-chart-title">{t('resources.chartTitle')}</span>
        {SERIES.map((series) => (
          <span key={series.key} className="home-chart-key">
            <i data-series={series.key} aria-hidden="true" />
            {t(series.labelKey)}
          </span>
        ))}
      </figcaption>
      <div className="home-chart-plot">
        <div className="home-chart-scale" aria-hidden="true">
          {GRID.map(({ y, label }) => (
            <span key={y} style={{ top: `${(y / HEIGHT) * 100}%` }}>
              {label}
            </span>
          ))}
        </div>
        <svg viewBox={`0 0 720 ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          {GRID.map(({ y }) => (
            <line
              key={y}
              x1="0"
              x2="720"
              y1={y}
              y2={y}
              stroke="var(--border-default)"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {ready &&
            SERIES.map((series) => (
              <polyline
                key={series.key}
                points={points(series.key)}
                fill="none"
                stroke={series.colour}
                strokeWidth="1.5"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
        </svg>
        {/* The plot is forced LTR; the sentence follows its own language's direction */}
        {!ready && (
          <p className="home-chart-waiting" dir="auto">
            {t('resources.chartWaiting')}
          </p>
        )}
      </div>
      <div className="home-chart-times" aria-hidden="true">
        <span>{ready ? t('resources.ago', { seconds }) : '—'}</span>
        <span>{t('resources.now')}</span>
      </div>
    </figure>
  )
}
