import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X, FolderOpen, Sun, Moon, Monitor, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settings-store'
import { usePlatform } from '@/hooks/usePlatform'
import { LANGUAGES } from '@/lib/languages'
import i18next from 'i18next'

export function SettingsPage() {
  const { t } = useTranslation('settings')
  const { features, platform, isPortable } = usePlatform()
  const { settings, saveSettings, setSettings } = useSettingsStore()
  const [newExclusion, setNewExclusion] = useState('')
  const [savingStartup, setSavingStartup] = useState(false)

  useEffect(() => {
    window.kudu
      ?.settingsGet?.()
      .then(setSettings)
      .catch(() => {})
  }, [])

  useEffect(() => {
    void i18next.changeLanguage(settings.language)
  }, [settings.language])

  const save = async (partial: Partial<typeof settings>): Promise<boolean> => {
    try {
      await saveSettings(partial)
      return true
    } catch {
      toast.error(t('settingsSaveFailed'))
      return false
    } finally {
      // Also restore the language if the user left this page while saving.
      if ('language' in partial) {
        void i18next.changeLanguage(useSettingsStore.getState().settings.language)
      }
    }
  }

  const saveStartup = async (enabled: boolean) => {
    if (savingStartup) return
    setSavingStartup(true)
    const previous = settings.runAtStartup
    try {
      if (!(await save({ runAtStartup: enabled }))) return
      await window.kudu.applyStartup(enabled)
    } catch {
      // Revert the toggle — the OS rejected the change
      if (useSettingsStore.getState().settings.runAtStartup === enabled) {
        await save({ runAtStartup: previous })
      }
      toast.error(t('startupSettingFailedToast'), {
        description: t('startupSettingFailedDesc'),
        action: {
          label: t('startupSettingFailedAction'),
          onClick: () =>
            window.open(
              'https://github.com/leonardostagliano/SuperSonicCleaner/blob/main/RELEASE.md#startup-troubleshooting',
              '_blank'
            )
        }
      })
    } finally {
      setSavingStartup(false)
    }
  }

  const saveTray = async (enabled: boolean) => {
    if (await save({ minimizeToTray: enabled })) {
      window.kudu.applyTray(useSettingsStore.getState().settings.minimizeToTray)
    }
  }

  const addExclusion = async () => {
    const value = newExclusion.trim()
    if (!value) return
    // Must be an absolute path or a *.ext glob
    const isDrivePath = /^[A-Za-z]:\\/.test(value)
    const isUncPath = /^\\\\[A-Za-z0-9]/.test(value)
    const isUnixPath = /^\/[A-Za-z0-9]/.test(value)
    const isGlob = /^\*\.[A-Za-z0-9]+$/.test(value)
    // Reject relative path traversal sequences
    if (value.includes('..')) return
    if (!isDrivePath && !isUncPath && !isUnixPath && !isGlob) return
    // Prevent duplicates
    if (settings.exclusions.includes(value)) return
    if (await save({ exclusions: [...settings.exclusions, value] })) {
      setNewExclusion((current) => (current.trim() === value ? '' : current))
    }
  }

  const selectStyle = 'rounded-lg px-3 py-1.5 text-[13px] text-zinc-400 outline-none'
  const selectBorder = {
    background: 'var(--bg-subtle-2)',
    border: '1px solid var(--border-medium)'
  }

  return (
    <div className="feature-page settings-page animate-fade-in">
      <PageHeader title={t('pageTitle')} description={t('pageDescription')} />

      <nav className="pulse-settings-nav" aria-label={t('pageTitle')}>
        {[
          'sectionGeneral',
          'sectionBackups',
          'sectionCleaningPreferences',
          'sectionExclusions'
        ].map((key) => (
          <button
            key={key}
            onClick={() => {
              const section = document.getElementById(key)
              section?.scrollIntoView({ block: 'start' })
              section?.focus({ preventScroll: true })
            }}
          >
            {t(key)}
          </button>
        ))}
      </nav>
      <div className="settings-grid">
        <Section id="sectionGeneral" title={t('sectionGeneral')}>
          <Row label={t('themeLabel')} desc={t('themeDesc')}>
            <ThemeSelector value={settings.theme} onChange={(v) => save({ theme: v })} />
          </Row>
          <Row label={t('languageLabel')} desc={t('languageDesc')}>
            <select
              value={settings.language}
              onChange={(e) => save({ language: e.target.value })}
              className={selectStyle}
              style={selectBorder}
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.nativeName} ({lang.name})
                </option>
              ))}
            </select>
          </Row>
          {isPortable ? (
            <Row
              label={t('runAtStartupLabel')}
              desc={t('portableStartupDesc', {
                defaultValue: 'Run at startup requires the installed version of SuperSonicCleaner.'
              })}
            >
              <span className="text-[12px] text-zinc-500">
                {t('portableManual', { defaultValue: 'Manual launch' })}
              </span>
            </Row>
          ) : (
            <Row label={t('runAtStartupLabel')} desc={t('runAtStartupDesc')}>
              <Toggle
                label={t('runAtStartupLabel')}
                checked={settings.runAtStartup}
                onChange={saveStartup}
                disabled={savingStartup}
              />
            </Row>
          )}
          <Row label={t('minimizeToTrayLabel')} desc={t('minimizeToTrayDesc')}>
            <Toggle
              label={t('minimizeToTrayLabel')}
              checked={settings.minimizeToTray}
              onChange={saveTray}
            />
          </Row>
          <Row label={t('showNotificationsLabel')} desc={t('showNotificationsDesc')}>
            <Toggle
              label={t('showNotificationsLabel')}
              checked={settings.showNotificationOnComplete}
              onChange={(v) => save({ showNotificationOnComplete: v })}
            />
          </Row>
          {!isPortable && (
            <>
              <Row label={t('autoUpdateLabel')} desc={t('autoUpdateDesc')}>
                <Toggle
                  label={t('autoUpdateLabel')}
                  checked={settings.autoUpdate}
                  onChange={(v) => save({ autoUpdate: v })}
                />
              </Row>
              <Row label={t('autoRestartLabel')} desc={t('autoRestartDesc')}>
                <Toggle
                  label={t('autoRestartLabel')}
                  checked={settings.autoRestart}
                  onChange={(v) => save({ autoRestart: v })}
                />
              </Row>
              <Row label={t('updateCheckIntervalLabel')} desc={t('updateCheckIntervalDesc')}>
                <select
                  value={settings.updateCheckIntervalHours}
                  onChange={(e) => save({ updateCheckIntervalHours: Number(e.target.value) })}
                  className={selectStyle}
                  style={selectBorder}
                >
                  <option value={1}>{t('updateCheckEveryHour')}</option>
                  <option value={4}>{t('updateCheckEvery4Hours')}</option>
                  <option value={12}>{t('updateCheckEvery12Hours')}</option>
                  <option value={24}>{t('updateCheckOnceADay')}</option>
                </select>
              </Row>
            </>
          )}
          <Row
            label={t('softwareUpdaterNotificationsLabel')}
            desc={t('softwareUpdaterNotificationsDesc')}
            last={platform === 'darwin'}
          >
            <Toggle
              label={t('softwareUpdaterNotificationsLabel')}
              checked={settings.softwareUpdaterNotifications ?? true}
              onChange={(v) => save({ softwareUpdaterNotifications: v })}
            />
          </Row>
          {platform !== 'darwin' && (
            <Row label={t('preferElevatedLaunchLabel')} desc={t('preferElevatedLaunchDesc')} last>
              <Toggle
                label={t('preferElevatedLaunchLabel')}
                checked={settings.preferElevatedLaunch ?? false}
                onChange={(v) => save({ preferElevatedLaunch: v })}
              />
            </Row>
          )}
        </Section>

        <Section id="sectionBackups" title={t('sectionBackups', 'Backups')}>
          <BackupFolderRow
            path={settings.backupPath}
            onPick={async () => {
              const picked = await window.kudu?.settingsSelectBackupDir?.()
              if (picked) {
                if (!(await save({ backupPath: picked }))) return
                toast.success(t('backupFolderUpdatedToast', 'Backup folder updated'), {
                  description: t(
                    'backupFolderUpdatedDesc',
                    'Existing backups remain in their previous location.'
                  )
                })
              }
            }}
            onOpen={() => {
              window.kudu?.settingsOpenBackupDir?.().catch(() => {})
            }}
            onReset={() => save({ backupPath: '' })}
          />
          <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
            <Row
              label={t('backupModeLabel', 'Registry backup mode')}
              desc={t(
                'backupModeDesc',
                'Targeted only saves the keys being changed (small). Full hive snapshots entire branches before each run (hundreds of MB).'
              )}
              last
            >
              <select
                value={settings.backupMode ?? 'targeted'}
                onChange={(e) => save({ backupMode: e.target.value as 'targeted' | 'full' })}
                className={selectStyle}
                style={selectBorder}
              >
                <option value="targeted">
                  {t('backupModeTargeted', 'Targeted (recommended)')}
                </option>
                <option value="full">{t('backupModeFull', 'Full hive')}</option>
              </select>
            </Row>
          </div>
        </Section>

        <Section id="sectionCleaningPreferences" title={t('sectionCleaningPreferences')}>
          <Row label={t('protectRecycleBinLabel')} desc={t('protectRecycleBinDesc')}>
            <Toggle
              label={t('protectRecycleBinLabel')}
              checked={settings.cleaner.protectRecycleBin}
              onChange={(v) => save({ cleaner: { ...settings.cleaner, protectRecycleBin: v } })}
            />
          </Row>
          <Row label={t('secureDeleteLabel')} desc={t('secureDeleteDesc')}>
            <Toggle
              label={t('secureDeleteLabel')}
              checked={settings.cleaner.secureDelete}
              onChange={(v) => save({ cleaner: { ...settings.cleaner, secureDelete: v } })}
            />
          </Row>
          <Row label={t('closeBrowsersLabel')} desc={t('closeBrowsersDesc')}>
            <Toggle
              label={t('closeBrowsersLabel')}
              checked={settings.cleaner.closeBrowsersBeforeClean}
              onChange={(v) =>
                save({ cleaner: { ...settings.cleaner, closeBrowsersBeforeClean: v } })
              }
            />
          </Row>
          {features.restorePoint && (
            <Row label={t('createRestorePointLabel')} desc={t('createRestorePointDesc')}>
              <Toggle
                label={t('createRestorePointLabel')}
                checked={settings.cleaner.createRestorePoint}
                onChange={(v) => save({ cleaner: { ...settings.cleaner, createRestorePoint: v } })}
              />
            </Row>
          )}
          <Row label={t('keepDeletionLogLabel')} desc={t('keepDeletionLogDesc')}>
            <Toggle
              label={t('keepDeletionLogLabel')}
              checked={settings.cleaner.keepDeletionLog}
              onChange={(v) => save({ cleaner: { ...settings.cleaner, keepDeletionLog: v } })}
            />
          </Row>
          <Row label={t('skipRecentFilesLabel')} desc={t('skipRecentFilesDesc')} last>
            <select
              value={settings.cleaner.skipRecentMinutes}
              onChange={(e) =>
                save({
                  cleaner: { ...settings.cleaner, skipRecentMinutes: Number(e.target.value) }
                })
              }
              className={selectStyle}
              style={selectBorder}
            >
              <option value={30}>{t('skipRecent30Min')}</option>
              <option value={60}>{t('skipRecent1Hour')}</option>
              <option value={120}>{t('skipRecent2Hours')}</option>
              <option value={1440}>{t('skipRecent24Hours')}</option>
            </select>
          </Row>
        </Section>

        <Section id="sectionExclusions" title={t('sectionExclusions')}>
          <div className="space-y-2 pb-3">
            {settings.exclusions.length === 0 && (
              <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                {t('noExclusionsConfigured')}
              </p>
            )}
            {settings.exclusions.map((exc, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-xl px-4 py-2.5"
                style={{ background: 'var(--bg-subtle)' }}
              >
                <div className="flex items-center gap-2.5">
                  <FolderOpen
                    className="h-3.5 w-3.5"
                    style={{ color: 'var(--text-muted)' }}
                    strokeWidth={1.8}
                  />
                  <span className="font-mono text-[12px] text-zinc-400">{exc}</span>
                </div>
                <button
                  onClick={() =>
                    save({ exclusions: settings.exclusions.filter((_, j) => j !== i) })
                  }
                  className="rounded-lg p-1.5 transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-hover)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2.5">
              <input
                type="text"
                value={newExclusion}
                onChange={(e) => setNewExclusion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addExclusion()}
                placeholder={
                  platform === 'win32'
                    ? t('exclusionPlaceholderWindows')
                    : t('exclusionPlaceholderOther')
                }
                className="flex-1 rounded-xl px-4 py-2.5 text-[13px] text-zinc-300 outline-none placeholder:text-zinc-700"
                style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
              />
              <button
                onClick={addExclusion}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-medium text-zinc-400 transition-colors"
                style={{
                  background: 'var(--bg-subtle-2)',
                  border: '1px solid var(--border-medium)'
                }}
              >
                <Plus className="h-3.5 w-3.5" /> {t('addButton')}
              </button>
            </div>
          </div>
        </Section>
      </div>
    </div>
  )
}

function Section({
  id,
  title,
  children
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} tabIndex={-1} className="settings-section mb-7">
      <h3
        className="mb-3 text-[11px] font-medium uppercase tracking-widest"
        style={{ color: 'var(--text-muted)' }}
      >
        {title}
      </h3>
      <div
        className="rounded-2xl p-5"
        style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
      >
        {children}
      </div>
    </section>
  )
}

function Row({
  label,
  desc,
  children,
  last
}: {
  label: string
  desc?: string
  children: React.ReactNode
  last?: boolean
}) {
  return (
    <div
      className={cn('flex items-center justify-between py-3.5', !last && 'border-b')}
      style={!last ? { borderColor: 'var(--border-subtle)' } : undefined}
    >
      <div>
        <p className="text-[13px] font-medium text-zinc-300">{label}</p>
        {desc && (
          <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {desc}
          </p>
        )}
      </div>
      {children}
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
  disabled = false
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="toggle-switch relative h-[26px] w-[46px] shrink-0 rounded-full transition-colors"
      data-checked={checked}
      style={{ background: checked ? 'var(--accent)' : 'var(--toggle-off-bg)' }}
    >
      <div
        className={cn(
          'absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-[3px]'
        )}
      />
    </button>
  )
}

function BackupFolderRow({
  path,
  onPick,
  onOpen,
  onReset
}: {
  path: string
  onPick: () => void
  onOpen: () => void
  onReset: () => void
}) {
  const { t } = useTranslation('settings')
  const isCustom = path.length > 0
  const displayPath = isCustom
    ? path
    : t('backupFolderDefaultLabel', 'Default (Documents/SuperSonicCleaner Backups)')
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[13px] font-medium text-zinc-300">
          {t('backupFolderLabel', 'Backup folder')}
        </p>
        <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {t(
            'backupFolderDesc',
            'Where SuperSonicCleaner writes registry and shell-extension backups before making changes. Existing backups stay in their previous location when you switch folders.'
          )}
        </p>
      </div>
      <div className="flex items-center gap-2.5">
        <div
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-4 py-2.5"
          style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
        >
          <FolderOpen
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: 'var(--text-muted)' }}
            strokeWidth={1.8}
          />
          <span className="truncate font-mono text-[12px] text-zinc-400" title={displayPath}>
            {displayPath}
          </span>
        </div>
        <button
          onClick={onOpen}
          title={t('backupFolderOpenTooltip', 'Open in file manager')}
          className="rounded-xl p-2.5 text-zinc-400 transition-colors"
          style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--bg-subtle-2)'
          }}
        >
          <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
        {isCustom && (
          <button
            onClick={onReset}
            title={t('backupFolderResetTooltip', 'Reset to default')}
            className="rounded-xl p-2.5 text-zinc-400 transition-colors"
            style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-subtle-2)'
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        )}
        <button
          onClick={onPick}
          className="rounded-xl px-4 py-2.5 text-[13px] font-medium text-zinc-400 transition-colors"
          style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--bg-subtle-2)'
          }}
        >
          {t('backupFolderChooseButton', 'Choose…')}
        </button>
      </div>
    </div>
  )
}

function ThemeSelector({
  value,
  onChange
}: {
  value: 'dark' | 'light' | 'system'
  onChange: (v: 'dark' | 'light' | 'system') => void
}) {
  const { t } = useTranslation('settings')
  const options: { id: 'dark' | 'light' | 'system'; icon: typeof Sun; label: string }[] = [
    { id: 'system', icon: Monitor, label: t('themeSystem') },
    { id: 'light', icon: Sun, label: t('themeLight') },
    { id: 'dark', icon: Moon, label: t('themeDark') }
  ]
  return (
    <div
      className="flex gap-1 rounded-lg p-0.5"
      style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
    >
      {options.map((opt) => {
        const active = value === opt.id
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-all"
            style={{
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? 'var(--text-on-accent)' : 'var(--text-muted)'
            }}
          >
            <opt.icon className="h-3.5 w-3.5" strokeWidth={1.8} />
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
