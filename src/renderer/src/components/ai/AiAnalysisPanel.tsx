import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles, X } from 'lucide-react'
import type { AiAnalysisSource } from '@shared/ai-analysis'
import { type LocalAiCandidate, MAX_AI_ITEMS } from './ai-metadata'
import { useAiAnalysisStore } from '@/stores/ai-analysis-store'
import { Button, Switch, Tag } from '@/components/ui'
import './ai-analysis.css'

interface Props {
  source: AiAnalysisSource
  candidates: LocalAiCandidate[]
  /** A new scan, deletion, or disk location makes previous recommendations stale. */
  sourceRevision: unknown
}

export function AiAnalysisPanel({ source, candidates, sourceRevision }: Props) {
  const { t } = useTranslation('ai')
  const session = useAiAnalysisStore((s) => s.sessions[source])
  const { enabled, result, error, omitted, localPaths } = session
  const connection = useAiAnalysisStore((s) => s.connection)
  const checking = useAiAnalysisStore((s) => s.checking)
  const activeSource = useAiAnalysisStore((s) => s.activeSource)
  const cancelling = useAiAnalysisStore((s) => s.cancelling)
  const sync = useAiAnalysisStore((s) => s.sync)
  const checkConnection = useAiAnalysisStore((s) => s.checkConnection)
  const running = activeSource === source

  useEffect(() => {
    sync(source, sourceRevision)
  }, [source, sourceRevision, sync])

  const toggle = () => useAiAnalysisStore.getState().toggle(source)
  const analyze = () => useAiAnalysisStore.getState().analyze(source, candidates)
  const cancel = () => useAiAnalysisStore.getState().cancel(source)

  const recommendations = result?.recommendations.filter((item) => localPaths.has(item.fileId))

  return (
    <section className="ai-analysis-panel" aria-label={t('title')}>
      <div className="ai-analysis-heading">
        <Sparkles className="ai-analysis-icon" size={20} strokeWidth={1.75} aria-hidden="true" />
        <div className="ai-analysis-heading-copy">
          <h2>{t('title')}</h2>
          <p>{t('description')}</p>
        </div>
        <Switch checked={enabled} onChange={() => void toggle()} label={t('enable')} />
      </div>

      {enabled && (
        <div className="ai-analysis-body">
          <p className="ai-analysis-privacy">{t('privacy')}</p>
          <p className="ai-analysis-caveat">{t('accessCaveat')}</p>
          {source === 'disk' && <p className="ai-analysis-caveat">{t('diskAggregation')}</p>}
          {checking ? (
            <p className="ai-analysis-message" role="status">
              {t('checking')}
            </p>
          ) : !connection?.connected || !connection.available ? (
            <div className="ai-analysis-connection">
              <p className="ai-analysis-message" role="status">
                {connection?.errorCode === 'codex-not-found'
                  ? t('codexMissing')
                  : connection?.errorCode === 'codex-version-unsupported'
                    ? t('unsupportedVersion')
                    : connection?.errorCode === 'unsafe-configuration'
                      ? t('unsafeConfiguration')
                      : connection?.errorCode === 'not-connected' ||
                          (connection?.available && !connection.connected && !connection.errorCode)
                        ? t('signIn')
                        : t('unavailable')}
              </p>
              <Button variant="ghost" onClick={() => void checkConnection()}>
                {t('retryConnection')}
              </Button>
            </div>
          ) : (
            <div className="ai-analysis-actions">
              <Button
                icon={Sparkles}
                busy={running}
                disabled={activeSource !== null || candidates.length === 0}
                onClick={() => void analyze()}
              >
                {running && cancelling ? t('cancelling') : running ? t('analyzing') : t('analyze')}
              </Button>
              {running && !cancelling && (
                <Button variant="ghost" icon={X} onClick={cancel}>
                  {t('cancel')}
                </Button>
              )}
              <span>{t('limit', { count: Math.min(candidates.length, MAX_AI_ITEMS) })}</span>
            </div>
          )}
          {candidates.length === 0 && <p className="ai-analysis-message">{t('scanFirst')}</p>}
          {activeSource && !running && (
            <p className="ai-analysis-message" role="status">
              {t('anotherRunning')}
            </p>
          )}
          {running && (
            <p className="ai-analysis-message" role="status">
              {t('continuesInBackground')}
            </p>
          )}
          {error && (
            <p className="ai-analysis-error" role="alert">
              {t('failed')}
            </p>
          )}
          {result && (
            <div className="ai-analysis-result" aria-live="polite">
              <p className="ai-analysis-summary">{result.summary}</p>
              {omitted > 0 && (
                <p className="ai-analysis-note">{t('omitted', { count: omitted })}</p>
              )}
              {recommendations && recommendations.length > 0 && (
                <ul className="ai-analysis-recommendations">
                  {recommendations.map((item) => (
                    <li key={item.fileId}>
                      <div className="ai-analysis-recommendation-head">
                        <strong title={localPaths.get(item.fileId)}>
                          {localPaths.get(item.fileId)}
                        </strong>
                        <Tag tone="neutral">{t(`priority.${item.priority}`)}</Tag>
                      </div>
                      <p>{item.reason}</p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="ai-analysis-note">{t('advisory')}</p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
