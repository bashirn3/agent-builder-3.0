import { useState } from 'react'
import { isSample, prodApi, type Bands, type LeadStatus } from '../../data/prodApi'
import { useCopy } from '../../i18n'
import { go, hashQuery, href } from '../../routes'
import { Select, Spinner } from '../../ui/controls'
import { DayRange } from '../../ui/DayRange'
import { CalendarDays, Search, Users } from '../../ui/icons'
import { StatCard } from './charts'
import { CardListSkeleton, TableSkeleton } from '../../ui/skeletons'
import { DeliveryTag, EmptyState, ErrorState, fmtDay, fmtNum, PILOT_STATIONS, ProdHead, StatusTag, stepLabel, useDebounced, useProdData, WhatsAppTag } from './shared'

const STATUSES: LeadStatus[] = ['waiting', 'in_sequence', 'replied', 'booked', 'left_list', 'stopped', 'failed', 'holdout', 'closed']
const BANDS: Array<keyof Bands> = ['0-6', '7-13', '14-20', '21-30']
const PAGE = 50

export function LiveLeadsPage({ compact }: { compact: boolean }) {
  const t = useCopy()
  const p = t.prod.leads
  const [station, setStation] = useState('all')
  const [status, setStatus] = useState<string>(() => {
    const value = hashQuery().get('status')
    return STATUSES.includes(value as LeadStatus) ? value as string : 'all'
  })
  const [query, setQuery] = useState('')
  const [span, setSpan] = useState({ min: 0, max: 30 })
  const [limit, setLimit] = useState(PAGE)
  const search = useDebounced(query.trim())
  const days = useDebounced(span, 250)

  // The full 0–30 range sends no day filter, so leads already past their deadline stay in the list.
  const fullRange = days.min === 0 && days.max === 30
  const { data, error, loading, refreshing, reload } = useProdData((signal) => prodApi.leads({
    station: station === 'all' ? undefined : station,
    status: status === 'all' ? undefined : status,
    min_days: fullRange ? undefined : days.min,
    max_days: fullRange ? undefined : days.max,
    search,
    limit,
  }, signal), [station, status, days.min, days.max, search, limit])

  const reset = () => setLimit(PAGE)
  const filtered = station !== 'all' || status !== 'all' || Boolean(search) || span.min > 0 || span.max < 30
  const items = data?.items ?? []
  const columns = [p.columns.station, p.columns.plate, p.columns.deadline, p.columns.daysLeft, p.columns.language, p.columns.status, p.columns.next, p.columns.last]
  const open = (conversationId: string | null) => { if (conversationId) go({ page: 'liveChats', id: conversationId }) }

  return (
    <div className="k1-page k1-prod">
      <ProdHead title={p.title} description={t.prod.describe.leads} sample={isSample('leads')} onRefresh={reload} refreshing={refreshing} />

      {data && (
        <div className="k1-stat-cards k1-stat-cards--five" aria-label={p.bands}>
          <StatCard icon={<Users size={14} />} label={p.title} value={fmtNum(data.total ?? items.length)} />
          {BANDS.map((band) => <StatCard key={band} icon={<CalendarDays size={14} />} label={t.prod.band(band)} value={fmtNum(data.bands[band])} />)}
        </div>
      )}

      <div className="k1-page__filters">
        <span className="k1-label">{t.leads.filters}</span>
        <div className="k1-prod-toolbar">
          <div className="k1-leads__filter k1-leads__filter--station">
            <Select
              label={p.station}
              value={station}
              placeholder={p.station}
              options={[{ value: 'all', label: p.allStations }, ...PILOT_STATIONS.map((name) => ({ value: name, label: name }))]}
              onChange={(next) => { setStation(next); reset() }}
            />
          </div>
          <div className="k1-leads__filter k1-leads__filter--status">
            <Select
              label={p.status}
              value={status}
              placeholder={p.status}
              options={[{ value: 'all', label: p.allStatuses }, ...STATUSES.map((value) => ({ value, label: t.prod.status[value] }))]}
              onChange={(next) => { setStatus(next); reset() }}
            />
          </div>
          <label className="k1-list-search k1-prod-search k1-prod-search--inline">
            {refreshing ? <Spinner size={14} /> : <Search size={14} />}
            <input className="k1-input" value={query} placeholder={p.search} aria-label={p.search} onChange={(event) => { setQuery(event.target.value); reset() }} />
          </label>
        </div>
        <div className="k1-prod-window">
          <div className="k1-prod-window__head">
            <span className="k1-label">{p.window}</span>
            <span className="k1-prod-window__value">{t.prod.days(span.min, span.max)}</span>
          </div>
          <DayRange min={span.min} max={span.max} onChange={(next) => { setSpan(next); reset() }} label={{ from: t.prod.fromDays, to: t.prod.toDays }} />
          <p className="k1-hint">{p.windowHint}</p>
        </div>
      </div>

      <div className="k1-table-card k1-prod-table">
        {loading ? (
          compact ? <CardListSkeleton label={p.loading} /> : <TableSkeleton label={p.loading} columns={columns} />
        ) : error && !data ? (
          <ErrorState error={error} onRetry={reload} />
        ) : !items.length ? (
          <EmptyState title={filtered ? p.noMatch : p.none} body={filtered ? undefined : p.noneBody} />
        ) : compact ? (
          <ul className="k1-lead-cards">
            {items.map((lead) => (
              <li key={lead.id}>
                <a className="k1-lead-card" href={lead.conversation_id ? href({ page: 'liveChats', id: lead.conversation_id }) : undefined}>
                  <span className="k1-lead-card__top"><strong>{lead.plate}</strong><time>{fmtDay(lead.deadline)}</time></span>
                  <span className="k1-lead-card__station">{lead.station}</span>
                  <span className="k1-prod-inline"><StatusTag status={lead.status} /><WhatsAppTag status={lead.whatsapp} />{p.daysLeft(lead.days_left)}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <table className="k1-table">
            <thead>
              <tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr>
            </thead>
            <tbody>
              {items.map((lead) => (
                <tr key={lead.id} className={lead.conversation_id ? undefined : 'is-static'} onClick={() => open(lead.conversation_id)}>
                  <td>{lead.station}</td>
                  <th scope="row">
                    {lead.conversation_id
                      ? <a href={href({ page: 'liveChats', id: lead.conversation_id })} onClick={(event) => event.stopPropagation()}>{lead.plate}</a>
                      : lead.plate}
                    {lead.holdout && <span className="k1-tag k1-table__tag">{p.holdoutTag}</span>}
                  </th>
                  <td className="k1-table__num">{fmtDay(lead.deadline)}</td>
                  <td className="k1-table__num">{lead.days_left}</td>
                  <td>{lead.language.toUpperCase()}</td>
                  <td><span className="k1-prod-inline"><StatusTag status={lead.status} /><WhatsAppTag status={lead.whatsapp} /></span></td>
                  <td>{lead.next_message ? <span className="k1-prod-inline">{stepLabel(lead.next_message.step)}<span className="k1-hint">{fmtDay(lead.next_message.due_on)}</span></span> : '—'}</td>
                  <td>{lead.last_message ? <span className="k1-prod-inline">{stepLabel(lead.last_message.step)}<DeliveryTag delivery={lead.last_message.delivery} /></span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data?.next_cursor && !loading && (
          <div className="k1-prod-more">
            <button type="button" className="k1-btn k1-btn--outline k1-btn--sm" onClick={() => setLimit((value) => value + PAGE)} disabled={refreshing}>{t.prod.loadMore}</button>
          </div>
        )}
      </div>
    </div>
  )
}
