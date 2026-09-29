import type { ReactNode } from 'react'
import { AlertTriangle, Info, X, type LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import './storage.css'

/** The number that matters, one line of facts and the action that uses it. */
export function SummaryCard({
  value,
  facts,
  actions
}: {
  value: string
  facts?: string
  actions?: ReactNode
}) {
  return (
    <Card className="storage-summary">
      <div className="storage-summary-text">
        <p className="storage-summary-value">{value}</p>
        {facts && <p className="storage-summary-facts">{facts}</p>}
      </div>
      {actions && <div className="storage-summary-actions">{actions}</div>}
    </Card>
  )
}

/** A neutral note with an icon: a limit or a partial result, never a recommendation. */
export function InlineNote({
  children,
  tone = 'note'
}: {
  children: ReactNode
  tone?: 'note' | 'warning'
}) {
  const Icon = tone === 'warning' ? AlertTriangle : Info
  return (
    <p className="storage-note">
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

/** An error the user can dismiss; red is for errors only. */
export function ErrorCard({
  message,
  dismissLabel,
  onDismiss
}: {
  message: string
  dismissLabel: string
  onDismiss?: () => void
}) {
  return (
    <Card className="storage-error" role="alert">
      <AlertTriangle size={16} strokeWidth={1.75} aria-hidden="true" />
      <p className="storage-error-text">{message}</p>
      {onDismiss && <RowAction icon={X} label={dismissLabel} onClick={onDismiss} />}
    </Card>
  )
}

/** A 24 px icon-only action inside a row ("Mostra nella cartella"). */
export function RowAction({
  icon: Icon,
  label,
  onClick,
  disabled
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="storage-icon-action"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
    </button>
  )
}
