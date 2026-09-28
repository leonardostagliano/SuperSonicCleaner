import './about-page.css'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader'
import { AppUpdateCard } from '@/components/updates/AppUpdates'
import { Card, Section } from '@/components/ui'
import { APP_REPOSITORY_URL } from '@shared/app-release'
import { icons } from '@/lib/icons'
import logoSrc from '@/assets/logo.png'
import { BrandWordmark } from '@/components/shared/BrandWordmark'

declare const __APP_VERSION__: string

const UPSTREAM_URL = 'https://github.com/AdventDevInc/kudu'

export function AboutPage() {
  const { t } = useTranslation('settings')
  return (
    <div className="about-page">
      <PageHeader title={t('sectionAbout')} />
      <div className="about-stack">
        <Card className="about-product">
          <img src={logoSrc} alt="" className="about-logo" />
          <div className="about-product-text">
            <BrandWordmark className="about-wordmark" />
            <h2 className="about-version">{t('appVersion', { version: __APP_VERSION__ })}</h2>
            <p className="about-meta">
              {t('license')} · {t('forkEdition')}
            </p>
          </div>
          <div className="about-links">
            <ExternalLink href={APP_REPOSITORY_URL} label={t('github')} />
            <ExternalLink href={`${APP_REPOSITORY_URL}/issues`} label={t('reportBug')} />
          </div>
        </Card>

        <AppUpdateCard />

        <Section
          title={t('upstreamCredit')}
          actions={<ExternalLink href={UPSTREAM_URL} label={t('upstreamRepository')} />}
        >
          <p className="about-text">{t('forkAttribution')}</p>
        </Section>
      </div>
    </div>
  )
}

/** A link that leaves the app, drawn as a secondary button with the external glyph. */
function ExternalLink({ href, label }: { href: string; label: string }) {
  const External = icons.external
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="ui-button"
      data-variant="secondary"
      data-size="md"
    >
      <External className="ui-button-icon" size={16} strokeWidth={1.75} aria-hidden="true" />
      <span className="ui-button-label">{label}</span>
    </a>
  )
}
