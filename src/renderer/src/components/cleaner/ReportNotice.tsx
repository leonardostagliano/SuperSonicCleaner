import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { icons } from '@/lib/icons'
import './pulizia.css'

export interface ReportNoticeProps {
  /** One sentence: what happened or what to do. */
  title: string
  /** Names, paths or the reason, in muted text. */
  detail?: ReactNode
  /** A button that resolves the notice (relaunch, open settings). */
  action?: ReactNode
  /** 'danger' only for errors; warnings stay neutral (spec 3.1). */
  tone?: 'neutral' | 'danger'
  /** Defaults to the warning glyph. */
  icon?: LucideIcon
  /** Renders as a list item inside `.pulizia-notices`. */
  as?: 'li' | 'div'
  role?: 'alert' | 'status'
}

/** A generic warning or error line: icon, neutral text, optional action. */
export function ReportNotice({
  title,
  detail,
  action,
  tone = 'neutral',
  icon: Icon = icons.warning,
  as: Element = 'li',
  role
}: ReportNoticeProps) {
  return (
    <Element className="pulizia-notice" data-tone={tone} role={role}>
      <Icon className="pulizia-notice-icon" size={16} strokeWidth={1.75} aria-hidden="true" />
      <div className="pulizia-notice-body">
        <p className="pulizia-notice-title">{title}</p>
        {detail && <p className="pulizia-notice-detail">{detail}</p>}
      </div>
      {action && <div className="pulizia-notice-action">{action}</div>}
    </Element>
  )
}
