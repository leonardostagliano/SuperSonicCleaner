import type { GameModeCategory, GameModeOptimizationId, GameModeProgress } from '@shared/types'

export interface OptimizationDef {
  id: GameModeOptimizationId
  category: GameModeCategory
  labelKey: string
  descKey: string
  requiresAdmin: boolean
}

export const OPTIMIZATIONS: readonly OptimizationDef[] = [
  // Services
  {
    id: 'svc-wsearch',
    category: 'services',
    labelKey: 'optSvcWsearch',
    descKey: 'optSvcWsearchDesc',
    requiresAdmin: true
  },
  {
    id: 'svc-sysmain',
    category: 'services',
    labelKey: 'optSvcSysmain',
    descKey: 'optSvcSysmainDesc',
    requiresAdmin: true
  },
  {
    id: 'svc-wuauserv',
    category: 'services',
    labelKey: 'optSvcWuauserv',
    descKey: 'optSvcWuauservDesc',
    requiresAdmin: true
  },
  {
    id: 'svc-spooler',
    category: 'services',
    labelKey: 'optSvcSpooler',
    descKey: 'optSvcSpoolerDesc',
    requiresAdmin: true
  },
  {
    id: 'svc-diagtrack',
    category: 'services',
    labelKey: 'optSvcDiagtrack',
    descKey: 'optSvcDiagtrackDesc',
    requiresAdmin: true
  },
  // Processes
  {
    id: 'proc-kill-browsers',
    category: 'processes',
    labelKey: 'optProcBrowsers',
    descKey: 'optProcBrowsersDesc',
    requiresAdmin: false
  },
  {
    id: 'proc-kill-chat',
    category: 'processes',
    labelKey: 'optProcChat',
    descKey: 'optProcChatDesc',
    requiresAdmin: false
  },
  {
    id: 'proc-kill-updaters',
    category: 'processes',
    labelKey: 'optProcUpdaters',
    descKey: 'optProcUpdatersDesc',
    requiresAdmin: false
  },
  {
    id: 'proc-kill-custom',
    category: 'processes',
    labelKey: 'optProcCustom',
    descKey: 'optProcCustomDesc',
    requiresAdmin: false
  },
  // Memory
  {
    id: 'mem-clear-standby',
    category: 'memory',
    labelKey: 'optMemStandby',
    descKey: 'optMemStandbyDesc',
    requiresAdmin: false
  },
  // System
  {
    id: 'sys-focus-assist',
    category: 'system',
    labelKey: 'optSysFocusAssist',
    descKey: 'optSysFocusAssistDesc',
    requiresAdmin: false
  },
  {
    id: 'sys-power-plan',
    category: 'system',
    labelKey: 'optSysPowerPlan',
    descKey: 'optSysPowerPlanDesc',
    requiresAdmin: false
  },
  {
    id: 'sys-prevent-sleep',
    category: 'system',
    labelKey: 'optSysPreventSleep',
    descKey: 'optSysPreventSleepDesc',
    requiresAdmin: false
  },
  {
    id: 'sys-disable-game-bar',
    category: 'system',
    labelKey: 'optSysGameBar',
    descKey: 'optSysGameBarDesc',
    requiresAdmin: false
  },
  {
    id: 'sys-disable-fse-opt',
    category: 'system',
    labelKey: 'optSysFseOpt',
    descKey: 'optSysFseOptDesc',
    requiresAdmin: false
  },
  {
    id: 'sys-disable-transparency',
    category: 'system',
    labelKey: 'optSysTransparency',
    descKey: 'optSysTransparencyDesc',
    requiresAdmin: false
  },
  // Network
  {
    id: 'net-flush-dns',
    category: 'network',
    labelKey: 'optNetFlushDns',
    descKey: 'optNetFlushDnsDesc',
    requiresAdmin: false
  },
  {
    id: 'net-disable-nagle',
    category: 'network',
    labelKey: 'optNetNagle',
    descKey: 'optNetNagleDesc',
    requiresAdmin: true
  }
]

export const CATEGORIES: readonly { id: GameModeCategory; labelKey: string; descKey: string }[] = [
  { id: 'services', labelKey: 'categoryServices', descKey: 'categoryServicesDesc' },
  { id: 'processes', labelKey: 'categoryProcesses', descKey: 'categoryProcessesDesc' },
  { id: 'memory', labelKey: 'categoryMemory', descKey: 'categoryMemoryDesc' },
  { id: 'system', labelKey: 'categorySystem', descKey: 'categorySystemDesc' },
  { id: 'network', labelKey: 'categoryNetwork', descKey: 'categoryNetworkDesc' }
]

/** Session length as h:mm:ss with two-digit minutes and seconds: 0:05:09, 12:00:00. */
export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * The translated line for a progress event (gameMode namespace). Main reports the step's id:
 * an optimization id, a service restore (`svc-restore-<name>`) or the registry restore.
 */
export function stepLabel(progress: Pick<GameModeProgress, 'phase' | 'currentLabel'>): {
  key: string
  params?: Record<string, string>
  labelKey?: string
} {
  const id = progress.currentLabel
  const optimization = OPTIMIZATIONS.find((o) => o.id === id)
  if (optimization) {
    return {
      key: progress.phase === 'activating' ? 'applyingOptimization' : 'restoringOptimization',
      labelKey: optimization.labelKey
    }
  }
  if (id.startsWith('svc-restore-')) {
    return { key: 'restoringService', params: { name: id.slice('svc-restore-'.length) } }
  }
  if (id === 'sys-registry-tweaks') return { key: 'restoringRegistry' }
  return { key: progress.phase === 'activating' ? 'activatingProgress' : 'restoringOther' }
}

/** Process names the game-mode lists accept (letters, digits, dots, hyphens, underscores, spaces). */
export function isValidProcessName(name: string): boolean {
  return name.length > 0 && name.length <= 100 && /^[A-Za-z0-9._\- ]+$/.test(name)
}
