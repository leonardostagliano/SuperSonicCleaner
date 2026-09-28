import { create } from 'zustand'
import type { DriveInfo } from '@shared/types'

type DriveStatus = 'idle' | 'loading' | 'ready' | 'unavailable'

interface DrivesState {
  drives: DriveInfo[]
  status: DriveStatus
  /** Revalidate in the background; the last known drives stay on screen. */
  refresh: (options?: { fresh?: boolean }) => Promise<void>
}

/** Fresh system-drive numbers win over a cached list; the list keeps its label. */
export function mergeSystemDrive(drives: DriveInfo[], system: DriveInfo): DriveInfo[] {
  if (!drives.some((d) => d.isSystem)) return [system, ...drives]
  return drives.map((d) => (d.isSystem ? { ...system, label: d.label || system.label } : d))
}

let inFlight: Promise<void> | null = null

export const useDrivesStore = create<DrivesState>((set, get) => ({
  drives: [],
  status: 'idle',
  refresh: (options) => {
    // A `fresh` request that lands while a normal refresh is in flight is chained
    // after it (instead of being de-duplicated away) so it still forces a reload.
    if (options?.fresh && inFlight) return inFlight.then(() => get().refresh(options))
    inFlight ??= (async () => {
      if (get().drives.length === 0) set({ status: 'loading' })
      let system: DriveInfo | null = null
      try {
        system = (await window.kudu?.diskSystemDrive?.()) ?? null
        if (system) {
          const fresh = system
          set((s) => ({ drives: mergeSystemDrive(s.drives, fresh), status: 'ready' }))
        }
      } catch {
        // The full list below still runs
      }
      try {
        const list = (await window.kudu?.diskDrives?.(options)) ?? []
        const drives = system ? mergeSystemDrive(list, system) : list
        set({ drives, status: drives.length > 0 ? 'ready' : 'unavailable' })
      } catch {
        set((s) => ({ status: s.drives.length > 0 ? 'ready' : 'unavailable' }))
      }
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }
}))

/**
 * After a deletion from a storage tool: only a permanent deletion frees space on the
 * drive, so only then are the drives read again, bypassing the cache.
 */
export function refreshDrivesAfterDelete(
  mode: 'recycle' | 'permanent',
  deleted: number
): Promise<void> {
  if (mode !== 'permanent' || deleted <= 0) return Promise.resolve()
  return useDrivesStore.getState().refresh({ fresh: true })
}
