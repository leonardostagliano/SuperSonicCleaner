import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import i18next from 'i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Globe } from 'lucide-react'
import { LANGUAGES } from '@/lib/languages'
import { usePlatform } from '@/hooks/usePlatform'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { BrandWordmark } from '@/components/shared/BrandWordmark'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'

interface OnboardingProps {
  /** Records that onboarding is done; awaited before anything that can stall. */
  onComplete: () => void | Promise<void>
}

interface OnboardingSettings {
  runAtStartup: boolean
  minimizeToTray: boolean
  scheduledClean: boolean
}

const TOTAL_STEPS = 4

export function Onboarding({ onComplete }: OnboardingProps) {
  const { t } = useTranslation('onboarding')
  const { isPortable } = usePlatform()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [settings, setSettings] = useState<OnboardingSettings>({
    runAtStartup: true,
    minimizeToTray: true,
    scheduledClean: true
  })

  const applyAndFinish = async () => {
    // Record completion first. Applying the startup preference below shells out
    // to Task Scheduler — three schtasks calls with a 10s timeout each — so the
    // wizard can sit there for seconds before this line would otherwise be
    // reached. Quitting during that window used to lose the flag entirely and
    // the wizard came back on the next launch, forever (issue #269). The
    // preferences are all editable in Settings; the flag is not.
    navigate('/')
    await onComplete()

    try {
      const settingsPayload: Record<string, unknown> = {
        ...(!isPortable && { runAtStartup: settings.runAtStartup }),
        minimizeToTray: settings.minimizeToTray
      }
      if (settings.scheduledClean) {
        settingsPayload.schedule = { enabled: true, frequency: 'weekly', day: 1, hour: 9 }
      }
      await window.kudu?.settingsSet?.(settingsPayload)
      if (!isPortable) await window.kudu?.applyStartup?.(settings.runAtStartup).catch(() => {})
      window.kudu?.applyTray?.(settings.minimizeToTray)
    } catch {
      // Best-effort
    }
  }

  return (
    <div className="onboarding-overlay fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="onboarding-card relative w-full max-w-lg"
        role="dialog"
        aria-modal="true"
        aria-label={t('dialogLabel')}
      >
        <p className="onboarding-step">{t('stepOf', { step: step + 1, total: TOTAL_STEPS })}</p>
        <AnimatePresence mode="wait">
          {step === 0 && <LanguageStep key="language" onNext={() => setStep(1)} />}
          {step === 1 && (
            <WelcomeStep key="welcome" onBack={() => setStep(0)} onNext={() => setStep(2)} />
          )}
          {step === 2 && (
            <SettingsStep
              key="settings"
              settings={settings}
              onChange={setSettings}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
            />
          )}
          {step === 3 && (
            <FinishStep
              key="finish"
              scheduledClean={settings.scheduledClean}
              onBack={() => setStep(2)}
              onFinish={applyAndFinish}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

/** Steps cross-fade in 200 ms; no movement, and no animation under reduced motion. */
function StepWrapper({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.2 }}
    >
      {children}
    </motion.div>
  )
}

function LanguageStep({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation('onboarding')
  const [selected, setSelected] = useState(i18next.language)

  const handleSelect = (code: string) => {
    setSelected(code)
    i18next.changeLanguage(code)
    window.kudu?.settingsSet?.({ language: code }).catch(() => {})
  }

  return (
    <StepWrapper>
      <h2 className="onboarding-title">{t('chooseLanguageTitle')}</h2>
      <p className="onboarding-text">{t('chooseLanguageDescription')}</p>
      <div className="onboarding-languages" role="radiogroup" aria-label={t('chooseLanguageTitle')}>
        {LANGUAGES.map((lang) => {
          const checked = selected === lang.code
          return (
            <button
              key={lang.code}
              type="button"
              role="radio"
              aria-checked={checked}
              lang={lang.code}
              onClick={() => handleSelect(lang.code)}
              className="onboarding-language"
            >
              <span>{lang.nativeName}</span>
              {checked && <Check size={16} strokeWidth={1.75} aria-hidden="true" />}
            </button>
          )
        })}
      </div>
      <div className="onboarding-actions">
        <Button variant="primary" size="lg" onClick={onNext}>
          {t('continue')}
        </Button>
      </div>
    </StepWrapper>
  )
}

function WelcomeStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { t } = useTranslation('onboarding')
  const { platform, features } = usePlatform()
  const facts = [
    t('factPreview'),
    ...(features.registry ? [t('factRegistryBackup')] : []),
    t('factAi')
  ]
  return (
    <StepWrapper>
      <BrandWordmark size="large" className="mb-6" />
      <h2 className="onboarding-title">{t('welcomeTitle')}</h2>
      <p className="onboarding-text">
        {platform === 'win32' ? t('welcomeDescriptionWindows') : t('welcomeDescriptionOther')}
      </p>
      <ul className="onboarding-facts" aria-label={t('factsLabel')}>
        {facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
      <div className="onboarding-actions">
        <Button
          variant="ghost"
          size="lg"
          icon={Globe}
          aria-label={t('changeLanguage')}
          title={t('changeLanguage')}
          onClick={onBack}
        />
        <Button variant="primary" size="lg" onClick={onNext}>
          {t('getStarted')}
        </Button>
      </div>
    </StepWrapper>
  )
}

function SettingsStep({
  settings,
  onChange,
  onBack,
  onNext
}: {
  settings: OnboardingSettings
  onChange: (s: OnboardingSettings) => void
  onBack: () => void
  onNext: () => void
}) {
  const { t } = useTranslation('onboarding')
  const { platform, isPortable } = usePlatform()
  const isWin = platform === 'win32'
  return (
    <StepWrapper>
      <h2 className="onboarding-title">{t('recommendedSetupTitle')}</h2>
      <p className="onboarding-text">{t('recommendedSetupDescription')}</p>
      <div className="onboarding-settings">
        {!isPortable && (
          <SettingRow
            label={t('runAtStartupLabel')}
            desc={isWin ? t('runAtStartupDescriptionWindows') : t('runAtStartupDescriptionOther')}
            checked={settings.runAtStartup}
            onChange={(v) => onChange({ ...settings, runAtStartup: v })}
          />
        )}
        <SettingRow
          label={t('minimizeToTrayLabel')}
          desc={t('minimizeToTrayDescription')}
          checked={settings.minimizeToTray}
          onChange={(v) => onChange({ ...settings, minimizeToTray: v })}
        />
        <SettingRow
          label={t('weeklyAutoCleanLabel')}
          desc={t('weeklyAutoCleanDescription')}
          checked={settings.scheduledClean}
          onChange={(v) => onChange({ ...settings, scheduledClean: v })}
        />
      </div>
      <div className="onboarding-actions">
        <Button variant="ghost" size="lg" onClick={onBack}>
          {t('back')}
        </Button>
        <Button variant="primary" size="lg" onClick={onNext}>
          {t('continue')}
        </Button>
      </div>
    </StepWrapper>
  )
}

function SettingRow({
  label,
  desc,
  checked,
  onChange
}: {
  label: string
  desc: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="onboarding-setting">
      <div className="min-w-0 flex-1">
        <p className="onboarding-setting-label">{label}</p>
        <p className="onboarding-setting-desc">{desc}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  )
}

function FinishStep({
  scheduledClean,
  onBack,
  onFinish
}: {
  scheduledClean: boolean
  onBack: () => void
  onFinish: () => void
}) {
  const { t } = useTranslation('onboarding')
  return (
    <StepWrapper>
      <h2 className="onboarding-title">{t('allSetTitle')}</h2>
      <p className="onboarding-text">{t('allSetDescription')}</p>
      {scheduledClean && <p className="onboarding-text">{t('firstScanScheduled')}</p>}
      <div className="onboarding-actions">
        <Button variant="ghost" size="lg" onClick={onBack}>
          {t('back')}
        </Button>
        <Button variant="primary" size="lg" onClick={onFinish}>
          {t('startCleaning')}
        </Button>
      </div>
    </StepWrapper>
  )
}
