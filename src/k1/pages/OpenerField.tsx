import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import type { Reminder } from '../data/builderApi'
import { LANGUAGES, type Lang } from '../data/language'
import { Plus } from '../ui/icons'
import { useCopy } from '../i18n'

// Only fields present in the Muster lead record are offered.
type TokenKey = 'registration' | 'dueDate' | 'lastVisit' | 'station' | 'firstName'
const TOKENS: Array<{ raw: string; key: TokenKey }> = [
  { raw: '{{registration_number}}', key: 'registration' },
  { raw: '{{due_date}}', key: 'dueDate' },
  { raw: '{{last_inspection}}', key: 'lastVisit' },
  { raw: '{{station}}', key: 'station' },
]
const LEGACY = { raw: '{{first_name}}', key: 'firstName' as const }
const DISPLAY = [...TOKENS, LEGACY]
type Names = Record<TokenKey, string>
const label = (names: Names, key: TokenKey) => `{${names[key]}}`
const toDisplay = (value: string, names: Names) => DISPLAY.reduce((text, token) => text.split(token.raw).join(label(names, token.key)), value)
const toRaw = (value: string, names: Names) => DISPLAY.reduce((text, token) => text.split(label(names, token.key)).join(token.raw), value)
const LEGACY_PATTERN = /[ \t]*{{\s*first[-_\s]?name\s*}}/gi

function TemplateField({ label: fieldLabel, value, onChange, placeholder, tag, footer }: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  tag?: ReactNode
  footer?: ReactNode
}) {
  const t = useCopy()
  const names = t.opener.tokens
  const id = useId()
  const hint = useId()
  const ref = useRef<HTMLTextAreaElement>(null)
  const shown = toDisplay(value, names)
  const legacy = LEGACY_PATTERN.test(value)
  LEGACY_PATTERN.lastIndex = 0
  const insert = (token: string) => {
    const node = ref.current
    const start = node?.selectionStart ?? shown.length
    const end = node?.selectionEnd ?? shown.length
    const next = shown.slice(0, start) + token + shown.slice(end)
    onChange(toRaw(next, names))
    requestAnimationFrame(() => {
      node?.focus()
      node?.setSelectionRange(start + token.length, start + token.length)
    })
  }
  return (
    <div className="k1-opener">
      <div className="k1-opener__label">
        <label className="k1-label" htmlFor={id}>{fieldLabel}</label>
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
        onChange={(event) => onChange(toRaw(event.target.value, names))}
      />
      <div className="k1-opener__foot">
        <div className="k1-opener__tokens" role="group" aria-label={t.opener.insertInto(fieldLabel)}>
          {TOKENS.map((token) => (
            <button key={token.raw} type="button" className="k1-token" onClick={() => insert(label(names, token.key))}>
              <Plus size={12} />{names[token.key]}
            </button>
          ))}
        </div>
        <span className="k1-opener__hint" id={hint}>{t.opener.filledPerLead}</span>
      </div>
      {legacy && (
        <p className="k1-opener__warn" role="note">
          {t.opener.legacy(label(names, LEGACY.key))}{' '}
          <button type="button" className="k1-link" onClick={() => onChange(value.replace(LEGACY_PATTERN, ''))}>{t.opener.removeIt}</button>
        </p>
      )}
      {footer}
    </div>
  )
}

export function LanguageTabs({ value, onChange }: { value: Lang; onChange: (lang: Lang) => void }) {
  const t = useCopy()
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
      <div className="k1-segmented" role="tablist" aria-label={t.opener.messageLanguage} onKeyDown={onKey}>
        {LANGUAGES.map((language) => {
          const active = language.code === value
          return (
            <button key={language.code} type="button" role="tab" aria-selected={active} tabIndex={active ? 0 : -1} className={active ? 'is-active' : undefined} onClick={() => onChange(language.code)}>
              {t.opener.languages[language.code]}
            </button>
          )
        })}
      </div>
      <p className="k1-hint">{t.opener.languageHint}</p>
    </div>
  )
}

export function OpenerField({ value, onChange, fallback }: { value: string; onChange: (value: string) => void; fallback?: boolean }) {
  const t = useCopy()
  return (
    <TemplateField
      label={t.opener.initialMessage}
      value={value}
      onChange={onChange}
      placeholder={fallback ? t.opener.initialFallback : t.opener.initialPlaceholder}
    />
  )
}

export function ReminderFields({ reminders, onChange, timing, fallback }: {
  reminders: Reminder[]
  onChange: (reminders: Reminder[]) => void
  timing?: Reminder[]
  fallback?: boolean
}) {
  const t = useCopy()
  const TIMING = t.opener.timing
  const update = (index: number, patch: Partial<Reminder>) => onChange(reminders.map((reminder, i) => (i === index ? { ...reminder, ...patch } : reminder)))
  return (
    <div className="k1-reminders">
      {reminders.map((reminder, index) => {
        const days = timing ? timing[index]?.days ?? null : reminder.days
        return (
          <TemplateField
            key={index}
            label={t.opener.reminder(index + 1)}
            value={reminder.text}
            onChange={(text) => update(index, { text })}
            placeholder={fallback ? t.opener.reminderFallback : t.opener.reminderPlaceholder}
            tag={index === 2 ? <span className="k1-tag k1-tag--pink">{t.opener.afterExpiry}</span> : undefined}
            footer={timing ? (
              <p className="k1-reminder__timing">{days ? t.opener.sentAfter(days, TIMING[index]) : t.opener.timingOnEnglish}</p>
            ) : (
              <label className="k1-reminder__timing">
                {t.opener.send}
                <input
                  className="k1-input k1-reminder__days"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={365}
                  value={days ?? ''}
                  placeholder="–"
                  aria-label={t.opener.daysFor(index + 1)}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    update(index, { days: event.target.value === '' || !Number.isFinite(next) ? null : Math.max(1, Math.min(365, Math.round(next))) })
                  }}
                />
                {t.opener.days} {TIMING[index]}
              </label>
            )}
          />
        )
      })}
    </div>
  )
}
