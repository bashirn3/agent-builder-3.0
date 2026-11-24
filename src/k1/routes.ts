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
  | { page: 'optimise' }
  | { page: 'control' }
  | { page: 'team' }

export type Environment = 'staging' | 'production'

const ENVIRONMENT_KEY = 'k1.environment'
const STAGING_PAGES: Route['page'][] = ['playground', 'compare', 'calendar', 'staging']
const PRODUCTION_PAGES: Route['page'][] = ['home', 'optimise', 'control']

function storedEnvironment(): Environment {
  try {
    return window.localStorage.getItem(ENVIRONMENT_KEY) === 'production' ? 'production' : 'staging'
  } catch {
    return 'staging'
  }
}

// Activity and Team belong to both environments, so they keep whichever one was open last.
export function useEnvironment(route: Route): Environment {
  const implied = PRODUCTION_PAGES.includes(route.page) ? 'production' : STAGING_PAGES.includes(route.page) ? 'staging' : null
  const [remembered, setRemembered] = useState<Environment>(storedEnvironment)
  useEffect(() => {
    if (!implied) return
    setRemembered(implied)
    try { window.localStorage.setItem(ENVIRONMENT_KEY, implied) } catch { /* storage blocked */ }
  }, [implied])
  return implied ?? remembered
}

export function openEnvironment(environment: Environment) {
  go({ page: environment === 'production' ? 'home' : 'playground' })
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
    default: return { page: 'playground' }
  }
}

export function href(route: Route) {
  switch (route.page) {
    case 'chats': return route.id ? `#/activity/chats/${route.id}` : '#/activity/chats'
    case 'leads': return route.id ? `#/activity/leads/${route.id}` : '#/activity/leads'
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
  const hash = url.hash || '#/playground'
  if (replace) window.history.replaceState(null, '', `${url.pathname}${hash}`)
  else window.history.pushState(null, '', `${url.pathname}${hash}`)
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
