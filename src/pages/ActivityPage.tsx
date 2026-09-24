import { useEffect, useState } from 'react'
import {
  createFixtureActivityService,
  DEFAULT_FILTERS,
  type ActivityConversation,
  type ActivityFilters,
} from '../lib/activityService'
import { BackIcon, DotsIcon, FilterIcon } from '../ui/icons'
import { Dialog } from '../ui/overlays'

const service = createFixtureActivityService()

export function ActivityPage({
  conversationId,
  filterOpen,
  mobile,
  onOpen,
  onFilter,
}: {
  conversationId: string | null
  filterOpen: boolean
  mobile: boolean
  onOpen: (id: string | null) => void
  onFilter: (open: boolean) => void
}) {
  const [filters, setFilters] = useState<ActivityFilters>(DEFAULT_FILTERS)
  const [draft, setDraft] = useState<ActivityFilters>(DEFAULT_FILTERS)
  const [items, setItems] = useState<ActivityConversation[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'chat' | 'details'>('chat')
  const selected = items.find((item) => item.id === conversationId) ?? null

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void service.listConversations(filters).then((next) => {
      if (cancelled) return
      setItems(next)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [filters])

  useEffect(() => {
    setTab('chat')
  }, [conversationId])

  useEffect(() => {
    if (!mobile && !conversationId && !loading && items[0]) onOpen(items[0].id)
  }, [mobile, conversationId, loading, items, onOpen])

  const applyFilters = () => {
    setFilters(draft)
    onFilter(false)
    if (mobile) onOpen(null)
  }

  const list = (
    <section className="logs-list" aria-label="Chat logs">
      <header className="logs-list-head">
        <h1>Chat logs</h1>
        <button className="icon-button" type="button" onClick={() => { setDraft(filters); onFilter(true) }} aria-label="Filter chat logs">
          <FilterIcon />
        </button>
      </header>
      <p className="visually-hidden">Fixture records. Not live customer conversations.</p>
      {loading ? (
        <div className="list-skeleton" aria-busy="true"><span /><span /><span /></div>
      ) : items.length === 0 ? (
        <p className="empty-copy">No chats match these filters.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={item.id === conversationId ? 'is-active' : ''}
                onClick={() => onOpen(item.id)}
              >
                <strong>{item.title}</strong>
                <em>{item.preview}</em>
                <span>{item.timeLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )

  const detail = selected ? (
    <section className="logs-detail" aria-label="Conversation">
      <header className="logs-detail-head">
        <div className="logs-detail-lead">
          {mobile && (
            <button className="icon-button" type="button" onClick={() => onOpen(null)} aria-label="Back to chat logs">
              <BackIcon />
            </button>
          )}
          <span className="logs-source">{selected.source}</span>
          <div className="logs-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'is-active' : ''} onClick={() => setTab('chat')}>Chat</button>
            <button type="button" role="tab" aria-selected={tab === 'details'} className={tab === 'details' ? 'is-active' : ''} onClick={() => setTab('details')}>Details</button>
          </div>
        </div>
        <span className="icon-button" aria-hidden="true"><DotsIcon /></span>
      </header>
      {tab === 'chat' ? (
        <div className="logs-thread">
          {selected.messages.map((message) => (
            <article key={message.id} className={`log-bubble ${message.role}`}>
              <p>{message.text}</p>
            </article>
          ))}
        </div>
      ) : (
        <dl className="logs-meta">
          <div><dt>Started</dt><dd>{selected.started}</dd></div>
          <div><dt>Source</dt><dd>{selected.source}</dd></div>
          <div><dt>Registration</dt><dd>{selected.registration ?? '—'}</dd></div>
          <div><dt>Station</dt><dd>{selected.station ?? '—'}</dd></div>
          <div>
            <dt>Linked lead</dt>
            <dd>{selected.leadId ? `${selected.leadId} · lead page not in Figma` : 'None'}</dd>
          </div>
        </dl>
      )}
    </section>
  ) : (
    <section className="logs-detail is-empty">
      <p>Select a conversation.</p>
    </section>
  )

  return (
    <div className={`logs${mobile ? ' is-mobile' : ''}`}>
      {mobile ? (selected ? detail : list) : (
        <>
          {list}
          {detail}
        </>
      )}
      <Dialog open={filterOpen} title="Filter by" labelledBy="filter-title" onClose={() => onFilter(false)}>
        <div className="filter-body">
          <label>
            <span>Source</span>
            <select value={draft.source} onChange={(event) => setDraft((prev) => ({ ...prev, source: event.target.value as ActivityFilters['source'] }))}>
              <option value="all">All</option>
              <option value="Playground">Playground</option>
              <option value="Widget">Widget</option>
            </select>
          </label>
          <label>
            <span>Feedback</span>
            <select value={draft.feedback} onChange={(event) => setDraft((prev) => ({ ...prev, feedback: event.target.value as ActivityFilters['feedback'] }))}>
              <option value="all">All</option>
              <option value="none">None</option>
              <option value="good">Good</option>
              <option value="bad">Bad</option>
            </select>
          </label>
          <label>
            <span>Date</span>
            <select value={draft.range} onChange={(event) => setDraft((prev) => ({ ...prev, range: event.target.value as ActivityFilters['range'] }))}>
              <option value="all">All</option>
              <option value="7d">Last 7 days</option>
            </select>
          </label>
        </div>
        <footer className="dialog-foot">
          <button className="ghost-button" type="button" onClick={() => setDraft(DEFAULT_FILTERS)}>Reset</button>
          <button className="primary-button" type="button" onClick={applyFilters}>Filter</button>
        </footer>
      </Dialog>
    </div>
  )
}
