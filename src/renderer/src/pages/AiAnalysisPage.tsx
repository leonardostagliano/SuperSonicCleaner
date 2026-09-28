import './ai-hub.css'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'
import type { AiAnalysisSource } from '@shared/ai-analysis'
import { PageHeader } from '@/components/layout/PageHeader'
import {
  Button,
  Card,
  Section,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tag
} from '@/components/ui'
import { icons } from '@/lib/icons'
import { useAiAnalysisStore } from '@/stores/ai-analysis-store'
import { useDiagnosticsStore } from '@/stores/diagnostics-store'

const tools = [
  { source: 'cleaner', path: '/cleaner', key: 'cleaner' },
  { source: 'large-files', path: '/large-files', key: 'largeFiles' },
  { source: 'duplicates', path: '/duplicates', key: 'duplicates' },
  { source: 'disk', path: '/disk', key: 'disk' }
] as const satisfies readonly { source: AiAnalysisSource; path: string; key: string }[]

export function AiAnalysisPage() {
  const { t } = useTranslation('ai')
  const { connection, checking, checkConnection, activeSource, cancelling, cancel, sessions } =
    useAiAnalysisStore()
  const performanceEnabled = useDiagnosticsStore((state) => state.aiEnabled)
  const performanceRunning = useDiagnosticsStore((state) => state.busy === 'analyzeAi')
  const performanceCancelling = useDiagnosticsStore((state) => state.aiCancelling)
  const cancelPerformance = useDiagnosticsStore((state) => state.cancelAi)
  const active = tools.find((tool) => tool.source === activeSource)

  const status = !connection
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
              : t('unavailable')

  return (
    <div className="ai-hub">
      <PageHeader title={t('title')} description={t('hubDescription')} />
      <div className="ai-hub-stack">
        <Section
          title={t('connectionTitle')}
          actions={
            <Button busy={checking} onClick={() => void checkConnection()}>
              {checking ? t('checking') : t('retryConnection')}
            </Button>
          }
        >
          <p className="ai-hub-status" role="status">
            <Sparkles size={16} strokeWidth={1.75} aria-hidden="true" />
            <span>{status}</span>
          </p>
          <p className="ai-hub-text">{t('hubPrivacy')}</p>
          <p className="ai-hub-note">{t('advisory')}</p>
        </Section>

        {active && (
          <RunningCard
            label={t(`tools.${active.key}.title`)}
            path={active.path}
            cancelling={cancelling}
            onCancel={() => cancel(active.source)}
          />
        )}
        {performanceRunning && (
          <RunningCard
            label={t('tools.performance.title')}
            path="/performance-diagnostics"
            cancelling={performanceCancelling}
            onCancel={() => void cancelPerformance()}
          />
        )}

        <Section title={t('toolsTitle')}>
          <div className="ai-hub-table">
            <Table>
              <TableHead>
                <TableHeaderCell>{t('columns.tool')}</TableHeaderCell>
                <TableHeaderCell>{t('columns.dataSent')}</TableHeaderCell>
                <TableHeaderCell>{t('columns.lastRun')}</TableHeaderCell>
                <TableHeaderCell>{t('columns.state')}</TableHeaderCell>
              </TableHead>
              <tbody>
                {tools.map(({ source, path, key }) => {
                  const session = sessions[source]
                  return (
                    <TableRow key={source}>
                      <TableCell>
                        <ToolLink path={path} label={t(`tools.${key}.title`)} />
                      </TableCell>
                      <TableCell muted>{t(`tools.${key}.dataSent`)}</TableCell>
                      <TableCell>
                        {activeSource === source ? (
                          t('lastRun.running')
                        ) : session.error ? (
                          <Tag tone="danger">{t('lastRun.failed')}</Tag>
                        ) : session.result ? (
                          t('lastRun.done')
                        ) : (
                          <span className="ai-hub-muted">{t('lastRun.none')}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Tag tone="neutral">{session.enabled ? t('state.on') : t('state.off')}</Tag>
                      </TableCell>
                    </TableRow>
                  )
                })}
                <TableRow>
                  <TableCell>
                    <ToolLink
                      path="/performance-diagnostics"
                      label={t('tools.performance.title')}
                    />
                  </TableCell>
                  <TableCell muted>{t('tools.performance.dataSent')}</TableCell>
                  <TableCell>
                    {performanceRunning ? (
                      t('lastRun.running')
                    ) : (
                      <span className="ai-hub-muted">{t('lastRun.perRecording')}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Tag tone="neutral">{performanceEnabled ? t('state.on') : t('state.off')}</Tag>
                  </TableCell>
                </TableRow>
              </tbody>
            </Table>
          </div>
          <p className="ai-hub-note ai-hub-after-table">{t('hubInstructions')}</p>
        </Section>
      </div>
    </div>
  )
}

function ToolLink({ path, label }: { path: string; label: string }) {
  const Next = icons.next
  return (
    <Link className="ai-hub-tool" to={path}>
      <span>{label}</span>
      <Next size={16} strokeWidth={1.75} aria-hidden="true" />
    </Link>
  )
}

function RunningCard({
  label,
  path,
  cancelling,
  onCancel
}: {
  label: string
  path: string
  cancelling: boolean
  onCancel: () => void
}) {
  const { t } = useTranslation('ai')
  return (
    <Card className="ai-hub-running" aria-live="polite">
      <p className="ai-hub-text">
        {label} · {t('continuesInBackground')}
      </p>
      <div className="ai-hub-actions">
        <Link className="ui-button" data-variant="secondary" data-size="md" to={path}>
          {t('returnToAnalysis')}
        </Link>
        <Button variant="ghost" busy={cancelling} onClick={onCancel}>
          {cancelling ? t('cancelling') : t('cancel')}
        </Button>
      </div>
    </Card>
  )
}
