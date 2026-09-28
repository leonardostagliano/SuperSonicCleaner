import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Receipt } from '@/components/shared/Receipt'
import { Button, Card, ListRow, ProgressBar, Section, Switch, Tag } from '@/components/ui'
import {
  CATEGORIES,
  OPTIMIZATIONS,
  formatElapsed,
  isValidProcessName,
  stepLabel
} from '@/components/game-mode/game-mode-view'
import { icons } from '@/lib/icons'
import { formatCount } from '@/lib/protection-format'
import { useGameModeStore } from '@/stores/game-mode-store'

const store = useGameModeStore.getState

export function GameModePage() {
  const { t, i18n } = useTranslation('gameMode')
  const lang = i18n.language
  const active = useGameModeStore((s) => s.active)
  const activatedAt = useGameModeStore((s) => s.activatedAt)
  const pendingRestore = useGameModeStore((s) => s.pendingRestore)
  const pendingReason = useGameModeStore((s) => s.pendingReason)
  const status = useGameModeStore((s) => s.status)
  const progress = useGameModeStore((s) => s.progress)
  const lastResult = useGameModeStore((s) => s.lastResult)
  const config = useGameModeStore((s) => s.config)
  const expandedCategories = useGameModeStore((s) => s.expandedCategories)
  const detectedGame = useGameModeStore((s) => s.detectedGame)

  const [elapsed, setElapsed] = useState(0)
  const [customInput, setCustomInput] = useState('')
  const [gameInput, setGameInput] = useState('')
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const progressCleanupRef = useRef<(() => void) | null>(null)
  const gameInputId = useId()
  const customInputId = useId()

  // Cleanup progress listener on unmount
  useEffect(() => {
    return () => {
      progressCleanupRef.current?.()
    }
  }, [])

  // Drop the discard confirmation whenever the banner is no longer showing
  useEffect(() => {
    if (!pendingRestore) setConfirmDiscard(false)
  }, [pendingRestore])

  // Session timer
  useEffect(() => {
    if (!active || !activatedAt) {
      setElapsed(0)
      return
    }
    const start = new Date(activatedAt).getTime()
    const tick = () => setElapsed(Date.now() - start)
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [active, activatedAt])

  // Auto-dismiss result
  useEffect(() => {
    if (!lastResult) return
    const timer = setTimeout(() => store().setLastResult(null), 8000)
    return () => clearTimeout(timer)
  }, [lastResult])

  const isBusy = status !== 'idle'

  const listenForProgress = () => {
    progressCleanupRef.current =
      window.kudu?.onGameModeProgress?.((data) => {
        store().setProgress(data)
      }) ?? null
  }
  const stopListening = () => {
    store().setStatus('idle')
    store().setProgress(null)
    progressCleanupRef.current?.()
    progressCleanupRef.current = null
  }

  const handleActivate = useCallback(async () => {
    if (config.enabledOptimizations.length === 0) {
      toast.error(t('noOptimizationsSelected'))
      return
    }
    store().setStatus('activating')
    store().setLastResult(null)
    listenForProgress()

    try {
      const result = await window.kudu.gameModeActivate(config)
      // Only mark as active if at least one optimization succeeded
      if (result.succeeded > 0) {
        store().setActive(true, result.snapshot?.activatedAt ?? new Date().toISOString())
      }
      store().setLastResult({
        type: 'activate',
        succeeded: result.succeeded,
        failed: result.failed
      })
      if (result.succeeded === 0 && result.failed > 0) {
        toast.error(t('toastAllFailed'), { description: result.errors[0]?.reason })
      } else if (result.failed > 0) {
        toast.warning(t('toastSomeFailed', { count: result.failed }))
      }
    } catch (err) {
      toast.error(t('toastActivateFailed'), {
        description: err instanceof Error ? err.message : undefined
      })
    } finally {
      stopListening()
    }
  }, [config, t])

  const handleDeactivate = useCallback(async () => {
    store().setStatus('deactivating')
    store().setLastResult(null)
    listenForProgress()

    try {
      const result = await window.kudu.gameModeDeactivate()
      store().setActive(false, null)
      const reason = result.errors[0]?.reason ?? null
      store().setPendingRestore(result.failed > 0, reason)
      if (result.failed > 0) {
        toast.warning(
          t('restoreFailed', {
            count: result.failed,
            reason: reason ?? t('restoreReasonUnknown')
          })
        )
      }
      store().setLastResult({
        type: 'deactivate',
        succeeded: result.restored,
        failed: result.failed
      })
    } catch (err) {
      toast.error(t('toastDeactivateFailed'), {
        description: err instanceof Error ? err.message : undefined
      })
    } finally {
      stopListening()
    }
  }, [t])

  const handleDiscardPending = useCallback(async () => {
    setConfirmDiscard(false)
    try {
      const result = await window.kudu.gameModeDiscardPending()
      if (!result.discarded) {
        toast.error(result.reason ?? t('discardFailed'))
        return
      }
      store().setPendingRestore(false, null)
      toast.success(t('discardDone'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('discardFailed'))
    }
  }, [t])

  const addProcess = (
    value: string,
    list: string[],
    save: (next: string[]) => void,
    clear: () => void
  ) => {
    const name = value.trim()
    if (!name || name.length > 100 || list.includes(name)) return
    if (!isValidProcessName(name)) {
      toast.error(t('invalidProcessName'))
      return
    }
    save([...list, name])
    clear()
  }

  const enabledSet = new Set(config.enabledOptimizations)
  const enabledCount = config.enabledOptimizations.length
  const serviceCount = OPTIMIZATIONS.filter(
    (o) => o.category === 'services' && enabledSet.has(o.id)
  ).length
  const gameProcesses = config.customGameProcesses ?? []
  const elapsedText = formatElapsed(elapsed)
  const step = progress ? stepLabel(progress) : null
  const WarningIcon = icons.warning
  const NoteIcon = icons.note

  return (
    <div>
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <Button
            variant="primary"
            size="lg"
            busy={isBusy}
            onClick={() => void (active ? handleDeactivate() : handleActivate())}
          >
            {status === 'activating'
              ? t('activatingButton')
              : status === 'deactivating'
                ? t('deactivatingButton')
                : active
                  ? t('deactivateButton')
                  : t('activateButton')}
          </Button>
        }
      />

      <div className="flex flex-col gap-3">
        <Card as="section" aria-busy={isBusy}>
          <h2 className="m-0 font-[family-name:var(--font-display)] text-[length:var(--text-15)] leading-[1.3] font-semibold tabular-nums">
            {active && activatedAt
              ? t('activeSince', { elapsed: elapsedText, time: elapsedText })
              : t('inactiveLabel')}
          </h2>
          <p className="mt-1 text-[length:var(--text-13)] text-[var(--text-secondary)] tabular-nums">
            {[
              t('selectedCount', { count: enabledCount }),
              active && serviceCount > 0 ? t('servicesPaused', { count: serviceCount }) : null
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {active && (
            <p className="mt-1 text-[length:var(--text-12)] text-[var(--text-muted)]">
              {t('configLockedWhileActive')}
            </p>
          )}
          {detectedGame && active && (
            <p className="mt-1 text-[length:var(--text-12)] text-[var(--text-muted)]">
              {t('autoDetectedBanner', { name: detectedGame })}
            </p>
          )}
        </Card>

        {isBusy && progress && (
          <Section
            title={
              progress.phase === 'activating' ? t('activatingProgress') : t('deactivatingProgress')
            }
            meta={t('progressCount', {
              current: formatCount(progress.current, lang),
              total: formatCount(progress.total, lang)
            })}
          >
            {step && (
              <p className="mb-2 text-[length:var(--text-13)] text-[var(--text-secondary)]">
                {t(step.key, {
                  ...step.params,
                  ...(step.labelKey ? { label: t(step.labelKey) } : {})
                })}
              </p>
            )}
            <ProgressBar
              value={progress.current / Math.max(progress.total, 1)}
              label={t('progressLabel')}
            />
          </Section>
        )}

        {lastResult && !isBusy && (
          <Receipt
            title={
              lastResult.type === 'activate'
                ? t('receiptActivatedTitle')
                : t('receiptDeactivatedTitle')
            }
            value={
              lastResult.type === 'activate'
                ? t('receiptApplied', { count: lastResult.succeeded })
                : t('receiptRestored', { count: lastResult.succeeded })
            }
            facts={[
              lastResult.failed > 0 ? t('receiptFailed', { count: lastResult.failed }) : '',
              lastResult.type === 'activate' ? t('receiptActivatedNote') : ''
            ]}
          />
        )}

        {!active && pendingRestore && (
          <Card className="flex flex-wrap items-start gap-3">
            <WarningIcon
              size={16}
              strokeWidth={1.75}
              className="mt-0.5 shrink-0 text-[var(--text-secondary)]"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-[1_1_320px] text-[length:var(--text-13)] text-[var(--text-secondary)]">
              <p className="m-0">{t('pendingRestoreBanner')}</p>
              {pendingReason && (
                <p className="m-0 mt-1 text-[length:var(--text-12)] break-words text-[var(--text-muted)]">
                  {pendingReason}
                </p>
              )}
              <p className="m-0 mt-1 text-[length:var(--text-12)] text-[var(--text-muted)]">
                {t('pendingRestoreDiscardHint')}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button busy={isBusy} onClick={() => void handleDeactivate()}>
                {isBusy ? t('retryingCleanup') : t('retryCleanup')}
              </Button>
              <Button variant="ghost" disabled={isBusy} onClick={() => setConfirmDiscard(true)}>
                {t('discardPending')}
              </Button>
            </div>
          </Card>
        )}

        <Section
          title={t('autoDetectTitle')}
          actions={
            <Switch
              checked={config.autoDetect}
              label={t('autoDetectLabel')}
              onChange={(value) => store().setAutoDetect(value)}
            />
          }
        >
          <p className="m-0 text-[length:var(--text-13)] text-[var(--text-secondary)]">
            {t('autoDetectDesc')}
          </p>
          {config.autoDetect && (
            <div className="mt-3 border-t border-[var(--border-default)]">
              <ListRow className="items-start">
                <div className="min-w-0 flex-1">
                  <span className="text-[length:var(--text-13)] font-medium">
                    {t('autoDeactivateLabel')}
                  </span>
                  <p className="m-0 text-[length:var(--text-12)] text-[var(--text-muted)]">
                    {t('autoDeactivateDesc')}
                  </p>
                </div>
                <Switch
                  checked={config.autoDeactivate}
                  label={t('autoDeactivateLabel')}
                  onChange={(value) => store().setAutoDeactivate(value)}
                />
              </ListRow>
              <div className="flex flex-col gap-2 border-t border-[var(--border-default)] py-3 ps-3">
                <div>
                  <label htmlFor={gameInputId} className="text-[length:var(--text-13)] font-medium">
                    {t('customGameProcessesLabel')}
                  </label>
                  <p className="m-0 text-[length:var(--text-12)] text-[var(--text-muted)]">
                    {t('customGameProcessesDesc')}
                  </p>
                </div>
                <ProcessEditor
                  inputId={gameInputId}
                  value={gameInput}
                  onValueChange={setGameInput}
                  placeholder={t('customGamePlaceholder')}
                  addLabel={t('customGameAdd')}
                  addAriaLabel={t('customGameAddLabel')}
                  emptyText={t('customGameEmpty')}
                  names={gameProcesses}
                  onAdd={() =>
                    addProcess(
                      gameInput,
                      gameProcesses,
                      (next) => store().setCustomGameProcesses(next),
                      () => setGameInput('')
                    )
                  }
                  onRemove={(name) =>
                    store().setCustomGameProcesses(gameProcesses.filter((n) => n !== name))
                  }
                />
              </div>
            </div>
          )}
        </Section>

        {CATEGORIES.map((category) => {
          const options = OPTIMIZATIONS.filter((o) => o.category === category.id)
          if (options.length === 0) return null
          const enabledInCategory = options.filter((o) => enabledSet.has(o.id)).length
          const expanded = expandedCategories.has(category.id)
          const label = t(category.labelKey)
          return (
            <Section
              key={category.id}
              title={label}
              meta={t('categoryMeta', {
                enabled: formatCount(enabledInCategory, lang),
                total: formatCount(options.length, lang)
              })}
              actions={
                <Button
                  variant="ghost"
                  aria-expanded={expanded}
                  aria-label={`${expanded ? t('categoryHide') : t('categoryShow')}: ${label}`}
                  onClick={() => store().toggleCategory(category.id)}
                >
                  {expanded ? t('categoryHide') : t('categoryShow')}
                </Button>
              }
            >
              <p className="m-0 text-[length:var(--text-13)] text-[var(--text-secondary)]">
                {t(category.descKey)}
              </p>
              {expanded && (
                <div className="mt-3 border-t border-[var(--border-default)]">
                  {options.map((option) => (
                    <ListRow key={option.id} className="items-start">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-[length:var(--text-13)] font-medium">
                            {t(option.labelKey)}
                          </span>
                          {option.requiresAdmin && <Tag tone="neutral">{t('adminTag')}</Tag>}
                        </div>
                        <p className="m-0 text-[length:var(--text-12)] text-[var(--text-muted)]">
                          {t(option.descKey)}
                        </p>
                      </div>
                      <Switch
                        checked={enabledSet.has(option.id)}
                        disabled={active || isBusy}
                        label={t(option.labelKey)}
                        onChange={() => store().toggleOptimization(option.id)}
                      />
                    </ListRow>
                  ))}

                  {category.id === 'processes' && (
                    <div className="flex flex-col gap-2 border-t border-[var(--border-default)] py-3 ps-3">
                      <label htmlFor={customInputId} className="sr-only">
                        {t('customProcessAddLabel')}
                      </label>
                      <ProcessEditor
                        inputId={customInputId}
                        value={customInput}
                        onValueChange={setCustomInput}
                        placeholder={t('customProcessPlaceholder')}
                        addLabel={t('customProcessAdd')}
                        addAriaLabel={t('customProcessAddLabel')}
                        emptyText={t('customProcessEmpty')}
                        names={config.customProcessKillList}
                        disabled={active}
                        onAdd={() =>
                          addProcess(
                            customInput,
                            config.customProcessKillList,
                            (next) => store().setCustomProcessKillList(next),
                            () => setCustomInput('')
                          )
                        }
                        onRemove={(name) =>
                          store().setCustomProcessKillList(
                            config.customProcessKillList.filter((n) => n !== name)
                          )
                        }
                      />
                      {enabledSet.has('proc-kill-custom') &&
                        config.customProcessKillList.length > 0 && (
                          <p className="m-0 flex items-start gap-2 text-[length:var(--text-12)] text-[var(--text-secondary)]">
                            <NoteIcon
                              size={14}
                              strokeWidth={1.75}
                              className="mt-0.5 shrink-0"
                              aria-hidden="true"
                            />
                            {t('warningProcesses')}
                          </p>
                        )}
                    </div>
                  )}
                </div>
              )}
            </Section>
          )
        })}
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        onConfirm={() => void handleDiscardPending()}
        onCancel={() => setConfirmDiscard(false)}
        title={t('discardConfirmTitle')}
        description={t('discardConfirmDescription')}
        confirmLabel={t('discardConfirmLabel')}
        variant="danger"
      />
    </div>
  )
}

function ProcessEditor({
  inputId,
  value,
  onValueChange,
  placeholder,
  addLabel,
  addAriaLabel,
  emptyText,
  names,
  disabled,
  onAdd,
  onRemove
}: {
  inputId: string
  value: string
  onValueChange: (value: string) => void
  placeholder: string
  addLabel: string
  addAriaLabel: string
  emptyText: string
  names: string[]
  disabled?: boolean
  onAdd: () => void
  onRemove: (name: string) => void
}) {
  const { t } = useTranslation('gameMode')
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          id={inputId}
          type="text"
          value={value}
          disabled={disabled}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAdd()}
          placeholder={placeholder}
          className="h-8 min-w-0 flex-1 rounded-[var(--radius-control)] border border-[var(--border-medium)] px-3 font-mono text-[length:var(--text-12)] text-[var(--text-primary)] outline-none"
        />
        <Button disabled={disabled || !value.trim()} aria-label={addAriaLabel} onClick={onAdd}>
          {addLabel}
        </Button>
      </div>
      {names.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {names.map((name) => (
            <li
              key={name}
              className="flex items-center gap-1 rounded-[var(--radius-control)] border border-[var(--border-default)] ps-2 font-mono text-[length:var(--text-12)] text-[var(--text-secondary)]"
            >
              {name}
              {!disabled && (
                <Button
                  variant="ghost"
                  icon={X}
                  aria-label={t('removeProcess', { name })}
                  onClick={() => onRemove(name)}
                />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[length:var(--text-12)] text-[var(--text-muted)]">{emptyText}</p>
      )}
    </div>
  )
}
