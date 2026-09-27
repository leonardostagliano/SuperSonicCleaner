import { useEffect, useRef } from 'react'
import { useUpdaterStore } from '@/stores/updater-store'
import { useDriverStore } from '@/stores/driver-store'
import { refreshSettings, useSettingsStore } from '@/stores/settings-store'
import { useScanStore } from '@/stores/scan-store'
import { useDiskStore } from '@/stores/disk-store'
import { useDuplicateStore } from '@/stores/duplicate-store'
import { useLargeFileStore } from '@/stores/large-file-store'
import { useEmptyFolderStore } from '@/stores/empty-folder-store'
import { useMalwareStore } from '@/stores/malware-store'
import { deferBackgroundScans } from '@/lib/deferred-background-scans'
import { ScanStatus } from '@shared/enums'

function foregroundWorkActive(): boolean {
  const updater = useUpdaterStore.getState()
  const drivers = useDriverStore.getState()
  const scan = useScanStore.getState().status
  const disk = useDiskStore.getState()
  const fileScans = [
    useDuplicateStore.getState().status,
    useLargeFileStore.getState().status,
    useEmptyFolderStore.getState().status
  ]
  const malware = useMalwareStore.getState().status
  return (
    updater.loading ||
    updater.updating ||
    drivers.scanning ||
    drivers.updateScanning ||
    drivers.applying ||
    drivers.cleaning ||
    drivers.installing ||
    scan === ScanStatus.Scanning ||
    scan === ScanStatus.Cleaning ||
    disk.analyzing ||
    disk.fileTypesLoading ||
    disk.repairRunning ||
    fileScans.some((status) => status === 'scanning' || status === 'deleting') ||
    malware === 'scanning' ||
    malware === 'acting'
  )
}

/**
 * Runs software-update and driver-update scans silently in the background
 * after startup settles. Populates stores so badge counts appear in the sidebar.
 */
export function useBackgroundScans(): void {
  const driverRan = useRef(false)
  const softwareRan = useRef(false)
  const ignoredLoaded = useRef(false)
  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const ignoredSoftwareUpdates = useSettingsStore((s) => s.settings.ignoredSoftwareUpdates)
  const softwareUpdaterNotifications = useSettingsStore(
    (s) => s.settings.softwareUpdaterNotifications ?? true
  )

  // The software check waits on hydrated settings; retry once if the eager
  // hydration in settings-store lost its IPC, so a transient failure doesn't
  // defer that check for the whole session.
  useEffect(() => {
    if (settingsLoaded) return
    const id = setTimeout(refreshSettings, 2000)
    return () => clearTimeout(id)
  }, [settingsLoaded])

  // Load ignored IDs first so setApps() can partition correctly. This runs even
  // when reminders are off, since manual checks on the updater page still need it.
  useEffect(() => {
    if (!settingsLoaded || ignoredLoaded.current) return
    ignoredLoaded.current = true
    if (ignoredSoftwareUpdates?.length) {
      useUpdaterStore.getState().loadIgnoredIds(ignoredSoftwareUpdates)
    }
  }, [settingsLoaded, ignoredSoftwareUpdates])

  // Only automatic checks join this queue. Manual checks keep their direct IPC
  // path and win if they start while the deferred work is still pending.
  useEffect(() => {
    if (!settingsLoaded) return
    return deferBackgroundScans(
      [
        {
          shouldRun: () =>
            !softwareRan.current &&
            (useSettingsStore.getState().settings.softwareUpdaterNotifications ?? true) &&
            !useUpdaterStore.getState().hasChecked,
          run: async () => {
            softwareRan.current = true
            useUpdaterStore.getState().setLoading(true)
            try {
              const result = await window.kudu.softwareUpdateCheck()
              const s = useUpdaterStore.getState()
              s.setApps(result.apps)
              s.setUpToDate(result.upToDate)
              s.setPackageManagerAvailable(result.packageManagerAvailable)
              s.setPackageManagerName(result.packageManagerName)
              s.setManagers(result.managers)
              s.setHasChecked(true)
            } catch {
              // Silent — don't set error so the page still shows its initial state.
            } finally {
              useUpdaterStore.getState().setLoading(false)
            }
          }
        },
        {
          // The badge needs update availability, not the heavier stale-package scan.
          shouldRun: () => !driverRan.current && !useDriverStore.getState().hasScanned,
          run: async () => {
            driverRan.current = true
            useDriverStore.getState().setUpdateScanning(true)
            try {
              const result = await window.kudu.driverUpdateScan()
              useDriverStore.getState().setUpdates(result.updates)
              useDriverStore.getState().setIgnoredUpdates(result.ignoredUpdates ?? [])
            } catch {
              // Silent.
            } finally {
              const s = useDriverStore.getState()
              s.setUpdateScanning(false)
              s.setUpdateProgress(null)
            }
          }
        }
      ],
      foregroundWorkActive
    )
  }, [settingsLoaded, softwareUpdaterNotifications])
}
