import { ReactNode, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ChevronDown, History, LogOut, MenuIcon, Play, Rocket, X } from '../ui/icons'
import { space } from '../../lib/motion'
import { go, href, previewSession, type Route } from '../routes'
import { Collapse, useFocusTrap } from '../ui/overlay'
import { Menu } from '../ui/controls'

export function K1Mark({ size = 24 }: { size?: number }) {
  return (
    <svg className="k1-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="currentColor" />
      <path d="M6.6 6.8h2.2v4.1l3.5-4.1h2.6l-3.6 4.1 3.8 6.3h-2.6l-2.7-4.6-1 1.1v3.5H6.6z" fill="#fff" />
      <path d="M16.2 8.9l1.9-2.1h1.5v10.4h-2.1V9.6l-1.3 1.2z" fill="#fff" />
    </svg>
  )
}

function MobileHeader({ navOpen, onToggle }: { navOpen: boolean; onToggle: () => void }) {
  return (
    <header className="k1-header k1-header--mobile">
      <a className="k1-header__brand" href={href({ page: 'playground' })} aria-label="K1 Katsastus playground">
        <K1Mark />
        <span>K1 Katsastus</span>
      </a>
      <button
        type="button"
        className="k1-icon-btn k1-header__toggle"
        aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={navOpen}
        aria-controls="k1-mobile-nav"
        onClick={onToggle}
      >
        {navOpen ? <X size={20} /> : <MenuIcon size={20} />}
      </button>
    </header>
  )
}

export function Header() {
  return (
    <header className="k1-header">
      <a className="k1-header__home" href={href({ page: 'playground' })} aria-label="K1 Katsastus playground">
        <K1Mark />
      </a>
      <nav className="k1-crumbs" aria-label="Workspace">
        <span className="k1-crumbs__sep" aria-hidden="true">/</span>
        <span className="k1-crumbs__item">K1 Katsastus</span>
        <span className="k1-crumbs__sep" aria-hidden="true">/</span>
        <span className="k1-crumbs__item">Booking agent</span>
        <span className="k1-badge">Agent</span>
      </nav>
      <div className="k1-header__end">
        <Menu
          label="Account"
          header={(
            <div className="k1-menu__header">
              <strong>Development preview</strong>
              <span>Clerk sign-in is not connected yet</span>
            </div>
          )}
          items={[{
            label: 'Sign out',
            icon: <LogOut />,
            onSelect: () => {
              previewSession.end()
              go({ page: 'signin' })
            },
          }]}
          trigger={(props) => (
            <button {...props} type="button" className="k1-avatar" aria-label="Account menu">
              <span aria-hidden="true">K1</span>
            </button>
          )}
        />
      </div>
    </header>
  )
}

const activityChildren = [
  { key: 'chats', label: 'Test chats', to: { page: 'chats', id: null } as Route },
  { key: 'leads', label: 'Leads', to: { page: 'leads', id: null } as Route },
]

export function Sidebar({ route, onNavigate }: { route: Route; onNavigate?: () => void }) {
  const inActivity = route.page === 'chats' || route.page === 'leads'
  const [activityOpen, setActivityOpen] = useState(true)
  const link = (to: Route, active: boolean, children: ReactNode, sub = false) => (
    <a
      href={href(to)}
      className={`k1-nav__item${sub ? ' k1-nav__item--sub' : ''}${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
    >
      {children}
    </a>
  )
  return (
    <nav className="k1-nav" aria-label="Main">
      {link({ page: 'playground' }, route.page === 'playground' || route.page === 'compare', <><Play className="k1-nav__play" />Playground</>)}
      <button
        type="button"
        className={`k1-nav__item${inActivity && !activityOpen ? ' is-active' : ''}`}
        aria-expanded={activityOpen}
        aria-controls="k1-nav-activity"
        onClick={() => setActivityOpen((open) => !open)}
      >
        <History size={16} strokeWidth={1.75} />
        Activity
        <motion.span className="k1-nav__chevron" animate={{ rotate: activityOpen ? 180 : 0 }} transition={space} aria-hidden="true">
          <ChevronDown size={16} strokeWidth={1.75} />
        </motion.span>
      </button>
      <Collapse open={activityOpen} id="k1-nav-activity">
        <div className="k1-nav__group">
          {activityChildren.map((child) => link(child.to, route.page === child.key, child.label, true))}
        </div>
      </Collapse>
      {link({ page: 'deploy' }, route.page === 'deploy', <><Rocket size={16} strokeWidth={1.75} />Deploy</>)}
    </nav>
  )
}

function MobileNav({ route, onClose }: { route: Route; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(panelRef, onClose)
  return (
    <div ref={panelRef} id="k1-mobile-nav" className="k1-mobile-nav" role="dialog" aria-modal="true" aria-label="Navigation">
      <div className="k1-mobile-nav__workspace">
        <strong>Booking agent</strong>
        <span>K1 Katsastus <span className="k1-badge">Agent</span></span>
      </div>
      <Sidebar route={route} onNavigate={onClose} />
      <div className="k1-mobile-nav__foot">
        <span className="k1-avatar" aria-hidden="true">K1</span>
        <span className="k1-mobile-nav__who">Development preview<small>Clerk sign-in is not connected yet</small></span>
        <button type="button" className="k1-btn k1-btn--outline k1-btn--sm" onClick={() => { previewSession.end(); go({ page: 'signin' }) }}>
          <LogOut />Sign out
        </button>
      </div>
    </div>
  )
}

export function Shell({ route, compact, children }: { route: Route; compact: boolean; children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false)
  useEffect(() => { if (!compact) setNavOpen(false) }, [compact])
  return (
    <div className="k1-app">
      {compact ? <MobileHeader navOpen={navOpen} onToggle={() => setNavOpen((open) => !open)} /> : <Header />}
      <div className="k1-body">
        {!compact && <aside className="k1-sidebar"><Sidebar route={route} /></aside>}
        <main className="k1-main">{children}</main>
      </div>
      {compact && navOpen && <MobileNav route={route} onClose={() => setNavOpen(false)} />}
    </div>
  )
}
