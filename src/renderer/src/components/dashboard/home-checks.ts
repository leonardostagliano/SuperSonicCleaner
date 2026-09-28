// The Home checks (Controlli): last result, when, whether the app recommends running it.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  checkState,
  latestEntry,
  latestRun,
  newestRun,
  type CheckId,
  type CheckInput,
  type CheckState
} from '@/lib/checks'
import { formatBytes } from '@/lib/utils'
import { usePlatform } from '@/hooks/usePlatform'
import { useHistoryStore } from '@/stores/history-store'
import { useUpdaterStore } from '@/stores/updater-store'
import { useStartupStore } from '@/stores/startup-store'
import { useMalwareStore } from '@/stores/malware-store'
import { useSettingsStore } from '@/stores/settings-store'
import { lastCheckRun } from '@/stores/check-runs-store'
import { formatCount, formatWhen } from './when'

// The updater store says whether this session checked, not when: note the moment it
// first reports a completed check. This module loads with Home, before the deferred
// background check can finish.
let updatesCheckedAt: number | null = useUpdaterStore.getState().hasChecked ? Date.now() : null
useUpdaterStore.subscribe((state) => {
  if (state.hasChecked && updatesCheckedAt === null) updatesCheckedAt = Date.now()
  if (!state.hasChecked) updatesCheckedAt = null
})

/** A clock for relative dates ("5 minuti fa") that ticks once a minute. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

export type ResultTone = 'neutral' | 'recommended' | 'ok' | 'danger'

export interface HomeCheck {
  id: CheckId
  input: CheckInput
  state: CheckState
  /** The last result in words; '' while it is being read. */
  result: string
  resultTone: ResultTone
  /** When it last ran, or '—'. */
  when: string
  path: string
}

const PATHS: Record<CheckId, string> = {
  updates: '/updates',
  startup: '/startup',
  malware: '/malware',
  cleanup: '/cleaner',
  registry: '/registry',
  drivers: '/drivers',
  privacy: '/privacy'
}

/** Every check the platform supports, in the table's order, with its state and result. */
export function useHomeChecks(): { checks: HomeCheck[]; inputs: CheckInput[] } {
  const { t, i18n } = useTranslation('dashboard')
  const { features } = usePlatform()
  const now = useNow()
  const history = useHistoryStore((s) => s.entries)
  const remindersOn = useSettingsStore((s) => s.settings.softwareUpdaterNotifications ?? true)
  const updatesChecked = useUpdaterStore((s) => s.hasChecked)
  const updatesLoading = useUpdaterStore((s) => s.loading)
  const updateApps = useUpdaterStore((s) => s.apps)
  const startupItems = useStartupStore((s) => s.items)
  const startupLoaded = useStartupStore((s) => s.hasLoaded)
  const startupLoading = useStartupStore((s) => s.loading)
  const lastScan = useMalwareStore((s) => s.lastCompletedScan)
  const restoredThreats = useMalwareStore((s) => s.knownActiveThreats)
  const locale = i18n.language || 'en'

  const ids: CheckId[] = [
    'updates',
    'startup',
    'malware',
    'cleanup',
    ...(features.registry ? (['registry'] as const) : []),
    ...(features.drivers ? (['drivers'] as const) : []),
    'privacy'
  ]

  const openThreats = (lastScan?.unresolvedThreats ?? 0) + restoredThreats
  const sessionScan = lastScan ? new Date(lastScan.completedAt).getTime() : null
  const pending = updatesChecked ? updateApps.length : 0

  // A check counts as run either when it changed something (history) or when it merely
  // completed (the recorded check run): the later of the two.
  const inputFor = (id: CheckId): CheckInput => {
    switch (id) {
      case 'updates':
        return {
          id,
          lastRun: newestRun(
            updatesChecked ? updatesCheckedAt : latestRun(history, 'software-update'),
            lastCheckRun('updates')
          ),
          pendingCount: pending
        }
      case 'malware': {
        const recorded = latestRun(history, 'malware')
        const historyOrSession =
          sessionScan === null
            ? recorded
            : recorded === null
              ? sessionScan
              : Math.max(sessionScan, recorded)
        return { id, lastRun: newestRun(historyOrSession, lastCheckRun('malware')), openThreats }
      }
      case 'cleanup':
        return { id, lastRun: newestRun(latestRun(history, 'cleaner'), lastCheckRun('cleanup')) }
      case 'startup':
        return { id, lastRun: newestRun(latestRun(history, 'startup'), lastCheckRun('startup')) }
      case 'registry':
        return { id, lastRun: newestRun(latestRun(history, 'registry'), lastCheckRun('registry')) }
      case 'drivers':
        return { id, lastRun: newestRun(latestRun(history, 'drivers'), lastCheckRun('drivers')) }
      case 'privacy':
        return { id, lastRun: newestRun(latestRun(history, 'privacy'), lastCheckRun('privacy')) }
    }
  }

  // A reading in progress is never coloured, even on a recommended row.
  const transient = (result: string) => ({ result, resultTone: 'transient' as const })
  const resultFor = (id: CheckId): { result: string; resultTone: ResultTone | 'transient' } => {
    const neutral = (result: string) => ({ result, resultTone: 'neutral' as const })
    switch (id) {
      case 'updates': {
        if (updatesLoading) return transient(t('checks.results.checking'))
        if (!updatesChecked)
          return neutral(
            t(remindersOn ? 'checks.results.updatesNotChecked' : 'checks.results.updatesAutoOff')
          )
        if (pending === 0) return { result: t('checks.results.updatesNone'), resultTone: 'ok' }
        const major = updateApps.filter((app) => app.severity === 'major').length
        const parts = [t('checks.results.updatesPending', { count: pending })]
        if (major > 0) parts.push(t('checks.results.updatesMajor', { count: major }))
        return { result: parts.join(' · '), resultTone: 'recommended' }
      }
      case 'startup': {
        if (startupLoading && !startupLoaded) return transient(t('checks.results.reading'))
        if (!startupLoaded) return neutral(t('checks.results.startupUnavailable'))
        const active = startupItems.filter((item) => item.enabled)
        const high = active.filter((item) => item.impact === 'high').length
        return neutral(
          [
            t('checks.results.startupActive', { count: active.length }),
            t('checks.results.startupHigh', { count: high })
          ].join(' · ')
        )
      }
      case 'malware': {
        if (openThreats > 0)
          return {
            result: t('checks.results.malwareThreats', { count: openThreats }),
            resultTone: 'danger'
          }
        const entry = latestEntry(history, 'malware')
        const recorded = entry ? new Date(entry.timestamp).getTime() : null
        if (lastScan && (recorded === null || sessionScan! >= recorded))
          return { result: t('checks.results.malwareClear'), resultTone: 'ok' }
        if (entry)
          return neutral(
            t('checks.results.malwareHandled', {
              handled: entry.totalItemsCleaned,
              count: entry.totalItemsFound
            })
          )
        return neutral(t('checks.results.malwareNever'))
      }
      case 'cleanup': {
        const entry = latestEntry(history, 'cleaner')
        if (!entry) return neutral(t('checks.results.cleanupNever'))
        return neutral(
          entry.totalSpaceSaved > 0
            ? t('checks.results.freed', { size: formatBytes(entry.totalSpaceSaved) })
            : t('checks.results.itemsCleaned', {
                count: entry.totalItemsCleaned,
                n: formatCount(entry.totalItemsCleaned, locale)
              })
        )
      }
      case 'registry': {
        const entry = latestEntry(history, 'registry')
        return neutral(
          entry
            ? t('checks.results.registryFixed', { count: entry.totalItemsCleaned })
            : t('checks.results.noFixRecorded')
        )
      }
      case 'drivers': {
        const entry = latestEntry(history, 'drivers')
        if (!entry) return neutral(t('checks.results.driversNever'))
        return neutral(
          entry.totalItemsCleaned > 0
            ? t('checks.results.driversRemoved', { count: entry.totalItemsCleaned })
            : t('checks.results.driversFound', { count: entry.totalItemsFound })
        )
      }
      case 'privacy': {
        const entry = latestEntry(history, 'privacy')
        return neutral(
          entry
            ? t('checks.results.privacyApplied', { count: entry.totalItemsCleaned })
            : t('checks.results.noChangeRecorded')
        )
      }
    }
  }

  const inputs = ids.map(inputFor)
  const checks = inputs.map((input): HomeCheck => {
    const state = checkState(input, now)
    const { result, resultTone } = resultFor(input.id)
    return {
      id: input.id,
      input,
      state,
      result,
      // The rule and the amber result mark what the app recommends; a threat stays red.
      resultTone:
        resultTone === 'transient'
          ? 'neutral'
          : state.recommended && resultTone === 'neutral'
            ? 'recommended'
            : resultTone,
      when: input.lastRun === null ? '—' : formatWhen(input.lastRun, now, locale),
      path: PATHS[input.id]
    }
  })
  return { checks, inputs }
}
