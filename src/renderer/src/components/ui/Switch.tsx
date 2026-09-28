export interface SwitchProps {
  checked: boolean
  onChange: (value: boolean) => void
  /** The accessible name; the visible text sits next to the switch in the row. */
  label: string
  disabled?: boolean
  id?: string
}

/** The only on/off switch: a button with role="switch" and aria-checked. */
export function Switch({ checked, onChange, label, disabled, id }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="ui-switch"
      onClick={() => onChange(!checked)}
    >
      <span className="ui-switch-thumb" aria-hidden="true" />
    </button>
  )
}
