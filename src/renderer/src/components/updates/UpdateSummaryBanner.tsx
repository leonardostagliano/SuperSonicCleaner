import { Fragment, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, X, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Tag } from '@/components/ui/Tag'
import { icons } from '@/lib/icons'
import type { UpdateSummary } from '@/lib/update-summary'
import '@/components/software/software.css'

/**
 * What the last update run did, app by app: which were updated (and to which
 * version), which are still installing in the background, and which failed
 * and why. It stays until the user dismisses it.
 */
export function UpdateSummaryBanner({
  summary,
  packageManagerName,
  onDismiss
}: {
  summary: UpdateSummary
  packageManagerName: string | null
  onDismiss: () => void
}) {
  const { t } = useTranslation('updates')
  const titleId = useId()
  const { updated, pending, failed } = summary
  if (updated.length + pending.length + failed.length === 0) return null
  const Updated = icons.allUpToDate

  // Green only for what the package manager confirmed, red only for failures.
  const counts = [
    updated.length > 0 && (
      <Tag key="updated" tone="ok">
        {updated.length !== 1
          ? t('softwareUpdater.updateResultAppsUpdatedPlural', { count: updated.length })
          : t('softwareUpdater.updateResultAppsUpdated', { count: updated.length })}
      </Tag>
    ),
    pending.length > 0 && (
      <Tag key="pending" tone="neutral">
        {t('softwareUpdater.updateResultPending', { count: pending.length })}
      </Tag>
    ),
    failed.length > 0 && (
      <Tag key="failed" tone="danger">
        {t('softwareUpdater.updateResultFailed', { count: failed.length })}
      </Tag>
    )
  ].filter(Boolean)

  return (
    <Card as="section" role="status" aria-labelledby={titleId} className="sw-result">
      <div className="sw-result-head">
        <div className="sw-result-text">
          <h2 id={titleId} className="sw-result-title">
            {t('softwareUpdater.resultTitle')}
          </h2>
          <p className="sw-result-facts">
            {counts.map((node, i) => (
              <Fragment key={i}>
                {i > 0 && <span aria-hidden="true"> · </span>}
                {node}
              </Fragment>
            ))}
          </p>
        </div>
        <Button
          variant="ghost"
          icon={X}
          onClick={onDismiss}
          aria-label={t('softwareUpdater.dismiss')}
          title={t('softwareUpdater.dismiss')}
        />
      </div>
      <ul className="sw-result-list">
        {updated.map((e) => (
          <li key={e.key} className="sw-result-item">
            <Updated
              className="sw-result-item-icon sw-ok-text"
              size={16}
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <span className="sw-result-name" title={e.name}>
              {e.name}
            </span>
            {e.fromVersion && e.toVersion && (
              <span className="sw-result-versions sw-mono">
                {e.fromVersion} → {e.toVersion}
              </span>
            )}
          </li>
        ))}
        {pending.map((e) => (
          <li key={e.key} className="sw-result-item">
            <Clock
              className="sw-result-item-icon"
              size={16}
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <span>{t('softwareUpdater.resultPending', { app: e.name })}</span>
          </li>
        ))}
        {failed.map((e) => {
          const isInstallerChange = e.reason?.toLowerCase().includes('installer type changed')
          return (
            <li key={e.key} className="sw-result-item">
              <XCircle
                className="sw-result-item-icon sw-danger-text"
                size={16}
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <div className="sw-result-text">
                <span className="sw-result-name">{e.name}</span>
                {e.reason && <span>: {e.reason}</span>}
                {isInstallerChange && packageManagerName && (
                  <div className="sw-command">
                    {packageManagerName} uninstall {e.appId}
                    <br />
                    {packageManagerName} install {e.appId}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
