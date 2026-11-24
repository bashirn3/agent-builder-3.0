import { useState } from 'react'
import { isSample, prodApi, type ConversationDetail, type ConversationFilter } from '../../data/prodApi'
import { useCopy } from '../../i18n'
import { go, hashQuery, href } from '../../routes'
import { Spinner } from '../../ui/controls'
import { Link2, Search } from '../../ui/icons'
import { ThreadSkeleton } from '../../ui/skeletons'
import { DetailPane, Facts, ListSkeleton, MobileSwap, relativeTime, SampleBadge, Tabs } from '../SplitView'
import { whatsappRuns } from '../../data/stagingView'
import { DeliveryTag, EmptyState, PreviewNote, ErrorState, fmtClock, fmtDay, fmtTime, RefreshButton, StatusTag, stepLabel, useDebounced, useProdData } from './shared'

const FILTERS: ConversationFilter[] = ['all', 'needs_reply', 'no_answer', 'booked', 'stopped']
const PAGE = 50

const readFilter = (): ConversationFilter => {
  const value = hashQuery().get('filter')
  return FILTERS.includes(value as ConversationFilter) ? value as ConversationFilter : 'all'
}

export function ConversationsPage({ id, compact, notify }: {
  id: string | null
  compact: boolean
  notify: (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void
}) {
  const t = useCopy()
  const p = t.prod.conversations
  const [filter, setFilter] = useState<ConversationFilter>(readFilter)
  const [query, setQuery] = useState('')
  const search = useDebounced(query.trim())
  const [limit, setLimit] = useState(PAGE)
  const [tab, setTab] = useState<'chat' | 'details'>('chat')

  const list = useProdData((signal) => prodApi.conversations({ filter, search, limit }, signal), [filter, search, limit], true)
  const detail = useProdData((signal) => id ? prodApi.conversation(id, signal) : Promise.resolve(null), [id], true)

  const pickFilter = (next: ConversationFilter) => {
    setFilter(next)
    setLimit(PAGE)
  }

  const items = list.data?.items ?? []
  const listPane = (
    <section className="k1-list" aria-label={p.title}>
      <header className="k1-list__head">
        <h1 className="k1-page-title">{p.title}</h1>
        {isSample('conversations') && <SampleBadge />}
        <div className="k1-list__actions"><RefreshButton onClick={list.reload} busy={list.refreshing} /></div>
      </header>
      {isSample('conversations') && <div className="k1-prod-list-note"><PreviewNote /></div>}
      <label className="k1-list-search k1-prod-search">
        {list.refreshing ? <Spinner size={14} /> : <Search size={14} />}
        <input className="k1-input" value={query} placeholder={p.search} aria-label={p.search} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE) }} />
      </label>
      <div className="k1-prod-filters">
        <Tabs
          idBase="k1-live-filter"
          label={p.filterLabel}
          value={filter}
          onChange={pickFilter}
          tabs={FILTERS.map((value) => ({ value, label: list.data ? `${p.filters[value]} ${list.data.counts[value]}` : p.filters[value] }))}
        />
      </div>
      {list.loading ? <ListSkeleton /> : list.error && !list.data ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : items.length ? (
        <ul className="k1-list__items k1-prod-list">
          {items.map((item) => (
            <li key={item.id}>
              <a href={href({ page: 'liveChats', id: item.id })} className={`k1-card${item.id === id ? ' is-selected' : ''}`} aria-current={item.id === id ? 'true' : undefined} onClick={() => setTab('chat')}>
                <span className="k1-card__row">
                  <strong>{item.name}</strong>
                  <time dateTime={item.last_message_at} title={fmtTime(item.last_message_at)}>{relativeTime(item.last_message_at)}</time>
                </span>
                <span className="k1-card__sub">{[item.plate, item.station].filter(Boolean).join(' · ')}</span>
                <span className="k1-card__tags">
                  <StatusTag status={item.status} />
                  <span className="k1-vtag is-muted">{item.language.toUpperCase()}</span>
                  {item.waiting_since && <span className="k1-hint">{p.waiting(relativeTime(item.waiting_since))}</span>}
                  {!item.waiting_since && item.last_from === 'customer' && <span className="k1-hint">{p.customerLast}</span>}
                </span>
              </a>
            </li>
          ))}
          {list.data?.next_cursor && (
            <li className="k1-prod-more">
              <button type="button" className="k1-btn k1-btn--outline k1-btn--sm" onClick={() => setLimit((value) => value + PAGE)} disabled={list.refreshing}>{t.prod.loadMore}</button>
            </li>
          )}
        </ul>
      ) : (
        <EmptyState title={search || filter !== 'all' ? p.noMatch : p.none} body={search || filter !== 'all' ? undefined : p.noneBody} />
      )}
    </section>
  )

  const shown = detail.data && detail.data.conversation.id === id ? detail.data : null
  const detailPane = !id ? (
    <div className="k1-detail k1-detail--empty"><p>{p.select}</p></div>
  ) : detail.error && !shown ? (
    <div className="k1-detail k1-detail--empty"><ErrorState error={detail.error} onRetry={detail.reload} /></div>
  ) : !shown ? (
    <ThreadSkeleton label={p.loadingChat} />
  ) : (
    <DetailPane
      paneKey={shown.conversation.id}
      title={shown.customer.name}
      tabs={[{ value: 'chat', label: p.chat }, { value: 'details', label: p.details }]}
      tab={tab}
      onTab={setTab}
      backLabel={p.title}
      onBack={compact ? () => go({ page: 'liveChats', id: null }) : undefined}
      menu={[{
        label: t.common.copyLink,
        icon: <Link2 size={14} strokeWidth={1.75} />,
        onSelect: () => {
          void navigator.clipboard?.writeText(window.location.href)
            .then(() => notify({ title: t.common.linkCopied, body: p.linkCopied }))
            .catch(() => notify({ tone: 'error', title: t.common.copyFailed, body: t.common.clipboardBlocked }))
        },
      }]}
    >
      {tab === 'chat' ? <Chat detail={shown} /> : <Details detail={shown} />}
    </DetailPane>
  )

  return compact
    ? <div className="k1-split k1-split--compact"><MobileSwap showDetail={Boolean(id)} list={listPane} detail={detailPane} /></div>
    : <div className="k1-split">{listPane}{detailPane}</div>
}

function Chat({ detail }: { detail: ConversationDetail }) {
  const t = useCopy()
  const p = t.prod.conversations
  return (
    <div className="k1-thread k1-prod-thread">
      <p className="k1-thread__version">
        <StatusTag status={detail.conversation.status} />
        <span>{detail.customer.plate} · {detail.customer.station}</span>
        <span>{t.prod.zone}</span>
      </p>
      {detail.messages.length === 0 && <p className="k1-hint">{p.noMessages}</p>}
      {detail.messages.map((message, index) => (
        <div key={`${message.at}-${index}`} className={message.from === 'customer' ? 'k1-msg k1-msg--user' : 'k1-msg'}>
          {(message.step || message.kind === 'reminder') && <span className="k1-prod-thread__kind">{message.step ? stepLabel(message.step) : p.reminderSent}</span>}
          <p className="k1-msg__bubble">{whatsappRuns(message.text).map((run, runIndex) => run.bold ? <strong key={runIndex}>{run.value}</strong> : run.value)}</p>
          {message.buttons?.length ? (
            <div className="k1-msg__chips">
              {message.buttons.map((label) => <span key={label} className="k1-msg__box">{label}</span>)}
            </div>
          ) : null}
          <time className="k1-prod-thread__time" dateTime={message.at}>{fmtClock(message.at)} · {fmtDay(message.at.slice(0, 10))}</time>
        </div>
      ))}
    </div>
  )
}

function Details({ detail }: { detail: ConversationDetail }) {
  const t = useCopy()
  const p = t.prod.conversations
  const { customer, conversation } = detail
  return (
    <div className="k1-prod-details">
      <Facts heading={p.customer} rows={[
        [p.name, customer.name],
        [p.phone, customer.phone],
        [p.plate, customer.plate],
        [p.station, customer.station],
        [t.common.language, customer.language.toUpperCase()],
        [p.deadline, fmtDay(customer.deadline, true)],
      ]} />
      <Facts heading={p.conversation} rows={[
        [p.status, <StatusTag status={conversation.status} />],
        [p.outcome, conversation.outcome ? t.prod.outcomes[conversation.outcome as keyof typeof t.prod.outcomes] ?? conversation.outcome : '—'],
        [p.reason, conversation.reason ?? '—'],
        [p.botBuild, <code>{conversation.bot_build}</code>],
      ]} />
      <Facts heading={p.reminders} rows={detail.reminders.length
        ? detail.reminders.map((reminder) => [stepLabel(reminder.step), <span className="k1-prod-inline">{fmtTime(reminder.sent_at)} <DeliveryTag delivery={reminder.delivery} /></span>])
        : [[p.reminders, '—']]} />
      {detail.bookings.length ? detail.bookings.map((booking) => (
        <Facts key={booking.booking_number} heading={p.booking(booking.booking_number)} rows={[
          [p.station, booking.station],
          [p.time, fmtTime(booking.time)],
          [p.price, `${booking.price_eur} €${booking.green ? ` · ${p.green}` : ''}`],
          [p.status, t.prod.bookingStatus[booking.status as keyof typeof t.prod.bookingStatus] ?? booking.status],
        ]} />
      )) : <Facts heading={p.bookings} rows={[[p.bookings, p.noBooking]]} />}
    </div>
  )
}
