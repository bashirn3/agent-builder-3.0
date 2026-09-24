export type AuthMode = 'signup' | 'signin'
export type AppPage = 'auth' | 'playground' | 'compare' | 'activity'

export type Route = {
  page: AppPage
  authMode: AuthMode
  conversationId: string | null
  editor: boolean
  filter: boolean
}

export const SESSION_KEY = 'wasup-demo-session'

const empty: Omit<Route, 'page'> = {
  authMode: 'signup',
  conversationId: null,
  editor: false,
  filter: false,
}

export function hasDemoSession() {
  return sessionStorage.getItem(SESSION_KEY) === '1'
}

export function startDemoSession() {
  sessionStorage.setItem(SESSION_KEY, '1')
}

export function endDemoSession() {
  sessionStorage.removeItem(SESSION_KEY)
}

export function parseHash(hash: string): Route {
  const raw = (hash || '').replace(/^#/, '') || '/'
  const [pathPart, queryPart] = raw.split('?')
  const params = new URLSearchParams(queryPart ?? '')
  const parts = pathPart.split('/').filter(Boolean)
  const editor = params.get('editor') === '1'
  const filter = params.get('filter') === '1'

  if (parts[0] === 'signin') return { ...empty, page: 'auth', authMode: 'signin' }
  if (parts[0] === 'signup' || parts[0] === 'auth') return { ...empty, page: 'auth', authMode: 'signup' }
  if (parts[0] === 'compare') return { ...empty, page: 'compare' }
  if (parts[0] === 'activity') {
    return {
      ...empty,
      page: 'activity',
      conversationId: parts[1] ?? null,
      filter,
    }
  }
  return { ...empty, page: 'playground', editor }
}

export function toHash(route: Route): string {
  if (route.page === 'auth') return route.authMode === 'signin' ? '#/signin' : '#/signup'
  if (route.page === 'compare') return '#/compare'
  if (route.page === 'activity') {
    const base = route.conversationId ? `#/activity/${route.conversationId}` : '#/activity'
    return route.filter ? `${base}?filter=1` : base
  }
  return route.editor ? '#/playground?editor=1' : '#/playground'
}

export function writeHash(route: Route) {
  const next = toHash(route)
  if (window.location.hash !== next) window.location.hash = next
}
