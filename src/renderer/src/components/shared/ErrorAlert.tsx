import { AlertTriangle, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/utils'

interface ErrorAlertProps {
  message: string
  onDismiss?: () => void
  className?: string
}

/** An error in a flat card: red icon, readable text, optional dismiss. */
export function ErrorAlert({ message, onDismiss, className }: ErrorAlertProps) {
  const { t } = useTranslation('common')
  return (
    <Card role="alert" className={cn('flex items-center gap-3', className)}>
      <AlertTriangle
        className="shrink-0 text-[var(--signal-danger-text)]"
        size={16}
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <p className="m-0 min-w-0 flex-1 text-[length:var(--text-13)] text-[var(--text-primary)]">
        {message}
      </p>
      {onDismiss && (
        <Button
          variant="ghost"
          icon={X}
          aria-label={t('dismiss')}
          title={t('dismiss')}
          onClick={onDismiss}
        />
      )}
    </Card>
  )
}
