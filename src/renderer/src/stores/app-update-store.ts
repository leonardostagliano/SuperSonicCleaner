import { create } from 'zustand'
import type { UpdateStatus } from '@shared/types'

interface AppUpdateStore {
  status: UpdateStatus
  pending: boolean
  dismissedVersion: string | null
  setStatus: (status: UpdateStatus) => void
  dismiss: () => void
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
  init: () => () => void
}

export const useAppUpdateStore = create<AppUpdateStore>((set, get) => {
  const perform = async (action: 'updaterCheck' | 'updaterDownload' | 'updaterInstall') => {
    if (get().pending) return
    set({ pending: true })
    try {
      await window.kudu[action]()
    } catch (error) {
      set({
        status: {
          ...get().status,
          state: 'error',
          error: error instanceof Error ? error.message : String(error)
        }
      })
    } finally {
      set({ pending: false })
    }
  }

  return {
    status: { state: 'idle' },
    pending: false,
    dismissedVersion: null,
    setStatus: (status) => set({ status }),
    dismiss: () => set({ dismissedVersion: get().status.version ?? null }),
    check: () => perform('updaterCheck'),
    download: () => perform('updaterDownload'),
    install: () => perform('updaterInstall'),
    init: () => {
      let active = true
      let receivedEvent = false
      // Fetch current status
      window.kudu
        ?.updaterGetStatus?.()
        .then((status) => {
          if (active && !receivedEvent) set({ status })
        })
        .catch(() => {})
      // Listen for live updates
      const unsub = window.kudu?.onUpdaterStatus?.((status) => {
        receivedEvent = true
        if (active) set({ status })
      })
      return () => {
        active = false
        unsub?.()
      }
    }
  }
})
