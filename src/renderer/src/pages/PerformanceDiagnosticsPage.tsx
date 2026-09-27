import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  ChartNoAxesCombined,
  Download,
  Pin,
  Play,
  Sparkles,
  Square,
  Trash2,
  X
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { DiagnosticReport } from '@/components/perf/DiagnosticReport'
import { useDiagnosticsStore } from '@/stores/diagnostics-store'

export function PerformanceDiagnosticsPage() {
  const { t, i18n } = useTranslation('diagnostics')
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
  const [duration, setDuration] = useState<120 | 300 | 900>(120)
  const [includeProcesses, setIncludeProcesses] = useState(false)
  const working = busy !== null
  const ready = !loading && session?.recording.recordId === selectedId
  const recording =
    session?.state === 'recording' || (!!selectedId && status?.activeId === selectedId)
  const dirty = !!session && (title.trim() !== session.title || notes !== session.notes)

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 1000)
    return () => window.clearInterval(timer)
  }, [refresh])

  return (
    <div className="feature-page animate-fade-in">
      <PageHeader title={t('title')} description={t('description')} />
      {(error || statusError || status?.error) && (
        <p role="alert" className="mb-4 text-sm text-[var(--danger-text)]">
          {status?.error || t('operationFailed')}
        </p>
      )}
      {feedback && (
        <p role="status" className="mb-4 text-sm text-[var(--success-text)]">
          {t(feedback)}
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
        <section className="pulse-card space-y-5" aria-labelledby="diagnostics-capture">
          <div className="pulse-card-heading">
            <div className="flex items-center gap-3">
              <Activity size={21} aria-hidden="true" />
              <h2 id="diagnostics-capture">{t('newRecording')}</h2>
            </div>
          </div>
          <p className="text-sm text-[var(--text-secondary)]">{t('localFirst')}</p>
          {status?.activeId ? (
            <div className="flex flex-wrap items-center gap-3">
              <span role="status" className="text-sm text-[var(--success-text)]">
                {t('recording')} · {Math.floor(status.elapsedMs / 1000)}s
              </span>
              <button
                className="pulse-button pulse-primary"
                disabled={working}
                onClick={() => void stop()}
              >
                <Square size={15} aria-hidden="true" /> {t('stop')}
              </button>
            </div>
          ) : (
            <>
              <fieldset className="flex flex-wrap gap-2">
                <legend className="mb-2 text-sm font-medium">{t('duration')}</legend>
                {([120, 300, 900] as const).map((seconds) => (
                  <button
                    key={seconds}
                    type="button"
                    className="pulse-button"
                    aria-pressed={duration === seconds}
                    disabled={working}
                    onClick={() => setDuration(seconds)}
                  >
                    {t('minutes', { count: seconds / 60 })}
                  </button>
                ))}
              </fieldset>
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={includeProcesses}
                  disabled={working}
                  onChange={(event) => setIncludeProcesses(event.target.checked)}
                />
                {t('collectProcesses')}
              </label>
              <button
                className="pulse-button pulse-primary"
                disabled={working || !status || status.rows.length >= 30}
                onClick={() => {
                  if (dirty && !window.confirm(t('discardDetails'))) return
                  void start(duration, includeProcesses)
                }}
              >
                <Play size={15} aria-hidden="true" /> {t('start')}
              </button>
            </>
          )}
          <p className="text-xs text-[var(--text-muted)]">{t('retention')}</p>
          {!!status && status.rows.length >= 30 && (
            <p className="text-sm text-[var(--text-muted)]">{t('capacityReached')}</p>
          )}
        </section>
        <section className="pulse-card" aria-labelledby="diagnostics-history">
          <div className="pulse-card-heading">
            <h2 id="diagnostics-history">{t('history')}</h2>
          </div>
          {status && status.rows.length === 0 && (
            <p className="text-sm text-[var(--text-muted)]">{t('emptyHint')}</p>
          )}
          <ul className="mt-3 space-y-2">
            {status?.rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="w-full rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--surface)] px-3 py-3 text-left text-sm hover:bg-[var(--surface-hover)] aria-[current=true]:border-[var(--accent)]"
                  aria-current={selectedId === row.id ? 'true' : undefined}
                  disabled={working}
                  onClick={() => {
                    if (row.id !== selectedId && dirty && !window.confirm(t('discardDetails')))
                      return
                    void select(row.id)
                  }}
                >
                  <span className="block font-semibold text-[var(--text-primary)]">
                    {row.title}
                    {row.pinned && <Pin className="ml-2 inline" size={13} aria-label={t('pin')} />}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {new Date(row.startedAt).toLocaleString()} · {Math.round(row.durationMs / 1000)}
                    s · {row.samples} {t('samples')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {loading && (
        <p role="status" className="mt-5 text-sm text-[var(--text-muted)]">
          {t('loadingDetails')}
        </p>
      )}
      {session && selectedId && (
        <section className="pulse-card mt-5 space-y-4" aria-labelledby="diagnostics-details">
          <div className="pulse-card-heading">
            <h2 id="diagnostics-details">{t('recordingDetails')}</h2>
          </div>
          <div className="rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--surface)] p-4">
            <h3 className="font-semibold text-[var(--text-primary)]">{t('localAnalysis')}</h3>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{t('analysisDescription')}</p>
            <button
              type="button"
              className="pulse-button pulse-primary mt-3"
              disabled={working || !ready || recording}
              onClick={() => void analyze(i18n.resolvedLanguage?.startsWith('it') ? 'it' : 'en')}
            >
              <ChartNoAxesCombined size={16} aria-hidden="true" />
              {busy === 'analyze'
                ? t('analyzing')
                : session.report
                  ? t('analyzeAgain')
                  : t('analyzeRecording')}
            </button>
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              {recording ? t('stopBeforeAnalysis') : t('analysisPrivacy')}
            </p>
          </div>
          <div className="rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--surface)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                  <Sparkles size={17} aria-hidden="true" /> {t('aiAnalysis')}
                </h3>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">{t('aiDescription')}</p>
              </div>
              <button
                className="relative h-7 w-12 rounded-full border border-[var(--toggle-off-border)] bg-[var(--toggle-off-bg)] p-0.5 transition-colors aria-[checked=true]:border-[var(--accent)] aria-[checked=true]:bg-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                type="button"
                role="switch"
                aria-label={t('aiEnable')}
                aria-checked={aiEnabled}
                disabled={busy === 'analyzeAi'}
                onClick={toggleAi}
              >
                <span
                  className={`block h-5 w-5 rounded-full shadow-sm transition-transform ${aiEnabled ? 'translate-x-5 bg-[var(--toggle-on-thumb)]' : 'bg-[var(--toggle-off-thumb)]'}`}
                />
              </button>
            </div>
            {aiEnabled && (
              <div className="mt-4 space-y-3 border-t border-[var(--border-default)] pt-4">
                <p className="text-sm text-[var(--text-secondary)]">{t('aiPrivacy')}</p>
                <p className="text-xs text-[var(--text-muted)]">{t('aiAccess')}</p>
                {aiChecking ? (
                  <p role="status" className="text-sm text-[var(--text-muted)]">
                    {t('aiChecking')}
                  </p>
                ) : !aiConnection?.available || !aiConnection.connected ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <p role="status" className="text-sm text-[var(--text-secondary)]">
                      {t(`aiErrors.${aiConnection?.errorCode ?? 'codex-unavailable'}`)}
                    </p>
                    <button
                      type="button"
                      className="pulse-button"
                      onClick={() => void checkAiConnection()}
                    >
                      {t('aiRetryConnection')}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="pulse-button pulse-primary"
                      disabled={working || !ready || recording}
                      onClick={() =>
                        void analyzeAi(
                          selectedId,
                          i18n.resolvedLanguage?.startsWith('it') ? 'it' : 'en'
                        )
                      }
                    >
                      <Sparkles size={16} aria-hidden="true" />
                      {busy === 'analyzeAi'
                        ? aiCancelling
                          ? t('aiCancelling')
                          : t('aiAnalyzing')
                        : session.aiReport
                          ? t('aiAnalyzeAgain')
                          : t('aiAnalyze')}
                    </button>
                    {busy === 'analyzeAi' && !aiCancelling && (
                      <button
                        type="button"
                        className="pulse-button"
                        onClick={() => void cancelAi()}
                      >
                        <X size={15} aria-hidden="true" /> {t('aiCancel')}
                      </button>
                    )}
                  </div>
                )}
                {recording && (
                  <p className="text-xs text-[var(--text-muted)]">{t('aiStopFirst')}</p>
                )}
                {busy === 'analyzeAi' && (
                  <p role="status" className="text-xs text-[var(--text-muted)]">
                    {t('aiBackground')}
                  </p>
                )}
                {aiErrorCode && (
                  <p role="alert" className="text-sm text-[var(--danger-text)]">
                    {t(`aiErrors.${aiErrorCode}`, { defaultValue: t('aiErrors.analysis-failed') })}
                  </p>
                )}
              </div>
            )}
          </div>
          {recording && (
            <p className="text-sm text-[var(--text-secondary)]">{t('stopBeforeDetails')}</p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm">
              {t('name')}
              <input
                className="mt-2 w-full rounded-[var(--radius-control)] border border-[var(--border-medium)] bg-[var(--surface)] p-2 text-[var(--text-primary)]"
                value={title}
                disabled={working || !ready}
                aria-invalid={!title.trim()}
                onChange={(event) => setDraft('title', event.target.value)}
                maxLength={120}
              />
            </label>
            <label className="text-sm">
              {t('notes')}
              <textarea
                className="mt-2 w-full rounded-[var(--radius-control)] border border-[var(--border-medium)] bg-[var(--surface)] p-2 text-[var(--text-primary)]"
                value={notes}
                disabled={working || !ready}
                onChange={(event) => setDraft('notes', event.target.value)}
                maxLength={2000}
                rows={3}
              />
            </label>
          </div>
          {!title.trim() && (
            <p className="text-sm text-[var(--danger-text)]">{t('nameRequired')}</p>
          )}
          {dirty && <p className="text-xs text-[var(--text-muted)]">{t('unsavedDetails')}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              className="pulse-button pulse-primary"
              disabled={working || !ready || recording || !dirty || !title.trim()}
              onClick={() => void save()}
            >
              {busy === 'save' ? t('saving') : t('save')}
            </button>
            <button
              className="pulse-button"
              aria-pressed={session.pinned}
              disabled={working || !ready || recording}
              onClick={() => void togglePinned()}
            >
              <Pin size={15} aria-hidden="true" /> {session.pinned ? t('unpin') : t('pin')}
            </button>
            <button
              className="pulse-button"
              disabled={working || !ready || dirty}
              onClick={() => void exportRecording()}
            >
              <Download size={15} aria-hidden="true" /> {t('export')}
            </button>
            <button
              className="pulse-button"
              disabled={working || !ready || session.pinned || recording}
              onClick={() => {
                if (!window.confirm(t('confirmDelete'))) return
                void remove()
              }}
            >
              <Trash2 size={15} aria-hidden="true" /> {t('deleteLocal')}
            </button>
          </div>
          <p className="text-xs text-[var(--text-muted)]">{t('exportPrivacy')}</p>
          {session.report && (
            <section className="space-y-3" aria-label={t('localReport')}>
              <h3 className="font-semibold text-[var(--text-primary)]">{t('localReport')}</h3>
              <DiagnosticReport
                key={`${selectedId}:${session.report.generatedAt}`}
                report={session.report}
                recording={session.recording}
              />
            </section>
          )}
          {session.aiReport && (
            <section
              className="space-y-3 border-t border-[var(--border-default)] pt-4"
              aria-label={t('aiReport')}
            >
              <h3 className="font-semibold text-[var(--text-primary)]">{t('aiReport')}</h3>
              <DiagnosticReport
                key={`${selectedId}:${session.aiReport.generatedAt}`}
                report={session.aiReport}
                recording={session.recording}
              />
            </section>
          )}
        </section>
      )}
    </div>
  )
}
