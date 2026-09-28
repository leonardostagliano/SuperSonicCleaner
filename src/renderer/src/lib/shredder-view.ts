import type { ShredderEntry } from '@shared/types'

export type ShredReasonKey = 'protected' | 'changed' | 'cancelled' | 'unverified'

/**
 * The fixed reasons the shredder in the main process gives for a file it did not destroy
 * (file-shredder.ipc.ts). Anything else is an operating-system error shown as it is.
 */
const KNOWN_REASONS: [prefix: string, key: ShredReasonKey][] = [
  ['Protected system path', 'protected'],
  ['File changed while being shredded', 'changed'],
  ['Cancelled before the overwrite finished', 'cancelled'],
  ['File was not verified during collection', 'unverified']
]

/** The translation key for a known reason, or null for an OS error message. */
export function shredReasonKey(reason: string): ShredReasonKey | null {
  const hit = KNOWN_REASONS.find(([prefix]) => reason.startsWith(prefix))
  return hit ? hit[1] : null
}

export interface ShredderTotals {
  bytes: number
  files: number
  folders: number
}

/** What the list holds: total size, and how many entries are files or folders. */
export function shredderTotals(entries: ShredderEntry[]): ShredderTotals {
  let bytes = 0
  let folders = 0
  for (const entry of entries) {
    bytes += entry.size
    if (entry.isDirectory) folders++
  }
  return { bytes, files: entries.length - folders, folders }
}
