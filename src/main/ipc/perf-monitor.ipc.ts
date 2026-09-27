import { ipcMain } from 'electron'
import os from 'os'
import { IPC } from '../../shared/channels'
import { perfMonitor } from '../services/perf-monitor'
import { CpuTimeSampler } from '../services/cpu-time-sampler'
import type { PerfQuickStats } from '../../shared/types'

// ── Lightweight CPU sampling for dashboard gauges ────────────
// Uses Node.js os.cpus() which has near-zero cost and no
// systeminformation dependency. Compares two samples to get %.
const quickCpuSampler = new CpuTimeSampler()

function sampleCpu(): number | null {
  const reading = quickCpuSampler.sample(os.cpus(), performance.now())
  return reading ? Math.round(reading.overall) : null
}

// Critical Windows processes that must never be killed by the user.
// Terminating these can cause a BSOD, logon failure, or system instability.
const PROTECTED_PROCESS_NAMES = new Set([
  'csrss.exe', // Client/Server Runtime — BSOD if killed
  'smss.exe', // Session Manager — BSOD if killed
  'wininit.exe', // Windows Init — BSOD if killed
  'services.exe', // Service Control Manager
  'lsass.exe', // Local Security Authority — logon/auth
  'lsaiso.exe', // LSA Isolated (Credential Guard)
  'svchost.exe', // Hosts many core OS services
  'winlogon.exe', // Logon session manager
  'dwm.exe', // Desktop Window Manager — desktop crashes
  'explorer.exe', // Windows shell — taskbar/desktop disappears
  'ntoskrnl.exe', // Kernel image
  'system', // Kernel-mode system process
  'registry', // Registry hive process
  'memory compression', // Memory management
  // macOS / Linux equivalents
  'launchd', // macOS PID 1
  'kernel_task', // macOS kernel
  'windowserver', // macOS display server
  'systemd', // Linux PID 1
  'init', // Linux PID 1 (SysVinit)
  'kthreadd', // Linux kernel threads
  'gdm', // GNOME Display Manager
  'sddm', // KDE Display Manager
  'lightdm', // Light Display Manager
  'xorg', // X11 display server
  'xwayland' // XWayland display server
])

export function registerPerfMonitorIpc(getWindow: () => Electron.BrowserWindow | null): void {
  const service = perfMonitor

  // The page that explicitly requested monitoring (null once it stops asking),
  // so we can auto-pause when the window is hidden and resume when shown again.
  let monitoringPage: Electron.WebContents | null = null
  let attachedWindowId: number | null = null
  const watchedPages = new WeakSet<Electron.WebContents>()

  function attachWindowListeners(win: Electron.BrowserWindow): void {
    if (win.id === attachedWindowId) return
    attachedWindowId = win.id

    win.on('hide', () => {
      if (monitoringPage) service.stopMonitoring()
    })
    win.on('show', () => {
      if (monitoringPage && !monitoringPage.isDestroyed()) {
        service.startMonitoring(monitoringPage)
      }
    })
  }

  // A reload, a crash or a destroyed page replaces the renderer without it ever
  // calling PERF_STOP_MONITORING: stop here, or main keeps sampling (and the show
  // handler restarts it) until the Performance page is next opened and left.
  function watchPage(page: Electron.WebContents): void {
    if (watchedPages.has(page)) return
    watchedPages.add(page)
    const stopForPage = () => {
      if (monitoringPage !== page) return
      monitoringPage = null
      service.stopMonitoring()
    }
    page.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) stopForPage()
    })
    page.on('render-process-gone', stopForPage)
    page.once('destroyed', stopForPage)
  }

  // Lightweight one-shot stats for dashboard gauges — no timers, no process list
  ipcMain.handle(IPC.PERF_QUICK_STATS, (): PerfQuickStats | null => {
    const cpuPercent = sampleCpu()
    // Priming, counter resets and returning after a pause need a fresh baseline.
    if (cpuPercent === null) return null
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const usedMem = totalMem - freeMem
    return {
      cpuPercent,
      memUsedBytes: usedMem,
      memTotalBytes: totalMem,
      memPercent: Math.round((usedMem / totalMem) * 100)
    }
  })

  ipcMain.handle(IPC.PERF_GET_SYSTEM_INFO, () => service.getSystemInfo())

  ipcMain.handle(IPC.PERF_START_MONITORING, (event) => {
    monitoringPage = event.sender
    watchPage(event.sender)

    // Attach hide/show listeners to the current window if not already attached
    const win = getWindow()
    if (win) attachWindowListeners(win)

    return service.startMonitoring(event.sender)
  })

  ipcMain.handle(IPC.PERF_STOP_MONITORING, () => {
    monitoringPage = null
    service.stopMonitoring()
  })

  ipcMain.handle(IPC.PERF_KILL_PROCESS, async (_event, pid: number) => {
    // Validate pid is a positive integer and not a critical system process
    if (!Number.isInteger(pid) || pid <= 0) {
      return { success: false, error: 'Invalid process ID' }
    }
    // Block PID 0 (System Idle / kernel), PID 1 (init/launchd), PID 4 (Windows System)
    if (pid <= 4) {
      return { success: false, error: 'Cannot kill critical system process' }
    }
    // Prevent the app from killing itself
    if (pid === process.pid) {
      return { success: false, error: 'Cannot kill own process' }
    }
    // Look up the process name and block protected system processes
    const processName = await service.getProcessName(pid)
    if (processName && PROTECTED_PROCESS_NAMES.has(processName.toLowerCase())) {
      return { success: false, error: `Cannot kill protected system process (${processName})` }
    }
    return service.killProcess(pid)
  })

  ipcMain.handle(IPC.PERF_DISK_HEALTH, () => service.getDiskHealth())
}
