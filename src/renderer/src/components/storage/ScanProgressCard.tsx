import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { ProgressBar } from '@/components/ui/ProgressBar'
import type { ScanStage } from './stages'
import './storage.css'

/**
 * A running scan: what it is doing, where, the counts so far and, when the tool has real
 * stages (duplicates), the live stage. The bar is determinate only with a real fraction.
 */
export function ScanProgressCard({
  title,
  path,
  facts,
  value,
  progressLabel,
  stages,
  stagesLabel,
  action
}: {
  title: string
  path?: string
  facts?: string
  /** 0..1; leave it out when the amount of work is unknown. */
  value?: number
  progressLabel: string
  stages?: ScanStage[]
  stagesLabel?: string
  action?: ReactNode
}) {
  return (
    <Card className="storage-progress" aria-busy="true">
      <div className="storage-progress-head">
        <p className="storage-progress-title">{title}</p>
        {action}
      </div>
      <ProgressBar value={value} indeterminate={value === undefined} label={progressLabel} />
      {stages && stages.length > 0 && (
        <ol className="storage-stages" aria-label={stagesLabel}>
          {stages.map((stage) => (
            <li
              key={stage.key}
              data-state={stage.state}
              aria-current={stage.state === 'current' ? 'step' : undefined}
            >
              {stage.state === 'done' && <Check size={12} strokeWidth={2} aria-hidden="true" />}
              {stage.label}
            </li>
          ))}
        </ol>
      )}
      {path && (
        <p className="storage-progress-path" title={path}>
          {path}
        </p>
      )}
      {facts && <p className="storage-progress-facts">{facts}</p>}
    </Card>
  )
}
