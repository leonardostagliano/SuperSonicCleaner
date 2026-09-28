import { cn } from '@/lib/utils'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { crumbFor, navLabel } from '@/lib/navigation'
import { pageExperiences } from './page-experiences'
import './page-header.css'

interface PageHeaderProps {
  title: string
  /** The scope sentence: what the page reads or changes, and its limits. */
  description?: string
  /** At most one primary button. */
  action?: React.ReactNode
  className?: string
  /** Ignored: the workflow strip is gone. Removed with the last callers in Task C1. */
  showWorkflow?: boolean
}

/** Crumb from the sidebar group, title, scope sentence and actions (spec 5.4). */
export function PageHeader({ title, description, action, className }: PageHeaderProps) {
  const { pathname } = useLocation()
  const { t } = useTranslation('experience')
  const crumb = crumbFor(pathname)
  const experience = pageExperiences[pathname]
  const scope =
    description ?? (experience ? t(`routes.${experience.key}`, { defaultValue: '' }) : '')
  return (
    <header className={cn('page-header', className)}>
      {crumb && (
        <p className="page-header-crumb">
          {navLabel(t, crumb.group)} <span aria-hidden="true">›</span> {navLabel(t, crumb.item)}
        </p>
      )}
      <div className="page-header-main">
        <div className="page-header-heading">
          <h1>{title}</h1>
          {scope && <p className="page-header-scope">{scope}</p>}
        </div>
        {action && <div className="page-header-actions">{action}</div>}
      </div>
    </header>
  )
}
