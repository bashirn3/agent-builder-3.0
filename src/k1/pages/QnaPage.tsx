import { motion } from 'motion/react'
import { useId, useState } from 'react'
import { ease } from '../../lib/motion'
import { parseAdditional, serializeAdditional, type QnaEntry } from '../data/qna'
import type { PlaygroundStore } from '../data/usePlayground'
import { href } from '../routes'
import { Skeleton, Spinner } from '../ui/controls'
import { ChevronDown, Pencil, Plus, Search, Trash, X } from '../ui/icons'
import { Collapse } from '../ui/overlay'
import { PromptEditor } from './PlaygroundPage'

type Form = { title: string; questions: string[]; answer: string }
const EMPTY: Form = { title: '', questions: [''], answer: '' }
const valid = (form: Form) => form.questions.some((question) => question.trim()) && form.answer.trim().length > 0

function QnaEditor({ form, onChange, submitLabel, onSubmit, onCancel }: {
  form: Form
  onChange: (form: Form) => void
  submitLabel: string
  onSubmit: () => void
  onCancel?: () => void
}) {
  const ids = { title: useId(), question: useId(), answer: useId() }
  const setQuestion = (index: number, value: string) => onChange({ ...form, questions: form.questions.map((item, i) => (i === index ? value : item)) })
  return (
    <div className="k1-qna-editor">
      <div className="k1-sheet__field">
        <label className="k1-label" htmlFor={ids.title}>Title</label>
        <input id={ids.title} className="k1-input" value={form.title} placeholder="Ex: Saturday opening hours" onChange={(event) => onChange({ ...form, title: event.target.value })} />
      </div>
      <div className="k1-sheet__field">
        <label className="k1-label" htmlFor={ids.question}>Question</label>
        {form.questions.map((question, index) => (
          <div key={index} className="k1-qna-editor__question">
            <input
              id={index === 0 ? ids.question : undefined}
              aria-label={index === 0 ? undefined : `Question ${index + 1}`}
              className="k1-input"
              value={question}
              placeholder={index === 0 ? 'Ex: Are you open on Saturdays?' : 'Another way a customer might ask'}
              onChange={(event) => setQuestion(index, event.target.value)}
            />
            {index > 0 && (
              <button type="button" className="k1-icon-btn" aria-label={`Remove question ${index + 1}`} onClick={() => onChange({ ...form, questions: form.questions.filter((_, i) => i !== index) })}>
                <X size={14} />
              </button>
            )}
          </div>
        ))}
        <button type="button" className="k1-btn k1-btn--outline k1-btn--sm k1-qna-editor__more" onClick={() => onChange({ ...form, questions: [...form.questions, ''] })}>
          <Plus size={14} />Add question
        </button>
      </div>
      <div className="k1-sheet__field">
        <label className="k1-label" htmlFor={ids.answer}>Answer</label>
        <PromptEditor id={ids.answer} size="answer" value={form.answer} placeholder="Enter your answer…" readOnly={false} onChange={(answer) => onChange({ ...form, answer })} />
      </div>
      <div className="k1-qna-editor__actions">
        {onCancel && <button type="button" className="k1-btn k1-btn--outline k1-btn--sm" onClick={onCancel}>Cancel</button>}
        <button type="button" className="k1-btn k1-btn--primary k1-btn--sm" disabled={!valid(form)} onClick={onSubmit}>{submitLabel}</button>
      </div>
    </div>
  )
}

function QnaSkeleton() {
  return (
    <div className="k1-qna-page" role="status" aria-label="Loading Q&A">
      <div className="k1-qna-page__main">
        <Skeleton height={28} width={80} />
        <Skeleton height={14} width="60%" />
        <div className="k1-skel-card"><Skeleton height={16} width={90} /><Skeleton height={38} /><Skeleton height={38} /><Skeleton height={140} /></div>
      </div>
    </div>
  )
}

export function QnaPage({ store }: { store: PlaygroundStore }) {
  const { draft, dirty, saving } = store
  const [addOpen, setAddOpen] = useState(true)
  const [form, setForm] = useState<Form>(EMPTY)
  const [editing, setEditing] = useState<{ id: string; form: Form } | null>(null)
  const [query, setQuery] = useState('')
  const addId = useId()

  if (!draft) return <QnaSkeleton />
  const { notes, entries } = parseAdditional(draft.additional)
  const commit = (next: QnaEntry[], nextNotes = notes) => store.edit({ additional: serializeAdditional(nextNotes, next) })
  const add = () => {
    commit([...entries, { id: 'new', ...form }])
    setForm(EMPTY)
  }
  const saveEdit = () => {
    if (!editing) return
    commit(entries.map((entry) => (entry.id === editing.id ? { ...entry, ...editing.form } : entry)))
    setEditing(null)
  }
  const needle = query.trim().toLowerCase()
  const shown = needle
    ? entries.filter((entry) => [entry.title, entry.answer, ...entry.questions].some((text) => text.toLowerCase().includes(needle)))
    : entries

  return (
    <div className="k1-qna-page">
      <div className="k1-qna-page__main">
        <header className="k1-qna-page__head">
          <h1 className="k1-page-title">Q&amp;A</h1>
          <p>Predefined answers for key topics. Your agent checks these first.</p>
        </header>

        <section className="k1-qna-card">
          <button type="button" className="k1-qna-card__trigger" aria-expanded={addOpen} aria-controls={addId} onClick={() => setAddOpen(!addOpen)}>
            Add Q&amp;A
            <motion.span animate={{ rotate: addOpen ? 180 : 0 }} transition={{ duration: 0.2, ease }} style={{ display: 'inline-flex' }}>
              <ChevronDown size={16} strokeWidth={1.75} />
            </motion.span>
          </button>
          <Collapse open={addOpen} id={addId}>
            <div className="k1-qna-card__body">
              <QnaEditor form={form} onChange={setForm} submitLabel="Add Q&A" onSubmit={add} />
            </div>
          </Collapse>
        </section>

        {entries.length > 0 && (
          <section className="k1-qna-entries" aria-label="Q&A entries">
            <div className="k1-qna-entries__bar">
              <h2 className="k1-section-title">{entries.length} Q&amp;A</h2>
              <label className="k1-qna-entries__search">
                <Search size={14} />
                <input className="k1-input" value={query} placeholder="Search Q&A" aria-label="Search Q&A" onChange={(event) => setQuery(event.target.value)} />
              </label>
            </div>
            <ul className="k1-qna__list">
              {shown.map((entry) => (
                <li key={entry.id} className="k1-qna__item">
                  {editing?.id === entry.id ? (
                    <QnaEditor form={editing.form} onChange={(next) => setEditing({ id: entry.id, form: next })} submitLabel="Save Q&A" onSubmit={saveEdit} onCancel={() => setEditing(null)} />
                  ) : (
                    <>
                      <div className="k1-qna__text">
                        <strong>{entry.title}</strong>
                        {entry.questions.filter((question) => question !== entry.title).map((question, index) => <span key={index} className="k1-qna__q">{question}</span>)}
                        <p className="k1-qna__a">{entry.answer}</p>
                      </div>
                      <div className="k1-qna__actions">
                        <button type="button" className="k1-icon-btn" aria-label={`Edit ${entry.title}`} onClick={() => setEditing({ id: entry.id, form: { title: entry.title, questions: entry.questions, answer: entry.answer } })}><Pencil size={14} /></button>
                        <button type="button" className="k1-icon-btn" aria-label={`Delete ${entry.title}`} onClick={() => commit(entries.filter((item) => item.id !== entry.id))}><Trash size={14} /></button>
                      </div>
                    </>
                  )}
                </li>
              ))}
              {!shown.length && <li className="k1-qna__empty">No Q&amp;A matches “{query}”.</li>}
            </ul>
          </section>
        )}

        {notes && (
          <section className="k1-sheet__field k1-qna__notes">
            <label className="k1-label" htmlFor={`${addId}-notes`}>Other notes</label>
            <textarea id={`${addId}-notes`} className="k1-textarea k1-textarea--field" rows={4} value={notes} onChange={(event) => commit(entries, event.target.value)} />
            <p className="k1-hint">Earlier free-text notes. The agent still reads them.</p>
          </section>
        )}
      </div>

      <aside className="k1-qna-page__rail">
        <h2 className="k1-section-title">Knowledge</h2>
        <div className="k1-rail-card">
          <div className="k1-rail-card__row"><span>Q&amp;A entries</span><strong>{entries.length}</strong></div>
          <div className="k1-rail-card__row"><span>Questions covered</span><strong>{entries.reduce((sum, entry) => sum + entry.questions.length, 0)}</strong></div>
        </div>
        <div className="k1-rail-card">
          <div className="k1-rail-card__row"><span>Status</span><strong className={dirty ? 'k1-rail-card__dirty' : undefined}>{dirty ? 'Unsaved changes' : 'Saved'}</strong></div>
          <button type="button" className="k1-btn k1-btn--primary" disabled={!dirty || saving} aria-busy={saving} onClick={() => void store.save()}>
            {saving && <Spinner />}Save to agent
          </button>
          {dirty && <button type="button" className="k1-btn k1-btn--outline" disabled={saving} onClick={store.discard}>Discard</button>}
          <a className="k1-link k1-rail-card__link" href={href({ page: 'playground' })}>Test in Playground</a>
        </div>
      </aside>
    </div>
  )
}
