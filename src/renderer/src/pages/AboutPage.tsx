import { useTranslation } from 'react-i18next'
import { Github, Bug, ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { AppUpdateCard } from '@/components/updates/AppUpdates'
import { APP_REPOSITORY_URL } from '@shared/app-release'
import logoSrc from '@/assets/logo.png'
import { BrandWordmark } from '@/components/shared/BrandWordmark'

declare const __APP_VERSION__: string

export function AboutPage() {
  const { t } = useTranslation('settings')
  return (
    <div className="animate-fade-in">
      <PageHeader title={t('sectionAbout')} />
      <section className="glass-card rounded-2xl p-7">
        <div className="flex flex-wrap items-center gap-5">
          <img src={logoSrc} alt="" className="h-20 w-20" />
          <div className="min-w-0 flex-1">
            <BrandWordmark className="mb-3" />
            <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              {t('appVersion', { version: __APP_VERSION__ })}
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
              {t('license')}
            </p>
          </div>
          <span className="app-release-channel">{t('forkEdition')}</span>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <LinkButton icon={Github} label={t('github')} href={APP_REPOSITORY_URL} />
          <LinkButton icon={Bug} label={t('reportBug')} href={`${APP_REPOSITORY_URL}/issues`} />
        </div>
      </section>
      <AppUpdateCard />
      <div className="mt-6 flex flex-wrap items-center gap-4 p-2">
        <Github size={19} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>
            {t('upstreamCredit')}
          </p>
          <p className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {t('forkAttribution')}
          </p>
        </div>
        <LinkButton
          icon={Github}
          label={t('upstreamRepository')}
          href="https://github.com/AdventDevInc/kudu"
        />
      </div>
    </div>
  )
}

function LinkButton({
  icon: Icon,
  label,
  href
}: {
  icon: typeof Github
  label: string
  href: string
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="pulse-button">
      <Icon size={15} strokeWidth={1.8} aria-hidden="true" /> {label}
      <ExternalLink size={12} aria-hidden="true" />
    </a>
  )
}
