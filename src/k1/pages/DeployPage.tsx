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
import { locale, useCopy } from '../i18n'
import { localizeNote } from '../data/changes'
import { ResetVersions } from './ResetVersions'
import { RowCardsSkeleton } from '../ui/skeletons'

// Flip once the email step in the Deploy Request workflow sends to Wasup.
const EMAIL_CONNECTED = true

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })

export function DeployPage({ config, dirty, notify, versionId, onChanged }: {
  config: AgentConfig | null
  dirty: boolean
  notify: (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void
  versionId?: string
  onChanged: (force?: boolean) => void
}) {
  const t = useCopy()
  const [target, setTarget] = useState<AgentVersion | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showPastRequests, setShowPastRequests] = useState(false)
  const [sent, setSent] = useState<DeployRequest | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', notes: '', confirmed: false })
  const [attempted, setAttempted] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const { mode, user, isAdmin } = useSession()
  const account = mode === 'clerk' && user ? user : null
  const ids = { name: useId(), email: useId(), notes: useId(), confirm: useId(), error: useId() }

  const pendingFor = (version: AgentVersion) => config?.deployRequests.find((request) => request.versionId === version.id && request.status === 'requested')
  const canRequest = (version: AgentVersion) => Boolean(config?.tracking) && !pendingFor(version)

  useEffect(() => onChanged(), [])

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
    !account && !form.name.trim() && t.deploy.errors.name,
    !account && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) && t.deploy.errors.email,
    !form.confirmed && t.deploy.errors.tested,
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
        goLive: '',
        notes: form.notes.trim(),
      })
      setSent(request)
      setForm({ name: form.name, email: form.email, notes: '', confirmed: false })
      onChanged(true)
    } catch (error) {
      notify({ tone: 'error', title: t.deploy.failed, body: t.deploy.failedBody(describeError(error)) })
    } finally {
      setSubmitting(false)
    }
  }

  const pending = config?.deployRequests.filter((request) => request.status === 'requested') ?? []
  const active = config?.versions.find((version) => version.active)
  const visibleVersions = config?.versions.filter((version) => showHistory || version.active || Boolean(pendingFor(version))) ?? []
  const hiddenCount = (config?.versions.length ?? 0) - visibleVersions.length
  const olderRequests = config?.deployRequests.filter((request) => request.status !== 'requested') ?? []

  return (
    <div className="k1-deploy">
      <header className="k1-deploy__head">
        <h1 className="k1-deploy__title">{t.deploy.title}</h1>
      </header>
      <div className="k1-deploy__body">
        <section className="k1-deploy-summary" aria-label={t.deploy.currentStatus}>
          <div className="k1-deploy-summary__identity"><span className="k1-deploy-summary__mark" aria-hidden="true"><WhatsApp size={21} /></span><span>{t.nav.bookingAgent}</span></div>
          {!config ? <Skeleton width={220} height={22} /> : (
            <div className="k1-deploy-summary__main">
              <div className="k1-deploy-summary__live"><strong>{active ? t.deploy.savedVersion(active.number) : t.deploy.noVersions}</strong></div>
              <p>{t.deploy.approvedBaseline}</p>
            </div>
          )}
          {pending.length > 0 && <p className="k1-deploy-summary__pending">{t.deploy.pendingCount(pending.length)}</p>}
          <p className="k1-deploy-summary__note">{t.deploy.liveDisclaimer}</p>
        </section>

        {config && !config.tracking && (
          <p className="k1-hint k1-hint--warn">{t.deploy.needsBackend}</p>
        )}
        {dirty && <p className="k1-hint k1-hint--warn">{t.deploy.unsavedWarning}</p>}

        <section className="k1-deploy__versions" aria-labelledby="k1-versions-title">
          <h2 id="k1-versions-title" className="k1-section-title">{t.deploy.versions}</h2>
          {!config ? (
            <RowCardsSkeleton label={t.deploy.versions} />
          ) : config.versions.length ? (
            <>
            <ul className="k1-versions">
              {visibleVersions.map((version) => {
                const request = pendingFor(version)
                return (
                  <li key={version.id} className={`k1-version${version.active ? ' is-live' : ''}`}>
                    <div className="k1-version__main">
                      <div className="k1-version__title">
                        <strong>v{version.number}</strong>
                        {version.active && <span className="k1-vtag is-live">{t.deploy.currentVersion}</span>}
                        {request && <span className="k1-vtag is-draft">{t.common.requested}</span>}
                      </div>
                      <p className="k1-version__note">{version.note ? localizeNote(version.note, t) : t.deploy.noNote}</p>
                      <p className="k1-version__meta">
                        {t.deploy.saved(formatStamp(version.createdAt))}{version.savedBy ? ` · ${version.savedBy}` : ''}
                        {config.tracking && (
                          <span className="k1-version__score">
                            <ThumbsUp size={12} strokeWidth={1.75} />{version.thumbsUp}
                            <ThumbsDown size={12} strokeWidth={1.75} />{version.thumbsDown}
                            <span>· {t.deploy.testChats(version.conversations)}</span>
                          </span>
                        )}
                      </p>
                    </div>
                    {!request && (
                      <button type="button" className="k1-btn k1-btn--outline k1-btn--sm" aria-haspopup="dialog" disabled={!canRequest(version)} onClick={() => open(version)}>
                        {t.deploy.request}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
            {(hiddenCount > 0 || showHistory) && (
              <button type="button" className="k1-link k1-versions__more" aria-expanded={showHistory} onClick={() => setShowHistory((value) => !value)}>
                {showHistory ? t.versions.showFewer : t.versions.showOlder(hiddenCount)}
              </button>
            )}
            </>
          ) : <p className="k1-hint">{t.deploy.noVersions}</p>}
        </section>

        {config && config.deployRequests.length > 0 && (
          <section className="k1-deploy__requests" aria-labelledby="k1-requests-title">
            <h2 id="k1-requests-title" className="k1-section-title">{t.deploy.requests}</h2>
            {isAdmin && pending.length > 0 && <p className="k1-deploy__admin-note">{t.deploy.adminUnavailable}</p>}
            <ul>
              <AnimatePresence initial={false}>
                {(showPastRequests ? config.deployRequests : pending).map((request) => (
                  <motion.li key={request.id} className="k1-row-card" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: 0.2, ease }}>
                    <div className="k1-row-card__text">
                      <strong>v{request.versionNumber}</strong>
                      <span>
                        {formatStamp(request.createdAt)} · {request.requestedBy}
                        {request.goLive ? t.deploy.goLive(request.goLive) : ''}
                        {request.deployedAt ? t.deploy.deployedAt(formatStamp(request.deployedAt)) : ''}
                      </span>
                      {request.notes && <small className="k1-row-card__note" title={request.notes}>{request.notes}</small>}
                    </div>
                    <span className={`k1-status k1-status--${request.status === 'deployed' ? 'booked' : request.status === 'requested' ? 'contacted' : 'new'}`}>{t.deploy.status[request.status]}</span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
            {olderRequests.length > 0 && <button type="button" className="k1-link k1-versions__more" aria-expanded={showPastRequests} onClick={() => setShowPastRequests((value) => !value)}>{showPastRequests ? t.deploy.hidePastRequests : t.deploy.showPastRequests(olderRequests.length)}</button>}
          </section>
        )}

        {config && config.tracking && <ResetVersions config={config} dirty={dirty} notify={notify} onReset={() => onChanged(true)} />}
      </div>

      <Dialog open={Boolean(target)} title={sent ? t.deploy.sentTitle : t.deploy.requestTitle(target?.number ?? '')} onClose={() => setTarget(null)} width={440} initialFocus={sent || account ? undefined : nameRef}>
        <AnimatePresence mode="wait" initial={false}>
          {sent ? (
            <motion.div key="done" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease }}>
              <div className="k1-deploy__done">
                <span className="k1-deploy__check" aria-hidden="true"><Check size={16} strokeWidth={2.25} /></span>
                <p>
                  {EMAIL_CONNECTED
                    ? (([a, b, c]) => <>{a}<strong>{b}</strong>{c}</>)(t.deploy.emailed(sent.versionNumber))
                    : (([a, b, c]) => <>{a}<strong>{b}</strong>{c}</>)(t.deploy.saved2(sent.versionNumber))}
                </p>
              </div>
              <footer className="k1-dialog__foot">
                <button type="button" className="k1-btn k1-btn--primary" onClick={() => setTarget(null)}>{t.common.done}</button>
              </footer>
            </motion.div>
          ) : (
            <motion.form key="form" onSubmit={(event) => void submit(event)} noValidate initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14, ease }}>
              <div className="k1-form-stack">
                <div className="k1-field">
                  <span className="k1-field__label">{t.deploy.version}</span>
                  <p className="k1-readonly">v{target?.number}{target?.note ? ` · ${target.note}` : ''}</p>
                </div>
                {account ? (
                  <div className="k1-field">
                    <span className="k1-field__label">{t.deploy.requestedBy}</span>
                    <p className="k1-readonly">{account.name !== account.email ? `${account.name} · ${account.email}` : account.email}</p>
                  </div>
                ) : (
                  <>
                    <div className="k1-field">
                      <label htmlFor={ids.name}>{t.deploy.yourName}</label>
                      <input ref={nameRef} id={ids.name} className="k1-input" value={form.name} autoComplete="name" aria-invalid={(attempted && !form.name.trim()) || undefined} onChange={(event) => setForm({ ...form, name: event.target.value })} />
                    </div>
                    <div className="k1-field">
                      <label htmlFor={ids.email}>{t.deploy.workEmail}</label>
                      <input id={ids.email} className="k1-input" type="email" value={form.email} placeholder="name@k1katsastus.fi" autoComplete="email" aria-invalid={(attempted && errors.includes(t.deploy.errors.email)) || undefined} onChange={(event) => setForm({ ...form, email: event.target.value })} />
                    </div>
                  </>
                )}
                <div className="k1-field">
                  <label htmlFor={ids.notes}>{t.deploy.notes}</label>
                  <textarea id={ids.notes} className="k1-textarea" rows={3} value={form.notes} placeholder={t.deploy.notesPlaceholder} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
                </div>
                <label className="k1-check" htmlFor={ids.confirm}>
                  <input id={ids.confirm} type="checkbox" checked={form.confirmed} onChange={(event) => setForm({ ...form, confirmed: event.target.checked })} />
                  <span className="k1-check__box" aria-hidden="true"><Check size={11} strokeWidth={3} /></span>
                  {t.deploy.tested}
                </label>
                {attempted && errors.length > 0 && <p id={ids.error} className="k1-auth__error" role="alert">{errors[0]}</p>}
              </div>
              <footer className="k1-dialog__foot">
                <button type="button" className="k1-btn k1-btn--outline" onClick={() => setTarget(null)}>{t.common.cancel}</button>
                <button type="submit" className="k1-btn k1-btn--primary" disabled={submitting} aria-busy={submitting}>{submitting && <Spinner />}{t.deploy.send}</button>
              </footer>
            </motion.form>
          )}
        </AnimatePresence>
      </Dialog>
    </div>
  )
}
