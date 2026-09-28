import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'

interface ConfirmDialogProps {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
  /** The question with the quantity ("Eliminare 1.512 file (2,34 GB)?"). */
  title: string
  /** What is affected and the limits ("Non è reversibile: …"). */
  description: string
  /** Repeats the action ("Elimina 2,34 GB"), never "OK" or "Conferma". */
  confirmLabel?: string
  /** 'danger' only for irreversible actions. 'warning' is accepted and rendered as 'default'. */
  variant?: 'default' | 'danger' | 'warning'
  /** A scrollable monospace list (paths, names). */
  details?: string
}

export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  description,
  confirmLabel,
  variant = 'default',
  details
}: ConfirmDialogProps) {
  const { t } = useTranslation('common')
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  // Track the element that had focus before the dialog opened
  const previousFocusRef = useRef<HTMLElement | null>(null)

  // Focus trap and keyboard handling
  useEffect(() => {
    if (!open) return

    previousFocusRef.current = document.activeElement as HTMLElement | null

    const dialog = dialogRef.current
    if (!dialog) return

    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    first?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancelRef.current()
        return
      }
      if (e.key !== 'Tab') return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocusRef.current?.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <div className="ui-dialog-layer">
      <div className="ui-dialog-scrim" onClick={onCancel} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="ui-dialog"
        data-variant={variant === 'danger' ? 'danger' : 'default'}
      >
        <h2 id={titleId} className="ui-dialog-title">
          {title}
        </h2>
        <p id={descriptionId} className="ui-dialog-body">
          {description}
        </p>
        {details && <p className="ui-dialog-details">{details}</p>}
        <div className="ui-dialog-actions">
          <Button variant="ghost" onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button variant={variant === 'danger' ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel ?? t('confirm')}
          </Button>
        </div>
      </div>
    </div>
  )
}
