import { ReactNode, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { CalendarDays, Check, ChevronDown, ChevronsUpDown, Columns, Control, History, Home, LogOut, MenuIcon, Optimise, Play, Users, WhatsApp, X } from '../ui/icons'
import { space } from '../../lib/motion'
import { useSession } from '../auth/session'
import { setUiLang, useCopy, useUiLang } from '../i18n'
import { go, href, openEnvironment, productionVisible, useEnvironment, type Environment, type Route } from '../routes'
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
      <div className="k1-header__actions">
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
      </div>
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
    if (window.location.pathname === '/') go({ page: 'signin' }, true)
  }
}

const ENVIRONMENTS: Environment[] = ['staging', 'production']

function useEnvironmentLabel() {
  const t = useCopy()
  return (environment: Environment) => environment === 'production' ? t.nav.production : t.nav.staging
}

function EnvironmentMenu({ environment }: { environment: Environment }) {
  const t = useCopy()
  const label = useEnvironmentLabel()
  if (!productionVisible) return <span className="k1-crumbs__item">{label(environment)}</span>
  return (
    <Menu
      label={t.nav.environment}
      align="start"
      items={ENVIRONMENTS.map((option) => ({
        label: label(option),
        icon: option === environment ? <Check size={16} /> : <span className="k1-menu__spacer" aria-hidden="true" />,
        onSelect: () => { if (option !== environment) openEnvironment(option) },
      }))}
      trigger={(props) => (
        <button {...props} type="button" className={`k1-crumbs__switch is-${environment}`} aria-label={`${t.nav.environment}: ${label(environment)}`}>
          {label(environment)}
          <ChevronsUpDown size={14} />
        </button>
      )}
    />
  )
}

export function Header({ environment }: { environment: Environment }) {
  const t = useCopy()
  const { user } = useSession()
  const signOut = useSignOut()
  return (
    <header className="k1-header">
      <a className="k1-header__home" href={href({ page: environment === 'production' ? 'home' : 'playground' })} aria-label={t.nav.home}>
        <BrandLogo />
      </a>
      <nav className="k1-crumbs" aria-label={t.nav.workspace}>
        <span className="k1-crumbs__sep" aria-hidden="true">/</span>
        <span className="k1-crumbs__item">K1 Katsastus</span>
        <span className="k1-crumbs__sep" aria-hidden="true">/</span>
        <EnvironmentMenu environment={environment} />
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
          items={[
            { label: t.nav.team, icon: <Users size={16} />, onSelect: () => go({ page: 'team' }) },
            { label: t.nav.signOut, icon: <LogOut />, onSelect: () => { void signOut() } },
          ]}
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

export function Sidebar({ route, environment, onNavigate }: { route: Route; environment: Environment; onNavigate?: () => void }) {
  const t = useCopy()
  const inActivity = ['chats', 'leads', 'liveChats', 'liveLeads'].includes(route.page)
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
  const production = environment === 'production'
  const activityChildren: Array<{ key: Route['page']; label: string; to: Route }> = production
    ? [
      { key: 'liveChats', label: t.nav.conversations, to: { page: 'liveChats', id: null } },
      { key: 'liveLeads', label: t.nav.leads, to: { page: 'liveLeads' } },
    ]
    : [
      { key: 'chats', label: t.nav.testChats, to: { page: 'chats', id: null } },
      { key: 'leads', label: t.nav.leads, to: { page: 'leads', id: null } },
    ]
  return (
    <nav className="k1-nav" aria-label={t.nav.main}>
      {production
        ? link({ page: 'home' }, route.page === 'home', <><Home size={16} />{t.nav.homePage}</>)
        : link({ page: 'playground' }, route.page === 'playground', <><Play className="k1-nav__play" />{t.nav.playground}</>)}
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
          {activityChildren.map((child) => link(child.to, route.page === child.key, child.label, true))}
        </div>
      </Collapse>
      {production ? (
        <>
          {link({ page: 'optimise' }, route.page === 'optimise', <><Optimise size={16} />{t.nav.optimise}</>)}
          {link({ page: 'control' }, route.page === 'control', <><Control size={16} />{t.nav.control}</>)}
        </>
      ) : (
        <>
          {link({ page: 'compare' }, route.page === 'compare', <><Columns size={16} strokeWidth={1.75} />{t.nav.compare}</>)}
          {link({ page: 'calendar' }, route.page === 'calendar', <><CalendarDays size={16} strokeWidth={1.75} />{t.nav.calendar}</>)}
          {link({ page: 'staging' }, route.page === 'staging', <><WhatsApp size={16} />{t.nav.staging}</>)}
        </>
      )}
    </nav>
  )
}

function MobileNav({ route, environment, onClose }: { route: Route; environment: Environment; onClose: () => void }) {
  const t = useCopy()
  const label = useEnvironmentLabel()
  const panelRef = useRef<HTMLDivElement>(null)
  const { user } = useSession()
  const signOut = useSignOut()
  useFocusTrap(panelRef, onClose)
  return (
    <div ref={panelRef} id="k1-mobile-nav" className="k1-mobile-nav" role="dialog" aria-modal="true" aria-label={t.nav.navigation}>
      <div className="k1-mobile-nav__workspace">
        <strong>K1 Katsastus</strong>
        {productionVisible && <div className="k1-segmented" role="group" aria-label={t.nav.environment}>
          {ENVIRONMENTS.map((option) => (
            <button
              key={option}
              type="button"
              className={option === environment ? `is-active is-${option}` : undefined}
              aria-pressed={option === environment}
              onClick={() => { if (option !== environment) { openEnvironment(option); onClose() } }}
            >
              {label(option)}
            </button>
          ))}
        </div>}
      </div>
      <Sidebar route={route} environment={environment} onNavigate={onClose} />
      <div className="k1-mobile-nav__foot">
        <span className="k1-avatar" aria-hidden="true"><Avatar /></span>
        <span className="k1-mobile-nav__who">{user?.name}{user?.email && user.email !== user.name && <small>{user.email}</small>}</span>
        <a className="k1-btn k1-btn--outline k1-btn--sm" href={href({ page: 'team' })} aria-current={route.page === 'team' ? 'page' : undefined} onClick={onClose}>
          <Users size={16} />{t.nav.team}
        </a>
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
  const environment = useEnvironment(route)
  useEffect(() => { if (!compact) setNavOpen(false) }, [compact])
  return (
    <div className="k1-app">
      {compact ? <MobileHeader navOpen={navOpen} onToggle={() => setNavOpen((open) => !open)} /> : <Header environment={environment} />}
      <div className="k1-body">
        {!compact && <aside className="k1-sidebar"><Sidebar route={route} environment={environment} /></aside>}
        <main className="k1-main">{children}</main>
      </div>
      {compact && navOpen && <MobileNav route={route} environment={environment} onClose={() => setNavOpen(false)} />}
    </div>
  )
}
