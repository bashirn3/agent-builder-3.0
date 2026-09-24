import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Download, Info, MessagesSquare, X } from '../ui/icons'
import { ease } from '../../lib/motion'
import { downloadCsv, filterLeads, fixtureLeads, submittedStamp, toCsv, type Lead } from '../data/fixtures'
import { go, href } from '../routes'
import { Skeleton } from '../ui/controls'
import { DateRangeField } from '../ui/DateRange'
import { Drawer } from '../ui/overlay'
import { Facts, SampleBadge, Thread } from './SplitView'

function LeadDetail({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const conversations = fixtureLeads.conversationsFor(lead)
  return (
    <div className="k1-lead">
      <header className="k1-lead__head">
        <div>
          <h2>{lead.name}</h2>
          <p>{lead.registration} · {lead.vehicle}</p>
        </div>
        <button type="button" className="k1-icon-btn k1-icon-btn--boxed" aria-label="Close lead" onClick={onClose}>
          <X size={16} strokeWidth={1.75} />
        </button>
      </header>
      <div className="k1-lead__body">
        <Facts
          heading="General details"
          rows={[
            ['Status', <span className={`k1-status k1-status--${lead.status.toLowerCase().replace(/\s+/g, '-')}`}>{lead.status}</span>],
            ['Email', lead.email],
            ['Phone', lead.phone],
            ['Station', lead.station],
            ['Preferred time', lead.preferredTime],
            ['Submitted at', submittedStamp(lead.submittedAt)],
          ]}
        />
        {lead.note && (
          <section className="k1-lead__section">
            <h3 className="k1-facts__heading"><Info size={14} strokeWidth={1.75} />Note</h3>
            <p className="k1-lead__note">{lead.note}</p>
          </section>
        )}
        <section className="k1-lead__section">
          <h3 className="k1-facts__heading"><MessagesSquare size={14} strokeWidth={1.75} />Conversation</h3>
          {conversations.length ? conversations.map((conversation) => (
            <div key={conversation.id} className="k1-lead-thread">
              <p className="k1-hint">{conversation.channel}</p>
              <Thread messages={conversation.messages} />
            </div>
          )) : <p className="k1-hint">No conversation is linked to this lead.</p>}
        </section>
      </div>
    </div>
  )
}

export function LeadsPage({ id, compact, notify }: {
  id: string | null
  compact: boolean
  notify: (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void
}) {
  const [items, setItems] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null })

  useEffect(() => {
    let live = true
    void fixtureLeads.list().then((list) => {
      if (!live) return
      setItems(list)
      setLoading(false)
    })
    return () => { live = false }
  }, [])

  const rows = useMemo(() => filterLeads(items, range), [items, range])
  const selected = id ? fixtureLeads.get(id) : null
  const [shown, setShown] = useState<Lead | null>(selected)
  useEffect(() => { if (selected) setShown(selected) }, [selected])
  const close = () => go({ page: 'leads', id: null })

  const exportCsv = () => {
    downloadCsv('k1-leads-sample.csv', toCsv(rows.map((lead) => ({
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      registration: lead.registration,
      submitted_at: submittedStamp(lead.submittedAt),
    }))))
    notify({ title: 'Export ready', body: `${rows.length} sample lead${rows.length === 1 ? '' : 's'} downloaded as CSV.` })
  }

  const empty = (
    <div className="k1-table__empty">
      <strong>{items.length ? 'No leads in this date range' : 'No leads yet'}</strong>
      {items.length > 0 && <button type="button" className="k1-link" onClick={() => setRange({ from: null, to: null })}>Clear the date filter</button>}
    </div>
  )

  return (
    <div className="k1-page">
      <header className="k1-page__head">
        <h1 className="k1-page-title">Leads</h1>
        <SampleBadge />
      </header>

      <div className="k1-page__filters">
        <span className="k1-label">Filters</span>
        <div className="k1-page__toolbar">
          <div className="k1-page__range">
            <DateRangeField
              from={range.from}
              to={range.to}
              ariaLabel="Filter leads by submitted date"
              leading={<CalendarDays size={15} strokeWidth={1.75} className="k1-select__lead" />}
              onChange={setRange}
            />
            {range.from && (
              <button type="button" className="k1-link k1-link--danger" onClick={() => setRange({ from: null, to: null })}>Clear</button>
            )}
          </div>
          <button type="button" className="k1-btn k1-btn--primary k1-btn--icon-end" onClick={exportCsv} disabled={!rows.length}>
            Export<Download size={15} strokeWidth={1.75} />
          </button>
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
                  <a className="k1-lead-card" href={href({ page: 'leads', id: lead.id })}>
                    <span className="k1-lead-card__top"><strong>{lead.name}</strong><time>{submittedStamp(lead.submittedAt)}</time></span>
                    <span>{lead.email}</span>
                    <span>{lead.phone} · {lead.registration}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : empty
        ) : (
          <table className="k1-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Phone</th>
                <th scope="col">Registration</th>
                <th scope="col">Submitted at</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {rows.map((lead) => (
                  <motion.tr
                    key={lead.id}
                    className={lead.id === id ? 'is-selected' : undefined}
                    onClick={() => go({ page: 'leads', id: lead.id })}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16, ease }}
                  >
                    <th scope="row"><a href={href({ page: 'leads', id: lead.id })} onClick={(event) => event.stopPropagation()}>{lead.name}</a></th>
                    <td>{lead.email}</td>
                    <td>{lead.phone}</td>
                    <td>{lead.registration}</td>
                    <td className="k1-table__num">{submittedStamp(lead.submittedAt)}</td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        )}
        {!loading && !compact && !rows.length && empty}
      </div>

      <Drawer open={Boolean(selected)} side="right" label={selected ? `Lead: ${selected.name}` : 'Lead'} onClose={close}>
        {shown && <LeadDetail lead={selected ?? shown} onClose={close} />}
      </Drawer>
      {id && !loading && !selected && (
        <p className="k1-hint k1-page__missing" role="status">This lead was not found. <button type="button" className="k1-link" onClick={close}>Back to all leads</button></p>
      )}
    </div>
  )
}
