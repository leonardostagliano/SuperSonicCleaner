import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Card'
import './storage.css'

/**
 * What a folder tool will read: the folder and a one-line summary of the filters, with the
 * filter fields behind "Edit". Labels come from the page's namespace (`ns`), which defines
 * scopeTitle, folderLabel, noFolder, chooseFolder, changeFolder, filtersLabel, editFilters
 * and closeFilters.
 */
export function FolderScope({
  ns,
  folder,
  onChooseFolder,
  filtersSummary,
  disabled,
  children
}: {
  ns: string
  folder: string | null
  onChooseFolder: () => void
  filtersSummary: string
  disabled?: boolean
  children: ReactNode
}) {
  const { t } = useTranslation(ns)
  const [editing, setEditing] = useState(false)
  const filtersId = useId()
  return (
    <Section title={t('scopeTitle')}>
      <div className="storage-scope-row">
        <span className="storage-scope-label">{t('folderLabel')}</span>
        <span
          className={folder ? 'storage-scope-value storage-mono' : 'storage-scope-value'}
          data-empty={folder ? undefined : ''}
        >
          {folder ?? t('noFolder')}
        </span>
        <Button icon={FolderOpen} onClick={onChooseFolder} disabled={disabled}>
          {folder ? t('changeFolder') : t('chooseFolder')}
        </Button>
      </div>
      <div className="storage-scope-row">
        <span className="storage-scope-label">{t('filtersLabel')}</span>
        <span className="storage-scope-value">{filtersSummary}</span>
        <Button
          variant="ghost"
          aria-expanded={editing}
          aria-controls={filtersId}
          onClick={() => setEditing((open) => !open)}
          disabled={disabled}
        >
          {editing ? t('closeFilters') : t('editFilters')}
        </Button>
      </div>
      {editing && (
        <div id={filtersId} className="storage-filters">
          {children}
        </div>
      )}
    </Section>
  )
}

/** One filter: a visible label over its control. */
export function FilterField({
  label,
  htmlFor,
  wide,
  children
}: {
  label: string
  /** The input the label names; leave it out for a group that names itself (Segmented). */
  htmlFor?: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    <div className="storage-field" data-wide={wide || undefined}>
      {htmlFor ? (
        <label className="storage-field-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="storage-field-label" aria-hidden="true">
          {label}
        </span>
      )}
      {children}
    </div>
  )
}

/** The folder levels a scan descends, 1..50 as the main process accepts. */
export function DepthInput({
  id,
  value,
  onChange
}: {
  id: string
  value: number
  onChange: (depth: number) => void
}) {
  return (
    <input
      id={id}
      type="number"
      min={1}
      max={50}
      value={value}
      onChange={(e) => onChange(Math.max(1, Math.min(50, parseInt(e.target.value) || 20)))}
      className="storage-input"
    />
  )
}

/**
 * Folder names skipped by the scan. Labels from the page's namespace: excludePlaceholder,
 * addExclude, removeExclude ({{name}}).
 */
export function ExcludeEditor({
  ns,
  id,
  patterns,
  onChange
}: {
  ns: string
  id: string
  patterns: string[]
  onChange: (patterns: string[]) => void
}) {
  const { t } = useTranslation(ns)
  const [draft, setDraft] = useState('')
  const add = () => {
    const value = draft.trim()
    if (value && !patterns.includes(value)) onChange([...patterns, value])
    setDraft('')
  }
  return (
    <div className="storage-chips">
      {patterns.map((pattern) => (
        <span key={pattern} className="storage-chip">
          {pattern}
          <button
            type="button"
            className="storage-icon-action"
            aria-label={t('removeExclude', { name: pattern })}
            title={t('removeExclude', { name: pattern })}
            onClick={() => onChange(patterns.filter((p) => p !== pattern))}
          >
            <X size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </span>
      ))}
      <span className="storage-add">
        <input
          id={id}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
          placeholder={t('excludePlaceholder')}
          className="storage-input"
        />
        <Button variant="ghost" icon={Plus} onClick={add} disabled={!draft.trim()}>
          {t('addExclude')}
        </Button>
      </span>
    </div>
  )
}
