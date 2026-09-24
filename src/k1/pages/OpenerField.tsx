import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import type { Reminder } from '../data/builderApi'
import { LANGUAGES, type Lang } from '../data/language'
import { Plus } from '../ui/icons'

// Only fields present in the Muster lead record are offered.
const TOKENS = [
  { raw: '{{registration_number}}', label: '{Registration}', name: 'Registration' },
  { raw: '{{due_date}}', label: '{Due date}', name: 'Due date' },
  { raw: '{{last_inspection}}', label: '{Last visit}', name: 'Last visit' },
  { raw: '{{station}}', label: '{Station}', name: 'Station' },
]
const LEGACY = { raw: '{{first_name}}', label: '{First name}' }
const DISPLAY = [...TOKENS, LEGACY]
const toDisplay = (value: string) => DISPLAY.reduce((text, token) => text.split(token.raw).join(token.label), value)
const toRaw = (value: string) => DISPLAY.reduce((text, token) => text.split(token.label).join(token.raw), value)
const LEGACY_PATTERN = /[ \t]*{{\s*first[-_\s]?name\s*}}/gi

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
  const legacy = LEGACY_PATTERN.test(value)
  LEGACY_PATTERN.lastIndex = 0
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
        <div className="k1-opener__tokens" role="group" aria-label={`Insert lead detail into ${label.toLowerCase()}`}>
          {TOKENS.map((token) => (
            <button key={token.raw} type="button" className="k1-token" onClick={() => insert(token.label)}>
              <Plus size={12} />{token.name}
            </button>
          ))}
        </div>
        <span className="k1-opener__hint" id={hint}>Filled in per lead</span>
      </div>
      {legacy && (
        <p className="k1-opener__warn" role="note">
          {LEGACY.label} is not in K1’s lead data, so it is left out when sent.{' '}
          <button type="button" className="k1-link" onClick={() => onChange(value.replace(LEGACY_PATTERN, ''))}>Remove it</button>
        </p>
      )}
      {footer}
    </div>
  )
}

export function LanguageTabs({ value, onChange }: { value: Lang; onChange: (lang: Lang) => void }) {
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const index = LANGUAGES.findIndex((language) => language.code === value)
    const next = LANGUAGES[(index + (event.key === 'ArrowRight' ? 1 : -1) + LANGUAGES.length) % LANGUAGES.length]
    onChange(next.code)
    requestAnimationFrame(() => event.currentTarget?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus())
  }
  return (
    <div className="k1-opener-lang">
      <div className="k1-segmented" role="tablist" aria-label="Message language" onKeyDown={onKey}>
        {LANGUAGES.map((language) => {
          const active = language.code === value
          return (
            <button key={language.code} type="button" role="tab" aria-selected={active} tabIndex={active ? 0 : -1} className={active ? 'is-active' : undefined} onClick={() => onChange(language.code)}>
              {language.label}
            </button>
          )
        })}
      </div>
      <p className="k1-hint">Each lead gets the version in their language. Other languages, or an empty version, get English.</p>
    </div>
  )
}

export function OpenerField({ value, onChange, fallback }: { value: string; onChange: (value: string) => void; fallback?: boolean }) {
  return (
    <TemplateField
      label="Initial message"
      value={value}
      onChange={onChange}
      placeholder={fallback ? 'Leave empty to send the English message.' : 'Hi! What can I help you with?'}
    />
  )
}

const TIMING = ['after the initial message', 'after reminder 1', 'after expiry, if not booked']

export function ReminderFields({ reminders, onChange, timing, fallback }: {
  reminders: Reminder[]
  onChange: (reminders: Reminder[]) => void
  timing?: Reminder[]
  fallback?: boolean
}) {
  const update = (index: number, patch: Partial<Reminder>) => onChange(reminders.map((reminder, i) => (i === index ? { ...reminder, ...patch } : reminder)))
  return (
    <div className="k1-reminders">
      {reminders.map((reminder, index) => {
        const days = timing ? timing[index]?.days ?? null : reminder.days
        return (
          <TemplateField
            key={index}
            label={`Reminder ${index + 1}`}
            value={reminder.text}
            onChange={(text) => update(index, { text })}
            placeholder={fallback ? 'Leave empty to send the English reminder.' : 'Optional. Leave empty to skip this reminder.'}
            tag={index === 2 ? <span className="k1-tag k1-tag--pink">After expiry</span> : undefined}
            footer={timing ? (
              <p className="k1-reminder__timing">{days ? `Sent ${days} days ${TIMING[index]}` : `Timing is set on the English version`}</p>
            ) : (
              <label className="k1-reminder__timing">
                Send
                <input
                  className="k1-input k1-reminder__days"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={365}
                  value={days ?? ''}
                  placeholder="–"
                  aria-label={`Days for reminder ${index + 1}`}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    update(index, { days: event.target.value === '' || !Number.isFinite(next) ? null : Math.max(1, Math.min(365, Math.round(next))) })
                  }}
                />
                days {TIMING[index]}
              </label>
            )}
          />
        )
      })}
    </div>
  )
}
