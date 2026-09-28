import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { AppIcon } from '@/components/shared/AppIcon'
import { ReportNotice } from '@/components/cleaner/ReportNotice'
import '@/components/cleaner/pulizia.css'
import {
  Button,
  Card,
  ProgressBar,
  Section,
  Segmented,
  Switch,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tag
} from '@/components/ui'
import { formatDateTime, formatDelay } from '@/lib/cleaner-report'
import { icons } from '@/lib/icons'
import { formatNumber } from '@/lib/utils'
import { usePlatform } from '@/hooks/usePlatform'
import { useStartupStore } from '@/stores/startup-store'
import { useHistoryStore } from '@/stores/history-store'
import type { StartupItem, StartupBootTrace } from '@shared/types'

const impactKeys: Record<StartupItem['impact'], string> = {
  high: 'impactHigh',
  medium: 'impactMedium',
  low: 'impactLow',
  none: 'impactNone'
}

const sourceKeys: Record<StartupItem['source'], string> = {
  'registry-hkcu': 'sourceUserRegistry',
  'registry-hklm': 'sourceSystemRegistry',
  'startup-folder': 'sourceStartupFolder',
  'task-scheduler': 'sourceTaskScheduler',
  'launch-agent-user': 'sourceLaunchAgentUser',
  'launch-agent-global': 'sourceLaunchAgentGlobal',
  'login-item': 'sourceLoginItem',
  'systemd-user': 'sourceSystemdUser',
  'autostart-desktop': 'sourceAutostartDesktop',
  cron: 'sourceCron'
}

/** Apps listed in the boot measurement; the rest are counted. */
const TRACE_SHOWN = 15

/** A chart only makes sense with two values that differ; a flat set reads as one sentence. */
function hasSpread(values: number[]): boolean {
  if (values.length < 2) return false
  const max = Math.max(...values)
  const min = Math.min(...values)
  return max > 0 && max - min >= max * 0.1
}

function BootTraceSection({
  trace,
  loading,
  onRelaunch
}: {
  trace: StartupBootTrace | null
  loading: boolean
  onRelaunch?: () => void
}) {
  const { t, i18n } = useTranslation('startup')
  const locale = i18n.language

  if (loading) {
    return (
      <Section title={t('bootTraceTitle')}>
        <div className="pulizia-progress" aria-live="polite">
          <ProgressBar indeterminate label={t('bootTraceAnalyzing')} />
          <p className="pulizia-progress-step">{t('bootTraceAnalyzing')}</p>
        </div>
      </Section>
    )
  }

  if (!trace || !trace.available) {
    return (
      <Card className="pulizia-notice-card">
        <ReportNotice
          as="div"
          icon={icons.note}
          title={trace?.needsAdmin ? t('bootTraceNeedsAdmin') : t('bootTraceNotAvailable')}
          action={
            trace?.needsAdmin && onRelaunch ? (
              <Button onClick={onRelaunch}>{t('relaunchAsAdmin')}</Button>
            ) : undefined
          }
        />
      </Card>
    )
  }

  const entries = [...trace.entries].sort((a, b) => b.delayMs - a.delayMs)
  const shown = entries.slice(0, TRACE_SHOWN)
  const maxDelay = Math.max(...shown.map((e) => e.delayMs), 0)
  const highImpact = entries.filter((e) => e.impact === 'high')
  const potentialSavings = highImpact.reduce((s, e) => s + e.delayMs, 0)
  const bars = hasSpread(shown.map((e) => e.delayMs))

  return (
    <Section
      title={t('bootTraceTitle')}
      meta={
        trace.lastBootDate
          ? t('bootTraceLastBoot', { date: formatDateTime(trace.lastBootDate, locale) })
          : t('bootTraceBasedOnLastBoot')
      }
    >
      <p className="pulizia-summary-meta">
        {t('bootTraceSummary', {
          total: formatDelay(trace.totalBootMs, locale),
          apps: formatDelay(trace.startupAppsMs, locale),
          count: entries.length,
          n: formatNumber(entries.length)
        })}
        {potentialSavings > 0 &&
          ` ${t('bootTraceSavings', {
            count: highImpact.length,
            n: formatNumber(highImpact.length),
            time: formatDelay(potentialSavings, locale)
          })}`}
      </p>
      {shown.length > 0 ? (
        <Table className="pulizia-table pulizia-trace">
          <TableHead>
            <TableHeaderCell>{t('columnApp')}</TableHeaderCell>
            <TableHeaderCell>{t('columnImpact')}</TableHeaderCell>
            <TableHeaderCell numeric>{t('columnDelay')}</TableHeaderCell>
            {bars && (
              <TableHeaderCell className="pulizia-bar-cell">
                <span className="sr-only">{t('chartBootTimeImpact')}</span>
              </TableHeaderCell>
            )}
          </TableHead>
          <tbody>
            {shown.map((entry) => (
              <TableRow key={entry.name}>
                <TableCell>{entry.displayName.replace(/\.exe$/i, '')}</TableCell>
                <TableCell muted>{t(impactKeys[entry.impact])}</TableCell>
                <TableCell numeric>{formatDelay(entry.delayMs, locale)}</TableCell>
                {bars && (
                  <TableCell className="pulizia-bar-cell" aria-hidden="true">
                    <span className="pulizia-bar">
                      <span
                        className="pulizia-bar-fill"
                        style={{
                          transform: `scaleX(${maxDelay > 0 ? entry.delayMs / maxDelay : 0})`
                        }}
                      />
                    </span>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </tbody>
        </Table>
      ) : (
        <p className="pulizia-footnote">{t('chartNoPerAppData')}</p>
      )}
      {entries.length > shown.length && (
        <p className="pulizia-footnote">
          {t('bootTraceMore', { count: entries.length - shown.length })}
        </p>
      )}
    </Section>
  )
}

export function StartupPage() {
  const { t } = useTranslation('startup')
  const { platform } = usePlatform()
  const items = useStartupStore((s) => s.items)
  const loading = useStartupStore((s) => s.loading)
  const sortBy = useStartupStore((s) => s.sortBy)
  const filterBy = useStartupStore((s) => s.filterBy)
  const error = useStartupStore((s) => s.error)
  const bootTrace = useStartupStore((s) => s.bootTrace)
  const traceLoading = useStartupStore((s) => s.traceLoading)
  const deleteTarget = useStartupStore((s) => s.deleteTarget)

  const store = useStartupStore

  const loadItems = useCallback(async () => {
    store.getState().setLoading(true)
    store.getState().setError(null)
    try {
      const list = await window.kudu.startupList()
      store.getState().setItems(list)
    } catch (err) {
      console.error('Failed to load startup items:', err)
      store.getState().setError(t('errorFailedToLoad'))
    }
    store.getState().setLoading(false)
  }, [])

  const loadBootTrace = useCallback(async () => {
    store.getState().setTraceLoading(true)
    try {
      const trace = await window.kudu.startupBootTrace()
      store.getState().setBootTrace(trace)
    } catch (err) {
      console.error('Failed to load boot trace:', err)
    }
    store.getState().setTraceLoading(false)
  }, [])

  useEffect(() => {
    // Always re-read on mount: entries change outside the app (installs,
    // uninstalls, Task Manager) and the store keeps the previous visit's list.
    loadItems()
    if (!bootTrace) {
      loadBootTrace()
    }
  }, [loadItems, loadBootTrace])

  const toggleFailed = (item: StartupItem, enabled: boolean) => {
    store.getState().updateItem(item.id, { enabled: !enabled })
    toast.error(
      enabled
        ? t('toastFailedToEnable', { name: item.displayName })
        : t('toastFailedToDisable', { name: item.displayName }),
      { description: t('toastAdminRequired') }
    )
    store
      .getState()
      .setError(
        enabled
          ? t('errorFailedToEnable', { name: item.displayName })
          : t('errorFailedToDisable', { name: item.displayName })
      )
  }

  const handleToggle = async (item: StartupItem, enabled: boolean) => {
    const startTime = Date.now()
    store.getState().updateItem(item.id, { enabled })
    try {
      const success = await window.kudu.startupToggle(
        item.name,
        item.location,
        item.command,
        item.source,
        enabled
      )
      if (!success) {
        toggleFailed(item, enabled)
        return
      }
      await useHistoryStore.getState().addEntry({
        id: Date.now().toString(),
        type: 'startup',
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        totalItemsFound: 1,
        totalItemsCleaned: 1,
        totalItemsSkipped: 0,
        totalSpaceSaved: 0,
        categories: [
          {
            name: enabled ? t('historyCategoryEnabled') : t('historyCategoryDisabled'),
            itemsFound: 1,
            itemsCleaned: 1,
            spaceSaved: 0
          }
        ],
        errorCount: 0
      })
    } catch {
      toggleFailed(item, enabled)
    }
  }

  const handleDelete = async (item: StartupItem) => {
    const startTime = Date.now()
    try {
      const success = await window.kudu.startupDelete(
        item.name,
        item.source === 'startup-folder' ? item.command : item.location,
        item.source
      )
      if (success) {
        store.getState().removeItem(item.id)
        await useHistoryStore.getState().addEntry({
          id: Date.now().toString(),
          type: 'startup',
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime,
          totalItemsFound: 1,
          totalItemsCleaned: 1,
          totalItemsSkipped: 0,
          totalSpaceSaved: 0,
          categories: [
            { name: t('historyCategoryRemoved'), itemsFound: 1, itemsCleaned: 1, spaceSaved: 0 }
          ],
          errorCount: 0
        })
      } else {
        toast.error(t('toastFailedToRemove', { name: item.displayName }), {
          description: t('toastAdminRequired')
        })
        store.getState().setError(t('errorFailedToRemove', { name: item.displayName }))
      }
    } catch {
      toast.error(t('toastFailedToRemove', { name: item.displayName }), {
        description: t('toastAdminRequired')
      })
      store.getState().setError(t('errorFailedToRemove', { name: item.displayName }))
    }
    store.getState().setDeleteTarget(null)
  }

  const handleRefresh = () => {
    loadItems()
    loadBootTrace()
  }

  const impactOrder: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 }
  const filtered = items.filter((i) =>
    filterBy === 'all' ? true : filterBy === 'active' ? i.enabled : !i.enabled
  )
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'impact') return impactOrder[a.impact] - impactOrder[b.impact]
    return a.displayName.localeCompare(b.displayName)
  })
  const activeCount = items.filter((i) => i.enabled).length

  return (
    <div className="pulizia-page">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <Button variant="ghost" icon={RefreshCw} busy={loading} onClick={handleRefresh}>
            {t('refreshButton')}
          </Button>
        }
      />

      <BootTraceSection
        trace={bootTrace}
        loading={traceLoading}
        onRelaunch={platform !== 'darwin' ? () => window.kudu.elevationRelaunch() : undefined}
      />

      {error && (
        <Card className="pulizia-notice-card">
          <ReportNotice
            as="div"
            tone="danger"
            role="alert"
            title={error}
            action={
              <Button variant="ghost" onClick={() => store.getState().setError(null)}>
                {t('dismissError')}
              </Button>
            }
          />
        </Card>
      )}

      {items.length === 0 && !loading && !error && (
        <EmptyState title={t('emptyStateTitle')} description={t('emptyStateDescription')} />
      )}

      {items.length > 0 && (
        <Section
          title={t('listTitle')}
          meta={t('listMeta', {
            active: formatNumber(activeCount),
            disabled: formatNumber(items.length - activeCount)
          })}
          actions={
            <>
              <Segmented
                label={t('filterLabel')}
                value={filterBy}
                onChange={(value) => store.getState().setFilterBy(value)}
                options={[
                  { value: 'all', label: t('filterAll') },
                  { value: 'active', label: t('filterActive') },
                  { value: 'disabled', label: t('filterDisabled') }
                ]}
              />
              <Segmented
                label={t('sortLabel')}
                value={sortBy}
                onChange={(value) => store.getState().setSortBy(value)}
                options={[
                  { value: 'impact', label: t('sortByImpact') },
                  { value: 'name', label: t('sortByName') }
                ]}
              />
            </>
          }
        >
          {sorted.length === 0 ? (
            <p className="pulizia-footnote">{t('filterEmpty')}</p>
          ) : (
            <div className="pulizia-table-scroll">
              <Table className="pulizia-table">
                <TableHead>
                  <TableHeaderCell>{t('columnApp')}</TableHeaderCell>
                  <TableHeaderCell>{t('columnImpact')}</TableHeaderCell>
                  <TableHeaderCell>{t('columnState')}</TableHeaderCell>
                  <TableHeaderCell>
                    <span className="sr-only">{t('columnActions')}</span>
                  </TableHeaderCell>
                </TableHead>
                <tbody>
                  {sorted.map((item) => (
                    <TableRow
                      key={item.id}
                      recommended={item.stale}
                      data-disabled={!item.enabled || undefined}
                    >
                      <TableCell className="pulizia-name">
                        <span className="pulizia-app">
                          <AppIcon small />
                          <span className="pulizia-entry">
                            <span className="pulizia-name-line">
                              <span className="pulizia-app-name">{item.displayName}</span>
                              {item.stale && (
                                <Tag tone="recommended">
                                  <span aria-hidden="true">· </span>
                                  {t('staleRecommended')}
                                </Tag>
                              )}
                            </span>
                            <span className="pulizia-app-meta">
                              {[item.publisher, t(sourceKeys[item.source])]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                            <span className="pulizia-path" title={item.command}>
                              {item.command}
                            </span>
                            {item.stale && (
                              <span className="pulizia-app-meta">{t('staleNote')}</span>
                            )}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell muted>
                        {t(impactKeys[item.impact])}
                        {item.impact === 'none' && (
                          <span className="pulizia-app-meta">{t('impactNoneNote')}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="pulizia-switch">
                          <Switch
                            checked={item.enabled}
                            onChange={(value) => handleToggle(item, value)}
                            label={t('toggleLabel', { name: item.displayName })}
                          />
                          <span>{item.enabled ? t('stateActive') : t('stateDisabled')}</span>
                        </span>
                      </TableCell>
                      <TableCell className="pulizia-row-actions">
                        <Button
                          variant="ghost"
                          icon={Trash2}
                          onClick={() => store.getState().setDeleteTarget(item)}
                          title={t('removeButtonTitle', { name: item.displayName })}
                          aria-label={t('removeButtonTitle', { name: item.displayName })}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Section>
      )}

      {deleteTarget && (
        <ConfirmDialog
          open
          onCancel={() => store.getState().setDeleteTarget(null)}
          onConfirm={() => handleDelete(deleteTarget)}
          title={t('confirmRemoveTitle', { name: deleteTarget.displayName })}
          description={t('confirmRemoveDescription')}
          details={
            deleteTarget.command && deleteTarget.command !== 'undefined'
              ? deleteTarget.command
              : undefined
          }
          confirmLabel={t('confirmRemoveLabel')}
          variant="danger"
        />
      )}
    </div>
  )
}
