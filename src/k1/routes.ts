import { useEffect, useState } from 'react'

export type Route =
  | { page: 'signin' }
  | { page: 'signup' }
  | { page: 'sso-callback' }
  | { page: 'playground' }
  | { page: 'compare' }
  | { page: 'chats'; id: string | null }
  | { page: 'leads'; id: string | null }
  | { page: 'calendar' }
  | { page: 'staging' }
  | { page: 'home' }
  | { page: 'liveChats'; id: string | null }
  | { page: 'liveLeads' }
  | { page: 'optimise' }
  | { page: 'control' }
  | { page: 'team' }

export type Environment = 'staging' | 'production'

const ENVIRONMENT_KEY = 'k1.environment'
const STAGING_PAGES: Route['page'][] = ['playground', 'chats', 'leads', 'compare', 'calendar', 'staging']
const PRODUCTION_PAGES: Route['page'][] = ['home', 'liveChats', 'liveLeads', 'optimise', 'control']

const modeParam = (): Environment | null => {
  if (typeof window === 'undefined') return null
  const mode = new URLSearchParams(window.location.search).get('mode')
  return mode === 'production' || mode === 'staging' ? mode : null
}

function remember(environment: Environment) {
  try { window.localStorage.setItem(ENVIRONMENT_KEY, environment) } catch { /* storage blocked */ }
}

// A link with ?mode= wins over the mode this browser used last.
export function storedEnvironment(): Environment {
  const fromLink = modeParam()
  if (fromLink) return fromLink
  try {
    return window.localStorage.getItem(ENVIRONMENT_KEY) === 'production' ? 'production' : 'staging'
  } catch {
    return 'staging'
  }
}

export const environmentOf = (page: Route['page']): Environment | null =>
  PRODUCTION_PAGES.includes(page) ? 'production' : STAGING_PAGES.includes(page) ? 'staging' : null

export const landing = (environment = storedEnvironment()): Route => ({ page: environment === 'production' ? 'home' : 'playground' })

// Keeps ?mode= in the address in step with the open page, so a copied link opens in the same mode.
function writeModeParam(environment: Environment) {
  if (modeParam() === environment) return
  const url = new URL(window.location.href)
  url.searchParams.set('mode', environment)
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

// Team is shared, so it keeps whichever mode was open last.
export function useEnvironment(route: Route): Environment {
  const implied = environmentOf(route.page)
  const [remembered, setRemembered] = useState<Environment>(storedEnvironment)
  const environment = implied ?? remembered
  useEffect(() => {
    if (implied) setRemembered(implied)
    remember(environment)
    writeModeParam(environment)
  }, [environment, implied])
  return environment
}

export function openEnvironment(environment: Environment) {
  remember(environment)
  go(landing(environment))
}

// Filters carried in the hash, for example #/live/conversations?filter=open.
export function hashQuery() {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '')
}

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean)
  switch (parts[0]) {
    case 'signup': return { page: 'signup' }
    case 'signin': return { page: 'signin' }
    case 'sso-callback': return { page: 'sso-callback' }
    case 'playground': return { page: 'playground' }
    case 'compare': return { page: 'compare' }
    case 'team': return { page: 'team' }
    case 'home': return { page: 'home' }
    case 'optimise': return { page: 'optimise' }
    case 'control': return { page: 'control' }
    case 'calendar': return { page: 'calendar' }
    case 'staging': return { page: 'staging' }
    case 'activity':
      if (parts[1] === 'leads') return { page: 'leads', id: parts[2] ?? null }
      return { page: 'chats', id: parts[2] ?? null }
    case 'live':
      if (parts[1] === 'leads') return { page: 'liveLeads' }
      return { page: 'liveChats', id: parts[2] ?? null }
    default: return parts.length ? { page: 'playground' } : landing()
  }
}

export function href(route: Route) {
  switch (route.page) {
    case 'chats': return route.id ? `#/activity/chats/${route.id}` : '#/activity/chats'
    case 'leads': return route.id ? `#/activity/leads/${route.id}` : '#/activity/leads'
    case 'liveChats': return route.id ? `#/live/conversations/${route.id}` : '#/live/conversations'
    case 'liveLeads': return '#/live/leads'
    case 'calendar': return '#/calendar'
    default: return `#/${route.page}`
  }
}

export function go(route: Route, replace = false) {
  const next = href(route)
  if (window.location.hash === next) return
  if (replace) window.history.replaceState(null, '', next)
  else window.location.hash = next
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'))
}

// Clerk hands over paths like "/#/playground"; keep them inside the hash router.
export function navigateTo(to: string, replace: boolean) {
  const url = new URL(to, window.location.href)
  if (url.origin !== window.location.origin) {
    window.location.assign(url.href)
    return
  }
  const hash = url.hash || href(landing())
  const search = url.search || window.location.search
  if (replace) window.history.replaceState(null, '', `${url.pathname}${search}${hash}`)
  else window.history.pushState(null, '', `${url.pathname}${search}${hash}`)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

export function useRoute() {
  const [route, setRoute] = useState(() => parse(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash))
    window.addEventListener('hashchange', onChange)
    window.addEventListener('popstate', onChange)
    return () => {
      window.removeEventListener('hashchange', onChange)
      window.removeEventListener('popstate', onChange)
    }
  }, [])
  return route
}

export function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const onChange = () => setMatches(list.matches)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])
  return matches
}
