import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ScheduleConditions } from '@shared/schedule-policy'
import type { ScheduleTaskType, ScanResult } from '@shared/types'
import { Button, Checkbox } from '@/components/ui'
import { useScanStore } from '@/stores/scan-store'
import { ScanStatus } from '@shared/enums'
import '@/components/cleaner/pulizia.css'

const timeText = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const timeValue = (text: string) => {
  const [h, m] = text.split(':').map(Number)
  return h * 60 + m
}

/** A checkbox with its visible label; the label text is also its accessible name. */
export function CheckField({
  checked,
  onChange,
  children
}: {
  checked: boolean
  onChange: (value: boolean) => void
  children: string
}) {
  return (
    <label className="pulizia-task">
      <Checkbox checked={checked} onChange={onChange} label={children} />
      <span>{children}</span>
    </label>
  )
}

export function ScheduleOptions({
  conditions,
  onChange,
  missedRun,
  onMissedRun
}: {
  conditions: ScheduleConditions
  onChange: (value: ScheduleConditions) => void
  missedRun: 'skip' | 'once'
  onMissedRun: (value: 'skip' | 'once') => void
}) {
  const { t } = useTranslation('schedules')
  const idleId = useId()
  const fromId = useId()
  const toId = useId()
  const freeId = useId()
  const missedId = useId()
  const patch = (value: Partial<ScheduleConditions>) => onChange({ ...conditions, ...value })
  return (
    <details className="pulizia-details">
      <summary>{t('advanced.title')}</summary>
      <fieldset className="pulizia-details-body pulizia-options">
        <legend className="sr-only">{t('advanced.title')}</legend>
        <p className="pulizia-app-meta pulizia-options-wide">{t('advanced.explanation')}</p>
        <CheckField
          checked={conditions.acOnly ?? false}
          onChange={(value) => patch({ acOnly: value })}
        >
          {t('advanced.acOnly')}
        </CheckField>
        <CheckField
          checked={conditions.pauseForGameMode !== false}
          onChange={(value) => patch({ pauseForGameMode: value })}
        >
          {t('advanced.gameMode')}
        </CheckField>
        <div className="pulizia-form-field">
          <label className="pulizia-label" htmlFor={idleId}>
            {t('advanced.idle')}
          </label>
          <input
            id={idleId}
            className="pulizia-field"
            type="number"
            min={0}
            max={120}
            step={1}
            value={conditions.idleMinutes ?? 0}
            onChange={(e) => patch({ idleMinutes: Number(e.target.value) })}
          />
        </div>
        <CheckField
          checked={conditions.windowStart !== undefined}
          onChange={(value) =>
            patch({
              windowStart: value ? 0 : undefined,
              windowEnd: value ? 360 : undefined
            })
          }
        >
          {t('advanced.window')}
        </CheckField>
        {conditions.windowStart !== undefined && (
          <div className="pulizia-form-row pulizia-options-wide">
            <div className="pulizia-form-field">
              <label className="pulizia-label" htmlFor={fromId}>
                {t('advanced.from')}
              </label>
              <input
                id={fromId}
                className="pulizia-field"
                type="time"
                value={timeText(conditions.windowStart)}
                onChange={(e) => {
                  if (e.target.value) patch({ windowStart: timeValue(e.target.value) })
                }}
              />
            </div>
            <div className="pulizia-form-field">
              <label className="pulizia-label" htmlFor={toId}>
                {t('advanced.to')}
              </label>
              <input
                id={toId}
                className="pulizia-field"
                type="time"
                value={timeText(conditions.windowEnd ?? 0)}
                onChange={(e) => {
                  if (e.target.value) patch({ windowEnd: timeValue(e.target.value) })
                }}
              />
            </div>
          </div>
        )}
        <CheckField
          checked={conditions.freeBelowPercent !== undefined}
          onChange={(value) => patch({ freeBelowPercent: value ? 15 : undefined })}
        >
          {t('advanced.disk')}
        </CheckField>
        {conditions.freeBelowPercent !== undefined && (
          <div className="pulizia-form-field">
            <label className="pulizia-label" htmlFor={freeId}>
              {t('advanced.freePercent')}
            </label>
            <input
              id={freeId}
              className="pulizia-field"
              type="number"
              min={1}
              max={100}
              step={1}
              value={conditions.freeBelowPercent}
              onChange={(e) => patch({ freeBelowPercent: Number(e.target.value) })}
            />
          </div>
        )}
        <div className="pulizia-form-field pulizia-options-wide">
          <label className="pulizia-label" htmlFor={missedId}>
            {t('advanced.missed')}
          </label>
          <select
            id={missedId}
            className="pulizia-field"
            value={missedRun}
            onChange={(e) => onMissedRun(e.target.value as 'skip' | 'once')}
          >
            <option value="skip">{t('advanced.skip')}</option>
            <option value="once">{t('advanced.once')}</option>
          </select>
        </div>
      </fieldset>
    </details>
  )
}

export function ScheduleScope({
  task,
  label,
  selected,
  onChange
}: {
  task: ScheduleTaskType
  label: string
  selected: string[] | undefined
  onChange: (value: string[] | undefined) => void
}) {
  const { t } = useTranslation('schedules')
  const [choices, setChoices] = useState<string[]>(selected ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const scan = async () => {
    const store = useScanStore.getState()
    if (store.status === ScanStatus.Scanning || store.status === ScanStatus.Cleaning) {
      setError(t('advanced.waitForScan'))
      return
    }
    const methods: Partial<Record<ScheduleTaskType, () => Promise<ScanResult[]>>> = {
      'cleaner:system': () => window.kudu.systemScan(),
      'cleaner:browsers': () => window.kudu.browserScan(),
      'cleaner:apps': () => window.kudu.appScan(),
      'cleaner:gaming': () => window.kudu.gamingScan(),
      'cleaner:databases': () => window.kudu.databaseScan()
    }
    const method = methods[task]
    if (!method) return
    const previousStatus = store.status
    setBusy(true)
    setError('')
    store.setStatus(ScanStatus.Scanning)
    try {
      const results = await method()
      const names = [...new Set([...(selected ?? []), ...results.map((r) => r.subcategory)])].sort()
      setChoices(names)
      if (!names.length) setError(t('advanced.noCategories'))
    } catch {
      setError(t('advanced.scanFailed'))
    } finally {
      setBusy(false)
      store.setStatus(previousStatus)
      store.setProgress(null)
    }
  }
  return (
    <div className="pulizia-scope">
      <CheckField
        checked={selected !== undefined}
        onChange={(value) => onChange(value ? [] : undefined)}
      >
        {t('advanced.restrict', { name: label })}
      </CheckField>
      {selected !== undefined && (
        <>
          <div>
            <Button busy={busy} onClick={() => void scan()}>
              {t('advanced.findCategories')}
            </Button>
          </div>
          <p className="pulizia-app-meta">{t('advanced.scopeHint')}</p>
          {choices.map((name) => (
            <CheckField
              key={name}
              checked={selected.includes(name)}
              onChange={(value) =>
                onChange(value ? [...selected, name] : selected.filter((n) => n !== name))
              }
            >
              {name}
            </CheckField>
          ))}
        </>
      )}
      {error && (
        <p role="alert" className="pulizia-app-meta">
          {error}
        </p>
      )}
    </div>
  )
}
