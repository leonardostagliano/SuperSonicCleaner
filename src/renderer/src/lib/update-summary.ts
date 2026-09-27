import type { UpdatableApp, UpdateResult, UpdateResultItem } from '@shared/types'
import { appKey } from '@/stores/updater-store'

/** One package in the summary shown once a software update run ends. */
export interface UpdateSummaryEntry {
  /** Composite key of the requested row (see appKey). */
  key: string
  appId: string
  name: string
  iconDataUrl?: string
  fromVersion?: string
  toVersion?: string
  /** Failed entries only: why the upgrade failed. */
  reason?: string
}

/** What a software update run did, package by package, for the user to acknowledge. */
export interface UpdateSummary {
  updated: UpdateSummaryEntry[]
  /** Still installing in the background when the wait ran out. */
  pending: UpdateSummaryEntry[]
  failed: UpdateSummaryEntry[]
}

/**
 * Pair every package a run reported with the row that was requested, for its
 * name, icon and versions. An entry with a source matches that exact row (the
 * same id can exist under two managers); one without — single-manager
 * platforms — matches by id.
 */
export function buildUpdateSummary(result: UpdateResult, requested: UpdatableApp[]): UpdateSummary {
  const entry = (item: UpdateResultItem, reason?: string): UpdateSummaryEntry => {
    const app = requested.find(
      (a) => a.id === item.appId && (!item.source || a.source === item.source)
    )
    return {
      key: appKey(app ?? { id: item.appId, source: item.source ?? '' }),
      appId: item.appId,
      name: app?.name || item.name || item.appId,
      ...(app?.iconDataUrl ? { iconDataUrl: app.iconDataUrl } : {}),
      ...(app ? { fromVersion: app.currentVersion, toVersion: app.availableVersion } : {}),
      ...(reason !== undefined ? { reason } : {})
    }
  }
  return {
    updated: result.updated.map((item) => entry(item)),
    pending: result.pending.map((item) => entry(item)),
    failed: result.errors.map((item) => entry(item, item.reason))
  }
}

type Translate = (key: string, options?: Record<string, unknown>) => string

/** Names listed in a message before the rest are counted as "N more". */
const LISTED_NAMES = 5

/** Whether a list of names is too long to show whole ("N more" is never 1). */
const isTruncated = (names: readonly unknown[]): boolean => names.length > LISTED_NAMES + 1

/** Names joined the way the language lists things, the tail folded into "N more". */
function listNames(names: string[], t: Translate, locale: string): string {
  const parts = isTruncated(names)
    ? [
        ...names.slice(0, LISTED_NAMES),
        t('softwareUpdater.moreApps', { count: names.length - LISTED_NAMES })
      ]
    : names
  try {
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(parts)
  } catch {
    return parts.join(', ')
  }
}

export interface SummaryMessage {
  kind: 'success' | 'warning' | 'error'
  title: string
  lines: string[]
  /** Some names were folded into "N more": the full list is on the updates page. */
  truncated: boolean
}

/**
 * The completion message for a run: a single package is named in the title;
 * a bulk run gets a count, then one line per outcome listing the apps by name.
 * Null when the run did nothing.
 */
export function summaryMessage(
  summary: UpdateSummary,
  t: Translate,
  locale: string
): SummaryMessage | null {
  const { updated, pending, failed } = summary
  const total = updated.length + pending.length + failed.length
  if (total === 0) return null
  const kind = failed.length > 0 ? 'error' : pending.length > 0 ? 'warning' : 'success'

  if (total === 1) {
    if (updated.length) {
      const { name: app, toVersion: version } = updated[0]
      return {
        kind,
        title: version
          ? t('softwareUpdater.resultUpdatedTo', { app, version })
          : t('softwareUpdater.resultUpdated', { app }),
        lines: [],
        truncated: false
      }
    }
    if (pending.length) {
      return {
        kind,
        title: t('softwareUpdater.resultPending', { app: pending[0].name }),
        lines: [],
        truncated: false
      }
    }
    return {
      kind,
      title: t('softwareUpdater.failedToUpdate', { app: failed[0].name }),
      lines: failed[0].reason ? [failed[0].reason] : [],
      truncated: false
    }
  }

  const names = (entries: UpdateSummaryEntry[]): string =>
    listNames(
      entries.map((e) => e.name),
      t,
      locale
    )
  const lines: string[] = []
  if (updated.length) lines.push(t('softwareUpdater.toastUpdatedList', { apps: names(updated) }))
  if (pending.length) lines.push(t('softwareUpdater.toastPendingList', { apps: names(pending) }))
  if (failed.length) lines.push(t('softwareUpdater.toastFailedList', { apps: names(failed) }))
  return {
    kind,
    title: t('softwareUpdater.toastBulkSummary', { updated: updated.length, total }),
    lines,
    truncated: [updated, pending, failed].some((entries) => isTruncated(entries))
  }
}

/** Time the current install has been running, read like a clock: 9:05, 1:02:05. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const ss = String(seconds % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** After this long, the progress panel explains that big installers take a while. */
export const SLOW_INSTALL_HINT_MS = 5 * 60 * 1000
