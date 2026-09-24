import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Popover } from './overlay'
import { Select } from './controls'

const pad = (value: number) => String(value).padStart(2, '0')
export const isoDay = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const fromIso = (value: string) => {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

type Preset = '7' | '14' | '30' | 'custom'

function Month({ year, month, from, to, hover, today, onPick, onHover }: {
  year: number
  month: number
  from: string | null
  to: string | null
  hover: string | null
  today: string
  onPick: (day: string) => void
  onHover: (day: string | null) => void
}) {
  const first = new Date(year, month, 1)
  const days = new Date(year, month + 1, 0).getDate()
  const cells: Array<string | null> = [...Array(first.getDay()).fill(null), ...Array.from({ length: days }, (_, index) => isoDay(new Date(year, month, index + 1)))]
  const end = to ?? (from && hover && hover > from ? hover : null)
  return (
    <div className="k1-cal__month">
      <div className="k1-cal__grid" role="grid" aria-label={first.toLocaleDateString('en', { month: 'long', year: 'numeric' })}>
        {WEEKDAYS.map((day) => <span key={day} className="k1-cal__dow" aria-hidden="true">{day}</span>)}
        {cells.map((day, index) => {
          if (!day) return <span key={`blank-${index}`} />
          const future = day > today
          const edge = day === from || day === end
          const inRange = Boolean(from && end && day > from && day < end)
          return (
            <button
              key={day}
              type="button"
              className={`k1-cal__day${edge ? ' is-edge' : ''}${inRange ? ' is-range' : ''}`}
              disabled={future}
              aria-pressed={edge}
              aria-label={fromIso(day).toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              onClick={() => onPick(day)}
              onPointerEnter={() => onHover(day)}
              onFocus={() => onHover(day)}
            >
              {Number(day.slice(8))}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function DateRangeField({ id, from, to, onChange, today = isoDay(new Date()), leading, ariaLabel }: {
  id?: string
  leading?: ReactNode
  ariaLabel?: string
  from: string | null
  to: string | null
  onChange: (range: { from: string | null; to: string | null }) => void
  today?: string
}) {
  const [open, setOpen] = useState(false)
  const [preset, setPreset] = useState<Preset | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const anchor = useRef<HTMLButtonElement>(null)
  const base = fromIso(to ?? today)
  const [view, setView] = useState({ year: base.getFullYear(), month: base.getMonth() })
  const left = new Date(view.year, view.month - 1, 1)
  const right = new Date(view.year, view.month, 1)

  const pick = (day: string) => {
    setPreset('custom')
    if (!from || (from && to)) onChange({ from: day, to: null })
    else if (day < from) onChange({ from: day, to: from })
    else onChange({ from, to: day })
  }

  const applyPreset = (value: Preset) => {
    setPreset(value)
    if (value === 'custom') return
    const end = fromIso(today)
    onChange({ from: isoDay(addDays(end, -(Number(value) - 1))), to: today })
    setView({ year: end.getFullYear(), month: end.getMonth() })
  }

  const shift = (delta: number) => setView(({ year, month }) => {
    const next = new Date(year, month + delta, 1)
    return { year: next.getFullYear(), month: next.getMonth() }
  })

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (!target.classList.contains('k1-cal__day')) return
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
    const delta = moves[event.key]
    if (!delta) return
    event.preventDefault()
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.k1-cal__day')]
    const index = buttons.indexOf(target as HTMLButtonElement)
    buttons[index + delta]?.focus()
  }

  const label = from ? `${from} – ${to ?? '…'}` : null
  return (
    <>
      <button ref={anchor} id={id} type="button" className="k1-select" aria-haspopup="dialog" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen((next) => !next)}>
        {leading}
        <span className={label ? 'k1-select__value' : 'k1-select__placeholder'}>{label ?? 'Select date range'}</span>
      </button>
      <Popover open={open} anchorRef={anchor} onClose={() => { setOpen(false); setHover(null) }} className="k1-cal" role="dialog" label="Choose a date range">
        <div className="k1-cal__preset">
          <Select<Preset>
            label="Date range preset"
            value={preset}
            placeholder="Select date range"
            options={[
              { value: '7', label: 'Last 7 days' },
              { value: '14', label: 'Last 14 days' },
              { value: '30', label: 'Last 30 days' },
              { value: 'custom', label: 'Custom range' },
            ]}
            onChange={applyPreset}
          />
        </div>
        <div className="k1-cal__months" onKeyDown={onKey} onPointerLeave={() => setHover(null)}>
          <div className="k1-cal__nav">
            <button type="button" className="k1-icon-btn k1-icon-btn--boxed k1-icon-btn--xs" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft size={14} strokeWidth={1.75} /></button>
            <span>{left.toLocaleDateString('en', { month: 'long', year: 'numeric' })}</span>
            <span>{right.toLocaleDateString('en', { month: 'long', year: 'numeric' })}</span>
            <button type="button" className="k1-icon-btn k1-icon-btn--boxed k1-icon-btn--xs" aria-label="Next month" disabled={isoDay(right) >= today.slice(0, 8) + '01'} onClick={() => shift(1)}><ChevronRight size={14} strokeWidth={1.75} /></button>
          </div>
          <Month year={left.getFullYear()} month={left.getMonth()} from={from} to={to} hover={hover} today={today} onPick={pick} onHover={setHover} />
          <Month year={right.getFullYear()} month={right.getMonth()} from={from} to={to} hover={hover} today={today} onPick={pick} onHover={setHover} />
        </div>
      </Popover>
    </>
  )
}
