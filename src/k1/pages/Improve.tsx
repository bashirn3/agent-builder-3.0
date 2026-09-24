import { useEffect, useId, useRef, useState } from 'react'
import { parseAdditional, serializeAdditional, type QnaEntry } from '../data/qna'
import { Pencil, Plus, Trash, X } from '../ui/icons'
import { Drawer } from '../ui/overlay'

export type ReviseTarget = { question: string; answer: string; messageId?: string }

function SheetHead({ title, description, onClose }: { title: string; description: string; onClose: () => void }) {
  return (
    <div className="k1-sheet__head">
      <div>
        <h2 className="k1-sheet__title">{title}</h2>
        <p className="k1-sheet__desc">{description}</p>
      </div>
      <button type="button" className="k1-icon-btn k1-sheet__close" aria-label="Close" onClick={onClose}>
        <X size={16} />
      </button>
    </div>
  )
}

export function ImproveSheet({ target, disabled, onClose, onSubmit }: {
  target: ReviseTarget | null
  disabled?: boolean
  onClose: () => void
  onSubmit: (entry: Omit<QnaEntry, 'id'>, target: ReviseTarget) => void
}) {
  const [title, setTitle] = useState('')
  const [expected, setExpected] = useState('')
  const ids = { title: useId(), user: useId(), agent: useId(), expected: useId() }
  const last = useRef<ReviseTarget | null>(null)
  if (target) last.current = target
  const shown = target ?? last.current

  useEffect(() => {
    if (!target) return
    setTitle('')
    setExpected('')
  }, [target])

  const submit = () => {
    if (!target || !expected.trim()) return
    onSubmit({ title: title.trim() || target.question.slice(0, 80), question: target.question, answer: expected.trim() }, target)
  }

  return (
    <Drawer open={Boolean(target)} side="right" label="Improve answer" onClose={onClose} className="k1-sheet">
      <SheetHead title="Improve answer" description="This adds a Q&A entry that your agent checks first." onClose={onClose} />
      <div className="k1-sheet__body">
        <div className="k1-sheet__field">
          <label className="k1-label" htmlFor={ids.title}>Q&amp;A title</label>
          <input id={ids.title} className="k1-input" value={title} placeholder="Enter a title for this Q&A" onChange={(event) => setTitle(event.target.value)} />
        </div>
        <hr className="k1-sheet__sep" />
        <div className="k1-sheet__field">
          <span className="k1-label" id={ids.user}>User message</span>
          <div className="k1-readbox" aria-labelledby={ids.user}>{shown?.question}</div>
        </div>
        <div className="k1-sheet__field">
          <span className="k1-label" id={ids.agent}>Agent response</span>
          <div className="k1-readbox" aria-labelledby={ids.agent}>{shown?.answer}</div>
        </div>
        <hr className="k1-sheet__sep" />
        <div className="k1-sheet__field">
          <label className="k1-label" htmlFor={ids.expected}>Expected response</label>
          <textarea
            id={ids.expected}
            className="k1-textarea k1-textarea--field"
            rows={6}
            value={expected}
            placeholder="Write the answer the agent should give"
            onChange={(event) => setExpected(event.target.value)}
          />
        </div>
      </div>
      <div className="k1-sheet__foot">
        <button type="button" className="k1-btn k1-btn--outline" onClick={onClose}>Cancel</button>
        <button type="button" className="k1-btn k1-btn--primary" disabled={disabled || !expected.trim()} onClick={submit}>Update answer</button>
      </div>
    </Drawer>
  )
}

type Form = { id: string | null; title: string; question: string; answer: string }
const EMPTY_FORM: Form = { id: null, title: '', question: '', answer: '' }

function QnaForm({ form, onChange, onCancel, onSave }: { form: Form; onChange: (form: Form) => void; onCancel: () => void; onSave: () => void }) {
  const ids = { title: useId(), question: useId(), answer: useId() }
  return (
    <div className="k1-qna__form">
      <div className="k1-sheet__field">
        <label className="k1-label" htmlFor={ids.title}>Title</label>
        <input id={ids.title} className="k1-input" value={form.title} placeholder="e.g. Saturday opening hours" onChange={(event) => onChange({ ...form, title: event.target.value })} />
      </div>
      <div className="k1-sheet__field">
        <label className="k1-label" htmlFor={ids.question}>Question</label>
        <input id={ids.question} className="k1-input" value={form.question} placeholder="e.g. Are you open on Saturdays?" onChange={(event) => onChange({ ...form, question: event.target.value })} />
      </div>
      <div className="k1-sheet__field">
        <label className="k1-label" htmlFor={ids.answer}>Answer</label>
        <textarea id={ids.answer} className="k1-textarea k1-textarea--field" rows={4} value={form.answer} placeholder="Enter your answer" onChange={(event) => onChange({ ...form, answer: event.target.value })} />
      </div>
      <div className="k1-qna__form-actions">
        <button type="button" className="k1-btn k1-btn--outline k1-btn--sm" onClick={onCancel}>Cancel</button>
        <button type="button" className="k1-btn k1-btn--primary k1-btn--sm" disabled={!form.question.trim() || !form.answer.trim()} onClick={onSave}>
          {form.id ? 'Save Q&A' : 'Add Q&A'}
        </button>
      </div>
    </div>
  )
}

export function QnaSheet({ open, additional, onChange, onClose }: {
  open: boolean
  additional: string
  onChange: (additional: string) => void
  onClose: () => void
}) {
  const { notes, entries } = parseAdditional(additional)
  const [form, setForm] = useState<Form | null>(null)
  const notesId = useId()

  useEffect(() => { if (!open) setForm(null) }, [open])

  const commit = (nextEntries: QnaEntry[], nextNotes = notes) => onChange(serializeAdditional(nextNotes, nextEntries))
  const save = () => {
    if (!form) return
    const entry = { id: form.id ?? `new-${Date.now()}`, title: form.title, question: form.question, answer: form.answer }
    commit(form.id ? entries.map((item) => (item.id === form.id ? entry : item)) : [...entries, entry])
    setForm(null)
  }

  return (
    <Drawer open={open} side="right" label="Q&A" onClose={onClose} className="k1-sheet k1-sheet--wide">
      <SheetHead title="Q&A" description="Predefined answers for key topics. Your agent checks these first." onClose={onClose} />
      <div className="k1-sheet__body">
        {form && !form.id ? (
          <QnaForm form={form} onChange={setForm} onCancel={() => setForm(null)} onSave={save} />
        ) : (
          <button type="button" className="k1-btn k1-btn--outline k1-qna__add" onClick={() => setForm(EMPTY_FORM)}>
            <Plus size={15} />Add Q&amp;A
          </button>
        )}

        {entries.length ? (
          <ul className="k1-qna__list">
            {entries.map((entry) => (
              <li key={entry.id} className="k1-qna__item">
                {form?.id === entry.id ? (
                  <QnaForm form={form} onChange={setForm} onCancel={() => setForm(null)} onSave={save} />
                ) : (
                  <>
                    <div className="k1-qna__text">
                      <strong>{entry.title}</strong>
                      <span className="k1-qna__q">{entry.question}</span>
                      <p className="k1-qna__a">{entry.answer}</p>
                    </div>
                    <div className="k1-qna__actions">
                      <button type="button" className="k1-icon-btn" aria-label={`Edit ${entry.title}`} onClick={() => setForm({ ...entry })}><Pencil size={14} /></button>
                      <button type="button" className="k1-icon-btn" aria-label={`Delete ${entry.title}`} onClick={() => commit(entries.filter((item) => item.id !== entry.id))}><Trash size={14} /></button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="k1-qna__empty">No Q&amp;A yet. Add one here, or use “Revise answer” on a reply in the test chat or in Chat logs.</p>
        )}

        {notes && (
          <div className="k1-sheet__field k1-qna__notes">
            <label className="k1-label" htmlFor={notesId}>Other notes</label>
            <textarea id={notesId} className="k1-textarea k1-textarea--field" rows={4} value={notes} onChange={(event) => commit(entries, event.target.value)} />
            <p className="k1-hint">Earlier free-text notes. The agent still reads them.</p>
          </div>
        )}
      </div>
    </Drawer>
  )
}

const TOKENS = [
  { raw: '{{first_name}}', label: '{First name}', name: 'First name' },
  { raw: '{{registration_number}}', label: '{Registration}', name: 'Registration' },
]
const toDisplay = (value: string) => TOKENS.reduce((text, token) => text.split(token.raw).join(token.label), value)
const toRaw = (value: string) => TOKENS.reduce((text, token) => text.split(token.label).join(token.raw), value)

export function OpenerField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId()
  const hint = useId()
  const ref = useRef<HTMLTextAreaElement>(null)
  const shown = toDisplay(value)
  const insert = (label: string) => {
    const node = ref.current
    const start = node?.selectionStart ?? shown.length
    const end = node?.selectionEnd ?? shown.length
    const next = shown.slice(0, start) + label + shown.slice(end)
    onChange(toRaw(next))
    requestAnimationFrame(() => {
      node?.focus()
      node?.setSelectionRange(start + label.length, start + label.length)
    })
  }
  return (
    <div className="k1-opener">
      <label className="k1-label" htmlFor={id}>Initial message</label>
      <textarea
        ref={ref}
        id={id}
        className="k1-textarea k1-textarea--field"
        rows={3}
        maxLength={1000}
        value={shown}
        placeholder="Hi! What can I help you with?"
        aria-describedby={hint}
        onChange={(event) => onChange(toRaw(event.target.value))}
      />
      <div className="k1-opener__foot">
        <div className="k1-opener__tokens" role="group" aria-label="Insert customer detail">
          {TOKENS.map((token) => (
            <button key={token.raw} type="button" className="k1-token" onClick={() => insert(token.label)}>
              <Plus size={12} />{token.name}
            </button>
          ))}
        </div>
        <span className="k1-opener__hint" id={hint}>Filled in per customer</span>
      </div>
    </div>
  )
}
