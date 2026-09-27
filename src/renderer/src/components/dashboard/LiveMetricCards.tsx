import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Activity, ArrowRight, Cpu, MemoryStick } from 'lucide-react'
import { MetricSparkline } from '@/components/perf/MetricSparkline'
import { QuickTelemetryChart } from '@/components/perf/QuickTelemetryChart'
import { useQuickTelemetry } from '@/hooks/useQuickTelemetry'
import { formatBytes, NO_VALUE } from '@/lib/utils'

// Home's live cards read telemetry themselves: a new sample re-renders these
// three components, not the whole dashboard. They take no props, so memo also
// keeps the dashboard's own re-renders (Game Mode's 1 s timer) from reaching them.

export const CpuCard = memo(function CpuCard() {
  const { t: tx } = useTranslation('experience')
  const { current: perf, samples } = useQuickTelemetry()
  const cpuPct = perf?.cpuPercent ?? 0
  return (
    <section className="pulse-card pulse-cpu">
      <div className="pulse-metric">
        <div className="pulse-card-heading">
          <h2>{tx('home.cpu')}</h2>
          <Cpu size={19} />
        </div>
        <div className="pulse-big-value">
          {perf ? Math.round(cpuPct) : NO_VALUE}
          <small>{perf ? '%' : ''}</small>
        </div>
        <MetricSparkline samples={samples} metric="cpu" label={tx('home.cpu')} />
        <p>{perf ? tx(cpuPct >= 70 ? 'home.loadHigh' : 'home.loadLow') : tx('home.unavailable')}</p>
      </div>
    </section>
  )
})

export const MemoryCard = memo(function MemoryCard() {
  const { t: tx } = useTranslation('experience')
  const { current: perf, samples } = useQuickTelemetry()
  const ramPct = perf?.memPercent ?? 0
  return (
    <section className="pulse-card pulse-memory">
      <div className="pulse-metric">
        <div className="pulse-card-heading">
          <h2>{tx('home.memory')}</h2>
          <MemoryStick size={20} />
        </div>
        <div className="pulse-big-value">
          {perf ? formatBytes(perf.memUsedBytes) : NO_VALUE}
          <small>{perf ? ' / ' + formatBytes(perf.memTotalBytes) : ''}</small>
        </div>
        <MetricSparkline samples={samples} metric="memory" label={tx('home.memory')} />
        <p>
          {tx(!perf ? 'home.memoryUnknown' : ramPct >= 80 ? 'home.memoryBusy' : 'home.memoryRoom')}
        </p>
        <span className="pulse-live-label">
          {perf ? tx('home.used', { percent: Math.round(ramPct) }) : tx('home.unavailable')}
        </span>
      </div>
    </section>
  )
})

export const TelemetryPanel = memo(function TelemetryPanel() {
  const { t } = useTranslation('dashboard')
  const { t: tx } = useTranslation('experience')
  const navigate = useNavigate()
  const { current: perf, samples } = useQuickTelemetry()
  return (
    <section className="pulse-card pulse-home-telemetry">
      <div className="pulse-card-heading">
        <div>
          <h2>{tx('home.telemetry')}</h2>
          <p>{tx('home.telemetryDescription')}</p>
        </div>
        <Activity size={18} />
      </div>
      <div className="pulse-chart-legend">
        <span>
          <i />
          {tx('home.cpu')}
          <b>{perf ? Math.round(perf.cpuPercent) + '%' : NO_VALUE}</b>
        </span>
        <span>
          <i />
          {t('glanceMemory')}
          <b>{perf ? Math.round(perf.memPercent) + '%' : NO_VALUE}</b>
        </span>
      </div>
      <QuickTelemetryChart samples={samples} />
      <button className="pulse-text-button" onClick={() => navigate('/performance')}>
        {tx('home.telemetryAction')}
        <ArrowRight size={15} />
      </button>
    </section>
  )
})
