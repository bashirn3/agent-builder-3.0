import { AnimatePresence, motion } from 'motion/react'
import { FormEvent, useEffect, useId, useRef, useState } from 'react'
import { ease } from '../../lib/motion'
import { describeError, type AgentConfig, type AgentVersion } from '../data/agentConfig'
import { requestDeploy, type DeployRequest } from '../data/builderApi'
import { go } from '../routes'
import { Skeleton, Spinner } from '../ui/controls'
import { Check, ThumbsDown, ThumbsUp, WhatsApp } from '../ui/icons'
import { useSession } from '../auth/session'
import { Dialog } from '../ui/overlay'
import { formatStamp } from './SplitView'

// Flip once the email step in the Deploy Request workflow sends to Wasup.
const EMAIL_CONNECTED = true

const STATUS_LABEL: Record<DeployRequest['status'], string> = {
  requested: 'Waiting for Wasup',
  deployed: 'Deployed',
  superseded: 'Replaced by a newer request',
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export function DeployPage({ config, dirty, notify, versionId, onChanged }: {
  config: AgentConfig | null
  dirty: boolean
  notify: (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void
  versionId?: string
  onChanged: () => void
}) {
  const [target, setTarget] = useState<AgentVersion | null>(null)
  const [sent, setSent] = useState<DeployRequest | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', goLive: '', notes: '', confirmed: false })
  const [attempted, setAttempted] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const goLiveRef = useRef<HTMLInputElement>(null)
  const { mode, user } = useSession()
  const account = mode === 'clerk' && user ? user : null
  const ids = { name: useId(), email: useId(), goLive: useId(), notes: useId(), confirm: useId(), error: useId() }

  const pendingFor = (version: AgentVersion) => config?.deployRequests.find((request) => request.versionId === version.id && request.status === 'requested')
  const canRequest = (version: AgentVersion) => Boolean(config?.tracking) && !version.live && !pendingFor(version)

  useEffect(onChanged, [])

  const open = (version: AgentVersion) => {
    setSent(null)
    setAttempted(false)
    setTarget(version)
  }

  useEffect(() => {
    if (!config || !versionId) return
    const version = config.versions.find((item) => item.id === versionId)
    if (version && canRequest(version)) open(version)
    go({ page: 'deploy' }, true)
  }, [config, versionId])

  const requester = account ? { name: account.name, email: account.email } : { name: form.name.trim(), email: form.email.trim() }
  const errors = [
    !account && !form.name.trim() && 'Enter your name.',
    !account && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) && 'Enter a valid work email.',
    !form.confirmed && 'Confirm that this version has been tested.',
  ].filter(Boolean) as string[]

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setAttempted(true)
    if (errors.length || !target) return
    setSubmitting(true)
    try {
      const request = await requestDeploy({
        versionId: target.id,
        requestedBy: requester.name,
        email: requester.email,
        goLive: form.goLive,
        notes: form.notes.trim(),
      })
      setSent(request)
      setForm({ name: form.name, email: form.email, goLive: '', notes: '', confirmed: false })
      onChanged()
    } catch (error) {
      notify({ tone: 'error', title: 'Request not sent', body: `Nothing was sent (${describeError(error)}). Try again.` })
    } finally {
      setSubmitting(false)
    }
  }

  const live = config?.liveVersion
  const pending = config?.deployRequests.find((request) => request.status === 'requested')

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
              {pending && <span className="k1-status k1-status--contacted">v{pending.versionNumber} requested</span>}
            </div>
            <div className="k1-channel__text">
              <h2>WhatsApp</h2>
              {!config ? <Skeleton width={220} height={14} /> : live ? (
                <p><span className="k1-live-dot" aria-hidden="true" />Live: <strong>v{live.number}</strong>{config.liveSince ? ` since ${shortDate(config.liveSince)}` : ''}</p>
              ) : (
                <p>The live version is recorded once Wasup confirms a deployment.</p>
              )}
            </div>
          </article>
        </div>

        {config && !config.tracking && (
          <p className="k1-hint k1-hint--warn">Deploy requests and live tracking need the latest backend update. Your saved versions are listed below.</p>
        )}
        {dirty && <p className="k1-hint k1-hint--warn">You have unsaved Playground changes. Save them as a version before requesting a deployment.</p>}

        <section className="k1-deploy__versions" aria-labelledby="k1-versions-title">
          <h2 id="k1-versions-title" className="k1-section-title">Versions</h2>
          {!config ? (
            <div className="k1-table__skeleton">{[0, 1, 2].map((key) => <Skeleton key={key} height={64} />)}</div>
          ) : config.versions.length ? (
            <ul className="k1-versions">
              {config.versions.map((version) => {
                const request = pendingFor(version)
                return (
                  <li key={version.id} className={`k1-version${version.live ? ' is-live' : ''}`}>
                    <div className="k1-version__main">
                      <div className="k1-version__title">
                        <strong>v{version.number}</strong>
                        {version.live && <span className="k1-vtag is-live">Live</span>}
                        {request && <span className="k1-vtag is-draft">Requested</span>}
                      </div>
                      <p className="k1-version__note">{version.note || 'No change note'}</p>
                      <p className="k1-version__meta">
                        Saved {formatStamp(version.createdAt)}{version.savedBy ? ` · ${version.savedBy}` : ''}
                        {config.tracking && (
                          <span className="k1-version__score">
                            <ThumbsUp size={12} strokeWidth={1.75} />{version.thumbsUp}
                            <ThumbsDown size={12} strokeWidth={1.75} />{version.thumbsDown}
                            <span>· {version.conversations} test chat{version.conversations === 1 ? '' : 's'}</span>
                          </span>
                        )}
                      </p>
                    </div>
                    {!version.live && (
                      <button type="button" className="k1-btn k1-btn--outline k1-btn--sm" aria-haspopup="dialog" disabled={!canRequest(version)} onClick={() => open(version)}>
                        {request ? 'Requested' : 'Request deployment'}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : <p className="k1-hint">No saved versions yet. Save your Playground changes to create v1.</p>}
        </section>

        {config && config.deployRequests.length > 0 && (
          <section className="k1-deploy__requests" aria-labelledby="k1-requests-title">
            <h2 id="k1-requests-title" className="k1-section-title">Requests</h2>
            <ul>
              <AnimatePresence initial={false}>
                {config.deployRequests.map((request) => (
                  <motion.li key={request.id} className="k1-row-card" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: 0.2, ease }}>
                    <div className="k1-row-card__text">
                      <strong>v{request.versionNumber}</strong>
                      <span>
                        {formatStamp(request.createdAt)} · {request.requestedBy}
                        {request.goLive ? ` · go-live ${request.goLive}` : ''}
                        {request.deployedAt ? ` · deployed ${formatStamp(request.deployedAt)}` : ''}
                      </span>
                    </div>
                    <span className={`k1-status k1-status--${request.status === 'deployed' ? 'booked' : request.status === 'requested' ? 'contacted' : 'new'}`}>{STATUS_LABEL[request.status]}</span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </section>
        )}
      </div>

      <Dialog open={Boolean(target)} title={sent ? 'Request sent' : `Request deployment of v${target?.number ?? ''}`} onClose={() => setTarget(null)} width={440} initialFocus={sent ? undefined : account ? goLiveRef : nameRef}>
        <AnimatePresence mode="wait" initial={false}>
          {sent ? (
            <motion.div key="done" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease }}>
              <div className="k1-deploy__done">
                <span className="k1-deploy__check" aria-hidden="true"><Check size={16} strokeWidth={2.25} /></span>
                <p>
                  {EMAIL_CONNECTED
                    ? <>Wasup has been emailed about <strong>v{sent.versionNumber}</strong>. It shows as Deployed here once it is live on WhatsApp.</>
                    : <>The request for <strong>v{sent.versionNumber}</strong> is saved and shows as Waiting for Wasup. The email to Wasup is not connected yet, so let them know directly.</>}
                </p>
              </div>
              <footer className="k1-dialog__foot">
                <button type="button" className="k1-btn k1-btn--primary" onClick={() => setTarget(null)}>Done</button>
              </footer>
            </motion.div>
          ) : (
            <motion.form key="form" onSubmit={(event) => void submit(event)} noValidate initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14, ease }}>
              <div className="k1-form-stack">
                <div className="k1-field">
                  <span className="k1-field__label">Version</span>
                  <p className="k1-readonly">v{target?.number}{target?.note ? ` · ${target.note}` : ''}</p>
                </div>
                {account ? (
                  <div className="k1-field">
                    <span className="k1-field__label">Requested by</span>
                    <p className="k1-readonly">{account.name !== account.email ? `${account.name} · ${account.email}` : account.email}</p>
                  </div>
                ) : (
                  <>
                    <div className="k1-field">
                      <label htmlFor={ids.name}>Your name</label>
                      <input ref={nameRef} id={ids.name} className="k1-input" value={form.name} autoComplete="name" aria-invalid={(attempted && !form.name.trim()) || undefined} onChange={(event) => setForm({ ...form, name: event.target.value })} />
                    </div>
                    <div className="k1-field">
                      <label htmlFor={ids.email}>Work email</label>
                      <input id={ids.email} className="k1-input" type="email" value={form.email} placeholder="name@k1katsastus.fi" autoComplete="email" aria-invalid={(attempted && errors.includes('Enter a valid work email.')) || undefined} onChange={(event) => setForm({ ...form, email: event.target.value })} />
                    </div>
                  </>
                )}
                <div className="k1-field">
                  <label htmlFor={ids.goLive}>Preferred go-live date</label>
                  <input ref={goLiveRef} id={ids.goLive} className="k1-input" type="date" value={form.goLive} onChange={(event) => setForm({ ...form, goLive: event.target.value })} />
                </div>
                <div className="k1-field">
                  <label htmlFor={ids.notes}>Notes</label>
                  <textarea id={ids.notes} className="k1-textarea" rows={3} value={form.notes} placeholder="Anything Wasup should know before it goes live" onChange={(event) => setForm({ ...form, notes: event.target.value })} />
                </div>
                <label className="k1-check" htmlFor={ids.confirm}>
                  <input id={ids.confirm} type="checkbox" checked={form.confirmed} onChange={(event) => setForm({ ...form, confirmed: event.target.checked })} />
                  <span className="k1-check__box" aria-hidden="true"><Check size={11} strokeWidth={3} /></span>
                  This version has been tested.
                </label>
                {attempted && errors.length > 0 && <p id={ids.error} className="k1-auth__error" role="alert">{errors[0]}</p>}
              </div>
              <footer className="k1-dialog__foot">
                <button type="button" className="k1-btn k1-btn--outline" onClick={() => setTarget(null)}>Cancel</button>
                <button type="submit" className="k1-btn k1-btn--primary" disabled={submitting} aria-busy={submitting}>{submitting && <Spinner />}Send request</button>
              </footer>
            </motion.form>
          )}
        </AnimatePresence>
      </Dialog>
    </div>
  )
}
