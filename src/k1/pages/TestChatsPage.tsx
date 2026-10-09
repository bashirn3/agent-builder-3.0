import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ease } from '../../lib/motion'
import type { AgentConfig } from '../data/agentConfig'
import { deleteTestChats, getTestChat, listTestChats, setFeedback, type TestChat, type TestChatFilters, type TestChatSummary } from '../data/builderApi'
import { downloadCsv, toCsv } from '../data/fixtures'
import type { TestMessage } from '../data/useTestChat'
import { go, href } from '../routes'
import { MultiSelect, Select, Skeleton, Switch } from '../ui/controls'
import { DateRangeField } from '../ui/DateRange'
import { Download, Link2, RefreshCw, Search, SlidersHorizontal, ThumbsDown, ThumbsUp, Trash, X } from '../ui/icons'
import { Dialog } from '../ui/overlay'
import { Bubble } from './PlaygroundPage'
import { copy, locale, useCopy } from '../i18n'
import { onCacheReset } from '../data/builderApi'
import { Spinner } from '../ui/controls'
import { ThreadSkeleton } from '../ui/skeletons'
import { orderVersions, versionHint } from './versionText'
import { DetailPane, Facts, formatStamp, ListPane, MobileSwap, relativeTime } from './SplitView'
import { TJ_SHOWCASE, canSeeShowcase, matchingShowcase, showcaseById } from '../data/tjShowcase'
import { useSession } from '../auth/session'

export type ChatFilters = Omit<TestChatFilters, 'from' | 'to' | 'query'> & { from: string | null; to: string | null; query: string }

export const EMPTY_CHAT_FILTERS: ChatFilters = { versions: [], includeDraft: true, feedback: null, source: null, from: null, to: null, query: '' }

// Lists and chats already seen this session are shown at once while fresh ones load.
const listCache = new Map<string, TestChatSummary[]>()
const chatCache = new Map<string, TestChat>()
onCacheReset(() => { listCache.clear(); chatCache.clear() })

const listKey = (filters: TestChatFilters) => JSON.stringify(filters)

// Instant results while typing: match what is already on screen until the full search answers.
function quickMatch(items: TestChatSummary[], query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return items
  return items.filter((item) => `${item.title} ${item.lastReply}`.toLowerCase().includes(needle))
}

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
const showcaseStamp = (iso: string) => new Intl.DateTimeFormat(locale(), {
  timeZone: 'Europe/Helsinki', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(iso))

function FilterDialog({ open, filters, config, onChange, onClose }: {
  open: boolean
  filters: ChatFilters
  config: AgentConfig | null
  onChange: (filters: ChatFilters) => void
  onClose: () => void
}) {
  const t = useCopy()
  const ids = { range: useId(), versions: useId(), feedback: useId(), source: useId(), drafts: useId(), draftsHint: useId() }
  const ordered = orderVersions(config?.versions ?? [])
  const tested = ordered.filter((version) => version.live || version.conversations > 0)
  const untested = ordered.filter((version) => !version.live && version.conversations === 0)
  const versionOptions = [
    ...tested.map((version) => ({ value: String(version.number), label: `v${version.number}`, hint: versionHint(version, t), keywords: version.note, group: t.versions.withChats })),
    ...untested.map((version) => ({ value: String(version.number), label: `v${version.number}`, hint: versionHint(version, t, { chats: false }), keywords: version.note, group: t.versions.noChats })),
  ]
  const picked = [...filters.versions].sort((a, b) => b - a)
  const versionSummary = !picked.length ? t.versions.all : picked.length <= 3 ? picked.map((number) => `v${number}`).join(', ') : t.versions.count(picked.length)
  return (
    <Dialog open={open} title={t.chats.filterBy} onClose={onClose} width={530}>
      <div className="k1-form-stack">
        <div className="k1-field">
          <label htmlFor={ids.versions}>{t.chats.version}</label>
          <MultiSelect<string>
            id={ids.versions}
            label={t.chats.version}
            values={filters.versions.map(String)}
            options={versionOptions}
            summary={versionSummary}
            searchPlaceholder={t.versions.search}
            emptyText={t.versions.none}
            clearLabel={t.versions.clear}
            onChange={(picked) => onChange({ ...filters, versions: picked.map(Number).sort((a, b) => b - a) })}
          />
        </div>
        <div className="k1-switch-row">
          <span className="k1-switch-row__label" id={ids.drafts}>{t.versions.includeDrafts}</span>
          <Switch checked={filters.includeDraft} onChange={(includeDraft) => onChange({ ...filters, includeDraft })} labelledBy={ids.drafts} describedBy={ids.draftsHint} />
        </div>
        <p className="k1-hint k1-filter__drafts" id={ids.draftsHint}>{t.versions.draftsHint}</p>
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

function Totals({ items, thumbs }: { items: TestChatSummary[]; thumbs?: DebugThumbs }) {
  const t = useCopy()
  const up = thumbs?.up ?? items.reduce((sum, item) => sum + item.thumbsUp, 0)
  const down = thumbs?.down ?? items.reduce((sum, item) => sum + item.thumbsDown, 0)
  return (
    <div className="k1-totals" aria-label={t.chats.totals}>
      <span><strong>{items.length}</strong> {t.chats.chats(items.length)}</span>
      <span><ThumbsUp size={13} strokeWidth={1.75} /><strong>{up}</strong></span>
      <span><ThumbsDown size={13} strokeWidth={1.75} /><strong>{down}</strong></span>
    </div>
  )
}

type DebugThumbs = { up: number; down: number }
const DEBUG_KEY = 'k1-chats-debug'

function readDebug(): DebugThumbs | null {
  try {
    const saved = JSON.parse(localStorage.getItem(DEBUG_KEY) ?? 'null')
    return typeof saved?.up === 'number' && typeof saved?.down === 'number' ? saved : null
  } catch {
    return null
  }
}

function useDebugMode(allowed: boolean) {
  const [thumbs, setThumbs] = useState<DebugThumbs | null>(readDebug)
  const toggle = (on: boolean) => {
    const next = on ? { up: 37 + Math.floor(Math.random() * 50), down: 1 } : null
    if (next) localStorage.setItem(DEBUG_KEY, JSON.stringify(next))
    else localStorage.removeItem(DEBUG_KEY)
    setThumbs(next)
  }
  return { thumbs: allowed ? thumbs : null, toggle }
}

function ConfirmDelete({ ids, onClose, onDeleted, notify }: {
  ids: string[] | null
  onClose: () => void
  onDeleted: (ids: string[]) => void
  notify: (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void
}) {
  const t = useCopy()
  const [busy, setBusy] = useState(false)
  const count = ids?.length ?? 0
  const confirm = async () => {
    if (!ids?.length) return
    setBusy(true)
    try {
      const removed = await deleteTestChats(ids)
      onDeleted(ids)
      notify({ title: t.chats.deleted, body: t.chats.deletedBody(removed) })
      onClose()
    } catch {
      notify({ tone: 'error', title: t.chats.deleteFailed, body: t.chats.deleteFailedBody })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={count > 0} title={t.chats.deleteTitle(count)} onClose={() => { if (!busy) onClose() }} width={420}>
      <div className="k1-form-stack">
        <p className="k1-dialog__text">{t.chats.deleteBody(count)}</p>
      </div>
      <footer className="k1-dialog__foot">
        <button type="button" className="k1-btn k1-btn--outline" onClick={onClose} disabled={busy}>{t.common.cancel}</button>
        <button type="button" className="k1-btn k1-btn--danger" onClick={() => void confirm()} disabled={busy} aria-busy={busy}>{busy && <Spinner />}{t.chats.deleteAction(count)}</button>
      </footer>
    </Dialog>
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
  const session = useSession()
  const canDebug = canSeeShowcase(session.user?.email)
  const debug = useDebugMode(canDebug)
  const debugId = useId()
  const showcaseAllowed = Boolean(debug.thumbs)
  const showcaseFor = (chatId: string) => (showcaseAllowed ? showcaseById(chatId) : null)
  const [items, setItems] = useState<TestChatSummary[]>(() => listCache.get(listKey(toApi(filters))) ?? [])
  const [loading, setLoading] = useState(() => !listCache.has(listKey(toApi(filters))))
  const [searching, setSearching] = useState(false)
  // The search text the items on screen belong to; until results for a new search arrive, the old items are narrowed locally.
  const [itemsQuery, setItemsQuery] = useState(() => (listCache.has(listKey(toApi(filters))) ? filters.query : ''))
  const running = useRef<AbortController | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [spin, setSpin] = useState(0)
  const [filterOpen, setFilterOpen] = useState(false)
  const [deleting, setDeleting] = useState<string[] | null>(null)
  const [tab, setTab] = useState<'chat' | 'details'>('chat')
  const [selected, setSelected] = useState<TestChat | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [messages, setMessages] = useState<TestMessage[]>([])
  const [query, setQuery] = useState(filters.query)
  const request = useRef(0)

  const refresh = () => {
    const ticket = ++request.current
    const api = toApi(filters)
    const key = listKey(api)
    const cached = listCache.get(key)
    running.current?.abort()
    const controller = new AbortController()
    running.current = controller
    setLoadError(null)
    if (cached) {
      setItems(cached)
      setItemsQuery(filters.query)
      setLoading(false)
    } else {
      setLoading((current) => current && !items.length)
    }
    setSearching(true)
    listTestChats(api, controller.signal)
      .then((list) => {
        if (ticket !== request.current) return
        listCache.set(key, list)
        setItems(list)
        setItemsQuery(filters.query)
      })
      .catch(() => {
        if (ticket !== request.current || controller.signal.aborted) return
        if (!cached) { setItems([]); setLoadError(copy().chats.loadFailed) }
      })
      .finally(() => {
        if (ticket !== request.current) return
        setLoading(false)
        setSearching(false)
      })
  }
  useEffect(refresh, [filters])
  useEffect(() => () => running.current?.abort(), [])

  useEffect(() => {
    const timer = window.setTimeout(() => { if (query !== filters.query) onFilters({ ...filters, query }) }, 300)
    return () => window.clearTimeout(timer)
  }, [query])

  // Leaving the page before the pause ends still keeps what was typed.
  const latest = useRef({ query, filters, onFilters })
  latest.current = { query, filters, onFilters }
  useEffect(() => () => {
    const { query: typed, filters: applied, onFilters: apply } = latest.current
    if (typed !== applied.query) apply({ ...applied, query: typed })
  }, [])

  useEffect(() => {
    if (compact || id) return
    const first = showcaseAllowed ? TJ_SHOWCASE[0].conversation.id : items[0]?.id
    if (first) go({ page: 'chats', id: first }, true)
  }, [compact, id, items, showcaseAllowed])

  useEffect(() => {
    if (!id) { setSelected(null); return }
    const showcase = showcaseFor(id)
    if (showcase) {
      setSelected(showcase)
      setMessages(toMessages(showcase))
      setDetailLoading(false)
      return
    }
    let cancelled = false
    const cached = chatCache.get(id)
    if (cached) {
      setSelected(cached)
      setMessages(toMessages(cached))
    }
    setDetailLoading(!cached)
    void getTestChat(id)
      .then((chat) => {
        if (cancelled) return
        if (chat) chatCache.set(id, chat)
        setSelected(chat)
        setMessages(chat ? toMessages(chat) : [])
      })
      .catch(() => { if (!cancelled && !cached) setSelected(null) })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [id, showcaseAllowed])

  const rate = (messageId: string, value: 'up' | 'down') => {
    const message = messages.find((item) => item.id === messageId)
    if (!message?.serverId) return
    const next = message.feedback === value ? null : value
    setMessages((list) => list.map((item) => (item.id === messageId ? { ...item, feedback: next } : item)))
    const cachedChat = id ? chatCache.get(id) : undefined
    if (cachedChat && id) chatCache.set(id, { ...cachedChat, messages: cachedChat.messages.map((item) => (item.id === message.serverId ? { ...item, feedback: next } : item)) })
    listCache.clear()
    const delta = (kind: 'up' | 'down') => (next === kind ? 1 : 0) - (message.feedback === kind ? 1 : 0)
    setItems((list) => list.map((item) => (item.id === id ? { ...item, thumbsUp: item.thumbsUp + delta('up'), thumbsDown: item.thumbsDown + delta('down') } : item)))
    void setFeedback(message.serverId, next).catch(() => notify({ tone: 'error', title: copy().chats.feedbackFailed, body: copy().chats.feedbackFailedBody }))
  }

  const afterDelete = (removed: string[]) => {
    listCache.clear()
    removed.forEach((removedId) => chatCache.delete(removedId))
    const left = items.filter((item) => !removed.includes(item.id))
    setItems(left)
    if (id && removed.includes(id)) {
      setSelected(null)
      go({ page: 'chats', id: compact ? null : left[0]?.id ?? null }, true)
    }
    refresh()
  }

  const pendingQuery = query.trim() !== filters.query.trim()
  const realShown = pendingQuery ? quickMatch(items, query) : itemsQuery !== filters.query ? quickMatch(items, filters.query) : items
  const showcaseShown = (showcaseAllowed ? matchingShowcase(query) : []).filter(() => !filters.feedback && !filters.from && !filters.to && !filters.source && !filters.versions.length)
  const shown = [...showcaseShown.map((chat) => chat.conversation), ...realShown]
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

  const toggleDebug = (on: boolean) => {
    debug.toggle(on)
    if (!compact) go({ page: 'chats', id: on ? TJ_SHOWCASE[0].conversation.id : items[0]?.id ?? null }, true)
    else if (id && showcaseById(id)) go({ page: 'chats', id: null }, true)
  }

  const list = (
    <ListPane
      title={showcaseAllowed ? t.chats.debugTitle : t.chats.title}
      loading={loading && !showcaseShown.length && !realShown.length}
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
          <button type="button" className="k1-icon-btn k1-icon-btn--boxed k1-icon-btn--lg" aria-label={t.chats.deleteShown(realShown.length)} title={t.chats.deleteShown(realShown.length)} onClick={() => setDeleting(realShown.map((item) => item.id))} disabled={!realShown.length || pendingQuery || searching}>
            <Trash size={16} strokeWidth={1.75} />
          </button>
          <button type="button" className="k1-icon-btn k1-icon-btn--solid k1-icon-btn--lg" aria-label={t.common.exportCsv} onClick={exportCsv} disabled={!items.length}>
            <Download size={16} strokeWidth={1.75} />
          </button>
        </>
      )}
      chips={(
        <>
          <label className="k1-list-search">
            {searching && !loading ? <Spinner size={14} /> : <Search size={14} />}
            <input className="k1-input" value={query} placeholder={t.chats.search} aria-label={t.chats.searchLabel} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <Chips filters={filters} onChange={(next) => { setQuery(next.query); onFilters(next) }} />
          {canDebug && (
            <div className="k1-debug-toggle">
              <span id={debugId}>{t.chats.debugMode}</span>
              <Switch checked={showcaseAllowed} onChange={toggleDebug} labelledBy={debugId} />
            </div>
          )}
          {!loading && shown.length > 0 && <Totals items={showcaseAllowed ? shown : realShown} thumbs={debug.thumbs ?? undefined} />}
        </>
      )}
      items={shown.map((item) => {
        const illustrative = Boolean(showcaseFor(item.id))
        return {
          id: item.id,
          title: item.title || t.chats.openerOnly,
          subtitle: item.lastReply || t.chats.noReply,
          meta: illustrative ? showcaseStamp(item.updatedAt) : relativeTime(item.updatedAt),
          href: href({ page: 'chats', id: item.id }),
          tags: (
            <>
              {!illustrative && <span className={`k1-vtag${item.isDraft ? ' is-draft' : ''}`}>{versionTag(item)}</span>}
              {!illustrative && item.source === 'compare' && <span className="k1-vtag is-muted">{t.chats.sources.compare}</span>}
              {!illustrative && item.thumbsUp > 0 && <span className="k1-vcount"><ThumbsUp size={12} strokeWidth={1.75} />{item.thumbsUp}</span>}
              {!illustrative && item.thumbsDown > 0 && <span className="k1-vcount is-down"><ThumbsDown size={12} strokeWidth={1.75} />{item.thumbsDown}</span>}
            </>
          ),
        }
      })}
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
  const showcase = conversation ? showcaseFor(conversation.id) : null
  const detail = detailLoading && !conversation ? (
    <ThreadSkeleton label={t.chats.loadingChat} />
  ) : conversation ? (
    <DetailPane
      paneKey={conversation.id}
      title={conversation.title || t.chats.testChat}
      tabs={[{ value: 'chat', label: t.chats.chat }, { value: 'details', label: t.chats.details }]}
      tab={tab}
      onTab={setTab}
      backLabel={t.chats.backTo}
      onBack={compact ? () => go({ page: 'chats', id: null }) : undefined}
      menu={[...(!showcase ? [{
        label: t.chats.deleteOne,
        icon: <Trash size={14} strokeWidth={1.75} />,
        tone: 'danger' as const,
        onSelect: () => setDeleting([conversation.id]),
      }] : []), {
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
        <div className={`k1-thread${showcase ? ' k1-thread--showcase' : ''}`}>
          {!showcase && <p className="k1-thread__version"><span className={`k1-vtag${conversation.isDraft ? ' is-draft' : ''}`}>{versionTag(conversation)}</span> {sourceLabel(conversation.source)} · {formatStamp(conversation.createdAt)}</p>}
          {messages.map((message, index) => showcase ? (
            <div key={message.id} className="k1-showcase__message">
              <div className={`k1-msg k1-msg--${message.role}`}>
                <div className="k1-msg__bubble">{message.text}</div>
                <time className="k1-showcase__time" dateTime={showcase.messages[index].createdAt}>{showcaseStamp(showcase.messages[index].createdAt)}</time>
              </div>
            </div>
          ) : (
            <Bubble key={message.id} message={message} onRate={(value) => rate(message.id, value)} />
          ))}
        </div>
      ) : (
        <Facts rows={[
          ...(showcase ? [] : [
            [t.chats.version, versionTag(conversation)],
            [t.chats.source, sourceLabel(conversation.source)],
            [t.chats.thumbsUp, String(messages.filter((message) => message.feedback === 'up').length)],
            [t.chats.thumbsDown, String(messages.filter((message) => message.feedback === 'down').length)],
            [t.chats.conversationId, <code>{conversation.id}</code>],
          ] as Array<[string, ReactNode]>),
          [t.chats.started, showcase ? showcaseStamp(conversation.createdAt) : formatStamp(conversation.createdAt)],
          [t.chats.lastMessage, showcase ? showcaseStamp(conversation.updatedAt) : formatStamp(conversation.updatedAt)],
          [t.chats.messages, String(conversation.messageCount)],
        ]} />
      )}
    </DetailPane>
  ) : (
    <div className="k1-detail k1-detail--empty"><p>{id && !loading && !detailLoading ? t.chats.notFound : t.chats.select}</p></div>
  )

  return (
    <>
      {compact ? <div className="k1-split k1-split--compact"><MobileSwap showDetail={Boolean(id)} list={list} detail={detail} /></div> : <div className="k1-split">{list}{detail}</div>}
      <ConfirmDelete ids={deleting} onClose={() => setDeleting(null)} onDeleted={afterDelete} notify={notify} />
      <FilterDialog open={filterOpen} filters={filters} config={config} onChange={onFilters} onClose={() => setFilterOpen(false)} />
    </>
  )
}
