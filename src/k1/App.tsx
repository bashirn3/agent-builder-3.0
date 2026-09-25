import { MotionConfig } from 'motion/react'
import { useEffect, useState } from 'react'
import { usePlayground } from './data/usePlayground'
import { AuthPage, SsoCallbackPage } from './pages/AuthPage'
import { ComparePage } from './pages/ComparePage'
import { DeployPage } from './pages/DeployPage'
import { LeadsPage } from './pages/LeadsPage'
import { PlaygroundPage } from './pages/PlaygroundPage'
import { TeamPage } from './pages/TeamPage'
import { EMPTY_CHAT_FILTERS, TestChatsPage, type ChatFilters } from './pages/TestChatsPage'
import { useSession } from './auth/session'
import { useCopy } from './i18n'
import { go, useMedia, useRoute } from './routes'
import { Shell } from './shell/Shell'
import { ToastStack, useToasts } from './ui/controls'
import { LayerProvider } from './ui/overlay'

function Workspace({ compact }: { compact: boolean }) {
  const route = useRoute()
  const { toasts, push, dismiss } = useToasts()
  const playground = usePlayground(push)
  const [filters, setFilters] = useState<ChatFilters>(EMPTY_CHAT_FILTERS)

  const t = useCopy()
  const titles: Record<string, string> = { playground: t.nav.playground, compare: t.nav.compare, chats: t.nav.testChats, leads: t.nav.leads, deploy: t.nav.deploy, team: t.nav.team }
  useEffect(() => {
    document.title = `${titles[route.page] ?? 'A-Katsastus'} · A-Katsastus`
  }, [route.page, t])

  let page = null
  if (route.page === 'playground') page = <PlaygroundPage store={playground} compact={compact} />
  else if (route.page === 'compare') page = <ComparePage store={playground} />
  else if (route.page === 'chats') page = <TestChatsPage id={route.id} compact={compact} config={playground.config} filters={filters} onFilters={setFilters} notify={push} />
  else if (route.page === 'leads') page = <LeadsPage id={route.id} compact={compact} notify={push} onImported={playground.refreshLeads} />
  else if (route.page === 'deploy') page = <DeployPage config={playground.config} dirty={playground.dirty} notify={push} versionId={route.version} onChanged={() => void playground.refresh()} />

  else if (route.page === 'team') page = <TeamPage notify={push} />

  return (
    <>
      <Shell route={route} compact={compact}>{page}</Shell>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </>
  )
}

export default function App() {
  const route = useRoute()
  const compact = useMedia('(max-width: 900px)')
  const session = useSession()
  const authed = session.ready && session.signedIn
  const isAuth = route.page === 'signin' || route.page === 'signup'
  const isCallback = route.page === 'sso-callback'

  useEffect(() => {
    if (!session.ready || isCallback) return
    if (!isAuth && !session.signedIn) go({ page: 'signin' }, true)
    if (isAuth && session.signedIn) go({ page: 'playground' }, true)
  }, [isAuth, isCallback, session.ready, session.signedIn])

  return (
    <MotionConfig reducedMotion="user">
      <div className="k1">
        <LayerProvider>
          {isCallback
            ? <SsoCallbackPage />
            : isAuth
              ? <AuthPage mode={route.page as 'signin' | 'signup'} />
              : authed ? <Workspace compact={compact} /> : null}
        </LayerProvider>
      </div>
    </MotionConfig>
  )
}
