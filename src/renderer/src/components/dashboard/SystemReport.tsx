import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Receipt } from '@/components/shared/Receipt'
import { usePlatform } from '@/hooks/usePlatform'
import { formatBytes } from '@/lib/utils'
import { icons } from '@/lib/icons'
import { useDrivesStore } from '@/stores/drives-store'
import { useHistoryStore } from '@/stores/history-store'
import { useScanStore } from '@/stores/scan-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useStartupStore } from '@/stores/startup-store'
import { ResourcesSection } from './LiveMetricCards'
import { ActivitySection, ChecksSection, StorageSection } from './ReportSections'
import { useHomeChecks } from './home-checks'
import {
  quickCleaners,
  runQuickClean,
  useAnalyzeAndClean,
  type QuickCleanProgress,
  type QuickCleanResult
} from './quick-clean'
import { formatCount } from './when'

/** The advanced Home: a report of resources, storage, checks and recent activity (spec 5.2). */
export function SystemReport({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const { t, i18n } = useTranslation('dashboard')
  const { features } = usePlatform()
  const refreshDrives = useDrivesStore((s) => s.refresh)
  const addHistoryEntry = useHistoryStore((s) => s.addEntry)
  const protectRecycleBin = useSettingsStore((s) => s.settings.cleaner.protectRecycleBin)
  const startupHasLoaded = useStartupStore((s) => s.hasLoaded)
  const startupLoading = useStartupStore((s) => s.loading)
  const { checks } = useHomeChecks()
  const analyze = useAnalyzeAndClean()
  const startupLoadAttempted = useRef(false)
  const [confirming, setConfirming] = useState(false)
  const [progress, setProgress] = useState<QuickCleanProgress | null>(null)
  const [result, setResult] = useState<QuickCleanResult | null>(null)
  const running = progress !== null
  const locale = i18n.language || 'en'

  useEffect(() => {
    onBusyChange(running)
    return () => onBusyChange(false)
  }, [running, onBusyChange])

  useEffect(() => {
    void refreshDrives()
  }, [refreshDrives])

  // The startup row states what is enabled now, so Home reads the list (read-only)
  // instead of treating an empty store as "no startup apps".
  useEffect(() => {
    if (startupHasLoaded || startupLoading || startupLoadAttempted.current) return
    startupLoadAttempted.current = true
    const store = useStartupStore.getState()
    store.setLoading(true)
    window.kudu
      .startupList()
      .then((items) => store.setItems(items))
      .catch(() => store.setError(t('checks.results.startupUnavailable')))
      .finally(() => store.setLoading(false))
  }, [startupHasLoaded, startupLoading, t])

  const cleanWithoutPreview = async () => {
    if (running) return
    const started = Date.now()
    setResult(null)
    setProgress({ key: 'quick.progressStarting', done: 0, total: 1 })
    let outcome: QuickCleanResult = { space: 0, files: 0, registryFixed: 0, failed: [] }
    try {
      outcome = await runQuickClean({
        t,
        excluded: useScanStore.getState().excludedSubcategories,
        protectRecycleBin,
        registry: features.registry,
        onProgress: setProgress
      })
      const total = outcome.files + outcome.registryFixed
      if (total > 0) {
        await addHistoryEntry({
          id: Date.now().toString(),
          type: 'cleaner',
          timestamp: new Date().toISOString(),
          duration: Date.now() - started,
          totalItemsFound: total,
          totalItemsCleaned: total,
          totalItemsSkipped: 0,
          totalSpaceSaved: outcome.space,
          categories: [
            ...(outcome.files > 0
              ? [
                  {
                    name: 'Quick Clean',
                    itemsFound: outcome.files,
                    itemsCleaned: outcome.files,
                    spaceSaved: outcome.space
                  }
                ]
              : []),
            ...(outcome.registryFixed > 0
              ? [
                  {
                    name: 'Registry',
                    itemsFound: outcome.registryFixed,
                    itemsCleaned: outcome.registryFixed,
                    spaceSaved: 0
                  }
                ]
              : [])
          ],
          errorCount: outcome.failed.length
        })
      }
    } finally {
      setResult(outcome)
      setProgress(null)
      void refreshDrives({ fresh: true })
    }
  }

  const categories = quickCleaners(protectRecycleBin)
    .map((cleaner) => t(`categories.${cleaner.type}`))
    .join(', ')

  return (
    <div className="home-report">
      <PageHeader
        title={t('report.title')}
        description={t('report.provenance')}
        action={
          <>
            <Button disabled={running} onClick={() => setConfirming(true)}>
              {t('report.cleanWithoutPreview')}
            </Button>
            <Button variant="primary" icon={icons.clean} disabled={running} onClick={analyze}>
              {t('report.analyze')}
            </Button>
          </>
        }
      />
      <div aria-live="polite" className="home-outcome">
        {progress && (
          <Card className="home-operation" role="status">
            <div className="home-operation-text">
              <span>{t(progress.key, progress.params)}</span>
              <span className="home-operation-count">
                {t('quick.progressCount', {
                  done: formatCount(progress.done, locale),
                  total: formatCount(progress.total, locale)
                })}
              </span>
            </div>
            <ProgressBar value={progress.done / progress.total} label={t('quick.progressLabel')} />
          </Card>
        )}
        {!progress && result && (
          <Receipt
            title={t(result.failed.length ? 'quick.doneWithErrors' : 'quick.done')}
            value={
              result.space > 0 ? t('quick.freed', { size: formatBytes(result.space) }) : undefined
            }
            facts={[
              result.files > 0
                ? t('quick.files', { count: result.files, n: formatCount(result.files, locale) })
                : t('quick.noFiles'),
              result.registryFixed > 0
                ? t('quick.registryFixed', {
                    count: result.registryFixed,
                    n: formatCount(result.registryFixed, locale)
                  })
                : '',
              result.files > 0 ? t('quick.irreversible') : ''
            ]}
            skipped={
              result.failed.length
                ? t('quick.failed', { categories: result.failed.join(', ') })
                : undefined
            }
            links={<Link to="/history">{t('quick.openHistory')}</Link>}
          />
        )}
      </div>
      <ResourcesSection />
      <StorageSection />
      <ChecksSection checks={checks} onAnalyzeCleanup={analyze} disabled={running} />
      <ActivitySection />
      <ConfirmDialog
        open={confirming}
        onConfirm={() => {
          setConfirming(false)
          void cleanWithoutPreview()
        }}
        onCancel={() => setConfirming(false)}
        title={t('quick.confirmTitle')}
        description={[
          t('quick.confirmScope', { categories }),
          features.registry ? t('quick.confirmRegistry') : '',
          t('quick.confirmLimits')
        ]
          .filter(Boolean)
          .join(' ')}
        confirmLabel={t('quick.confirmLabel')}
        variant="danger"
      />
    </div>
  )
}
