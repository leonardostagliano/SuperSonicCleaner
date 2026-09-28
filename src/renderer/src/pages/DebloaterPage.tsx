import { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Receipt } from '@/components/shared/Receipt'
import { Button, Card, Checkbox, ListRow, Segmented } from '@/components/ui'
import { Note, ProgressCard, SummaryCard } from '@/components/software/SoftwareBlocks'
import { formatDateTime, joinFacts } from '@/components/software/format'
import { useHistoryStore } from '@/stores/history-store'
import { useDebloaterStore } from '@/stores/debloater-store'
import { icons } from '@/lib/icons'
import type { BloatwareApp } from '@shared/types'

type FilterType = 'all' | BloatwareApp['category']

const CATEGORY_LABEL_KEYS: Record<BloatwareApp['category'], string> = {
  microsoft: 'debloater.categoryMicrosoft',
  oem: 'debloater.categoryOem',
  gaming: 'debloater.categoryGaming',
  media: 'debloater.categoryMedia',
  communication: 'debloater.categoryCommunication',
  utility: 'debloater.categoryUtility'
}

const FILTERS: { labelKey: string; value: FilterType }[] = [
  { labelKey: 'debloater.filterAll', value: 'all' },
  { labelKey: 'debloater.filterMicrosoft', value: 'microsoft' },
  { labelKey: 'debloater.filterOem', value: 'oem' },
  { labelKey: 'debloater.filterGaming', value: 'gaming' },
  { labelKey: 'debloater.filterMedia', value: 'media' },
  { labelKey: 'debloater.filterCommunication', value: 'communication' },
  { labelKey: 'debloater.filterUtility', value: 'utility' }
]

export function DebloaterPage({ embedded }: { embedded?: boolean }) {
  const { t, i18n } = useTranslation('hardening')
  const apps = useDebloaterStore((s) => s.apps)
  const scanning = useDebloaterStore((s) => s.scanning)
  const hasScanned = useDebloaterStore((s) => s.hasScanned)
  const filter = useDebloaterStore((s) => s.filter)
  const removing = useDebloaterStore((s) => s.removing)
  const removeProgress = useDebloaterStore((s) => s.removeProgress)
  const removeResult = useDebloaterStore((s) => s.removeResult)
  const error = useDebloaterStore((s) => s.error)
  const history = useHistoryStore((s) => s.entries)
  const store = useDebloaterStore

  const [showConfirm, setShowConfirm] = useState(false)
  const removeStartRef = useRef<number>(0)
  const historyStore = useHistoryStore()

  const handleScan = useCallback(async () => {
    store.getState().setScanning(true)
    store.getState().setApps([])
    store.getState().setRemoveResult(null)
    store.getState().setError(null)
    try {
      const results = await window.kudu.debloaterScan()
      store.getState().setApps(results)
      store.getState().setHasScanned(true)
    } catch (err) {
      console.error('Debloater scan failed:', err)
      toast.error(t('debloater.scanFailedToast'), {
        description: t('debloater.scanFailedDescription')
      })
      store.getState().setError(t('debloater.scanFailedError'))
    }
    store.getState().setScanning(false)
  }, [t])

  // Auto-scan on first visit
  useEffect(() => {
    const s = store.getState()
    if (!s.hasScanned && !s.scanning) handleScan()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRemove = useCallback(async () => {
    setShowConfirm(false)
    store.getState().setRemoving(true)
    store.getState().setRemoveResult(null)
    store.getState().setRemoveProgress(null)
    removeStartRef.current = Date.now()
    const currentApps = store.getState().apps
    const selectedApps = currentApps.filter((a) => a.selected)
    const selectedPkgs = selectedApps.map((a) => a.packageName)
    try {
      const result = await window.kudu.debloaterRemove(selectedPkgs)
      store.getState().setRemoveResult(result)

      // Build category breakdown by app category
      const byCategory: Record<string, { found: number; removed: number }> = {}
      for (const a of selectedApps) {
        const label = t(CATEGORY_LABEL_KEYS[a.category]) || a.category
        if (!byCategory[label]) byCategory[label] = { found: 0, removed: 0 }
        byCategory[label].found++
      }
      const totalSelected = selectedApps.length
      for (const c in byCategory) {
        byCategory[c].removed = Math.round((byCategory[c].found / totalSelected) * result.removed)
      }

      await historyStore.addEntry({
        id: Date.now().toString(),
        type: 'debloater',
        timestamp: new Date().toISOString(),
        duration: Date.now() - removeStartRef.current,
        totalItemsFound: currentApps.length,
        totalItemsCleaned: result.removed,
        totalItemsSkipped: result.failed,
        totalSpaceSaved: 0,
        categories: Object.entries(byCategory).map(([name, d]) => ({
          name,
          itemsFound: d.found,
          itemsCleaned: d.removed,
          spaceSaved: 0
        })),
        errorCount: result.failed
      })

      if (result.removed > 0) {
        const results = await window.kudu.debloaterScan()
        store.getState().setApps(results)
      }
    } catch (err) {
      console.error('Debloater remove failed:', err)
      toast.error(t('debloater.removeFailedToast'), {
        description: t('debloater.removeFailedDescription')
      })
      store.getState().setError(t('debloater.removeFailedError'))
    } finally {
      store.getState().setRemoving(false)
      store.getState().setRemoveProgress(null)
    }
  }, [t])

  const filtered = filter === 'all' ? apps : apps.filter((a) => a.category === filter)
  const selectedCount = apps.filter((a) => a.selected).length
  const filteredSelected = filtered.filter((a) => a.selected).length
  const allFilteredSelected = filtered.length > 0 && filteredSelected === filtered.length
  const lastRun = history.find((entry) => entry.type === 'debloater')

  const scanButton = (
    <Button
      variant={hasScanned ? 'secondary' : 'primary'}
      icon={Search}
      busy={scanning}
      disabled={removing}
      onClick={handleScan}
    >
      {hasScanned ? t('debloater.rescanButton') : t('debloater.scanButton')}
    </Button>
  )

  return (
    <div>
      {!embedded && (
        <PageHeader
          title={t('debloater.pageTitle')}
          description={t('debloater.pageDescription')}
          action={scanButton}
        />
      )}

      <div className="sw-page">
        {embedded && <div className="sw-summary-actions">{scanButton}</div>}

        {/* The limit, said once and plainly: removal is not undone from here */}
        <Note icon="warning">{t('debloater.irreversibleWarning')}</Note>

        {error && <ErrorAlert message={error} onDismiss={() => store.getState().setError(null)} />}

        {scanning && <ProgressCard title={t('debloater.scanningPackages')} />}

        {removing && removeProgress && (
          <ProgressCard
            title={t('debloater.removingProgress', {
              current: removeProgress.current,
              total: removeProgress.total
            })}
            meta={`${Math.round((removeProgress.current / removeProgress.total) * 100)}%`}
            value={removeProgress.current / removeProgress.total}
            detail={
              apps.find((a) => a.packageName === removeProgress.currentApp)?.name ||
              removeProgress.currentApp
            }
          />
        )}

        {removeResult && (
          <Receipt
            title={t('debloater.receiptTitle')}
            value={t('debloater.removedApps', { count: removeResult.removed })}
            facts={[
              removeResult.failed > 0
                ? t('debloater.failedCount', { count: removeResult.failed })
                : '',
              t('debloater.reinstallFromStore')
            ]}
          />
        )}

        {/* Before the first scan: the real state, the last result and what is read */}
        {!hasScanned && !scanning && (
          <EmptyState
            title={t('debloater.emptyStateTitle')}
            description={
              lastRun
                ? t('debloater.lastRun', {
                    count: lastRun.totalItemsCleaned,
                    date: formatDateTime(lastRun.timestamp, i18n.language)
                  })
                : t('debloater.emptyStateDescription')
            }
            checks={[
              { title: t('debloater.checkKnownTitle'), detail: t('debloater.checkKnownDetail') },
              {
                title: t('debloater.checkInstalledTitle'),
                detail: t('debloater.checkInstalledDetail')
              },
              {
                title: t('debloater.checkRemovalTitle'),
                detail: t('debloater.checkRemovalDetail')
              }
            ]}
          />
        )}

        {hasScanned && !scanning && apps.length === 0 && (
          <EmptyState
            icon={icons.allUpToDate}
            title={t('debloater.noneFoundTitle')}
            description={t('debloater.noneFoundDescription')}
          />
        )}

        {apps.length > 0 && !scanning && (
          <SummaryCard
            title={t('debloater.summaryTitle', { count: apps.length })}
            detail={t('debloater.selectedCount', { count: selectedCount })}
            action={
              <Button
                variant="primary"
                icon={icons.debloat}
                busy={removing}
                disabled={selectedCount === 0}
                onClick={() => setShowConfirm(true)}
              >
                {selectedCount > 0
                  ? t('debloater.removeButton', { count: selectedCount })
                  : t('debloater.removeNone')}
              </Button>
            }
          />
        )}

        {apps.length > 0 && !scanning && (
          <Card className="sw-list">
            <div className="sw-toolbar">
              <label className="sw-select-all">
                <Checkbox
                  checked={allFilteredSelected}
                  indeterminate={filteredSelected > 0 && !allFilteredSelected}
                  onChange={(value) => store.getState().selectFiltered(filter, value)}
                  label={t('debloater.selectAll')}
                  disabled={removing || filtered.length === 0}
                />
                <span>{t('debloater.selectedCount', { count: filteredSelected })}</span>
              </label>
              <div className="sw-toolbar-end">
                <Segmented<FilterType>
                  label={t('debloater.filterLabel')}
                  value={filter}
                  onChange={(value) => store.getState().setFilter(value)}
                  options={FILTERS.flatMap((f) => {
                    const count =
                      f.value === 'all'
                        ? apps.length
                        : apps.filter((a) => a.category === f.value).length
                    return count === 0 && f.value !== 'all'
                      ? []
                      : [{ value: f.value, label: `${t(f.labelKey)} (${count})` }]
                  })}
                />
              </div>
            </div>

            {filtered.map((app) => (
              <ListRow key={app.id}>
                <Checkbox
                  checked={app.selected}
                  onChange={() => store.getState().toggleApp(app.id)}
                  label={app.name}
                  disabled={removing}
                />
                <div className="min-w-0 flex-1">
                  <span className="sw-row-name block" title={app.name}>
                    {app.name}
                  </span>
                  <p className="sw-row-sub" title={app.description}>
                    {joinFacts([t(CATEGORY_LABEL_KEYS[app.category]), app.description])}
                  </p>
                </div>
                <span className="sw-row-meta shrink-0">
                  {app.publisher}
                  {app.size && <span className="sw-row-meta-sub">{app.size}</span>}
                </span>
              </ListRow>
            ))}
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={showConfirm}
        onConfirm={handleRemove}
        onCancel={() => setShowConfirm(false)}
        title={t('debloater.confirmTitle', { count: selectedCount })}
        description={t('debloater.confirmDescription', { count: selectedCount })}
        details={apps
          .filter((a) => a.selected)
          .map((a) => a.name)
          .join(', ')}
        confirmLabel={t('debloater.confirmLabel', { count: selectedCount })}
        variant="danger"
      />
    </div>
  )
}
