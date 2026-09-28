import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChartNoAxesCombined, Download, Pin, Play, Square, Trash2, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { DiagnosticReport } from '@/components/perf/DiagnosticReport'
import { formatDateTime } from '@/components/perf/perf-summary'
import '@/components/perf/perf.css'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/Button'
import { Card, Section } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import { Segmented } from '@/components/ui/Segmented'
import { Switch } from '@/components/ui/Switch'
import { Tag } from '@/components/ui/Tag'
import { icons } from '@/lib/icons'
import { useDiagnosticsStore } from '@/stores/diagnostics-store'

const MAX_RECORDINGS = 30
const DURATIONS = ['120', '300', '900'] as const
type Duration = (typeof DURATIONS)[number]
/** A confirmation waiting for an answer: dropping an unsaved draft, or deleting. */
type Pending = { kind: 'start' } | { kind: 'select'; id: string } | { kind: 'delete' } | null

const AiIcon = icons.ai

export function PerformanceDiagnosticsPage() {
  const { t, i18n } = useTranslation('diagnostics')
  const locale = i18n.language
  const {
    status,
    selectedId,
    session,
    title,
    notes,
    loading,
    busy,
    error,
    statusError,
    feedback,
    aiEnabled,
    aiConnection,
    aiChecking,
    aiCancelling,
    aiErrorCode,
    toggleAi,
    checkAiConnection,
    analyzeAi,
    cancelAi,
    refresh,
    select,
    setDraft,
    start,
    stop,
    save,
    analyze,
    togglePinned,
    remove,
    export: exportRecording
  } = useDiagnosticsStore()
  const [duration, setDuration] = useState<Duration>('120')
  const [includeProcesses, setIncludeProcesses] = useState(false)
  const [pending, setPending] = useState<Pending>(null)
  const aiHeadingId = useId()
  const working = busy !== null
  const ready = !loading && session?.recording.recordId === selectedId
  const recording =
    session?.state === 'recording' || (!!selectedId && status?.activeId === selectedId)
  const dirty = !!session && (title.trim() !== session.title || notes !== session.notes)
  const full = !!status && status.rows.length >= MAX_RECORDINGS
  const language = i18n.resolvedLanguage?.startsWith('it') ? 'it' : 'en'

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 1000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const startRecording = () => void start(Number(duration), includeProcesses)
  const onStart = () => (dirty ? setPending({ kind: 'start' }) : startRecording())
  const onSelect = (id: string) => {
    if (working) return
    if (id !== selectedId && dirty) setPending({ kind: 'select', id })
    else void select(id)
  }
  const confirmPending = () => {
    const action = pending
    setPending(null)
    if (action?.kind === 'start') startRecording()
    else if (action?.kind === 'select') void select(action.id)
    else if (action?.kind === 'delete') void remove()
  }

  const durationOptions = DURATIONS.map((value) => ({
    value,
    label: t('minutes', { count: Number(value) / 60 })
  }))

  return (
    <div className="feature-page">
      <PageHeader title={t('title')} description={t('description')} />
      <div className="perf-stack">
        {(error || statusError || status?.error) && (
          <p role="alert" className="diag-error">
            {status?.error || t('operationFailed')}
          </p>
        )}
        {feedback && (
          <p role="status" className="diag-feedback">
            {t(feedback)}
          </p>
        )}
        <div className="diag-top">
          <Section title={t('newRecording')}>
            <div className="diag-stack">
              <p className="diag-text">{t('localFirst')}</p>
              {status?.activeId ? (
                <div className="diag-actions">
                  <p role="status" className="diag-status">
                    {t('recordingElapsed', { seconds: Math.floor(status.elapsedMs / 1000) })}
                  </p>
                  <Button
                    variant="primary"
                    icon={Square}
                    busy={busy === 'stop'}
                    disabled={working}
                    onClick={() => void stop()}
                  >
                    {t('stop')}
                  </Button>
                </div>
              ) : (
                <>
                  <div className="diag-field">
                    <span className="diag-field-label">{t('duration')}</span>
                    <Segmented
                      options={durationOptions}
                      value={duration}
                      onChange={setDuration}
                      label={t('duration')}
                    />
                  </div>
                  <label className="diag-check">
                    <Checkbox
                      checked={includeProcesses}
                      disabled={working}
                      onChange={setIncludeProcesses}
                      label={t('collectProcesses')}
                    />
                    <span>{t('collectProcesses')}</span>
                  </label>
                  <Button
                    variant="primary"
                    icon={Play}
                    busy={busy === 'start'}
                    disabled={working || !status || full}
                    onClick={onStart}
                  >
                    {t('start')}
                  </Button>
                </>
              )}
              {full && <p className="perf-note">{t('capacityReached')}</p>}
            </div>
          </Section>

          <Section
            title={t('history')}
            meta={status ? t('historyMeta', { count: status.rows.length }) : undefined}
          >
            {status && status.rows.length === 0 ? (
              <p className="perf-note">{t('emptyHint')}</p>
            ) : (
              <ul className="diag-rows">
                {status?.rows.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className="diag-row"
                      aria-current={selectedId === row.id ? 'true' : undefined}
                      aria-disabled={working || undefined}
                      onClick={() => onSelect(row.id)}
                    >
                      <span className="diag-row-title">
                        <span className="perf-truncate">{row.title}</span>
                        {row.pinned && <Tag tone="neutral">{t('pinned')}</Tag>}
                      </span>
                      <span className="diag-row-facts">
                        {t('rowFacts', {
                          date: formatDateTime(row.startedAt, locale),
                          seconds: Math.round(row.durationMs / 1000),
                          samples: row.samples
                        })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        {loading && (
          <p role="status" className="perf-note">
            {t('loadingDetails')}
          </p>
        )}

        {session && selectedId && (
          <>
            <Section
              title={t('recordingDetails')}
              meta={formatDateTime(session.recording.startedAt, locale)}
            >
              <div className="diag-stack">
                {recording && <p className="diag-text">{t('stopBeforeDetails')}</p>}
                <div className="diag-fields">
                  <label className="diag-input">
                    <span>{t('name')}</span>
                    <input
                      value={title}
                      disabled={working || !ready}
                      aria-invalid={!title.trim()}
                      onChange={(event) => setDraft('title', event.target.value)}
                      maxLength={120}
                    />
                  </label>
                  <label className="diag-input">
                    <span>{t('notes')}</span>
                    <textarea
                      value={notes}
                      disabled={working || !ready}
                      onChange={(event) => setDraft('notes', event.target.value)}
                      maxLength={2000}
                      rows={3}
                    />
                  </label>
                </div>
                {!title.trim() && <p className="diag-error">{t('nameRequired')}</p>}
                {dirty && <p className="perf-note">{t('unsavedDetails')}</p>}
                <div className="diag-actions">
                  <Button
                    busy={busy === 'save'}
                    disabled={working || !ready || recording || !dirty || !title.trim()}
                    onClick={() => void save()}
                  >
                    {busy === 'save' ? t('saving') : t('save')}
                  </Button>
                  <Button
                    icon={Pin}
                    disabled={working || !ready || recording}
                    onClick={() => void togglePinned()}
                  >
                    {session.pinned ? t('unpin') : t('pin')}
                  </Button>
                  <Button
                    icon={Download}
                    disabled={working || !ready || dirty}
                    onClick={() => void exportRecording()}
                  >
                    {t('export')}
                  </Button>
                  <Button
                    icon={Trash2}
                    disabled={working || !ready || session.pinned || recording}
                    onClick={() => setPending({ kind: 'delete' })}
                  >
                    {t('deleteLocal')}
                  </Button>
                </div>
                <p className="perf-note">{t('exportPrivacy')}</p>
              </div>
            </Section>

            <Section title={t('localAnalysis')}>
              <div className="diag-stack">
                <p className="diag-text">{t('analysisDescription')}</p>
                <Button
                  icon={ChartNoAxesCombined}
                  busy={busy === 'analyze'}
                  disabled={working || !ready || recording}
                  onClick={() => void analyze(language)}
                >
                  {busy === 'analyze'
                    ? t('analyzing')
                    : session.report
                      ? t('analyzeAgain')
                      : t('analyzeRecording')}
                </Button>
                <p className="perf-note">
                  {recording ? t('stopBeforeAnalysis') : t('analysisPrivacy')}
                </p>
              </div>
              {session.report && (
                <section className="diag-report-block" aria-label={t('localReport')}>
                  <h3 className="diag-subtitle">{t('localReport')}</h3>
                  <DiagnosticReport
                    key={`${selectedId}:${session.report.generatedAt}`}
                    report={session.report}
                    recording={session.recording}
                  />
                </section>
              )}
            </Section>

            <Card as="section" aria-labelledby={aiHeadingId} className="ui-section">
              <div className="ui-section-head">
                <h2 id={aiHeadingId} className="ui-section-title diag-ai-title">
                  <AiIcon size={16} strokeWidth={1.75} aria-hidden="true" />
                  {t('aiAnalysis')}
                </h2>
                <div className="ui-section-aside">
                  <Switch
                    checked={aiEnabled}
                    onChange={() => toggleAi()}
                    label={t('aiEnable')}
                    disabled={busy === 'analyzeAi'}
                  />
                </div>
              </div>
              <p className="diag-text">{t('aiDescription')}</p>
              {aiEnabled && (
                <div className="diag-ai-body">
                  <p className="diag-text">{t('aiPrivacy')}</p>
                  <p className="perf-note">{t('aiAccess')}</p>
                  {aiChecking ? (
                    <p role="status" className="perf-note">
                      {t('aiChecking')}
                    </p>
                  ) : !aiConnection?.available || !aiConnection.connected ? (
                    <div className="diag-actions">
                      <p role="status" className="diag-text">
                        {t(`aiErrors.${aiConnection?.errorCode ?? 'codex-unavailable'}`)}
                      </p>
                      <Button onClick={() => void checkAiConnection()}>
                        {t('aiRetryConnection')}
                      </Button>
                    </div>
                  ) : (
                    <div className="diag-actions">
                      <Button
                        icon={AiIcon}
                        busy={busy === 'analyzeAi'}
                        disabled={working || !ready || recording}
                        onClick={() => void analyzeAi(selectedId, language)}
                      >
                        {busy === 'analyzeAi'
                          ? aiCancelling
                            ? t('aiCancelling')
                            : t('aiAnalyzing')
                          : session.aiReport
                            ? t('aiAnalyzeAgain')
                            : t('aiAnalyze')}
                      </Button>
                      {busy === 'analyzeAi' && !aiCancelling && (
                        <Button variant="ghost" icon={X} onClick={() => void cancelAi()}>
                          {t('aiCancel')}
                        </Button>
                      )}
                    </div>
                  )}
                  {recording && <p className="perf-note">{t('aiStopFirst')}</p>}
                  {busy === 'analyzeAi' && (
                    <p role="status" className="perf-note">
                      {t('aiBackground')}
                    </p>
                  )}
                  {aiErrorCode && (
                    <p role="alert" className="diag-error">
                      {t(`aiErrors.${aiErrorCode}`, {
                        defaultValue: t('aiErrors.analysis-failed')
                      })}
                    </p>
                  )}
                </div>
              )}
              {session.aiReport && (
                <section className="diag-report-block" aria-label={t('aiReport')}>
                  <h3 className="diag-subtitle">{t('aiReport')}</h3>
                  <DiagnosticReport
                    key={`${selectedId}:${session.aiReport.generatedAt}`}
                    report={session.aiReport}
                    recording={session.recording}
                  />
                </section>
              )}
            </Card>
          </>
        )}
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === 'delete'
            ? t('deleteTitle', { title: session?.title ?? '' })
            : t('discardTitle')
        }
        description={pending?.kind === 'delete' ? t('deleteDescription') : t('discardDescription')}
        confirmLabel={pending?.kind === 'delete' ? t('deleteLocal') : t('discardConfirm')}
        variant={pending?.kind === 'delete' ? 'danger' : 'default'}
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
      />
    </div>
  )
}
