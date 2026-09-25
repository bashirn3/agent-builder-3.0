import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useRef, useState } from 'react'
import { ease } from '../../lib/motion'
import type { AgentConfig } from '../data/agentConfig'
import { getTestChat, listTestChats, setFeedback, type TestChat, type TestChatFilters, type TestChatSummary } from '../data/builderApi'
import { downloadCsv, toCsv } from '../data/fixtures'
import type { TestMessage } from '../data/useTestChat'
import { go, href } from '../routes'
import { Select, Skeleton } from '../ui/controls'
import { DateRangeField } from '../ui/DateRange'
import { Download, Link2, RefreshCw, Search, SlidersHorizontal, ThumbsDown, ThumbsUp, X } from '../ui/icons'
import { Dialog } from '../ui/overlay'
import { Bubble } from './PlaygroundPage'
import { copy, useCopy } from '../i18n'
import { DetailPane, Facts, formatStamp, ListPane, MobileSwap, relativeTime } from './SplitView'

export type ChatFilters = Omit<TestChatFilters, 'from' | 'to' | 'query'> & { from: string | null; to: string | null; query: string }

export const EMPTY_CHAT_FILTERS: ChatFilters = { versions: [], includeDraft: true, feedback: null, source: null, from: null, to: null, query: '' }

const DRAFTS = 'draft'

export function chatFilterCount(filters: ChatFilters) {
  return (filters.versions.length || !filters.includeDraft ? 1 : 0) + (filters.feedback ? 1 : 0) + (filters.source ? 1 : 0) + (filters.from ? 1 : 0)
}

function toApi(filters: ChatFilters): TestChatFilters {
  const next = (day: string) => {
    const date = new Date(`${day}T00:00:00`)
    date.setDate(date.getDate() + 1)
    return date.toISOString()
  }
  return {
    ...filters,
    from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : null,
    to: filters.from ? next(filters.to ?? filters.from) : null,
  }
}

export function versionTag(chat: Pick<TestChatSummary, 'isDraft' | 'versionNumber'>) {
  const t = copy()
  if (chat.isDraft) return chat.versionNumber ? t.chats.draftFrom(chat.versionNumber) : t.common.draft
  return chat.versionNumber ? `v${chat.versionNumber}` : t.chats.unsavedVersion
}

const sourceLabel = (source: TestChatSummary['source']) => copy().chats.sources[source === 'compare' ? 'compare' : 'playground']

function FilterDialog({ open, filters, config, onChange, onClose }: {
  open: boolean
  filters: ChatFilters
  config: AgentConfig | null
  onChange: (filters: ChatFilters) => void
  onClose: () => void
}) {
  const t = useCopy()
  const ids = { range: useId(), versions: useId(), feedback: useId(), source: useId() }
  const versions = config?.versions ?? []
  const toggleVersion = (value: string) => {
    if (value === DRAFTS) {
      onChange({ ...filters, includeDraft: !filters.includeDraft })
      return
    }
    const number = Number(value)
    onChange({ ...filters, versions: filters.versions.includes(number) ? filters.versions.filter((item) => item !== number) : [...filters.versions, number] })
  }
  return (
    <Dialog open={open} title={t.chats.filterBy} onClose={onClose} width={530}>
      <div className="k1-form-stack">
        <div className="k1-field">
          <span id={ids.versions}>{t.chats.version}</span>
          <div className="k1-version-picks" role="group" aria-labelledby={ids.versions}>
            {versions.map((version) => (
              <button
                key={version.id}
                type="button"
                className="k1-token"
                aria-pressed={filters.versions.includes(version.number)}
                onClick={() => toggleVersion(String(version.number))}
              >
                v{version.number}{version.live ? ` · ${t.common.live}` : ''}
              </button>
            ))}
            <button type="button" className="k1-token" aria-pressed={filters.includeDraft} onClick={() => toggleVersion(DRAFTS)}>{t.chats.drafts}</button>
          </div>
          <p className="k1-hint">{filters.versions.length ? t.chats.onlyTicked : t.chats.allShown} {filters.includeDraft ? t.chats.draftsIncluded : t.chats.draftsHidden}</p>
        </div>
        <div className="k1-field">
          <label htmlFor={ids.feedback}>{t.chats.feedback}</label>
          <Select<'up' | 'down' | 'none'>
            id={ids.feedback}
            label={t.chats.feedback}
            value={filters.feedback}
            placeholder={t.chats.selectFeedback}
            options={[{ value: 'up', label: t.chats.hasUp }, { value: 'down', label: t.chats.hasDown }, { value: 'none', label: t.chats.noFeedback }]}
            onChange={(feedback) => onChange({ ...filters, feedback })}
          />
        </div>
        <div className="k1-field">
          <label htmlFor={ids.source}>{t.chats.source}</label>
          <Select<'playground' | 'compare'>
            id={ids.source}
            label={t.chats.source}
            value={filters.source}
            placeholder={t.chats.selectSource}
            options={[{ value: 'playground', label: t.chats.sources.playground }, { value: 'compare', label: t.chats.sources.compare }]}
            onChange={(source) => onChange({ ...filters, source })}
          />
        </div>
        <div className="k1-field">
          <label htmlFor={ids.range}>{t.chats.dateRange}</label>
          <DateRangeField id={ids.range} from={filters.from} to={filters.to} onChange={(range) => onChange({ ...filters, ...range })} />
        </div>
      </div>
      <footer className="k1-dialog__foot">
        <button type="button" className="k1-link k1-link--danger" onClick={() => onChange({ ...EMPTY_CHAT_FILTERS, query: filters.query })} disabled={!chatFilterCount(filters)}>{t.common.clearAll}</button>
        <button type="button" className="k1-btn k1-btn--outline" onClick={onClose}>{t.common.close}</button>
      </footer>
    </Dialog>
  )
}

function Chips({ filters, onChange }: { filters: ChatFilters; onChange: (filters: ChatFilters) => void }) {
  const t = useCopy()
  const chips = [
    ...filters.versions.map((number) => ({ key: `v${number}`, label: `v${number}`, clear: { versions: filters.versions.filter((item) => item !== number) } })),
    !filters.includeDraft && { key: 'drafts', label: t.chats.noDrafts, clear: { includeDraft: true } },
    filters.feedback && { key: 'feedback', label: filters.feedback === 'up' ? t.chats.chipUp : filters.feedback === 'down' ? t.chats.chipDown : t.chats.chipNone, clear: { feedback: null } },
    filters.source && { key: 'source', label: sourceLabel(filters.source), clear: { source: null } },
    filters.from && { key: 'range', label: `${filters.from} – ${filters.to ?? filters.from}`, clear: { from: null, to: null } },
  ].filter(Boolean) as Array<{ key: string; label: string; clear: Partial<ChatFilters> }>
  return (
    <AnimatePresence initial={false}>
      {chips.length > 0 && (
        <motion.div className="k1-chips" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease }}>
          <div className="k1-chips__row">
            {chips.map((chip) => (
              <span key={chip.key} className="k1-chip">
                {chip.label}
                <button type="button" aria-label={t.chats.removeFilter(chip.label)} onClick={() => onChange({ ...filters, ...chip.clear })}><X size={12} strokeWidth={2} /></button>
              </span>
            ))}
            <button type="button" className="k1-link k1-link--danger" onClick={() => onChange({ ...EMPTY_CHAT_FILTERS, query: filters.query })}>{t.common.clearAll}</button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Totals({ items }: { items: TestChatSummary[] }) {
  const t = useCopy()
  const up = items.reduce((sum, item) => sum + item.thumbsUp, 0)
  const down = items.reduce((sum, item) => sum + item.thumbsDown, 0)
  return (
    <div className="k1-totals" aria-label={t.chats.totals}>
      <span><strong>{items.length}</strong> {t.chats.chats(items.length)}</span>
      <span><ThumbsUp size={13} strokeWidth={1.75} /><strong>{up}</strong></span>
      <span><ThumbsDown size={13} strokeWidth={1.75} /><strong>{down}</strong></span>
    </div>
  )
}

function toMessages(chat: TestChat): TestMessage[] {
  return chat.messages.map((message) => ({
    id: message.id,
    role: message.role,
    text: message.text,
    at: new Date(message.createdAt).getTime(),
    opener: message.isOpener,
    kind: message.kind ?? null,
    feedback: message.feedback,
    serverId: message.role === 'agent' && !message.isOpener ? message.id : null,
  }))
}

export function TestChatsPage({ id, compact, config, filters, onFilters, notify }: {
  id: string | null
  compact: boolean
  config: AgentConfig | null
  filters: ChatFilters
  onFilters: (filters: ChatFilters) => void
  notify: (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void
}) {
  const t = useCopy()
  const [items, setItems] = useState<TestChatSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [spin, setSpin] = useState(0)
  const [filterOpen, setFilterOpen] = useState(false)
  const [tab, setTab] = useState<'chat' | 'details'>('chat')
  const [selected, setSelected] = useState<TestChat | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [messages, setMessages] = useState<TestMessage[]>([])
  const [query, setQuery] = useState(filters.query)
  const request = useRef(0)

  const refresh = () => {
    const ticket = ++request.current
    setLoading(true)
    setLoadError(null)
    listTestChats(toApi(filters))
      .then((list) => { if (ticket === request.current) setItems(list) })
      .catch(() => { if (ticket === request.current) { setItems([]); setLoadError(copy().chats.loadFailed) } })
      .finally(() => { if (ticket === request.current) setLoading(false) })
  }
  useEffect(refresh, [filters])

  useEffect(() => {
    const timer = window.setTimeout(() => { if (query !== filters.query) onFilters({ ...filters, query }) }, 300)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (!compact && !id && items[0]) go({ page: 'chats', id: items[0].id }, true)
  }, [compact, id, items])

  useEffect(() => {
    if (!id) { setSelected(null); return }
    let cancelled = false
    setDetailLoading(true)
    void getTestChat(id)
      .then((chat) => {
        if (cancelled) return
        setSelected(chat)
        setMessages(chat ? toMessages(chat) : [])
      })
      .catch(() => { if (!cancelled) setSelected(null) })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [id])

  const rate = (messageId: string, value: 'up' | 'down') => {
    const message = messages.find((item) => item.id === messageId)
    if (!message?.serverId) return
    const next = message.feedback === value ? null : value
    setMessages((list) => list.map((item) => (item.id === messageId ? { ...item, feedback: next } : item)))
    const delta = (kind: 'up' | 'down') => (next === kind ? 1 : 0) - (message.feedback === kind ? 1 : 0)
    setItems((list) => list.map((item) => (item.id === id ? { ...item, thumbsUp: item.thumbsUp + delta('up'), thumbsDown: item.thumbsDown + delta('down') } : item)))
    void setFeedback(message.serverId, next).catch(() => notify({ tone: 'error', title: copy().chats.feedbackFailed, body: copy().chats.feedbackFailedBody }))
  }

  const count = chatFilterCount(filters)
  const tracking = config?.tracking !== false

  const exportCsv = () => {
    downloadCsv('k1-test-chats.csv', toCsv(items.map((item) => ({
      conversation: item.id,
      version: versionTag(item),
      source: sourceLabel(item.source),
      first_message: item.title,
      last_reply: item.lastReply,
      messages: String(item.messageCount),
      thumbs_up: String(item.thumbsUp),
      thumbs_down: String(item.thumbsDown),
      updated: item.updatedAt,
    }))))
    notify({ title: t.common.exportReady, body: t.chats.exportBody(items.length) })
  }

  const list = (
    <ListPane
      title={t.chats.title}
      loading={loading}
      selectedId={id}
      actions={(
        <>
          <button type="button" className="k1-icon-btn k1-icon-btn--boxed k1-icon-btn--lg" aria-label={count ? t.chats.filtersActive(count) : t.chats.filters} aria-haspopup="dialog" onClick={() => setFilterOpen(true)}>
            <SlidersHorizontal size={16} strokeWidth={1.75} />
            <AnimatePresence>
              {count > 0 && <motion.span className="k1-count" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ duration: 0.16, ease }}>{count}</motion.span>}
            </AnimatePresence>
          </button>
          <button type="button" className="k1-icon-btn k1-icon-btn--boxed k1-icon-btn--lg" aria-label={t.common.refresh} onClick={() => { setSpin((turns) => turns + 1); refresh() }}>
            <motion.span animate={{ rotate: spin * 360 }} transition={{ duration: 0.5, ease }} style={{ display: 'inline-flex' }}><RefreshCw size={16} strokeWidth={1.75} /></motion.span>
          </button>
          <button type="button" className="k1-icon-btn k1-icon-btn--solid k1-icon-btn--lg" aria-label={t.common.exportCsv} onClick={exportCsv} disabled={!items.length}>
            <Download size={16} strokeWidth={1.75} />
          </button>
        </>
      )}
      chips={(
        <>
          <label className="k1-list-search">
            <Search size={14} />
            <input className="k1-input" value={query} placeholder={t.chats.search} aria-label={t.chats.searchLabel} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <Chips filters={filters} onChange={(next) => { setQuery(next.query); onFilters(next) }} />
          {!loading && items.length > 0 && <Totals items={items} />}
        </>
      )}
      items={items.map((item) => ({
        id: item.id,
        title: item.title || t.chats.openerOnly,
        subtitle: item.lastReply || t.chats.noReply,
        meta: relativeTime(item.updatedAt),
        href: href({ page: 'chats', id: item.id }),
        tags: (
          <>
            <span className={`k1-vtag${item.isDraft ? ' is-draft' : ''}`}>{versionTag(item)}</span>
            {item.source === 'compare' && <span className="k1-vtag is-muted">{t.chats.sources.compare}</span>}
            {item.thumbsUp > 0 && <span className="k1-vcount"><ThumbsUp size={12} strokeWidth={1.75} />{item.thumbsUp}</span>}
            {item.thumbsDown > 0 && <span className="k1-vcount is-down"><ThumbsDown size={12} strokeWidth={1.75} />{item.thumbsDown}</span>}
          </>
        ),
      }))}
      empty={loadError ? (
        <>
          <p><strong>{loadError}</strong></p>
          {!tracking && <p>{t.chats.needsBackend}</p>}
          <button type="button" className="k1-btn k1-btn--outline k1-btn--sm" onClick={refresh}>{t.common.tryAgain}</button>
        </>
      ) : (
        <>
          <p><strong>{count || filters.query ? t.chats.noMatch : t.chats.none}</strong></p>
          <p>{count || filters.query ? t.chats.noMatchHint : t.chats.noneHint}</p>
          {count > 0 && <button type="button" className="k1-btn k1-btn--outline k1-btn--sm" onClick={() => onFilters({ ...EMPTY_CHAT_FILTERS, query: filters.query })}>{t.chats.clearFilters}</button>}
        </>
      )}
    />
  )

  const conversation = selected?.conversation?.id === id ? selected.conversation : null
  const detail = detailLoading && !conversation ? (
    <div className="k1-detail k1-detail--empty" role="status" aria-label={t.chats.loadingChat}><Skeleton width="60%" height={60} radius={20} /></div>
  ) : conversation ? (
    <DetailPane
      paneKey={conversation.id}
      title={conversation.title || t.chats.testChat}
      tabs={[{ value: 'chat', label: t.chats.chat }, { value: 'details', label: t.chats.details }]}
      tab={tab}
      onTab={setTab}
      backLabel={t.chats.backTo}
      onBack={compact ? () => go({ page: 'chats', id: null }) : undefined}
      menu={[{
        label: t.common.copyLink,
        icon: <Link2 size={14} strokeWidth={1.75} />,
        onSelect: () => {
          void navigator.clipboard?.writeText(window.location.href)
            .then(() => notify({ title: t.common.linkCopied, body: t.chats.linkCopiedBody }))
            .catch(() => notify({ tone: 'error', title: t.common.copyFailed, body: t.common.clipboardBlocked }))
        },
      }]}
    >
      {tab === 'chat' ? (
        <div className="k1-thread">
          <p className="k1-thread__version"><span className={`k1-vtag${conversation.isDraft ? ' is-draft' : ''}`}>{versionTag(conversation)}</span> {sourceLabel(conversation.source)} · {formatStamp(conversation.createdAt)}</p>
          {messages.map((message) => (
            <Bubble key={message.id} message={message} onRate={(value) => rate(message.id, value)} />
          ))}
        </div>
      ) : (
        <Facts rows={[
          [t.chats.version, versionTag(conversation)],
          [t.chats.source, sourceLabel(conversation.source)],
          [t.chats.started, formatStamp(conversation.createdAt)],
          [t.chats.lastMessage, formatStamp(conversation.updatedAt)],
          [t.chats.messages, String(conversation.messageCount)],
          [t.chats.thumbsUp, String(messages.filter((message) => message.feedback === 'up').length)],
          [t.chats.thumbsDown, String(messages.filter((message) => message.feedback === 'down').length)],
          [t.chats.conversationId, <code>{conversation.id}</code>],
        ]} />
      )}
    </DetailPane>
  ) : (
    <div className="k1-detail k1-detail--empty"><p>{id && !loading && !detailLoading ? t.chats.notFound : t.chats.select}</p></div>
  )

  return (
    <>
      {compact ? <div className="k1-split k1-split--compact"><MobileSwap showDetail={Boolean(id)} list={list} detail={detail} /></div> : <div className="k1-split">{list}{detail}</div>}
      <FilterDialog open={filterOpen} filters={filters} config={config} onChange={onFilters} onClose={() => setFilterOpen(false)} />
    </>
  )
}
