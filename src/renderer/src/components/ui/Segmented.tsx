import { useRef, type KeyboardEvent } from 'react'
import { nextSegmentIndex } from './segmented-keys'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** The accessible name of the group. */
  label: string
}

/** The only segmented control: a radiogroup with roving focus (arrows, Home, End). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label
}: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const selected = options.findIndex((option) => option.value === value)
  const tabStop = selected === -1 ? 0 : selected

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const dir = getComputedStyle(event.currentTarget).direction === 'rtl' ? 'rtl' : 'ltr'
    const next = nextSegmentIndex(event.key, index, options.length, dir)
    if (next === null) return
    event.preventDefault()
    refs.current[next]?.focus()
    if (options[next].value !== value) onChange(options[next].value)
  }

  return (
    <div role="radiogroup" aria-label={label} className="ui-segmented">
      {options.map((option, index) => {
        const checked = option.value === value
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === tabStop ? 0 : -1}
            className="ui-segmented-option"
            onClick={() => {
              if (!checked) onChange(option.value)
            }}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
