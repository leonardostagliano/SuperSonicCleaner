import {
  validDiagnosticRecording,
  type DiagnosticMetric,
  type DiagnosticRecording,
  type DiagnosticReport,
  type DiagnosticSample
} from './performance-diagnostics'

export const LOCAL_DIAGNOSTIC_ANALYZER = 'local-rules/1.0.0'
export type DiagnosticLanguage = 'en' | 'it'
type Point = { t: number; value: number }
type Range = { startMs: number; endMs: number }

/** Approximate temporal coverage at the recorder's nominal one-second cadence.
 * Overlapping windows are merged: clustered samples cannot hide a long gap. */
function coverage(points: Point[], duration: number): number {
  if (!duration) return 0
  let covered = 0
  let end = 0
  for (const point of points) {
    const start = Math.max(0, point.t - 500)
    const next = Math.min(duration, point.t + 500)
    covered += Math.max(0, next - Math.max(start, end))
    end = Math.max(end, next)
  }
  return Math.min(1, covered / duration)
}

function highIntervals(
  samples: DiagnosticSample[],
  metric: 'cpuPercent' | 'memoryPercent',
  threshold: number
): Range[] {
  const ranges: Range[] = []
  let current: Range | null = null
  for (const sample of samples) {
    const value = sample[metric]
    if (value === null || value < threshold) {
      current = null
      continue
    }
    if (!current || sample.t - current.endMs > 1500) {
      current = { startMs: sample.t, endMs: sample.t }
      ranges.push(current)
    } else current.endMs = sample.t
  }
  return ranges.filter((range) => range.endMs - range.startMs >= 30000)
}

/** Deterministic analysis of already-recorded numeric samples. No I/O, model,
 * process-name attribution, device changes, or network access is performed. */
export function analyzeDiagnosticRecording(
  recording: DiagnosticRecording,
  language: DiagnosticLanguage,
  interrupted = false
): DiagnosticReport {
  if (!validDiagnosticRecording(recording)) throw new Error('Invalid diagnostic recording')
  if (language !== 'en' && language !== 'it') throw new Error('Invalid analysis language')
  const tr = (it: string, en: string) => (language === 'it' ? it : en)
  const n = (value: number) => value.toLocaleString(language, { maximumFractionDigits: 1 })
  const points = (metric: keyof Omit<DiagnosticSample, 't' | 'processes'>): Point[] =>
    recording.samples.flatMap((sample) =>
      sample[metric] === null ? [] : [{ t: sample.t, value: sample[metric] }]
    )
  const findings: DiagnosticReport['findings'] = []
  const limitations: string[] = []
  const cpu = points('cpuPercent')
  const memory = points('memoryPercent')
  const cpuCoverage = coverage(cpu, recording.durationMs)
  const memoryCoverage = coverage(memory, recording.durationMs)
  const sufficient = recording.durationMs >= 30000 && cpuCoverage >= 0.8 && memoryCoverage >= 0.8
  let sustained = false
  for (const [metric, values, threshold, label] of [
    ['cpuPercent', cpu, 85, 'CPU'],
    ['memoryPercent', memory, 90, tr('Memoria', 'Memory')]
  ] as const) {
    if (!values.length) continue
    const mean = values.reduce((sum, point) => sum + point.value, 0) / values.length
    const peak = values.reduce((highest, point) => (point.value > highest.value ? point : highest))
    const ranges = highIntervals(recording.samples, metric, threshold).sort(
      (a, b) => b.endMs - b.startMs - (a.endMs - a.startMs)
    )
    const longest = ranges[0]
    sustained ||= !!longest
    const metricCoverage = coverage(values, recording.durationMs)
    const evidence: DiagnosticReport['findings'][number]['evidence'] = longest
      ? [{ metric, ...longest }]
      : [{ metric, startMs: peak.t, endMs: peak.t }]
    if (longest && (peak.t < longest.startMs || peak.t > longest.endMs)) {
      evidence.push({ metric, startMs: peak.t, endMs: peak.t })
    }
    findings.push({
      title: longest
        ? tr(`${label}: utilizzo elevato sostenuto`, `${label}: sustained high usage`)
        : peak.value >= 95
          ? tr(`${label}: picco osservato`, `${label}: observed peak`)
          : tr(`${label}: utilizzo osservato`, `${label}: observed usage`),
      confidence: metricCoverage >= 0.8 && recording.durationMs >= 30000 ? 'high' : 'low',
      observation:
        tr(
          `Media dei campioni validi ${n(mean)}%, picco ${n(peak.value)}% a ${n(peak.t / 1000)} s. ${values.length} campioni validi; copertura temporale stimata ${n(metricCoverage * 100)}%.`,
          `Valid-sample mean ${n(mean)}%, peak ${n(peak.value)}% at ${n(peak.t / 1000)} s. ${values.length} valid samples; estimated temporal coverage ${n(metricCoverage * 100)}%.`
        ) +
        (longest
          ? tr(
              ` L'intervallo più lungo con valori almeno al ${threshold}% dura ${n((longest.endMs - longest.startMs) / 1000)} s (${n(longest.startMs / 1000)}–${n(longest.endMs / 1000)} s).`,
              ` The longest interval at or above ${threshold}% lasts ${n((longest.endMs - longest.startMs) / 1000)} s (${n(longest.startMs / 1000)}–${n(longest.endMs / 1000)} s).`
            )
          : tr(
              ` Non è documentato un intervallo continuo di almeno 30 s al ${threshold}% o superiore.`,
              ` No continuous interval of at least 30 s at or above ${threshold}% is documented.`
            )),
      interpretation:
        metric === 'cpuPercent'
          ? tr(
              'Questi valori descrivono il carico CPU aggregato. Un valore elevato può coincidere con il rallentamento, ma non identifica il processo responsabile né dimostra la causa. Un valore basso non esclude un singolo core occupato o attese di altro tipo.',
              'These values describe aggregate CPU load. High usage may coincide with a slowdown, but does not identify a responsible process or establish its cause. Low aggregate usage does not rule out one busy core or other waits.'
            )
          : tr(
              'La quota di memoria utilizzata non misura da sola la pressione sulla memoria. Cache, memoria disponibile e criteri del sistema operativo influenzano il valore; qui non sono misurati paging o attese.',
              'Used-memory percentage alone does not measure memory pressure. Caches, available memory and operating-system accounting affect this value; paging and waits are not measured here.'
            ),
      nextSteps: [
        tr(
          'Confronta gli intervalli indicati con il momento del rallentamento e ripeti la registrazione durante lo stesso carico di lavoro.',
          'Compare the indicated intervals with the slowdown and repeat the recording during the same workload.'
        )
      ],
      evidence
    })
  }

  const reads = points('diskReadBytesPerSec')
  const writes = points('diskWriteBytesPerSec')
  if (reads.length || writes.length) {
    const observations: string[] = []
    const evidence: DiagnosticReport['findings'][number]['evidence'] = []
    for (const [metric, values, label] of [
      ['diskReadBytesPerSec', reads, tr('Lettura', 'Read')],
      ['diskWriteBytesPerSec', writes, tr('Scrittura', 'Write')]
    ] as const) {
      if (!values.length) continue
      const peak = values.reduce((highest, point) =>
        point.value > highest.value ? point : highest
      )
      const mean = values.reduce((sum, point) => sum + point.value, 0) / values.length
      observations.push(
        tr(
          `${label}: media ${n(mean / 1024 ** 2)} MiB/s, picco ${n(peak.value / 1024 ** 2)} MiB/s a ${n(peak.t / 1000)} s (${values.length} misure valide).`,
          `${label}: mean ${n(mean / 1024 ** 2)} MiB/s, peak ${n(peak.value / 1024 ** 2)} MiB/s at ${n(peak.t / 1000)} s (${values.length} valid measurements).`
        )
      )
      evidence.push({ metric: metric as DiagnosticMetric, startMs: peak.t, endMs: peak.t })
    }
    findings.push({
      title: tr('Disco: trasferimenti osservati', 'Disk: observed transfers'),
      confidence: 'low',
      observation: observations.join(' '),
      interpretation: tr(
        'La velocità di trasferimento non indica la saturazione del disco. Senza latenza, coda delle richieste, tempo attivo e capacità del dispositivo non è possibile stabilire un collo di bottiglia.',
        'Transfer rate does not indicate disk saturation. Without latency, request queue, active time and device capacity, a disk bottleneck cannot be established.'
      ),
      nextSteps: [
        tr(
          'Se il rallentamento coincide con attività disco, confronta questi istanti con latenza e tempo attivo nel monitor del sistema operativo.',
          'If the slowdown coincides with disk activity, compare these times with latency and active time in the operating-system monitor.'
        )
      ],
      evidence
    })
  }
  limitations.push(
    tr(
      'Regole descrittive locali: soglie CPU 85%, memoria 90%, picco 95%; almeno 30 s per un carico sostenuto, interrotto da valori mancanti o intervalli tra campioni superiori a 1,5 s. Non sono soglie diagnostiche universali.',
      'Local descriptive rules: CPU 85%, memory 90%, peak 95%; sustained load requires at least 30 s, interrupted by missing values or sample gaps over 1.5 s. These are not universal diagnostic thresholds.'
    ),
    tr(
      `Copertura stimata rispetto a campioni ogni secondo: CPU ${n(cpuCoverage * 100)}%, memoria ${n(memoryCoverage * 100)}%. I valori mancanti non sono considerati zero; le medie descrivono solo i campioni disponibili.`,
      `Estimated coverage against one-second sampling: CPU ${n(cpuCoverage * 100)}%, memory ${n(memoryCoverage * 100)}%. Missing values are not treated as zero; means describe only available samples.`
    ),
    reads.length || writes.length
      ? tr(
          'Le misure disco vengono richieste circa ogni 5 s e possono mancare. Le medie sono dei punti disponibili, non rappresentano tutto l’intervallo né la capacità del disco.',
          'Disk measurements are requested roughly every 5 s and may be missing. Means describe available points, not the whole interval or disk capacity.'
        )
      : tr(
          'Nessuna misura disco disponibile: il disco non è valutabile.',
          'No disk measurements are available: disk activity cannot be assessed.'
        ),
    tr(
      'Questo rapporto non identifica cause certe e non esclude problemi di GPU, rete, temperatura, paging o reattività. I nomi dei processi non vengono usati per attribuire responsabilità.',
      'This report does not establish causes or rule out GPU, network, temperature, paging or responsiveness problems. Process names are not used to attribute responsibility.'
    )
  )
  if (!sufficient)
    limitations.push(
      tr(
        'Dati insufficienti per una valutazione complessiva: servono almeno 30 s e copertura CPU e memoria pari ad almeno l’80%. Ripeti la registrazione durante il rallentamento.',
        'Insufficient data for an overall assessment: at least 30 s and 80% CPU and memory coverage are needed. Repeat the recording during the slowdown.'
      )
    )
  if (interrupted)
    limitations.push(
      tr(
        'Registrazione interrotta: sono disponibili solo i campioni dell’ultimo salvataggio. La parte successiva non è stata analizzata.',
        'Interrupted recording: only the last saved checkpoint is available. The later portion was not analyzed.'
      )
    )
  return {
    version: 1,
    source: 'local',
    language,
    analyzerVersion: LOCAL_DIAGNOSTIC_ANALYZER,
    generatedAt: new Date().toISOString(),
    summary:
      tr(
        `Analizzati localmente ${recording.samples.length} campioni in ${n(recording.durationMs / 1000)} s. `,
        `Locally analyzed ${recording.samples.length} samples across ${n(recording.durationMs / 1000)} s. `
      ) +
      (sustained
        ? tr(
            'È documentato un utilizzo elevato sostenuto; confronta gli intervalli con il rallentamento.',
            'Sustained high usage is documented; compare the intervals with the slowdown.'
          )
        : sufficient
          ? tr(
              'Non emergono intervalli di utilizzo elevato sostenuto secondo queste regole. Questo non esclude un rallentamento.',
              'No sustained high-usage intervals meet these rules. This does not rule out a slowdown.'
            )
          : tr(
              'Dati insufficienti per una valutazione complessiva: le osservazioni disponibili sono riportate con i loro limiti.',
              'There is insufficient data for an overall assessment; available observations are reported with their limitations.'
            )),
    findings,
    limitations
  }
}
