import { ReactNode, useState } from 'react'
import { motion } from 'motion/react'
import { ChevronDown, History, LogOut, Menu as MenuIcon, Play, Rocket } from 'lucide-react'
import { space } from '../../lib/motion'
import { go, href, previewSession, type Route } from '../routes'
import { Collapse, Drawer } from '../ui/overlay'
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

export function Header({ onOpenNav, compact }: { onOpenNav: () => void; compact: boolean }) {
  return (
    <header className="k1-header">
      {compact && (
        <button type="button" className="k1-icon-btn k1-header__menu" aria-label="Open navigation" onClick={onOpenNav}>
          <MenuIcon size={18} strokeWidth={1.75} />
        </button>
      )}
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
            icon: <LogOut size={14} strokeWidth={1.75} />,
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
  { key: 'chats', label: 'Chat logs', to: { page: 'chats', id: null } as Route },
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
      {link({ page: 'playground' }, route.page === 'playground', <><Play size={16} strokeWidth={1.75} />Playground</>)}
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

export function Shell({ route, compact, children }: { route: Route; compact: boolean; children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false)
  return (
    <div className="k1-app">
      <Header compact={compact} onOpenNav={() => setNavOpen(true)} />
      <div className="k1-body">
        {!compact && <aside className="k1-sidebar"><Sidebar route={route} /></aside>}
        <main className="k1-main">{children}</main>
      </div>
      <Drawer open={compact && navOpen} side="left" label="Navigation" onClose={() => setNavOpen(false)}>
        <div className="k1-drawer__head">
          <K1Mark />
          <span>K1 Katsastus</span>
        </div>
        <Sidebar route={route} onNavigate={() => setNavOpen(false)} />
      </Drawer>
    </div>
  )
}
