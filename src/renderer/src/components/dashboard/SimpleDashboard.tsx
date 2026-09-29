import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Card'
import { Tag } from '@/components/ui/Tag'
import { nextSegmentIndex } from '@/components/ui/segmented-keys'
import { usePlatform } from '@/hooks/usePlatform'
import { GOALS, stepStates, type Goal, type StepState } from '@/lib/goals'
import { icons } from '@/lib/icons'
import { navLabel, navLeafFor } from '@/lib/navigation'
import { formatBytes } from '@/lib/utils'
import { ScanStatus } from '@shared/enums'
import { useDrivesStore } from '@/stores/drives-store'
import { useHistoryStore } from '@/stores/history-store'
import { useMalwareStore } from '@/stores/malware-store'
import { useScanStore } from '@/stores/scan-store'
import { useUpdaterStore } from '@/stores/updater-store'
import { useHomeChecks, useNow } from './home-checks'
import { useAnalyzeAndClean } from './quick-clean'
import { driveName, formatWhen } from './when'
import './simple-dashboard.css'

const GOAL_ICONS = {
  space: icons.storage,
  speed: icons.performance,
  protection: icons.protection
} as const

/** The scope sentence of each tool, in the dashboard namespace. */
const TOOL_KEYS: Record<string, string> = {
  '/cleaner': 'cleaner',
  '/large-files': 'largeFiles',
  '/duplicates': 'duplicates',
  '/empty-folders': 'emptyFolders',
  '/disk': 'disk',
  '/startup': 'startup',
  '/performance': 'performance',
  '/services': 'services',
  '/performance-diagnostics': 'diagnostics',
  '/malware': 'malware',
  '/privacy': 'privacy',
  '/firewall': 'firewall',
  '/updates': 'updates'
}

// The chosen goal survives a visit to a tool and back.
let lastGoal: Goal = 'space'

/** The simple Home: pick a goal, follow its tools in order, each with its real state (spec 5.3). */
export function SimpleDashboard({
  onAdvanced,
  switching
}: {
  onAdvanced: () => void
  switching: boolean
}) {
  const { t, i18n } = useTranslation('dashboard')
  const navigate = useNavigate()
  const { features } = usePlatform()
  const now = useNow()
  const history = useHistoryStore((s) => s.entries)
  const refreshDrives = useDrivesStore((s) => s.refresh)
  const { inputs } = useHomeChecks()
  const analyze = useAnalyzeAndClean()
  const [goal, setGoal] = useState<Goal>(lastGoal)
  const goalRefs = useRef<(HTMLButtonElement | null)[]>([])
  const locale = i18n.language || 'en'

  useEffect(() => {
    void refreshDrives()
  }, [refreshDrives])

  const choose = (next: Goal) => {
    lastGoal = next
    setGoal(next)
  }

  const onGoalKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const dir = getComputedStyle(event.currentTarget).direction === 'rtl' ? 'rtl' : 'ltr'
    const next = nextSegmentIndex(event.key, index, GOALS.length, dir)
    if (next === null) return
    event.preventDefault()
    goalRefs.current[next]?.focus()
    choose(GOALS[next])
  }

  const steps = stepStates(goal, history, inputs, now, features)
  const pathId = 'simple-goal-path'

  return (
    <div className="simple-home">
      <PageHeader title={t('simple.title')} description={t('simple.lead')} />
      <div className="simple-goals" role="radiogroup" aria-label={t('simple.goalLabel')}>
        {GOALS.map((id, index) => {
          const Icon = GOAL_ICONS[id]
          const checked = goal === id
          return (
            <button
              key={id}
              ref={(element) => {
                goalRefs.current[index] = element
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-controls={pathId}
              tabIndex={checked ? 0 : -1}
              className="simple-goal"
              onClick={() => choose(id)}
              onKeyDown={(event) => onGoalKey(event, index)}
            >
              <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
              {t(`simple.goals.${id}`)}
            </button>
          )
        })}
      </div>
      <Section id={pathId} title={t(`simple.paths.${goal}`)} className="simple-path">
        <ol className="simple-steps">
          {steps.map((step, index) => (
            <GoalStep
              key={step.path}
              step={step}
              index={index}
              now={now}
              locale={locale}
              onAnalyze={analyze}
            />
          ))}
        </ol>
      </Section>
      <footer className="simple-links">
        <span>
          {t('simple.scheduleLead')}{' '}
          <button type="button" className="simple-link" onClick={() => navigate('/schedules')}>
            {t('simple.schedule')}
          </button>
        </span>
        <span>
          {t('simple.recoveryLead')}{' '}
          <button type="button" className="simple-link" onClick={() => navigate('/recovery')}>
            {t('simple.recovery')}
          </button>
        </span>
        <button type="button" className="simple-link" disabled={switching} onClick={onAdvanced}>
          {t('simple.advanced')}
        </button>
      </footer>
    </div>
  )
}

function GoalStep({
  step,
  index,
  now,
  locale,
  onAnalyze
}: {
  step: StepState
  index: number
  now: number
  locale: string
  onAnalyze: () => void
}) {
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()
  const drives = useDrivesStore((s) => s.drives)
  const scanStatus = useScanStore((s) => s.status)
  const scanResults = useScanStore((s) => s.results)
  const cleanSummary = useScanStore((s) => s.cleanSummary)
  // "No updates" only when every package manager answered the check.
  const updatesVerified = useUpdaterStore(
    (s) => s.hasChecked && s.packageManagerAvailable && !s.managers.some((m) => m.error)
  )
  const pendingUpdates = useUpdaterStore((s) => s.apps.length)
  const lastScan = useMalwareStore((s) => s.lastCompletedScan)
  const restoredThreats = useMalwareStore((s) => s.knownActiveThreats)
  const leaf = navLeafFor(step.path)
  const title = leaf ? navLabel(t, leaf) : step.path
  const when = step.lastRun === null ? '' : formatWhen(step.lastRun, now, locale)
  const systemDrive = drives.find((drive) => drive.isSystem) ?? drives[0]
  const openThreats = (lastScan?.unresolvedThreats ?? 0) + restoredThreats

  const status =
    step.reason === 'pending'
      ? t('simple.status.pending', { count: pendingUpdates })
      : step.reason === 'threats'
        ? t('simple.status.threats', { count: openThreats })
        : step.status === 'never' || step.reason === 'never'
          ? t('simple.status.never')
          : when
            ? t('simple.status.lastRun', { when })
            : ''

  const data = (() => {
    const free = systemDrive
      ? t('simple.data.free', {
          drive: driveName({ letter: systemDrive.letter, label: '' }),
          size: formatBytes(systemDrive.freeSpace)
        })
      : ''
    const found = scanResults.reduce((sum, result) => sum + result.totalSize, 0)
    const analysed = scanStatus === ScanStatus.Complete && !cleanSummary && found > 0
    // Free space is said once: on the cleanup step, or on the storage step when the
    // cleanup step already reports this session's analysis.
    switch (step.path) {
      case '/cleaner':
        return analysed ? t('simple.data.analysis', { size: formatBytes(found) }) : free
      case '/disk':
        return analysed ? free : ''
      case '/updates':
        return updatesVerified && pendingUpdates === 0 ? t('simple.data.noUpdates') : ''
      case '/malware':
        return lastScan && openThreats === 0 ? t('simple.data.noThreats') : ''
      default:
        return ''
    }
  })()

  const detail = [t(`simple.tools.${TOOL_KEYS[step.path] ?? 'cleaner'}`), status, data]
    .filter(Boolean)
    .join(' ')
  const recommended = step.status === 'recommended'
  const primaryLabel = step.path === '/cleaner' ? t('simple.analyze') : t('simple.open')
  const label = step.marked ? primaryLabel : t('simple.open')

  return (
    <li className="simple-step" data-status={step.status}>
      <span className="simple-step-dot" data-status={step.status} aria-hidden="true">
        {step.status === 'done' ? <Check size={12} strokeWidth={2} /> : index + 1}
      </span>
      <div className="simple-step-text">
        <p className="simple-step-title">
          <span>{title}</span>
          {recommended && <Tag tone="recommended">{t('simple.recommended')}</Tag>}
        </p>
        <p className="simple-step-detail">{detail}</p>
      </div>
      <Button
        variant={step.marked ? 'primary' : 'ghost'}
        aria-label={`${label} · ${title}`}
        onClick={() =>
          step.marked && step.path === '/cleaner' ? onAnalyze() : navigate(step.path)
        }
      >
        {label}
      </Button>
    </li>
  )
}
