import './history-page.css'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import { Download, FileWarning, FolderOpen, Trash2, X, type LucideIcon } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType
} from 'recharts'
import { CleanupReceipts } from '@/components/cleaner/CleanupReceipts'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Receipt } from '@/components/shared/Receipt'
import {
  Button,
  Card,
  Section,
  Segmented,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tag
} from '@/components/ui'
import { useHistoryStore } from '@/stores/history-store'
import { formatBytes, NO_VALUE } from '@/lib/utils'
import { icons } from '@/lib/icons'
import { historyCategoryLabel } from '@/lib/history-categories'
import {
  breakdownByCategory,
  breakdownByType,
  formatCount,
  formatDateTime,
  formatDay,
  formatShortDay,
  isChartable,
  keyToDate,
  spaceByDay,
  summarizeHistory,
  typesPresent
} from '@/lib/history-report'
import type { ScanHistoryEntry, HistoryEntryType, DeletedFileRecord } from '@shared/types'

/** Monochrome glyphs from the shared map; colour is kept for the outcome only. */
const typeIcons: Record<HistoryEntryType, LucideIcon> = {
  cleaner: icons.clean,
  registry: icons.registry,
  debloater: icons.debloat,
  network: icons.network,
  drivers: icons.drivers,
  malware: icons.malware,
  privacy: icons.privacy,
  startup: icons.startup,
  services: icons.services,
  'software-update': icons.updates,
  // Malware owns ShieldAlert: a vulnerability scan reads as a file warning.
  'cve-scan': FileWarning
}

const typeLabelKeys: Record<HistoryEntryType, string> = {
  cleaner: 'typeLabels.cleaner',
  registry: 'typeLabels.registry',
  debloater: 'typeLabels.debloater',
  network: 'typeLabels.network',
  drivers: 'typeLabels.drivers',
  malware: 'typeLabels.malware',
  privacy: 'typeLabels.privacy',
  startup: 'typeLabels.startup',
  services: 'typeLabels.services',
  'software-update': 'typeLabels.softwareUpdate',
  'cve-scan': 'typeLabels.cveScan'
}

type View = 'overview' | 'list' | 'receipts'
type Translate = TFunction<'history'>

function formatDuration(ms: number, t: Translate): string {
  if (ms < 1000) return t('duration.lessThanOneSecond')
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return t('duration.seconds', { count: seconds })
  return t('duration.minutesAndSeconds', {
    minutes: Math.floor(seconds / 60),
    seconds: seconds % 60
  })
}

export function HistoryPage() {
  const [searchParams] = useSearchParams()
  const { t } = useTranslation('history')
  const { entries, loaded, load, clear } = useHistoryStore()
  const [view, setView] = useState<View>(
    searchParams.get('view') === 'receipts' ? 'receipts' : 'overview'
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const closeDetail = useCallback(() => setSelectedId(null), [])

  useEffect(() => {
    void load()
  }, [load])

  const selected = entries.find((e) => e.id === selectedId) ?? null

  return (
    <div className="history-page">
      <PageHeader
        title={t('pageTitle')}
        action={
          <>
            <Segmented<View>
              label={t('viewLabel')}
              value={view}
              onChange={setView}
              options={[
                { value: 'overview', label: t('viewOverview') },
                { value: 'list', label: t('viewList') },
                { value: 'receipts', label: t('viewReceipts') }
              ]}
            />
            {view !== 'receipts' && entries.length > 0 && (
              <Button variant="ghost" icon={Trash2} onClick={() => setConfirmClear(true)}>
                {t('clearHistory')}
              </Button>
            )}
          </>
        }
      />

      {view === 'receipts' ? (
        <CleanupReceipts />
      ) : !loaded ? null : entries.length === 0 ? (
        <EmptyState
          icon={icons.history}
          title={t('emptyStateTitle')}
          description={t('emptyStateDescription')}
        />
      ) : view === 'overview' ? (
        <Overview entries={entries} onOpen={setSelectedId} onShowAll={() => setView('list')} />
      ) : (
        <EntryList entries={entries} onOpen={setSelectedId} />
      )}

      {selected && <EntryDetail entry={selected} onClose={closeDetail} />}

      <ConfirmDialog
        open={confirmClear}
        onConfirm={() => {
          setConfirmClear(false)
          void clear()
        }}
        onCancel={() => setConfirmClear(false)}
        title={t('confirmClearScanTitle', { count: entries.length })}
        description={t('confirmClearScanDescription')}
        confirmLabel={t('confirmClearLabel', { count: entries.length })}
        variant="danger"
      />
    </div>
  )
}

// ============ Overview ============

function Overview({
  entries,
  onOpen,
  onShowAll
}: {
  entries: ScanHistoryEntry[]
  onOpen: (id: string) => void
  onShowAll: () => void
}) {
  const { t, i18n } = useTranslation('history')
  const locale = i18n.language
  const summary = useMemo(() => summarizeHistory(entries), [entries])
  const days = useMemo(() => spaceByDay(entries), [entries])
  const types = useMemo(() => breakdownByType(entries), [entries])
  const categories = useMemo(() => breakdownByCategory(entries), [entries])
  const chartable = isChartable(days.map((d) => d.space))
  const activeDays = days.filter((d) => d.space > 0).length

  const range =
    summary.firstAt && summary.lastAt
      ? formatDay(summary.firstAt, locale) === formatDay(summary.lastAt, locale)
        ? t('summary.sameDay', { date: formatDay(summary.lastAt, locale) })
        : t('summary.range', {
            from: formatDay(summary.firstAt, locale),
            to: formatDay(summary.lastAt, locale)
          })
      : null
  const facts = [
    t('summary.entries', { count: summary.count, formatted: formatCount(summary.count, locale) }),
    t('summary.items', {
      count: summary.itemsProcessed,
      formatted: formatCount(summary.itemsProcessed, locale)
    }),
    t('summary.averageDuration', { duration: formatDuration(summary.averageDurationMs, t) }),
    summary.errors
      ? t('summary.errors', {
          count: summary.errors,
          formatted: formatCount(summary.errors, locale)
        })
      : t('summary.noErrors'),
    range
  ].filter(Boolean)

  return (
    <div className="history-stack">
      <Card className="history-summary">
        <p className="history-summary-value">
          {summary.spaceSaved > 0
            ? t('summary.spaceFreed', { size: formatBytes(summary.spaceSaved) })
            : t('summary.noSpace')}
        </p>
        <p className="history-summary-facts">{facts.join(' · ')}</p>
      </Card>

      <Section title={t('overview.spaceOverTime')}>
        {chartable ? (
          <SpaceChart days={days} />
        ) : (
          <p className="history-sentence">
            {summary.spaceSaved > 0
              ? t('overview.spaceSentence', {
                  size: formatBytes(summary.spaceSaved),
                  count: activeDays
                })
              : t('overview.noSpaceSentence')}
          </p>
        )}
      </Section>

      <div className="history-columns">
        <Section title={t('overview.byType')}>
          <div className="history-table-scroll">
            <Table>
              <TableHead>
                <TableHeaderCell>{t('columns.type')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('columns.entries')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('columns.items')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('columns.space')}</TableHeaderCell>
              </TableHead>
              <tbody>
                {types.map((row) => (
                  <TableRow key={row.type}>
                    <TableCell>
                      <TypeLabel type={row.type} />
                    </TableCell>
                    <TableCell numeric>{formatCount(row.count, locale)}</TableCell>
                    <TableCell numeric>{formatCount(row.items, locale)}</TableCell>
                    <TableCell numeric>
                      {row.space > 0 ? formatBytes(row.space) : NO_VALUE}
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </div>
        </Section>

        {categories.length > 0 && (
          <Section title={t('overview.topCategories')}>
            <div className="history-table-scroll">
              <Table>
                <TableHead>
                  <TableHeaderCell>{t('columns.category')}</TableHeaderCell>
                  <TableHeaderCell numeric>{t('columns.items')}</TableHeaderCell>
                  <TableHeaderCell numeric>{t('columns.space')}</TableHeaderCell>
                </TableHead>
                <tbody>
                  {categories.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell>{historyCategoryLabel(row.key)}</TableCell>
                      <TableCell numeric>{formatCount(row.items, locale)}</TableCell>
                      <TableCell numeric>
                        {row.space > 0 ? formatBytes(row.space) : NO_VALUE}
                      </TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            </div>
          </Section>
        )}
      </div>

      <Section
        title={t('overview.recent')}
        actions={
          <Button variant="ghost" icon={icons.next} onClick={onShowAll}>
            {t('overview.showAll')}
          </Button>
        }
      >
        <ul className="history-recent">
          {entries.slice(0, 5).map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className="history-recent-item"
                onClick={() => onOpen(entry.id)}
              >
                <TypeIcon type={entry.type} />
                <Receipt
                  compact
                  title={t(typeLabelKeys[entry.type])}
                  value={entry.totalSpaceSaved > 0 ? formatBytes(entry.totalSpaceSaved) : undefined}
                  facts={[
                    formatDateTime(entry.timestamp, locale),
                    t('summary.items', {
                      count: entry.totalItemsCleaned,
                      formatted: formatCount(entry.totalItemsCleaned, locale)
                    }),
                    entry.errorCount
                      ? t('summary.errors', {
                          count: entry.errorCount,
                          formatted: formatCount(entry.errorCount, locale)
                        })
                      : ''
                  ]}
                />
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

function SpaceChart({ days }: { days: { day: string; space: number }[] }) {
  const { t, i18n } = useTranslation('history')
  const locale = i18n.language
  const data = days.map((d) => ({
    label: formatShortDay(keyToDate(d.day), locale),
    space: d.space
  }))
  return (
    <div
      className="history-chart"
      role="img"
      aria-label={t('overview.chartLabel', { count: days.length })}
    >
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border-default)" />
          <XAxis
            dataKey="label"
            tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => formatBytes(Number(v))}
            width={64}
          />
          <Tooltip content={ChartTooltip} cursor={{ fill: 'var(--bg-hover)' }} />
          <Bar
            dataKey="space"
            fill="var(--chart-1)"
            maxBarSize={28}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function ChartTooltip({
  active,
  payload,
  label
}: TooltipContentProps<TooltipValueType, string | number>) {
  const { t } = useTranslation('history')
  if (!active || !payload?.length) return null
  return (
    <div className="history-chart-tooltip">
      <span>{label}</span>
      <strong>{t('overview.tooltipSpace', { size: formatBytes(Number(payload[0].value)) })}</strong>
    </div>
  )
}

// ============ List ============

function EntryList({
  entries,
  onOpen
}: {
  entries: ScanHistoryEntry[]
  onOpen: (id: string) => void
}) {
  const { t, i18n } = useTranslation('history')
  const locale = i18n.language
  const [type, setType] = useState<'all' | HistoryEntryType>('all')
  const types = useMemo(() => typesPresent(entries), [entries])
  const filterId = useId()
  // A filter that no longer matches anything (history cleared elsewhere) falls back to all.
  const active = type !== 'all' && types.includes(type) ? type : 'all'
  const shown = active === 'all' ? entries : entries.filter((e) => e.type === active)

  return (
    <Section
      title={t('list.title')}
      meta={t('list.count', { count: shown.length, formatted: formatCount(shown.length, locale) })}
      actions={
        types.length > 1 && (
          <span className="history-filter">
            <label htmlFor={filterId}>{t('list.filterLabel')}</label>
            <select
              id={filterId}
              value={active}
              onChange={(e) => setType(e.target.value as 'all' | HistoryEntryType)}
            >
              <option value="all">{t('list.filterAll')}</option>
              {types.map((value) => (
                <option key={value} value={value}>
                  {t(typeLabelKeys[value])}
                </option>
              ))}
            </select>
          </span>
        )
      }
    >
      <div className="history-table-scroll">
        <Table>
          <TableHead>
            <TableHeaderCell>{t('columns.type')}</TableHeaderCell>
            <TableHeaderCell>{t('columns.date')}</TableHeaderCell>
            <TableHeaderCell numeric>{t('columns.items')}</TableHeaderCell>
            <TableHeaderCell numeric>{t('columns.space')}</TableHeaderCell>
            <TableHeaderCell numeric>{t('columns.duration')}</TableHeaderCell>
            <TableHeaderCell>{t('columns.outcome')}</TableHeaderCell>
          </TableHead>
          <tbody>
            {shown.map((entry) => (
              <TableRow key={entry.id} className="history-row" onClick={() => onOpen(entry.id)}>
                <TableCell>
                  <span className="history-type">
                    <TypeIcon type={entry.type} />
                    <button
                      type="button"
                      className="history-open"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpen(entry.id)
                      }}
                    >
                      {t(typeLabelKeys[entry.type])}
                    </button>
                    {entry.scheduled && <Tag tone="neutral">{t('list.scheduled')}</Tag>}
                  </span>
                </TableCell>
                <TableCell muted>{formatDateTime(entry.timestamp, locale)}</TableCell>
                <TableCell numeric>{formatCount(entry.totalItemsCleaned, locale)}</TableCell>
                <TableCell numeric>
                  {entry.totalSpaceSaved > 0 ? formatBytes(entry.totalSpaceSaved) : NO_VALUE}
                </TableCell>
                <TableCell numeric muted>
                  {formatDuration(entry.duration, t)}
                </TableCell>
                <TableCell>
                  <Outcome entry={entry} />
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </div>
    </Section>
  )
}

function Outcome({ entry }: { entry: ScanHistoryEntry }) {
  const { t, i18n } = useTranslation('history')
  return entry.errorCount > 0 ? (
    <Tag tone="danger">
      {t('summary.errors', {
        count: entry.errorCount,
        formatted: formatCount(entry.errorCount, i18n.language)
      })}
    </Tag>
  ) : (
    <Tag tone="neutral">{t('list.noErrors')}</Tag>
  )
}

function TypeIcon({ type }: { type: HistoryEntryType }) {
  const Icon = typeIcons[type]
  return <Icon className="history-type-icon" size={16} strokeWidth={1.75} aria-hidden="true" />
}

function TypeLabel({ type }: { type: HistoryEntryType }) {
  const { t } = useTranslation('history')
  return (
    <span className="history-type">
      <TypeIcon type={type} />
      {t(typeLabelKeys[type])}
    </span>
  )
}

// ============ Detail ============

function EntryDetail({ entry, onClose }: { entry: ScanHistoryEntry; onClose: () => void }) {
  const { t, i18n } = useTranslation('history')
  const locale = i18n.language
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Focus the close button, keep Tab inside the dialog, close on Escape, give focus back.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !dialogRef.current) return
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [])

  const count = (n: number) => formatCount(n, locale)
  const facts = [
    formatDateTime(entry.timestamp, locale),
    t('detail.found', { count: entry.totalItemsFound, formatted: count(entry.totalItemsFound) }),
    t('detail.processed', {
      count: entry.totalItemsCleaned,
      formatted: count(entry.totalItemsCleaned)
    }),
    formatDuration(entry.duration, t),
    entry.scheduled
      ? entry.scheduleName
        ? t('detail.scheduledBy', { name: entry.scheduleName })
        : t('detail.scheduled')
      : ''
  ]

  return (
    <div className="ui-dialog-layer">
      <div className="ui-dialog-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="ui-dialog history-detail"
      >
        <div className="history-detail-head">
          <h2 id={titleId} className="ui-dialog-title">
            {t(typeLabelKeys[entry.type])}
          </h2>
          <Button
            ref={closeRef}
            variant="ghost"
            icon={X}
            aria-label={t('detail.close')}
            onClick={onClose}
          />
        </div>

        <Receipt
          title={
            entry.errorCount > 0
              ? t('detail.outcomeErrors', {
                  count: entry.errorCount,
                  formatted: count(entry.errorCount)
                })
              : t('detail.outcomeDone')
          }
          value={
            entry.totalSpaceSaved > 0
              ? t('summary.spaceFreed', { size: formatBytes(entry.totalSpaceSaved) })
              : undefined
          }
          facts={facts}
          skipped={
            entry.totalItemsSkipped > 0
              ? t('detail.skipped', {
                  count: entry.totalItemsSkipped,
                  formatted: count(entry.totalItemsSkipped)
                })
              : undefined
          }
        />

        {entry.categories.length > 0 && (
          <div className="history-detail-block">
            <h3 className="history-detail-subtitle">{t('detail.categoriesLabel')}</h3>
            <div className="history-table-scroll history-detail-scroll">
              <Table>
                <TableHead>
                  <TableHeaderCell>{t('columns.category')}</TableHeaderCell>
                  <TableHeaderCell numeric>{t('columns.items')}</TableHeaderCell>
                  <TableHeaderCell numeric>{t('columns.space')}</TableHeaderCell>
                </TableHead>
                <tbody>
                  {entry.categories.map((cat) => (
                    <TableRow key={cat.name}>
                      <TableCell>{historyCategoryLabel(cat.name)}</TableCell>
                      <TableCell numeric>{count(cat.itemsCleaned)}</TableCell>
                      <TableCell numeric>
                        {cat.spaceSaved > 0 ? formatBytes(cat.spaceSaved) : NO_VALUE}
                      </TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>
        )}

        {entry.cleanedFrom && entry.cleanedTo && (
          <DeletedFilesSection from={entry.cleanedFrom} to={entry.cleanedTo} />
        )}
      </div>
    </div>
  )
}

// ============ Deleted files (deletion log) ============

const DELETED_FILES_PAGE = 200

/**
 * The individual paths a clean removed, read from the deletion log by the time
 * window the history entry recorded. Loaded lazily and paged: a single run can
 * hold six figures of paths, so nothing is fetched until the detail opens.
 */
function DeletedFilesSection({ from, to }: { from: string; to: string }) {
  const { t, i18n } = useTranslation('history')
  const locale = i18n.language
  const [records, setRecords] = useState<DeletedFileRecord[]>([])
  const [total, setTotal] = useState(0)
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    // Only local deletions belong to this scan entry.
    window.kudu
      .deletionLogQuery({ from, to, origin: 'local', offset: 0, limit: DELETED_FILES_PAGE })
      .then((page) => {
        if (cancelled) return
        setRecords(page.records)
        setTotal(page.total)
        setEnabled(page.enabled)
      })
      .catch(() => {
        if (!cancelled) {
          setRecords([])
          setTotal(0)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [from, to])

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const page = await window.kudu.deletionLogQuery({
        from,
        to,
        origin: 'local',
        offset: records.length,
        limit: DELETED_FILES_PAGE
      })
      setRecords((prev) => [...prev, ...page.records])
      setTotal(page.total)
    } catch {
      // Leave what we already have on screen
    }
    setLoadingMore(false)
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const savedTo = await window.kudu.deletionLogExport({ from, to, origin: 'local' })
      if (savedTo)
        toast.success(
          t('detail.deletedFiles.exported', { count: total, formatted: formatCount(total, locale) })
        )
    } catch {
      toast.error(t('detail.deletedFiles.exportFailed'))
    }
    setExporting(false)
  }

  return (
    <div className="history-detail-block">
      <div className="history-detail-block-head">
        <h3 className="history-detail-subtitle">{t('detail.deletedFiles.title')}</h3>
        {total > 0 && (
          <span className="history-detail-meta">
            {t('detail.deletedFiles.shownCount', {
              shown: formatCount(records.length, locale),
              total: formatCount(total, locale)
            })}
          </span>
        )}
        {total > 0 && (
          <span className="history-detail-actions">
            <Button icon={Download} busy={exporting} onClick={() => void handleExport()}>
              {t('detail.deletedFiles.exportCsv')}
            </Button>
            <Button icon={FolderOpen} onClick={() => void window.kudu.deletionLogReveal()}>
              {t('detail.deletedFiles.openLog')}
            </Button>
          </span>
        )}
      </div>

      {loading ? (
        <p className="history-sentence" role="status">
          {t('detail.deletedFiles.loading')}
        </p>
      ) : records.length === 0 ? (
        <p className="history-sentence">
          {enabled ? t('detail.deletedFiles.emptyRecorded') : t('detail.deletedFiles.disabledHint')}
        </p>
      ) : (
        <>
          <ul className="history-files">
            {records.map((r, i) => (
              <li key={`${r.ts}-${r.path}-${i}`} className="history-file">
                {/* dir=rtl moves the ellipsis to the start so the file name, the part that
                    answers "what did it delete?", stays visible. The <bdi> keeps the path
                    itself rendering left-to-right. */}
                <span className="history-file-path" title={r.path} dir="rtl">
                  <bdi>{r.path}</bdi>
                </span>
                {r.truncated ? (
                  <span
                    className="history-file-note"
                    title={t('detail.deletedFiles.truncatedHint', {
                      count: r.truncated,
                      formatted: formatCount(r.truncated, locale)
                    })}
                  >
                    {t('detail.deletedFiles.truncatedBadge', {
                      count: r.truncated,
                      formatted: formatCount(r.truncated, locale)
                    })}
                  </span>
                ) : r.category ? (
                  <span className="history-file-note">{historyCategoryLabel(r.category)}</span>
                ) : null}
                <span className="history-file-size">
                  {r.size > 0 ? formatBytes(r.size) : NO_VALUE}
                </span>
              </li>
            ))}
          </ul>
          {records.length < total && (
            <Button
              variant="ghost"
              className="history-load-more"
              busy={loadingMore}
              onClick={() => void loadMore()}
            >
              {t('detail.deletedFiles.loadMore')}
            </Button>
          )}
        </>
      )}
    </div>
  )
}
