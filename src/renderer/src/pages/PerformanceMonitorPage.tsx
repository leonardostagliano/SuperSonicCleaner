import { useEffect, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pause, Play } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { GaugeCard } from '@/components/perf/GaugeCard'
import { SystemInfoHeader } from '@/components/perf/SystemInfoHeader'
import { TimeSeriesChart } from '@/components/perf/TimeSeriesChart'
import { DiskHealthPanel } from '@/components/perf/DiskHealthPanel'
import { ProcessTable } from '@/components/perf/ProcessTable'
import {
  diskRateState,
  formatClock,
  formatPercent,
  loadAlerts
} from '@/components/perf/perf-summary'
import '@/components/perf/perf.css'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Card'
import { Segmented } from '@/components/ui/Segmented'
import { icons } from '@/lib/icons'
import { acquirePerfMonitoring, setPerfMonitoringPaused, usePerfStore } from '@/stores/perf-store'
import { formatBytes, formatSpeed } from '@/lib/utils'

type TimeRange = '60s' | '5m' | '15m'
const Warning = icons.warning

export function PerformanceMonitorPage() {
  const { t, i18n } = useTranslation('performance')
  const locale = i18n.language
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
  const [systemInfoLoading, setSystemInfoLoading] = useState(true)

  // Live data first; disk health (SMART, several seconds) loads beside it
  useEffect(() => {
    const release = acquirePerfMonitoring(() => toast.error(t('failedToStartToast')))
    window.kudu
      .perfGetSystemInfo()
      .then(setSystemInfo)
      .catch(() => {})
      .finally(() => setSystemInfoLoading(false))
    window.kudu
      .perfGetDiskHealth()
      .then(setDiskHealth)
      .catch(() => {})
      .finally(() => setDiskHealthLoading(false))
    return release
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const togglePause = useCallback(() => setPerfMonitoringPaused(!paused), [paused])

  const timeRangeOptions: { value: TimeRange; label: string }[] = [
    { value: '60s', label: t('timeRange1m') },
    { value: '5m', label: t('timeRange5m') },
    { value: '15m', label: t('timeRange15m') }
  ]

  // Warnings about load are not errors: an icon and neutral text in the section header,
  // where they take no room from the gauges (nothing below moves when one appears).
  const alerts = paused ? [] : loadAlerts(snapshot, history)
  const resourcesMeta = paused ? (
    snapshot ? (
      t('pausedMeta', { time: formatClock(snapshot.timestamp, locale) })
    ) : (
      t('pausedMetaNoSample')
    )
  ) : alerts.length > 0 ? (
    <span className="perf-alert" role="status">
      <Warning size={14} strokeWidth={1.75} aria-hidden="true" />
      <span>
        {alerts
          .map((alert) =>
            alert.id === 'cpu-high'
              ? t('cpuHighAlert')
              : t('memoryHighAlert', { percent: formatPercent(alert.percent, locale) })
          )
          .join(' ')}
      </span>
    </span>
  ) : (
    t('resourcesMeta')
  )

  const diskState = diskRateState(snapshot, history)
  const diskMeasured = !!snapshot && diskState === 'measured'
  const diskUnavailable = diskState === 'unavailable' ? t('diskIoUnavailable') : undefined

  return (
    <div className="feature-page performance-page mx-auto max-w-[1320px]">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <Button icon={paused ? Play : Pause} onClick={togglePause}>
            {paused ? t('resume') : t('pause')}
          </Button>
        }
      />

      <div className="perf-stack">
        <SystemInfoHeader
          info={systemInfo}
          uptime={snapshot?.uptime ?? 0}
          loading={systemInfoLoading}
        />

        <Section title={t('resourcesTitle')} meta={resourcesMeta} className="perf-resources">
          <div className="perf-gauges">
            <GaugeCard
              label={t('gaugeCpu')}
              percent={snapshot?.cpu.overall ?? null}
              detail={
                snapshot ? t('cpuThreadsDetail', { count: snapshot.cpu.perCore.length }) : undefined
              }
            />
            <GaugeCard
              label={t('gaugeMemory')}
              percent={snapshot?.memory.percent ?? null}
              detail={
                snapshot
                  ? t('memoryDetail', {
                      used: formatBytes(snapshot.memory.usedBytes),
                      total: formatBytes(snapshot.memory.totalBytes)
                    })
                  : undefined
              }
            />
            <GaugeCard
              label={t('gaugeDiskIo')}
              value={
                diskMeasured
                  ? formatSpeed(snapshot.disk.readBytesPerSec + snapshot.disk.writeBytesPerSec)
                  : null
              }
              detail={
                diskMeasured
                  ? t('diskIoDetail', {
                      read: formatSpeed(snapshot.disk.readBytesPerSec),
                      write: formatSpeed(snapshot.disk.writeBytesPerSec)
                    })
                  : undefined
              }
              note={diskUnavailable}
            />
            <GaugeCard
              label={t('gaugeNetwork')}
              value={
                snapshot
                  ? formatSpeed(snapshot.network.rxBytesPerSec + snapshot.network.txBytesPerSec)
                  : null
              }
              detail={
                snapshot
                  ? t('networkDetail', {
                      rx: formatSpeed(snapshot.network.rxBytesPerSec),
                      tx: formatSpeed(snapshot.network.txBytesPerSec)
                    })
                  : undefined
              }
            />
          </div>
        </Section>

        <Section
          title={t('trendTitle')}
          className="perf-trend"
          actions={
            <Segmented
              options={timeRangeOptions}
              value={timeRange}
              onChange={setTimeRange}
              label={t('timeRangeLabel')}
            />
          }
        >
          <div className="perf-charts">
            <TimeSeriesChart
              history={history}
              timeRange={timeRange}
              dataKey="cpu"
              label={t('chartCpuUsage')}
            />
            <TimeSeriesChart
              history={history}
              timeRange={timeRange}
              dataKey="memory"
              label={t('chartMemoryUsage')}
            />
            <TimeSeriesChart
              history={history}
              timeRange={timeRange}
              dataKey="disk"
              label={t('chartDiskIo')}
              unavailable={diskUnavailable && t('chartDiskUnavailable')}
            />
          </div>
        </Section>

        <ProcessTable />

        <DiskHealthPanel disks={diskHealth} loading={diskHealthLoading} />
      </div>
    </div>
  )
}
