import { MotionConfig } from 'motion/react'
import { useEffect, useState } from 'react'
import { EMPTY_FILTERS, type ActivityFilters } from './data/fixtures'
import { usePlayground } from './data/usePlayground'
import { ActivityPage } from './pages/ActivityPage'
import { AuthPage } from './pages/AuthPage'
import { DeployPage } from './pages/DeployPage'
import { LeadsPage } from './pages/LeadsPage'
import { PlaygroundPage } from './pages/PlaygroundPage'
import { go, previewSession, useMedia, useRoute } from './routes'
import { Shell } from './shell/Shell'
import { ToastStack, useToasts } from './ui/controls'
import { LayerProvider } from './ui/overlay'

function Workspace({ compact }: { compact: boolean }) {
  const route = useRoute()
  const { toasts, push, dismiss } = useToasts()
  const playground = usePlayground(push)
  const [filters, setFilters] = useState<ActivityFilters>(EMPTY_FILTERS)

  const titles: Record<string, string> = { playground: 'Playground', chats: 'Chat logs', leads: 'Leads', deploy: 'Deploy' }
  useEffect(() => {
    document.title = `${titles[route.page] ?? 'K1'} · K1 Katsastus`
  }, [route.page])

  let page = null
  if (route.page === 'playground') page = <PlaygroundPage store={playground} compact={compact} />
  else if (route.page === 'chats') page = <ActivityPage id={route.id} compact={compact} filters={filters} onFilters={setFilters} notify={push} />
  else if (route.page === 'leads') page = <LeadsPage id={route.id} compact={compact} notify={push} />
  else if (route.page === 'deploy') page = <DeployPage config={playground.config} dirty={playground.dirty} notify={push} />

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
  const authed = previewSession.active()
  const isAuth = route.page === 'signin' || route.page === 'signup'

  useEffect(() => {
    if (!isAuth && !authed) go({ page: 'signin' }, true)
  }, [isAuth, authed])

  return (
    <MotionConfig reducedMotion="user">
      <div className="k1">
        <LayerProvider>
          {isAuth ? <AuthPage mode={route.page as 'signin' | 'signup'} /> : authed ? <Workspace compact={compact} /> : null}
        </LayerProvider>
      </div>
    </MotionConfig>
  )
}
