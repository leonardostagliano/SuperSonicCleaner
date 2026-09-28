import './settings-page.css'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Plus, Undo2, X } from 'lucide-react'
import { toast } from 'sonner'
import i18next from 'i18next'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button, Section, Segmented, Switch } from '@/components/ui'
import { useSettingsStore } from '@/stores/settings-store'
import { usePlatform } from '@/hooks/usePlatform'
import { LANGUAGES } from '@/lib/languages'

const SECTIONS = [
  'sectionGeneral',
  'sectionBackups',
  'sectionCleaningPreferences',
  'sectionExclusions'
] as const

export function SettingsPage() {
  const { t } = useTranslation('settings')
  const { features, platform, isPortable } = usePlatform()
  const { settings, saveSettings, setSettings } = useSettingsStore()
  const [newExclusion, setNewExclusion] = useState('')
  const [savingStartup, setSavingStartup] = useState(false)
  const exclusionId = useId()

  useEffect(() => {
    window.kudu
      ?.settingsGet?.()
      .then(setSettings)
      .catch(() => {})
  }, [setSettings])

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
      // Revert the switch: the OS rejected the change
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

  const cleaner = settings.cleaner
  const saveCleaner = (partial: Partial<typeof cleaner>) =>
    save({ cleaner: { ...cleaner, ...partial } })

  return (
    <div className="prefs-page">
      <PageHeader title={t('pageTitle')} description={t('routes.settings', { ns: 'experience' })} />

      <nav className="prefs-nav" aria-label={t('sectionsNav')}>
        {SECTIONS.map((key) => (
          <button
            key={key}
            type="button"
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

      <div className="prefs-stack">
        <PrefsSection id="sectionGeneral" title={t('sectionGeneral')}>
          <Row label={t('themeLabel')} help={t('themeDesc')}>
            <Segmented<'system' | 'light' | 'dark'>
              label={t('themeLabel')}
              value={settings.theme}
              onChange={(theme) => void save({ theme })}
              options={[
                { value: 'system', label: t('themeSystem') },
                { value: 'light', label: t('themeLight') },
                { value: 'dark', label: t('themeDark') }
              ]}
            />
          </Row>
          <Row label={t('languageLabel')} help={t('languageDesc')} control="select">
            {(id) => (
              <select
                id={id}
                value={settings.language}
                onChange={(e) => void save({ language: e.target.value })}
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.nativeName} ({lang.name})
                  </option>
                ))}
              </select>
            )}
          </Row>
          {isPortable ? (
            <Row label={t('runAtStartupLabel')} help={t('portableStartupDesc')}>
              <span className="prefs-value">{t('portableManual')}</span>
            </Row>
          ) : (
            <SwitchRow
              label={t('runAtStartupLabel')}
              help={t('runAtStartupDesc')}
              checked={settings.runAtStartup}
              onChange={(v) => void saveStartup(v)}
              disabled={savingStartup}
            />
          )}
          <SwitchRow
            label={t('minimizeToTrayLabel')}
            help={t('minimizeToTrayDesc')}
            checked={settings.minimizeToTray}
            onChange={(v) => void saveTray(v)}
          />
          <SwitchRow
            label={t('showNotificationsLabel')}
            help={t('showNotificationsDesc')}
            checked={settings.showNotificationOnComplete}
            onChange={(v) => void save({ showNotificationOnComplete: v })}
          />
          {!isPortable && (
            <>
              <SwitchRow
                label={t('autoUpdateLabel')}
                help={t('autoUpdateDesc')}
                checked={settings.autoUpdate}
                onChange={(v) => void save({ autoUpdate: v })}
              />
              <SwitchRow
                label={t('autoRestartLabel')}
                help={t('autoRestartDesc')}
                checked={settings.autoRestart}
                onChange={(v) => void save({ autoRestart: v })}
              />
              <Row
                label={t('updateCheckIntervalLabel')}
                help={t('updateCheckIntervalDesc')}
                control="select"
              >
                {(id) => (
                  <select
                    id={id}
                    value={settings.updateCheckIntervalHours}
                    onChange={(e) =>
                      void save({ updateCheckIntervalHours: Number(e.target.value) })
                    }
                  >
                    <option value={1}>{t('updateCheckEveryHour')}</option>
                    <option value={4}>{t('updateCheckEvery4Hours')}</option>
                    <option value={12}>{t('updateCheckEvery12Hours')}</option>
                    <option value={24}>{t('updateCheckOnceADay')}</option>
                  </select>
                )}
              </Row>
            </>
          )}
          <SwitchRow
            label={t('softwareUpdaterNotificationsLabel')}
            help={t('softwareUpdaterNotificationsDesc')}
            checked={settings.softwareUpdaterNotifications ?? true}
            onChange={(v) => void save({ softwareUpdaterNotifications: v })}
          />
          {platform !== 'darwin' && (
            <SwitchRow
              label={t('preferElevatedLaunchLabel')}
              help={t('preferElevatedLaunchDesc')}
              checked={settings.preferElevatedLaunch ?? false}
              onChange={(v) => void save({ preferElevatedLaunch: v })}
            />
          )}
        </PrefsSection>

        <PrefsSection id="sectionBackups" title={t('sectionBackups')}>
          <BackupFolderRow
            path={settings.backupPath}
            onPick={async () => {
              const picked = await window.kudu?.settingsSelectBackupDir?.()
              if (picked) {
                if (!(await save({ backupPath: picked }))) return
                toast.success(t('backupFolderUpdatedToast'), {
                  description: t('backupFolderUpdatedDesc')
                })
              }
            }}
            onOpen={() => {
              window.kudu?.settingsOpenBackupDir?.().catch(() => {})
            }}
            onReset={() => void save({ backupPath: '' })}
          />
          <Row label={t('backupModeLabel')} help={t('backupModeDesc')} control="select">
            {(id) => (
              <select
                id={id}
                value={settings.backupMode ?? 'targeted'}
                onChange={(e) => void save({ backupMode: e.target.value as 'targeted' | 'full' })}
              >
                <option value="targeted">{t('backupModeTargeted')}</option>
                <option value="full">{t('backupModeFull')}</option>
              </select>
            )}
          </Row>
        </PrefsSection>

        <PrefsSection id="sectionCleaningPreferences" title={t('sectionCleaningPreferences')}>
          <SwitchRow
            label={t('protectRecycleBinLabel')}
            help={t('protectRecycleBinDesc')}
            checked={cleaner.protectRecycleBin}
            onChange={(v) => void saveCleaner({ protectRecycleBin: v })}
          />
          <SwitchRow
            label={t('secureDeleteLabel')}
            help={t('secureDeleteDesc')}
            checked={cleaner.secureDelete}
            onChange={(v) => void saveCleaner({ secureDelete: v })}
          />
          <SwitchRow
            label={t('closeBrowsersLabel')}
            help={t('closeBrowsersDesc')}
            checked={cleaner.closeBrowsersBeforeClean}
            onChange={(v) => void saveCleaner({ closeBrowsersBeforeClean: v })}
          />
          {features.restorePoint && (
            <SwitchRow
              label={t('createRestorePointLabel')}
              help={t('createRestorePointDesc')}
              checked={cleaner.createRestorePoint}
              onChange={(v) => void saveCleaner({ createRestorePoint: v })}
            />
          )}
          <SwitchRow
            label={t('keepDeletionLogLabel')}
            help={t('keepDeletionLogDesc')}
            checked={cleaner.keepDeletionLog}
            onChange={(v) => void saveCleaner({ keepDeletionLog: v })}
          />
          <Row label={t('skipRecentFilesLabel')} help={t('skipRecentFilesDesc')} control="select">
            {(id) => (
              <select
                id={id}
                value={cleaner.skipRecentMinutes}
                onChange={(e) => void saveCleaner({ skipRecentMinutes: Number(e.target.value) })}
              >
                <option value={30}>{t('skipRecent30Min')}</option>
                <option value={60}>{t('skipRecent1Hour')}</option>
                <option value={120}>{t('skipRecent2Hours')}</option>
                <option value={1440}>{t('skipRecent24Hours')}</option>
              </select>
            )}
          </Row>
        </PrefsSection>

        <PrefsSection id="sectionExclusions" title={t('sectionExclusions')}>
          <p className="prefs-help">{t('exclusionsHelp')}</p>
          {settings.exclusions.length === 0 ? (
            <p className="prefs-empty">{t('noExclusionsConfigured')}</p>
          ) : (
            <ul className="prefs-exclusions">
              {settings.exclusions.map((exc, i) => (
                <li key={exc}>
                  <span className="prefs-path" title={exc}>
                    {exc}
                  </span>
                  <Button
                    variant="ghost"
                    icon={X}
                    aria-label={t('removeExclusion', { path: exc })}
                    onClick={() =>
                      void save({ exclusions: settings.exclusions.filter((_, j) => j !== i) })
                    }
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="prefs-add">
            <label htmlFor={exclusionId} className="prefs-visually-hidden">
              {t('addExclusionLabel')}
            </label>
            <input
              id={exclusionId}
              type="text"
              className="prefs-input"
              value={newExclusion}
              onChange={(e) => setNewExclusion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addExclusion()}
              placeholder={
                platform === 'win32'
                  ? t('exclusionPlaceholderWindows')
                  : t('exclusionPlaceholderOther')
              }
            />
            <Button icon={Plus} onClick={() => void addExclusion()}>
              {t('addButton')}
            </Button>
          </div>
        </PrefsSection>
      </div>
    </div>
  )
}

/** A Section the section links can scroll to and focus. */
function PrefsSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div id={id} tabIndex={-1} className="prefs-anchor">
      <Section title={title}>{children}</Section>
    </div>
  )
}

/** Label and help on the left, the control on the right; hairlines between rows. */
function Row({
  label,
  help,
  control,
  children
}: {
  label: string
  help?: string
  /** 'select' ties the label to the control with htmlFor. */
  control?: 'select'
  children: ReactNode | ((id: string) => ReactNode)
}) {
  const id = useId()
  return (
    <div className="prefs-row">
      <div className="prefs-row-text">
        {control ? (
          <label htmlFor={id} className="prefs-row-label">
            {label}
          </label>
        ) : (
          <p className="prefs-row-label">{label}</p>
        )}
        {help && <p className="prefs-row-help">{help}</p>}
      </div>
      <div className="prefs-row-control">
        {typeof children === 'function' ? children(id) : children}
      </div>
    </div>
  )
}

function SwitchRow({
  label,
  help,
  checked,
  onChange,
  disabled
}: {
  label: string
  help?: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="prefs-row">
      <div className="prefs-row-text">
        <label htmlFor={id} className="prefs-row-label">
          {label}
        </label>
        {help && <p className="prefs-row-help">{help}</p>}
      </div>
      <div className="prefs-row-control">
        <Switch id={id} label={label} checked={checked} onChange={onChange} disabled={disabled} />
      </div>
    </div>
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
  const displayPath = isCustom ? path : t('backupFolderDefaultLabel')
  return (
    <div className="prefs-row prefs-row-stacked">
      <div className="prefs-row-text">
        <p className="prefs-row-label">{t('backupFolderLabel')}</p>
        <p className="prefs-row-help">{t('backupFolderDesc')}</p>
      </div>
      <div className="prefs-folder">
        <span className="prefs-path prefs-folder-path" title={displayPath}>
          {displayPath}
        </span>
        <Button
          variant="ghost"
          icon={FolderOpen}
          aria-label={t('backupFolderOpenTooltip')}
          title={t('backupFolderOpenTooltip')}
          onClick={onOpen}
        />
        {isCustom && (
          <Button
            variant="ghost"
            icon={Undo2}
            aria-label={t('backupFolderResetTooltip')}
            title={t('backupFolderResetTooltip')}
            onClick={onReset}
          />
        )}
        <Button onClick={onPick}>{t('backupFolderChooseButton')}</Button>
      </div>
    </div>
  )
}
