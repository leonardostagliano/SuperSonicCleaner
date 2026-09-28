import { Fragment, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { usePlatform } from '@/hooks/usePlatform'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Receipt } from '@/components/shared/Receipt'
import { ReportNotice } from '@/components/cleaner/ReportNotice'
import '@/components/cleaner/pulizia.css'
import {
  Button,
  Card,
  Checkbox,
  ProgressBar,
  Section,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tag
} from '@/components/ui'
import { formatDateTime, formatList, formatTime, latestEntry } from '@/lib/cleaner-report'
import { formatNumber, NO_VALUE } from '@/lib/utils'
import { useHistoryStore } from '@/stores/history-store'
import { useRegistryStore } from '@/stores/registry-store'
import { recordCheckRun } from '@/stores/check-runs-store'
import type { RegistryEntry } from '@shared/types'

type EntryType = RegistryEntry['type']

const typeKeyMap: Record<EntryType, string> = {
  obsolete: 'entryTypeObsolete',
  invalid: 'entryTypeInvalid',
  orphaned: 'entryTypeOrphaned',
  broken: 'entryTypeBroken',
  vulnerability: 'entryTypeVulnerability',
  privacy: 'entryTypeVulnerability', // kept for type compat
  performance: 'entryTypePerformance',
  network: 'entryTypeNetwork',
  service: 'entryTypeService',
  task: 'entryTypeTask'
}

const riskKeyMap: Record<RegistryEntry['risk'], string> = {
  low: 'riskLow',
  medium: 'riskMedium',
  high: 'riskHigh'
}

const RISK_ORDER: Record<RegistryEntry['risk'], number> = { low: 0, medium: 1, high: 2 }

interface AreaDef {
  types: EntryType[]
  titleKey: string
  descriptionKey: string
  /** Number of checks behind the area, when it is fixed (the rest vary with the system). */
  totalChecks?: number
}

const areas: AreaDef[] = [
  {
    types: ['obsolete', 'invalid', 'orphaned', 'broken'],
    titleKey: 'cardRegistryCleanup',
    descriptionKey: 'cardRegistryCleanupDescription'
  },
  {
    types: ['vulnerability'],
    titleKey: 'cardSecurity',
    descriptionKey: 'cardSecurityDescription',
    totalChecks: 12
  },
  {
    types: ['performance'],
    titleKey: 'cardPerformance',
    descriptionKey: 'cardPerformanceDescription',
    totalChecks: 1
  },
  {
    types: ['network'],
    titleKey: 'cardNetwork',
    descriptionKey: 'cardNetworkDescription',
    totalChecks: 2
  },
  {
    types: ['service'],
    titleKey: 'cardServices',
    descriptionKey: 'cardServicesDescription',
    totalChecks: 2
  },
  {
    types: ['task'],
    titleKey: 'cardScheduledTasks',
    descriptionKey: 'cardScheduledTasksDescription'
  }
]

export function RegistryPage() {
  const { features } = usePlatform()
  const { t } = useTranslation('registry')

  if (!features.registry) {
    return (
      <div className="pulizia-page">
        <PageHeader title={t('pageTitle')} description={t('pageHeaderUnavailableDescription')} />
        <EmptyState title={t('notAvailableTitle')} description={t('notAvailableDescription')} />
      </div>
    )
  }

  return <RegistryPageContent />
}

function RegistryPageContent() {
  const { t, i18n } = useTranslation('registry')
  const navigate = useNavigate()
  const entries = useRegistryStore((s) => s.entries)
  const scanning = useRegistryStore((s) => s.scanning)
  const scanned = useRegistryStore((s) => s.scanned)
  const fixing = useRegistryStore((s) => s.fixing)
  const fixProgress = useRegistryStore((s) => s.fixProgress)
  const expandedCards = useRegistryStore((s) => s.expandedCards)
  const fixResult = useRegistryStore((s) => s.fixResult)
  const showFailures = useRegistryStore((s) => s.showFailures)
  const error = useRegistryStore((s) => s.error)

  const [showConfirm, setShowConfirm] = useState(false)
  // When the list on screen was read; not kept across visits (the store has no clock).
  const [scannedAt, setScannedAt] = useState<number | null>(null)
  const fixStartRef = useRef<number>(0)
  const addHistoryEntry = useHistoryStore((s) => s.addEntry)
  const historyEntries = useHistoryStore((s) => s.entries)

  const handleScan = useCallback(async () => {
    const store = useRegistryStore.getState()
    store.setScanning(true)
    store.setScanned(false)
    store.setEntries([])
    store.setFixResult(null)
    store.setError(null)
    try {
      const results = await window.kudu.registryScan()
      useRegistryStore.getState().setEntries(Array.isArray(results) ? results : [])
      useRegistryStore.getState().setScanned(true)
      setScannedAt(Date.now())
      recordCheckRun('registry')
    } catch (err) {
      console.error('Registry scan failed:', err)
      toast.error(t('toastScanFailed'), { description: t('toastScanFailedDescription') })
      useRegistryStore.getState().setError(t('toastScanFailedError'))
    }
    useRegistryStore.getState().setScanning(false)
  }, [])

  const handleScanCancel = useCallback(async () => {
    try {
      await window.kudu.registryScanCancel()
    } catch {
      /* ignore */
    }
    useRegistryStore.getState().setScanning(false)
  }, [])

  const handleFixCancel = useCallback(async () => {
    try {
      await window.kudu.registryFixCancel()
    } catch {
      /* ignore */
    }
    useRegistryStore.getState().setFixing(false)
    useRegistryStore.getState().setFixProgress(null)
  }, [])

  const handleFix = useCallback(async () => {
    setShowConfirm(false)
    const store = useRegistryStore.getState()
    store.setFixing(true)
    store.setFixResult(null)
    store.setShowFailures(false)
    fixStartRef.current = Date.now()
    const currentEntries = useRegistryStore.getState().entries
    const selectedEntries = currentEntries.filter((e) => e.selected)
    const selectedIds = selectedEntries.map((e) => e.id)
    store.setFixProgress({
      current: 0,
      total: selectedIds.length,
      currentEntry: t('creatingBackup')
    })
    try {
      const result = await window.kudu.registryFix(selectedIds)
      const s = useRegistryStore.getState()
      s.setFixResult(result)
      s.setEntries(s.entries.filter((e) => !selectedIds.includes(e.id)))

      // Build category breakdown by entry type
      const byType: Record<string, { found: number; fixed: number }> = {}
      for (const e of selectedEntries) {
        if (!byType[e.type]) byType[e.type] = { found: 0, fixed: 0 }
        byType[e.type].found++
      }
      // Distribute fixed count proportionally
      const totalSelected = selectedEntries.length
      for (const t in byType) {
        byType[t].fixed = Math.round((byType[t].found / totalSelected) * result.fixed)
      }

      await addHistoryEntry({
        id: Date.now().toString(),
        type: 'registry',
        timestamp: new Date().toISOString(),
        duration: Date.now() - fixStartRef.current,
        totalItemsFound: currentEntries.length,
        totalItemsCleaned: result.fixed,
        totalItemsSkipped: result.failed,
        totalSpaceSaved: 0,
        categories: Object.entries(byType).map(([name, d]) => ({
          name,
          itemsFound: d.found,
          itemsCleaned: d.fixed,
          spaceSaved: 0
        })),
        errorCount: result.failed
      })
    } catch (err) {
      console.error('Registry fix failed:', err)
      toast.error(t('toastFixFailed'), { description: t('toastFixFailedDescription') })
      useRegistryStore.getState().setError(t('toastFixFailedError'))
    }
    useRegistryStore.getState().setFixing(false)
    useRegistryStore.getState().setFixProgress(null)
  }, [addHistoryEntry])

  const selected = entries.filter((e) => e.selected)
  const selectedCount = selected.length
  const busy = scanning || fixing
  const lastFix = useMemo(() => latestEntry(historyEntries, 'registry'), [historyEntries])
  const scannedAtText = scannedAt ? formatTime(scannedAt, i18n.language) : ''
  const showResults = scanned && !scanning && !fixing

  const areaRows = areas.map((area) => {
    const areaEntries = entries.filter((e) => area.types.includes(e.type))
    const chosen = areaEntries.filter((e) => e.selected).length
    const worst = areaEntries.reduce<RegistryEntry['risk'] | null>(
      (max, e) => (max === null || RISK_ORDER[e.risk] > RISK_ORDER[max] ? e.risk : max),
      null
    )
    return { area, areaEntries, chosen, worst }
  })
  const selectedAreaNames = areaRows
    .filter((row) => row.chosen > 0)
    .map((row) => t(row.area.titleKey))

  const riskCell = (risk: RegistryEntry['risk'] | null) =>
    risk === null ? (
      NO_VALUE
    ) : risk === 'high' ? (
      <Tag tone="danger">{t(riskKeyMap[risk])}</Tag>
    ) : (
      t(riskKeyMap[risk])
    )

  const headerAction =
    showResults || fixing ? (
      <Button variant="ghost" onClick={handleScan} disabled={busy}>
        {t('rescanButton')}
      </Button>
    ) : (
      <Button variant="primary" size="lg" onClick={handleScan} busy={scanning} disabled={fixing}>
        {t('scanButton')}
      </Button>
    )

  return (
    <div className="pulizia-page">
      <PageHeader title={t('pageTitle')} description={t('pageDescription')} action={headerAction} />

      <ReportNotice as="div" title={t('advancedNotice')} />

      {error && (
        <Card className="pulizia-notice-card">
          <ReportNotice
            as="div"
            tone="danger"
            role="alert"
            title={error}
            action={
              <Button variant="ghost" onClick={() => useRegistryStore.getState().setError(null)}>
                {t('dismissError')}
              </Button>
            }
          />
        </Card>
      )}

      {scanning && (
        <Section
          title={t('scanningTitle')}
          actions={
            <Button variant="ghost" onClick={handleScanCancel}>
              {t('cancelButton')}
            </Button>
          }
        >
          <div className="pulizia-progress" aria-live="polite">
            <ProgressBar indeterminate label={t('scanningTitle')} />
            <p className="pulizia-progress-step">{t('scanningDetail')}</p>
          </div>
        </Section>
      )}

      {fixing && fixProgress && (
        <Section
          title={t('fixingTitle')}
          meta={t('fixCounter', {
            current: formatNumber(fixProgress.current),
            total: formatNumber(fixProgress.total)
          })}
          actions={
            <Button variant="ghost" onClick={handleFixCancel}>
              {t('cancelButton')}
            </Button>
          }
        >
          <div className="pulizia-progress" aria-live="polite">
            <ProgressBar
              value={fixProgress.total > 0 ? fixProgress.current / fixProgress.total : undefined}
              label={t('fixingTitle')}
            />
            {fixProgress.currentEntry && (
              <p className="pulizia-progress-path" title={fixProgress.currentEntry}>
                {fixProgress.currentEntry}
              </p>
            )}
          </div>
        </Section>
      )}

      {fixResult && !fixing && (
        <>
          <Receipt
            title={fixResult.failed > 0 ? t('receiptTitleFailed') : t('receiptTitle')}
            value={t('receiptFixed', {
              count: fixResult.fixed,
              n: formatNumber(fixResult.fixed)
            })}
            facts={[
              lastFix ? formatDateTime(lastFix.timestamp, i18n.language) : '',
              t('receiptBackup')
            ]}
            skipped={
              fixResult.failed > 0
                ? t('receiptFailed', {
                    count: fixResult.failed,
                    n: formatNumber(fixResult.failed)
                  })
                : undefined
            }
            links={
              <>
                {fixResult.failures.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="pulizia-link"
                      aria-expanded={showFailures}
                      onClick={() => useRegistryStore.getState().setShowFailures(!showFailures)}
                    >
                      {showFailures ? t('receiptHideDetails') : t('receiptDetails')}
                    </button>
                    {' · '}
                  </>
                )}
                <Link to="/recovery">{t('receiptRecovery')}</Link>
              </>
            }
          />
          {showFailures && fixResult.failures.length > 0 && (
            <Section title={t('failuresTitle')}>
              <ul className="pulizia-errors">
                {fixResult.failures.map((f, i) => (
                  <li key={i}>
                    <span className="pulizia-path">{f.issue}</span>
                    {': '}
                    {f.reason}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}

      {!scanned && !scanning && (
        <EmptyState
          title={t('emptyTitle')}
          description={
            lastFix
              ? t('emptyLastFix', {
                  date: formatDateTime(lastFix.timestamp, i18n.language),
                  count: lastFix.totalItemsCleaned,
                  n: formatNumber(lastFix.totalItemsCleaned)
                })
              : t('emptyNoFix')
          }
          action={
            lastFix ? (
              <Button onClick={() => navigate('/recovery')}>{t('receiptRecovery')}</Button>
            ) : undefined
          }
          checks={areas.map((area) => ({
            title: t(area.titleKey),
            detail: t(area.descriptionKey)
          }))}
        />
      )}

      {showResults && (
        <Card as="section" className="pulizia-summary" aria-label={t('pageTitle')}>
          <div className="pulizia-summary-main">
            <div className="pulizia-summary-text">
              <p className="pulizia-summary-value">
                {entries.length === 0
                  ? t('noIssuesTitle')
                  : selectedCount > 0
                    ? t('summarySelected', { count: selectedCount, n: formatNumber(selectedCount) })
                    : t('summaryNothingSelected')}
              </p>
              {scannedAtText && (
                <p className="pulizia-summary-meta">
                  {t('summaryMeta', {
                    count: entries.length,
                    n: formatNumber(entries.length),
                    time: scannedAtText
                  })}
                </p>
              )}
            </div>
            {entries.length > 0 && (
              <Button
                variant="primary"
                size="lg"
                onClick={() => setShowConfirm(true)}
                disabled={selectedCount === 0}
              >
                {selectedCount > 0
                  ? t('fixSelected', { count: selectedCount, n: formatNumber(selectedCount) })
                  : t('fixNone')}
              </Button>
            )}
          </div>
        </Card>
      )}

      {showResults && (
        <Card className="pulizia-table-card">
          <Table className="pulizia-table">
            <TableHead>
              <TableHeaderCell className="pulizia-check">
                <span className="sr-only">{t('columnSelect')}</span>
              </TableHeaderCell>
              <TableHeaderCell>{t('columnArea')}</TableHeaderCell>
              <TableHeaderCell numeric>{t('columnIssues')}</TableHeaderCell>
              <TableHeaderCell>{t('columnRisk')}</TableHeaderCell>
              <TableHeaderCell>{t('columnNote')}</TableHeaderCell>
            </TableHead>
            <tbody>
              {areaRows.map(({ area, areaEntries, chosen, worst }, index) => {
                const count = areaEntries.length
                const open = count > 0 && expandedCards.has(index)
                const title = t(area.titleKey)
                const checks =
                  area.totalChecks !== undefined
                    ? t('checksPassed', {
                        passed: Math.max(0, area.totalChecks - count),
                        total: area.totalChecks
                      })
                    : ''
                return (
                  <Fragment key={area.titleKey}>
                    <TableRow selected={count > 0 && chosen === count}>
                      <TableCell className="pulizia-check">
                        {count > 0 && (
                          <Checkbox
                            checked={chosen === count}
                            indeterminate={chosen > 0 && chosen < count}
                            onChange={() => useRegistryStore.getState().toggleCardAll(area.types)}
                            label={t('selectArea', { name: title })}
                          />
                        )}
                      </TableCell>
                      <TableCell className="pulizia-name">
                        <span className="pulizia-name-line">
                          {count > 0 ? (
                            <button
                              type="button"
                              className="pulizia-disclosure"
                              aria-expanded={open}
                              onClick={() => useRegistryStore.getState().toggleCardExpand(index)}
                            >
                              <ChevronRight
                                className="pulizia-chevron"
                                size={14}
                                strokeWidth={1.75}
                                aria-hidden="true"
                              />
                              <span>{title}</span>
                            </button>
                          ) : (
                            <span>{title}</span>
                          )}
                          {count === 0 && (
                            <Tag tone="ok">
                              <span aria-hidden="true">· </span>
                              {t('noIssues')}
                            </Tag>
                          )}
                        </span>
                      </TableCell>
                      <TableCell numeric>{formatNumber(count)}</TableCell>
                      <TableCell>{riskCell(worst)}</TableCell>
                      <TableCell muted className="pulizia-note">
                        {[t(area.descriptionKey), checks].filter(Boolean).join(' · ')}
                      </TableCell>
                    </TableRow>
                    {open &&
                      areaEntries.map((entry) => (
                        <TableRow key={entry.id} data-level="sub" selected={entry.selected}>
                          <TableCell className="pulizia-check">
                            <Checkbox
                              checked={entry.selected}
                              onChange={() => useRegistryStore.getState().toggleEntry(entry.id)}
                              label={entry.issue}
                            />
                          </TableCell>
                          <TableCell className="pulizia-name pulizia-sub">
                            <span className="pulizia-entry">
                              <span>{entry.issue}</span>
                              <span className="pulizia-path">{entry.keyPath}</span>
                            </span>
                          </TableCell>
                          <TableCell numeric />
                          <TableCell>{riskCell(entry.risk)}</TableCell>
                          <TableCell muted className="pulizia-note">
                            {t(typeKeyMap[entry.type])}
                          </TableCell>
                        </TableRow>
                      ))}
                  </Fragment>
                )
              })}
            </tbody>
          </Table>
        </Card>
      )}

      <ConfirmDialog
        open={showConfirm}
        onConfirm={handleFix}
        onCancel={() => setShowConfirm(false)}
        title={t('confirmTitle', { count: selectedCount, n: formatNumber(selectedCount) })}
        description={t('confirmDescription', {
          list: formatList(selectedAreaNames, i18n.language)
        })}
        confirmLabel={t('fixSelected', { count: selectedCount, n: formatNumber(selectedCount) })}
      />
    </div>
  )
}
