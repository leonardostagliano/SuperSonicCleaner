// Dedicated browser-only QA entry. This module is never imported by the Electron entry.
import { defaultSettings, useSettingsStore } from '../stores/settings-store'
import { featureReads } from './feature-fixtures'
import { installNotchPreview } from './notch-fixture'
import type { ScanHistoryEntry, StartupItem, PerfSnapshot, UpdateStatus } from '@shared/types'
import type { AiAnalysisRequest } from '@shared/ai-analysis'

const GB = 1024 ** 3
const now = Date.now()
const empty = new URLSearchParams(location.search).get('state') === 'empty'
const slowScanPreview = new URLSearchParams(location.search).get('scan') === 'slow'
// Explicit sample access states for checking conversion and recovery flows.
const settings = structuredClone(defaultSettings)
settings.dashboardView =
  localStorage.getItem('kudu-preview-dashboard-view') === 'advanced' ? 'advanced' : 'simple'
settings.theme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark'
settings.language = new URLSearchParams(location.search).get('lang') === 'it' ? 'it' : 'en'
settings.schedules = empty
  ? []
  : [
      {
        id: 'preview-weekly',
        name: 'Weekly fresh start',
        enabled: true,
        frequency: 'weekly',
        day: 1,
        hour: 9,
        minute: 0,
        tasks: ['cleaner:system', 'cleaner:browsers'],
        autoApply: false,
        lastRunAt: null,
        lastRunStatus: 'never',
        createdAt: new Date(now).toISOString()
      }
    ]
const history: ScanHistoryEntry[] = empty
  ? []
  : Array.from({ length: 8 }, (_, i) => ({
      id: 'preview-' + i,
      type: i % 3 ? 'cleaner' : 'malware',
      timestamp: new Date(now - i * 86400000).toISOString(),
      duration: 15000 + i * 1800,
      totalItemsFound: i % 3 ? 1248 + i * 30 : 0,
      totalItemsCleaned: i % 3 ? 1248 + i * 30 : 0,
      totalItemsSkipped: 0,
      totalSpaceSaved: i % 3 ? (2.8 + i / 10) * GB : 0,
      categories: [],
      errorCount: 0
    }))
const startup: StartupItem[] = empty
  ? []
  : ['Discord', 'Steam', 'OneDrive', 'Windows Security'].map((name, i) => ({
      id: 'startup-' + i,
      name,
      displayName: name,
      command: 'C:\\Program Files\\' + name + '\\app.exe',
      location: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
      source: 'registry-hkcu',
      enabled: true,
      publisher: i >= 2 ? 'Microsoft Corporation' : name,
      impact: i < 2 ? 'high' : 'low'
    }))
const callbacks = new Map<string, Set<(value: any) => void>>()
const emit = (name: string, data: unknown) =>
  callbacks.get(name)?.forEach((callback) => callback(data))
const updatePreview = new URLSearchParams(location.search).get('update')
let updateStatus: UpdateStatus = {
  state:
    updatePreview === 'available' || updatePreview === 'downloaded' || updatePreview === 'error'
      ? updatePreview
      : 'idle',
  ...(updatePreview
    ? {
        version: '3.5.0',
        releaseNotes:
          'A refined workspace in light and dark.\nImproved release and installation flow.'
      }
    : {}),
  ...(updatePreview === 'error'
    ? { error: 'Preview: the update server is temporarily unavailable.' }
    : {})
}
const updateProgress = (next: UpdateStatus) => {
  updateStatus = next
  emit('onUpdaterStatus', next)
}
let quickCount = 0
let monitoring: ReturnType<typeof setInterval> | undefined
const slowAiPreview = new URLSearchParams(location.search).get('ai') === 'slow'
let aiPreviewRunning = false
let aiPreviewCancelled = false
const snapshot = (i: number): PerfSnapshot => ({
  timestamp: Date.now() - (90 - i) * 1000,
  cpu: { overall: 12 + Math.round(Math.abs(Math.sin(i * 0.9)) * 22), perCore: Array(12).fill(12) },
  memory: { usedBytes: 8.4 * GB, totalBytes: 32 * GB, cachedBytes: 2 * GB, percent: 26 },
  disk: { readBytesPerSec: (2 + (i % 6)) * 1024 ** 2, writeBytesPerSec: 1024 ** 2 },
  network: { rxBytesPerSec: 22000, txBytesPerSec: 4800 },
  uptime: 14820
})
const drive = {
  letter: 'C',
  label: 'Windows',
  totalSize: 512 * GB,
  freeSpace: 184 * GB,
  usedSpace: 328 * GB,
  isSystem: true
}
const reads: Record<string, (...args: any[]) => unknown> = {
  platformInfo: () => ({
    platform: 'win32',
    features: {
      registry: true,
      debloater: true,
      drivers: true,
      restorePoint: true,
      bootTrace: true,
      gameMode: true,
      firewallAudit: true,
      contextMenu: true
    }
  }),
  systemScan: async () => {
    const results = empty
      ? []
      : ['Temporary files', 'Windows logs', 'Crash reports'].map((subcategory, group) => ({
          category: 'system',
          subcategory,
          itemCount: 3,
          totalSize: (group + 1) * 150 * 1024 ** 2,
          items: Array.from({ length: 3 }, (_, i) => ({
            id: 'preview-file-' + group + '-' + i,
            path: 'C:\\Users\\Preview\\AppData\\Local\\Temp\\sample-' + group + '-' + i + '.tmp',
            size: (group + 1) * 50 * 1024 ** 2,
            category: 'system',
            subcategory,
            lastModified: now - 604800000,
            selected: true
          }))
        }))
    if (slowScanPreview) {
      for (const progress of [25, 50, 75, 100]) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        emit('onScanProgress', {
          phase: 'scanning',
          category: 'system',
          currentPath: 'C:\\Users\\Preview\\AppData\\Local\\Temp',
          progress,
          itemsFound: Math.floor((results.length * 3 * progress) / 100),
          sizeFound: Math.floor(
            (results.reduce((sum, item) => sum + item.totalSize, 0) * progress) / 100
          )
        })
      }
    }
    return results
  },
  browserScan: () => [],
  appScan: () => [],
  gamingScan: () => [],
  recycleBinScan: () => [],
  shortcutScan: () => [],
  environmentScan: () => [],
  privacyTracesScan: () => [],
  databaseScan: () => [],
  cleanerBlockers: () => [],
  serviceScan: () => ({
    services: empty
      ? []
      : ['Print Spooler', 'Bluetooth Support Service', 'Windows Search'].map((displayName, i) => ({
          name: 'preview-service-' + i,
          displayName,
          description: [
            'Manages local print jobs.',
            'Supports Bluetooth device discovery.',
            'Indexes content for faster searches.'
          ][i],
          status: 'Running',
          startType: 'Automatic',
          originalStartType: 'Automatic',
          safety: 'caution',
          category: ['print', 'bluetooth', 'misc'][i],
          isMicrosoft: true,
          dependsOn: [],
          dependents: [],
          selected: false
        })),
    totalCount: empty ? 0 : 3,
    runningCount: empty ? 0 : 3,
    disabledCount: 0,
    safeToDisableCount: 0
  }),
  privacyScan: () => ({
    settings: empty
      ? []
      : ['Diagnostic data', 'Advertising ID', 'Activity history'].map((label, i) => ({
          id: 'preview-privacy-' + i,
          category: 'telemetry',
          label,
          description: 'Review this Windows privacy preference.',
          enabled: i === 0,
          reversible: true,
          requiresAdmin: false
        })),
    score: empty ? 0 : 33,
    total: empty ? 0 : 3,
    protected: empty ? 0 : 1
  }),
  firewallScan: () => ({
    rules: [],
    totalCount: 0,
    staleCount: 0,
    unsignedCount: 0,
    broadScopeCount: 0
  }),
  diskAnalyze: () => ({
    name: 'C:',
    path: 'C:',
    size: 328 * GB,
    fileCount: 12400,
    children: ['Users', 'Windows', 'Program Files', 'Other'].map((name, i) => ({
      name,
      path: 'C:\\' + name,
      size: [124, 92, 78, 34][i] * GB,
      fileCount: 3100,
      children: []
    }))
  }),
  ...featureReads(empty),
  settingsGet: () => settings,
  settingsSet: (partial) => {
    if (new URLSearchParams(location.search).get('settings-error') === '1') {
      throw new Error('Synthetic settings save failure')
    }
    const cleaner = { ...settings.cleaner, ...partial.cleaner }
    const schedule = { ...settings.schedule, ...partial.schedule }
    const gameMode = { ...settings.gameMode, ...partial.gameMode }
    Object.assign(settings, partial, { cleaner, schedule, gameMode })
    if (partial.dashboardView)
      localStorage.setItem('kudu-preview-dashboard-view', partial.dashboardView)
    return settings
  },
  onboardingGet: () => true,
  elevationCheck: () => ({ isAdmin: true, isElevated: true }),
  updaterGetStatus: () => updateStatus,
  updaterCheck: () => {
    updateProgress({ state: 'checking' })
    setTimeout(
      () => updateProgress({ state: 'not-available', checkedAt: new Date().toISOString() }),
      800
    )
  },
  updaterDownload: () => {
    updateProgress({ ...updateStatus, state: 'downloading', progress: 0 })
    const downloadTimer = setInterval(() => {
      const progress = (updateStatus.progress ?? 0) + 20
      updateProgress({
        ...updateStatus,
        state: progress >= 100 ? 'downloaded' : 'downloading',
        progress
      })
      if (progress >= 100) clearInterval(downloadTimer)
    }, 400)
  },
  updaterInstall: () => updateProgress({ state: 'idle' }),
  aiAnalysisStatus: () => ({ connected: true, available: true }),
  aiAnalysisRun: async (request: AiAnalysisRequest) => {
    if (aiPreviewRunning) throw new Error('busy')
    aiPreviewRunning = true
    aiPreviewCancelled = false
    try {
      if (slowAiPreview) await new Promise((resolve) => setTimeout(resolve, 8000))
      if (aiPreviewCancelled) throw new Error('cancelled')
      return {
        summary:
          'Sample analysis of the selected metadata. Review each suggestion before taking action.',
        recommendations: request.items.slice(0, 2).map((item) => ({
          fileId: item.id,
          priority: 'medium' as const,
          reason: 'This sample item is among the largest in the current results.'
        }))
      }
    } finally {
      aiPreviewRunning = false
    }
  },
  aiAnalysisCancel: () => {
    aiPreviewCancelled = true
  },
  historyGet: () => history,
  historyAdd: (entry) => {
    history.unshift(entry)
    emit('onHistoryChanged', undefined)
  },
  startupList: () => startup,
  startupBootTrace: () => null,
  diskDrives: () => (empty ? [] : [drive]),
  diskTrimList: () =>
    empty
      ? []
      : [
          {
            ...drive,
            id: 'C',
            mediaType: 'NVMe',
            busType: 'NVMe',
            filesystem: 'NTFS',
            isRemovable: false,
            isEncrypted: false,
            trimSupport: 'supported',
            status: 'recommended',
            statusReason: 'Ready for maintenance',
            lastTrimAt: null
          }
        ],
  perfQuickStats: () => {
    quickCount++
    return {
      cpuPercent: empty ? 0 : 12 + (quickCount % 5) * 3,
      memUsedBytes: 8.4 * GB,
      memTotalBytes: 32 * GB,
      memPercent: 26
    }
  },
  perfGetSystemInfo: () => ({
    cpuModel: 'Intel Core i7-12700K',
    cpuCores: 12,
    cpuThreads: 20,
    totalMemBytes: 32 * GB,
    osVersion: 'Windows 11',
    hostname: 'DESKTOP-PREVIEW'
  }),
  perfGetDiskHealth: () => [],
  perfStartMonitoring: () => {
    if (monitoring) clearInterval(monitoring)
    if (!empty) for (let i = 0; i <= 90; i++) emit('onPerfSnapshot', snapshot(i))
    monitoring = setInterval(
      () => emit('onPerfSnapshot', { ...snapshot(quickCount++ % 90), timestamp: Date.now() }),
      1000
    )
  },
  perfStopMonitoring: () => {
    clearInterval(monitoring)
  },
  softwareUpdateCheck: () => ({
    apps: empty
      ? []
      : [
          {
            id: 'Mozilla.Firefox',
            name: 'Mozilla Firefox',
            currentVersion: '130.0',
            availableVersion: '130.0.1',
            source: 'winget',
            severity: 'patch',
            selected: true
          },
          {
            id: 'VideoLAN.VLC',
            name: 'VLC media player',
            currentVersion: '3.0.20',
            availableVersion: '3.0.21',
            source: 'winget',
            severity: 'patch',
            selected: true
          }
        ],
    upToDate: [],
    packageManagerAvailable: true,
    packageManagerName: 'winget',
    managers: [{ name: 'winget', available: true, updateCount: empty ? 0 : 2 }]
  }),
  driverUpdateScan: () => ({
    updates: [],
    totalAvailable: 0,
    scanDuration: 100,
    updatesDisabled: false
  }),
  driverScan: () => ({ drivers: [], totalStale: 0, totalStaleSize: 0 }),
  gameModeStatus: () => ({ active: false, activatedAt: null, pendingRestore: false }),
  gameModeGetStatus: () => ({ active: false, activatedAt: null, pendingRestore: false }),
  malwareAllowlistList: () => [],
  malwareQuarantineList: () => [],
  malwareYaraInfo: () => ({
    source: 'bundled',
    engine: 'yara-x',
    ruleCount: 7200,
    lastUpdated: new Date(now).toISOString(),
    ready: true
  }),
  cleanupReceipts: () => [],
  deletionLogQuery: () => ({ records: [], total: 0 }),
  uninstallerList: () => ({
    programs: empty
      ? []
      : ['Firefox', 'VLC media player', 'Visual Studio Code'].map((name, i) => ({
          id: 'app-' + i,
          displayName: name,
          publisher: ['Mozilla', 'VideoLAN', 'Microsoft'][i],
          displayVersion: '1.0.0',
          installDate: '20260820',
          estimatedSize: (130 + 50 * i) * 1024 ** 2,
          installLocation: 'C:\\Program Files\\' + name,
          uninstallString: 'preview',
          quietUninstallString: '',
          displayIcon: '',
          registryKey: 'preview',
          isSystemComponent: false,
          isWindowsInstaller: false,
          lastUsed: now - i * 86400000
        }))
  }),
  duplicatesSelectDir: () => 'C:\\Users\\Preview\\Downloads',
  largeFilesSelectDir: () => 'C:\\Users\\Preview\\Downloads',
  emptyFoldersSelectDir: () => 'C:\\Users\\Preview\\Downloads',
  shredderSelectFiles: () => [],
  shredderSelectFolders: () => []
}

window.kudu = new Proxy(
  {},
  {
    get: (_, name: string) => {
      if (/^on[A-Z]/.test(name))
        return (callback: (value: unknown) => void) => {
          const set = callbacks.get(name) ?? new Set()
          set.add(callback)
          callbacks.set(name, set)
          return () => {
            set.delete(callback)
          }
        }
      if (name === 'windowSetChromeTheme') return async () => {}
      return async (...args: unknown[]) => {
        if (name in reads) return reads[name](...args)
        throw new Error('Preview bridge: operation is not simulated (' + name + ')')
      }
    }
  }
) as typeof window.kudu

useSettingsStore.getState().setSettings(settings)
installNotchPreview(settings)

const badge = document.createElement('div')
badge.setAttribute('role', 'status')
badge.textContent = 'PRODUCT PREVIEW · SAMPLE DATA · NO SYSTEM CHANGES'
badge.style.cssText =
  'position:fixed;bottom:4px;right:12px;z-index:99999;font:9px Segoe UI;letter-spacing:1px;color:#9ba7af;pointer-events:none;'
document.body.append(badge)
await import('../main')
