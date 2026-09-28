import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Card, Section } from '@/components/ui/Card'
import { cn } from '@/lib/utils'

export interface EmptyStateCheck {
  title: string
  detail: string
}

export interface EmptyStateProps {
  /** The real state ("Non ancora analizzato"), never a positive result before a scan. */
  title: string
  /** The last result or one scope line. */
  description?: string
  /** "Cosa viene controllato": three columns from 900 px, one below. */
  checks?: EmptyStateCheck[]
  action?: ReactNode
  /** Optional, 24 px, neutral. */
  icon?: LucideIcon
  className?: string
}

/** A low flat card (at most 200 px without `checks`): state, last result, one action. */
export function EmptyState({
  title,
  description,
  checks,
  action,
  icon: Icon,
  className
}: EmptyStateProps) {
  const { t } = useTranslation('common')
  return (
    <div className={cn('ui-empty', className)}>
      <Card className="ui-empty-status">
        {Icon && <Icon className="ui-empty-icon" size={24} strokeWidth={1.75} aria-hidden="true" />}
        <div className="ui-empty-text">
          <h2 className="ui-empty-title">{title}</h2>
          {description && <p className="ui-empty-description">{description}</p>}
        </div>
        {action && <div className="ui-empty-action">{action}</div>}
      </Card>
      {checks && checks.length > 0 && (
        <Section title={t('whatIsChecked')}>
          <ul className="ui-empty-checks">
            {checks.map((check) => (
              <li key={check.title} className="ui-empty-check">
                <span className="ui-empty-check-title">{check.title}</span>
                <span className="ui-empty-check-detail">{check.detail}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
