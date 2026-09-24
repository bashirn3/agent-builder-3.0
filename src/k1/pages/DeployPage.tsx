import { AnimatePresence, motion } from 'motion/react'
import { FormEvent, useId, useRef, useState } from 'react'
import { Check, Copy, WhatsApp } from '../ui/icons'
import { ease } from '../../lib/motion'
import type { AgentConfig } from '../data/agentConfig'
import { Dialog } from '../ui/overlay'
import { Skeleton, Spinner } from '../ui/controls'

type DeployRequest = {
  id: string
  name: string
  email: string
  goLive: string
  notes: string
  version: string
  createdAt: string
}

const STORE_KEY = 'k1-deploy-requests'

function loadRequests(): DeployRequest[] {
  try {
    return JSON.parse(sessionStorage.getItem(STORE_KEY) ?? '[]') as DeployRequest[]
  } catch {
    return []
  }
}

function requestText(request: DeployRequest) {
  return [
    'Subject: K1 Katsastus — WhatsApp deployment request',
    '',
    `Requested by: ${request.name} <${request.email}>`,
    `Configuration: ${request.version}`,
    `Preferred go-live: ${request.goLive || 'Not specified'}`,
    '',
    request.notes || 'No additional notes.',
  ].join('\n')
}

export function DeployPage({ config, dirty, notify }: {
  config: AgentConfig | null
  dirty: boolean
  notify: (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void
}) {
  const [open, setOpen] = useState(false)
  const [requests, setRequests] = useState<DeployRequest[]>(loadRequests)
  const [prepared, setPrepared] = useState<DeployRequest | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', goLive: '', notes: '', confirmed: false })
  const [attempted, setAttempted] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const ids = { name: useId(), email: useId(), goLive: useId(), notes: useId(), confirm: useId(), error: useId() }

  const active = config?.versions.find((version) => version.active)
  const versionLabel = !config
    ? 'Loading the saved configuration…'
    : active ? `Version ${active.number} (active)` : 'Default K1 instructions (not saved yet)'
  const errors = [
    !config && 'Wait for the saved configuration to load.',
    !form.name.trim() && 'Enter your name.',
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) && 'Enter a valid work email.',
    !form.confirmed && 'Confirm that the active configuration has been tested.',
  ].filter(Boolean) as string[]

  const openDialog = () => {
    setPrepared(null)
    setAttempted(false)
    setOpen(true)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setAttempted(true)
    if (errors.length) return
    setSubmitting(true)
    window.setTimeout(() => {
      const request: DeployRequest = {
        id: `req-${Date.now().toString(36)}`,
        name: form.name.trim(),
        email: form.email.trim(),
        goLive: form.goLive,
        notes: form.notes.trim(),
        version: versionLabel,
        createdAt: new Date().toISOString(),
      }
      const next = [request, ...requests]
      sessionStorage.setItem(STORE_KEY, JSON.stringify(next))
      setRequests(next)
      setPrepared(request)
      setSubmitting(false)
      setForm({ name: form.name, email: form.email, goLive: '', notes: '', confirmed: false })
    }, 500)
  }

  const copy = (request: DeployRequest) => {
    void navigator.clipboard?.writeText(requestText(request))
      .then(() => notify({ title: 'Copied', body: 'The request text is on your clipboard.' }))
      .catch(() => notify({ tone: 'error', title: 'Copy failed', body: 'Your browser blocked clipboard access.' }))
  }

  return (
    <div className="k1-deploy">
      <header className="k1-deploy__head">
        <h1 className="k1-deploy__title">Deploy</h1>
      </header>
      <div className="k1-deploy__body">
      <div className="k1-channels">
        <article className="k1-channel">
          <div className="k1-channel__top">
            <span className="k1-channel__tile" aria-hidden="true"><WhatsApp size={26} /></span>
            {requests.length > 0 && <span className="k1-status k1-status--contacted">Requested</span>}
          </div>
          <div className="k1-channel__text">
            <h2>WhatsApp</h2>
            <p>Ask the Wasup team to put the K1 booking agent live on your WhatsApp number.</p>
          </div>
          <div className="k1-channel__foot">
            {config
              ? <button type="button" className="k1-btn k1-btn--outline k1-btn--sm" aria-haspopup="dialog" onClick={openDialog}>Request deployment</button>
              : <Skeleton width={128} height={36} />}
          </div>
        </article>
      </div>
      {dirty && <p className="k1-hint k1-hint--warn">You have unsaved Playground changes. A deployment request always refers to the saved active configuration.</p>}

      <section className="k1-deploy__requests" aria-labelledby="k1-requests-title">
        <h2 id="k1-requests-title" className="k1-label">Requests in this session</h2>
        {requests.length ? (
          <ul>
            <AnimatePresence initial={false}>
              {requests.map((request) => (
                <motion.li
                  key={request.id}
                  className="k1-row-card"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  transition={{ duration: 0.2, ease }}
                >
                  <div className="k1-row-card__text">
                    <strong>{request.version}</strong>
                    <span>{new Date(request.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {request.name}</span>
                  </div>
                  <span className="k1-status k1-status--draft">Prepared · not sent</span>
                  <button type="button" className="k1-icon-btn k1-icon-btn--boxed" aria-label="Copy request text" onClick={() => copy(request)}><Copy size={15} strokeWidth={1.75} /></button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        ) : <p className="k1-hint">No requests yet.</p>}
      </section>
      </div>

      <Dialog open={open} title={prepared ? 'Request prepared' : 'Request deployment'} onClose={() => setOpen(false)} width={440} initialFocus={prepared ? undefined : nameRef}>
        <AnimatePresence mode="wait" initial={false}>
          {prepared ? (
            <motion.div key="done" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease }}>
              <div className="k1-deploy__done">
                <span className="k1-deploy__check" aria-hidden="true"><Check size={16} strokeWidth={2.25} /></span>
                <p>Email delivery is not connected yet, so this request has <strong>not been sent</strong> to Wasup. It is kept in this browser session. Copy the text below to send it yourself.</p>
              </div>
              <pre className="k1-deploy__preview">{requestText(prepared)}</pre>
              <footer className="k1-dialog__foot">
                <button type="button" className="k1-btn k1-btn--outline" onClick={() => copy(prepared)}><Copy size={14} strokeWidth={1.75} />Copy request text</button>
                <button type="button" className="k1-btn k1-btn--primary" onClick={() => setOpen(false)}>Done</button>
              </footer>
            </motion.div>
          ) : (
            <motion.form key="form" onSubmit={submit} noValidate initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14, ease }}>
              <div className="k1-form-stack">
                <div className="k1-field">
                  <span className="k1-field__label">Configuration</span>
                  <p className="k1-readonly">{versionLabel}</p>
                </div>
                <div className="k1-field">
                  <label htmlFor={ids.name}>Your name</label>
                  <input ref={nameRef} id={ids.name} className="k1-input" value={form.name} autoComplete="name" aria-invalid={(attempted && !form.name.trim()) || undefined} onChange={(event) => setForm({ ...form, name: event.target.value })} />
                </div>
                <div className="k1-field">
                  <label htmlFor={ids.email}>Work email</label>
                  <input id={ids.email} className="k1-input" type="email" value={form.email} placeholder="name@k1katsastus.fi" autoComplete="email" aria-invalid={(attempted && errors.includes('Enter a valid work email.')) || undefined} onChange={(event) => setForm({ ...form, email: event.target.value })} />
                </div>
                <div className="k1-field">
                  <label htmlFor={ids.goLive}>Preferred go-live date</label>
                  <input id={ids.goLive} className="k1-input" type="date" value={form.goLive} onChange={(event) => setForm({ ...form, goLive: event.target.value })} />
                </div>
                <div className="k1-field">
                  <label htmlFor={ids.notes}>Notes</label>
                  <textarea id={ids.notes} className="k1-textarea" rows={3} value={form.notes} placeholder="Stations, opening hours, or anything the team should know" onChange={(event) => setForm({ ...form, notes: event.target.value })} />
                </div>
                <label className="k1-check" htmlFor={ids.confirm}>
                  <input id={ids.confirm} type="checkbox" checked={form.confirmed} onChange={(event) => setForm({ ...form, confirmed: event.target.checked })} />
                  <span className="k1-check__box" aria-hidden="true"><Check size={11} strokeWidth={3} /></span>
                  The active configuration has been tested in the Playground.
                </label>
                {attempted && errors.length > 0 && <p id={ids.error} className="k1-auth__error" role="alert">{errors[0]}</p>}
              </div>
              <footer className="k1-dialog__foot">
                <button type="button" className="k1-btn k1-btn--outline" onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit" className="k1-btn k1-btn--primary" disabled={submitting || !config} aria-busy={submitting}>{submitting && <Spinner />}Prepare request</button>
              </footer>
            </motion.form>
          )}
        </AnimatePresence>
      </Dialog>
    </div>
  )
}
