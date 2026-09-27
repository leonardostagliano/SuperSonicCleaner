import { create } from 'zustand'
import type { DriveInfo } from '@shared/types'

type DriveStatus = 'idle' | 'loading' | 'ready' | 'unavailable'

interface DrivesState {
  drives: DriveInfo[]
  status: DriveStatus
  /** Revalidate in the background; the last known drives stay on screen. */
  refresh: () => Promise<void>
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
  refresh: () => {
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
        const list = (await window.kudu?.diskDrives?.()) ?? []
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
