import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import type { DiskSmartInfo } from '@shared/types'
import { Section } from '@/components/ui/Card'
import { Tag, type TagTone } from '@/components/ui/Tag'
import { icons } from '@/lib/icons'
import { formatBytes } from '@/lib/utils'
import { diskFacts } from './perf-summary'

interface DiskHealthPanelProps {
  disks: DiskSmartInfo[]
  loading?: boolean
}

/** Green only for a disk that reports itself healthy, red only for a reported failure. */
const STATUS: Record<DiskSmartInfo['healthStatus'], { key: string; tone: TagTone }> = {
  Healthy: { key: 'diskStatusHealthy', tone: 'ok' },
  Caution: { key: 'diskStatusCaution', tone: 'neutral' },
  Bad: { key: 'diskStatusBad', tone: 'danger' },
  Unknown: { key: 'diskStatusUnknown', tone: 'neutral' }
}

const Warning = icons.warning

function DiskRow({ disk }: { disk: DiskSmartInfo }) {
  const { t, i18n } = useTranslation('performance')
  const status = STATUS[disk.healthStatus]
  const summary = t('diskSummary', {
    type: disk.type === 'Unknown' ? t('diskTypeUnknown') : disk.type,
    size: formatBytes(disk.sizeBytes)
  })
  const facts = diskFacts(disk, i18n.language)
  return (
    <li className="perf-disk">
      <span className="perf-disk-name">{disk.model}</span>
      <span className="perf-disk-status">
        {disk.healthStatus === 'Caution' && (
          <Warning size={14} strokeWidth={1.75} aria-hidden="true" />
        )}
        <Tag tone={status.tone}>{t(status.key)}</Tag>
      </span>
      <p className="perf-disk-facts">
        {summary}
        {facts.map((fact) => {
          const text = t(fact.key, fact.params)
          return (
            <Fragment key={fact.key}>
              {' · '}
              {fact.warn ? <strong>{text}</strong> : text}
            </Fragment>
          )
        })}
      </p>
    </li>
  )
}

/** S.M.A.R.T. health per disk: one row each, the reported values in one line. */
export function DiskHealthPanel({ disks, loading }: DiskHealthPanelProps) {
  const { t } = useTranslation('performance')
  const detailed = disks.some(
    (d) => d.temperature !== null || d.powerOnHours !== null || d.remainingLife !== null
  )
  return (
    <Section
      title={t('diskHealthTitle')}
      meta={disks.length > 0 && !detailed ? t('diskHealthAdminHint') : undefined}
    >
      {disks.length === 0 ? (
        <p className="perf-note" role={loading ? 'status' : undefined}>
          {loading ? t('diskHealthLoading') : t('diskHealthNone')}
        </p>
      ) : (
        <ul className="perf-disks">
          {disks.map((disk) => (
            <DiskRow key={disk.device} disk={disk} />
          ))}
        </ul>
      )}
    </Section>
  )
}
