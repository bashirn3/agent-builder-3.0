import { MotionConfig } from 'motion/react'
import { useEffect, useState } from 'react'
import { EMPTY_FILTERS, type ActivityFilters } from './data/fixtures'
import { usePlayground } from './data/usePlayground'
import { ActivityPage } from './pages/ActivityPage'
import { AuthPage } from './pages/AuthPage'
import { DeployPage } from './pages/DeployPage'
import { LeadsPage } from './pages/LeadsPage'
import { ImproveSheet, type ReviseTarget } from './pages/Improve'
import { PlaygroundPage } from './pages/PlaygroundPage'
import { QnaPage } from './pages/QnaPage'
import { go, previewSession, useMedia, useRoute } from './routes'
import { Shell } from './shell/Shell'
import { ToastStack, useToasts } from './ui/controls'
import { LayerProvider } from './ui/overlay'

function Workspace({ compact }: { compact: boolean }) {
  const route = useRoute()
  const { toasts, push, dismiss } = useToasts()
  const playground = usePlayground(push)
  const [filters, setFilters] = useState<ActivityFilters>(EMPTY_FILTERS)
  const [revise, setRevise] = useState<ReviseTarget | null>(null)

  const titles: Record<string, string> = { playground: 'Playground', qna: 'Q&A', chats: 'Chat logs', leads: 'Leads', deploy: 'Deploy' }
  useEffect(() => {
    document.title = `${titles[route.page] ?? 'K1'} · K1 Katsastus`
  }, [route.page])

  let page = null
  if (route.page === 'playground') page = <PlaygroundPage store={playground} compact={compact} onRevise={setRevise} />
  else if (route.page === 'qna') page = <QnaPage store={playground} />
  else if (route.page === 'chats') page = <ActivityPage id={route.id} compact={compact} filters={filters} onFilters={setFilters} notify={push} qna={playground.draft?.additional ?? ''} onRevise={(question, answer) => setRevise({ question, answer })} />
  else if (route.page === 'leads') page = <LeadsPage id={route.id} compact={compact} notify={push} />
  else if (route.page === 'deploy') page = <DeployPage config={playground.config} dirty={playground.dirty} notify={push} />

  return (
    <>
      <Shell route={route} compact={compact}>{page}</Shell>
      <ImproveSheet
        target={revise}
        disabled={!playground.draft}
        onClose={() => setRevise(null)}
        onSubmit={(entry, target) => {
          playground.addAnswer(entry, target.messageId)
          setRevise(null)
          push({ title: 'Answer added to Q&A', body: 'The test chat uses it now. Save to agent to use it with customers.' })
        }}
      />
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
