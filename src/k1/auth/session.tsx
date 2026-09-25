import { useAuth, useClerk, useUser } from '@clerk/react'
import { createContext, ReactNode, useContext, useMemo, useSyncExternalStore } from 'react'

export const CLERK_PUBLISHABLE_KEY = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined)?.trim() || ''
export const clerkEnabled = CLERK_PUBLISHABLE_KEY.length > 0

export type SessionUser = { name: string; email: string; initials: string; imageUrl?: string }

export type Session = {
  mode: 'clerk' | 'preview'
  ready: boolean
  signedIn: boolean
  user: SessionUser | null
  signOut: () => Promise<void>
}

const SessionContext = createContext<Session | null>(null)

export function useSession() {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession must be used inside a session provider')
  return session
}

function initials(name: string, email: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return email.slice(0, 2).toUpperCase() || 'K1'
}

function ClerkSession({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth()
  const { user } = useUser()
  const clerk = useClerk()
  const value = useMemo<Session>(() => {
    const email = user?.primaryEmailAddress?.emailAddress ?? ''
    const name = user?.fullName?.trim() || email
    return {
      mode: 'clerk',
      ready: isLoaded,
      signedIn: Boolean(isSignedIn),
      user: user ? { name, email, initials: initials(user.fullName ?? '', email), imageUrl: user.hasImage ? user.imageUrl : undefined } : null,
      signOut: () => clerk.signOut(),
    }
  }, [clerk, isLoaded, isSignedIn, user])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

const PREVIEW_KEY = 'k1-preview-session'
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

export const previewSession = {
  active: () => sessionStorage.getItem(PREVIEW_KEY) === '1',
  start: () => { sessionStorage.setItem(PREVIEW_KEY, '1'); notify() },
  end: () => { sessionStorage.removeItem(PREVIEW_KEY); notify() },
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('hashchange', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('hashchange', listener)
  }
}

function PreviewSession({ children }: { children: ReactNode }) {
  const active = useSyncExternalStore(subscribe, previewSession.active)
  const value = useMemo<Session>(() => ({
    mode: 'preview',
    ready: true,
    signedIn: active,
    user: active ? { name: 'Development preview', email: 'Clerk sign-in is not connected yet', initials: 'K1' } : null,
    signOut: async () => previewSession.end(),
  }), [active])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function SessionProvider({ children }: { children: ReactNode }) {
  return clerkEnabled ? <ClerkSession>{children}</ClerkSession> : <PreviewSession>{children}</PreviewSession>
}
