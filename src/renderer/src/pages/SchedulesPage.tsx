import { ScheduleOptions, ScheduleScope } from '@/components/schedules/ScheduleOptions'
import {
  scheduleDefinition,
  validateScheduleConditions,
  type ScheduleConditions,
  type ScheduleRuntime
} from '@shared/schedule-policy'
import { useState, useMemo, useEffect, useRef, useId } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AppWindow,
  Copy,
  DatabaseZap,
  Gamepad2,
  Globe,
  Monitor,
  Pencil,
  Plus,
  Trash2,
  X,
  type LucideIcon
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { ReportNotice } from '@/components/cleaner/ReportNotice'
import '@/components/cleaner/pulizia.css'
import { Button, Checkbox, ListRow, Section, Switch, Tag } from '@/components/ui'
import { icons } from '@/lib/icons'
import { formatList } from '@/lib/cleaner-report'
import { useSettingsStore } from '@/stores/settings-store'
import { usePlatform } from '@/hooks/usePlatform'
import type { ScheduleEntry, ScheduleTaskType } from '@shared/types'
import { getNextRunTime } from './schedules-utils'

// ─── Constants ────────────────────────────────────────────

const DAY_NAME_KEYS = [
  'dayNames.sunday',
  'dayNames.monday',
  'dayNames.tuesday',
  'dayNames.wednesday',
  'dayNames.thursday',
  'dayNames.friday',
  'dayNames.saturday'
]

const MAX_SCHEDULES = 10

type Translate = (key: string, opts?: Record<string, unknown>) => string

interface TaskDef {
  type: ScheduleTaskType
  label: string
  icon: LucideIcon
  group: 'cleaner' | 'maintenance'
  /** Platform feature flag — task is hidden when this feature is false */
  requiresFeature?: 'registry' | 'drivers'
}

const ALL_TASKS_BASE: Array<Omit<TaskDef, 'label'> & { labelKey: string }> = [
  { type: 'cleaner:system', labelKey: 'tasks.system', icon: Monitor, group: 'cleaner' },
  { type: 'cleaner:browsers', labelKey: 'tasks.browsers', icon: Globe, group: 'cleaner' },
  { type: 'cleaner:apps', labelKey: 'tasks.applications', icon: AppWindow, group: 'cleaner' },
  { type: 'cleaner:gaming', labelKey: 'tasks.gaming', icon: Gamepad2, group: 'cleaner' },
  { type: 'cleaner:recycleBin', labelKey: 'tasks.recycleBin', icon: Trash2, group: 'cleaner' },
  { type: 'cleaner:databases', labelKey: 'tasks.databases', icon: DatabaseZap, group: 'cleaner' },
  {
    type: 'registry',
    labelKey: 'tasks.registryFixes',
    icon: icons.registry,
    group: 'maintenance',
    requiresFeature: 'registry'
  },
  {
    type: 'drivers',
    labelKey: 'tasks.driverUpdates',
    icon: icons.drivers,
    group: 'maintenance',
    requiresFeature: 'drivers'
  },
  {
    type: 'software-update',
    labelKey: 'tasks.softwareUpdates',
    icon: icons.updates,
    group: 'maintenance'
  }
]

function useAllTasks(): TaskDef[] {
  const { t } = useTranslation('schedules')
  return useMemo(() => ALL_TASKS_BASE.map((task) => ({ ...task, label: t(task.labelKey) })), [t])
}

/** Filter tasks to only those available on the current platform */
function usePlatformTasks(): TaskDef[] {
  const { features } = usePlatform()
  const allTasks = useAllTasks()
  return useMemo(
    () => allTasks.filter((task) => !task.requiresFeature || features[task.requiresFeature]),
    [allTasks, features]
  )
}

const CLEANER_TASKS = ALL_TASKS_BASE.filter((t) => t.group === 'cleaner').map((t) => t.type)

interface Preset {
  label: string
  description: string
  entry: Partial<ScheduleEntry>
}

function buildPresets(availableTasks: TaskDef[], t: (key: string) => string): Preset[] {
  const allTypes = availableTasks.map((task) => task.type)
  return [
    {
      label: t('presets.weeklyFullCleanLabel'),
      description: t('presets.weeklyFullCleanDescription'),
      entry: {
        name: t('presets.weeklyFullCleanLabel'),
        frequency: 'weekly',
        day: 1,
        hour: 9,
        minute: 0,
        tasks: [...CLEANER_TASKS],
        autoApply: true
      }
    },
    {
      label: t('presets.dailyLightSweepLabel'),
      description: t('presets.dailyLightSweepDescription'),
      entry: {
        name: t('presets.dailyLightSweepLabel'),
        frequency: 'daily',
        day: 0,
        hour: 8,
        minute: 0,
        tasks: ['cleaner:system', 'cleaner:browsers', 'cleaner:recycleBin'],
        autoApply: true
      }
    },
    {
      label: t('presets.monthlyDeepMaintenanceLabel'),
      description: t('presets.monthlyDeepMaintenanceDescription'),
      entry: {
        name: t('presets.monthlyDeepMaintenanceLabel'),
        frequency: 'monthly',
        day: 1,
        hour: 10,
        minute: 0,
        tasks: [...allTypes],
        autoApply: true
      }
    }
  ]
}

function makeBlankEntry(): Partial<ScheduleEntry> {
  return {
    name: '',
    frequency: 'weekly',
    day: 1,
    hour: 9,
    minute: 0,
    tasks: [...CLEANER_TASKS],
    autoApply: false
  }
}

// ─── Main Page ────────────────────────────────────────────

export function SchedulesPage() {
  const { t, i18n } = useTranslation('schedules')
  const { settings, updateSettings } = useSettingsStore()
  const platformTasks = usePlatformTasks()
  const { isPortable } = usePlatform()
  const presets = useMemo(() => buildPresets(platformTasks, t), [platformTasks, t])
  const schedules = settings.schedules ?? []
  const [runtime, setRuntime] = useState<ScheduleRuntime[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  useEffect(() => {
    let mounted = true
    const refresh = () =>
      window.kudu
        .scheduleRuntime()
        .then((value) => {
          if (mounted) setRuntime(value)
        })
        .catch(() => {})
    void refresh()
    const timer = setInterval(() => void refresh(), 15_000)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [])

  const save = async (updated: ScheduleEntry[]) => {
    try {
      await window.kudu.settingsSet({ schedules: updated })
      const persisted = await window.kudu.settingsGet()
      if (
        JSON.stringify(persisted.schedules.map(scheduleDefinition)) !==
        JSON.stringify(updated.map(scheduleDefinition))
      )
        throw new Error(t('advanced.saveFailed'))
      updateSettings({ schedules: persisted.schedules })
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('advanced.saveFailed'))
      return false
    }
  }

  // Ensure startup + tray when any schedule is enabled
  const ensureBackgroundMode = () => {
    if (!isPortable && !settings.runAtStartup) {
      updateSettings({ runAtStartup: true })
      window.kudu?.settingsSet?.({ runAtStartup: true }).catch(() => {})
      window.kudu?.applyStartup?.(true).catch(() => {
        updateSettings({ runAtStartup: false })
        window.kudu?.settingsSet?.({ runAtStartup: false }).catch(() => {})
        toast.error(t('failedEnableStartup'), {
          action: {
            label: t('failedEnableStartupAction'),
            onClick: () =>
              window.open(
                'https://github.com/leonardostagliano/SuperSonicCleaner/blob/main/RELEASE.md#startup-troubleshooting',
                '_blank'
              )
          }
        })
      })
    }
    if (!settings.minimizeToTray) {
      updateSettings({ minimizeToTray: true })
      window.kudu?.settingsSet?.({ minimizeToTray: true }).catch(() => {})
      window.kudu?.applyTray?.(true)
    }
  }

  const [showDialog, setShowDialog] = useState(false)
  const [showPresets, setShowPresets] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const handleNew = () => {
    if (schedules.length >= MAX_SCHEDULES) {
      toast.error(t('maxSchedulesReached', { max: MAX_SCHEDULES }))
      return
    }
    setEditingId(null)
    setShowPresets(true)
  }

  const handlePresetSelect = (preset: Partial<ScheduleEntry> | null) => {
    setShowPresets(false)
    setEditingId(null)
    setShowDialog(true)
    // The dialog will pick up the preset via initialData
    setDialogInitial(preset ?? makeBlankEntry())
  }

  const handleEdit = (id: string) => {
    const entry = schedules.find((s) => s.id === id)
    if (!entry) return
    setDialogInitial(entry)
    setEditingId(id)
    setShowDialog(true)
  }

  const handleDuplicate = async (id: string) => {
    if (schedules.length >= MAX_SCHEDULES) {
      toast.error(t('maxSchedulesReached', { max: MAX_SCHEDULES }))
      return
    }
    const entry = schedules.find((s) => s.id === id)
    if (!entry) return
    const dup: ScheduleEntry = {
      ...entry,
      id: crypto.randomUUID(),
      name: `${entry.name} ${t('copyNameSuffix')}`,
      lastDueAt: null,
      lastRunAt: null,
      lastRunStatus: 'never',
      createdAt: new Date().toISOString()
    }
    if (!(await save([...schedules, dup]))) return
    toast.success(t('duplicatedToast', { name: entry.name }))
  }

  const handleDelete = async () => {
    if (!deleteId) return
    const entry = schedules.find((s) => s.id === deleteId)
    if (!(await save(schedules.filter((s) => s.id !== deleteId)))) return
    setDeleteId(null)
    if (entry) toast.success(t('deletedToast', { name: entry.name }))
  }

  const handleToggle = async (id: string, enabled: boolean) => {
    if (!(await save(schedules.map((s) => (s.id === id ? { ...s, enabled } : s))))) return
    if (enabled) ensureBackgroundMode()
  }

  const handleSave = async (entry: ScheduleEntry) => {
    if (editingId) {
      if (!(await save(schedules.map((s) => (s.id === editingId ? entry : s))))) return
    } else {
      if (!(await save([...schedules, entry]))) return
    }
    if (entry.enabled) ensureBackgroundMode()
    setShowDialog(false)
    setEditingId(null)
    toast.success(
      editingId ? t('updatedToast', { name: entry.name }) : t('createdToast', { name: entry.name })
    )
  }

  const upcoming = schedules
    .flatMap((entry) => {
      const date = getNextRunTime(entry)
      return date ? [{ entry, date }] : []
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 3)
  const enabledCount = schedules.filter((entry) => entry.enabled).length
  const [dialogInitial, setDialogInitial] = useState<Partial<ScheduleEntry>>(makeBlankEntry())
  const deleteEntry = schedules.find((s) => s.id === deleteId)
  const runEntry = schedules.find((s) => s.id === runId)

  return (
    <div className="pulizia-page">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageScope')}
        action={
          <Button variant="primary" size="lg" icon={Plus} onClick={handleNew}>
            {t('newScheduleButton')}
          </Button>
        }
      />

      {upcoming.length > 0 && (
        <Section title={t('upcomingTitle')} meta={t('enabledCount', { count: enabledCount })}>
          <div>
            {upcoming.map(({ entry, date }) => (
              <ListRow key={entry.id}>
                <span className="pulizia-when">{formatWhen(date, i18n.language)}</span>
                <span className="pulizia-app-name">{entry.name}</span>
              </ListRow>
            ))}
          </div>
          <p className="pulizia-footnote">{t('upcomingNote')}</p>
        </Section>
      )}

      {schedules.length === 0 ? (
        <EmptyState title={t('emptyStateTitle')} description={t('emptyStateDescription')} />
      ) : (
        <Section
          title={t('listTitle')}
          meta={t('listMeta', { count: schedules.length, max: MAX_SCHEDULES })}
        >
          <div className="pulizia-schedules">
            {schedules.map((entry) => (
              <ScheduleRow
                key={entry.id}
                entry={entry}
                runtime={runtime.find((r) => r.id === entry.id)}
                onRun={() => setRunId(entry.id)}
                onToggle={(enabled) => handleToggle(entry.id, enabled)}
                onEdit={() => handleEdit(entry.id)}
                onDuplicate={() => handleDuplicate(entry.id)}
                onDelete={() => setDeleteId(entry.id)}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Preset picker */}
      {showPresets && (
        <PresetPicker
          presets={presets}
          onSelect={handlePresetSelect}
          onClose={() => setShowPresets(false)}
        />
      )}

      {/* Schedule editor dialog */}
      {showDialog && (
        <ScheduleDialog
          initial={dialogInitial}
          isEditing={!!editingId}
          availableTasks={platformTasks}
          onSave={handleSave}
          onClose={() => {
            setShowDialog(false)
            setEditingId(null)
          }}
        />
      )}

      <ConfirmDialog
        open={!!runId}
        title={t('advanced.runTitle', { name: runEntry?.name ?? '' })}
        description={t('advanced.runConfirm')}
        confirmLabel={t('advanced.runNow')}
        onCancel={() => setRunId(null)}
        onConfirm={() => {
          const id = runId!
          setRunId(null)
          void window.kudu
            .scheduleRunNow(id)
            .then((state) => {
              if (state) setRuntime((previous) => [...previous.filter((r) => r.id !== id), state])
              if (state?.reason) toast.info(t('advanced.waiting.' + state.reason))
            })
            .catch((error) =>
              toast.error(error instanceof Error ? error.message : t('advanced.runFailed'))
            )
        }}
      />
      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteId}
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
        title={t('deleteConfirmTitle', { name: deleteEntry?.name ?? '' })}
        description={t('deleteConfirmDescription')}
        confirmLabel={t('deleteConfirmLabel')}
        variant="danger"
      />
    </div>
  )
}

// ─── Schedule row ─────────────────────────────────────────

function ScheduleRow({
  entry,
  runtime,
  onRun,
  onToggle,
  onEdit,
  onDuplicate,
  onDelete
}: {
  entry: ScheduleEntry
  runtime?: ScheduleRuntime
  onRun: () => void
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const { t, i18n } = useTranslation('schedules')
  const allTasks = useAllTasks()
  const nextRun = useMemo(() => getNextRunTime(entry), [entry])
  const frequencyText = useMemo(() => formatFrequency(entry, t), [entry, t])
  const taskNames = entry.tasks
    .map((type) => allTasks.find((d) => d.type === type)?.label)
    .filter((label): label is string => !!label)

  const lastRun = entry.lastRunAt
    ? t('card.lastRun', { time: formatLastRun(entry.lastRunAt, t, i18n.language) })
    : t('card.neverRun')
  const status =
    entry.lastRunStatus === 'success' ? (
      <Tag tone="ok">{t('card.statusSuccess')}</Tag>
    ) : entry.lastRunStatus === 'partial' ? (
      <Tag tone="neutral">{t('card.statusPartial')}</Tag>
    ) : entry.lastRunStatus === 'failed' ? (
      <Tag tone="danger">{t('card.statusFailed')}</Tag>
    ) : entry.lastRunStatus === 'skipped' ? (
      <Tag tone="neutral">{t('advanced.skipped')}</Tag>
    ) : null

  return (
    <article className="pulizia-schedule" aria-label={entry.name}>
      <div className="pulizia-schedule-head">
        <div className="pulizia-schedule-title">
          <h3 className="pulizia-app-name">{entry.name}</h3>
          {entry.autoApply && <Tag tone="neutral">{t('card.autoApplyBadge')}</Tag>}
        </div>
        <span className="pulizia-switch">
          <Switch
            checked={entry.enabled}
            onChange={onToggle}
            label={t('card.enabledLabel', { name: entry.name })}
          />
          <span>{entry.enabled ? t('card.enabled') : t('card.disabled')}</span>
        </span>
      </div>
      <p className="pulizia-summary-meta">
        {frequencyText}
        {' · '}
        {taskNames.length > 0 ? formatList(taskNames, i18n.language) : t('card.noTasksSelected')}
      </p>
      <p className="pulizia-app-meta">
        {entry.enabled && nextRun && (
          <>
            {t('card.nextRun', { time: formatNextRun(nextRun, t, i18n.language) })}
            {' · '}
          </>
        )}
        {lastRun}
        {status && <> {status}</>}
      </p>
      {(runtime?.running || runtime?.reason) && (
        <p className="pulizia-app-meta" role="status">
          {runtime.running ? t('advanced.running') : t('advanced.waiting.' + runtime.reason)}
          {runtime.reason &&
            ` · ${t('advanced.nextEvaluation', {
              time: new Date(runtime.nextEvaluationAt).toLocaleTimeString(i18n.language, {
                hour: '2-digit',
                minute: '2-digit'
              })
            })}`}
        </p>
      )}
      <div className="pulizia-schedule-actions">
        <Button disabled={!entry.enabled || runtime?.running} onClick={onRun}>
          {t('advanced.runNow')}
        </Button>
        <Button
          variant="ghost"
          icon={Pencil}
          onClick={onEdit}
          title={t('card.editAction')}
          aria-label={t('card.editAction')}
        />
        <Button
          variant="ghost"
          icon={Copy}
          onClick={onDuplicate}
          title={t('card.duplicateAction')}
          aria-label={t('card.duplicateAction')}
        />
        <Button
          variant="ghost"
          icon={Trash2}
          onClick={onDelete}
          title={t('card.deleteAction')}
          aria-label={t('card.deleteAction')}
        />
      </div>
    </article>
  )
}

// ─── Dialog shell ─────────────────────────────────────────

function useScheduleDialogFocus(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]'
        ) ?? []
      ).filter((el) => el.getClientRects().length > 0)
    focusable()[0]?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const nodes = focusable(),
        first = nodes[0],
        last = nodes.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      previous?.focus()
    }
  }, [])
  return ref
}

function DialogShell({
  title,
  onClose,
  wide,
  children,
  footer
}: {
  title: string
  onClose: () => void
  wide?: boolean
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  const { t } = useTranslation('schedules')
  const dialogRef = useScheduleDialogFocus(onClose)
  const titleId = useId()
  return (
    <div className="ui-dialog-layer">
      <div className="ui-dialog-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={wide ? 'ui-dialog pulizia-dialog-wide' : 'ui-dialog'}
      >
        <div className="pulizia-dialog-head">
          <h2 id={titleId} className="ui-dialog-title">
            {title}
          </h2>
          <Button
            variant="ghost"
            icon={X}
            onClick={onClose}
            aria-label={t('dialog.close')}
            title={t('dialog.close')}
          />
        </div>
        {children}
        {footer && <div className="ui-dialog-actions">{footer}</div>}
      </div>
    </div>
  )
}

// ─── Preset Picker Dialog ─────────────────────────────────

function PresetPicker({
  presets,
  onSelect,
  onClose
}: {
  presets: Preset[]
  onSelect: (preset: Partial<ScheduleEntry> | null) => void
  onClose: () => void
}) {
  const { t } = useTranslation('schedules')
  return (
    <DialogShell title={t('presets.dialogTitle')} onClose={onClose}>
      <div className="pulizia-choices">
        {presets.map((preset) => (
          <button
            type="button"
            key={preset.label}
            onClick={() => onSelect(preset.entry)}
            className="pulizia-choice"
          >
            <span className="pulizia-app-name">{preset.label}</span>
            <span className="pulizia-app-meta">{preset.description}</span>
          </button>
        ))}
        <button type="button" onClick={() => onSelect(null)} className="pulizia-choice">
          <span className="pulizia-app-name">{t('presets.customLabel')}</span>
          <span className="pulizia-app-meta">{t('presets.customDescription')}</span>
        </button>
      </div>
    </DialogShell>
  )
}

// ─── Schedule Editor Dialog ───────────────────────────────

function ScheduleDialog({
  initial,
  isEditing,
  availableTasks,
  onSave,
  onClose
}: {
  initial: Partial<ScheduleEntry>
  isEditing: boolean
  availableTasks: TaskDef[]
  onSave: (entry: ScheduleEntry) => void
  onClose: () => void
}) {
  const { t } = useTranslation('schedules')
  const nameId = useId()
  const frequencyId = useId()
  const dayId = useId()
  const hourId = useId()
  const [name, setName] = useState(initial.name ?? '')
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>(
    initial.frequency ?? 'weekly'
  )
  const [day, setDay] = useState(initial.day ?? 1)
  const [hour, setHour] = useState(initial.hour ?? 9)
  const [minute, setMinute] = useState(initial.minute ?? 0)
  const [tasks, setTasks] = useState<ScheduleTaskType[]>(initial.tasks ?? [...CLEANER_TASKS])
  const [autoApply, setAutoApply] = useState(initial.autoApply ?? false)
  const [conditions, setConditions] = useState<ScheduleConditions>(
    initial.conditions ?? { pauseForGameMode: true, acOnly: !isEditing }
  )
  const [missedRun, setMissedRun] = useState<'skip' | 'once'>(
    initial.missedRun ?? (isEditing ? 'skip' : 'once')
  )
  const [scope, setScope] = useState<NonNullable<ScheduleEntry['cleanerSubcategories']>>(
    initial.cleanerSubcategories ?? {}
  )

  const toggleTask = (type: ScheduleTaskType) => {
    setTasks((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]))
  }

  const allAvailableTypes = availableTasks.map((t) => t.type)
  const selectAll = () => setTasks([...allAvailableTypes])
  const deselectAll = () => setTasks([])

  const canSave =
    name.trim().length > 0 && tasks.length > 0 && validateScheduleConditions(conditions)

  const handleSubmit = () => {
    if (!canSave) return
    const entry: ScheduleEntry = {
      id: (initial as ScheduleEntry).id ?? crypto.randomUUID(),
      name: name.trim(),
      enabled: (initial as ScheduleEntry).enabled ?? true,
      frequency,
      day,
      hour,
      minute,
      tasks,
      conditions,
      missedRun,
      cleanerSubcategories: scope,
      autoApply,
      lastRunAt: (initial as ScheduleEntry).lastRunAt ?? null,
      lastRunStatus: (initial as ScheduleEntry).lastRunStatus ?? 'never',
      createdAt: (initial as ScheduleEntry).createdAt ?? new Date().toISOString()
    }
    onSave(entry)
  }

  const cleanerTasks = availableTasks.filter((t) => t.group === 'cleaner')
  const maintTasks = availableTasks.filter((t) => t.group === 'maintenance')

  return (
    <DialogShell
      wide
      title={isEditing ? t('dialog.editTitle') : t('dialog.newTitle')}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('dialog.cancelButton')}
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!canSave}>
            {isEditing ? t('dialog.saveChangesButton') : t('dialog.createScheduleButton')}
          </Button>
        </>
      }
    >
      <div className="pulizia-form">
        {/* Name */}
        <div className="pulizia-form-field">
          <label className="pulizia-label" htmlFor={nameId}>
            {t('dialog.nameLabel')}
          </label>
          <input
            id={nameId}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('dialog.namePlaceholder')}
            maxLength={60}
            className="pulizia-field"
          />
        </div>

        {/* Schedule timing */}
        <div className="pulizia-form-row">
          <div className="pulizia-form-field">
            <label className="pulizia-label" htmlFor={frequencyId}>
              {t('dialog.frequencyLabel')}
            </label>
            <select
              id={frequencyId}
              value={frequency}
              onChange={(e) => {
                const f = e.target.value as 'daily' | 'weekly' | 'monthly'
                setFrequency(f)
                // Reset day to a sensible default for the new frequency
                if (f === 'weekly') setDay(1) // Monday
                if (f === 'monthly') setDay(1) // 1st
              }}
              className="pulizia-field"
            >
              <option value="daily">{t('dialog.frequencyDaily')}</option>
              <option value="weekly">{t('dialog.frequencyWeekly')}</option>
              <option value="monthly">{t('dialog.frequencyMonthly')}</option>
            </select>
          </div>

          {frequency !== 'daily' && (
            <div className="pulizia-form-field">
              <label className="pulizia-label" htmlFor={dayId}>
                {t('dialog.dayLabel')}
              </label>
              <select
                id={dayId}
                value={day}
                onChange={(e) => setDay(Number(e.target.value))}
                className="pulizia-field"
              >
                {frequency === 'weekly'
                  ? DAY_NAME_KEYS.map((key, i) => (
                      <option key={i} value={i}>
                        {t(key)}
                      </option>
                    ))
                  : Array.from({ length: 31 }, (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {i + 1}
                      </option>
                    ))}
              </select>
            </div>
          )}

          <div className="pulizia-form-field">
            <label className="pulizia-label" htmlFor={hourId}>
              {t('dialog.timeLabel')}
            </label>
            <div className="pulizia-time">
              <select
                id={hourId}
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
                className="pulizia-field"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>
                    {String(i).padStart(2, '0')}
                  </option>
                ))}
              </select>
              <span aria-hidden="true">:</span>
              <select
                value={minute}
                onChange={(e) => setMinute(Number(e.target.value))}
                className="pulizia-field"
                aria-label={t('dialog.minuteLabel')}
              >
                {Array.from({ length: 60 }, (_, i) => (
                  <option key={i} value={i}>
                    {String(i).padStart(2, '0')}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Tasks */}
        <fieldset className="pulizia-fieldset">
          <div className="pulizia-fieldset-head">
            <legend className="pulizia-label">{t('dialog.tasksLabel')}</legend>
            <span className="pulizia-fieldset-actions">
              <button type="button" className="pulizia-link" onClick={selectAll}>
                {t('dialog.selectAll')}
              </button>
              <button type="button" className="pulizia-link" onClick={deselectAll}>
                {t('dialog.deselectAll')}
              </button>
            </span>
          </div>
          <p className="pulizia-app-meta">{t('dialog.cleanerGroup')}</p>
          <div className="pulizia-task-grid">
            {cleanerTasks.map((task) => (
              <TaskCheckbox
                key={task.type}
                task={task}
                checked={tasks.includes(task.type)}
                onChange={() => toggleTask(task.type)}
              />
            ))}
          </div>
          <p className="pulizia-app-meta">{t('dialog.maintenanceGroup')}</p>
          <div className="pulizia-task-grid">
            {maintTasks.map((task) => (
              <TaskCheckbox
                key={task.type}
                task={task}
                checked={tasks.includes(task.type)}
                onChange={() => toggleTask(task.type)}
              />
            ))}
          </div>
        </fieldset>

        <ScheduleOptions
          conditions={conditions}
          onChange={setConditions}
          missedRun={missedRun}
          onMissedRun={setMissedRun}
        />
        <details className="pulizia-details">
          <summary>{t('advanced.workflow')}</summary>
          <fieldset className="pulizia-details-body">
            <legend className="sr-only">{t('advanced.workflow')}</legend>
            <p className="pulizia-app-meta">{t('advanced.workflowHint')}</p>
            {tasks.map((type, index) => {
              const label = availableTasks.find((task) => task.type === type)?.label ?? type
              return (
                <div key={type} className="pulizia-order">
                  <div className="pulizia-order-row">
                    <span className="pulizia-order-name">
                      {index + 1}. {label}
                    </span>
                    <Button
                      variant="ghost"
                      aria-label={t('advanced.moveUpLabel', { name: label })}
                      disabled={index === 0}
                      onClick={() =>
                        setTasks((previous) => {
                          const next = [...previous]
                          ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                          return next
                        })
                      }
                    >
                      {t('advanced.moveUp')}
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={t('advanced.moveDownLabel', { name: label })}
                      disabled={index === tasks.length - 1}
                      onClick={() =>
                        setTasks((previous) => {
                          const next = [...previous]
                          ;[next[index + 1], next[index]] = [next[index], next[index + 1]]
                          return next
                        })
                      }
                    >
                      {t('advanced.moveDown')}
                    </Button>
                  </div>
                  {type.startsWith('cleaner:') && type !== 'cleaner:recycleBin' && (
                    <ScheduleScope
                      task={type}
                      label={label}
                      selected={scope[type]}
                      onChange={(value) => setScope((previous) => ({ ...previous, [type]: value }))}
                    />
                  )}
                </div>
              )
            })}
          </fieldset>
        </details>

        {/* Auto-apply */}
        <div className="pulizia-toggle-row">
          <div className="pulizia-entry">
            <span className="pulizia-app-name">{t('dialog.autoApplyLabel')}</span>
            <span className="pulizia-app-meta">{t('dialog.autoApplyDescription')}</span>
          </div>
          <Switch checked={autoApply} onChange={setAutoApply} label={t('dialog.autoApplyLabel')} />
        </div>

        {autoApply && <ReportNotice as="div" title={t('dialog.autoApplyWarning')} />}
      </div>
    </DialogShell>
  )
}

// ─── Small Components ─────────────────────────────────────

function TaskCheckbox({
  task,
  checked,
  onChange
}: {
  task: TaskDef
  checked: boolean
  onChange: () => void
}) {
  return (
    <label className="pulizia-task">
      <Checkbox checked={checked} onChange={onChange} label={task.label} />
      <task.icon size={16} strokeWidth={1.75} aria-hidden="true" className="pulizia-task-icon" />
      <span>{task.label}</span>
    </label>
  )
}

// ─── Utilities ────────────────────────────────────────────

function timeOf(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function formatFrequency(entry: ScheduleEntry, t: Translate): string {
  const time = timeOf(entry.hour, entry.minute ?? 0)
  switch (entry.frequency) {
    case 'daily':
      return t('frequency.everyDayAt', { time })
    case 'weekly':
      return t('frequency.everyWeekdayAt', {
        day: t(DAY_NAME_KEYS[entry.day] ?? 'dayNames.monday'),
        time
      })
    case 'monthly':
      return t('frequency.monthlyOn', { day: entry.day, time })
  }
}

/** "lun 29 set, 09:00" in the UI language, Latin digits. */
function formatWhen(date: Date, locale: string): string {
  try {
    return date.toLocaleString(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      numberingSystem: 'latn'
    } as Intl.DateTimeFormatOptions)
  } catch {
    return date.toLocaleString()
  }
}

function formatNextRun(date: Date, t: Translate, locale: string): string {
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffD = Math.floor(diffMs / 86_400_000)
  const time = timeOf(date.getHours(), date.getMinutes())

  if (diffD === 0 && date.getDate() === now.getDate()) return t('nextRun.todayAt', { time })
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate()
  )
    return t('nextRun.tomorrowAt', { time })
  if (diffD < 7) return t('nextRun.inDaysAt', { count: diffD, time })
  return t('nextRun.dateAt', {
    date: date.toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
    time
  })
}

function formatLastRun(iso: string, t: Translate, locale: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffM = Math.floor(diffMs / 60_000)
  const diffH = Math.floor(diffMs / 3_600_000)
  const diffD = Math.floor(diffMs / 86_400_000)

  if (diffM < 1) return t('lastRun.justNow')
  if (diffM < 60) return t('lastRun.minutesAgo', { count: diffM })
  if (diffH < 24) return t('lastRun.hoursAgo', { count: diffH })
  if (diffD < 7) return t('lastRun.daysAgo', { count: diffD })
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
}
