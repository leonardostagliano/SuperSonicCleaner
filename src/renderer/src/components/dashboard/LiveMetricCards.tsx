import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Section } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { QuickTelemetryChart } from '@/components/perf/QuickTelemetryChart'
import { useQuickTelemetry } from '@/hooks/useQuickTelemetry'
import { formatBytes, NO_VALUE } from '@/lib/utils'
import { formatPercent } from './when'

/** CPU at or above this load reads as high. */
const CPU_HIGH = 70
const NBSP = ' '

/** "22,1 GB" as a value and its unit, so the unit can be set smaller. */
const splitUnit = (text: string): [string, string] => {
  const at = text.lastIndexOf(NBSP)
  return at === -1 ? [text, ''] : [text.slice(0, at), text.slice(at + 1)]
}

// Home's live readings subscribe to telemetry themselves: a new sample re-renders this
// section only. It takes no props, so memo keeps the report's own re-renders out.
export const ResourcesSection = memo(function ResourcesSection() {
  const { t, i18n } = useTranslation('dashboard')
  const navigate = useNavigate()
  const { current: perf, samples } = useQuickTelemetry()
  const locale = i18n.language || 'en'
  const last = samples.at(-1)
  const previous = samples.at(-2)
  const cadence = last && previous ? Math.max(1, Math.round((last.at - previous.at) / 1000)) : null
  const [memValue, memUnit] = perf ? splitUnit(formatBytes(perf.memUsedBytes)) : [NO_VALUE, '']
  return (
    <Section
      title={t('resources.title')}
      meta={cadence ? t('resources.cadence', { seconds: cadence }) : t('resources.waiting')}
      actions={
        <Button variant="ghost" onClick={() => navigate('/performance')}>
          {t('resources.open')}
        </Button>
      }
      className="home-resources"
    >
      <div className="home-readings">
        <div className="home-reading">
          <span className="home-reading-label">{t('resources.cpu')}</span>
          <span className="home-reading-value">
            <span data-audit="home-cpu">{perf ? Math.round(perf.cpuPercent) : NO_VALUE}</span>
            {perf && <span className="home-reading-unit">%</span>}
          </span>
          <span className="home-reading-detail">
            {perf
              ? t(perf.cpuPercent >= CPU_HIGH ? 'resources.cpuHigh' : 'resources.cpuLow', {
                  threshold: formatPercent(CPU_HIGH, locale)
                })
              : t('resources.unavailable')}
          </span>
        </div>
        <div className="home-reading">
          <span className="home-reading-label">{t('resources.memory')}</span>
          <span className="home-reading-value">
            <span data-audit="home-memory">{memValue}</span>
            {memUnit && <span className="home-reading-unit">{memUnit}</span>}
          </span>
          <span className="home-reading-detail">
            {perf
              ? t('resources.memoryOf', {
                  total: formatBytes(perf.memTotalBytes),
                  percent: formatPercent(perf.memPercent, locale)
                })
              : t('resources.unavailable')}
          </span>
        </div>
        <QuickTelemetryChart samples={samples} />
      </div>
    </Section>
  )
})
