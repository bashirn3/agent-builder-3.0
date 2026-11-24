import { ReactNode, useCallback, useEffect, useRef, useState, type DependencyList } from 'react'
import { motion } from 'motion/react'
import { ease } from '../../../lib/motion'
import { ProdError, type ConversationStatus, type Delivery, type LeadStatus, type NeedsYou, type Step } from '../../data/prodApi'
import { copy, locale, useCopy } from '../../i18n'
import { href, type Route } from '../../routes'
import { RefreshCw } from '../../ui/icons'
import { Skeleton } from '../../ui/controls'
import { SampleBadge } from '../SplitView'

export const POLL_MS = 30_000
export const ZONE = 'Europe/Helsinki'

export const PILOT_STATIONS = ['Mikkeli Pitkäjärvi', 'Salo Meriniitty', 'Rauma Papinhaka', 'Kemi Karjalahti']

const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'

function asProdError(failure: unknown) {
  if (failure instanceof ProdError) return failure
  return new ProdError(failure instanceof Error ? failure.message : 'request_failed')
}

// Loads one production endpoint. With poll, it reloads quietly every 30 seconds while the tab is visible.
export function useProdData<T>(load: (signal: AbortSignal) => Promise<T>, deps: DependencyList, poll = false) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ProdError | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const loadRef = useRef(load)
  loadRef.current = load
  const controller = useRef<AbortController | null>(null)

  const run = useCallback((mode: 'load' | 'refresh' | 'quiet') => {
    if (mode === 'quiet' && controller.current && !controller.current.signal.aborted) return
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    if (mode === 'load') setLoading(true)
    if (mode === 'refresh') setRefreshing(true)
    loadRef.current(current.signal)
      .then((value) => {
        if (current.signal.aborted) return
        setData(value)
        setError(null)
      })
      .catch((failure: unknown) => {
        if (current.signal.aborted) return
        if (mode !== 'quiet') setError(asProdError(failure))
      })
      .finally(() => {
        if (controller.current === current) controller.current = null
        if (current.signal.aborted) return
        setLoading(false)
        setRefreshing(false)
      })
  }, [])

  useEffect(() => {
    run('load')
    return () => controller.current?.abort()
  }, deps)

  useEffect(() => {
    if (!poll) return
    const timer = window.setInterval(() => { if (visible()) run('quiet') }, POLL_MS)
    const onVisible = () => { if (visible()) run('quiet') }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [poll, run])

  return { data, setData, error, loading: loading && !data, refreshing, reload: () => run('refresh') }
}

export function prodMessage(error: ProdError) {
  const t = copy().prod.errors
  if (error.code === 'signin_required') return t.signin
  if (error.code === 'team_required') return t.team
  if (error.code === 'admin_required') return t.admin
  if (error.code === 'network_failed') return t.network
  if (error.code === 'not_found') return t.notFound
  if (error.code.startsWith('invalid_')) return t.invalid
  return t.generic(error.code)
}

export function ErrorState({ error, onRetry }: { error: ProdError; onRetry: () => void }) {
  const t = useCopy()
  const access = error.code === 'signin_required' || error.code === 'team_required'
  return (
    <div className="k1-table__empty k1-prod-state" role="alert">
      <strong>{prodMessage(error)}</strong>
      {access ? (
        error.code === 'signin_required' && <a className="k1-btn k1-btn--outline k1-btn--sm" href={href({ page: 'signin' })}>{t.prod.signInAgain}</a>
      ) : (
        <button type="button" className="k1-btn k1-btn--outline k1-btn--sm" onClick={onRetry}>{t.common.tryAgain}</button>
      )}
    </div>
  )
}

export function EmptyState({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="k1-table__empty k1-prod-state">
      <strong>{title}</strong>
      {body && <p>{body}</p>}
      {children}
    </div>
  )
}

export function RefreshButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  const t = useCopy()
  const [turns, setTurns] = useState(0)
  return (
    <button type="button" className="k1-icon-btn k1-icon-btn--boxed k1-icon-btn--lg" aria-label={t.common.refresh} aria-busy={busy} onClick={() => { setTurns((value) => value + 1); onClick() }}>
      <motion.span animate={{ rotate: turns * 360 }} transition={{ duration: 0.5, ease }} style={{ display: 'inline-flex' }}><RefreshCw size={16} strokeWidth={1.75} /></motion.span>
    </button>
  )
}

export function ProdHead({ title, sample, onRefresh, refreshing, children }: { title: string; sample: boolean; onRefresh: () => void; refreshing: boolean; children?: ReactNode }) {
  const t = useCopy()
  return (
    <header className="k1-page__head k1-prod-head">
      <h1 className="k1-page-title">{title}</h1>
      {sample && <SampleBadge />}
      <span className="k1-prod-head__zone">{t.prod.zone}</span>
      <div className="k1-prod-head__end">
        {children}
        <RefreshButton onClick={onRefresh} busy={refreshing} />
      </div>
    </header>
  )
}

export function CardsSkeleton({ cards = 4 }: { cards?: number }) {
  const t = useCopy()
  return (
    <div className="k1-prod-grid" role="status" aria-label={t.common.loading}>
      {Array.from({ length: cards }, (_, index) => (
        <div key={index} className="k1-prod-card">
          <Skeleton height={14} width="40%" />
          <Skeleton height={28} width="60%" />
          <Skeleton height={12} width="80%" />
        </div>
      ))}
    </div>
  )
}

export function Card({ title, aside, children, className }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`k1-prod-card${className ? ` ${className}` : ''}`}>
      {(title || aside) && (
        <header className="k1-prod-card__head">
          {title && <h2 className="k1-section-title">{title}</h2>}
          {aside}
        </header>
      )}
      {children}
    </section>
  )
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="k1-prod-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  )
}

export function Bars({ bars, legend, label }: { bars: Array<{ key: string; label: string; values: number[] }>; legend?: string[]; label: string }) {
  const top = Math.max(1, ...bars.map((bar) => bar.values.reduce((sum, value) => sum + value, 0)))
  return (
    <figure className="k1-bars" aria-label={label}>
      <div className="k1-bars__plot">
        {bars.map((bar) => {
          const total = bar.values.reduce((sum, value) => sum + value, 0)
          return (
            <div key={bar.key} className="k1-bars__col" title={`${bar.label}: ${bar.values.join(' + ')}`}>
              <span className="k1-bars__value">{total}</span>
              <div className="k1-bars__stack" style={{ height: `${(total / top) * 100}%` }}>
                {bar.values.map((value, index) => <span key={index} className={`k1-bars__seg k1-bars__seg--${index}`} style={{ flexGrow: value }} />)}
              </div>
              <span className="k1-bars__label">{bar.label}</span>
            </div>
          )
        })}
      </div>
      {legend && (
        <figcaption className="k1-bars__legend">
          {legend.map((item, index) => <span key={item}><i className={`k1-bars__seg--${index}`} />{item}</span>)}
        </figcaption>
      )}
    </figure>
  )
}

export function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(locale(), { timeZone: ZONE, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function fmtClock(iso: string) {
  return new Date(iso).toLocaleTimeString(locale(), { timeZone: ZONE, hour: '2-digit', minute: '2-digit' })
}

// Dates without a time (deadlines, week starts) are calendar days, so they are shown as written.
export function fmtDay(day: string | null | undefined, withYear = false) {
  if (!day) return '—'
  return new Date(`${day.slice(0, 10)}T12:00:00Z`).toLocaleDateString(locale(), { timeZone: 'UTC', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) })
}

export function fmtRate(rate: number | null | undefined) {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return '—'
  return `${(rate * 100).toLocaleString(locale(), { maximumFractionDigits: 1 })} %`
}

export function fmtUplift(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const points = (value * 100).toLocaleString(locale(), { maximumFractionDigits: 1, signDisplay: 'always' })
  return copy().prod.points(points)
}

export const fmtNum = (value: number) => value.toLocaleString(locale())

export function StatusTag({ status }: { status: ConversationStatus | LeadStatus }) {
  const t = useCopy()
  return <span className={`k1-status k1-status--live-${status.replace(/_/g, '-')}`}>{t.prod.status[status] ?? status}</span>
}

export function DeliveryTag({ delivery }: { delivery: Delivery }) {
  const t = useCopy()
  return <span className={`k1-delivery k1-delivery--${delivery}`}>{t.prod.delivery[delivery] ?? delivery}</span>
}

export const stepLabel = (step: Step) => copy().prod.steps[step] ?? step

// Titles arrive in English; known kinds are rebuilt from the count in the title so Finnish reads naturally.
export function needsTitle(item: NeedsYou) {
  const count = item.title.match(/\d+/)?.[0]
  const phrase = copy().prod.home.needs[item.kind]
  return phrase && count ? phrase(Number(count)) : item.title
}

export function needsHref(link: string) {
  const [target, query] = link.split('?')
  const routes: Record<string, Route> = {
    control: { page: 'control' },
    conversations: { page: 'liveChats', id: null },
    leads: { page: 'liveLeads' },
    optimise: { page: 'optimise' },
  }
  const base = href(routes[target] ?? { page: 'home' })
  return query ? `${base}?${query}` : base
}

export function useDebounced<T>(value: T, ms = 300) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(timer)
  }, [value, ms])
  return settled
}
