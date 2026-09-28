import type { TFunction } from 'i18next'
import type { ProgressLabel } from '@shared/types'

/**
 * Text for a progress line from the main process: a `ProgressLabel` is translated,
 * a legacy string (not yet moved to keys) is shown as it is, nothing gives ''.
 */
export function progressText(t: TFunction, label: string | ProgressLabel | undefined): string {
  if (!label) return ''
  if (typeof label === 'string') return label
  return t(label.key, label.params ?? {})
}
