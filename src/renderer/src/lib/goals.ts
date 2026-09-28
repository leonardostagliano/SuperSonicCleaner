// The simple Home's goals: an ordered path of tools per goal, each step with its real state.
import type { HistoryEntryType, PlatformInfo } from '@shared/types'
import {
  checkState,
  latestRun,
  type CheckId,
  type CheckInput,
  type CheckReason,
  type HistoryStamp
} from './checks'

export type Goal = 'space' | 'speed' | 'protection'
export const GOALS: readonly Goal[] = ['space', 'speed', 'protection']

const PATHS: Record<Goal, readonly string[]> = {
  space: ['/cleaner', '/large-files', '/duplicates', '/empty-folders', '/disk'],
  speed: ['/startup', '/performance', '/services', '/performance-diagnostics'],
  protection: ['/malware', '/privacy', '/firewall', '/updates']
}

/** Tools that exist only where the platform reports the feature. */
const PATH_FEATURE: Partial<Record<string, keyof PlatformInfo['features']>> = {
  '/firewall': 'firewallAudit'
}

/** The history entry type a tool's page records when it completes a change. */
export const HISTORY_TYPE: Partial<Record<string, HistoryEntryType>> = {
  '/cleaner': 'cleaner',
  '/startup': 'startup',
  '/malware': 'malware',
  '/privacy': 'privacy',
  '/services': 'services',
  '/updates': 'software-update'
}

/** The Home check that covers a tool, for the "recommended" rules in checks.ts. */
export const CHECK_FOR_PATH: Partial<Record<string, CheckId>> = {
  '/cleaner': 'cleanup',
  '/startup': 'startup',
  '/malware': 'malware',
  '/privacy': 'privacy',
  '/updates': 'updates'
}

export function goalPaths(goal: Goal, features?: PlatformInfo['features']): string[] {
  return PATHS[goal].filter((path) => {
    const feature = PATH_FEATURE[path]
    return !feature || !features || features[feature]
  })
}

/**
 * - recommended: checks.ts recommends running it (pending updates, open threats, never or long ago)
 * - done: it ran, `lastRun` says when
 * - never: the tool records its runs and has none
 * - unknown: the tool records nothing, so no date can be shown
 */
export type StepStatus = 'recommended' | 'done' | 'never' | 'unknown'

export interface StepState {
  path: string
  status: StepStatus
  reason: CheckReason | null
  lastRun: number | null
  /** The one step that carries the primary action: the first recommended, else the first. */
  marked: boolean
}

const newest = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.max(a, b)

export function stepStates(
  goal: Goal,
  history: readonly HistoryStamp[],
  checks: readonly CheckInput[],
  now: number,
  features?: PlatformInfo['features']
): StepState[] {
  const steps = goalPaths(goal, features).map((path): StepState => {
    const type = HISTORY_TYPE[path]
    const checkId = CHECK_FOR_PATH[path]
    const input = checkId ? checks.find((check) => check.id === checkId) : undefined
    const lastRun = newest(type ? latestRun(history, type) : null, input?.lastRun ?? null)
    const state = checkId ? checkState({ ...input, id: checkId, lastRun }, now) : null
    const status: StepStatus = state?.recommended
      ? 'recommended'
      : lastRun !== null
        ? 'done'
        : type || input
          ? 'never'
          : 'unknown'
    return { path, status, reason: state?.reason ?? null, lastRun, marked: false }
  })
  const first = Math.max(
    0,
    steps.findIndex((step) => step.status === 'recommended')
  )
  if (steps[first]) steps[first].marked = true
  return steps
}
