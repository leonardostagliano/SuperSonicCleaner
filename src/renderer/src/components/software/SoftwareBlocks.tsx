import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, Search, X, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import './software.css'

/*
 * Blocks shared by the Software pages (/updates, /drivers, /uninstaller, /debloater,
 * /context-menu) on top of components/ui.
 */

export interface SummaryCardProps {
  /** The number that matters ("37 app da aggiornare"). */
  title: string
  /** Breakdown and provenance ("6 principali · 21 secondarie · controllato alle 18:40"). */
  detail?: ReactNode
  /** The primary button that says what it does ("Aggiorna 37 app"). */
  action?: ReactNode
  className?: string
}

/** The summary above a result list: one number, one line of detail, one action. */
export function SummaryCard({ title, detail, action, className }: SummaryCardProps) {
  return (
    <Card className={cn('sw-summary', className)}>
      <div className="sw-summary-text">
        <h2 className="sw-summary-title">{title}</h2>
        {detail && <p className="sw-summary-detail">{detail}</p>}
      </div>
      {action && <div className="sw-summary-actions">{action}</div>}
    </Card>
  )
}

export interface ProgressCardProps {
  /** What is happening ("Aggiornamento di 7-Zip (2 di 5)"). */
  title: string
  /** Right of the title: a percentage or "2 di 5". */
  meta?: string
  /** 0..1; leave it out while the amount is unknown. */
  value?: number
  /** The item being worked on (a path, a device), truncated with the full text on hover. */
  detail?: string
  /** Further lines (elapsed time, hints). */
  children?: ReactNode
  /** A control that stops the work ("Annulla"). */
  action?: ReactNode
  /** 'danger' only when the operation is failing. */
  tone?: 'neutral' | 'danger'
}

/** A running operation: title, flat bar, current item. */
export function ProgressCard({
  title,
  meta,
  value,
  detail,
  children,
  action,
  tone = 'neutral'
}: ProgressCardProps) {
  return (
    <Card className="sw-progress">
      <div className="sw-progress-head">
        {/* Only title and count are announced: the detail line changes too often. */}
        <div className="sw-progress-status" role="status">
          <p className="sw-progress-title" title={title}>
            {title}
          </p>
          {meta && <span className="sw-progress-meta">{meta}</span>}
        </div>
        {action}
      </div>
      <ProgressBar label={title} value={value} indeterminate={value === undefined} tone={tone} />
      {detail && (
        <p className="sw-progress-detail" title={detail}>
          {detail}
        </p>
      )}
      {children}
    </Card>
  )
}

export interface NoteProps {
  /** 'warning' (AlertTriangle) for limits and risks, 'note' (Info) for plain remarks. */
  icon?: 'warning' | 'note'
  title?: string
  children?: ReactNode
  /** Buttons on the right ("Riavvia come amministratore"). */
  action?: ReactNode
  onDismiss?: () => void
  dismissLabel?: string
  className?: string
}

/** A neutral remark: icon and text, no colour. Errors use ErrorAlert, results use Receipt. */
export function Note({
  icon = 'note',
  title,
  children,
  action,
  onDismiss,
  dismissLabel,
  className
}: NoteProps) {
  const Icon = icon === 'warning' ? icons.warning : icons.note
  return (
    <Card className={cn('sw-note', className)}>
      <Icon className="sw-note-icon" size={16} strokeWidth={1.75} aria-hidden="true" />
      <div className="sw-note-body">
        {title && <p className="sw-note-title">{title}</p>}
        {children && <div className="sw-note-text">{children}</div>}
      </div>
      {(action || onDismiss) && (
        <div className="sw-note-aside">
          {action}
          {onDismiss && (
            <Button
              variant="ghost"
              icon={X}
              onClick={onDismiss}
              aria-label={dismissLabel}
              title={dismissLabel}
            />
          )}
        </div>
      )}
    </Card>
  )
}

export interface SearchFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  /** The accessible name when the placeholder is not enough. */
  label?: string
}

export function SearchField({ value, onChange, placeholder, label }: SearchFieldProps) {
  return (
    <div className="sw-search">
      <Search className="sw-search-icon" size={16} strokeWidth={1.75} aria-hidden="true" />
      <input
        type="search"
        className="sw-search-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
      />
    </div>
  )
}

export interface MenuOption<T extends string> {
  value: T
  label: string
}

export interface MenuButtonProps<T extends string> {
  /** Visible button text: usually the current choice ("Nome"). */
  label: string
  /** The accessible name of the menu ("Ordina per"). */
  menuLabel: string
  icon?: LucideIcon
  options: MenuOption<T>[]
  value: T
  /** Shown next to the checked option ("A-Z"). */
  checkedHint?: string
  onSelect: (value: T) => void
  disabled?: boolean
}

/** A button that opens a short list of choices (sorting). Escape or a click outside closes it. */
export function MenuButton<T extends string>({
  label,
  menuLabel,
  icon,
  options,
  value,
  checkedHint,
  onSelect,
  disabled
}: MenuButtonProps<T>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    rootRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="sw-menu" ref={rootRef}>
      <Button
        ref={buttonRef}
        icon={icon}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${menuLabel}: ${label}`}
        disabled={disabled}
      >
        {label}
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
      </Button>
      {open && (
        <ul id={listId} role="menu" aria-label={menuLabel} className="sw-menu-list">
          {options.map((option) => {
            const checked = option.value === value
            return (
              <li key={option.value} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={checked}
                  className="sw-menu-item"
                  onClick={() => {
                    onSelect(option.value)
                    setOpen(false)
                    buttonRef.current?.focus()
                  }}
                >
                  <span className="sw-menu-check" aria-hidden="true">
                    {checked && <Check size={14} strokeWidth={1.75} />}
                  </span>
                  {option.label}
                  {checked && checkedHint && <span className="sw-menu-hint">{checkedHint}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export interface DisclosureProps {
  /** The heading with its count ("Ignorate (3)"). */
  label: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}

/** A collapsed list under a counted heading (ignored items, apps already up to date). */
export function Disclosure({ label, open, onToggle, children }: DisclosureProps) {
  const regionId = useId()
  return (
    <div className="sw-disclosure">
      <button
        type="button"
        className="sw-disclosure-toggle"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={onToggle}
      >
        <ChevronRight
          className="sw-disclosure-chevron"
          size={16}
          strokeWidth={1.75}
          aria-hidden="true"
        />
        {label}
      </button>
      {open && <div id={regionId}>{children}</div>}
    </div>
  )
}
