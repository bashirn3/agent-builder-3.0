import { useEffect, useId, useRef, useState } from 'react'
import type { QnaEntry } from '../data/qna'
import { Plus, X } from '../ui/icons'
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
    onSubmit({ title: title.trim() || target.question.slice(0, 80), questions: [target.question], answer: expected.trim() }, target)
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
