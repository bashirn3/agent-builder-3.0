import { useId, useRef, type ReactNode } from 'react'
import type { Reminder } from '../data/builderApi'
import { Plus } from '../ui/icons'

const TOKENS = [
  { raw: '{{first_name}}', label: '{First name}', name: 'First name' },
  { raw: '{{registration_number}}', label: '{Registration}', name: 'Registration' },
]
const toDisplay = (value: string) => TOKENS.reduce((text, token) => text.split(token.raw).join(token.label), value)
const toRaw = (value: string) => TOKENS.reduce((text, token) => text.split(token.label).join(token.raw), value)

function TemplateField({ label, value, onChange, placeholder, tag, footer }: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  tag?: ReactNode
  footer?: ReactNode
}) {
  const id = useId()
  const hint = useId()
  const ref = useRef<HTMLTextAreaElement>(null)
  const shown = toDisplay(value)
  const insert = (token: string) => {
    const node = ref.current
    const start = node?.selectionStart ?? shown.length
    const end = node?.selectionEnd ?? shown.length
    const next = shown.slice(0, start) + token + shown.slice(end)
    onChange(toRaw(next))
    requestAnimationFrame(() => {
      node?.focus()
      node?.setSelectionRange(start + token.length, start + token.length)
    })
  }
  return (
    <div className="k1-opener">
      <div className="k1-opener__label">
        <label className="k1-label" htmlFor={id}>{label}</label>
        {tag}
      </div>
      <textarea
        ref={ref}
        id={id}
        className="k1-textarea k1-textarea--field"
        rows={3}
        maxLength={1000}
        value={shown}
        placeholder={placeholder}
        aria-describedby={hint}
        onChange={(event) => onChange(toRaw(event.target.value))}
      />
      <div className="k1-opener__foot">
        <div className="k1-opener__tokens" role="group" aria-label={`Insert customer detail into ${label.toLowerCase()}`}>
          {TOKENS.map((token) => (
            <button key={token.raw} type="button" className="k1-token" onClick={() => insert(token.label)}>
              <Plus size={12} />{token.name}
            </button>
          ))}
        </div>
        <span className="k1-opener__hint" id={hint}>Filled in per customer</span>
      </div>
      {footer}
    </div>
  )
}

export function OpenerField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <TemplateField label="Initial message" value={value} onChange={onChange} placeholder="Hi! What can I help you with?" />
}

const TIMING = ['after the initial message', 'after reminder 1', 'after expiry, if not booked']

export function ReminderFields({ reminders, onChange }: { reminders: Reminder[]; onChange: (reminders: Reminder[]) => void }) {
  const update = (index: number, patch: Partial<Reminder>) => onChange(reminders.map((reminder, i) => (i === index ? { ...reminder, ...patch } : reminder)))
  return (
    <div className="k1-reminders">
      {reminders.map((reminder, index) => (
        <TemplateField
          key={index}
          label={`Reminder ${index + 1}`}
          value={reminder.text}
          onChange={(text) => update(index, { text })}
          placeholder="Optional. Leave empty to skip this reminder."
          tag={index === 2 ? <span className="k1-tag k1-tag--pink">After expiry</span> : undefined}
          footer={(
            <label className="k1-reminder__timing">
              Send
              <input
                className="k1-input k1-reminder__days"
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                value={reminder.days ?? ''}
                placeholder="–"
                aria-label={`Days for reminder ${index + 1}`}
                onChange={(event) => {
                  const days = Number(event.target.value)
                  update(index, { days: event.target.value === '' || !Number.isFinite(days) ? null : Math.max(1, Math.min(365, Math.round(days))) })
                }}
              />
              days {TIMING[index]}
            </label>
          )}
        />
      ))}
    </div>
  )
}
