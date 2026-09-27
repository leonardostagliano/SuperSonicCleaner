import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatBytes } from '@/lib/utils'
import { resolveAiProcessReferences } from './resolve-ai-process-references'
import type {
  DiagnosticRecording,
  DiagnosticAiReport,
  DiagnosticReport as Report
} from '@shared/performance-diagnostics'

const button = 'feature-button'
const panel = 'feature-card diagnostics-finding space-y-4'
const percent = (v: number | null): string => (v === null ? '—' : `${v.toFixed(1)}%`)

export function DiagnosticReport({
  report,
  recording
}: {
  report: Report | DiagnosticAiReport
  recording: DiagnosticRecording
}) {
  const { t } = useTranslation('diagnostics')
  const [range, setRange] = useState<{ startMs: number; endMs: number } | null>(null)
  const display = (value: string): string =>
    report.source === 'codex' ? resolveAiProcessReferences(value, report, recording) : value
  const processName = (id: string | null): string | null => {
    if (report.source !== 'codex' || !id) return null
    const ref = report.processRefs.find((item) => item.id === id)
    return ref
      ? (recording.samples[ref.sampleIndex]?.processes[ref.processIndex]?.name ?? null)
      : null
  }
  return (
    <div className="diagnostics-report">
      {report && (
        <div className="space-y-4">
          <p className="font-medium">{display(report.summary)}</p>
          <p className="text-xs text-[var(--text-muted)]">
            {t(
              report.source === 'codex'
                ? 'aiReportCaution'
                : report.source === 'local'
                  ? 'localReportCaution'
                  : 'aiCaution'
            )}{' '}
            · {report.analyzerVersion} · {new Date(report.generatedAt).toLocaleString()}
          </p>
          {report.findings.map((f, i) => (
            <article key={i} className={panel}>
              <h3 className="font-semibold">
                {display(f.title)}{' '}
                <span className="text-xs font-normal">
                  {t('confidence', { level: t(f.confidence) })}
                </span>
              </h3>
              <p className="text-sm">
                <strong>{t('observation')}</strong> {display(f.observation)}
              </p>
              <p className="text-sm">
                <strong>{t('interpretation')}</strong> {display(f.interpretation)}
              </p>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                {t('nextSteps')}
              </p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {f.nextSteps.map((step, j) => (
                  <li key={j}>{display(step)}</li>
                ))}
              </ul>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                {t('evidence')}
              </p>
              <div className="flex flex-wrap gap-2">
                {f.evidence.map((e, j) => (
                  <button
                    type="button"
                    className={button}
                    key={j}
                    aria-pressed={range?.startMs === e.startMs && range?.endMs === e.endMs}
                    onClick={() => setRange(e)}
                  >
                    {t(e.metric)}
                    {'processId' in e && processName(e.processId)
                      ? ` · ${processName(e.processId)}`
                      : ''}
                    {' · '}
                    {(e.startMs / 1000).toFixed(1)}–{(e.endMs / 1000).toFixed(1)}s
                  </button>
                ))}
              </div>
            </article>
          ))}
          <h3 className="font-semibold">{t('analysisLimitations')}</h3>
          <ul className="list-disc pl-5 text-sm">
            {report.limitations.map((l, i) => (
              <li key={i}>{display(l)}</li>
            ))}
          </ul>
        </div>
      )}
      {range && (
        <div className="overflow-x-auto">
          <p className="text-xs">{t('evidenceLimit')}</p>
          <table className="w-full text-left text-xs">
            <thead>
              <tr>
                <th>{t('time')}</th>
                <th>CPU</th>
                <th>{t('memory')}</th>
                <th>{t('read')}</th>
                <th>{t('write')}</th>
                <th>{t('processes')}</th>
              </tr>
            </thead>
            <tbody>
              {recording.samples
                .filter((s) => s.t >= range.startMs && s.t <= range.endMs)
                .slice(0, 50)
                .map((s) => (
                  <tr key={s.t}>
                    <td>{(s.t / 1000).toFixed(1)}s</td>
                    <td>{percent(s.cpuPercent)}</td>
                    <td>{percent(s.memoryPercent)}</td>
                    <td>
                      {s.diskReadBytesPerSec === null
                        ? '—'
                        : `${formatBytes(s.diskReadBytesPerSec)}/s`}
                    </td>
                    <td>
                      {s.diskWriteBytesPerSec === null
                        ? '—'
                        : `${formatBytes(s.diskWriteBytesPerSec)}/s`}
                    </td>
                    <td>
                      {s.processes
                        .map((p) => `${p.name} (PID ${p.pid}): ${percent(p.cpuPercent)}`)
                        .join(', ') || '—'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
