import { useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { formatBytes } from '@/lib/utils'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Card'
import { Tag } from '@/components/ui/Tag'
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/Table'
import { usePerfStore } from '@/stores/perf-store'
import type { PerfProcess } from '@shared/types'
import { formatPercent } from './perf-summary'

type SortColumn = 'name' | 'pid' | 'cpuPercent' | 'memBytes'

export function ProcessTable() {
  const { t, i18n } = useTranslation('performance')
  const locale = i18n.language
  const processList = usePerfStore((s) => s.processList)
  const processCount = usePerfStore((s) => s.processCount)
  const filter = usePerfStore((s) => s.processFilter)
  const setFilter = usePerfStore((s) => s.setProcessFilter)
  const sortColumn = usePerfStore((s) => s.processSortColumn)
  const sortDir = usePerfStore((s) => s.processSortDir)
  const setSort = usePerfStore((s) => s.setProcessSort)

  const [killTarget, setKillTarget] = useState<PerfProcess | null>(null)
  const [killing, setKilling] = useState(false)

  const filtered = useMemo(() => {
    let list = processList
    if (filter) {
      const q = filter.toLowerCase()
      list = list.filter((p) => p.name.toLowerCase().includes(q))
    }

    list = [...list].sort((a, b) => {
      const aVal = a[sortColumn]
      const bVal = b[sortColumn]
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }
      return sortDir === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number)
    })

    return list
  }, [processList, filter, sortColumn, sortDir])

  const handleKill = useCallback(async () => {
    if (!killTarget) return
    setKilling(true)
    try {
      const result = await window.kudu.perfKillProcess(killTarget.pid)
      if (result.success) {
        toast.success(t('endProcessSuccessToast', { name: killTarget.name, pid: killTarget.pid }))
      } else {
        toast.error(result.error || t('endProcessFailedToast'))
      }
    } catch {
      toast.error(t('endProcessFailedToast'))
    } finally {
      setKilling(false)
      setKillTarget(null)
    }
  }, [killTarget, t])

  const columns: { column: SortColumn; label: string; numeric?: boolean }[] = [
    { column: 'name', label: t('columnName') },
    { column: 'pid', label: t('columnPid'), numeric: true },
    { column: 'cpuPercent', label: t('columnCpu'), numeric: true },
    { column: 'memBytes', label: t('columnMemory'), numeric: true }
  ]
  const SortIcon = sortDir === 'asc' ? ArrowUp : ArrowDown

  return (
    <Section
      title={t('processes')}
      meta={
        processList.length > 0
          ? t('processesMeta', { shown: processList.length, total: processCount })
          : undefined
      }
      actions={
        <div className="perf-search">
          <Search size={14} strokeWidth={1.75} aria-hidden="true" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('filterProcessesPlaceholder')}
            aria-label={t('filterProcessesPlaceholder')}
          />
          {filter && (
            <button
              type="button"
              className="perf-search-clear"
              aria-label={t('clearFilter')}
              onClick={() => setFilter('')}
            >
              <X size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
        </div>
      }
    >
      <div className="perf-process-scroll">
        <Table className="perf-process-table">
          <colgroup>
            <col />
            <col className="perf-col-pid" />
            <col className="perf-col-cpu" />
            <col className="perf-col-memory" />
            <col className="perf-col-action" />
          </colgroup>
          <TableHead>
            {columns.map(({ column, label, numeric }) => {
              const active = sortColumn === column
              return (
                <TableHeaderCell
                  key={column}
                  numeric={numeric}
                  aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    className="perf-sort"
                    data-active={active || undefined}
                    onClick={() => setSort(column)}
                  >
                    {label}
                    {active && <SortIcon size={12} strokeWidth={1.75} aria-hidden="true" />}
                  </button>
                </TableHeaderCell>
              )
            })}
            <TableHeaderCell>
              <span className="sr-only">{t('columnAction')}</span>
            </TableHeaderCell>
          </TableHead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <TableCell colSpan={5} muted>
                  {filter ? t('processesNoMatch', { filter }) : t('waitingForSample')}
                </TableCell>
              </tr>
            ) : (
              filtered.map((p) => (
                <TableRow key={p.pid}>
                  <TableCell>
                    <span className="perf-process-name">
                      <span className="perf-truncate" title={p.name}>
                        {p.name}
                      </span>
                      {p.isStartupItem && (
                        <span title={t('startupItemTooltip', { name: p.startupItemName })}>
                          <Tag tone="neutral">{t('startupBadge')}</Tag>
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell numeric muted>
                    {p.pid}
                  </TableCell>
                  <TableCell numeric>{formatPercent(p.cpuPercent, locale, 1)}</TableCell>
                  <TableCell numeric>{formatBytes(p.memBytes)}</TableCell>
                  <TableCell numeric>
                    <Button
                      variant="ghost"
                      className="perf-end"
                      aria-label={t('endButtonLabel', { name: p.name })}
                      onClick={() => setKillTarget(p)}
                    >
                      {t('endButton')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </tbody>
        </Table>
      </div>

      <ConfirmDialog
        open={!!killTarget}
        onConfirm={handleKill}
        onCancel={() => setKillTarget(null)}
        title={t('endProcessTitle', { name: killTarget?.name })}
        description={t('endProcessDescription', { name: killTarget?.name, pid: killTarget?.pid })}
        confirmLabel={
          killing ? t('endProcessEnding') : t('endProcessConfirm', { name: killTarget?.name })
        }
        variant="danger"
      />
    </Section>
  )
}
