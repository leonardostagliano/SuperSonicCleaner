import { useLayoutEffect, useRef } from 'react'

export interface CheckboxProps {
  checked: boolean
  /** Mixed state ("some selected"); set on the input itself, as HTML has no attribute for it. */
  indeterminate?: boolean
  onChange: (value: boolean) => void
  /** The accessible name, usually the row's item. */
  label: string
  disabled?: boolean
}

/** The only checkbox: the native input, redrawn with tokens (4 px box radius). */
export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  disabled
}: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null)
  // Every render: a click clears the DOM flag even when the prop did not change.
  useLayoutEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  })
  return (
    <input
      ref={ref}
      type="checkbox"
      className="ui-checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => onChange(event.target.checked)}
    />
  )
}
