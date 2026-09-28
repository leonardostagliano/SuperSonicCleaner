import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Hourglass, LoaderCircle, type LucideIcon } from 'lucide-react'
import { useReducedMotion } from '@/hooks/useReducedMotion'
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
  /** Disables the button and sets aria-busy. A busy glyph (spinning, or a static hourglass
   *  under reduced motion) takes the icon's place, or joins the label at 12 px when there
   *  is no icon. The label stays visible and the width does not change. */
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
  const reducedMotion = useReducedMotion()
  const labelled = hasContent(children)
  // Without an icon slot the glyph shares the label's line: 12 px + a 4 px gap fit in the
  // side padding it replaces (ui.css, [data-inline-busy]).
  const inlineBusy = busy && !Icon && labelled
  const BusyGlyph = reducedMotion ? Hourglass : LoaderCircle
  const glyph = busy ? (
    <BusyGlyph
      className={cn('ui-button-icon', !reducedMotion && 'ui-spin')}
      size={inlineBusy ? 12 : 16}
      strokeWidth={1.75}
      aria-hidden="true"
    />
  ) : Icon ? (
    <Icon className="ui-button-icon" size={16} strokeWidth={1.75} aria-hidden="true" />
  ) : null
  return (
    <button
      ref={ref}
      type={type}
      className={cn('ui-button', className)}
      data-variant={variant}
      data-size={size}
      data-icon-only={labelled ? undefined : ''}
      data-inline-busy={inlineBusy ? '' : undefined}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {glyph}
      {labelled && <span className="ui-button-label">{children}</span>}
    </button>
  )
})
