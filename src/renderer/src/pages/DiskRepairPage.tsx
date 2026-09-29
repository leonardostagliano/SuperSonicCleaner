import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import type { DiskRepairResult } from '@shared/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button, ProgressBar, Section, Tag } from '@/components/ui'
import { usePlatform } from '@/hooks/usePlatform'
import { icons } from '@/lib/icons'
import { progressText } from '@/lib/progress-label'
import { formatPercent } from '@/lib/storage-tools-format'
import { RUN_KEY, repairOutcome, type RepairTool } from '@/lib/repair-view'
import { useDiskStore } from '@/stores/disk-store'

/** The command-line name of each tool, as Windows writes it. */
const TOOL_NAME: Record<RepairTool, string> = { dism: 'DISM', sfc: 'SFC', chkdsk: 'CHKDSK' }

export function DiskRepairPage() {
  const { t } = useTranslation('disk')
  const { platform } = usePlatform()
  const repairRunning = useDiskStore((s) => s.repairRunning)
  const store = useDiskStore()

  const run = async (tool: RepairTool) => {
    const name = TOOL_NAME[tool]
    const setResult = {
      sfc: store.setSfcResult,
      dism: store.setDismResult,
      chkdsk: store.setChkdskResult
    }[tool]
    store.setRepairRunning(true)
    setResult(null)
    store.setRepairProgress({
      tool,
      phase: 'running',
      percent: 0,
      message: { key: 'disk:repairProgress.starting', params: { tool: name } }
    })
    try {
      const result =
        tool === 'sfc'
          ? await window.kudu.diskRepairSfc('C')
          : tool === 'dism'
            ? await window.kudu.diskRepairDism()
            : await window.kudu.diskRepairChkdsk('C')
      setResult(result)
      const description = progressText(t, result.summary)
      const outcome = repairOutcome(result)
      if (outcome === 'ok') toast.success(t('repairToastDone', { tool: name }), { description })
      else if (outcome === 'blocked') toast.error(t('adminRequiredToast'), { description })
      else toast.error(t('repairToastIssues', { tool: name }), { description })
    } catch (err) {
      console.error(`${name} failed:`, err)
      toast.error(t('repairToastFailed', { tool: name }))
    }
    store.setRepairRunning(false)
    store.setRepairProgress(null)
  }

  if (platform !== 'win32') {
    return (
      <div className="flex flex-col gap-3">
        <PageHeader title={t('repairTitle')} description={t('repairDescription')} />
        <EmptyState
          icon={icons.repair}
          title={t('repairWindowsOnlyTitle')}
          description={t('repairWindowsOnlyDescription')}
        />
      </div>
    )
  }

  const stage = (tool: RepairTool, index?: number) => (
    <RepairStage
      key={tool}
      tool={tool}
      index={index}
      disabled={repairRunning}
      onRun={() => void run(tool)}
    />
  )

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={t('repairTitle')} description={t('repairDescription')} />
      <Section title={t('repairSystemFilesTitle')}>
        <p className="-mt-1 mb-2 max-w-[68ch] text-[length:var(--text-13)] text-[var(--text-secondary)]">
          {t('repairOrderNote')}
        </p>
        <ol className="m-0 list-none p-0">
          {stage('dism', 1)}
          {stage('sfc', 2)}
        </ol>
      </Section>
      <Section title={t('repairFileSystemTitle')}>
        <ol className="m-0 list-none p-0">{stage('chkdsk')}</ol>
      </Section>
    </div>
  )
}

interface RepairStageProps {
  tool: RepairTool
  /** Position in the recommended order; the file-system check has none. */
  index?: number
  disabled: boolean
  onRun: () => void
}

/** One tool as a stage: what it does, its state in this session, and its run button. */
function RepairStage({ tool, index, disabled, onRun }: RepairStageProps) {
  const { t, i18n } = useTranslation('disk')
  const progress = useDiskStore((s) => (s.repairProgress?.tool === tool ? s.repairProgress : null))
  const result = useDiskStore((s) =>
    tool === 'sfc' ? s.sfcResult : tool === 'dism' ? s.dismResult : s.chkdskResult
  )
  const [showLog, setShowLog] = useState(false)
  const running = disabled && progress !== null
  const name = TOOL_NAME[tool]
  const percent = progress && progress.percent > 0 ? progress.percent / 100 : undefined

  return (
    <li className="flex items-start gap-3 border-t border-[var(--border-default)] py-3 first:border-t-0 first:pt-1 last:pb-0">
      {index !== undefined && (
        <span
          className="w-4 shrink-0 pt-px text-[length:var(--text-13)] font-semibold text-[var(--text-muted)] tabular-nums"
          aria-hidden="true"
        >
          {index}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="m-0 text-[length:var(--text-13)] font-semibold text-[var(--text-primary)]">
          {t(`${tool}CardTitle`)}
        </h3>
        <p className="m-0 mt-0.5 max-w-[68ch] text-[length:var(--text-13)] text-[var(--text-secondary)]">
          {t(`${tool}CardDescription`)}
        </p>
        <div className="mt-2">
          {running ? (
            <div className="flex max-w-md flex-col gap-2">
              <p className="m-0 text-[length:var(--text-12)] text-[var(--text-secondary)] tabular-nums">
                {percent === undefined
                  ? t('repairStageStarting')
                  : t('repairStageRunning', { percent: formatPercent(percent, i18n.language) })}
              </p>
              <ProgressBar
                label={t('repairProgressLabel', { tool: name })}
                value={percent}
                indeterminate={percent === undefined}
              />
            </div>
          ) : result ? (
            <RepairResultLine
              result={result}
              showLog={showLog}
              onToggleLog={() => setShowLog((v) => !v)}
            />
          ) : (
            <p className="m-0 text-[length:var(--text-12)] text-[var(--text-muted)]">
              {t('repairStageNotRun')}
            </p>
          )}
        </div>
      </div>
      <Button className="shrink-0" busy={running} disabled={disabled} onClick={onRun}>
        {t(RUN_KEY[tool])}
      </Button>
    </li>
  )
}

function RepairResultLine({
  result,
  showLog,
  onToggleLog
}: {
  result: DiskRepairResult
  showLog: boolean
  onToggleLog: () => void
}) {
  const { t } = useTranslation('disk')
  const outcome = repairOutcome(result)
  return (
    <div className="flex flex-col gap-1.5">
      <p className="m-0 text-[length:var(--text-13)] text-[var(--text-secondary)]">
        {outcome === 'ok' ? (
          <Tag tone="ok">{t('repairStateDone')}</Tag>
        ) : outcome === 'failed' ? (
          <Tag tone="danger">{t('repairStateFailed')}</Tag>
        ) : (
          <Tag tone="neutral">{t('repairStateNotStarted')}</Tag>
        )}{' '}
        · {progressText(t, result.summary)}
      </p>
      {result.requiresReboot && (
        <p className="m-0 flex items-center gap-1.5 text-[length:var(--text-12)] text-[var(--text-secondary)]">
          <AlertTriangle size={14} strokeWidth={1.75} aria-hidden="true" />
          {t('restartRecommended')}
        </p>
      )}
      {result.log && (
        <div>
          <Button variant="ghost" onClick={onToggleLog} aria-expanded={showLog}>
            {showLog ? t('hideLog') : t('showLog')}
          </Button>
          {showLog && (
            <pre className="mt-2 max-h-48 overflow-auto rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--bg-subtle)] p-3 font-mono text-[length:var(--text-12)] whitespace-pre-wrap text-[var(--text-muted)]">
              {result.log}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
