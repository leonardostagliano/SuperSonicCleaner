import { useEffect, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pause, Play } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { GaugeCard } from '@/components/perf/GaugeCard'
import { SystemInfoHeader } from '@/components/perf/SystemInfoHeader'
import { TimeSeriesChart } from '@/components/perf/TimeSeriesChart'
import { AlertBanner } from '@/components/perf/AlertBanner'
import { DiskHealthPanel } from '@/components/perf/DiskHealthPanel'
import { ProcessTable } from '@/components/perf/ProcessTable'
import { acquirePerfMonitoring, setPerfMonitoringPaused, usePerfStore } from '@/stores/perf-store'
import { formatBytes, formatSpeed, NO_VALUE } from '@/lib/utils'
import { cn } from '@/lib/utils'

export function PerformanceMonitorPage() {
  const { t } = useTranslation('performance')
  const systemInfo = usePerfStore((s) => s.systemInfo)
  const snapshot = usePerfStore((s) => s.currentSnapshot)
  const history = usePerfStore((s) => s.history)
  const timeRange = usePerfStore((s) => s.timeRange)
  const setSystemInfo = usePerfStore((s) => s.setSystemInfo)
  const diskHealth = usePerfStore((s) => s.diskHealth)
  const setDiskHealth = usePerfStore((s) => s.setDiskHealth)
  const setTimeRange = usePerfStore((s) => s.setTimeRange)
  // From the lifecycle, so a failed start or a hidden window can't leave the button wrong
  const paused = usePerfStore((s) => s.monitoringPaused)

  const [diskHealthLoading, setDiskHealthLoading] = useState(true)

  // Live data first; disk health (SMART, several seconds) loads beside it
  useEffect(() => {
    const release = acquirePerfMonitoring(() => toast.error(t('failedToStartToast')))
    window.kudu
      .perfGetSystemInfo()
      .then(setSystemInfo)
      .catch(() => {})
    window.kudu
      .perfGetDiskHealth()
      .then(setDiskHealth)
      .catch(() => {})
      .finally(() => setDiskHealthLoading(false))
    return release
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const togglePause = useCallback(() => setPerfMonitoringPaused(!paused), [paused])

  const timeRangeOptions: Array<{ value: '60s' | '5m' | '15m'; label: string }> = [
    { value: '60s', label: '1m' },
    { value: '5m', label: '5m' },
    { value: '15m', label: '15m' }
  ]

  return (
    <div className="feature-page performance-page mx-auto max-w-[1320px]">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <>
            {/* Time range pills */}
            <div
              className="flex rounded-lg p-0.5"
              style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)' }}
            >
              {timeRangeOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTimeRange(opt.value)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-[11px] font-semibold transition',
                    timeRange === opt.value ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-300'
                  )}
                  style={
                    timeRange === opt.value ? { background: 'rgba(245,158,11,0.1)' } : undefined
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Pause/Resume */}
            <button
              onClick={togglePause}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors"
              style={{
                background: paused ? 'rgba(34,197,94,0.1)' : 'var(--bg-subtle-2)',
                color: paused ? '#22c55e' : 'var(--text-secondary)',
                border: `1px solid ${paused ? 'rgba(34,197,94,0.2)' : 'var(--border-medium)'}`
              }}
            >
              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              {paused ? t('resume') : t('pause')}
            </button>
          </>
        }
      />

      <SystemInfoHeader info={systemInfo} uptime={snapshot?.uptime ?? 0} />

      <AlertBanner snapshot={snapshot} history={history} />

      {/* Gauges */}
      <div className="pulse-performance-metrics">
        <GaugeCard
          label={t('gaugeCpu')}
          percent={snapshot?.cpu.overall ?? null}
          detail={
            snapshot ? t('cpuThreadsDetail', { count: snapshot.cpu.perCore.length }) : NO_VALUE
          }
        />
        <GaugeCard
          label={t('gaugeMemory')}
          percent={snapshot?.memory.percent ?? null}
          detail={
            snapshot
              ? `${formatBytes(snapshot.memory.usedBytes)} / ${formatBytes(snapshot.memory.totalBytes)}`
              : NO_VALUE
          }
        />
        <GaugeCard
          label={t('gaugeDiskIo')}
          percent={null}
          value={
            snapshot && snapshot.disk.available !== false
              ? formatSpeed(snapshot.disk.readBytesPerSec + snapshot.disk.writeBytesPerSec)
              : NO_VALUE
          }
          detail={
            snapshot && snapshot.disk.available !== false
              ? t('diskIoDetail', {
                  read: formatSpeed(snapshot.disk.readBytesPerSec),
                  write: formatSpeed(snapshot.disk.writeBytesPerSec)
                })
              : NO_VALUE
          }
        />
        <GaugeCard
          label={t('gaugeNetwork')}
          percent={null}
          value={
            snapshot
              ? formatSpeed(snapshot.network.rxBytesPerSec + snapshot.network.txBytesPerSec)
              : NO_VALUE
          }
          detail={
            snapshot
              ? `${formatSpeed(snapshot.network.rxBytesPerSec)} / ${formatSpeed(snapshot.network.txBytesPerSec)}`
              : NO_VALUE
          }
        />
      </div>

      {/* Charts */}
      <div className="pulse-performance-charts">
        <TimeSeriesChart
          history={history}
          timeRange={timeRange}
          dataKey="cpu"
          label={t('chartCpuUsage')}
          color="var(--accent)"
        />
        <TimeSeriesChart
          history={history}
          timeRange={timeRange}
          dataKey="memory"
          label={t('chartMemoryUsage')}
          color="var(--success)"
        />
        <TimeSeriesChart
          history={history}
          timeRange={timeRange}
          dataKey="disk"
          label={t('chartDiskIo')}
          color="var(--info)"
        />
      </div>

      {/* Disk Health */}
      <DiskHealthPanel disks={diskHealth} loading={diskHealthLoading} />

      {/* Process Table */}
      <ProcessTable />
    </div>
  )
}
