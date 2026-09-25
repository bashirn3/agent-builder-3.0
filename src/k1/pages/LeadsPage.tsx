import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Download, Info, MessagesSquare, Upload, X } from '../ui/icons'
import { MusterFetchDialog } from './MusterFetch'
import { useCopy } from '../i18n'
import { ease } from '../../lib/motion'
import { downloadCsv, filterLeads, fixtureLeads, shortStation, submittedStamp, toCsv, type Lead } from '../data/fixtures'
import { formatDate } from '../data/language'
import { go, href } from '../routes'
import { Skeleton } from '../ui/controls'
import { listLeads, type UploadedLead } from '../data/builderApi'
import { LeadUploadDialog } from './LeadUpload'
import { DateRangeField } from '../ui/DateRange'
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
            [lead.sample ? c.added : c.uploaded, submittedStamp(lead.addedAt)],
          ]}
        />
        {lead.sample && (
          <section className="k1-lead__section">
            <h3 className="k1-facts__heading"><MessagesSquare size={14} strokeWidth={1.75} />{t.leads.conversation}</h3>
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

export function LeadsPage({ id, compact, notify, onImported }: {
  id: string | null
  compact: boolean
  notify: (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void
  onImported: () => void
}) {
  const t = useCopy()
  const c = t.leads.columns
  const [items, setItems] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null })
  const [uploadOpen, setUploadOpen] = useState(false)
  const [musterOpen, setMusterOpen] = useState(false)

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

  const hasUploads = items.some((lead) => !lead.sample)
  const rows = useMemo(() => filterLeads(items, range), [items, range])
  const selected = id ? items.find((lead) => lead.id === id) ?? null : null
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

  const sampleTag = (lead: Lead) => lead.sample && hasUploads ? <span className="k1-tag k1-table__tag">{t.common.sample}</span> : null

  const empty = (
    <div className="k1-table__empty">
      <strong>{items.length ? t.leads.noneInRange : t.leads.none}</strong>
      {items.length > 0 && <button type="button" className="k1-link" onClick={() => setRange({ from: null, to: null })}>{t.leads.clearDateFilter}</button>}
    </div>
  )

  return (
    <div className="k1-page">
      <header className="k1-page__head">
        <h1 className="k1-page-title">{t.leads.title}</h1>
        {!hasUploads && <SampleBadge />}
      </header>

      <div className="k1-page__filters">
        <span className="k1-label">{t.leads.filters}</span>
        <div className="k1-page__toolbar">
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
          <div className="k1-page__actions">
            <button type="button" className="k1-btn k1-btn--outline" aria-haspopup="dialog" onClick={() => setMusterOpen(true)}>
              {t.leads.fetchMuster}
            </button>
            <button type="button" className="k1-btn k1-btn--outline k1-btn--icon-end" aria-haspopup="dialog" onClick={() => setUploadOpen(true)}>
              {t.leads.uploadCsv}<Upload size={15} strokeWidth={1.75} />
            </button>
            <button type="button" className="k1-btn k1-btn--primary k1-btn--icon-end" onClick={exportCsv} disabled={!rows.length}>
              {t.common.export}<Download size={15} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>

      <div className="k1-table-card">
        {loading ? (
          <div className="k1-table__skeleton" role="status" aria-label={t.leads.loading}>
            {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} height={48} />)}
          </div>
        ) : compact ? (
          rows.length ? (
            <ul className="k1-lead-cards">
              {rows.map((lead) => (
                <li key={lead.id}>
                  <a className={`k1-lead-card${lead.isClosed ? ' is-closed' : ''}`} href={href({ page: 'leads', id: lead.id })}>
                    <span className="k1-lead-card__top"><strong>{lead.plateNumber}{sampleTag(lead)}</strong><time>{day(lead.nextInspection)}</time></span>
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
                    <th scope="row"><a href={href({ page: 'leads', id: lead.id })} onClick={(event) => event.stopPropagation()}>{lead.plateNumber}</a>{sampleTag(lead)}</th>
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
        {!loading && !compact && !rows.length && empty}
      </div>

      <MusterFetchDialog open={musterOpen} onClose={() => setMusterOpen(false)} notify={notify} onImported={() => { load(); onImported() }} />
      <LeadUploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} notify={notify} onImported={() => { load(); onImported() }} />
      <Drawer open={Boolean(selected)} side="right" label={selected ? t.leads.lead(selected.plateNumber) : t.leads.leadFallback} onClose={close}>
        {shown && <LeadDetail lead={selected ?? shown} onClose={close} />}
      </Drawer>
      {id && !loading && !selected && (
        <p className="k1-hint k1-page__missing" role="status">{t.leads.notFound} <button type="button" className="k1-link" onClick={close}>{t.leads.backToAll}</button></p>
      )}
    </div>
  )
}
