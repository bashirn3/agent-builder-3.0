import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Download, Info, MessagesSquare, Upload, X } from '../ui/icons'
import { ease } from '../../lib/motion'
import { downloadCsv, filterLeads, fixtureLeads, shortStation, submittedStamp, toCsv, type Lead } from '../data/fixtures'
import { formatDate } from '../data/language'
import { go, href } from '../routes'
import { Skeleton, Spinner } from '../ui/controls'
import { listLeads, requestMuster, type UploadedLead } from '../data/builderApi'
import { describeError } from '../data/agentConfig'
import { LeadUploadDialog } from './LeadUpload'
import { DateRangeField } from '../ui/DateRange'
import { Drawer } from '../ui/overlay'
import { Facts, SampleBadge, Thread } from './SplitView'

const MUSTER_KEY = 'k1-muster-requested'

const day = (iso: string | null) => formatDate(iso, 'fi') || '—'

const PRODUCTS: Record<string, string> = { D04: 'Inspection' }

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
  return <span className="k1-tag k1-tag--danger" title="Station closed. Do not contact this lead.">Station closed</span>
}

function LeadDetail({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const conversations = lead.sample ? fixtureLeads.conversationsFor(lead) : []
  return (
    <div className="k1-lead">
      <header className="k1-lead__head">
        <div>
          <h2>{lead.plateNumber}</h2>
          <p>{lead.stationName || 'No station'}</p>
        </div>
        <button type="button" className="k1-icon-btn k1-icon-btn--boxed" aria-label="Close lead" onClick={onClose}>
          <X size={16} strokeWidth={1.75} />
        </button>
      </header>
      <div className="k1-lead__body">
        {lead.isClosed && <p className="k1-lead__closed" role="note">This station is closed. Do not contact this lead.</p>}
        <Facts
          heading="Lead details"
          rows={[
            ['Station', <span className="k1-lead__station">{lead.stationName || '—'}{lead.isClosed && <ClosedTag />}</span>],
            ['Phone', lead.phoneNumber || '—'],
            ['Language', lead.language || '—'],
            ['Next inspection by', day(lead.nextInspection)],
            ['Last inspection', day(lead.lastInspection)],
            ['Product', lead.product ? `${lead.product}${PRODUCTS[lead.product] ? ` · ${PRODUCTS[lead.product]}` : ''}` : '—'],
            ['Reason', lead.reason || '—'],
            [lead.sample ? 'Added' : 'Uploaded', submittedStamp(lead.addedAt)],
          ]}
        />
        {lead.sample && (
          <section className="k1-lead__section">
            <h3 className="k1-facts__heading"><MessagesSquare size={14} strokeWidth={1.75} />Conversation</h3>
            {conversations.length ? conversations.map((conversation) => (
              <div key={conversation.id} className="k1-lead-thread">
                <p className="k1-hint">{conversation.channel}</p>
                <Thread messages={conversation.messages} />
              </div>
            )) : <p className="k1-hint">No conversation is linked to this lead.</p>}
          </section>
        )}
        {!lead.sample && (
          <section className="k1-lead__section">
            <h3 className="k1-facts__heading"><Info size={14} strokeWidth={1.75} />Conversation</h3>
            <p className="k1-hint">No conversation yet.</p>
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
  const [items, setItems] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null })
  const [uploadOpen, setUploadOpen] = useState(false)
  const [muster, setMuster] = useState<'idle' | 'sending' | 'sent'>(() => (sessionStorage.getItem(MUSTER_KEY) ? 'sent' : 'idle'))

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

  const askMuster = async () => {
    setMuster('sending')
    try {
      await requestMuster(null)
      sessionStorage.setItem(MUSTER_KEY, '1')
      setMuster('sent')
      notify({ title: 'Muster API requested', body: 'Wasup has been emailed and will be in touch about connecting it.' })
    } catch (error) {
      setMuster('idle')
      notify({ tone: 'error', title: 'Request not sent', body: `Nothing was sent (${describeError(error)}). Try again.` })
    }
  }

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
    notify({ title: 'Export ready', body: `${rows.length} lead${rows.length === 1 ? '' : 's'} downloaded as CSV.` })
  }

  const sampleTag = (lead: Lead) => lead.sample && hasUploads ? <span className="k1-tag k1-table__tag">Sample</span> : null

  const empty = (
    <div className="k1-table__empty">
      <strong>{items.length ? 'No leads due in this date range' : 'No leads yet'}</strong>
      {items.length > 0 && <button type="button" className="k1-link" onClick={() => setRange({ from: null, to: null })}>Clear the date filter</button>}
    </div>
  )

  return (
    <div className="k1-page">
      <header className="k1-page__head">
        <h1 className="k1-page-title">Leads</h1>
        {!hasUploads && <SampleBadge />}
      </header>

      <div className="k1-page__filters">
        <span className="k1-label">Filters</span>
        <div className="k1-page__toolbar">
          <div className="k1-page__range">
            <DateRangeField
              from={range.from}
              to={range.to}
              ariaLabel="Filter leads by next inspection date"
              leading={<CalendarDays size={15} strokeWidth={1.75} className="k1-select__lead" />}
              onChange={setRange}
            />
            {range.from && (
              <button type="button" className="k1-link k1-link--danger" onClick={() => setRange({ from: null, to: null })}>Clear</button>
            )}
          </div>
          <div className="k1-page__actions">
            <button type="button" className="k1-btn k1-btn--outline" onClick={() => void askMuster()} disabled={muster !== 'idle'} aria-busy={muster === 'sending'}>
              {muster === 'sending' && <Spinner />}{muster === 'sent' ? 'Muster API requested' : 'Request Muster API'}
            </button>
            <button type="button" className="k1-btn k1-btn--outline k1-btn--icon-end" aria-haspopup="dialog" onClick={() => setUploadOpen(true)}>
              Upload CSV<Upload size={15} strokeWidth={1.75} />
            </button>
            <button type="button" className="k1-btn k1-btn--primary k1-btn--icon-end" onClick={exportCsv} disabled={!rows.length}>
              Export<Download size={15} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>

      <div className="k1-table-card">
        {loading ? (
          <div className="k1-table__skeleton" role="status" aria-label="Loading leads">
            {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} height={48} />)}
          </div>
        ) : compact ? (
          rows.length ? (
            <ul className="k1-lead-cards">
              {rows.map((lead) => (
                <li key={lead.id}>
                  <a className={`k1-lead-card${lead.isClosed ? ' is-closed' : ''}`} href={href({ page: 'leads', id: lead.id })}>
                    <span className="k1-lead-card__top"><strong>{lead.plateNumber}{sampleTag(lead)}</strong><time>{day(lead.nextInspection)}</time></span>
                    <span className="k1-lead-card__station">{shortStation(lead.stationName) || 'No station'}{lead.isClosed && <ClosedTag />}</span>
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
                <th scope="col">Plate number</th>
                <th scope="col">Station</th>
                <th scope="col">Next inspection by</th>
                <th scope="col">Last inspection</th>
                <th scope="col">Language</th>
                <th scope="col">Phone</th>
                <th scope="col">Reason</th>
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

      <LeadUploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} notify={notify} onImported={() => { load(); onImported() }} />
      <Drawer open={Boolean(selected)} side="right" label={selected ? `Lead: ${selected.plateNumber}` : 'Lead'} onClose={close}>
        {shown && <LeadDetail lead={selected ?? shown} onClose={close} />}
      </Drawer>
      {id && !loading && !selected && (
        <p className="k1-hint k1-page__missing" role="status">This lead was not found. <button type="button" className="k1-link" onClick={close}>Back to all leads</button></p>
      )}
    </div>
  )
}
