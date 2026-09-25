import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react'
import { CalendarDays, Download, Info, MessagesSquare, Upload, X } from '../ui/icons'
import { useCopy } from '../i18n'
import { ease } from '../../lib/motion'
import { downloadCsv, filterLeads, fixtureLeads, shortStation, submittedStamp, toCsv, type Lead } from '../data/fixtures'
import { formatDate } from '../data/language'
import { go, href } from '../routes'
import { Select, Skeleton, Spinner } from '../ui/controls'
import { AccessError, importLeads, listLeads, MUSTER_STATIONS, type LeadRow, type StationStatus, type UploadedLead } from '../data/builderApi'
import { describeError } from '../data/agentConfig'
import { MUSTER_MAX_DAYS, useMusterLeads } from '../data/useMusterLeads'
import { LeadUploadDialog } from './LeadUpload'
import { DateRangeField, isoDay } from '../ui/DateRange'
import { Drawer } from '../ui/overlay'
import { Facts, SampleBadge, Thread } from './SplitView'

const day = (iso: string | null) => formatDate(iso, 'fi') || '—'


function fromUpload(lead: UploadedLead): Lead {
  return {
    id: lead.id,
    stationName: lead.stationName,
    isClosed: lead.isClosed,
    plateNumber: lead.plateNumber,
    product: lead.product,
    nextInspection: lead.nextInspection,
    phoneNumber: lead.phoneNumber,
    language: lead.language,
    lastInspection: lead.lastInspection,
    reason: lead.reason,
    addedAt: lead.createdAt,
    sample: false,
    conversationIds: [],
  }
}

function ClosedTag() {
  const t = useCopy()
  return <span className="k1-tag k1-tag--danger" title={t.leads.closedTitle}>{t.leads.closedTag}</span>
}

function LeadDetail({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const t = useCopy()
  const c = t.leads.columns
  const product = t.leads.products[lead.product]
  const conversations = lead.sample ? fixtureLeads.conversationsFor(lead) : []
  return (
    <div className="k1-lead">
      <header className="k1-lead__head">
        <div>
          <h2>{lead.plateNumber}</h2>
          <p>{lead.stationName || t.leads.noStation}</p>
        </div>
        <button type="button" className="k1-icon-btn k1-icon-btn--boxed" aria-label={t.leads.closeLead} onClick={onClose}>
          <X size={16} strokeWidth={1.75} />
        </button>
      </header>
      <div className="k1-lead__body">
        {lead.isClosed && <p className="k1-lead__closed" role="note">{t.leads.closedNote}</p>}
        <Facts
          heading={t.leads.leadDetails}
          rows={[
            [c.station, <span className="k1-lead__station">{lead.stationName || '—'}{lead.isClosed && <ClosedTag />}</span>],
            [c.phone, lead.phoneNumber || '—'],
            [c.language, lead.language || '—'],
            [c.next, day(lead.nextInspection)],
            [c.last, day(lead.lastInspection)],
            [c.product, lead.product ? `${product ? `${product} · ` : ''}${lead.product}` : '—'],
            [c.reason, lead.reason || '—'],
            lead.live ? [c.source, t.leads.sourceMuster] : [lead.sample ? c.added : c.uploaded, submittedStamp(lead.addedAt)],
          ]}
        />
        {lead.sample && (
          <section className="k1-lead__section">
            <h3 className="k1-facts__heading"><MessagesSquare size={14} strokeWidth={1.75} />{t.leads.exampleConversation}</h3>
            {conversations.length ? conversations.map((conversation) => (
              <div key={conversation.id} className="k1-lead-thread">
                <p className="k1-hint">{conversation.channel}</p>
                <Thread messages={conversation.messages} />
              </div>
            )) : <p className="k1-hint">{t.leads.noLinkedConversation}</p>}
          </section>
        )}
        {!lead.sample && (
          <section className="k1-lead__section">
            <h3 className="k1-facts__heading"><Info size={14} strokeWidth={1.75} />{t.leads.conversation}</h3>
            <p className="k1-hint">{t.leads.noConversation}</p>
          </section>
        )}
      </div>
    </div>
  )
}

type View = 'muster' | 'saved'
const VIEW_KEY = 'k1-leads-view'

function fromMuster(row: LeadRow, stationId: number): Lead {
  return {
    id: `m-${stationId}-${row.PlateNumber.replace(/[^A-Za-z0-9]/g, '')}`,
    stationName: row.StationName,
    isClosed: row.isClosed,
    plateNumber: row.PlateNumber,
    product: row.Product,
    nextInspection: row.NextInspectionDateRangeEnd || null,
    phoneNumber: row.PhoneNumber,
    language: row.Language,
    lastInspection: row.LastInspection || null,
    reason: row.Reason,
    addedAt: '',
    sample: false,
    live: true,
    conversationIds: [],
  }
}

function ViewSwitch({ value, onChange }: { value: View; onChange: (view: View) => void }) {
  const t = useCopy()
  const views: View[] = ['muster', 'saved']
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next = views[(views.indexOf(value) + 1) % views.length]
    onChange(next)
    const list = event.currentTarget
    requestAnimationFrame(() => list.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus())
  }
  return (
    <div className="k1-segmented k1-leads__views" role="tablist" aria-label={t.leads.viewLabel} onKeyDown={onKey}>
      {views.map((view) => (
        <button key={view} type="button" role="tab" aria-selected={value === view} tabIndex={value === view ? 0 : -1} className={value === view ? 'is-active' : undefined} onClick={() => onChange(view)}>
          {t.leads.views[view]}
        </button>
      ))}
    </div>
  )
}

export function LeadsPage({ id, compact, notify, onImported }: {
  id: string | null
  compact: boolean
  notify: (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void
  onImported: () => void
}) {
  const t = useCopy()
  const c = t.leads.columns
  const [view, setView] = useState<View>(() => (sessionStorage.getItem(VIEW_KEY) === 'saved' ? 'saved' : 'muster'))
  const [items, setItems] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null })
  const [uploadOpen, setUploadOpen] = useState(false)
  const [stationId, setStationId] = useState(String(MUSTER_STATIONS[0].id))
  const [status, setStatus] = useState<StationStatus>('open')
  const [dates, setDates] = useState<{ from: string | null; to: string | null }>(() => {
    const today = isoDay(new Date())
    const end = new Date()
    end.setDate(end.getDate() + 6)
    return { from: today, to: isoDay(end) }
  })
  const [applied, setApplied] = useState(dates)
  const [saving, setSaving] = useState(false)
  const ids = { station: useId(), status: useId(), dates: useId() }

  useEffect(() => { sessionStorage.setItem(VIEW_KEY, view) }, [view])

  const load = () => {
    let live = true
    void Promise.all([fixtureLeads.list(), listLeads().catch(() => [] as UploadedLead[])]).then(([sample, uploaded]) => {
      if (!live) return
      setItems([...uploaded.map(fromUpload), ...sample])
      setLoading(false)
    })
    return () => { live = false }
  }
  useEffect(load, [])

  const station = Number(stationId)
  const muster = useMusterLeads(station, applied.from, applied.to, view === 'muster')
  const savedPlates = useMemo(() => new Set(items.filter((lead) => !lead.sample).map((lead) => lead.plateNumber.toUpperCase())), [items])
  const musterRows = useMemo(() => muster.rows.filter((row) => status === 'all' || (status === 'closed') === row.isClosed), [muster.rows, status])
  const musterLeads = useMemo(() => musterRows.map((row) => fromMuster(row, station)), [musterRows, station])
  const unsaved = musterRows.filter((row) => !savedPlates.has(row.PlateNumber.toUpperCase()))

  const hasUploads = items.some((lead) => !lead.sample)
  const savedRows = useMemo(() => filterLeads(items, range), [items, range])
  const rows = view === 'muster' ? musterLeads : savedRows
  const pool = [...musterLeads, ...items]
  const selected = id ? pool.find((lead) => lead.id === id) ?? null : null
  const [shown, setShown] = useState<Lead | null>(selected)
  useEffect(() => { if (selected) setShown(selected) }, [selected])
  const close = () => go({ page: 'leads', id: null })

  const exportCsv = () => {
    downloadCsv('k1-leads.csv', toCsv(rows.map((lead) => ({
      StationName: lead.stationName,
      isClosed: lead.isClosed ? '1' : '0',
      PlateNumber: lead.plateNumber,
      Product: lead.product,
      NextInspectionDateRangeEnd: lead.nextInspection ?? '',
      PhoneNumber: lead.phoneNumber,
      Language: lead.language,
      LastInspection: lead.lastInspection ?? '',
      Reason: lead.reason,
    }))))
    notify({ title: t.common.exportReady, body: t.leads.exportBody(rows.length) })
  }

  const save = async () => {
    if (!unsaved.length) return
    setSaving(true)
    try {
      const { inserted, updated } = await importLeads(unsaved)
      notify({ title: t.upload.imported(inserted + updated), body: updated ? t.upload.importedUpdated(inserted, updated) : t.upload.importedBody })
      load()
      onImported()
    } catch (error) {
      const blocked = error instanceof AccessError ? (error.reason === 'team_required' ? t.muster.teamOnly : t.muster.signinAgain) : null
      notify({ tone: 'error', title: t.upload.importFailed, body: blocked ?? t.upload.importFailedBody(describeError(error)) })
    } finally {
      setSaving(false)
    }
  }

  const tags = (lead: Lead) => (
    <>
      {lead.sample && hasUploads && <span className="k1-tag k1-table__tag">{t.common.sample}</span>}
      {lead.live && savedPlates.has(lead.plateNumber.toUpperCase()) && <span className="k1-tag k1-table__tag">{t.leads.savedTag}</span>}
    </>
  )

  const blockedMessage = muster.blocked === 'team_required' ? t.muster.teamOnly : muster.blocked ? t.muster.signinAgain : null
  const empty = view === 'muster' ? (
    <div className="k1-table__empty">
      <strong>{blockedMessage ?? (!applied.from || !applied.to ? t.leads.pickDates : t.muster.noneFound)}</strong>
    </div>
  ) : (
    <div className="k1-table__empty">
      <strong>{items.length ? t.leads.noneInRange : t.leads.none}</strong>
      {items.length > 0 && <button type="button" className="k1-link" onClick={() => setRange({ from: null, to: null })}>{t.leads.clearDateFilter}</button>}
    </div>
  )
  const busy = view === 'muster' && muster.loading && !musterRows.length
  const percent = muster.progress.total ? Math.round((muster.progress.done / muster.progress.total) * 100) : 0

  return (
    <div className="k1-page">
      <header className="k1-page__head">
        <h1 className="k1-page-title">{t.leads.title}</h1>
        {view === 'saved' && !hasUploads && <SampleBadge />}
        <ViewSwitch value={view} onChange={(next) => { setView(next); if (id) close() }} />
      </header>

      <div className="k1-page__filters">
        <span className="k1-label">{t.leads.filters}</span>
        <div className="k1-page__toolbar">
          {view === 'muster' ? (
            <div className="k1-leads__filters">
              <div className="k1-leads__filter k1-leads__filter--station">
                <Select
                  id={ids.station}
                  label={t.muster.station}
                  value={stationId}
                  placeholder={t.muster.chooseStation}
                  options={MUSTER_STATIONS.map((item) => ({ value: String(item.id), label: shortStation(item.name) }))}
                  onChange={setStationId}
                />
              </div>
              <div className="k1-leads__filter k1-leads__filter--status">
                <Select<StationStatus>
                  id={ids.status}
                  label={t.muster.status}
                  value={status}
                  placeholder={t.muster.status}
                  options={(['open', 'closed', 'all'] as const).map((value) => ({ value, label: t.leads.statusOption[value] }))}
                  onChange={setStatus}
                />
              </div>
              <div className="k1-page__range">
                <DateRangeField
                  id={ids.dates}
                  future
                  maxDays={MUSTER_MAX_DAYS}
                  from={dates.from}
                  to={dates.to}
                  ariaLabel={t.muster.dueLabel}
                  leading={<CalendarDays size={15} strokeWidth={1.75} className="k1-select__lead" />}
                  onChange={(next) => {
                    setDates(next)
                    if (next.from && next.to) setApplied(next)
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="k1-page__range">
              <DateRangeField
                from={range.from}
                to={range.to}
                ariaLabel={t.leads.filterLabel}
                leading={<CalendarDays size={15} strokeWidth={1.75} className="k1-select__lead" />}
                onChange={setRange}
              />
              {range.from && (
                <button type="button" className="k1-link k1-link--danger" onClick={() => setRange({ from: null, to: null })}>{t.common.clear}</button>
              )}
            </div>
          )}
          <div className="k1-page__actions">
            {view === 'muster' ? (
              <button type="button" className="k1-btn k1-btn--outline" onClick={() => void save()} disabled={!unsaved.length || saving || muster.loading} aria-busy={saving}>
                {saving && <Spinner />}{!musterRows.length ? t.leads.saveNone : !unsaved.length ? t.leads.allSaved : t.leads.save(unsaved.length)}
              </button>
            ) : (
              <button type="button" className="k1-btn k1-btn--outline k1-btn--icon-end" aria-haspopup="dialog" onClick={() => setUploadOpen(true)}>
                {t.leads.uploadCsv}<Upload size={15} strokeWidth={1.75} />
              </button>
            )}
            <button type="button" className="k1-btn k1-btn--primary k1-btn--icon-end" onClick={exportCsv} disabled={!rows.length}>
              {t.common.export}<Download size={15} strokeWidth={1.75} />
            </button>
          </div>
        </div>
        {view === 'muster' && (
          <div className="k1-leads__status" role="status" aria-live="polite">
            {muster.loading ? (
              <div className="k1-fetch">
                <div className="k1-fetch__bar" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>
                <p className="k1-hint">{t.muster.fetching(formatDate(muster.progress.day, 'fi'), Math.min(muster.progress.done + 1, muster.progress.total), muster.progress.total)}</p>
              </div>
            ) : muster.problem ? (
              <p className="k1-hint k1-hint--warn">
                {t.leads.stopped(muster.problem)}{' '}
                <button type="button" className="k1-link" onClick={muster.retry}>{t.common.tryAgain}</button>
              </p>
            ) : muster.failed.length ? (
              <p className="k1-hint k1-hint--warn">
                {t.leads.failedDays(muster.failed.length, muster.failed.map((value) => formatDate(value, 'fi')).join(', '))}{' '}
                <button type="button" className="k1-link" onClick={muster.retry}>{t.common.tryAgain}</button>
              </p>
            ) : applied.from && applied.to && !blockedMessage ? (
              <p className="k1-hint">{t.leads.liveSummary(musterRows.length, musterRows.filter((row) => row.isClosed).length)}</p>
            ) : null}
          </div>
        )}
      </div>

      <div className="k1-table-card">
        {(view === 'saved' && loading) || busy ? (
          <div className="k1-table__skeleton" role="status" aria-label={t.leads.loading}>
            {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} height={48} />)}
          </div>
        ) : compact ? (
          rows.length ? (
            <ul className="k1-lead-cards">
              {rows.map((lead) => (
                <li key={lead.id}>
                  <a className={`k1-lead-card${lead.isClosed ? ' is-closed' : ''}`} href={href({ page: 'leads', id: lead.id })}>
                    <span className="k1-lead-card__top"><strong>{lead.plateNumber}{tags(lead)}</strong><time>{day(lead.nextInspection)}</time></span>
                    <span className="k1-lead-card__station">{shortStation(lead.stationName) || t.leads.noStation}{lead.isClosed && <ClosedTag />}</span>
                    <span>{[lead.phoneNumber, lead.language].filter(Boolean).join(' · ')}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : empty
        ) : (
          <table className="k1-table">
            <thead>
              <tr>
                <th scope="col">{c.plate}</th>
                <th scope="col">{c.station}</th>
                <th scope="col">{c.next}</th>
                <th scope="col">{c.last}</th>
                <th scope="col">{c.language}</th>
                <th scope="col">{c.phone}</th>
                <th scope="col">{c.reason}</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {rows.map((lead) => (
                  <motion.tr
                    key={lead.id}
                    className={[lead.id === id && 'is-selected', lead.isClosed && 'is-closed'].filter(Boolean).join(' ') || undefined}
                    onClick={() => go({ page: 'leads', id: lead.id })}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16, ease }}
                  >
                    <th scope="row"><a href={href({ page: 'leads', id: lead.id })} onClick={(event) => event.stopPropagation()}>{lead.plateNumber}</a>{tags(lead)}</th>
                    <td><span className="k1-table__station">{shortStation(lead.stationName) || '—'}{lead.isClosed && <ClosedTag />}</span></td>
                    <td className="k1-table__num">{day(lead.nextInspection)}</td>
                    <td className="k1-table__num">{day(lead.lastInspection)}</td>
                    <td>{lead.language || '—'}</td>
                    <td className="k1-table__num">{lead.phoneNumber || '—'}</td>
                    <td>{lead.reason || '—'}</td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        )}
        {!busy && !(view === 'saved' && loading) && !compact && !rows.length && empty}
      </div>

      <LeadUploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} notify={notify} onImported={() => { load(); onImported() }} />
      <Drawer open={Boolean(selected)} side="right" label={selected ? t.leads.lead(selected.plateNumber) : t.leads.leadFallback} onClose={close}>
        {shown && <LeadDetail lead={selected ?? shown} onClose={close} />}
      </Drawer>
      {id && !loading && !busy && !selected && (
        <p className="k1-hint k1-page__missing" role="status">{t.leads.notFound} <button type="button" className="k1-link" onClick={close}>{t.leads.backToAll}</button></p>
      )}
    </div>
  )
}
