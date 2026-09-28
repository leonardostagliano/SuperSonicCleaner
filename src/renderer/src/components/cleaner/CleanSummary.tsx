import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Receipt } from '@/components/shared/Receipt'
import {
  Button,
  Card,
  Section,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow
} from '@/components/ui'
import { ReportNotice } from './ReportNotice'
import { formatBytes, formatNumber, NO_VALUE } from '@/lib/utils'
import { formatDateTime, formatElapsed } from '@/lib/cleaner-report'
import type { CleanSummaryData } from '@/stores/scan-store'
import './pulizia.css'

interface CleanSummaryProps {
  summary: CleanSummaryData
  onRelaunchAsAdmin: () => void
  platform?: string
}

/** Errors listed under "Dettagli"; the rest are counted. */
const ERRORS_SHOWN = 20

/** The outcome of a cleanup: a receipt, then what each category freed and skipped. */
export function CleanSummary({ summary, onRelaunchAsAdmin, platform }: CleanSummaryProps) {
  const { t, i18n } = useTranslation('cleaner')
  const [showDetails, setShowDetails] = useState(false)
  const rows = summary.categories
    .filter((c) => c.cleaned > 0 || c.space > 0 || (c.skipped ?? 0) > 0)
    .sort((a, b) => b.space - a.space)
  const withIssues = summary.errors.length > 0 || summary.filesSkipped > 0
  const errorCount = summary.errors.length

  return (
    <>
      <Receipt
        title={withIssues ? t('receiptTitleSkipped') : t('receiptTitle')}
        value={t('receiptFreed', { size: formatBytes(summary.totalCleaned) })}
        facts={[
          t('receiptDeleted', {
            count: summary.filesDeleted,
            n: formatNumber(summary.filesDeleted)
          }),
          summary.completedAt ? formatDateTime(summary.completedAt, i18n.language) : '',
          t('receiptDuration', { duration: formatElapsed(summary.duration, i18n.language) }),
          t('receiptIrreversible')
        ]}
        skipped={
          summary.filesSkipped > 0
            ? t('receiptSkipped', {
                count: summary.filesSkipped,
                n: formatNumber(summary.filesSkipped)
              })
            : undefined
        }
        links={
          <>
            {errorCount > 0 && (
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
            <Link to="/history?view=receipts">{t('receiptHistory')}</Link>
          </>
        }
      />

      {summary.needsElevation && (
        <Card className="pulizia-notice-card">
          <ul className="pulizia-notices">
            <ReportNotice
              title={t('permissionError')}
              action={
                platform !== 'darwin' ? (
                  <Button onClick={onRelaunchAsAdmin}>{t('relaunchAsAdmin')}</Button>
                ) : undefined
              }
            />
          </ul>
        </Card>
      )}

      {showDetails && errorCount > 0 && (
        <Section title={t('errorsTitle', { count: errorCount, n: formatNumber(errorCount) })}>
          <ul className="pulizia-errors">
            {summary.errors.slice(0, ERRORS_SHOWN).map((err, i) => (
              <li key={i}>
                <span className="pulizia-path">{err.path.split(/[/\\]/).slice(-3).join('/')}</span>
                {': '}
                {err.reason === 'permission-denied' ? t('permissionDenied') : err.reason}
              </li>
            ))}
            {errorCount > ERRORS_SHOWN && (
              <li>{t('andMore', { count: errorCount - ERRORS_SHOWN })}</li>
            )}
          </ul>
        </Section>
      )}

      {rows.length > 0 && (
        <Card className="pulizia-table-card" aria-label={t('receiptByCategory')}>
          <Table className="pulizia-table">
            <TableHead>
              <TableHeaderCell>{t('columnCategory')}</TableHeaderCell>
              <TableHeaderCell numeric>{t('columnDeleted')}</TableHeaderCell>
              <TableHeaderCell numeric>{t('columnFreed')}</TableHeaderCell>
              <TableHeaderCell numeric>{t('columnSkipped')}</TableHeaderCell>
            </TableHead>
            <tbody>
              {rows.map((row) => (
                <TableRow key={row.type}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell numeric>{formatNumber(row.cleaned)}</TableCell>
                  <TableCell numeric>{formatBytes(row.space)}</TableCell>
                  <TableCell numeric>
                    {row.skipped === undefined ? NO_VALUE : formatNumber(row.skipped)}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  )
}
