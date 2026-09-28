import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { LoaderCircle, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Default 'secondary'. At most one 'primary' per view; 'danger' only inside the
   *  confirmation of an irreversible action. Never amber. */
  variant?: ButtonVariant
  /** 'md' is 32 px high, 'lg' 36 px. */
  size?: ButtonSize
  /** 16 px, stroke 1.75, before the label. */
  icon?: LucideIcon
  /** A spinner replaces the icon (or covers the label when there is none), the width
   *  stays the same and the button is disabled. */
  busy?: boolean
}

const hasContent = (node: unknown) =>
  node !== undefined && node !== null && node !== false && node !== ''

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon: Icon,
    busy = false,
    disabled,
    type = 'button',
    className,
    children,
    ...rest
  },
  ref
) {
  const labelled = hasContent(children)
  const spinner = (overlay: boolean) => (
    <LoaderCircle
      className={cn('ui-button-icon ui-spin', overlay && 'ui-button-spinner-overlay')}
      size={16}
      strokeWidth={1.75}
      aria-hidden="true"
    />
  )
  return (
    <button
      ref={ref}
      type={type}
      className={cn('ui-button', className)}
      data-variant={variant}
      data-size={size}
      data-icon-only={labelled ? undefined : ''}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {Icon &&
        (busy ? (
          spinner(false)
        ) : (
          <Icon className="ui-button-icon" size={16} strokeWidth={1.75} aria-hidden="true" />
        ))}
      {labelled && (
        <span className={cn('ui-button-label', busy && !Icon && 'ui-button-label-busy')}>
          {children}
        </span>
      )}
      {busy && !Icon && spinner(labelled)}
    </button>
  )
})
