import { useId } from 'react'

// Two-handle slider over whole days. The track between the handles is the chosen window.
export function DayRange({ min, max, limit = 30, onChange, disabled, label }: {
  min: number
  max: number
  limit?: number
  onChange: (next: { min: number; max: number }) => void
  disabled?: boolean
  label: { from: string; to: string }
}) {
  const id = useId()
  const left = (min / limit) * 100
  const right = 100 - (max / limit) * 100
  return (
    <div className={`k1-dayrange${disabled ? ' is-disabled' : ''}`}>
      <div className="k1-dayrange__track" aria-hidden="true">
        <span className="k1-dayrange__fill" style={{ left: `${left}%`, right: `${right}%` }} />
      </div>
      <input
        id={`${id}-from`}
        type="range"
        min={0}
        max={limit}
        step={1}
        value={min}
        disabled={disabled}
        aria-label={label.from}
        style={{ zIndex: min > limit / 2 ? 2 : 1 }}
        aria-valuetext={String(min)}
        onChange={(event) => onChange({ min: Math.min(Number(event.target.value), max), max })}
      />
      <input
        id={`${id}-to`}
        type="range"
        min={0}
        max={limit}
        step={1}
        value={max}
        disabled={disabled}
        aria-label={label.to}
        aria-valuetext={String(max)}
        onChange={(event) => onChange({ min, max: Math.max(Number(event.target.value), min) })}
      />
    </div>
  )
}
