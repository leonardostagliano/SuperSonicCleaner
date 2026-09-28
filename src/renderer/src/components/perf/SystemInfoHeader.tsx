import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/Card'
import { formatBytes } from '@/lib/utils'
import type { PerfSystemInfo } from '@shared/types'
import { uptimeParts } from './perf-summary'

interface SystemInfoHeaderProps {
  info: PerfSystemInfo | null
  uptime: number
  /** System info is still being read (the header keeps its slots empty meanwhile). */
  loading?: boolean
}

const NBSP = '\u00a0'

/**
 * Every value slot reserves a typical width (perf.css, `data-slot`): a Windows CPU model
 * and OS version, the core count, a memory size and a days-hours-minutes uptime. Empty
 * slots and real values take the same room, so the header wraps into the same rows
 * before and after its data arrives and nothing below it moves.
 */
export function SystemInfoHeader({ info, uptime, loading = false }: SystemInfoHeaderProps) {
  const { t } = useTranslation('performance')
  // Nothing to wait for any more: say so instead of leaving the slot blank.
  const missing = loading ? NBSP : t('systemInfoUnavailable')
  const { days, hours, minutes } = uptimeParts(uptime)
  const uptimeText =
    uptime <= 0
      ? NBSP
      : days > 0
        ? t('uptimeDays', { days, hours, minutes })
        : hours > 0
          ? t('uptimeHours', { hours, minutes })
          : t('uptimeMinutes', { minutes })

  const items = [
    {
      slot: 'cpu',
      label: t('systemInfoCpu'),
      value: info?.cpuModel || missing,
      sub: info ? t('systemInfoCores', { cores: info.cpuCores, threads: info.cpuThreads }) : NBSP
    },
    {
      slot: 'memory',
      label: t('systemInfoMemory'),
      value: info ? formatBytes(info.totalMemBytes) : missing
    },
    { slot: 'os', label: t('systemInfoOs'), value: info?.osVersion || missing },
    { slot: 'uptime', label: t('systemInfoUptime'), value: uptimeText }
  ]

  return (
    <Card
      className="perf-system-info"
      aria-label={t('systemInfoLabel')}
      aria-busy={!info && loading}
      data-system-info-header
    >
      <dl>
        {items.map((item) => (
          <div key={item.slot}>
            <dt>{item.label}</dt>
            <dd data-slot={item.slot}>{item.value}</dd>
            {item.sub && (
              <dd className="perf-system-sub" data-slot={`${item.slot}-sub`}>
                {item.sub}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </Card>
  )
}
