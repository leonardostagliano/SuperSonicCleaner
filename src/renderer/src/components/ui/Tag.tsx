import type { ReactNode } from 'react'

export type TagTone = 'recommended' | 'ok' | 'danger' | 'neutral'

export interface TagProps {
  /** 'recommended' (amber) only for what the app recommends, 'ok' (green) only for a
   *  verified result, 'danger' (red) only for errors, threats and irreversible actions. */
  tone: TagTone
  children: ReactNode
}

/** A short coloured label in the text flow ("Consigliato", "Aggiornato"); no pill, no fill. */
export function Tag({ tone, children }: TagProps) {
  return (
    <span className="ui-tag" data-tone={tone}>
      {children}
    </span>
  )
}
