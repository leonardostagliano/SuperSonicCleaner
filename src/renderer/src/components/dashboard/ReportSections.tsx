import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { ScanHistoryEntry } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Card'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/Table'
import { Tag } from '@/components/ui/Tag'
import { Receipt } from '@/components/shared/Receipt'
import { recommendedCount, type CheckId } from '@/lib/checks'
import { formatBytes } from '@/lib/utils'
import { useDrivesStore } from '@/stores/drives-store'
import { useHistoryStore } from '@/stores/history-store'
import { useSettingsStore } from '@/stores/settings-store'
import type { HomeCheck } from './home-checks'
import { driveName, formatCount, formatDateTime } from './when'

/** A load above this share of a drive is shown in red; below it the bar stays neutral. */
const DRIVE_FULL = 0.9

export function StorageSection() {
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()
  const drives = useDrivesStore((s) => s.drives)
  const status = useDrivesStore((s) => s.status)
  const ordered = [...drives].sort((a, b) => Number(b.isSystem) - Number(a.isSystem))
  return (
    <Section
      title={t('storage.title')}
      meta={status === 'loading' ? t('storage.readingMeta') : undefined}
      actions={
        <Button variant="ghost" onClick={() => navigate('/disk')}>
          {t('storage.analyze')}
        </Button>
      }
      className="home-storage"
    >
      {ordered.length > 0 ? (
        <ul className="home-drives">
          {ordered.map((drive) => {
            const name = driveName(drive)
            const used = drive.totalSize > 0 ? drive.usedSpace / drive.totalSize : 0
            return (
              <li key={drive.letter} className="home-drive">
                <div className="home-drive-top">
                  <span className="home-drive-name">{name}</span>
                  <span className="home-drive-free" data-audit="home-drive-free">
                    {t('storage.free', { size: formatBytes(drive.freeSpace) })}
                  </span>
                </div>
                <ProgressBar
                  value={used}
                  tone={used > DRIVE_FULL ? 'danger' : 'neutral'}
                  label={t('storage.usage', { drive: name })}
                />
                <div className="home-drive-figures">
                  <span>{t('storage.used', { size: formatBytes(drive.usedSpace) })}</span>
                  <span>{t('storage.total', { size: formatBytes(drive.totalSize) })}</span>
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="home-note">
          {t(status === 'unavailable' ? 'storage.unavailable' : 'storage.reading')}
        </p>
      )}
    </Section>
  )
}

const ACTION_KEYS: Record<CheckId, string> = {
  updates: 'checks.actions.review',
  startup: 'checks.actions.check',
  malware: 'checks.actions.scan',
  cleanup: 'checks.actions.analyze',
  registry: 'checks.actions.analyze',
  drivers: 'checks.actions.check',
  privacy: 'checks.actions.check'
}

export function ChecksSection({
  checks,
  onAnalyzeCleanup,
  disabled
}: {
  checks: HomeCheck[]
  /** The cleanup row starts the Cleaner analysis, like the header's primary action. */
  onAnalyzeCleanup: () => void
  disabled: boolean
}) {
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()
  const toRun = recommendedCount(checks.map((check) => check.state))
  return (
    <Section
      title={t('checks.title')}
      meta={toRun ? t('checks.toRun', { count: toRun }) : t('checks.noneToRun')}
      metaTone={toRun ? 'recommended' : 'neutral'}
      className="home-checks"
    >
      <div className="home-table-frame">
        <Table>
          <TableHead>
            <TableHeaderCell>{t('checks.columnCheck')}</TableHeaderCell>
            <TableHeaderCell>{t('checks.columnResult')}</TableHeaderCell>
            <TableHeaderCell>{t('checks.columnWhen')}</TableHeaderCell>
            <TableHeaderCell>
              <span className="sr-only">{t('checks.columnAction')}</span>
            </TableHeaderCell>
          </TableHead>
          <tbody>
            {checks.map((check) => {
              const name = t(`checks.names.${check.id}`)
              const action =
                check.id === 'updates' && check.state.reason !== 'pending'
                  ? t('checks.actions.open')
                  : t(ACTION_KEYS[check.id])
              return (
                <TableRow key={check.id} recommended={check.state.recommended}>
                  <TableCell className="home-check-name">
                    {name}
                    {/* The amber rule alone is colour only: the row also says it in words. */}
                    {check.state.recommended && (
                      <Tag tone="recommended">{t('simple.recommended')}</Tag>
                    )}
                  </TableCell>
                  <TableCell className="home-check-result">
                    {check.resultTone === 'neutral' ? (
                      check.result
                    ) : (
                      <Tag tone={check.resultTone}>{check.result}</Tag>
                    )}
                  </TableCell>
                  <TableCell muted className="home-check-when">
                    {check.when}
                  </TableCell>
                  <TableCell className="home-check-action">
                    <Button
                      variant={check.state.recommended ? 'secondary' : 'ghost'}
                      aria-label={`${action} · ${name}`}
                      disabled={disabled && check.id === 'cleanup'}
                      onClick={() =>
                        check.id === 'cleanup' ? onAnalyzeCleanup() : navigate(check.path)
                      }
                    >
                      {action}
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </tbody>
        </Table>
      </div>
    </Section>
  )
}

const TYPE_KEYS: Record<ScanHistoryEntry['type'], string> = {
  cleaner: 'cleaner',
  registry: 'registry',
  debloater: 'debloater',
  network: 'network',
  drivers: 'drivers',
  malware: 'malware',
  privacy: 'privacy',
  startup: 'startup',
  services: 'services',
  'software-update': 'softwareUpdate',
  'cve-scan': 'cveScan'
}

export function ActivitySection() {
  const { t, i18n } = useTranslation('dashboard')
  const navigate = useNavigate()
  const entries = useHistoryStore((s) => s.entries)
  const hasSchedule = useSettingsStore(
    (s) => (s.settings.schedules ?? []).length > 0 || Boolean(s.settings.schedule?.enabled)
  )
  const locale = i18n.language || 'en'
  const recent = [...entries]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 3)
  // After the first manual clean, scheduling is offered here instead of in the sidebar.
  const offerSchedule = !hasSchedule && entries.some((e) => e.type === 'cleaner' && !e.scheduled)
  return (
    <Section
      title={t('activity.title')}
      actions={
        <Button variant="ghost" onClick={() => navigate('/history')}>
          {t('activity.all')}
        </Button>
      }
      className="home-activity"
    >
      {recent.length > 0 ? (
        <ul className="home-activity-list">
          {recent.map((entry) => {
            const count = formatCount(entry.totalItemsCleaned, locale)
            const value =
              entry.totalSpaceSaved > 0
                ? t('activity.valueSpace', {
                    size: formatBytes(entry.totalSpaceSaved),
                    count: entry.totalItemsCleaned,
                    n: count
                  })
                : t('activity.valueItems', { count: entry.totalItemsCleaned, n: count })
            return (
              <li key={entry.id} className="home-activity-row">
                <Receipt
                  compact
                  title={t(`activity.types.${TYPE_KEYS[entry.type] ?? 'cleaner'}`)}
                  facts={[
                    formatDateTime(new Date(entry.timestamp).getTime(), locale),
                    entry.scheduled ? t('activity.scheduled') : '',
                    entry.type === 'cleaner' ? t('activity.irreversible') : ''
                  ]}
                  value={value}
                />
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="home-note">
          <p className="home-note-title">{t('activity.empty')}</p>
          <p>{t('activity.emptyDetail')}</p>
        </div>
      )}
      {offerSchedule && (
        <div className="home-schedule">
          <span>{t('activity.noSchedule')}</span>
          <Button variant="ghost" onClick={() => navigate('/schedules')}>
            {t('activity.schedule')}
          </Button>
        </div>
      )}
    </Section>
  )
}
