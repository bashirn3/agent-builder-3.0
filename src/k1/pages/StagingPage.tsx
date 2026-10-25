import { useEffect, useId, useState } from 'react'
import { describeError, localized, openerPreview, type AgentVersion } from '../data/agentConfig'
import {
  currentActor,
  getStagingThread,
  listStagingSessions,
  resetCustomer,
  resetStagingSession,
  sendStaging,
  type StagingMessage,
  type StagingSession,
} from '../data/builderApi'
import { shortStation } from '../data/fixtures'
import { detectLanguage, leadContext } from '../data/language'
import { applyPhoneInput, composePhone, dialCode, DIAL_COUNTRIES, nationalExample, nationalLimit, prefillPhone, type DialCountry } from '../data/phone'
import type { PlaygroundStore } from '../data/usePlayground'
import { useCopy } from '../i18n'
import { Select, Spinner } from '../ui/controls'
import { Dialog } from '../ui/overlay'
import { RefreshCw } from '../ui/icons'
import { formatStamp } from './SplitView'
import { orderVersions, versionHint } from './versionText'

function sendFailure(error: unknown, copy: ReturnType<typeof useCopy>) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'unknown_version' || message === 'version_lookup_failed') return copy.staging.unknownVersion
  if (message === 'claim_failed') return copy.staging.claimFailed
  if (message === 'whatsapp_failed') return copy.staging.whatsappFailed
  if (message === 'send_failed' || message === 'phone_required') return copy.staging.sendFailed
  return describeError(error)
}

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
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [messages, setMessages] = useState<StagingMessage[]>([])
  const [loadingThread, setLoadingThread] = useState(false)
  const [sending, setSending] = useState(false)
  const [resetting, setResetting] = useState<StagingSession | null>(null)
  const [country, setCountry] = useState<DialCountry>('fi')
  const [national, setNational] = useState('')
  const ids = { version: useId(), lead: useId(), phone: useId(), country: useId(), conversation: useId() }

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
      .catch((error: unknown) => { if (!cancelled) notify({ tone: 'error', title: t.staging.failed, body: sendFailure(error, t) }) })
      .finally(() => { if (!cancelled) setLoadingVersion(false) })
    return () => { cancelled = true }
  }, [versionId])

  const refresh = () => {
    listStagingSessions()
      .then((next) => {
        setSessions(next)
        setSelectedKey((current) => current && next.some((item) => item.phoneKey === current) ? current : next[0]?.phoneKey ?? null)
      })
      .catch((error: unknown) => notify({ tone: 'error', title: t.staging.failed, body: sendFailure(error, t) }))
  }
  useEffect(refresh, [])

  const selected = sessions?.find((item) => item.phoneKey === selectedKey) ?? null

  useEffect(() => {
    if (!selected) { setMessages([]); return }
    let cancelled = false
    setLoadingThread(true)
    getStagingThread(selected.phone)
      .then((thread) => { if (!cancelled) setMessages(thread.messages) })
      .catch((error: unknown) => { if (!cancelled) notify({ tone: 'error', title: t.staging.failed, body: sendFailure(error, t) }) })
      .finally(() => { if (!cancelled) setLoadingThread(false) })
    return () => { cancelled = true }
  }, [selected?.phone, selected?.conversationId])

  const lead = store.lead
  useEffect(() => {
    const next = prefillPhone(lead?.phoneNumber, lead ? detectLanguage(lead.language) : 'fi')
    const applied = next ? applyPhoneInput(next.country, next.national) : null
    setCountry(applied?.country ?? 'fi')
    setNational(applied?.national ?? '')
  }, [lead?.id])

  const composed = composePhone(country, national)
  const used = version && lead ? localized(version, lead) : null
  const opener = used && lead ? openerPreview(used.opener, lead, used.lang) : ''
  const blocked = national.trim() && !composed.ok
    ? t.staging.invalidPhone
    : composed.placeholder
      ? t.staging.samplePhone
      : version && lead && !loadingVersion && !opener
        ? t.staging.openerEmpty
        : ''
  const canSend = Boolean(version && lead && opener && composed.ok && !composed.placeholder && !sending && !loadingVersion)
  const replied = messages.some((message) => message.role === 'user')
  const leadLabel = selected
    ? [selected.plate, shortStation(selected.stationName)].filter(Boolean).join(' · ')
    : ''

  const send = async () => {
    if (!canSend || !version || !lead || !used || !composed.ok) return
    const phone = composed.display
    const messaged = { ...lead, phoneNumber: phone }
    setSending(true)
    try {
      const result = await sendStaging({
        phone,
        versionId: version.id,
        opener,
        leadContext: leadContext(messaged, used.lang),
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
      setSelectedKey(phone.replace(/\D/g, ''))
      refresh()
    } catch (error) {
      notify({ tone: 'error', title: t.staging.failed, body: sendFailure(error, t) })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="k1-staging">
      <div className="k1-staging__play">
        <aside className="k1-staging__setup">
          <h1 className="k1-page-title">{t.staging.title}</h1>
          <p className="k1-staging__intro">{t.staging.intro}</p>
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
            <div className="k1-field">
              <label htmlFor={ids.phone}>{t.staging.number}</label>
              <div className="k1-phone" data-invalid={national.trim() && !composed.ok ? 'true' : undefined}>
                <Select
                  id={ids.country}
                  label={t.staging.country}
                  value={country}
                  placeholder={t.staging.country}
                  options={DIAL_COUNTRIES.map((code) => ({
                    value: code,
                    label: `${t.staging.countries[code]} +${dialCode(code)}`,
                  }))}
                  onChange={(code) => {
                    setCountry(code)
                    setNational((current) => current.slice(0, nationalLimit(code)))
                  }}
                />
                <div className="k1-phone__number">
                  <input
                    id={ids.phone}
                    value={national}
                    inputMode="numeric"
                    autoComplete="tel-national"
                    spellCheck={false}
                    pattern="[0-9]*"
                    placeholder={nationalExample(country).replace(/\s/g, '')}
                    aria-invalid={national.trim() && !composed.ok ? true : undefined}
                    onChange={(event) => {
                      const next = applyPhoneInput(country, event.target.value)
                      setCountry(next.country)
                      setNational(next.national)
                    }}
                    onKeyDown={(event) => { if (event.key === 'Enter' && canSend) void send() }}
                  />
                </div>
              </div>
            </div>
            {blocked ? <p className="k1-hint">{blocked}</p> : composed.ok && <p className="k1-hint">{composed.display}</p>}
            {opener && <p className="k1-hint k1-staging__opener">{opener}</p>}
            <div className="k1-staging__actions">
              <button type="button" className="k1-btn k1-btn--primary" onClick={() => void send()} disabled={!canSend} aria-busy={sending}>
                {sending && <Spinner />}{sending ? t.staging.sending : t.staging.send}
              </button>
            </div>
          </div>
          <section className="k1-staging__card" aria-labelledby="k1-staging-card">
            <h2 id="k1-staging-card" className="k1-section-title">{t.staging.stripeTitle}</h2>
            <p className="k1-hint">{t.staging.stripeNote}</p>
            <dl>
              <div><dt>{t.staging.cardNumber}</dt><dd>{t.staging.cardNumberValue}</dd></div>
              <div><dt>{t.staging.cardExpiry}</dt><dd>{t.staging.cardExpiryValue}</dd></div>
              <div><dt>{t.staging.cardCvc}</dt><dd>{t.staging.cardCvcValue}</dd></div>
              <div><dt>{t.staging.cardPromo}</dt><dd>{t.staging.cardPromoValue}</dd></div>
            </dl>
          </section>
        </aside>
        <div className="k1-canvas">
          <div className="k1-tester" aria-label={t.staging.conversation}>
            <header className="k1-tester__head">
              <span className="k1-tester__avatar"><img src="/brand/k1-katsastus.jpg" alt="" width={26} height={26} /></span>
              <h2>K1 Katsastus</h2>
              {selected && (
                <button type="button" className="k1-icon-btn k1-tester__reset" aria-label={t.staging.reset} title={t.staging.reset} onClick={() => setResetting(selected)}>
                  <RefreshCw size={16} strokeWidth={1.75} />
                </button>
              )}
            </header>
            <div className="k1-tester__context">
              <span className="k1-tester__context-label">{t.staging.conversation}</span>
              <Select
                id={ids.conversation}
                label={t.staging.conversation}
                className="k1-tester__lead"
                value={selectedKey}
                placeholder={t.staging.chooseConversation}
                search={{ placeholder: t.staging.chooseConversation, emptyText: t.staging.empty }}
                options={(sessions ?? []).map((item) => ({
                  value: item.phoneKey,
                  label: item.phone,
                  hint: [item.plate, item.versionNumber ? `v${item.versionNumber}` : ''].filter(Boolean).join(' · '),
                  keywords: `${item.phone} ${item.plate} ${item.stationName}`,
                }))}
                onChange={setSelectedKey}
              />
            </div>
            {selected && (
              <p className="k1-staging__status">
                <strong>{leadLabel}</strong>
                <span>{selected.versionNumber ? `v${selected.versionNumber}` : ''}</span>
                <span>{replied ? t.staging.statusReplied : t.staging.statusWaiting}</span>
                <span>{formatStamp(selected.updatedAt)}</span>
              </p>
            )}
            <div className="k1-tester__thread">
              {sessions === null || loadingThread ? <p className="k1-hint">{t.common.loading}</p> : !selected ? <p className="k1-hint">{t.staging.noConversation}</p> : messages.length === 0 ? <p className="k1-hint">{t.staging.noMessages}</p> : messages.map((message) => (
                <div key={message.id} className={message.role === 'user' ? 'k1-msg k1-msg--user' : 'k1-msg'}>
                  <p className="k1-msg__bubble">{message.text}</p>
                </div>
              ))}
            </div>
            <p className="k1-tester__powered">{t.staging.readOnly}</p>
          </div>
        </div>
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
