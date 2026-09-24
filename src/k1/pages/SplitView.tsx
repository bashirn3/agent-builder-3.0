import { AnimatePresence, motion } from 'motion/react'
import { ReactNode, useId, useRef, type KeyboardEvent } from 'react'
import { ArrowLeft, MoreHorizontal } from 'lucide-react'
import { ease } from '../../lib/motion'
import type { ThreadMessage } from '../data/fixtures'
import { Menu, type MenuItem } from '../ui/controls'

export function relativeTime(iso: string, now = Date.now()) {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function formatStamp(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function SampleBadge() {
  return <span className="k1-badge k1-badge--sample" title="Invented records for the preview. Not connected to a live source.">Sample data</span>
}

export type ListItem = { id: string; title: string; meta: string; subtitle: string; href: string }

export function ListPane({ title, badge, actions, chips, items, selectedId, empty, loading }: {
  title: string
  badge?: ReactNode
  actions: ReactNode
  chips?: ReactNode
  items: ListItem[]
  selectedId: string | null
  empty: ReactNode
  loading?: boolean
}) {
  const listRef = useRef<HTMLUListElement>(null)
  const onKey = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const links = [...(listRef.current?.querySelectorAll<HTMLAnchorElement>('a') ?? [])]
    const index = links.indexOf(document.activeElement as HTMLAnchorElement)
    const next = links[event.key === 'ArrowDown' ? Math.min(links.length - 1, index + 1) : Math.max(0, index - 1)]
    if (next) { event.preventDefault(); next.focus(); next.click() }
  }
  return (
    <section className="k1-list" aria-label={title}>
      <header className="k1-list__head">
        <h1 className="k1-page-title">{title}</h1>
        {badge}
        <div className="k1-list__actions">{actions}</div>
      </header>
      {chips}
      {loading && !items.length ? (
        <div className="k1-list__empty" aria-busy="true"><p>Loading…</p></div>
      ) : items.length ? (
        <ul className="k1-list__items" ref={listRef} onKeyDown={onKey} aria-busy={loading || undefined}>
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <motion.li
                key={item.id}
                layout="position"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease }}
              >
                <a href={item.href} className={`k1-card${item.id === selectedId ? ' is-selected' : ''}`} aria-current={item.id === selectedId ? 'true' : undefined}>
                  <span className="k1-card__row">
                    <strong>{item.title}</strong>
                    <time>{item.meta}</time>
                  </span>
                  <span className="k1-card__sub">{item.subtitle}</span>
                </a>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : (
        <div className="k1-list__empty">{empty}</div>
      )}
    </section>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange, idBase }: {
  tabs: Array<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
  idBase: string
}) {
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.value === value)
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]
      onChange(next.value)
      requestAnimationFrame(() => document.getElementById(`${idBase}-tab-${next.value}`)?.focus())
    }
  }
  return (
    <div className="k1-tabs" role="tablist" onKeyDown={onKey}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          id={`${idBase}-tab-${tab.value}`}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          aria-controls={`${idBase}-panel`}
          tabIndex={tab.value === value ? 0 : -1}
          className={tab.value === value ? 'is-active' : undefined}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.value === value && <motion.span layoutId={`${idBase}-underline`} className="k1-tabs__line" transition={{ duration: 0.2, ease }} />}
        </button>
      ))}
    </div>
  )
}

export function DetailPane<T extends string>({ title, tabs, tab, onTab, menu, onBack, children, paneKey }: {
  title: string
  tabs: Array<{ value: T; label: string }>
  tab: T
  onTab: (value: T) => void
  menu: MenuItem[]
  onBack?: () => void
  children: ReactNode
  paneKey: string
}) {
  const idBase = useId().replace(/:/g, '')
  return (
    <section className="k1-detail" aria-label={title}>
      <header className="k1-detail__head">
        <div className="k1-detail__titlebar">
          {onBack && (
            <button type="button" className="k1-icon-btn k1-detail__back" aria-label="Back to list" onClick={onBack}>
              <ArrowLeft size={16} strokeWidth={1.75} />
            </button>
          )}
          <h2>{title}</h2>
          <Menu
            label="More actions"
            items={menu}
            trigger={(props) => (
              <button {...props} type="button" className="k1-icon-btn k1-icon-btn--boxed" aria-label="More actions">
                <MoreHorizontal size={16} strokeWidth={1.75} />
              </button>
            )}
          />
        </div>
        <Tabs tabs={tabs} value={tab} onChange={onTab} idBase={idBase} />
      </header>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${paneKey}-${tab}`}
          id={`${idBase}-panel`}
          role="tabpanel"
          aria-labelledby={`${idBase}-tab-${tab}`}
          className="k1-detail__body"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14, ease }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </section>
  )
}

export function Thread({ messages }: { messages: ThreadMessage[] }) {
  return (
    <div className="k1-thread">
      {messages.map((message) => (
        <div key={message.id} className={`k1-msg k1-msg--${message.role} k1-msg--wide`}>
          <div className="k1-msg__bubble">{message.text}</div>
        </div>
      ))}
    </div>
  )
}

export function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="k1-facts">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function MobileSwap({ showDetail, list, detail }: { showDetail: boolean; list: ReactNode; detail: ReactNode }) {
  return (
    <div className="k1-swap">
      <AnimatePresence initial={false} mode="popLayout">
        {showDetail ? (
          <motion.div key="detail" className="k1-swap__pane" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ duration: 0.26, ease }}>
            {detail}
          </motion.div>
        ) : (
          <motion.div key="list" className="k1-swap__pane" initial={{ x: '-24%', opacity: 0.6 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '-24%', opacity: 0.6 }} transition={{ duration: 0.26, ease }}>
            {list}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
