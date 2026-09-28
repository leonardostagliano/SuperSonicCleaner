import type { ReactNode } from 'react'
import { Card } from '@/components/ui/Card'

export interface ReceiptProps {
  /** What happened ("Pulizia completata"), without an exclamation mark. */
  title: string
  /** The number that matters ("2,31 GB liberati"). */
  value?: string
  /** Counts, date and reversibility, joined with " · ". */
  facts: string[]
  /** What was skipped and why ("110 file saltati perché in uso (29 MB)"). */
  skipped?: string
  /** "Dettagli · Apri in Cronologia" */
  links?: ReactNode
  /** One line for lists such as the Home activity; phrasing content only, so it fits in a button. */
  compact?: boolean
}

const FACT_SEPARATOR = ' · '

/** The result of an operation: a factual record in place of "…completata!". */
export function Receipt({ title, value, facts, skipped, links, compact = false }: ReceiptProps) {
  const factLine = facts.filter(Boolean).join(FACT_SEPARATOR)
  if (compact) {
    return (
      <span className="ui-receipt" data-compact="">
        <span className="ui-receipt-title">{title}</span>
        {factLine && <span className="ui-receipt-facts">{factLine}</span>}
        {value && <span className="ui-receipt-value">{value}</span>}
      </span>
    )
  }
  const hasLinks = links !== undefined && links !== null && links !== false
  return (
    <Card as="article" className="ui-receipt">
      <h2 className="ui-receipt-title">{title}</h2>
      {value && <p className="ui-receipt-value">{value}</p>}
      {factLine && <p className="ui-receipt-facts">{factLine}</p>}
      {(skipped || hasLinks) && (
        <p className="ui-receipt-note">
          {skipped}
          {skipped && hasLinks && ' '}
          {hasLinks && <span className="ui-receipt-links">{links}</span>}
        </p>
      )}
    </Card>
  )
}
