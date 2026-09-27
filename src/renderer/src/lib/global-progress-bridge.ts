import { useContextMenuStore } from '@/stores/context-menu-store'
import { useDebloaterStore } from '@/stores/debloater-store'
import { useDiskMaintenanceStore } from '@/stores/disk-maintenance-store'
import { useDiskStore } from '@/stores/disk-store'
import { useDriverStore } from '@/stores/driver-store'
import { useDuplicateStore } from '@/stores/duplicate-store'
import { useEmptyFolderStore } from '@/stores/empty-folder-store'
import { useFileShredderStore } from '@/stores/file-shredder-store'
import { useFirewallStore } from '@/stores/firewall-store'
import { useLargeFileStore } from '@/stores/large-file-store'
import { useMalwareStore } from '@/stores/malware-store'
import { useRegistryStore } from '@/stores/registry-store'
import { useServiceStore } from '@/stores/service-store'
import { useUninstallerStore } from '@/stores/uninstaller-store'
import { useUpdaterStore } from '@/stores/updater-store'

let references = 0
let disposers: Array<() => void> = []

/** Keep IPC progress in stores while tool pages mount and unmount. */
export function initGlobalProgressBridge(): () => void {
  references++
  if (references === 1 && window.kudu) {
    const api = window.kudu
    disposers = [
      api.onDuplicatesProgress?.((data) => {
        const state = useDuplicateStore.getState()
        if (state.status === 'scanning') state.setProgress(data)
      }),
      api.onLargeFilesProgress?.((data) => {
        const state = useLargeFileStore.getState()
        if (state.status === 'scanning') state.setProgress(data)
      }),
      api.onEmptyFoldersProgress?.((data) => {
        const state = useEmptyFolderStore.getState()
        if (state.status === 'scanning') state.setProgress(data)
      }),
      api.onSoftwareUpdateProgress?.((data) => {
        const state = useUpdaterStore.getState()
        if (state.updating) state.setProgress(data)
      }),
      api.onUninstallerProgress?.((data) => {
        const state = useUninstallerStore.getState()
        if (state.uninstalling) state.setProgress(data)
      }),
      api.onDriverProgress?.((data) => {
        const state = useDriverStore.getState()
        if (state.scanning || state.cleaning) state.setScanProgress(data)
      }),
      api.onDriverUpdateProgress?.((data) => {
        const state = useDriverStore.getState()
        if (state.updateScanning || state.installing) state.setUpdateProgress(data)
      }),
      api.onRegistryFixProgress?.((data) => {
        const state = useRegistryStore.getState()
        if (state.fixing) state.setFixProgress(data)
      }),
      api.onDiskRepairProgress?.((data) => {
        const state = useDiskStore.getState()
        if (state.repairRunning) state.setRepairProgress(data)
      }),
      api.onDiskTrimProgress?.((data) => {
        const state = useDiskMaintenanceStore.getState()
        if (state.runStates[data.driveId] === 'running') state.setProgress(data)
      }),
      api.onShredderProgress?.((data) => {
        const state = useFileShredderStore.getState()
        if (state.status === 'shredding') state.setProgress(data)
      }),
      api.onMalwareProgress?.((data) => {
        const state = useMalwareStore.getState()
        if (state.status === 'scanning' || state.status === 'acting') state.setProgress(data)
      }),
      api.onServiceProgress?.((data) => {
        const state = useServiceStore.getState()
        if (state.scanning) state.setScanProgress(data)
      }),
      api.onFirewallProgress?.((data) => {
        const state = useFirewallStore.getState()
        if (state.scanning) state.setScanProgress(data)
      }),
      api.onContextMenuApplyProgress?.((data) => {
        const state = useContextMenuStore.getState()
        if (state.applying) state.setApplyProgress(data)
      }),
      api.onDebloaterRemoveProgress?.((data) => {
        const state = useDebloaterStore.getState()
        if (state.removing) state.setRemoveProgress(data)
      })
    ].filter((dispose): dispose is () => void => typeof dispose === 'function')
  }

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    references--
    if (references === 0) {
      for (const dispose of disposers) dispose()
      disposers = []
    }
  }
}
