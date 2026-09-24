import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useState } from 'react'
import { Download, Link2, RefreshCw, SlidersHorizontal, UserRound, X } from '../ui/icons'
import { ease } from '../../lib/motion'
import {
  activeFilterCount,
  downloadCsv,
  EMPTY_FILTERS,
  fixtureActivity,
  toCsv,
  type ActivityFilters,
  type Channel,
  type Conversation,
  type Outcome,
} from '../data/fixtures'
import { go, href } from '../routes'
import { Select } from '../ui/controls'
import { DateRangeField } from '../ui/DateRange'
import { Dialog } from '../ui/overlay'
import { DetailPane, Facts, formatStamp, ListPane, MobileSwap, relativeTime, SampleBadge, Thread } from './SplitView'

const OUTCOMES: Outcome[] = ['Booked', 'Needs follow-up', 'Handed to staff', 'No reply']
const CHANNELS: Channel[] = ['WhatsApp', 'Playground']

function lastOf(conversation: Conversation, role: 'agent' | 'user') {
  return [...conversation.messages].reverse().find((message) => message.role === role)?.text ?? ''
}

function FilterDialog({ open, filters, onChange, onClose }: {
  open: boolean
  filters: ActivityFilters
  onChange: (filters: ActivityFilters) => void
  onClose: () => void
}) {
  const ids = { range: useId(), outcome: useId(), channel: useId(), feedback: useId() }
  return (
    <Dialog open={open} title="Filter by" onClose={onClose} width={530}>
      <div className="k1-form-stack">
        <div className="k1-field">
          <label htmlFor={ids.range}>Date range</label>
          <DateRangeField id={ids.range} from={filters.from} to={filters.to} onChange={(range) => onChange({ ...filters, ...range })} />
        </div>
        <div className="k1-field">
          <label htmlFor={ids.outcome}>Outcome</label>
          <Select<Outcome> id={ids.outcome} label="Outcome" value={filters.outcome} placeholder="Select outcome" options={OUTCOMES.map((value) => ({ value, label: value }))} onChange={(outcome) => onChange({ ...filters, outcome })} />
        </div>
        <div className="k1-field">
          <label htmlFor={ids.channel}>Source</label>
          <Select<Channel> id={ids.channel} label="Source" value={filters.channel} placeholder="Select source" options={CHANNELS.map((value) => ({ value, label: value === 'Playground' ? 'Playground test' : value }))} onChange={(channel) => onChange({ ...filters, channel })} />
        </div>
        <div className="k1-field">
          <label htmlFor={ids.feedback}>Feedback</label>
          <Select<'up' | 'down'> id={ids.feedback} label="Feedback" value={filters.feedback} placeholder="Select feedback" options={[{ value: 'up', label: 'Contains thumbs up' }, { value: 'down', label: 'Contains thumbs down' }]} onChange={(feedback) => onChange({ ...filters, feedback })} />
        </div>
      </div>
      <footer className="k1-dialog__foot">
        <button type="button" className="k1-link k1-link--danger" onClick={() => onChange(EMPTY_FILTERS)} disabled={!activeFilterCount(filters)}>Clear all</button>
        <button type="button" className="k1-btn k1-btn--outline" onClick={onClose}>Close</button>
      </footer>
    </Dialog>
  )
}

function Chips({ filters, onChange }: { filters: ActivityFilters; onChange: (filters: ActivityFilters) => void }) {
  const chips = [
    filters.from && { key: 'range', label: `${filters.from} – ${filters.to ?? filters.from}`, clear: { from: null, to: null } },
    filters.outcome && { key: 'outcome', label: filters.outcome, clear: { outcome: null } },
    filters.channel && { key: 'channel', label: filters.channel === 'Playground' ? 'Playground test' : filters.channel, clear: { channel: null } },
    filters.feedback && { key: 'feedback', label: filters.feedback === 'up' ? 'Contains thumbs up' : 'Contains thumbs down', clear: { feedback: null } },
  ].filter(Boolean) as Array<{ key: string; label: string; clear: Partial<ActivityFilters> }>
  return (
    <AnimatePresence initial={false}>
      {chips.length > 0 && (
        <motion.div
          className="k1-chips"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease }}
        >
          <div className="k1-chips__row">
            {chips.map((chip) => (
              <span key={chip.key} className="k1-chip">
                {chip.label}
                <button type="button" aria-label={`Remove filter ${chip.label}`} onClick={() => onChange({ ...filters, ...chip.clear })}><X size={12} strokeWidth={2} /></button>
              </span>
            ))}
            <button type="button" className="k1-link k1-link--danger" onClick={() => onChange(EMPTY_FILTERS)}>Clear all</button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function ActivityPage({ id, compact, filters, onFilters, notify, onRevise }: {
  id: string | null
  compact: boolean
  filters: ActivityFilters
  onFilters: (filters: ActivityFilters) => void
  notify: (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void
  onRevise?: (question: string, answer: string) => void
}) {
  const [items, setItems] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [spin, setSpin] = useState(0)
  const [filterOpen, setFilterOpen] = useState(false)
  const [tab, setTab] = useState<'chat' | 'details'>('chat')

  const refresh = () => {
    setLoading(true)
    void fixtureActivity.list(filters).then((list) => { setItems(list); setLoading(false) })
  }
  useEffect(refresh, [filters])

  useEffect(() => {
    if (!compact && !id && items[0]) go({ page: 'chats', id: items[0].id }, true)
  }, [compact, id, items])

  const selected = id ? fixtureActivity.get(id) : null
  const count = activeFilterCount(filters)

  const exportCsv = () => {
    downloadCsv('k1-chat-logs-sample.csv', toCsv(items.map((item) => ({
      conversation: item.id,
      customer: item.customer ?? '',
      registration: item.registration ?? '',
      source: item.channel,
      outcome: item.outcome,
      started: item.startedAt,
      messages: String(item.messages.length),
    }))))
    notify({ title: 'Export ready', body: `${items.length} sample conversation${items.length === 1 ? '' : 's'} downloaded as CSV.` })
  }

  const list = (
    <ListPane
      title="Chat logs"
      badge={<SampleBadge />}
      loading={loading}
      selectedId={id}
      actions={(
        <>
          <button type="button" className="k1-icon-btn k1-icon-btn--boxed k1-icon-btn--lg" aria-label={count ? `Filters (${count} active)` : 'Filters'} aria-haspopup="dialog" onClick={() => setFilterOpen(true)}>
            <SlidersHorizontal size={16} strokeWidth={1.75} />
            <AnimatePresence>
              {count > 0 && (
                <motion.span className="k1-count" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ duration: 0.16, ease }}>{count}</motion.span>
              )}
            </AnimatePresence>
          </button>
          <button type="button" className="k1-icon-btn k1-icon-btn--boxed k1-icon-btn--lg" aria-label="Refresh" onClick={() => { setSpin((turns) => turns + 1); refresh() }}>
            <motion.span animate={{ rotate: spin * 360 }} transition={{ duration: 0.5, ease }} style={{ display: 'inline-flex' }}>
              <RefreshCw size={16} strokeWidth={1.75} />
            </motion.span>
          </button>
          <button type="button" className="k1-icon-btn k1-icon-btn--solid k1-icon-btn--lg" aria-label="Export as CSV" onClick={exportCsv} disabled={!items.length}>
            <Download size={16} strokeWidth={1.75} />
          </button>
        </>
      )}
      chips={<Chips filters={filters} onChange={onFilters} />}
      items={items.map((item) => ({
        id: item.id,
        title: lastOf(item, 'agent'),
        subtitle: lastOf(item, 'user') || 'No reply yet',
        meta: relativeTime(item.startedAt),
        href: href({ page: 'chats', id: item.id }),
      }))}
      empty={(
        <>
          <p><strong>No chats found</strong></p>
          <p>No sample conversations match these filters.</p>
          {count > 0 && <button type="button" className="k1-btn k1-btn--outline k1-btn--sm" onClick={() => onFilters(EMPTY_FILTERS)}>Clear filters</button>}
        </>
      )}
    />
  )

  const detail = selected ? (
    <DetailPane
      paneKey={selected.id}
      title={selected.customer ? `${selected.customer} · ${selected.registration}` : 'Playground test'}
      tabs={[{ value: 'chat', label: 'Chat' }, { value: 'details', label: 'Details' }]}
      tab={tab}
      onTab={setTab}
      backLabel="Back to Chat logs"
      onBack={compact ? () => go({ page: 'chats', id: null }) : undefined}
      menu={[
        ...(selected.leadId ? [{ label: 'Open lead', icon: <UserRound size={14} strokeWidth={1.75} />, onSelect: () => go({ page: 'leads', id: selected.leadId }) }] : []),
        {
          label: 'Copy link',
          icon: <Link2 size={14} strokeWidth={1.75} />,
          onSelect: () => {
            void navigator.clipboard?.writeText(window.location.href)
              .then(() => notify({ title: 'Link copied', body: 'The link to this sample conversation is on your clipboard.' }))
              .catch(() => notify({ tone: 'error', title: 'Copy failed', body: 'Your browser blocked clipboard access.' }))
          },
        },
      ]}
    >
      {tab === 'chat' ? <Thread messages={selected.messages} onRevise={onRevise} /> : (
        <Facts rows={[
          ['Customer', selected.customer ?? 'Internal test'],
          ['Registration', selected.registration ?? '—'],
          ['Source', selected.channel === 'Playground' ? 'Playground test' : selected.channel],
          ['Outcome', <span className={`k1-status k1-status--${selected.outcome.toLowerCase().replace(/\s+/g, '-')}`}>{selected.outcome}</span>],
          ['Station', selected.station ?? 'Not chosen'],
          ['Started', formatStamp(selected.startedAt)],
          ['Messages', String(selected.messages.length)],
          ['Feedback', selected.feedback === 'up' ? 'Thumbs up' : selected.feedback === 'down' ? 'Thumbs down' : 'None'],
          ['Lead', selected.leadId ? <a className="k1-link" href={href({ page: 'leads', id: selected.leadId })}>{selected.customer}</a> : 'No lead'],
          ['Conversation ID', <code>{selected.id}</code>],
        ]} />
      )}
    </DetailPane>
  ) : (
    <div className="k1-detail k1-detail--empty"><p>{id ? 'This conversation was not found.' : 'Select a conversation'}</p></div>
  )

  return (
    <>
      {compact ? <div className="k1-split k1-split--compact"><MobileSwap showDetail={Boolean(id)} list={list} detail={detail} /></div> : (
        <div className="k1-split">{list}{detail}</div>
      )}
      <FilterDialog open={filterOpen} filters={filters} onChange={onFilters} onClose={() => setFilterOpen(false)} />
    </>
  )
}
