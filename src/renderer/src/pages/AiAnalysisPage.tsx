import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Activity, ArrowUpRight, Copy, FileSearch, HardDrive, Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { useAiAnalysisStore } from '@/stores/ai-analysis-store'
import { useDiagnosticsStore } from '@/stores/diagnostics-store'

const tools = [
  { source: 'cleaner', path: '/cleaner', key: 'cleaner', icon: Sparkles },
  { source: 'large-files', path: '/large-files', key: 'largeFiles', icon: FileSearch },
  { source: 'duplicates', path: '/duplicates', key: 'duplicates', icon: Copy },
  { source: 'disk', path: '/disk', key: 'disk', icon: HardDrive }
] as const

const analysisTools = [
  ...tools,
  { path: '/performance-diagnostics', key: 'performance', icon: Activity }
] as const

export function AiAnalysisPage() {
  const { t } = useTranslation('ai')
  const { connection, checking, checkConnection, activeSource, cancelling, cancel } =
    useAiAnalysisStore()
  const performanceRunning = useDiagnosticsStore((state) => state.busy === 'analyzeAi')
  const performanceCancelling = useDiagnosticsStore((state) => state.aiCancelling)
  const cancelPerformance = useDiagnosticsStore((state) => state.cancelAi)
  const active = tools.find((tool) => tool.source === activeSource)
  return (
    <div className="feature-page animate-fade-in">
      <PageHeader title={t('title')} description={t('hubDescription')} />
      <section className="pulse-card mb-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="flex items-center gap-3 text-base font-semibold">
            <Sparkles size={20} />
            {t('connectionTitle')}
          </h2>
          <button
            className="pulse-button"
            disabled={checking}
            onClick={() => void checkConnection()}
          >
            {checking ? t('checking') : t('retryConnection')}
          </button>
        </div>
        <p className="text-sm text-[var(--text-secondary)]" role="status">
          {!connection
            ? t('connectionIntro')
            : connection.available && connection.connected
              ? t('connected')
              : connection.errorCode === 'codex-not-found'
                ? t('codexMissing')
                : connection.errorCode === 'codex-version-unsupported'
                  ? t('unsupportedVersion')
                  : connection.errorCode === 'unsafe-configuration'
                    ? t('unsafeConfiguration')
                    : connection.errorCode === 'not-connected' ||
                        (connection.available && !connection.connected && !connection.errorCode)
                      ? t('signIn')
                      : t('unavailable')}
        </p>
        <p className="text-sm text-[var(--text-secondary)]">{t('hubPrivacy')}</p>
        <p className="text-xs text-[var(--text-muted)]">{t('advisory')}</p>
      </section>
      {active && (
        <section className="pulse-card mb-5 flex flex-wrap items-center gap-4" aria-live="polite">
          <p className="flex-1 text-sm">{t('continuesInBackground')}</p>
          <Link className="pulse-button" to={active.path}>
            {t('returnToAnalysis')}
          </Link>
          <button
            className="pulse-button"
            disabled={cancelling}
            onClick={() => cancel(active.source)}
          >
            {cancelling ? t('cancelling') : t('cancel')}
          </button>
        </section>
      )}
      {performanceRunning && (
        <section className="pulse-card mb-5 flex flex-wrap items-center gap-4" aria-live="polite">
          <p className="flex-1 text-sm">
            {t('tools.performance.title')} · {t('continuesInBackground')}
          </p>
          <Link className="pulse-button" to="/performance-diagnostics">
            {t('returnToAnalysis')}
          </Link>
          <button
            className="pulse-button"
            disabled={performanceCancelling}
            onClick={() => void cancelPerformance()}
          >
            {performanceCancelling ? t('cancelling') : t('cancel')}
          </button>
        </section>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {analysisTools.map(({ path, key, icon: Icon }) => (
          <section className="pulse-card flex flex-col items-start gap-4" key={path}>
            <Icon size={22} className="text-[var(--text-secondary)]" aria-hidden="true" />
            <h2 className="text-base font-semibold">{t(`tools.${key}.title`)}</h2>
            <p className="flex-1 text-sm text-[var(--text-secondary)]">
              {t(`tools.${key}.description`)}
            </p>
            <Link className="pulse-button" to={path}>
              {t('openTool')}
              <ArrowUpRight size={15} />
            </Link>
          </section>
        ))}
      </div>
      <p className="mt-5 text-sm text-[var(--text-muted)]">{t('hubInstructions')}</p>
    </div>
  )
}
