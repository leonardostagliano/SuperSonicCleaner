import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { Receipt } from '@/components/shared/Receipt'
import {
  Button,
  Card,
  ListRow,
  ProgressBar,
  Section,
  Switch,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tag
} from '@/components/ui'
import {
  categoryCounts,
  categoryDescriptionKey,
  categoryLabelKey,
  irreversibleCount,
  presentCategories,
  settingsToApply,
  switchDisabled,
  type PrivacyCategoryId
} from '@/components/privacy/privacy-view'
import { icons } from '@/lib/icons'
import { formatCount, formatDateTime } from '@/lib/protection-format'
import { usePlatform } from '@/hooks/usePlatform'
import { usePrivacyStore } from '@/stores/privacy-store'
import { useHistoryStore } from '@/stores/history-store'
import { recordCheckRun } from '@/stores/check-runs-store'
import type { PrivacySetting } from '@shared/types'

const store = usePrivacyStore.getState

export function PrivacyShieldPage({ embedded }: { embedded?: boolean }) {
  const { t, i18n } = useTranslation('hardening')
  const lang = i18n.language
  const { platform } = usePlatform()
  // On macOS/Linux elevation happens per-action via a password prompt, so
  // "run as administrator" advice is meaningless there.
  const isWindows = platform === 'win32'
  const state = usePrivacyStore((s) => s.state)
  const status = usePrivacyStore((s) => s.status)
  const applyResult = usePrivacyStore((s) => s.applyResult)
  const expandedCategories = usePrivacyStore((s) => s.expandedCategories)
  const progress = usePrivacyStore((s) => s.progress)
  const progressCleanupRef = useRef<(() => void) | null>(null)
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null)
  const [appliedAt, setAppliedAt] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      progressCleanupRef.current?.()
    }
  }, [])

  const handleScan = useCallback(async () => {
    store().setStatus('scanning')
    store().setApplyResult(null)
    store().setProgress(null)
    setAppliedAt(null)

    // Listen for progress
    progressCleanupRef.current?.()
    progressCleanupRef.current =
      window.kudu.onPrivacyProgress?.((data) => {
        store().setProgress(data)
      }) ?? null

    try {
      const result = await window.kudu.privacyScan()
      store().setState(result)
      // Open the categories that still have settings to change
      store().setExpandedCategories(
        new Set(result.settings.filter((s) => !s.enabled).map((s) => s.category))
      )
      store().setStatus('done')
      recordCheckRun('privacy')
    } catch (err) {
      console.error('Privacy scan failed:', err)
      toast.error(t('privacy.scanFailed'))
      store().setStatus('idle')
    } finally {
      progressCleanupRef.current?.()
      progressCleanupRef.current = null
      store().setProgress(null)
    }
  }, [t])

  // Auto-scan on first visit (the scan only reads the settings)
  useEffect(() => {
    if (store().status === 'idle' && !store().state) void handleScan()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleApply = useCallback(
    async (ids: string[]) => {
      setConfirmIds(null)
      const before = store().state
      if (!before || ids.length === 0) return

      const startTime = Date.now()
      store().setStatus('applying')
      store().setApplyResult(null)
      try {
        const result = await window.kudu.privacyApply(ids)
        store().setApplyResult(result)
        setAppliedAt(new Date().toISOString())
        // Re-scan to read the settings as the system now reports them
        store().setState(await window.kudu.privacyScan())
        store().setStatus('done')

        // Log to history, per category
        const failedIds = new Set(result.errors.map((e) => e.id))
        const byCategory: Record<string, { found: number; applied: number }> = {}
        for (const id of ids) {
          const setting = before.settings.find((s) => s.id === id)
          if (!setting) continue
          byCategory[setting.category] ??= { found: 0, applied: 0 }
          byCategory[setting.category].found++
          if (!failedIds.has(id)) byCategory[setting.category].applied++
        }
        await useHistoryStore.getState().addEntry({
          id: Date.now().toString(),
          type: 'privacy',
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime,
          totalItemsFound: ids.length,
          totalItemsCleaned: result.succeeded,
          totalItemsSkipped: 0,
          totalSpaceSaved: 0,
          categories: Object.entries(byCategory).map(([name, d]) => ({
            name,
            itemsFound: d.found,
            itemsCleaned: d.applied,
            spaceSaved: 0
          })),
          errorCount: result.failed
        })
      } catch (err) {
        console.error('Privacy apply failed:', err)
        toast.error(t('privacy.applyFailed'), { description: t('privacy.applyFailedDescription') })
        store().setApplyResult({
          succeeded: 0,
          failed: ids.length,
          errors: [
            { id: '', label: t('privacy.allSettingsLabel'), reason: t('privacy.ipcCallFailed') }
          ]
        })
        setAppliedAt(new Date().toISOString())
        store().setStatus('done')
      }
    },
    [t]
  )

  const handleToggle = useCallback(
    async (settingId: string) => {
      const setting = store().state?.settings.find((s) => s.id === settingId)
      if (!setting) return

      const wasEnabled = setting.enabled
      const isEnabling = !wasEnabled
      store().setStatus('applying')
      try {
        const result = isEnabling
          ? await window.kudu.privacyApply([settingId])
          : await window.kudu.privacyRevert([settingId])
        const updated = await window.kudu.privacyScan()
        store().setState(updated)
        store().setStatus('done')

        const newSetting = updated.settings.find((s) => s.id === settingId)
        const actuallyChanged = newSetting != null && newSetting.enabled !== wasEnabled
        const failedTitle = t(
          isEnabling ? 'privacy.settingApplyFailed' : 'privacy.settingRevertFailed',
          { label: setting.label }
        )
        if (result.failed > 0) {
          toast.error(failedTitle, {
            description: result.errors[0]?.reason || t('privacy.unknownError')
          })
        } else if (!actuallyChanged) {
          // Reported success, but the system state did not change (e.g. needs admin)
          toast.error(failedTitle, {
            description: t(isWindows ? 'privacy.adminRequired' : 'privacy.settingNotApplied')
          })
        } else {
          toast.success(
            t(newSetting.enabled ? 'privacy.settingEnabled' : 'privacy.settingDisabled', {
              label: setting.label
            })
          )
        }
      } catch {
        toast.error(
          t(isEnabling ? 'privacy.settingApplyFailedGeneric' : 'privacy.settingRevertFailedGeneric')
        )
        store().setStatus('done')
      }
    },
    [t, isWindows]
  )

  const isScanning = status === 'scanning'
  const isApplying = status === 'applying'
  const busy = isScanning || isApplying
  const settings = state?.settings ?? []
  const pending = settingsToApply(settings)
  const categories = presentCategories(settings)
  const confirmSettings = confirmIds
    ? settings.filter((s) => confirmIds.includes(s.id))
    : ([] as PrivacySetting[])
  const confirmIrreversible = irreversibleCount(confirmSettings)
  const WarningIcon = icons.warning
  const progressCategory = progress?.category as PrivacyCategoryId | undefined

  const scanButton = (
    <Button
      variant={state && pending.length > 0 ? 'ghost' : 'primary'}
      size="lg"
      busy={isScanning}
      disabled={isApplying}
      onClick={() => void handleScan()}
    >
      {isScanning
        ? t('privacy.scanningButton')
        : state
          ? t('privacy.rescanButton')
          : t('privacy.scanButton')}
    </Button>
  )

  return (
    <div>
      {!embedded && (
        <PageHeader
          title={t('privacy.pageTitle')}
          description={t('privacy.pageDescription')}
          action={scanButton}
        />
      )}
      {embedded && <div className="mb-5 flex justify-end">{scanButton}</div>}

      <div className="flex flex-col gap-3">
        {isScanning && (
          <Section
            title={t('privacy.scanProgressTitle')}
            meta={
              progress
                ? t('privacy.scanProgressCount', {
                    current: formatCount(progress.current, lang),
                    total: formatCount(progress.total, lang)
                  })
                : undefined
            }
          >
            <p className="mb-2 text-[length:var(--text-13)] text-[var(--text-secondary)]">
              {progressCategory
                ? t('privacy.scanProgressCategory', {
                    category: t(categoryLabelKey(progressCategory))
                  })
                : t('privacy.scanProgressPreparing')}
            </p>
            <ProgressBar
              value={progress ? progress.current / Math.max(progress.total, 1) : undefined}
              label={t('privacy.scanProgressLabel')}
            />
            {progress?.currentLabel && (
              <p className="mt-2 truncate text-[length:var(--text-12)] text-[var(--text-muted)]">
                {progress.currentLabel}
              </p>
            )}
          </Section>
        )}

        {isApplying && (
          <Card>
            <p className="mb-2 text-[length:var(--text-13)] text-[var(--text-secondary)]">
              {t('privacy.applyingProtections')}
            </p>
            <ProgressBar indeterminate label={t('privacy.applyingLabel')} />
          </Card>
        )}

        {applyResult && status === 'done' && (
          <>
            <Receipt
              title={t('privacy.receiptTitle')}
              value={t('privacy.receiptApplied', { count: applyResult.succeeded })}
              facts={[
                appliedAt ? formatDateTime(appliedAt, lang) : '',
                t('privacy.receiptReversible')
              ]}
              skipped={
                applyResult.failed > 0
                  ? t(isWindows ? 'privacy.receiptFailedAdmin' : 'privacy.receiptFailed', {
                      count: applyResult.failed
                    })
                  : undefined
              }
            />
            {applyResult.errors.length > 0 && (
              <Section title={t('privacy.failedHeading')}>
                <Table>
                  <TableHead>
                    <TableHeaderCell>{t('privacy.failedColumnSetting')}</TableHeaderCell>
                    <TableHeaderCell>{t('privacy.failedColumnReason')}</TableHeaderCell>
                  </TableHead>
                  <tbody>
                    {applyResult.errors.map((err, index) => (
                      <TableRow key={`${err.id}-${index}`}>
                        <TableCell>{err.label}</TableCell>
                        <TableCell muted>{err.reason}</TableCell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              </Section>
            )}
          </>
        )}

        {!state && !isScanning && (
          <EmptyState
            title={t('privacy.emptyStateTitle')}
            description={t('privacy.emptyStateDescription')}
            checks={(platform === 'linux'
              ? (['kernel', 'network', 'access'] as const)
              : (['telemetry', 'ads', 'search'] as const)
            ).map((id) => ({
              title: t(categoryLabelKey(id)),
              detail: t(categoryDescriptionKey(id))
            }))}
          />
        )}

        {state && !isScanning && (
          <Card as="section" className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <div className="min-w-0 flex-[1_1_320px]">
              <h2
                className={
                  pending.length > 0
                    ? 'm-0 font-[family-name:var(--font-display)] text-[length:var(--text-20)] leading-[1.25] font-semibold tracking-[-0.01em] tabular-nums'
                    : 'm-0 font-[family-name:var(--font-display)] text-[length:var(--text-15)] leading-[1.3] font-semibold text-[var(--signal-ok-text)]'
                }
              >
                {pending.length > 0
                  ? t('privacy.summaryTitle', { count: pending.length })
                  : t('privacy.summaryNone', { total: formatCount(state.total, lang) })}
              </h2>
              <p className="mt-1 text-[length:var(--text-13)] text-[var(--text-secondary)] tabular-nums">
                {t('privacy.summaryFacts', {
                  protected: formatCount(state.protected, lang),
                  total: formatCount(state.total, lang),
                  categories: formatCount(categories.length, lang)
                })}
              </p>
            </div>
            {pending.length > 0 && (
              <Button
                variant="primary"
                size="lg"
                disabled={busy}
                onClick={() => setConfirmIds(pending.map((s) => s.id))}
              >
                {t('privacy.applyRecommended', { count: pending.length })}
              </Button>
            )}
          </Card>
        )}

        {isWindows && state && !isScanning && pending.some((s) => s.requiresAdmin) && (
          <Card className="flex items-start gap-3">
            <WarningIcon
              size={16}
              strokeWidth={1.75}
              className="mt-0.5 shrink-0 text-[var(--text-secondary)]"
              aria-hidden="true"
            />
            <p className="m-0 text-[length:var(--text-13)] text-[var(--text-secondary)]">
              {t('privacy.adminWarning')}
            </p>
          </Card>
        )}

        {state &&
          !isScanning &&
          categories.map((category) => {
            const counts = categoryCounts(settings, category)
            const expanded = expandedCategories.has(category)
            const categorySettings = settings.filter((s) => s.category === category)
            const label = t(categoryLabelKey(category))
            return (
              <Section
                key={category}
                title={label}
                meta={
                  counts.pending > 0
                    ? t('privacy.categoryMeta', { count: counts.pending })
                    : t('privacy.categoryAllSet')
                }
                metaTone={counts.pending > 0 ? 'recommended' : 'neutral'}
                actions={
                  <>
                    {counts.pending > 0 && (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          setConfirmIds(settingsToApply(settings, category).map((s) => s.id))
                        }
                      >
                        {t('privacy.categoryApply', { count: counts.pending })}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      aria-expanded={expanded}
                      aria-label={`${expanded ? t('privacy.categoryHide') : t('privacy.categoryShow')}: ${label}`}
                      onClick={() => store().toggleCategory(category)}
                    >
                      {expanded ? t('privacy.categoryHide') : t('privacy.categoryShow')}
                    </Button>
                  </>
                }
              >
                <p className="m-0 text-[length:var(--text-13)] text-[var(--text-secondary)]">
                  {t(categoryDescriptionKey(category))}
                </p>
                {expanded && (
                  <div className="mt-3 border-t border-[var(--border-default)]">
                    {categorySettings.map((setting) => (
                      <SettingRow
                        key={setting.id}
                        setting={setting}
                        settings={settings}
                        busy={busy}
                        onToggle={handleToggle}
                      />
                    ))}
                  </div>
                )}
              </Section>
            )
          })}
      </div>

      <ConfirmDialog
        open={confirmIds !== null}
        onConfirm={() => confirmIds && void handleApply(confirmIds)}
        onCancel={() => setConfirmIds(null)}
        title={t('privacy.confirmTitle', { count: confirmSettings.length })}
        description={
          confirmIrreversible > 0
            ? t('privacy.confirmDescriptionIrreversible', { count: confirmIrreversible })
            : t('privacy.confirmDescription')
        }
        details={confirmSettings.map((s) => s.label).join('\n')}
        confirmLabel={t('privacy.confirmLabel', { count: confirmSettings.length })}
        variant={confirmIrreversible > 0 ? 'danger' : 'default'}
      />
    </div>
  )
}

function SettingRow({
  setting,
  settings,
  busy,
  onToggle
}: {
  setting: PrivacySetting
  settings: PrivacySetting[]
  busy: boolean
  onToggle: (id: string) => Promise<void>
}) {
  const { t } = useTranslation('hardening')
  const dependency = setting.dependsOn
    ? settings.find((s) => s.id === setting.dependsOn)
    : undefined
  return (
    <ListRow recommended={!setting.enabled} className="items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[length:var(--text-13)] font-medium">{setting.label}</span>
          {setting.requiresAdmin && <Tag tone="neutral">{t('privacy.adminTag')}</Tag>}
          {!setting.reversible && <Tag tone="neutral">{t('privacy.notReversibleTag')}</Tag>}
        </div>
        <p className="m-0 text-[length:var(--text-12)] text-[var(--text-muted)]">
          {setting.description}
        </p>
        {dependency && !dependency.enabled && (
          <p className="m-0 text-[length:var(--text-12)] text-[var(--text-secondary)]">
            {t('privacy.requiresSettingEnabled', { label: dependency.label })}
          </p>
        )}
      </div>
      <Switch
        checked={setting.enabled}
        disabled={switchDisabled(setting, settings, busy)}
        label={setting.label}
        onChange={() => void onToggle(setting.id)}
      />
    </ListRow>
  )
}
