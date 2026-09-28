import { createElement, useId, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type CardElement = 'div' | 'section' | 'article' | 'li'

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: CardElement
  className?: string
  children: ReactNode
}

/** One flat card per section: 1 px border, 10 px radius, no shadow. */
export function Card({ as = 'div', className, children, ...rest }: CardProps) {
  return createElement(as, { ...rest, className: cn('ui-card', className) }, children)
}

export interface SectionProps {
  title: string
  /** Provenance or a count, 12 px, on the right ("letto 2 s fa", "2 da eseguire"). */
  meta?: ReactNode
  /** 'recommended' paints the meta amber: only for what the app recommends doing. */
  metaTone?: 'neutral' | 'recommended'
  actions?: ReactNode
  className?: string
  children: ReactNode
  id?: string
}

/** A Card with a header row: title (15 px, 600) left, meta and actions right. */
export function Section({
  title,
  meta,
  metaTone = 'neutral',
  actions,
  className,
  children,
  id
}: SectionProps) {
  const headingId = useId()
  const showMeta = meta !== undefined && meta !== null && meta !== false && meta !== ''
  const showActions = actions !== undefined && actions !== null && actions !== false
  return (
    <Card as="section" id={id} aria-labelledby={headingId} className={cn('ui-section', className)}>
      <div className="ui-section-head">
        <h2 id={headingId} className="ui-section-title">
          {title}
        </h2>
        {(showMeta || showActions) && (
          <div className="ui-section-aside">
            {showMeta && (
              <span className="ui-section-meta" data-tone={metaTone}>
                {meta}
              </span>
            )}
            {showActions && actions}
          </div>
        )}
      </div>
      {children}
    </Card>
  )
}
