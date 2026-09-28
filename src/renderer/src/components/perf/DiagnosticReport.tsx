import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Tag } from '@/components/ui/Tag'
import { Table, TableCell, TableHead, TableHeaderCell } from '@/components/ui/Table'
import { formatSpeed } from '@/lib/utils'
import { formatDateTime, formatPercent, formatSeconds } from './perf-summary'
import { resolveAiProcessReferences } from './resolve-ai-process-references'
import type {
  DiagnosticRecording,
  DiagnosticAiReport,
  DiagnosticReport as Report
} from '@shared/performance-diagnostics'

const DASH = '—'

/** Findings with their evidence; each evidence button shows the samples it points to. */
export function DiagnosticReport({
  report,
  recording
}: {
  report: Report | DiagnosticAiReport
  recording: DiagnosticRecording
}) {
  const { t, i18n } = useTranslation('diagnostics')
  const locale = i18n.language
  const [range, setRange] = useState<{ startMs: number; endMs: number } | null>(null)
  const percent = (v: number | null): string => (v === null ? DASH : formatPercent(v, locale, 1))
  const rate = (v: number | null): string => (v === null ? DASH : formatSpeed(v, locale))
  const display = (value: string): string =>
    report.source === 'codex' ? resolveAiProcessReferences(value, report, recording) : value
  const processName = (id: string | null): string | null => {
    if (report.source !== 'codex' || !id) return null
    const ref = report.processRefs.find((item) => item.id === id)
    return ref
      ? (recording.samples[ref.sampleIndex]?.processes[ref.processIndex]?.name ?? null)
      : null
  }
  const caution = t(
    report.source === 'codex'
      ? 'aiReportCaution'
      : report.source === 'local'
        ? 'localReportCaution'
        : 'aiCaution'
  )
  return (
    <div className="diag-report">
      <p className="diag-summary">{display(report.summary)}</p>
      <p className="perf-note">
        {caution} · {report.analyzerVersion} · {formatDateTime(report.generatedAt, locale)}
      </p>
      <ol className="diag-findings">
        {report.findings.map((f, i) => (
          <li key={i} className="diag-finding">
            <div className="diag-finding-head">
              <h4>{display(f.title)}</h4>
              <Tag tone="neutral">{t('confidence', { level: t(f.confidence) })}</Tag>
            </div>
            <p>
              <strong>{t('observation')}</strong> {display(f.observation)}
            </p>
            <p>
              <strong>{t('interpretation')}</strong> {display(f.interpretation)}
            </p>
            <h5 className="diag-label">{t('nextSteps')}</h5>
            <ul className="diag-list">
              {f.nextSteps.map((step, j) => (
                <li key={j}>{display(step)}</li>
              ))}
            </ul>
            <h5 className="diag-label">{t('evidence')}</h5>
            <div className="diag-evidence">
              {f.evidence.map((e, j) => {
                const name = 'processId' in e ? processName(e.processId) : null
                return (
                  <Button
                    key={j}
                    aria-pressed={range?.startMs === e.startMs && range?.endMs === e.endMs}
                    onClick={() => setRange(e)}
                  >
                    {t(e.metric)}
                    {name ? ` · ${name}` : ''}
                    {' · '}
                    {formatSeconds(e.startMs, locale)}–{formatSeconds(e.endMs, locale)}
                  </Button>
                )
              })}
            </div>
          </li>
        ))}
      </ol>
      <h4 className="diag-subtitle">{t('analysisLimitations')}</h4>
      <ul className="diag-list">
        {report.limitations.map((l, i) => (
          <li key={i}>{display(l)}</li>
        ))}
      </ul>
      {range && (
        <div className="diag-samples">
          <p className="perf-note">{t('evidenceLimit')}</p>
          <div className="diag-samples-scroll">
            <Table>
              <TableHead>
                <TableHeaderCell numeric>{t('time')}</TableHeaderCell>
                <TableHeaderCell numeric>CPU</TableHeaderCell>
                <TableHeaderCell numeric>{t('memory')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('read')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('write')}</TableHeaderCell>
                <TableHeaderCell>{t('processes')}</TableHeaderCell>
              </TableHead>
              <tbody>
                {recording.samples
                  .filter((s) => s.t >= range.startMs && s.t <= range.endMs)
                  .slice(0, 50)
                  .map((s) => (
                    <tr key={s.t}>
                      <TableCell numeric>{formatSeconds(s.t, locale)}</TableCell>
                      <TableCell numeric>{percent(s.cpuPercent)}</TableCell>
                      <TableCell numeric>{percent(s.memoryPercent)}</TableCell>
                      <TableCell numeric>{rate(s.diskReadBytesPerSec)}</TableCell>
                      <TableCell numeric>{rate(s.diskWriteBytesPerSec)}</TableCell>
                      <TableCell muted>
                        {s.processes
                          .map((p) => `${p.name} (PID ${p.pid}): ${percent(p.cpuPercent)}`)
                          .join(', ') || DASH}
                      </TableCell>
                    </tr>
                  ))}
              </tbody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}
