// Completed checks (read-only scans/lists), separate from history: history records
// changes, so a check that finds nothing to change (a startup review, a clean scan,
// a malware scan) would otherwise look "never checked" in Home's Controlli.
import { create } from 'zustand'
import type { CheckId } from '@/lib/checks'

const STORAGE_KEY = 'kudu:check-runs'
const STORAGE_VERSION = 1

// A `Record<CheckId, true>` object literal, not a plain array: TypeScript's excess- and
// missing-property checks on it mean this fails to compile if `CheckId` in lib/checks.ts
// ever gains or loses a member without this file being updated to match, so a new check
// id cannot silently be dropped by `isCheckId`.
const ALL_CHECK_IDS: Record<CheckId, true> = {
  updates: true,
  startup: true,
  malware: true,
  cleanup: true,
  registry: true,
  drivers: true,
  privacy: true
}

function isCheckId(id: string): id is CheckId {
  return Object.hasOwn(ALL_CHECK_IDS, id)
}

export type CheckRuns = Partial<Record<CheckId, number>>

/** Parses a stored payload, dropping unknown ids and non-numeric timestamps. Never throws. */
export function parseCheckRuns(raw: string | null): CheckRuns {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; runs?: unknown }
    if (
      parsed?.version !== STORAGE_VERSION ||
      typeof parsed.runs !== 'object' ||
      parsed.runs === null
    )
      return {}
    const runs: CheckRuns = {}
    for (const [id, at] of Object.entries(parsed.runs as Record<string, unknown>)) {
      if (isCheckId(id) && typeof at === 'number' && Number.isFinite(at)) runs[id] = at
    }
    return runs
  } catch {
    return {}
  }
}

function loadCheckRuns(): CheckRuns {
  try {
    return parseCheckRuns(localStorage.getItem(STORAGE_KEY))
  } catch {
    return {}
  }
}

function saveCheckRuns(runs: CheckRuns): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, runs }))
  } catch {
    // Private browsing / storage disabled: the session still works, just unremembered.
  }
}

interface CheckRunsState {
  runs: CheckRuns
  record: (id: CheckId, at: number) => void
}

export const useCheckRunsStore = create<CheckRunsState>((set, get) => ({
  runs: loadCheckRuns(),
  record: (id, at) => {
    const runs = { ...get().runs, [id]: at }
    set({ runs })
    saveCheckRuns(runs)
  }
}))

/** Records that `id`'s check completed (a read-only scan/list, not only a change). */
export function recordCheckRun(id: CheckId, at: number = Date.now()): void {
  useCheckRunsStore.getState().record(id, at)
}

/** Epoch ms of the last recorded completed run of `id`, or null if it never ran. */
export function lastCheckRun(id: CheckId): number | null {
  return useCheckRunsStore.getState().runs[id] ?? null
}
