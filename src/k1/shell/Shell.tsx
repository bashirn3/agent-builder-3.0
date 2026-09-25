import { ReactNode, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ChevronDown, Columns, History, LogOut, MenuIcon, Play, Rocket, Users, X } from '../ui/icons'
import { space } from '../../lib/motion'
import { useSession } from '../auth/session'
import { setUiLang, useCopy, useUiLang } from '../i18n'
import { go, href, type Route } from '../routes'
import { Collapse, useFocusTrap } from '../ui/overlay'
import { Menu } from '../ui/controls'

export function BrandLogo({ height = 22 }: { height?: number }) {
  return <img className="k1-brand-logo" src="/brand/a-katsastus-logo.jpg" alt="A-Katsastus" height={height} width={Math.round(height * 1024 / 279)} />
}

export function LangSwitch() {
  const lang = useUiLang()
  const t = useCopy()
  return (
    <div className="k1-langs" role="group" aria-label={t.common.interfaceLanguage}>
      {(['fi', 'en'] as const).map((code) => (
        <button key={code} type="button" lang={code} aria-pressed={lang === code} onClick={() => setUiLang(code)}>
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

function MobileHeader({ navOpen, onToggle }: { navOpen: boolean; onToggle: () => void }) {
  const t = useCopy()
  return (
    <header className="k1-header k1-header--mobile">
      <a className="k1-header__brand" href={href({ page: 'playground' })} aria-label={t.nav.home}>
        <BrandLogo />
      </a>
      <button
        type="button"
        className="k1-icon-btn k1-header__toggle"
        aria-label={navOpen ? t.nav.closeNavigation : t.nav.openNavigation}
        aria-expanded={navOpen}
        aria-controls="k1-mobile-nav"
        onClick={onToggle}
      >
        {navOpen ? <X size={20} /> : <MenuIcon size={20} />}
      </button>
    </header>
  )
}

function Avatar() {
  const { user } = useSession()
  return user?.imageUrl
    ? <img className="k1-avatar__img" src={user.imageUrl} alt="" referrerPolicy="no-referrer" />
    : <span aria-hidden="true">{user?.initials ?? 'K1'}</span>
}

function useSignOut() {
  const session = useSession()
  return async () => {
    await session.signOut()
    go({ page: 'signin' })
  }
}

export function Header() {
  const t = useCopy()
  const { user } = useSession()
  const signOut = useSignOut()
  return (
    <header className="k1-header">
      <a className="k1-header__home" href={href({ page: 'playground' })} aria-label={t.nav.home}>
        <BrandLogo />
      </a>
      <nav className="k1-crumbs" aria-label={t.nav.workspace}>
        <span className="k1-crumbs__sep" aria-hidden="true">/</span>
        <span className="k1-crumbs__item">K1 Katsastus</span>
        <span className="k1-crumbs__sep" aria-hidden="true">/</span>
        <span className="k1-crumbs__item">{t.nav.bookingAgent}</span>
        <span className="k1-badge">{t.nav.agent}</span>
      </nav>
      <div className="k1-header__end">
        <LangSwitch />
        <Menu
          label={t.nav.account}
          header={(
            <div className="k1-menu__header">
              <strong>{user?.name}</strong>
              {user?.email && user.email !== user.name && <span>{user.email}</span>}
            </div>
          )}
          items={[{
            label: t.nav.signOut,
            icon: <LogOut />,
            onSelect: () => { void signOut() },
          }]}
          trigger={(props) => (
            <button {...props} type="button" className="k1-avatar" aria-label={t.nav.accountMenu}>
              <Avatar />
            </button>
          )}
        />
      </div>
    </header>
  )
}

const activityChildren = [
  { key: 'chats', label: 'testChats', to: { page: 'chats', id: null } as Route },
  { key: 'leads', label: 'leads', to: { page: 'leads', id: null } as Route },
] as const

export function Sidebar({ route, onNavigate }: { route: Route; onNavigate?: () => void }) {
  const t = useCopy()
  const inActivity = route.page === 'chats' || route.page === 'leads'
  const [activityOpen, setActivityOpen] = useState(true)
  const link = (to: Route, active: boolean, children: ReactNode, sub = false) => (
    <a
      key={href(to)}
      href={href(to)}
      className={`k1-nav__item${sub ? ' k1-nav__item--sub' : ''}${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
    >
      {children}
    </a>
  )
  return (
    <nav className="k1-nav" aria-label={t.nav.main}>
      {link({ page: 'playground' }, route.page === 'playground', <><Play className="k1-nav__play" />{t.nav.playground}</>)}
      <button
        type="button"
        className={`k1-nav__item${inActivity && !activityOpen ? ' is-active' : ''}`}
        aria-expanded={activityOpen}
        aria-controls="k1-nav-activity"
        onClick={() => setActivityOpen((open) => !open)}
      >
        <History size={16} strokeWidth={1.75} />
        {t.nav.activity}
        <motion.span className="k1-nav__chevron" animate={{ rotate: activityOpen ? 180 : 0 }} transition={space} aria-hidden="true">
          <ChevronDown size={16} strokeWidth={1.75} />
        </motion.span>
      </button>
      <Collapse open={activityOpen} id="k1-nav-activity">
        <div className="k1-nav__group">
          {activityChildren.map((child) => link(child.to, route.page === child.key, t.nav[child.label], true))}
        </div>
      </Collapse>
      {link({ page: 'compare' }, route.page === 'compare', <><Columns size={16} strokeWidth={1.75} />{t.nav.compare}</>)}
      {link({ page: 'deploy' }, route.page === 'deploy', <><Rocket size={16} strokeWidth={1.75} />{t.nav.deploy}</>)}
      {link({ page: 'team' }, route.page === 'team', <><Users size={16} />{t.nav.team}</>)}
    </nav>
  )
}

function MobileNav({ route, onClose }: { route: Route; onClose: () => void }) {
  const t = useCopy()
  const panelRef = useRef<HTMLDivElement>(null)
  const { user } = useSession()
  const signOut = useSignOut()
  useFocusTrap(panelRef, onClose)
  return (
    <div ref={panelRef} id="k1-mobile-nav" className="k1-mobile-nav" role="dialog" aria-modal="true" aria-label={t.nav.navigation}>
      <div className="k1-mobile-nav__workspace">
        <strong>{t.nav.bookingAgent}</strong>
        <span>K1 Katsastus <span className="k1-badge">{t.nav.agent}</span></span>
      </div>
      <Sidebar route={route} onNavigate={onClose} />
      <div className="k1-mobile-nav__foot">
        <span className="k1-avatar" aria-hidden="true"><Avatar /></span>
        <span className="k1-mobile-nav__who">{user?.name}{user?.email && user.email !== user.name && <small>{user.email}</small>}</span>
        <button type="button" className="k1-btn k1-btn--outline k1-btn--sm" onClick={() => { void signOut() }}>
          <LogOut />{t.nav.signOut}
        </button>
      </div>
      <div className="k1-mobile-nav__lang">
        <span>{t.common.interfaceLanguage}</span>
        <LangSwitch />
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
