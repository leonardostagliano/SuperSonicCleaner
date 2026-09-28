import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { ChevronDown, Lock, Power, PowerOff, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Receipt } from '@/components/shared/Receipt'
import { Button, Card, Checkbox, ListRow, Tag } from '@/components/ui'
import { Note, ProgressCard, SearchField, SummaryCard } from '@/components/software/SoftwareBlocks'
import { joinFacts } from '@/components/software/format'
import { usePlatform } from '@/hooks/usePlatform'
import { progressText } from '@/lib/progress-label'
import { useContextMenuStore } from '@/stores/context-menu-store'
import type {
  ContextMenuAction,
  ContextMenuApplyRequest,
  ContextMenuEntry,
  ContextMenuScope,
  ContextMenuSource,
  ContextMenuStatus
} from '@shared/types'

const WIN11_NOTICE_KEY = 'kudu.contextMenu.win11Notice.dismissed'

// Sources we hide from the list unconditionally — these are first-party Windows
// pieces that the user almost never wants to disable, and showing them buries
// the third-party noise the page is actually for.
const HIDDEN_SOURCES: ReadonlySet<ContextMenuSource> = new Set(['Microsoft', 'Windows', 'Defender'])

const SCOPE_LABEL_KEY: Record<ContextMenuScope, string> = {
  AllFiles: 'scopeAllFiles',
  Directory: 'scopeDirectory',
  DirectoryBackground: 'scopeDirectoryBackground',
  Folder: 'scopeFolder',
  Drive: 'scopeDrive',
  AllFilesystemObjects: 'scopeAllFilesystemObjects',
  ProgID: 'scopeProgID'
}

export function ContextMenuCleanerPage() {
  const { features } = usePlatform()
  const { t } = useTranslation('contextMenu')

  if (!features.contextMenu) {
    return (
      <div>
        <PageHeader
          title={t('pageHeaderUnavailableTitle')}
          description={t('pageHeaderUnavailableDescription')}
        />
        <EmptyState title={t('notAvailableTitle')} description={t('notAvailableDescription')} />
      </div>
    )
  }
  return <ContextMenuCleanerPageContent />
}

function ContextMenuCleanerPageContent() {
  const { t } = useTranslation('contextMenu')

  const entries = useContextMenuStore((s) => s.entries)
  const scanning = useContextMenuStore((s) => s.scanning)
  const scanned = useContextMenuStore((s) => s.scanned)
  const applying = useContextMenuStore((s) => s.applying)
  const applyProg = useContextMenuStore((s) => s.applyProgress)
  const applyResult = useContextMenuStore((s) => s.applyResult)
  const showErrors = useContextMenuStore((s) => s.showErrors)
  const error = useContextMenuStore((s) => s.error)
  const filters = useContextMenuStore((s) => s.filters)
  const expanded = useContextMenuStore((s) => s.expandedGroups)

  const [showWin11, setShowWin11] = useState(() => {
    try {
      return !localStorage.getItem(WIN11_NOTICE_KEY)
    } catch {
      return true
    }
  })
  const [pendingDelete, setPendingDelete] = useState<ContextMenuApplyRequest[] | null>(null)
  const handleScan = useCallback(async () => {
    const store = useContextMenuStore.getState()
    store.setScanning(true)
    store.setScanned(false)
    store.setEntries([])
    store.setApplyResult(null)
    store.setError(null)
    try {
      const result = await window.kudu.contextMenuScan()
      const sorted = [...(result.entries ?? [])].sort((a, b) => {
        if (a.source === b.source) return a.displayName.localeCompare(b.displayName)
        if (a.source === 'Unknown') return 1
        if (b.source === 'Unknown') return -1
        return a.source.localeCompare(b.source)
      })
      useContextMenuStore.getState().setEntries(sorted)
      useContextMenuStore.getState().setScanned(true)
    } catch (err) {
      console.error('Context-menu scan failed:', err)
      toast.error(t('toastScanFailed'), { description: t('toastScanFailedDescription') })
      useContextMenuStore.getState().setError(t('toastScanFailedDescription'))
    }
    useContextMenuStore.getState().setScanning(false)
  }, [t])

  const handleScanCancel = useCallback(async () => {
    try {
      await window.kudu.contextMenuScanCancel()
    } catch {
      /* ignore */
    }
    useContextMenuStore.getState().setScanning(false)
  }, [])

  const dismissWin11 = useCallback(() => {
    try {
      localStorage.setItem(WIN11_NOTICE_KEY, '1')
    } catch {
      /* skip */
    }
    setShowWin11(false)
  }, [])

  // Always strip Microsoft/Windows/Defender + protected entries before any
  // user-controlled filtering — those are first-party / safelisted and we never
  // want to surface them in the list (or in the filter dropdowns). Also hide
  // HKCR entries with no command and no DLL path (e.g. HKCR\*\shell\removeproperties),
  // which tend to be Windows built-in verbs that resolve via MUIVerb resources —
  // we can't tell what they do and they're machine-wide, so hide for safety.
  // Finally, hide entries whose registry key name contains a cmd.exe shell
  // metacharacter (e.g. WizTree's `Wi&zTree`): writes to those HKCR paths
  // routinely fail with "key not found" because the key only exists via the
  // HKCU\Software\Classes mirror, and a click would just produce a confusing
  // reg.exe error.
  const baseEntries = useMemo(
    () =>
      entries.filter((e) => {
        if (e.protected) return false
        if (HIDDEN_SOURCES.has(e.source)) return false
        if (e.hive === 'HKCR' && !e.command && !e.dllPath) return false
        if (/[&|<>^]/.test(e.name)) return false
        return true
      }),
    [entries]
  )

  // Filtered list
  const visible = useMemo(() => filterEntries(baseEntries, filters), [baseEntries, filters])

  // Group by binary name (executable / DLL) — most third-party entries land in
  // the 'Unknown' source bucket, so source-based grouping collapsed everything
  // into one giant group.
  const groups = useMemo(() => groupByBinary(visible), [visible])
  const programCount = useMemo(() => groupByBinary(baseEntries).length, [baseEntries])
  const disabledCount = baseEntries.filter((e) => e.status === 'disabled').length

  // Available filter options derived from the post-hidden list, so the source
  // dropdown doesn't offer Microsoft/Windows/Defender (which would filter to
  // an empty list).
  const availableSources = useMemo(() => {
    const set = new Set<ContextMenuSource>()
    for (const e of baseEntries) set.add(e.source)
    return Array.from(set).sort()
  }, [baseEntries])
  const availableScopes = useMemo(() => {
    const set = new Set<ContextMenuScope>()
    for (const e of baseEntries) set.add(e.scope)
    return Array.from(set).sort()
  }, [baseEntries])

  const selectedRequests = useMemo(
    () => entries.filter((e) => e.selected && !e.protected),
    [entries]
  )
  const selectedCount = selectedRequests.length

  const buildRequests = (action: ContextMenuAction): ContextMenuApplyRequest[] =>
    selectedRequests.map((e) => ({ entryId: e.id, action }))

  const handleApply = useCallback(
    async (action: ContextMenuAction, requests?: ContextMenuApplyRequest[]) => {
      // Read selection from the store at call time — closing over `selectedRequests`
      // (or `buildRequests`) here would freeze the empty initial selection inside the
      // memoised callback and turn bulk-action clicks into no-ops.
      const reqs =
        requests ??
        useContextMenuStore
          .getState()
          .entries.filter((e) => e.selected && !e.protected)
          .map((e) => ({ entryId: e.id, action }))
      if (reqs.length === 0) return
      const store = useContextMenuStore.getState()
      store.setApplying(true)
      store.setApplyResult(null)
      store.setApplyProgress({ current: 0, total: reqs.length, currentLabel: t('applyingTitle') })
      try {
        const result = await window.kudu.contextMenuApply(reqs)
        const s = useContextMenuStore.getState()
        s.setApplyResult(result)
        if (result.updates.length > 0) s.applyUpdates(result.updates)
        if (action === 'delete') {
          const ok = new Set(result.updates.map((u) => u.entryId))
          const succeededIds = reqs.filter((r) => ok.has(r.entryId)).map((r) => r.entryId)
          if (succeededIds.length > 0) s.removeEntries(succeededIds)
        }
      } catch (err) {
        console.error('Context-menu apply failed:', err)
        toast.error(t('toastApplyFailed'), { description: t('toastApplyFailedDescription') })
        useContextMenuStore.getState().setError(t('toastApplyFailedDescription'))
      }
      useContextMenuStore.getState().setApplying(false)
      useContextMenuStore.getState().setApplyProgress(null)
    },
    [t]
  )

  const onConfirmDelete = useCallback(() => {
    const reqs = pendingDelete
    setPendingDelete(null)
    if (reqs) handleApply('delete', reqs)
  }, [pendingDelete, handleApply])

  const requiresAdminInSelection = selectedRequests.some((e) => e.requiresAdmin)
  const deleteCount = pendingDelete?.length ?? 0
  const showBar = selectedCount > 0 && !applying

  return (
    <div className={showBar ? 'sw-has-selection-bar' : undefined}>
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <Button
            variant={scanned ? 'secondary' : 'primary'}
            icon={Search}
            busy={scanning}
            disabled={applying}
            onClick={handleScan}
          >
            {scanned ? t('rescanButton') : t('scanButton')}
          </Button>
        }
      />

      <div className="sw-page">
        {showWin11 && (
          <Note
            icon="note"
            title={t('win11NoticeTitle')}
            onDismiss={dismissWin11}
            dismissLabel={t('win11NoticeDismiss')}
          >
            {t('win11NoticeBody')}
          </Note>
        )}

        {error && (
          <ErrorAlert
            message={error}
            onDismiss={() => useContextMenuStore.getState().setError(null)}
          />
        )}

        {scanning && (
          <ProgressCard
            title={t('scanningLabel')}
            action={
              <Button variant="ghost" onClick={handleScanCancel}>
                {t('cancelButton')}
              </Button>
            }
          />
        )}

        {applying && applyProg && (
          <ProgressCard
            title={t('applyingTitle')}
            meta={t('progressCount', { current: applyProg.current, total: applyProg.total })}
            value={applyProg.total > 0 ? applyProg.current / applyProg.total : undefined}
            detail={progressText(t, applyProg.currentLabel)}
          />
        )}

        {applyResult && (
          <Receipt
            title={t('receiptTitle')}
            value={t('receiptUpdated', { count: applyResult.succeeded })}
            facts={[
              applyResult.failed > 0 ? t('receiptFailed', { count: applyResult.failed }) : ''
            ]}
            links={
              applyResult.failed > 0 && applyResult.errors.length > 0 ? (
                <button
                  type="button"
                  className="sw-text-button"
                  aria-expanded={showErrors}
                  onClick={() => useContextMenuStore.getState().setShowErrors(!showErrors)}
                >
                  {showErrors ? t('applyHideFailures') : t('applyShowFailures')}
                </button>
              ) : undefined
            }
          />
        )}
        {applyResult && showErrors && applyResult.errors.length > 0 && (
          <Card className="sw-list">
            {applyResult.errors.map((err, i) => (
              <ListRow key={`${err.entryId}-${i}`}>
                <div className="min-w-0 flex-1">
                  <span className="sw-row-name block">{err.displayName}</span>
                  <p className="sw-row-sub sw-danger-text" title={progressText(t, err.reason)}>
                    {progressText(t, err.reason)}
                  </p>
                </div>
              </ListRow>
            ))}
          </Card>
        )}

        {/* Before the first scan: the real state and what the scan reads */}
        {!scanned && !scanning && (
          <EmptyState
            title={t('emptyStateTitle')}
            description={t('emptyStateDescription')}
            checks={[
              { title: t('checkVerbsTitle'), detail: t('checkVerbsDetail') },
              { title: t('checkHandlersTitle'), detail: t('checkHandlersDetail') },
              { title: t('checkHiddenTitle'), detail: t('checkHiddenDetail') }
            ]}
          />
        )}

        {scanned && baseEntries.length > 0 && (
          <SummaryCard
            title={t('summaryTitle', { count: baseEntries.length })}
            detail={joinFacts([
              t('summaryPrograms', { count: programCount }),
              disabledCount > 0 && t('summaryDisabled', { count: disabledCount })
            ])}
          />
        )}

        {requiresAdminInSelection && selectedCount > 0 && !applying && (
          <Note
            icon="warning"
            action={
              <Button onClick={() => window.kudu.elevationRelaunch?.().catch(() => {})}>
                {t('elevationRelaunch')}
              </Button>
            }
          >
            {t('elevationPrompt')}
          </Note>
        )}

        {scanned && (baseEntries.length > 0 || visible.length === 0) && (
          <Card className="sw-list">
            {entries.length > 0 && (
              <FilterBar
                filters={filters}
                availableScopes={availableScopes}
                availableSources={availableSources}
                onChange={(key, value) => useContextMenuStore.getState().setFilter(key, value)}
              />
            )}

            {visible.length === 0 && (
              <div className="sw-list-empty">
                <p className="sw-note-title">{t('noResultsTitle')}</p>
                <p className="m-0">{t('noResultsDescription')}</p>
              </div>
            )}

            {groups.map((group) => {
              const groupKey = `bin:${group.binary}`
              const isExpanded = expanded.has(groupKey)
              const eligibleIds = group.entries.filter((e) => !e.protected).map((e) => e.id)
              const selectedInGroup = group.entries.filter((e) => e.selected).length
              const allSelected = eligibleIds.length > 0 && selectedInGroup === eligibleIds.length
              return (
                <div key={groupKey} className="sw-group" data-busy={applying || undefined}>
                  <div className="sw-group-head">
                    {eligibleIds.length > 0 ? (
                      <Checkbox
                        checked={allSelected}
                        indeterminate={selectedInGroup > 0 && !allSelected}
                        onChange={(value) =>
                          useContextMenuStore.getState().toggleAllVisible(eligibleIds, value)
                        }
                        label={t('groupSelectAll', { name: group.binary })}
                      />
                    ) : (
                      <span className="sw-group-spacer" aria-hidden="true" />
                    )}
                    <span className="sw-group-name sw-mono" title={group.binary}>
                      {group.binary}
                    </span>
                    <span className="sw-row-meta sw-muted">
                      {t('groupCount', { count: group.entries.length })}
                    </span>
                    <Button
                      variant="ghost"
                      icon={ChevronDown}
                      className="sw-group-toggle"
                      aria-expanded={isExpanded}
                      aria-label={t(isExpanded ? 'groupCollapse' : 'groupExpand', {
                        name: group.binary
                      })}
                      onClick={() => useContextMenuStore.getState().toggleGroup(groupKey)}
                    />
                  </div>

                  {isExpanded &&
                    group.entries.map((entry) => (
                      <EntryRow
                        key={entry.id}
                        entry={entry}
                        onToggle={() => useContextMenuStore.getState().toggleEntry(entry.id)}
                        onAction={(action) => {
                          if (action === 'delete') {
                            setPendingDelete([{ entryId: entry.id, action }])
                          } else {
                            handleApply(action, [{ entryId: entry.id, action }])
                          }
                        }}
                      />
                    ))}
                </div>
              )
            })}
          </Card>
        )}
      </div>

      {/* Disabling is reversible, deleting is not: only the delete confirmation is red */}
      {showBar && (
        <div
          className="sw-selection-bar"
          role="toolbar"
          aria-label={t('selectedCount', { count: selectedCount })}
        >
          <span className="sw-selection-count">{t('selectedCount', { count: selectedCount })}</span>
          <Button variant="primary" icon={PowerOff} onClick={() => handleApply('disable')}>
            {t('disableSelected')}
          </Button>
          <Button icon={Power} onClick={() => handleApply('enable')}>
            {t('enableSelected')}
          </Button>
          <Button icon={Trash2} onClick={() => setPendingDelete(buildRequests('delete'))}>
            {t('deleteSelected')}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onConfirm={onConfirmDelete}
        onCancel={() => setPendingDelete(null)}
        title={t('confirmDeleteTitle', { count: deleteCount })}
        description={t('confirmDeleteDescription', { count: deleteCount })}
        confirmLabel={t('confirmDeleteLabel', { count: deleteCount })}
        variant="danger"
      />
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Sources are program names, except the bucket for entries no program claims. */
function sourceLabel(t: TFunction, source: ContextMenuSource): string {
  return source === 'Unknown' ? t('sourceUnknown') : source
}

function filterEntries(
  entries: ContextMenuEntry[],
  filters: {
    search: string
    scope: ContextMenuScope | 'all'
    source: ContextMenuSource | 'all'
    status: ContextMenuStatus | 'all'
  }
): ContextMenuEntry[] {
  const search = filters.search.trim().toLowerCase()
  return entries.filter((e) => {
    if (filters.scope !== 'all' && e.scope !== filters.scope) return false
    if (filters.source !== 'all' && e.source !== filters.source) return false
    if (filters.status !== 'all' && e.status !== filters.status) return false
    if (search) {
      const haystack = [e.displayName, e.name, e.command ?? '', e.dllPath ?? '', e.clsid ?? '']
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(search)) return false
    }
    return true
  })
}

/**
 * Pull the executable / DLL basename out of a verb's command line or a
 * handler's resolved DLL path. Falls back to the registry key name when
 * neither is available (e.g. a handler whose CLSID couldn't be resolved).
 */
function binaryNameOf(entry: ContextMenuEntry): string {
  if (entry.command) {
    // command may be `"C:\path\bin.exe" "%1"` or bare `C:\path\bin.exe %1`.
    const m = entry.command.match(/^\s*"([^"]+)"|^\s*(\S+)/)
    const path = (m?.[1] ?? m?.[2] ?? '').trim()
    const base = path.split(/[\\/]/).pop()?.trim()
    if (base) return base
  }
  if (entry.dllPath) {
    const base = entry.dllPath.split(/[\\/]/).pop()?.trim()
    if (base) return base
  }
  return entry.name || '(unknown)'
}

function groupByBinary(
  entries: ContextMenuEntry[]
): { binary: string; entries: ContextMenuEntry[] }[] {
  const map = new Map<string, ContextMenuEntry[]>()
  for (const e of entries) {
    const key = binaryNameOf(e)
    const list = map.get(key) ?? []
    list.push(e)
    map.set(key, list)
  }
  return Array.from(map.entries())
    .map(([binary, list]) => ({ binary, entries: list }))
    .sort((a, b) => a.binary.localeCompare(b.binary))
}

interface EntryRowProps {
  entry: ContextMenuEntry
  onToggle: () => void
  onAction: (action: ContextMenuAction) => void
}

function EntryRow({ entry, onToggle, onAction }: EntryRowProps) {
  const { t } = useTranslation('contextMenu')
  const subline = entry.command || entry.dllPath || entry.clsid || entry.keyPath
  const enabled = entry.status === 'enabled'
  return (
    <ListRow data-muted={entry.protected || undefined}>
      <Checkbox
        checked={entry.selected}
        disabled={entry.protected}
        onChange={onToggle}
        label={entry.displayName}
      />

      <div className="min-w-0 flex-1">
        <div className="sw-row-title">
          <span className="sw-row-name" title={entry.displayName}>
            {entry.displayName}
          </span>
          <Tag tone="neutral">{t(SCOPE_LABEL_KEY[entry.scope])}</Tag>
          {entry.kind === 'handler' && <Tag tone="neutral">{t('kindHandler')}</Tag>}
          {entry.protected && (
            <span className="sw-row-meta sw-muted" title={t('protectedTooltip')}>
              <Lock size={12} strokeWidth={1.75} aria-hidden="true" /> {t('protectedBadge')}
            </span>
          )}
          {entry.requiresAdmin && (
            <span title={t('adminTooltip')}>
              <Tag tone="neutral">{t('adminBadge')}</Tag>
            </span>
          )}
        </div>
        <p className="sw-row-sub sw-mono" title={subline}>
          {subline}
        </p>
      </div>

      <span className={enabled ? 'sw-row-meta shrink-0' : 'sw-row-meta sw-muted shrink-0'}>
        {enabled ? t('statusEnabled') : t('statusDisabled')}
        <span className="sw-row-meta-sub">{sourceLabel(t, entry.source)}</span>
      </span>
      {!entry.protected && (
        <div className="sw-row-actions">
          {enabled ? (
            <Button
              variant="ghost"
              icon={PowerOff}
              onClick={() => onAction('disable')}
              title={t('actionDisable')}
              aria-label={`${t('actionDisable')} ${entry.displayName}`}
            />
          ) : (
            <Button
              variant="ghost"
              icon={Power}
              onClick={() => onAction('enable')}
              title={t('actionEnable')}
              aria-label={`${t('actionEnable')} ${entry.displayName}`}
            />
          )}
          <Button
            variant="ghost"
            icon={Trash2}
            onClick={() => onAction('delete')}
            title={t('actionDelete')}
            aria-label={`${t('actionDelete')} ${entry.displayName}`}
          />
        </div>
      )}
    </ListRow>
  )
}

interface FilterBarProps {
  filters: {
    search: string
    scope: ContextMenuScope | 'all'
    source: ContextMenuSource | 'all'
    status: ContextMenuStatus | 'all'
  }
  availableScopes: ContextMenuScope[]
  availableSources: ContextMenuSource[]
  onChange: <K extends 'search' | 'scope' | 'source' | 'status'>(
    key: K,
    value: FilterBarProps['filters'][K]
  ) => void
}

function FilterBar({ filters, availableScopes, availableSources, onChange }: FilterBarProps) {
  const { t } = useTranslation('contextMenu')
  return (
    <div className="sw-toolbar">
      <SearchField
        value={filters.search}
        onChange={(value) => onChange('search', value)}
        placeholder={t('filterSearchPlaceholder')}
      />
      <div className="sw-toolbar-end">
        <select
          className="sw-select"
          aria-label={t('filterScopeLabel')}
          value={filters.scope}
          onChange={(e) => onChange('scope', e.target.value as ContextMenuScope | 'all')}
        >
          <option value="all">{t('filterScopeAll')}</option>
          {availableScopes.map((s) => (
            <option key={s} value={s}>
              {t(SCOPE_LABEL_KEY[s])}
            </option>
          ))}
        </select>
        <select
          className="sw-select"
          aria-label={t('filterSourceLabel')}
          value={filters.source}
          onChange={(e) => onChange('source', e.target.value as ContextMenuSource | 'all')}
        >
          <option value="all">{t('filterSourceAll')}</option>
          {availableSources.map((s) => (
            <option key={s} value={s}>
              {sourceLabel(t, s)}
            </option>
          ))}
        </select>
        <select
          className="sw-select"
          aria-label={t('filterStatusLabel')}
          value={filters.status}
          onChange={(e) => onChange('status', e.target.value as ContextMenuStatus | 'all')}
        >
          <option value="all">{t('filterStatusAll')}</option>
          <option value="enabled">{t('filterStatusEnabled')}</option>
          <option value="disabled">{t('filterStatusDisabled')}</option>
        </select>
      </div>
    </div>
  )
}
