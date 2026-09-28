import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { ArrowRight, ArrowUpDown, Check, Eye, EyeOff, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { AppIcon } from '@/components/shared/AppIcon'
import { Button, Card, Checkbox, ListRow, Segmented, Tag } from '@/components/ui'
import {
  Disclosure,
  MenuButton,
  Note,
  ProgressCard,
  SearchField,
  SummaryCard
} from '@/components/software/SoftwareBlocks'
import { formatClock, formatDateTime, joinFacts } from '@/components/software/format'
import { UpdateProgressPanel } from '@/components/updates/UpdateProgressPanel'
import { UpdateSummaryBanner } from '@/components/updates/UpdateSummaryBanner'
import {
  showUpdateSummaryToast,
  UPDATE_SUMMARY_TOAST_ID
} from '@/components/updates/UpdateSummaryToast'
import { icons } from '@/lib/icons'
import { buildUpdateSummary } from '@/lib/update-summary'
import { softwareUpdateCategory } from '@/lib/history-categories'
import { useUpdaterStore, severityOrder, appKey } from '@/stores/updater-store'
import { useHistoryStore } from '@/stores/history-store'
import { recordCheckRun } from '@/stores/check-runs-store'
import { useSettingsStore } from '@/stores/settings-store'
import { usePlatform } from '@/hooks/usePlatform'
import type {
  UpdatableApp,
  UpdateSeverity,
  UpToDateApp,
  WindowsPackageManager
} from '@shared/types'

/** Windows managers Kudu can aggregate, with their display labels. */
const WINDOWS_MANAGER_OPTIONS: { id: WindowsPackageManager; label: string }[] = [
  { id: 'winget', label: 'winget' },
  { id: 'choco', label: 'Chocolatey' },
  { id: 'scoop', label: 'Scoop' },
  { id: 'npm', label: 'npm' }
]
const DEFAULT_WINDOWS_MANAGERS: WindowsPackageManager[] = ['winget', 'choco', 'scoop', 'npm']

const SEVERITY_LABEL_KEYS: Record<UpdateSeverity, string> = {
  major: 'softwareUpdater.severityMajor',
  minor: 'softwareUpdater.severityMinor',
  patch: 'softwareUpdater.severityPatch',
  unknown: 'softwareUpdater.severityUpdate'
}

type SortField = 'name' | 'severity' | 'source'
type SeverityFilter = 'all' | 'major' | 'minor' | 'patch'

const SORT_LABEL_KEYS: Record<SortField, string> = {
  name: 'softwareUpdater.sortName',
  severity: 'softwareUpdater.sortSeverity',
  source: 'softwareUpdater.sortSource'
}

const FILTER_LABEL_KEYS: Record<SeverityFilter, string> = {
  all: 'softwareUpdater.filterAll',
  major: 'softwareUpdater.filterMajor',
  minor: 'softwareUpdater.filterMinor',
  patch: 'softwareUpdater.filterPatch'
}

/** Major updates are the ones the page recommends (amber rule and tag). */
const isRecommended = (app: UpdatableApp): boolean => app.severity === 'major'

/** When this session's last check finished: survives leaving and reopening the page. */
let lastCheckedAt: number | null = null

/** Title and explanation when no supported package manager answered. */
function missingManagerCopy(
  t: TFunction,
  platform: string | undefined,
  name: string | null
): { title: string; description?: string } {
  const k = (key: string) => t(`softwareUpdater.packageManagerNotFound.${key}`)
  if (platform === 'win32')
    return { title: k('noWindowsManager'), description: k('windowsManagerHint') }
  switch (name) {
    case 'brew':
      return { title: k('brewNotFound'), description: `${k('brewRequired')} ${k('brewSite')}.` }
    case 'winget':
      return {
        title: k('wingetNotFound'),
        description: `${k('wingetRequired')} ${k('wingetStore')} ${k('wingetSearchTerm')}`
      }
    case 'choco':
      return { title: k('chocoNotFound'), description: `${k('chocoRequired')} ${k('chocoSite')}.` }
    case 'apt':
      return { title: k('aptNotFound'), description: k('aptRequired') }
    case 'dnf':
      return { title: k('dnfNotFound'), description: k('dnfRequired') }
    case 'pacman':
      return { title: k('pacmanNotFound'), description: k('pacmanRequired') }
    default:
      return { title: k('noPackageManager') }
  }
}

function listFormat(items: string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items)
  } catch {
    return items.join(', ')
  }
}

export function SoftwareUpdaterPage({ embedded }: { embedded?: boolean }) {
  const { t, i18n } = useTranslation('updates')
  const apps = useUpdaterStore((s) => s.apps)
  const loading = useUpdaterStore((s) => s.loading)
  const updating = useUpdaterStore((s) => s.updating)
  const progress = useUpdaterStore((s) => s.progress)
  const updateSummary = useUpdaterStore((s) => s.updateSummary)
  const error = useUpdaterStore((s) => s.error)
  const hasChecked = useUpdaterStore((s) => s.hasChecked)
  const packageManagerAvailable = useUpdaterStore((s) => s.packageManagerAvailable)
  const packageManagerName = useUpdaterStore((s) => s.packageManagerName)
  const managers = useUpdaterStore((s) => s.managers)
  const searchQuery = useUpdaterStore((s) => s.searchQuery)
  const sortField = useUpdaterStore((s) => s.sortField)
  const sortDirection = useUpdaterStore((s) => s.sortDirection)
  const severityFilter = useUpdaterStore((s) => s.severityFilter)

  const upToDate = useUpdaterStore((s) => s.upToDate)

  const ignoredApps = useUpdaterStore((s) => s.ignoredApps)
  const history = useHistoryStore((s) => s.entries)

  const { platform } = usePlatform()
  const windowsPackageManagers = useSettingsStore((s) => s.settings.windowsPackageManagers)
  const enabledManagers = windowsPackageManagers ?? DEFAULT_WINDOWS_MANAGERS
  // Managers that were scanned but never produced a package list (CLI
  // missing, timed out, crashed). Their packages are absent from `apps`, so
  // "everything is up to date" would be misleading without a warning (#462).
  const failedManagers = useMemo(() => managers.filter((m) => m.error), [managers])

  const [showUpToDate, setShowUpToDate] = useState(false)
  const [showIgnored, setShowIgnored] = useState(false)

  // Load persisted ignore list from settings, then auto-scan on first visit
  useEffect(() => {
    window.kudu
      .settingsGet()
      .then((settings) => {
        if (settings.ignoredSoftwareUpdates?.length) {
          useUpdaterStore.getState().loadIgnoredIds(settings.ignoredSoftwareUpdates)
        }
      })
      .catch(() => {})
      .finally(() => {
        const s = useUpdaterStore.getState()
        if (!s.hasChecked && !s.loading) handleCheck()
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Check for updates ──────────────────────────────────────
  const handleCheck = useCallback(async () => {
    const store = useUpdaterStore.getState()
    store.setLoading(true)
    store.setError(null)
    store.setUpdateSummary(null)

    try {
      const result = await window.kudu.softwareUpdateCheck()
      const s = useUpdaterStore.getState()
      s.setApps(result.apps)
      s.setUpToDate(result.upToDate)
      s.setPackageManagerAvailable(result.packageManagerAvailable)
      s.setPackageManagerName(result.packageManagerName)
      s.setManagers(result.managers)
      lastCheckedAt = Date.now()
      s.setHasChecked(true)
      recordCheckRun('updates', lastCheckedAt)

      // Use the visible (non-ignored) count for the toast
      const visibleCount = useUpdaterStore.getState().apps.length
      if (
        result.packageManagerAvailable &&
        visibleCount === 0 &&
        useUpdaterStore.getState().ignoredApps.length === 0 &&
        !result.managers.some((m) => m.error)
      ) {
        toast.success(t('softwareUpdater.toastAllUpToDate'))
      } else if (visibleCount > 0) {
        toast.info(
          visibleCount !== 1
            ? t('softwareUpdater.toastUpdatesFoundPlural', { count: visibleCount })
            : t('softwareUpdater.toastUpdatesFound', { count: visibleCount })
        )
      }
    } catch (err) {
      console.error('Update check failed:', err)
      useUpdaterStore.getState().setError(t('softwareUpdater.errorCheckFailed'))
    } finally {
      useUpdaterStore.getState().setLoading(false)
    }
  }, [])

  // ─── Run updates ────────────────────────────────────────────
  const handleUpdate = useCallback(async (appsToUpdate: UpdatableApp[]) => {
    if (appsToUpdate.length === 0) return
    const store = useUpdaterStore.getState()
    store.setUpdating(true)
    store.setUpdateSummary(null)
    store.setError(null)
    store.setProgress(null)

    const startTime = Date.now()
    const items = appsToUpdate.map((a) => ({ id: a.id, source: a.source, name: a.name }))

    try {
      const result = await window.kudu.softwareUpdateRun(items)
      const summary = buildUpdateSummary(result, appsToUpdate)
      const s = useUpdaterStore.getState()
      s.setUpdateSummary(summary)
      s.setProgress(null)

      // Updated apps leave the list (by composite key, so a failed choco/git
      // doesn't also strip an updated scoop/git). Failed ones stay, and so do
      // those still installing: nothing has confirmed them yet.
      const updatedKeys = new Set(summary.updated.map((e) => e.key))
      if (updatedKeys.size > 0) s.removeApps([...updatedKeys])
      showUpdateSummaryToast(summary)

      // Log to history
      const bySeverity: Record<string, { found: number; updated: number }> = {}
      for (const app of appsToUpdate) {
        const sev = app.severity
        if (!bySeverity[sev]) bySeverity[sev] = { found: 0, updated: 0 }
        bySeverity[sev].found++
        if (updatedKeys.has(appKey(app))) bySeverity[sev].updated++
      }
      await useHistoryStore.getState().addEntry({
        id: Date.now().toString(),
        type: 'software-update',
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        totalItemsFound: appsToUpdate.length,
        totalItemsCleaned: result.succeeded,
        totalItemsSkipped: 0,
        totalSpaceSaved: 0,
        categories: Object.entries(bySeverity).map(([name, d]) => ({
          name: softwareUpdateCategory(name as UpdateSeverity),
          itemsFound: d.found,
          itemsCleaned: d.updated,
          spaceSaved: 0
        })),
        errorCount: result.failed
      })
    } catch (err) {
      console.error('Update failed:', err)
      useUpdaterStore.getState().setError(t('softwareUpdater.errorUpdateFailed'))
    } finally {
      useUpdaterStore.getState().setUpdating(false)
    }
  }, [])

  const handleUpdateSelected = useCallback(() => {
    const selectedApps = useUpdaterStore.getState().apps.filter((a) => a.selected)
    handleUpdate(selectedApps)
  }, [handleUpdate])

  // ─── Toggle a Windows manager on/off (aggregation) ──────────
  const handleToggleManager = useCallback(
    async (manager: WindowsPackageManager) => {
      const current =
        useSettingsStore.getState().settings.windowsPackageManagers ?? DEFAULT_WINDOWS_MANAGERS
      const next = current.includes(manager)
        ? current.filter((m) => m !== manager)
        : [...current, manager]
      // Keep at least one manager enabled
      if (next.length === 0) return
      useSettingsStore.getState().updateSettings({ windowsPackageManagers: next })
      await window.kudu.settingsSet({ windowsPackageManagers: next })
      handleCheck()
    },
    [handleCheck]
  )

  // ─── Filtered & sorted list ─────────────────────────────────
  const filteredApps = useMemo(() => {
    let list = apps

    if (severityFilter !== 'all') {
      list = list.filter((a) => a.severity === severityFilter)
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      list = list.filter((a) => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q))
    }

    const dir = sortDirection === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      switch (sortField) {
        case 'severity':
          return (severityOrder[a.severity] - severityOrder[b.severity]) * dir
        case 'source':
          return a.source.localeCompare(b.source) * dir
        default:
          return a.name.localeCompare(b.name) * dir
      }
    })
  }, [apps, searchQuery, sortField, sortDirection, severityFilter])

  const selectedCount = apps.filter((a) => a.selected).length
  const allSelected = apps.length > 0 && selectedCount === apps.length
  const isBusy = loading || updating

  const count = (severity: UpdateSeverity) => apps.filter((a) => a.severity === severity).length
  const checkedTime = lastCheckedAt ? formatClock(lastCheckedAt, i18n.language) : ''
  const lastRun = history.find((entry) => entry.type === 'software-update')
  const missingManager =
    hasChecked && !packageManagerAvailable
      ? missingManagerCopy(t, platform, packageManagerName)
      : null
  const managerLabel = (name: string) =>
    WINDOWS_MANAGER_OPTIONS.find((o) => o.id === name)?.label ?? name

  const checkButton = (
    <Button
      variant={hasChecked ? 'secondary' : 'primary'}
      icon={RefreshCw}
      busy={loading}
      disabled={updating}
      onClick={handleCheck}
    >
      {hasChecked ? t('softwareUpdater.recheckButton') : t('softwareUpdater.checkForUpdatesButton')}
    </Button>
  )

  return (
    <div>
      {!embedded && (
        <PageHeader
          title={t('softwareUpdater.pageTitle')}
          description={t('softwareUpdater.pageDescription')}
          action={checkButton}
        />
      )}

      <div className="sw-page">
        {/* Package managers included in the check (Windows aggregates several) */}
        {(platform === 'win32' || embedded) && (
          <div
            className="sw-managers"
            role={platform === 'win32' ? 'group' : undefined}
            aria-label={platform === 'win32' ? t('softwareUpdater.packageManagerLabel') : undefined}
          >
            {platform === 'win32' && (
              <>
                <span className="sw-managers-label" aria-hidden="true">
                  {t('softwareUpdater.packageManagerLabel')}
                </span>
                {WINDOWS_MANAGER_OPTIONS.map(({ id, label }) => {
                  const enabled = enabledManagers.includes(id)
                  const status = managers.find((m) => m.name === id)
                  const notInstalled = Boolean(hasChecked && enabled && status && !status.available)
                  return (
                    <Button
                      key={id}
                      icon={enabled ? Check : undefined}
                      aria-pressed={enabled}
                      data-unavailable={notInstalled || undefined}
                      onClick={() => handleToggleManager(id)}
                      disabled={isBusy}
                      title={
                        notInstalled
                          ? t('softwareUpdater.managerNotInstalled', { manager: label })
                          : enabled
                            ? t('softwareUpdater.managerEnabledHint', { manager: label })
                            : t('softwareUpdater.managerDisabledHint', { manager: label })
                      }
                    >
                      {label}
                      {notInstalled && <span>· {t('softwareUpdater.managerMissing')}</span>}
                    </Button>
                  )
                })}
              </>
            )}
            {embedded && <div className="sw-summary-actions">{checkButton}</div>}
          </div>
        )}

        {/* No package manager answered: nothing can be checked */}
        {missingManager && (
          <EmptyState
            icon={icons.warning}
            title={missingManager.title}
            description={missingManager.description}
          />
        )}

        {/* Managers that were reachable but failed to report — partial results */}
        {hasChecked && packageManagerAvailable && failedManagers.length > 0 && (
          <Note
            icon="warning"
            title={t('softwareUpdater.managerScanFailed', {
              manager: listFormat(
                failedManagers.map((m) => managerLabel(m.name)),
                i18n.language
              )
            })}
          >
            <p className="sw-note-text">
              {t('softwareUpdater.managerScanFailedHint', { count: failedManagers.length })}
            </p>
            {failedManagers.map((m) => (
              <p key={m.name} className="sw-note-text sw-muted">
                {managerLabel(m.name)}: {m.error}
              </p>
            ))}
          </Note>
        )}

        {error && (
          <ErrorAlert message={error} onDismiss={() => useUpdaterStore.getState().setError(null)} />
        )}

        {loading && (
          <ProgressCard title={t('softwareUpdater.checkingForUpdates')}>
            <p className="sw-progress-note">{t('softwareUpdater.checkingSubtext')}</p>
          </ProgressCard>
        )}

        {updating && progress && <UpdateProgressPanel progress={progress} />}

        {/* Update summary: stays until dismissed */}
        {updateSummary && (
          <UpdateSummaryBanner
            summary={updateSummary}
            packageManagerName={packageManagerName}
            onDismiss={() => {
              useUpdaterStore.getState().setUpdateSummary(null)
              toast.dismiss(UPDATE_SUMMARY_TOAST_ID)
            }}
          />
        )}

        {/* Before the first check: the real state and what the check reads */}
        {!hasChecked && !loading && (
          <EmptyState
            title={t('softwareUpdater.emptyStateTitle')}
            description={
              lastRun
                ? t('softwareUpdater.lastRun', {
                    count: lastRun.totalItemsCleaned,
                    date: formatDateTime(lastRun.timestamp, i18n.language)
                  })
                : t('softwareUpdater.emptyStateDescription')
            }
            checks={[
              {
                title: t('softwareUpdater.checkManagersTitle'),
                detail:
                  platform === 'win32'
                    ? t('softwareUpdater.checkManagersWindows')
                    : platform === 'darwin'
                      ? t('softwareUpdater.checkManagersMac')
                      : t('softwareUpdater.checkManagersLinux')
              },
              {
                title: t('softwareUpdater.checkVersionsTitle'),
                detail: t('softwareUpdater.checkVersionsDetail')
              },
              {
                title: t('softwareUpdater.checkIgnoredTitle'),
                detail: t('softwareUpdater.checkIgnoredDetail')
              }
            ]}
          />
        )}

        {/* Nothing to update among the apps the included managers know */}
        {hasChecked &&
          !loading &&
          apps.length === 0 &&
          ignoredApps.length === 0 &&
          packageManagerAvailable && (
            <EmptyState
              icon={icons.allUpToDate}
              title={
                checkedTime
                  ? t('softwareUpdater.allUpToDateTitle', { time: checkedTime })
                  : t('softwareUpdater.allUpToDateTitleNoTime')
              }
              description={t('softwareUpdater.allUpToDateDescription')}
            />
          )}

        {/* One summary line in place of the four stat cards */}
        {hasChecked && !loading && packageManagerAvailable && apps.length > 0 && (
          <SummaryCard
            title={t('softwareUpdater.summaryTitle', { count: apps.length })}
            detail={joinFacts([
              count('major') > 0 && t('softwareUpdater.summaryMajor', { count: count('major') }),
              count('minor') > 0 && t('softwareUpdater.summaryMinor', { count: count('minor') }),
              count('patch') > 0 && t('softwareUpdater.summaryPatch', { count: count('patch') }),
              count('unknown') > 0 &&
                t('softwareUpdater.summaryOther', { count: count('unknown') }),
              checkedTime && t('softwareUpdater.checkedAt', { time: checkedTime })
            ])}
            action={
              <Button
                variant="primary"
                icon={icons.updates}
                busy={updating}
                disabled={selectedCount === 0}
                onClick={handleUpdateSelected}
              >
                {t('softwareUpdater.updateSelected', { count: selectedCount })}
              </Button>
            }
          />
        )}

        {/* App list: a named container so off-screen rows can follow the rows' stacked layout */}
        {hasChecked && !loading && apps.length > 0 && (
          <Card className="sw-list">
            <div className="sw-toolbar">
              <label className="sw-select-all">
                <Checkbox
                  checked={allSelected}
                  indeterminate={selectedCount > 0 && !allSelected}
                  onChange={(value) => {
                    const store = useUpdaterStore.getState()
                    if (value) store.selectAll()
                    else store.deselectAll()
                  }}
                  label={t('softwareUpdater.selectAll')}
                  disabled={updating}
                />
                <span>{t('softwareUpdater.selectedCount', { count: selectedCount })}</span>
              </label>
              <div className="sw-toolbar-end">
                <SearchField
                  value={searchQuery}
                  onChange={(value) => useUpdaterStore.getState().setSearchQuery(value)}
                  placeholder={t('softwareUpdater.searchPlaceholder')}
                />
                <Segmented<SeverityFilter>
                  label={t('softwareUpdater.filterLabel')}
                  value={severityFilter}
                  onChange={(value) => useUpdaterStore.getState().setSeverityFilter(value)}
                  options={(Object.keys(FILTER_LABEL_KEYS) as SeverityFilter[]).map((value) => ({
                    value,
                    label: t(FILTER_LABEL_KEYS[value])
                  }))}
                />
                <MenuButton<SortField>
                  icon={ArrowUpDown}
                  label={t(SORT_LABEL_KEYS[sortField])}
                  menuLabel={t('softwareUpdater.sortLabel')}
                  value={sortField}
                  checkedHint={
                    sortDirection === 'asc'
                      ? t('softwareUpdater.sortAsc')
                      : t('softwareUpdater.sortDesc')
                  }
                  options={(Object.keys(SORT_LABEL_KEYS) as SortField[]).map((value) => ({
                    value,
                    label: t(SORT_LABEL_KEYS[value])
                  }))}
                  onSelect={(field) => {
                    const store = useUpdaterStore.getState()
                    if (sortField === field) {
                      store.setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
                    } else {
                      store.setSortField(field)
                      store.setSortDirection('asc')
                    }
                  }}
                />
              </div>
            </div>

            {filteredApps.length === 0 ? (
              <p className="sw-list-empty">{t('softwareUpdater.noAppsMatchFilters')}</p>
            ) : (
              <div className="@container/update-list">
                {filteredApps.map((app) => (
                  <AppRow
                    key={appKey(app)}
                    app={app}
                    updating={updating}
                    onToggle={() => useUpdaterStore.getState().toggleAppSelected(appKey(app))}
                    onUpdate={() => handleUpdate([app])}
                    onIgnore={() => useUpdaterStore.getState().ignoreApp(app)}
                  />
                ))}
              </div>
            )}
          </Card>
        )}

        {hasChecked && !loading && ignoredApps.length > 0 && (
          <Disclosure
            label={t('softwareUpdater.ignoredSection', { count: ignoredApps.length })}
            open={showIgnored}
            onToggle={() => setShowIgnored(!showIgnored)}
          >
            <Card className="sw-list">
              {ignoredApps.map((app) => (
                <IgnoredRow
                  key={appKey(app)}
                  app={app}
                  onUnignore={() => useUpdaterStore.getState().unignoreApp(app)}
                />
              ))}
            </Card>
          </Disclosure>
        )}

        {hasChecked && !loading && packageManagerAvailable && upToDate.length > 0 && (
          <Disclosure
            label={t('softwareUpdater.upToDateSection', { count: upToDate.length })}
            open={showUpToDate}
            onToggle={() => setShowUpToDate(!showUpToDate)}
          >
            <Card className="sw-list">
              {upToDate.map((app) => (
                <UpToDateRow key={`${app.source}:${app.id}`} app={app} />
              ))}
            </Card>
          </Disclosure>
        )}
      </div>
    </div>
  )
}

function SoftwareAppIcon({ app }: { app: UpdatableApp | UpToDateApp }) {
  return <AppIcon iconDataUrl={app.iconDataUrl} small />
}

function AppRow({
  app,
  updating,
  onToggle,
  onUpdate,
  onIgnore
}: {
  app: UpdatableApp
  updating: boolean
  onToggle: () => void
  onUpdate: () => void
  onIgnore: () => void
}) {
  const { t } = useTranslation('updates')
  const recommended = isRecommended(app)
  const updateLabel = `${t('softwareUpdater.updateButton')} ${app.name}`
  const ignoreLabel = `${t('softwareUpdater.ignoreButton')} ${app.name}`

  return (
    <ListRow className="update-row @container" recommended={recommended}>
      <Checkbox checked={app.selected} onChange={onToggle} label={app.name} disabled={updating} />

      <SoftwareAppIcon app={app} />

      {/* App info: never narrower than 120px */}
      <div className="min-w-[120px] flex-1">
        <div className="sw-row-title">
          <span data-audit="app-name" className="sw-row-name" title={app.name}>
            {app.name}
          </span>
          {recommended && <Tag tone="recommended">{t('softwareUpdater.recommended')}</Tag>}
        </div>
        <p className="sw-row-sub" title={app.id}>
          {t(SEVERITY_LABEL_KEYS[app.severity])} · {app.id}
        </p>
        {/* Narrow rows: versions move under the id */}
        <p className="sw-row-sub hidden min-w-0 items-center gap-1.5 @max-[820px]:flex">
          <span
            data-audit="version-current"
            className="sw-mono truncate"
            title={app.currentVersion}
          >
            {app.currentVersion}
          </span>
          <ArrowRight className="shrink-0" size={12} strokeWidth={1.75} aria-hidden="true" />
          <span
            data-audit="version-available"
            className="sw-mono sw-version-new truncate"
            title={app.availableVersion}
          >
            {app.availableVersion}
          </span>
        </p>
      </div>

      {/* Version comparison: bounded, truncated with the full value on hover */}
      <div className="flex max-w-[40%] min-w-0 items-center gap-2 @max-[820px]:hidden">
        <span
          data-audit="version-current"
          className="sw-mono sw-muted truncate"
          title={app.currentVersion}
        >
          {app.currentVersion}
        </span>
        <ArrowRight className="sw-muted shrink-0" size={12} strokeWidth={1.75} aria-hidden="true" />
        <span
          data-audit="version-available"
          className="sw-mono sw-version-new truncate"
          title={app.availableVersion}
        >
          {app.availableVersion}
        </span>
      </div>

      <span className="sw-row-meta shrink-0">{app.source}</span>

      <div className="sw-row-actions">
        <Button
          variant="ghost"
          icon={EyeOff}
          onClick={onIgnore}
          disabled={updating}
          title={t('softwareUpdater.ignoreButton')}
          aria-label={ignoreLabel}
        />
        {/* Icon only in narrow rows; the label keeps the app name for screen readers */}
        <span className="@max-[820px]:hidden">
          <Button
            icon={icons.updates}
            onClick={onUpdate}
            disabled={updating}
            aria-label={updateLabel}
          >
            {t('softwareUpdater.updateButton')}
          </Button>
        </span>
        <span className="hidden @max-[820px]:inline-flex">
          <Button
            icon={icons.updates}
            onClick={onUpdate}
            disabled={updating}
            title={t('softwareUpdater.updateButton')}
            aria-label={updateLabel}
          />
        </span>
      </div>
    </ListRow>
  )
}

function IgnoredRow({ app, onUnignore }: { app: UpdatableApp; onUnignore: () => void }) {
  const { t } = useTranslation('updates')
  return (
    <ListRow data-muted="">
      <SoftwareAppIcon app={app} />
      <div className="min-w-0 flex-1">
        <span className="sw-row-name block" title={app.name}>
          {app.name}
        </span>
        <p className="sw-row-sub" title={app.id}>
          {app.id}
        </p>
      </div>
      <p className="sw-row-sub flex shrink-0 items-center gap-1.5">
        <span className="sw-mono">{app.currentVersion}</span>
        <ArrowRight className="shrink-0" size={12} strokeWidth={1.75} aria-hidden="true" />
        <span className="sw-mono">{app.availableVersion}</span>
      </p>
      <Button
        variant="ghost"
        icon={Eye}
        onClick={onUnignore}
        aria-label={`${t('softwareUpdater.unignoreButton')} ${app.name}`}
      >
        {t('softwareUpdater.unignoreButton')}
      </Button>
    </ListRow>
  )
}

function UpToDateRow({ app }: { app: UpToDateApp }) {
  return (
    <ListRow data-muted="">
      <SoftwareAppIcon app={app} />
      <div className="min-w-0 flex-1">
        <span className="sw-row-name block" title={app.name}>
          {app.name}
        </span>
        <p className="sw-row-sub" title={app.id}>
          {app.id}
        </p>
      </div>
      <span className="sw-row-meta sw-mono shrink-0">{app.version}</span>
    </ListRow>
  )
}
