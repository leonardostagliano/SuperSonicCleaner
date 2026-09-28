import { useTranslation } from 'react-i18next'
import { Cpu, MemoryStick, Monitor, Clock } from 'lucide-react'
import { formatBytes, NO_VALUE } from '@/lib/utils'
import type { PerfSystemInfo } from '@shared/types'

interface SystemInfoHeaderProps {
  info: PerfSystemInfo | null
  uptime: number
  /** System info is still being read (the header shows placeholders meanwhile). */
  loading?: boolean
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const NBSP = String.fromCharCode(0xa0)

/**
 * Typical value widths (a Windows CPU model and OS version string, a memory size,
 * a days-hours-minutes uptime). Placeholders and real values both reserve them,
 * so the header wraps into the same rows before and after its data arrives and
 * nothing below it moves.
 */
const VALUE_WIDTH = {
  cpu: '26.5ch',
  cores: '7.5ch',
  memory: '6.5ch',
  os: '30.5ch',
  uptime: '10.5ch'
}

export function SystemInfoHeader({ info, uptime, loading = false }: SystemInfoHeaderProps) {
  const { t } = useTranslation('performance')

  const items = [
    {
      icon: Cpu,
      label: t('systemInfoCpu'),
      value: info?.cpuModel,
      width: VALUE_WIDTH.cpu,
      // A no-break space keeps the slot's line box while the core count is unknown
      sub: info ? `${info.cpuCores}C / ${info.cpuThreads}T` : NBSP,
      subWidth: VALUE_WIDTH.cores
    },
    {
      icon: MemoryStick,
      label: t('systemInfoMemory'),
      value: info ? formatBytes(info.totalMemBytes) : undefined,
      width: VALUE_WIDTH.memory
    },
    { icon: Monitor, label: t('systemInfoOs'), value: info?.osVersion, width: VALUE_WIDTH.os },
    {
      icon: Clock,
      label: t('systemInfoUptime'),
      value: uptime > 0 ? formatUptime(uptime) : undefined,
      width: VALUE_WIDTH.uptime
    }
  ]

  return (
    <div
      className="mb-6 flex flex-wrap gap-4 rounded-2xl p-4"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
      aria-busy={!info && loading}
      data-system-info-header
    >
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-3 px-2">
          <item.icon
            className="h-4 w-4 shrink-0"
            style={{ color: 'var(--text-muted)' }}
            strokeWidth={1.8}
          />
          <div className="flex items-baseline gap-2">
            <span
              className="text-[11px] font-medium uppercase tracking-wider"
              style={{ color: 'var(--text-muted)' }}
            >
              {item.label}
            </span>
            <span
              className="text-[12px] font-medium text-zinc-300"
              style={{ minWidth: item.width }}
            >
              {item.value ?? NO_VALUE}
            </span>
            {item.sub && (
              <span
                className="text-[11px]"
                style={{ color: 'var(--text-muted)', minWidth: item.subWidth }}
              >
                {item.sub}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
