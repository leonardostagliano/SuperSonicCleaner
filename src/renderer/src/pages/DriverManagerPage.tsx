import { useState, useCallback, useRef, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, Search } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Receipt } from '@/components/shared/Receipt'
import { Button, Card, Checkbox, ListRow, Section, Tag } from '@/components/ui'
import { Disclosure, Note, ProgressCard, SummaryCard } from '@/components/software/SoftwareBlocks'
import { formatClock, formatDateTime, joinFacts } from '@/components/software/format'
import { useHistoryStore } from '@/stores/history-store'
import { useStatsStore } from '@/stores/stats-store'
import { useDriverStore } from '@/stores/driver-store'
import { icons } from '@/lib/icons'
import { progressText } from '@/lib/progress-label'
import { formatBytes } from '@/lib/utils'
import type { DriverPackage, DriverUpdate } from '@shared/types'

/** When this session's last scan finished: survives leaving and reopening the page. */
let lastScanAt: number | null = null

/** A click on the checkbox must not also reach the row's own toggle. */
const stop = (event: MouseEvent) => event.stopPropagation()

export function DriverManagerPage({ embedded }: { embedded?: boolean }) {
  const { t, i18n } = useTranslation('updates')
  const packages = useDriverStore((s) => s.packages)
  const scanning = useDriverStore((s) => s.scanning)
  const scanProgress = useDriverStore((s) => s.scanProgress)
  const cleaning = useDriverStore((s) => s.cleaning)
  const cleanResult = useDriverStore((s) => s.cleanResult)
  const error = useDriverStore((s) => s.error)
  const totalStaleSize = useDriverStore((s) => s.totalStaleSize)
  const updates = useDriverStore((s) => s.updates)
  const ignoredUpdates = useDriverStore((s) => s.ignoredUpdates)
  const pendingIgnoreIds = useDriverStore((s) => s.pendingIgnoreIds)
  const updateScanning = useDriverStore((s) => s.updateScanning)
  const updateProgress = useDriverStore((s) => s.updateProgress)
  const installing = useDriverStore((s) => s.installing)
  const installResult = useDriverStore((s) => s.installResult)
  const updateError = useDriverStore((s) => s.updateError)
  const updatesDisabled = useDriverStore((s) => s.updatesDisabled)
  const applying = useDriverStore((s) => s.applying)
  const hasScanned = useDriverStore((s) => s.hasScanned)
  const history = useHistoryStore((s) => s.entries)

  const [showConfirm, setShowConfirm] = useState(false)
  const [showIgnored, setShowIgnored] = useState(false)
  const cleanStartRef = useRef<number>(0)
  const historyStore = useHistoryStore()
  const recomputeStats = useStatsStore((s) => s.recompute)

  const isScanning = scanning || updateScanning
  const isBusy = isScanning || applying

  // ─── Scan for both stale packages and updates ─────────────
  const handleScan = useCallback(async () => {
    const scanStart = Date.now()
    const store = useDriverStore.getState()
    store.setScanning(true)
    store.setUpdateScanning(true)
    store.setPackages([])
    store.setUpdates([])
    store.setIgnoredUpdates([])
    store.setCleanResult(null)
    store.setInstallResult(null)
    store.setError(null)
    store.setUpdateError(null)
    store.setUpdatesDisabled(false)
    store.setScanProgress(null)
    store.setUpdateProgress(null)

    // Run both scans in parallel
    const [staleResult, updateResult] = await Promise.allSettled([
      window.kudu.driverScan(),
      window.kudu.driverUpdateScan()
    ])

    const s = useDriverStore.getState()

    let staleCount = 0
    let staleSize = 0
    if (staleResult.status === 'fulfilled') {
      s.setPackages(staleResult.value.packages)
      s.setTotalStaleSize(staleResult.value.totalStaleSize)
      staleCount = staleResult.value.packages.length
      staleSize = staleResult.value.totalStaleSize
      // Auto-select all stale packages
      useDriverStore.getState().selectAllStale()
    } else {
      console.error('Driver scan failed:', staleResult.reason)
      toast.error(t('driverManager.scanFailedToast'), {
        description: t('driverManager.scanFailedDescription')
      })
      s.setError(t('driverManager.scanFailedError'))
    }

    let updateCount = 0
    if (updateResult.status === 'fulfilled') {
      s.setUpdates(updateResult.value.updates)
      s.setIgnoredUpdates(updateResult.value.ignoredUpdates ?? [])
      s.setUpdatesDisabled(updateResult.value.updatesDisabled)
      updateCount = updateResult.value.updates.length
    } else {
      console.error('Driver update scan failed:', updateResult.reason)
      toast.error(t('driverManager.updateScanFailedToast'), {
        description: t('driverManager.updateScanFailedDescription')
      })
      s.setUpdateError(t('driverManager.updateScanFailedError'))
    }

    const final = useDriverStore.getState()
    final.setScanning(false)
    final.setUpdateScanning(false)
    final.setScanProgress(null)
    final.setUpdateProgress(null)
    lastScanAt = Date.now()
    final.setHasScanned(true)

    // Record scan in history so dashboard reflects completion
    if (staleResult.status === 'fulfilled' || updateResult.status === 'fulfilled') {
      const totalFound = staleCount + updateCount
      await historyStore.addEntry({
        id: Date.now().toString(),
        type: 'drivers',
        timestamp: new Date().toISOString(),
        duration: Date.now() - scanStart,
        totalItemsFound: totalFound,
        totalItemsCleaned: 0,
        totalItemsSkipped: 0,
        totalSpaceSaved: 0,
        categories: [
          ...(staleCount > 0
            ? [
                {
                  name: 'Stale Drivers',
                  itemsFound: staleCount,
                  itemsCleaned: 0,
                  spaceSaved: staleSize
                }
              ]
            : []),
          ...(updateCount > 0
            ? [{ name: 'Driver Updates', itemsFound: updateCount, itemsCleaned: 0, spaceSaved: 0 }]
            : [])
        ],
        errorCount: 0
      })
      recomputeStats()
    }
  }, [])

  // ─── Combined Update & Clean ──────────────────────────────
  const handleApply = useCallback(async () => {
    setShowConfirm(false)
    const store = useDriverStore.getState()
    store.setApplying(true)
    store.setCleanResult(null)
    store.setInstallResult(null)
    cleanStartRef.current = Date.now()

    const selectedUpdates = store.updates.filter((u) => u.selected)
    const selectedStale = store.packages.filter((p) => p.selected && !p.isCurrent)

    // Step 1: Install driver updates (if any selected)
    if (selectedUpdates.length > 0) {
      store.setInstalling(true)
      store.setUpdateProgress(null)
      const ids = selectedUpdates.map((u) => u.updateId)
      try {
        const result = await window.kudu.driverUpdateInstall(ids)
        useDriverStore.getState().setInstallResult(result)
      } catch (err) {
        console.error('Driver install failed:', err)
        toast.error(t('driverManager.installFailedToast'), {
          description: t('driverManager.installFailedDescription')
        })
        useDriverStore.getState().setUpdateError(t('driverManager.installFailedError'))
      } finally {
        const s = useDriverStore.getState()
        s.setInstalling(false)
        s.setUpdateProgress(null)
      }
    }

    // Step 2: Clean stale packages (if any selected)
    if (selectedStale.length > 0) {
      const s2 = useDriverStore.getState()
      s2.setCleaning(true)
      const names = selectedStale.map((p) => p.publishedName)
      try {
        const result = await window.kudu.driverClean(names)
        useDriverStore.getState().setCleanResult(result)

        // History tracking
        const byClass: Record<string, { found: number; cleaned: number; size: number }> = {}
        for (const pkg of selectedStale) {
          if (!byClass[pkg.className]) byClass[pkg.className] = { found: 0, cleaned: 0, size: 0 }
          byClass[pkg.className].found++
          byClass[pkg.className].size += pkg.size
        }
        const totalSelected = selectedStale.length
        for (const c in byClass) {
          byClass[c].cleaned = Math.round((byClass[c].found / totalSelected) * result.removed)
        }

        await historyStore.addEntry({
          id: Date.now().toString(),
          type: 'drivers',
          timestamp: new Date().toISOString(),
          duration: Date.now() - cleanStartRef.current,
          totalItemsFound: store.packages.length,
          totalItemsCleaned: result.removed,
          totalItemsSkipped: result.failed,
          totalSpaceSaved: result.spaceRecovered,
          categories: Object.entries(byClass).map(([name, d]) => ({
            name: `Drivers: ${name}`,
            itemsFound: d.found,
            itemsCleaned: d.cleaned,
            spaceSaved: d.size
          })),
          errorCount: result.failed
        })
        recomputeStats()
      } catch (err) {
        console.error('Driver clean failed:', err)
        toast.error(t('driverManager.cleanFailedToast'), {
          description: t('driverManager.cleanFailedDescription')
        })
        useDriverStore.getState().setError(t('driverManager.cleanFailedError'))
      } finally {
        useDriverStore.getState().setCleaning(false)
      }
    }

    // Step 3: Re-scan to refresh the list
    useDriverStore.getState().setApplying(false)
    const finalStore = useDriverStore.getState()
    const didInstall = finalStore.installResult && finalStore.installResult.installed > 0
    const didClean = finalStore.cleanResult && finalStore.cleanResult.removed > 0
    if (didInstall || didClean) {
      // Quick refresh
      finalStore.setScanning(true)
      finalStore.setUpdateScanning(true)
      const [staleResult, updateResult] = await Promise.allSettled([
        window.kudu.driverScan(),
        window.kudu.driverUpdateScan()
      ])
      const s = useDriverStore.getState()
      if (staleResult.status === 'fulfilled') {
        s.setPackages(staleResult.value.packages)
        s.setTotalStaleSize(staleResult.value.totalStaleSize)
        useDriverStore.getState().selectAllStale()
      }
      if (updateResult.status === 'fulfilled') {
        s.setUpdates(updateResult.value.updates)
        s.setIgnoredUpdates(updateResult.value.ignoredUpdates ?? [])
        s.setUpdatesDisabled(updateResult.value.updatesDisabled)
      }
      s.setScanning(false)
      s.setUpdateScanning(false)
      s.setScanProgress(null)
      s.setUpdateProgress(null)
      lastScanAt = Date.now()
    }
  }, [])

  const stalePackages = packages.filter((p) => !p.isCurrent)
  const selectedStale = stalePackages.filter((p) => p.selected)
  const selectedStaleCount = selectedStale.length
  const selectedStaleSize = selectedStale.reduce((sum, p) => sum + p.size, 0)
  // ─── Ignore / restore a driver update ─────────────────────
  // Optimistic: move the row immediately, then persist and hide/unhide the
  // update in Windows Update itself. Hiding needs elevation; if that part
  // fails the update stays ignored in Kudu and the user is told. If the
  // request itself rejects (settings could not be written) the move is rolled
  // back so the UI never claims a state that was not persisted. The row is
  // marked pending until the request finishes so it can't be flipped back
  // while the (slow) Windows Update call is still running.
  const handleIgnore = useCallback(
    async (upd: DriverUpdate) => {
      const store = useDriverStore.getState()
      if (store.pendingIgnoreIds.has(upd.id)) return
      store.ignoreUpdate(upd.id)
      if (!upd.updateId) return
      store.setIgnorePending(upd.id, true)
      try {
        const result = await window.kudu.driverUpdateIgnore(upd.updateId, true)
        if (result.windowsUpdateHidden) {
          toast.success(t('driverManager.ignoredToast', { name: upd.deviceName }), {
            description: t('driverManager.ignoredToastHidden')
          })
        } else {
          toast.warning(t('driverManager.ignoredToast', { name: upd.deviceName }), {
            description: t('driverManager.ignoredToastNotHidden')
          })
        }
      } catch {
        useDriverStore.getState().unignoreUpdate(upd.id)
        toast.error(t('driverManager.ignoreFailedToast'))
      } finally {
        useDriverStore.getState().setIgnorePending(upd.id, false)
      }
    },
    [t]
  )

  const handleUnignore = useCallback(
    async (upd: DriverUpdate) => {
      const store = useDriverStore.getState()
      if (store.pendingIgnoreIds.has(upd.id)) return
      store.unignoreUpdate(upd.id)
      if (!upd.updateId) return
      store.setIgnorePending(upd.id, true)
      try {
        const result = await window.kudu.driverUpdateIgnore(upd.updateId, false)
        if (!result.windowsUpdateHidden) {
          toast.warning(t('driverManager.restoredToast', { name: upd.deviceName }), {
            description: t('driverManager.restoredToastNotUnhidden')
          })
        }
      } catch {
        useDriverStore.getState().ignoreUpdate(upd.id)
        toast.error(t('driverManager.ignoreFailedToast'))
      } finally {
        useDriverStore.getState().setIgnorePending(upd.id, false)
      }
    },
    [t]
  )

  const selectedUpdateCount = updates.filter((u) => u.selected).length
  const totalSelected = selectedStaleCount + selectedUpdateCount
  const allStaleSelected = stalePackages.length > 0 && stalePackages.every((p) => p.selected)
  const allUpdatesSelected = updates.length > 0 && updates.every((u) => u.selected)

  // The button says what it does; the confirmation repeats it with the limits.
  const both = selectedUpdateCount > 0 && selectedStaleCount > 0
  const applyLabel = both
    ? t('driverManager.applyBoth', { count: totalSelected })
    : selectedUpdateCount > 0
      ? t('driverManager.applyInstall', { count: selectedUpdateCount })
      : selectedStaleCount > 0
        ? t('driverManager.applyRemove', { count: selectedStaleCount })
        : t('driverManager.applyNone')
  const confirmTitle = both
    ? t('driverManager.confirmBothTitle', { count: totalSelected })
    : selectedUpdateCount > 0
      ? t('driverManager.confirmInstallTitle', { count: selectedUpdateCount })
      : t('driverManager.confirmRemoveTitle', { count: selectedStaleCount })
  const confirmDescription = [
    selectedUpdateCount > 0 &&
      t('driverManager.confirmInstallBody', { count: selectedUpdateCount }),
    selectedStaleCount > 0 &&
      t('driverManager.confirmRemoveBody', {
        count: selectedStaleCount,
        size: formatBytes(selectedStaleSize)
      }),
    t('driverManager.confirmActiveNote')
  ]
    .filter(Boolean)
    .join(' ')

  const hasResults = updates.length > 0 || stalePackages.length > 0
  // Windows Update may be off or unreachable, and the Driver Store scan may fail: an
  // empty result only covers the side that was really checked.
  const updatesChecked = !updateError && !updatesDisabled
  const allClear =
    hasScanned && !isScanning && !hasResults
      ? updatesChecked && !error
        ? 'allUpToDate'
        : updatesChecked
          ? 'noUpdates'
          : !error
            ? 'noStale'
            : null
      : null
  const scanTime = lastScanAt ? formatClock(lastScanAt, i18n.language) : ''
  const lastEntry = history.find((entry) => entry.type === 'drivers')
  const lastResult = lastEntry
    ? lastEntry.totalItemsCleaned > 0
      ? t('driverManager.lastClean', {
          count: lastEntry.totalItemsCleaned,
          size: formatBytes(lastEntry.totalSpaceSaved),
          date: formatDateTime(lastEntry.timestamp, i18n.language)
        })
      : t('driverManager.lastScan', {
          count: lastEntry.totalItemsFound,
          date: formatDateTime(lastEntry.timestamp, i18n.language)
        })
    : t('driverManager.emptyStateDescription')

  const scanButton = (
    <Button
      variant={hasScanned ? 'secondary' : 'primary'}
      icon={Search}
      busy={isScanning}
      disabled={applying}
      onClick={handleScan}
    >
      {hasScanned ? t('driverManager.rescanButton') : t('driverManager.scanDriversButton')}
    </Button>
  )

  return (
    <div>
      {!embedded && (
        <PageHeader
          title={t('driverManager.pageTitle')}
          description={t('driverManager.pageDescription')}
          action={scanButton}
        />
      )}

      <div className="sw-page">
        {embedded && <div className="sw-summary-actions">{scanButton}</div>}

        {error && (
          <ErrorAlert message={error} onDismiss={() => useDriverStore.getState().setError(null)} />
        )}
        {updateError && (
          <ErrorAlert
            message={updateError}
            onDismiss={() => useDriverStore.getState().setUpdateError(null)}
          />
        )}

        {/* Scan progress: driver packages and Windows Update run side by side */}
        {scanning && !cleaning && (
          <ProgressCard
            title={t('driverManager.progressPackagesTitle')}
            meta={
              scanProgress && scanProgress.total > 0
                ? t('driverManager.progressCount', {
                    current: scanProgress.current,
                    total: scanProgress.total
                  })
                : undefined
            }
            value={
              scanProgress && scanProgress.total > 0 && scanProgress.phase === 'measuring'
                ? scanProgress.current / scanProgress.total
                : undefined
            }
            detail={
              scanProgress
                ? progressText(t, scanProgress.currentDriver)
                : t('driverManager.progress.enumerating')
            }
          />
        )}
        {updateScanning && !installing && (
          <ProgressCard
            title={t('driverManager.progressUpdatesTitle')}
            meta={
              updateProgress && updateProgress.total > 0
                ? t('driverManager.progressCount', {
                    current: updateProgress.current,
                    total: updateProgress.total
                  })
                : undefined
            }
            value={
              updateProgress && updateProgress.total > 0 ? updateProgress.percent / 100 : undefined
            }
            detail={
              updateProgress
                ? progressText(t, updateProgress.currentDevice)
                : t('driverManager.progress.querying')
            }
          />
        )}

        {/* Apply progress */}
        {installing && (
          <ProgressCard
            title={t('driverManager.installProgressTitle')}
            meta={
              updateProgress && updateProgress.total > 0
                ? t('driverManager.progressCount', {
                    current: updateProgress.current,
                    total: updateProgress.total
                  })
                : undefined
            }
            value={updateProgress ? updateProgress.percent / 100 : undefined}
            detail={
              updateProgress
                ? progressText(t, updateProgress.currentDevice)
                : t('driverManager.progress.preparing')
            }
          />
        )}
        {cleaning && <ProgressCard title={t('driverManager.cleanProgressTitle')} />}

        {/* What the last apply did */}
        {installResult && (
          <Receipt
            title={t('driverManager.installReceiptTitle')}
            value={t('driverManager.installedCount', { count: installResult.installed })}
            facts={[
              installResult.failed > 0
                ? t('driverManager.failedCount', { count: installResult.failed })
                : '',
              installResult.rebootRequired ? t('driverManager.rebootRequired') : ''
            ]}
          />
        )}
        {cleanResult && (
          <Receipt
            title={t('driverManager.cleanReceiptTitle')}
            value={
              cleanResult.spaceRecovered > 0
                ? t('driverManager.spaceRecovered', {
                    size: formatBytes(cleanResult.spaceRecovered)
                  })
                : undefined
            }
            facts={[
              t('driverManager.removedCount', { count: cleanResult.removed }),
              cleanResult.failed > 0
                ? t('driverManager.failedCount', { count: cleanResult.failed })
                : '',
              t('driverManager.notReversible')
            ]}
          />
        )}

        {/* Driver updates turned off in Windows */}
        {hasScanned && !isScanning && updatesDisabled && (
          <Note icon="warning" title={t('driverManager.updatesDisabledTitle')}>
            {t('driverManager.updatesDisabledText')}
          </Note>
        )}

        {/* Before the first scan: the real state and what the scan reads */}
        {!hasScanned && !isScanning && (
          <EmptyState
            title={t('driverManager.emptyStateTitle')}
            description={lastResult}
            checks={[
              {
                title: t('driverManager.checkUpdatesTitle'),
                detail: t('driverManager.checkUpdatesDetail')
              },
              {
                title: t('driverManager.checkStaleTitle'),
                detail: t('driverManager.checkStaleDetail')
              },
              {
                title: t('driverManager.checkActiveTitle'),
                detail: t('driverManager.checkActiveDetail')
              }
            ]}
          />
        )}

        {/* Nothing found: say only what was actually checked */}
        {allClear && (
          <EmptyState
            icon={icons.allUpToDate}
            title={t(`driverManager.${allClear}Title`)}
            description={joinFacts([
              t(`driverManager.${allClear}Description`),
              scanTime && t('driverManager.scannedAt', { time: scanTime })
            ])}
          />
        )}

        {/* The number that matters and the action that uses it */}
        {hasScanned && !isScanning && hasResults && (
          <SummaryCard
            title={joinFacts([
              updates.length > 0 && t('driverManager.summaryUpdates', { count: updates.length }),
              stalePackages.length > 0 &&
                t('driverManager.summaryStale', { count: stalePackages.length })
            ])}
            detail={joinFacts([
              totalStaleSize > 0 &&
                t('driverManager.summaryStaleSize', { size: formatBytes(totalStaleSize) }),
              scanTime && t('driverManager.scannedAt', { time: scanTime })
            ])}
            action={
              <Button
                variant="primary"
                icon={icons.drivers}
                busy={applying}
                disabled={totalSelected === 0 || isScanning}
                onClick={() => setShowConfirm(true)}
              >
                {applyLabel}
              </Button>
            }
          />
        )}

        {/* ─── Updates ─────────────────────────────────────────── */}
        {updates.length > 0 && !isScanning && (
          <Section
            title={t('driverManager.updatesSection')}
            meta={t('driverManager.sectionSelected', {
              selected: selectedUpdateCount,
              total: updates.length
            })}
            actions={
              <label className="sw-select-all">
                <Checkbox
                  checked={allUpdatesSelected}
                  indeterminate={selectedUpdateCount > 0 && !allUpdatesSelected}
                  onChange={(value) => {
                    const store = useDriverStore.getState()
                    if (value) store.selectAllUpdates()
                    else store.deselectAllUpdates()
                  }}
                  label={t('driverManager.selectAllUpdates')}
                  disabled={applying}
                />
              </label>
            }
          >
            {updates.map((upd) => (
              <UpdateRow
                key={upd.id}
                update={upd}
                disabled={isBusy || pendingIgnoreIds.has(upd.id)}
                onIgnore={() => void handleIgnore(upd)}
              />
            ))}
          </Section>
        )}

        {/* ─── Stale packages: safe to remove, pre-selected ───────── */}
        {stalePackages.length > 0 && !isScanning && (
          <Section
            title={t('driverManager.staleSection')}
            meta={t('driverManager.sectionSelected', {
              selected: selectedStaleCount,
              total: stalePackages.length
            })}
            actions={
              <label className="sw-select-all">
                <Checkbox
                  checked={allStaleSelected}
                  indeterminate={selectedStaleCount > 0 && !allStaleSelected}
                  onChange={(value) => {
                    const store = useDriverStore.getState()
                    if (value) store.selectAllStale()
                    else store.deselectAllStale()
                  }}
                  label={t('driverManager.selectAllStale')}
                  disabled={applying}
                />
              </label>
            }
          >
            {stalePackages.map((pkg) => (
              <StaleRow key={pkg.id} pkg={pkg} disabled={applying} />
            ))}
          </Section>
        )}

        {/* ─── Ignored updates ─────────────────────────────────── */}
        {ignoredUpdates.length > 0 && !isScanning && (
          <Disclosure
            label={t('driverManager.ignoredSection', { count: ignoredUpdates.length })}
            open={showIgnored}
            onToggle={() => setShowIgnored(!showIgnored)}
          >
            <Card className="sw-list">
              {ignoredUpdates.map((upd) => (
                <ListRow key={upd.id} data-muted="">
                  <div className="min-w-0 flex-1">
                    <span className="sw-row-name block" title={upd.deviceName}>
                      {upd.deviceName}
                    </span>
                    <p className="sw-row-sub" title={upd.updateTitle}>
                      {joinFacts([upd.provider, upd.updateTitle])}
                    </p>
                  </div>
                  <span className="sw-row-meta sw-mono shrink-0">v{upd.availableVersion}</span>
                  <Button
                    variant="ghost"
                    icon={Eye}
                    onClick={() => void handleUnignore(upd)}
                    disabled={isBusy || pendingIgnoreIds.has(upd.id)}
                    aria-label={`${t('driverManager.unignoreButton')} ${upd.deviceName}`}
                  >
                    {t('driverManager.unignoreButton')}
                  </Button>
                </ListRow>
              ))}
            </Card>
          </Disclosure>
        )}

        <ConfirmDialog
          open={showConfirm}
          onConfirm={handleApply}
          onCancel={() => setShowConfirm(false)}
          title={confirmTitle}
          description={confirmDescription}
          confirmLabel={applyLabel}
          variant={selectedStaleCount > 0 ? 'danger' : 'default'}
        />
      </div>
    </div>
  )
}

function UpdateRow({
  update,
  disabled,
  onIgnore
}: {
  update: DriverUpdate
  disabled: boolean
  onIgnore: () => void
}) {
  const { t } = useTranslation('updates')
  const toggle = () => useDriverStore.getState().toggleUpdate(update.id)
  const from = update.currentVersion
    ? `v${update.currentVersion}`
    : t('driverManager.versionUnknown')
  return (
    <ListRow className="cursor-pointer" onClick={toggle}>
      <span onClick={stop} className="flex">
        <Checkbox checked={update.selected} onChange={toggle} label={update.deviceName} />
      </span>
      <div className="min-w-0 flex-1">
        <span className="sw-row-name block" title={update.deviceName}>
          {update.deviceName}
        </span>
        <p className="sw-row-sub">
          {joinFacts([update.className, update.provider, `${from} → v${update.availableVersion}`])}
        </p>
      </div>
      <span className="sw-row-meta shrink-0">
        {update.downloadSize}
        {update.availableDate && <span className="sw-row-meta-sub">{update.availableDate}</span>}
      </span>
      <span onClick={stop} className="flex">
        <Button
          variant="ghost"
          icon={EyeOff}
          onClick={onIgnore}
          disabled={disabled}
          title={t('driverManager.ignoreButton')}
          aria-label={`${t('driverManager.ignoreButton')}: ${update.deviceName}`}
        />
      </span>
    </ListRow>
  )
}

function StaleRow({ pkg, disabled }: { pkg: DriverPackage; disabled: boolean }) {
  const { t } = useTranslation('updates')
  const toggle = () => {
    if (!disabled) useDriverStore.getState().togglePackage(pkg.id)
  }
  return (
    <ListRow className="cursor-pointer" recommended onClick={toggle}>
      <span onClick={stop} className="flex">
        <Checkbox
          checked={pkg.selected}
          onChange={toggle}
          label={pkg.originalName}
          disabled={disabled}
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="sw-row-title">
          <span className="sw-row-name" title={pkg.originalName}>
            {pkg.originalName}
          </span>
          <Tag tone="recommended">{t('driverManager.recommended')}</Tag>
        </div>
        <p className="sw-row-sub">
          {joinFacts([pkg.className, pkg.provider, `v${pkg.version}`, pkg.date])}
        </p>
      </div>
      <span className="sw-row-meta shrink-0">
        {formatBytes(pkg.size)}
        <span className="sw-row-meta-sub sw-mono">{pkg.publishedName}</span>
      </span>
    </ListRow>
  )
}
