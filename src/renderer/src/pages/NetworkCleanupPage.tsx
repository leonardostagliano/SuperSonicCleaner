import { Fragment, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Receipt } from '@/components/shared/Receipt'
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
import { icons } from '@/lib/icons'
import { formatDateTime, formatList, formatTime, latestEntry } from '@/lib/cleaner-report'
import { formatNumber } from '@/lib/utils'
import type { NetworkItem } from '@shared/types'
import { useHistoryStore } from '@/stores/history-store'
import { useNetworkStore } from '@/stores/network-store'
import { usePlatform } from '@/hooks/usePlatform'

type NetworkCategory = NetworkItem['type']

interface CategoryDef {
  type: NetworkCategory
  labelKey: string
  descriptionKey: string
}

const categories: CategoryDef[] = [
  { type: 'dns-cache', labelKey: 'categoryDnsCache', descriptionKey: 'categoryDnsCacheDesc' },
  {
    type: 'wifi-profile',
    labelKey: 'categoryWifiProfiles',
    descriptionKey: 'categoryWifiProfilesDesc'
  },
  { type: 'arp-cache', labelKey: 'categoryArpCache', descriptionKey: 'categoryArpCacheDesc' },
  {
    type: 'network-history',
    labelKey: 'categoryNetworkHistory',
    descriptionKey: 'categoryNetworkHistoryDesc'
  }
]

/** Categories whose removal cannot be undone (saved passwords, the network history). */
const IRREVERSIBLE: NetworkCategory[] = ['wifi-profile', 'network-history']

export function NetworkCleanupPage() {
  const { t, i18n } = useTranslation('network')
  const navigate = useNavigate()
  const { platform } = usePlatform()
  const visibleCategories = useMemo(
    () =>
      categories.filter((c) => {
        if (c.type === 'network-history' && platform !== 'win32') return false
        return true
      }),
    [platform]
  )
  const items = useNetworkStore((s) => s.items)
  const selectedIds = useNetworkStore((s) => s.selectedIds)
  const status = useNetworkStore((s) => s.status)
  const cleanResult = useNetworkStore((s) => s.cleanResult)

  const [showConfirm, setShowConfirm] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [openCategories, setOpenCategories] = useState<Set<NetworkCategory>>(new Set())
  // When the list on screen was read; not kept across visits (the store has no clock).
  const [scannedAt, setScannedAt] = useState<number | null>(null)
  const addHistoryEntry = useHistoryStore((s) => s.addEntry)
  const historyEntries = useHistoryStore((s) => s.entries)

  const handleScan = useCallback(async () => {
    const store = useNetworkStore.getState()
    store.setStatus('scanning')
    store.setItems([])
    store.setSelectedIds(new Set())
    store.setCleanResult(null)
    setShowDetails(false)
    try {
      const result = await window.kudu.networkScan()
      const s = useNetworkStore.getState()
      s.setItems(result)
      const preSelected = new Set(result.filter((i) => i.selected).map((i) => i.id))
      s.setSelectedIds(preSelected)
      s.setStatus('complete')
      setScannedAt(Date.now())
    } catch {
      toast.error(t('scanFailedToast'))
      useNetworkStore.getState().setStatus('idle')
    }
  }, [])

  const handleClean = useCallback(async () => {
    setShowConfirm(false)
    setShowDetails(false)
    const store = useNetworkStore.getState()
    store.setStatus('cleaning')
    const cleanStart = Date.now()
    try {
      const { selectedIds: currentSelectedIds, items: currentItems } = useNetworkStore.getState()
      const result = await window.kudu.networkClean([...currentSelectedIds])
      const s = useNetworkStore.getState()
      s.setCleanResult(result)
      // Remove cleaned items from list
      s.setItems(currentItems.filter((i) => !currentSelectedIds.has(i.id)))
      s.setSelectedIds(new Set())

      // Log to scan history
      const byType: Record<string, { found: number; cleaned: number }> = {}
      for (const item of currentItems) {
        if (!byType[item.type]) byType[item.type] = { found: 0, cleaned: 0 }
        byType[item.type].found++
        if (currentSelectedIds.has(item.id)) byType[item.type].cleaned++
      }
      await addHistoryEntry({
        id: Date.now().toString(),
        type: 'network',
        timestamp: new Date().toISOString(),
        duration: Date.now() - cleanStart,
        totalItemsFound: currentItems.length,
        totalItemsCleaned: result.cleaned,
        totalItemsSkipped: result.failed,
        totalSpaceSaved: 0,
        categories: Object.entries(byType).map(([name, d]) => ({
          name,
          itemsFound: d.found,
          itemsCleaned: d.cleaned,
          spaceSaved: 0
        })),
        errorCount: result.failed
      })

      useNetworkStore.getState().setStatus('complete')

      // Re-scan after cleaning to show the actual current state —
      // without this, items like DNS/ARP appear removed but come back on next manual scan
      try {
        const freshItems = await window.kudu.networkScan()
        const ns = useNetworkStore.getState()
        ns.setItems(freshItems)
        ns.setSelectedIds(new Set())
        setScannedAt(Date.now())
      } catch {
        /* re-scan is best-effort */
      }
    } catch {
      toast.error(t('cleanupFailedToast'))
      useNetworkStore.getState().setStatus('idle')
    }
  }, [addHistoryEntry])

  const isScanning = status === 'scanning'
  const isCleaning = status === 'cleaning'
  const hasItems = items.length > 0
  const scanned = status === 'complete'
  const lastClean = useMemo(() => latestEntry(historyEntries, 'network'), [historyEntries])
  const scannedAtText = scannedAt ? formatTime(scannedAt, i18n.language) : ''

  const groups = visibleCategories.map((def) => {
    const groupItems = items.filter((i) => i.type === def.type)
    const chosen = groupItems.filter((i) => selectedIds.has(i.id)).length
    return {
      def,
      groupItems,
      chosen,
      // The scanner pre-selects what is safe to clear (caches); the rest is opt-in.
      recommended: groupItems.some((i) => i.selected)
    }
  })
  const foundGroups = groups.filter((g) => g.groupItems.length > 0)
  const emptyGroups = groups.filter((g) => g.groupItems.length === 0)
  const selectedGroups = foundGroups.filter((g) => g.chosen > 0)
  const selectedCount = selectedIds.size
  const irreversible = selectedGroups.some((g) => IRREVERSIBLE.includes(g.def.type))

  const toggleOpen = (type: NetworkCategory) =>
    setOpenCategories((previous) => {
      const next = new Set(previous)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })

  const headerAction =
    scanned && hasItems ? (
      <Button variant="ghost" onClick={handleScan} disabled={isCleaning}>
        {t('rescanButton')}
      </Button>
    ) : (
      <Button
        variant="primary"
        size="lg"
        onClick={handleScan}
        busy={isScanning}
        disabled={isCleaning}
      >
        {t('scanButton')}
      </Button>
    )

  return (
    <div className="pulizia-page">
      <PageHeader
        title={t('pageTitle')}
        description={platform === 'win32' ? t('pageDescriptionWindows') : t('pageDescriptionOther')}
        action={headerAction}
      />

      {(isScanning || isCleaning) && (
        <Section title={isScanning ? t('scanningTitle') : t('cleaningTitle')}>
          <div className="pulizia-progress" aria-live="polite">
            <ProgressBar
              indeterminate
              label={isScanning ? t('scanningTitle') : t('cleaningTitle')}
            />
            <p className="pulizia-progress-step">
              {isScanning ? t('scanningStatus') : t('cleaningStatus')}
            </p>
          </div>
        </Section>
      )}

      {cleanResult && scanned && (
        <>
          <Receipt
            title={cleanResult.failed > 0 ? t('receiptTitleFailed') : t('receiptTitle')}
            value={t('receiptCleaned', {
              count: cleanResult.cleaned,
              n: formatNumber(cleanResult.cleaned)
            })}
            facts={[lastClean ? formatDateTime(lastClean.timestamp, i18n.language) : '']}
            skipped={
              cleanResult.failed > 0
                ? t('receiptFailed', {
                    count: cleanResult.failed,
                    n: formatNumber(cleanResult.failed)
                  })
                : undefined
            }
            links={
              <>
                {cleanResult.details.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="pulizia-link"
                      aria-expanded={showDetails}
                      onClick={() => setShowDetails((open) => !open)}
                    >
                      {showDetails ? t('receiptHideDetails') : t('receiptDetails')}
                    </button>
                    {' · '}
                  </>
                )}
                <Link to="/history">{t('receiptHistory')}</Link>
              </>
            }
          />
          {showDetails && cleanResult.details.length > 0 && (
            <Section title={t('detailsTitle')}>
              <ul className="pulizia-errors">
                {cleanResult.details.map((detail, i) => (
                  <li key={i}>
                    <span className="pulizia-path">{detail}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}

      {!hasItems && !isScanning && !isCleaning && !scanned && (
        <EmptyState
          title={t('emptyTitle')}
          description={
            lastClean
              ? t('emptyLastClean', {
                  date: formatDateTime(lastClean.timestamp, i18n.language),
                  count: lastClean.totalItemsCleaned,
                  n: formatNumber(lastClean.totalItemsCleaned)
                })
              : t('emptyNoClean')
          }
          action={
            lastClean ? (
              <Button onClick={() => navigate('/history')}>{t('receiptHistory')}</Button>
            ) : undefined
          }
          checks={visibleCategories.map((c) => ({
            title: t(c.labelKey),
            detail: t(c.descriptionKey)
          }))}
        />
      )}

      {scanned && !hasItems && (
        <Card className="pulizia-summary">
          <div className="pulizia-summary-text">
            <p className="pulizia-summary-value">{t('nothingFoundTitle')}</p>
            {scannedAtText && (
              <p className="pulizia-summary-meta">
                {t('nothingFoundDescription', { time: scannedAtText })}
              </p>
            )}
          </div>
        </Card>
      )}

      {scanned && hasItems && (
        <Card as="section" className="pulizia-summary" aria-label={t('pageTitle')}>
          <div className="pulizia-summary-main">
            <div className="pulizia-summary-text">
              <p className="pulizia-summary-value">
                {selectedCount > 0
                  ? t('summarySelected', { count: selectedCount, n: formatNumber(selectedCount) })
                  : t('summaryNothingSelected')}
              </p>
              <p className="pulizia-summary-meta">
                {t('summaryMeta', {
                  count: items.length,
                  n: formatNumber(items.length),
                  time: scannedAtText
                })}
              </p>
            </div>
            <Button
              variant="primary"
              size="lg"
              icon={icons.clean}
              onClick={() => setShowConfirm(true)}
              disabled={selectedCount === 0}
            >
              {selectedCount > 0
                ? t('cleanSelected', { count: selectedCount, n: formatNumber(selectedCount) })
                : t('cleanButton')}
            </Button>
          </div>
        </Card>
      )}

      {scanned && hasItems && (
        <Card className="pulizia-table-card">
          <Table className="pulizia-table">
            <TableHead>
              <TableHeaderCell className="pulizia-check">
                <span className="sr-only">{t('columnSelect')}</span>
              </TableHeaderCell>
              <TableHeaderCell>{t('columnCategory')}</TableHeaderCell>
              <TableHeaderCell numeric>{t('columnItems')}</TableHeaderCell>
              <TableHeaderCell>{t('columnNote')}</TableHeaderCell>
            </TableHead>
            <tbody>
              {foundGroups.map(({ def, groupItems, chosen, recommended }) => {
                const open = openCategories.has(def.type)
                const label = t(def.labelKey)
                return (
                  <Fragment key={def.type}>
                    <TableRow recommended={recommended} selected={chosen === groupItems.length}>
                      <TableCell className="pulizia-check">
                        <Checkbox
                          checked={chosen === groupItems.length}
                          indeterminate={chosen > 0 && chosen < groupItems.length}
                          onChange={() => useNetworkStore.getState().toggleCategory(def.type)}
                          label={t('selectRow', { name: label })}
                        />
                      </TableCell>
                      <TableCell className="pulizia-name">
                        <span className="pulizia-name-line">
                          <button
                            type="button"
                            className="pulizia-disclosure"
                            aria-expanded={open}
                            onClick={() => toggleOpen(def.type)}
                          >
                            <ChevronRight
                              className="pulizia-chevron"
                              size={14}
                              strokeWidth={1.75}
                              aria-hidden="true"
                            />
                            <span>{label}</span>
                          </button>
                          {recommended && (
                            <Tag tone="recommended">
                              <span aria-hidden="true">· </span>
                              {t('recommended')}
                            </Tag>
                          )}
                        </span>
                      </TableCell>
                      <TableCell numeric>{formatNumber(groupItems.length)}</TableCell>
                      <TableCell muted className="pulizia-note">
                        {t(def.descriptionKey)}
                      </TableCell>
                    </TableRow>
                    {open &&
                      groupItems.map((item) => (
                        <TableRow
                          key={item.id}
                          data-level="sub"
                          selected={selectedIds.has(item.id)}
                        >
                          <TableCell className="pulizia-check">
                            <Checkbox
                              checked={selectedIds.has(item.id)}
                              onChange={() => useNetworkStore.getState().toggleItem(item.id)}
                              label={t('selectRow', { name: item.label })}
                            />
                          </TableCell>
                          <TableCell className="pulizia-name pulizia-sub">{item.label}</TableCell>
                          <TableCell numeric />
                          <TableCell muted className="pulizia-note">
                            {item.detail}
                          </TableCell>
                        </TableRow>
                      ))}
                  </Fragment>
                )
              })}
            </tbody>
          </Table>
          {emptyGroups.length > 0 && (
            <p className="pulizia-footnote">
              {t('emptyCategories', {
                list: formatList(
                  emptyGroups.map((g) => t(g.def.labelKey)),
                  i18n.language
                )
              })}
            </p>
          )}
        </Card>
      )}

      <ConfirmDialog
        open={showConfirm}
        onConfirm={handleClean}
        onCancel={() => setShowConfirm(false)}
        title={t('confirmTitle', { count: selectedCount, n: formatNumber(selectedCount) })}
        description={[
          t('confirmScope', {
            list: formatList(
              selectedGroups.map((g) => t(g.def.labelKey)),
              i18n.language
            )
          }),
          selectedGroups.some((g) => g.def.type === 'dns-cache' || g.def.type === 'arp-cache')
            ? t('confirmCaches')
            : '',
          selectedGroups.some((g) => g.def.type === 'wifi-profile') ? t('confirmWifiWarning') : '',
          platform === 'win32' && selectedGroups.some((g) => g.def.type === 'network-history')
            ? t('confirmNetworkHistoryWarning')
            : ''
        ]
          .filter(Boolean)
          .join(' ')}
        confirmLabel={t('cleanSelected', { count: selectedCount, n: formatNumber(selectedCount) })}
        variant={irreversible ? 'danger' : 'default'}
      />
    </div>
  )
}
