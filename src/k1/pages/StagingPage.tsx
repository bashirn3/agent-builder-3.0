import { useEffect, useId, useState } from 'react'
import { describeError, localized, openerPreview, type AgentVersion } from '../data/agentConfig'
import {
  currentActor,
  listStagingSessions,
  resetCustomer,
  resetStagingSession,
  sendStaging,
  type StagingSession,
} from '../data/builderApi'
import { shortStation } from '../data/fixtures'
import { detectLanguage, leadContext } from '../data/language'
import type { PlaygroundStore } from '../data/usePlayground'
import { useCopy } from '../i18n'
import { href } from '../routes'
import { Select, Spinner } from '../ui/controls'
import { Dialog } from '../ui/overlay'
import { RefreshCw, WhatsApp } from '../ui/icons'
import { formatStamp } from './SplitView'
import { orderVersions, versionHint } from './versionText'

const placeholderPhone = (phone: string) => /^\+358\s*40\s*000/.test(phone.trim())

export function StagingPage({ store, notify }: {
  store: PlaygroundStore
  notify: (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void
}) {
  const t = useCopy()
  const versions = orderVersions(store.config?.versions ?? [])
  const [versionId, setVersionId] = useState<string | null>(null)
  const [version, setVersion] = useState<AgentVersion | null>(null)
  const [loadingVersion, setLoadingVersion] = useState(false)
  const [sessions, setSessions] = useState<StagingSession[] | null>(null)
  const [sending, setSending] = useState(false)
  const [resetting, setResetting] = useState<StagingSession | null>(null)
  const ids = { version: useId(), lead: useId() }

  useEffect(() => {
    if (versionId || !store.config) return
    const ordered = orderVersions(store.config.versions)
    const active = ordered.find((item) => item.active) ?? ordered[0]
    if (active) setVersionId(active.id)
  }, [store.config, versionId])

  useEffect(() => {
    if (!versionId) return
    let cancelled = false
    setLoadingVersion(true)
    store.ensureVersion(versionId)
      .then((loaded) => { if (!cancelled) setVersion(loaded) })
      .catch((error: unknown) => { if (!cancelled) notify({ tone: 'error', title: t.staging.failed, body: describeError(error) }) })
      .finally(() => { if (!cancelled) setLoadingVersion(false) })
    return () => { cancelled = true }
  }, [versionId])

  const refresh = () => {
    listStagingSessions()
      .then(setSessions)
      .catch((error: unknown) => notify({ tone: 'error', title: t.staging.failed, body: describeError(error) }))
  }
  useEffect(refresh, [])

  const lead = store.lead
  const phone = lead?.phoneNumber?.trim() ?? ''
  const used = version && lead ? localized(version, lead) : null
  const opener = used && lead ? openerPreview(used.opener, lead, used.lang) : ''
  const blocked = !phone ? t.staging.noPhone : lead?.sample || placeholderPhone(phone) ? t.staging.samplePhone : !opener ? t.staging.openerEmpty : ''
  const canSend = Boolean(version && lead && opener && phone && !blocked && !sending && !loadingVersion)

  const send = async () => {
    if (!canSend || !version || !lead || !used) return
    setSending(true)
    try {
      const result = await sendStaging({
        phone,
        versionId: version.id,
        opener,
        leadContext: leadContext(lead, used.lang),
        startedBy: currentActor()?.name ?? null,
        lead: {
          plateNumber: lead.plateNumber,
          stationName: lead.stationName,
          phoneNumber: phone,
          product: lead.product ?? '',
          language: lead.language ?? '',
          nextInspection: lead.nextInspection,
          lastInspection: lead.lastInspection,
          vehicleCategory: lead.vehicleCategory ?? '',
          powerType: lead.powerType ?? '',
        },
      })
      notify({ title: t.staging.sent, body: t.staging.sentBody(result.versionNumber ?? version.number, phone) })
      refresh()
    } catch (error) {
      notify({ tone: 'error', title: t.staging.failed, body: describeError(error) })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="k1-deploy">
      <header className="k1-deploy__head">
        <h1 className="k1-deploy__title">{t.staging.title}</h1>
      </header>
      <div className="k1-deploy__body">
        <section className="k1-deploy-summary" aria-label={t.staging.title}>
          <div className="k1-deploy-summary__identity"><span className="k1-deploy-summary__mark" aria-hidden="true"><WhatsApp size={21} /></span><span>{t.nav.bookingAgent}</span></div>
          <p>{t.staging.intro}</p>
          <p className="k1-deploy-summary__note">{t.staging.stripeNote}</p>
        </section>

        <div className="k1-staging__grid" style={{ marginTop: 28 }}>
          <div className="k1-staging__form">
            <div className="k1-field">
              <label htmlFor={ids.version}>{t.staging.version}</label>
              <Select
                id={ids.version}
                label={t.staging.version}
                value={versionId}
                placeholder={t.staging.chooseVersion}
                search={{ placeholder: t.staging.searchVersions, emptyText: t.staging.noVersions }}
                options={versions.map((item) => ({
                  value: item.id,
                  label: `v${item.number}`,
                  hint: versionHint(item, t),
                  keywords: `${item.number} ${item.note}`,
                }))}
                onChange={setVersionId}
              />
            </div>
            <div className="k1-field">
              <label htmlFor={ids.lead}>{t.staging.lead}</label>
              <Select
                id={ids.lead}
                label={t.staging.lead}
                className="k1-tester__lead"
                optionClassName="k1-listbox__option--lead"
                value={lead?.id ?? null}
                placeholder={t.tester.chooseLead}
                search={{ placeholder: t.tester.searchLeads, emptyText: t.tester.noMatchingLeads }}
                options={store.leads.map((item) => ({
                  value: item.id,
                  label: `${item.plateNumber} · ${shortStation(item.stationName) || t.tester.noStation}`,
                  hint: item.phoneNumber || undefined,
                  badge: t.opener.languages[detectLanguage(item.language)],
                  keywords: `${item.plateNumber} ${item.phoneNumber ?? ''}`,
                  group: item.sample ? t.tester.sampleLeads : t.tester.uploadedLeads,
                }))}
                onChange={(id) => store.setLeadId(id)}
              />
            </div>
            {blocked && <p className="k1-hint">{blocked}</p>}
            <div className="k1-staging__actions">
              <button type="button" className="k1-btn k1-btn--primary" onClick={() => void send()} disabled={!canSend} aria-busy={sending}>
                {sending && <Spinner />}{sending ? t.staging.sending : t.staging.send}
              </button>
            </div>
          </div>
          <div className="k1-staging__preview">
            <span className="k1-section-title">{t.staging.opener}</span>
            {loadingVersion
              ? <p className="k1-hint">{t.staging.loadingOpener}</p>
              : !version
                ? <p className="k1-hint">{t.staging.chooseVersion}</p>
                : <p className="k1-staging__bubble">{opener || t.staging.openerEmpty}</p>}
          </div>
        </div>

        <section className="k1-staging__table" aria-labelledby="k1-staging-assigned">
          <h2 id="k1-staging-assigned" className="k1-section-title">{t.staging.assigned}</h2>
          {sessions === null ? <p className="k1-hint">{t.common.loading}</p> : sessions.length === 0 ? <p className="k1-hint">{t.staging.empty}</p> : (
            <div className="k1-table-card">
              <table className="k1-table">
                <thead>
                  <tr>
                    <th>{t.staging.phone}</th>
                    <th>{t.staging.plate}</th>
                    <th>{t.staging.versionColumn}</th>
                    <th>{t.staging.activity}</th>
                    <th>{t.staging.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr key={session.phoneKey}>
                      <th scope="row">{session.phone}</th>
                      <td>{session.plate || '—'}</td>
                      <td>{session.versionNumber ? `v${session.versionNumber}` : '—'}</td>
                      <td>{formatStamp(session.updatedAt)}</td>
                      <td>
                        <div className="k1-staging__actions">
                          <a className="k1-btn k1-btn--outline k1-btn--sm" href={href({ page: 'chats', id: session.conversationId })}>{t.staging.view}</a>
                          <button type="button" className="k1-btn k1-btn--outline k1-btn--sm" onClick={() => setResetting(session)}>
                            <RefreshCw size={14} strokeWidth={1.75} />{t.staging.reset}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      <ResetDialog
        session={resetting}
        onClose={() => setResetting(null)}
        onDone={() => { setResetting(null); refresh() }}
        notify={notify}
      />
    </div>
  )
}

function ResetDialog({ session, onClose, onDone, notify }: {
  session: StagingSession | null
  onClose: () => void
  onDone: () => void
  notify: (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void
}) {
  const t = useCopy()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const word = t.reset.word
  const matches = typed.trim().toUpperCase() === word
  const close = () => { if (!busy) { setTyped(''); onClose() } }
  const confirm = async () => {
    if (!session || !matches || busy) return
    setBusy(true)
    try {
      const bookings = await resetCustomer(session.phone)
      if (!bookings.ok) throw new Error('reset_failed')
      await resetStagingSession(session.phone)
      setTyped('')
      notify({ title: t.staging.resetDone, body: t.staging.resetDoneBody })
      onDone()
    } catch (error) {
      notify({ tone: 'error', title: t.staging.resetFailed, body: describeError(error) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={Boolean(session)} title={t.staging.resetTitle} onClose={close} width={480}>
      <div className="k1-form-stack">
        <p>{t.staging.resetBody}</p>
        {session && <p className="k1-hint">{session.phone}{session.versionNumber ? ` · v${session.versionNumber}` : ''}</p>}
        <div className="k1-field">
          <label htmlFor="k1-staging-reset">{t.reset.typeLabel(word)}</label>
          <input
            id="k1-staging-reset"
            className="k1-input"
            value={typed}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void confirm() }}
          />
        </div>
      </div>
      <footer className="k1-dialog__foot">
        <button type="button" className="k1-btn k1-btn--outline" onClick={close} disabled={busy}>{t.common.cancel}</button>
        <button type="button" className="k1-btn k1-btn--danger" onClick={() => void confirm()} disabled={!matches || busy} aria-busy={busy}>
          {busy && <Spinner />}{t.staging.resetConfirm}
        </button>
      </footer>
    </Dialog>
  )
}
