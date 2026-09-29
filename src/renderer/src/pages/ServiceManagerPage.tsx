import { useState, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Link2, Play, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import '@/components/services/service-manager.css'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Receipt } from '@/components/shared/Receipt'
import { formatDateTime } from '@/components/perf/perf-summary'
import { Button } from '@/components/ui/Button'
import { Card, Section } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Tag } from '@/components/ui/Tag'
import { usePlatform } from '@/hooks/usePlatform'
import { icons } from '@/lib/icons'
import { progressText } from '@/lib/progress-label'
import { useServiceStore } from '@/stores/service-store'
import { useHistoryStore } from '@/stores/history-store'
import type { ServiceApplyResult, WindowsService, ServiceCategory } from '@shared/types'

const START_TYPE_KEY_MAP: Record<string, string> = {
  Automatic: 'serviceManager.startTypeAutomatic',
  Manual: 'serviceManager.startTypeManual',
  Disabled: 'serviceManager.startTypeDisabled',
  Unknown: 'serviceManager.startTypeUnknown'
}

const STATUS_KEY_MAP: Record<string, string> = {
  Running: 'serviceManager.statusRunning',
  Stopped: 'serviceManager.statusStopped',
  Paused: 'serviceManager.statusPaused',
  StartPending: 'serviceManager.statusStartPending',
  StopPending: 'serviceManager.statusStopPending',
  Unknown: 'serviceManager.statusUnknown'
}

type ApplyMode = 'disable' | 'enable'

/** Selecting a disabled service means "restore it"; anything else means "disable it". */
function isTarget(svc: WindowsService, mode: ApplyMode): boolean {
  return mode === 'enable' ? svc.startType === 'Disabled' : svc.startType !== 'Disabled'
}

/** What "Seleziona i consigliati" picks (service-store selectRecommended): marked amber. */
function isRecommended(svc: WindowsService): boolean {
  return svc.safety === 'safe' && svc.startType !== 'Disabled'
}

const CATEGORY_LABEL_KEYS: Record<ServiceCategory | 'all', string> = {
  all: 'serviceManager.filterAllCategories',
  telemetry: 'serviceManager.categoryTelemetry',
  xbox: 'serviceManager.categoryXbox',
  print: 'serviceManager.categoryPrint',
  fax: 'serviceManager.categoryFax',
  media: 'serviceManager.categoryMedia',
  network: 'serviceManager.categoryNetwork',
  bluetooth: 'serviceManager.categoryBluetooth',
  remote: 'serviceManager.categoryRemote',
  'hyper-v': 'serviceManager.categoryHyperV',
  developer: 'serviceManager.categoryDeveloper',
  misc: 'serviceManager.categoryMisc',
  core: 'serviceManager.categoryCore',
  security: 'serviceManager.categorySecurity',
  unknown: 'serviceManager.categoryOther'
}

const RecommendedIcon = icons.applyRecommended

export function ServiceManagerPage({ embedded }: { embedded?: boolean }) {
  const { t, i18n } = useTranslation('hardening')
  const { platform } = usePlatform()
  const locale = i18n.language
  const services = useServiceStore((s) => s.services)
  const scanning = useServiceStore((s) => s.scanning)
  const applying = useServiceStore((s) => s.applying)
  const scanProgress = useServiceStore((s) => s.scanProgress)
  const applyResult = useServiceStore((s) => s.applyResult)
  const error = useServiceStore((s) => s.error)
  const hasScanned = useServiceStore((s) => s.hasScanned)
  const searchQuery = useServiceStore((s) => s.searchQuery)
  const safetyFilter = useServiceStore((s) => s.safetyFilter)
  const categoryFilter = useServiceStore((s) => s.categoryFilter)
  const statusFilter = useServiceStore((s) => s.statusFilter)
  const enableStartType = useServiceStore((s) => s.enableStartType)
  const lastChange = useHistoryStore((s) => s.entries.find((entry) => entry.type === 'services'))

  const [confirmMode, setConfirmMode] = useState<ApplyMode | null>(null)
  const [appliedMode, setAppliedMode] = useState<ApplyMode>('disable')
  const [appliedAt, setAppliedAt] = useState<string | null>(null)
  const isBusy = scanning || applying

  // ─── Scan ──────────────────────────────────────────────────
  const handleScan = useCallback(async () => {
    const store = useServiceStore.getState()
    store.setScanning(true)
    store.setServices([])
    store.setApplyResult(null)
    store.setError(null)
    store.setScanProgress(null)

    try {
      const result = await window.kudu.serviceScan()
      const s = useServiceStore.getState()
      s.setServices(result.services)
      s.setHasScanned(true)
    } catch (err) {
      toast.error(t('serviceManager.scanFailedToast'))
      useServiceStore
        .getState()
        .setError(err instanceof Error ? err.message : t('serviceManager.scanFailedError'))
    } finally {
      useServiceStore.getState().setScanning(false)
      useServiceStore.getState().setScanProgress(null)
    }
  }, [t])

  // Auto-scan on first visit; the last change (for the empty state) comes from the history
  useEffect(() => {
    if (!hasScanned && !scanning) handleScan()
    const history = useHistoryStore.getState()
    if (!history.loaded) void history.load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Apply ─────────────────────────────────────────────────
  const handleApply = useCallback(
    async (mode: ApplyMode) => {
      setConfirmMode(null)
      const store = useServiceStore.getState()
      const selected = store.services.filter((s) => s.selected && isTarget(s, mode))
      if (selected.length === 0) return

      setAppliedMode(mode)
      store.setApplying(true)
      store.setApplyResult(null)
      store.setError(null)

      const startTime = Date.now()
      const targetStartType = mode === 'disable' ? 'Disabled' : store.enableStartType
      const changes = selected.map((s) => ({
        name: s.name,
        targetStartType
      }))

      try {
        const result = await window.kudu.serviceApply(changes)
        setAppliedAt(new Date().toISOString())
        useServiceStore.getState().setApplyResult(result)
        if (result.succeeded > 0) {
          const key =
            mode === 'disable'
              ? result.succeeded > 1
                ? 'serviceManager.serviceDisabledToastPlural'
                : 'serviceManager.serviceDisabledToast'
              : result.succeeded > 1
                ? 'serviceManager.serviceEnabledToastPlural'
                : 'serviceManager.serviceEnabledToast'
          toast.success(t(key, { count: result.succeeded }))
        }
        if (result.failed > 0)
          toast.error(
            t(
              result.failed > 1
                ? 'serviceManager.serviceFailedToastPlural'
                : 'serviceManager.serviceFailedToast',
              { count: result.failed }
            )
          )

        // Re-scan to refresh state
        const scanResult = await window.kudu.serviceScan()
        useServiceStore.getState().setServices(scanResult.services)

        // Log to history
        const byCat: Record<string, { found: number; changed: number }> = {}
        for (const svc of selected) {
          const cat = svc.category
          if (!byCat[cat]) byCat[cat] = { found: 0, changed: 0 }
          byCat[cat].found++
          if (!result.errors.some((e) => e.name === svc.name)) byCat[cat].changed++
        }
        await useHistoryStore.getState().addEntry({
          id: Date.now().toString(),
          type: 'services',
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime,
          totalItemsFound: selected.length,
          totalItemsCleaned: result.succeeded,
          totalItemsSkipped: 0,
          totalSpaceSaved: 0,
          categories: Object.entries(byCat).map(([name, d]) => ({
            name,
            itemsFound: d.found,
            itemsCleaned: d.changed,
            spaceSaved: 0
          })),
          errorCount: result.failed
        })
      } catch (err) {
        toast.error(t('serviceManager.applyFailedToast'))
        useServiceStore
          .getState()
          .setError(err instanceof Error ? err.message : t('serviceManager.applyFailedError'))
      } finally {
        useServiceStore.getState().setApplying(false)
      }
    },
    [t]
  )

  const handleSelectRecommended = useCallback(() => {
    useServiceStore.getState().selectRecommended()
  }, [])

  // ─── Filtering ─────────────────────────────────────────────
  const filteredServices = useMemo(() => {
    let result = services

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.displayName.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q)
      )
    }

    if (safetyFilter !== 'all') {
      result = result.filter((s) => s.safety === safetyFilter)
    }

    if (categoryFilter !== 'all') {
      result = result.filter((s) => s.category === categoryFilter)
    }

    if (statusFilter !== 'all') {
      if (statusFilter === 'running') result = result.filter((s) => s.status === 'Running')
      else if (statusFilter === 'stopped') result = result.filter((s) => s.status === 'Stopped')
      else if (statusFilter === 'disabled')
        result = result.filter((s) => s.startType === 'Disabled')
    }

    return result
  }, [services, searchQuery, safetyFilter, categoryFilter, statusFilter])

  // A selected service is either on its way to Disabled or on its way back —
  // which one depends only on where it is now.
  const disableTargets = services.filter((s) => s.selected && isTarget(s, 'disable'))
  const enableTargets = services.filter((s) => s.selected && isTarget(s, 'enable'))
  const disableCount = disableTargets.length
  const enableCount = enableTargets.length
  const totalSafeToDisable = services.filter(isRecommended).length
  const runningCount = services.filter((s) => s.status === 'Running').length
  const disabledCount = services.filter((s) => s.startType === 'Disabled').length
  const selectedCount = disableCount + enableCount

  // ─── Categories present in scan results ────────────────────
  const presentCategories = useMemo(() => {
    const cats = new Set<ServiceCategory>()
    for (const s of services) cats.add(s.category)
    return cats
  }, [services])

  // ─── Group by safety level ────────────────────────────────
  const safetyGroups = useMemo(() => {
    const groups: {
      key: 'safe' | 'caution' | 'unsafe'
      label: string
      services: typeof filteredServices
    }[] = [
      {
        key: 'safe',
        label: t('serviceManager.safeToDisableGroup'),
        services: filteredServices.filter((s) => s.safety === 'safe')
      },
      {
        key: 'caution',
        label: t('serviceManager.useCautionGroup'),
        services: filteredServices.filter((s) => s.safety === 'caution')
      },
      {
        key: 'unsafe',
        label: t('serviceManager.systemCriticalGroup'),
        services: filteredServices.filter((s) => s.safety === 'unsafe')
      }
    ]
    return groups.filter((g) => g.services.length > 0)
  }, [filteredServices, t])

  const confirmTargets = confirmMode === 'enable' ? enableTargets : disableTargets

  return (
    <div className="feature-page service-manager-page">
      {!embedded && (
        <PageHeader
          title={t('serviceManager.pageTitle')}
          description={t('serviceManager.pageDescription')}
          action={
            <Button icon={RefreshCw} busy={scanning} disabled={isBusy} onClick={handleScan}>
              {scanning
                ? t('serviceManager.scanningButton')
                : hasScanned
                  ? t('serviceManager.rescanButton')
                  : t('serviceManager.scanServicesButton')}
            </Button>
          }
        />
      )}

      <div className="svc-stack">
        {error && (
          <ErrorAlert message={error} onDismiss={() => useServiceStore.getState().setError(null)} />
        )}

        {/* ── Scan progress ─────────────────────────────────────── */}
        {scanning && (
          <Card className="svc-progress" aria-busy="true">
            <div className="svc-progress-head">
              <p className="svc-progress-title" role="status">
                {scanProgress?.phase === 'classifying'
                  ? t('serviceManager.scanProgressClassifying')
                  : t('serviceManager.scanProgressEnumerating')}
              </p>
              {!!scanProgress && scanProgress.total > 0 && (
                <span className="svc-progress-count">
                  {t('serviceManager.progressCount', {
                    current: scanProgress.current,
                    total: scanProgress.total
                  })}
                </span>
              )}
            </div>
            <ProgressBar
              value={
                scanProgress && scanProgress.total > 0
                  ? scanProgress.current / scanProgress.total
                  : undefined
              }
              label={t('serviceManager.scanningButton')}
            />
            <p className="svc-progress-detail svc-truncate">
              {progressText(t, scanProgress?.currentService) || '\u00a0'}
            </p>
          </Card>
        )}

        {/* ── Outcome of the last change ────────────────────────── */}
        {applyResult && (
          <ApplyReceipt result={applyResult} mode={appliedMode} appliedAt={appliedAt} />
        )}

        {/* ── Not scanned yet ───────────────────────────────────── */}
        {!hasScanned && !scanning && (
          <EmptyState
            title={t('serviceManager.emptyStateTitle')}
            description={
              lastChange
                ? t('serviceManager.lastChange', {
                    date: formatDateTime(lastChange.timestamp, locale)
                  })
                : t('serviceManager.emptyStateDescription')
            }
            checks={[
              {
                title: t('serviceManager.checkStartTitle'),
                detail: t('serviceManager.checkStartDetail')
              },
              {
                title: t('serviceManager.checkSafetyTitle'),
                detail: t('serviceManager.checkSafetyDetail')
              },
              {
                title: t('serviceManager.checkDepsTitle'),
                detail: t('serviceManager.checkDepsDetail')
              }
            ]}
            action={
              <Button variant="primary" icon={RefreshCw} onClick={handleScan}>
                {t('serviceManager.scanServicesButton')}
              </Button>
            }
          />
        )}

        {hasScanned && !scanning && (
          <>
            {/* ── Summary: what is selected and what it would do ─── */}
            <Card className="svc-summary">
              <div className="svc-summary-text">
                <h2 className="svc-summary-title">
                  {selectedCount > 0
                    ? t('serviceManager.summarySelected', { count: selectedCount })
                    : t('serviceManager.summaryNoneSelected')}
                </h2>
                <p className="svc-summary-facts">
                  {t('serviceManager.summaryFacts', {
                    total: services.length,
                    running: runningCount,
                    disabled: disabledCount
                  })}
                  {totalSafeToDisable > 0 && (
                    <>
                      {' · '}
                      <Tag tone="recommended">
                        {t('serviceManager.summaryRecommended', { count: totalSafeToDisable })}
                      </Tag>
                    </>
                  )}
                </p>
                {disabledCount > 0 && (
                  <p className="svc-summary-hint">{t('serviceManager.summaryReEnableHint')}</p>
                )}
              </div>
              <div className="svc-summary-actions">
                <Button
                  icon={RecommendedIcon}
                  disabled={isBusy || totalSafeToDisable === 0}
                  onClick={handleSelectRecommended}
                >
                  {t('serviceManager.selectRecommendedButton', { count: totalSafeToDisable })}
                </Button>
                {enableCount > 0 && (
                  <>
                    <label className="svc-inline-field">
                      <span>{t('serviceManager.enableStartTypeTitle')}</span>
                      <ServiceSelect
                        value={enableStartType}
                        ariaLabel={t('serviceManager.enableStartTypeTitle')}
                        options={[
                          { value: 'Manual', label: t('serviceManager.startTypeManual') },
                          { value: 'Automatic', label: t('serviceManager.startTypeAutomatic') }
                        ]}
                        onChange={(v) =>
                          useServiceStore.getState().setEnableStartType(v as 'Manual' | 'Automatic')
                        }
                      />
                    </label>
                    <Button
                      icon={Play}
                      busy={applying && appliedMode === 'enable'}
                      disabled={isBusy}
                      onClick={() => setConfirmMode('enable')}
                    >
                      {t('serviceManager.enableSelectedButton', { count: enableCount })}
                    </Button>
                  </>
                )}
                <Button
                  variant="primary"
                  busy={applying && appliedMode === 'disable'}
                  disabled={isBusy || disableCount === 0}
                  onClick={() => setConfirmMode('disable')}
                >
                  {t('serviceManager.disableSelectedButton', { count: disableCount })}
                </Button>
              </div>
            </Card>

            {/* ── Filters ─────────────────────────────────────────── */}
            <div className="svc-filters">
              <div className="svc-search">
                <Search size={14} strokeWidth={1.75} aria-hidden="true" />
                <input
                  type="text"
                  placeholder={t('serviceManager.searchPlaceholder')}
                  aria-label={t('serviceManager.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => useServiceStore.getState().setSearchQuery(e.target.value)}
                />
              </div>

              <ServiceSelect
                value={safetyFilter}
                ariaLabel={t('serviceManager.filterAllSafety')}
                options={[
                  { value: 'all', label: t('serviceManager.filterAllSafety') },
                  { value: 'safe', label: t('serviceManager.filterSafe') },
                  { value: 'caution', label: t('serviceManager.filterCaution') },
                  { value: 'unsafe', label: t('serviceManager.filterUnsafe') }
                ]}
                onChange={(v) =>
                  useServiceStore.getState().setSafetyFilter(v as 'all' | WindowsService['safety'])
                }
              />

              <ServiceSelect
                value={categoryFilter}
                ariaLabel={t('serviceManager.filterAllCategories')}
                options={[
                  { value: 'all', label: t('serviceManager.filterAllCategories') },
                  ...Array.from(presentCategories)
                    .sort()
                    .map((c) => ({ value: c, label: t(CATEGORY_LABEL_KEYS[c]) || c }))
                ]}
                onChange={(v) =>
                  useServiceStore.getState().setCategoryFilter(v as 'all' | ServiceCategory)
                }
              />

              <ServiceSelect
                value={statusFilter}
                ariaLabel={t('serviceManager.filterAllStatus')}
                options={[
                  { value: 'all', label: t('serviceManager.filterAllStatus') },
                  { value: 'running', label: t('serviceManager.filterRunning') },
                  { value: 'stopped', label: t('serviceManager.filterStopped') },
                  { value: 'disabled', label: t('serviceManager.filterDisabled') }
                ]}
                onChange={(v) =>
                  useServiceStore
                    .getState()
                    .setStatusFilter(v as 'all' | 'running' | 'stopped' | 'disabled')
                }
              />

              <span className="svc-filter-count">
                {t('serviceManager.showingCount', {
                  filtered: filteredServices.length,
                  total: services.length
                })}
              </span>
            </div>

            {/* ── Service list (grouped by safety) ────────────────── */}
            {filteredServices.length === 0 ? (
              <Card>
                <p className="svc-note">{t('serviceManager.noServicesMatch')}</p>
              </Card>
            ) : (
              safetyGroups.map((group) => (
                <SafetyGroup key={group.key} label={group.label} services={group.services} />
              ))
            )}
          </>
        )}
      </div>

      {/* ── Confirm dialog ───────────────────────────────────── */}
      <ConfirmDialog
        open={confirmMode !== null}
        title={t(
          confirmMode === 'enable'
            ? 'serviceManager.confirmEnableTitle'
            : 'serviceManager.confirmTitle',
          { count: confirmTargets.length }
        )}
        description={
          confirmMode === 'enable'
            ? t('serviceManager.confirmEnableDescription', {
                startType: t(START_TYPE_KEY_MAP[enableStartType])
              })
            : t(
                platform === 'win32'
                  ? 'serviceManager.confirmDescription'
                  : 'serviceManager.confirmDescriptionOther'
              )
        }
        details={confirmTargets.map((s) => s.displayName).join('\n')}
        confirmLabel={t(
          confirmMode === 'enable'
            ? 'serviceManager.enableSelectedButton'
            : 'serviceManager.disableSelectedButton',
          { count: confirmTargets.length }
        )}
        onConfirm={() => handleApply(confirmMode ?? 'disable')}
        onCancel={() => setConfirmMode(null)}
      />
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────

/** The result of the last disable or re-enable: counts, time, reversibility, failures. */
function ApplyReceipt({
  result,
  mode,
  appliedAt
}: {
  result: ServiceApplyResult
  mode: ApplyMode
  appliedAt: string | null
}) {
  const { t, i18n } = useTranslation('hardening')
  // Only Windows records the change in the Recovery Centre; elsewhere this page undoes it.
  const recoverable = usePlatform().platform === 'win32'
  const failures = result.errors.map((e) => `${e.displayName || e.name}: ${e.reason}`).join('; ')
  return (
    <Receipt
      title={t(
        mode === 'enable'
          ? 'serviceManager.receiptTitleEnable'
          : 'serviceManager.receiptTitleDisable'
      )}
      value={t('serviceManager.receiptValue', {
        done: result.succeeded,
        total: result.succeeded + result.failed
      })}
      facts={[
        appliedAt ? formatDateTime(appliedAt, i18n.language) : '',
        t(
          recoverable ? 'serviceManager.receiptReversible' : 'serviceManager.receiptReversibleOther'
        )
      ]}
      skipped={
        result.failed > 0
          ? t('serviceManager.receiptFailed', { count: result.failed, list: failures })
          : undefined
      }
      links={
        recoverable ? <Link to="/recovery">{t('serviceManager.openRecovery')}</Link> : undefined
      }
    />
  )
}

/**
 * One safety group. Header and rows are separate grids sharing one column template
 * (`.svc-grid` in service-manager.css), so they stay aligned.
 */
function SafetyGroup({ label, services }: { label: string; services: WindowsService[] }) {
  const { t } = useTranslation('hardening')
  const [collapsed, setCollapsed] = useState(false)
  const selectedInGroup = services.filter((s) => s.selected).length
  const alreadyDisabled = services.filter((s) => s.startType === 'Disabled').length
  const meta = [
    t(
      services.length !== 1 ? 'serviceManager.servicesCountPlural' : 'serviceManager.servicesCount',
      { count: services.length }
    ),
    alreadyDisabled > 0 ? t('serviceManager.alreadyDisabled', { count: alreadyDisabled }) : '',
    selectedInGroup > 0 ? t('serviceManager.selectedCount', { count: selectedInGroup }) : ''
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Section
      title={label}
      meta={meta}
      className="svc-group"
      actions={
        <Button
          variant="ghost"
          icon={collapsed ? ChevronRight : ChevronDown}
          aria-expanded={!collapsed}
          aria-label={t(collapsed ? 'serviceManager.expandGroup' : 'serviceManager.collapseGroup', {
            group: label
          })}
          onClick={() => setCollapsed((c) => !c)}
        />
      }
    >
      {!collapsed && (
        <>
          <div className="svc-grid svc-columns" aria-hidden="true">
            <span />
            <span>{t('serviceManager.columnService')}</span>
            <span>{t('serviceManager.columnStartupType')}</span>
            <span>{t('serviceManager.columnStatus')}</span>
            <span className="svc-deps">{t('serviceManager.columnDeps')}</span>
          </div>
          <div className="svc-rows">
            {services.map((svc) => (
              <ServiceRow key={svc.name} service={svc} />
            ))}
          </div>
        </>
      )}
    </Section>
  )
}

function ServiceRow({ service: svc }: { service: WindowsService }) {
  const { t } = useTranslation('hardening')
  const enableStartType = useServiceStore((s) => s.enableStartType)
  const isDisabled = svc.startType === 'Disabled'
  // Critical services can't be picked for disabling — but a disabled one is
  // selectable so it can be restored.
  const locked = svc.safety === 'unsafe' && !isDisabled
  const recommended = isRecommended(svc)
  const startType =
    svc.startType === 'AutomaticDelayed'
      ? t('serviceManager.startTypeAutoDelayed')
      : t(START_TYPE_KEY_MAP[svc.startType] || 'serviceManager.startTypeUnknown')

  return (
    <label
      className="svc-grid svc-row"
      data-recommended={recommended || undefined}
      data-selected={svc.selected || undefined}
      data-locked={locked || undefined}
      title={
        locked
          ? t('serviceManager.lockedTitle')
          : isDisabled
            ? t('serviceManager.selectToReEnableTitle')
            : undefined
      }
    >
      <span className="svc-check">
        <Checkbox
          checked={svc.selected}
          disabled={locked}
          label={svc.displayName}
          onChange={() => useServiceStore.getState().toggleService(svc.name)}
        />
      </span>

      <span className="svc-name">
        <span className="svc-name-line">
          <span className="svc-title svc-truncate">{svc.displayName}</span>
          {recommended && <Tag tone="recommended">{t('serviceManager.recommendedTag')}</Tag>}
        </span>
        <span className="svc-description svc-truncate">{svc.description || svc.name}</span>
      </span>

      <span className="svc-start">
        {startType}
        {/* Make it obvious that selecting a disabled service restores it */}
        {isDisabled && svc.selected && (
          <span className="svc-start-target"> → {t(START_TYPE_KEY_MAP[enableStartType])}</span>
        )}
      </span>

      <span className="svc-status" data-running={svc.status === 'Running' || undefined}>
        {t(STATUS_KEY_MAP[svc.status] || 'serviceManager.statusUnknown')}
      </span>

      <span className="svc-deps">
        {svc.dependents.length > 0 && (
          <span title={t('serviceManager.dependentsTitle', { count: svc.dependents.length })}>
            <Link2 size={12} strokeWidth={1.75} aria-hidden="true" />
            {svc.dependents.length}
          </span>
        )}
      </span>
    </label>
  )
}

/** The shared select (controls.css): native semantics, the app's picker styling. */
function ServiceSelect({
  value,
  ariaLabel,
  options,
  onChange
}: {
  value: string
  ariaLabel: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <select
      className="svc-select"
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}
