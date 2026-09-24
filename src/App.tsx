import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { KeyboardEvent as ReactKeyboardEvent, ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { shouldAcceptTestReply, type ChatMessage } from './lib/refinement'
import {
  conversationFromOpener,
  createMockPlaygroundService,
  DEFAULT_MODEL,
  MODELS,
  openerPreview,
  type AgentConfig,
  type PlaygroundService,
} from './lib/playgroundService'
import { endDemoSession, hasDemoSession, parseHash, startDemoSession, writeHash, type Route } from './lib/hashRoute'
import { fade } from './lib/motion'
import { ActivityPage } from './pages/ActivityPage'
import { AuthPage } from './pages/AuthPage'
import {
  ActivityIcon,
  ArrowUpIcon,
  BoltIcon,
  ChartIcon,
  ChatIcon,
  ChevronIcon,
  BackIcon,
  ChatFabIcon,
  CloseIcon,
  DotsIcon,
  ExpandDialogIcon,
  GearIcon,
  LeadsIcon,
  MenuIcon,
  MicIcon,
  PeopleIcon,
  PlaygroundIcon,
  RefreshIcon,
  ResetIcon,
  RocketIcon,
  SearchIcon,
  SourceIcon,
} from './ui/icons'
import { Dialog, Drawer } from './ui/overlays'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type NavId = 'playground' | 'activity' | 'compare'

const service: PlaygroundService = createMockPlaygroundService()
const PRESETS = [
  { id: 'base', label: 'Base Instructions' },
  { id: 'support', label: 'Customer support agent' },
  { id: 'custom', label: 'Custom prompt' },
]

const SUPPORT_PRESET = `You are the customer-support assistant for K1 Katsastus.

Help with inspection questions, required documents, and booking handoff. Do not invent prices, deadlines, or confirmed appointments.`

type ComparePane = {
  id: string
  model: string
  composer: string
  messages: ChatMessage[]
  sending: boolean
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function useViewport() {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth))
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return { width, mobile: width < 900, compactLaptop: width >= 900 && width < 1280 }
}

function emptyConfig(): AgentConfig {
  return { instructions: '', opener: '', model: DEFAULT_MODEL }
}

function App() {
  const { mobile, compactLaptop } = useViewport()
  const [route, setRoute] = useState<Route>(() => {
    const next = parseHash(typeof window === 'undefined' ? '' : window.location.hash)
    if (typeof window !== 'undefined' && !hasDemoSession() && next.page !== 'auth') {
      return { ...next, page: 'auth', authMode: 'signup' }
    }
    return next
  })
  const [authed, setAuthed] = useState(() => typeof window !== 'undefined' && hasDemoSession())
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1280)
  const [activityOpen, setActivityOpen] = useState(() => typeof window !== 'undefined' && parseHash(window.location.hash).page === 'activity')
  const [accountOpen, setAccountOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [presetOpen, setPresetOpen] = useState(false)
  const [preset, setPreset] = useState('base')
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState<AgentConfig>(emptyConfig)
  const [draft, setDraft] = useState<AgentConfig>(emptyConfig)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState(() => uid('thread'))
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [composer, setComposer] = useState('')
  const [sending, setSending] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [compareSync, setCompareSync] = useState(true)
  const [comparePanes, setComparePanes] = useState<ComparePane[]>([])
  const accountRef = useRef<HTMLDivElement>(null)
  const savedToast = useRef<number>(0)
  const conversationIdRef = useRef(conversationId)
  const pendingRef = useRef<string | null>(null)
  conversationIdRef.current = conversationId
  const dirty = draft.instructions !== saved.instructions || draft.opener !== saved.opener || draft.model !== saved.model

  const go = (next: Route) => {
    setRoute(next)
    writeHash(next)
  }

  useEffect(() => {
    const onHash = () => {
      const next = parseHash(window.location.hash)
      if (!hasDemoSession() && next.page !== 'auth') {
        writeHash({ ...next, page: 'auth', authMode: 'signup' })
        setRoute(parseHash('#/signup'))
        return
      }
      setRoute(next)
    }
    onHash()
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    setSidebarOpen(!(mobile || compactLaptop))
  }, [mobile, compactLaptop])

  useEffect(() => {
    setActivityOpen(route.page === 'activity')
  }, [route.page])

  useEffect(() => {
    let cancelled = false
    void service.loadConfig().then((config) => {
      if (cancelled) return
      setSaved(config)
      setDraft(config)
      setConversationId(uid('thread'))
      setMessages(conversationFromOpener(config.opener, uid('msg')))
      setComparePanes([
        { id: 'pane-a', model: config.model, composer: '', messages: conversationFromOpener(config.opener, uid('msg')), sending: false },
        { id: 'pane-b', model: 'Claude 4.5 Haiku', composer: '', messages: conversationFromOpener(config.opener, uid('msg')), sending: false },
      ])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!accountOpen) return
    const onPointer = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [accountOpen])

  const updateDraft = (patch: Partial<AgentConfig>) => {
    setDraft((prev) => ({ ...prev, ...patch }))
    setSaveStatus('idle')
    setSaveError(null)
  }

  const discard = () => {
    setDraft(saved)
    setSaveStatus('idle')
    setSaveError(null)
  }

  const save = () => {
    if (!dirty || saveStatus === 'saving') return
    setSaveStatus('saving')
    setSaveError(null)
    void service.saveConfig(draft).then((next) => {
      setSaved(next)
      setDraft(next)
      setSaveStatus('saved')
      setToast('Success. Your changes are saved.')
      window.clearTimeout(savedToast.current)
      savedToast.current = window.setTimeout(() => {
        setSaveStatus('idle')
        setToast(null)
      }, 1600)
    }).catch(() => {
      setSaveStatus('error')
      setSaveError('Could not save. Your draft is still here.')
    })
  }

  const acceptReply = (responseRequestId: string, threadId: string) => shouldAcceptTestReply({
    responseRequestId,
    pendingResponseId: pendingRef.current,
    responseConversationId: threadId,
    currentConversationId: conversationIdRef.current,
  })

  const newTest = () => {
    const nextId = uid('thread')
    pendingRef.current = null
    setConversationId(nextId)
    setMessages(conversationFromOpener(saved.opener, uid('msg')))
    setComposer('')
    setSending(false)
    setReplyError(null)
  }

  const sendText = (raw: string) => {
    const text = raw.trim()
    if (!text || sending) return
    const userMessage: ChatMessage = { id: uid('msg'), role: 'user', text }
    const responseRequestId = uid('reply')
    const threadId = conversationId
    const history = [...messages, userMessage]
    pendingRef.current = responseRequestId
    setComposer('')
    setSending(true)
    setReplyError(null)
    setMessages(history)
    void service.sendTestMessage({
      conversationId: threadId,
      messages: history,
      instructions: saved.instructions,
    }).then((result) => {
      if (!acceptReply(responseRequestId, threadId)) return
      pendingRef.current = null
      setSending(false)
      setMessages((prev) => [...prev, { id: uid('msg'), role: 'agent', text: result.reply, mocked: true }])
    }).catch(() => {
      if (!acceptReply(responseRequestId, threadId)) return
      pendingRef.current = null
      setSending(false)
      setReplyError('Mocked reply failed. Your message is still in the thread.')
    })
  }

  const retryReply = () => {
    if (sending || !messages.some((message) => message.role === 'user')) return
    const responseRequestId = uid('reply')
    const threadId = conversationId
    pendingRef.current = responseRequestId
    setSending(true)
    setReplyError(null)
    void service.sendTestMessage({
      conversationId: threadId,
      messages,
      instructions: saved.instructions,
    }).then((result) => {
      if (!acceptReply(responseRequestId, threadId)) return
      pendingRef.current = null
      setSending(false)
      setMessages((prev) => [...prev, { id: uid('msg'), role: 'agent', text: result.reply, mocked: true }])
    }).catch(() => {
      if (!acceptReply(responseRequestId, threadId)) return
      pendingRef.current = null
      setSending(false)
      setReplyError('Mocked reply failed. Your message is still in the thread.')
    })
  }

  const sendCompare = (paneId: string, raw?: string) => {
    const pane = comparePanes.find((item) => item.id === paneId)
    if (!pane) return
    const text = (raw ?? pane.composer).trim()
    if (!text || pane.sending) return
    const targets = compareSync ? comparePanes : [pane]
    targets.forEach((target) => {
      const userMessage: ChatMessage = { id: uid('msg'), role: 'user', text }
      const history = [...target.messages, userMessage]
      setComparePanes((prev) => prev.map((item) => item.id === target.id
        ? { ...item, composer: '', messages: history, sending: true }
        : item))
      void service.sendTestMessage({
        conversationId: target.id,
        messages: history,
        instructions: saved.instructions,
      }).then((result) => {
        setComparePanes((prev) => prev.map((item) => item.id === target.id
          ? { ...item, sending: false, messages: [...item.messages, { id: uid('msg'), role: 'agent', text: result.reply, mocked: true }] }
          : item))
      }).catch(() => {
        setComparePanes((prev) => prev.map((item) => item.id === target.id ? { ...item, sending: false } : item))
        setToast('Mocked compare reply failed.')
      })
    })
  }

  const applyPreset = (id: string) => {
    setPreset(id)
    setPresetOpen(false)
    if (id === 'support') updateDraft({ instructions: SUPPORT_PRESET })
    if (id === 'base') updateDraft({ instructions: saved.instructions.includes('K1 Katsastus') ? saved.instructions : draft.instructions })
  }

  const enterDemo = () => {
    startDemoSession()
    setAuthed(true)
    go({ ...route, page: 'playground', authMode: 'signup', conversationId: null, editor: false, filter: false })
  }

  const signOut = () => {
    endDemoSession()
    setAuthed(false)
    setAccountOpen(false)
    go({ ...route, page: 'auth', authMode: 'signin', conversationId: null, editor: false, filter: false })
  }

  if (!authed || route.page === 'auth') {
    return (
      <AuthPage
        mode={route.authMode}
        onMode={(authMode) => go({ ...route, page: 'auth', authMode })}
        onEnter={enterDemo}
      />
    )
  }

  const inspector = (
    <Inspector
      draft={draft}
      dirty={dirty}
      saveStatus={saveStatus}
      saveError={saveError}
      loading={loading}
      modelOpen={modelOpen}
      presetOpen={presetOpen}
      preset={preset}
      onChange={updateDraft}
      onExpand={() => go({ ...route, page: 'playground', editor: true })}
      onSave={save}
      onDiscard={discard}
      onCompare={() => go({ ...route, page: 'compare' })}
      onModelOpen={setModelOpen}
      onPresetOpen={setPresetOpen}
      onPreset={applyPreset}
    />
  )

  const tester = (
    <Tester
      messages={messages}
      composer={composer}
      sending={sending}
      replyError={replyError}
      loading={loading}
      mobile={mobile}
      onComposer={setComposer}
      onSend={() => sendText(composer)}
      onRetry={retryReply}
      onNewTest={newTest}
    />
  )

  return (
    <div className={`app${mobile ? ' is-mobile' : ''}`}>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="app-header">
        {mobile || compactLaptop ? (
          <button className="icon-button" type="button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">
            <MenuIcon />
          </button>
        ) : (
          <div className="brand"><span>w</span><strong>wasup</strong></div>
        )}
        <div className="header-crumb">
          <span>Demo</span>
          <span>K1 Katsastus</span>
        </div>
        <div className="header-actions">
          {mobile && route.page === 'playground' && (
            <button className="header-quiet" type="button" onClick={() => go({ ...route, editor: true })}>
              Configure
              {dirty && <i className="pending-dot" aria-hidden="true" />}
            </button>
          )}
          <div className="header-menu" ref={accountRef}>
            <button className="account-button" type="button" aria-haspopup="menu" aria-expanded={accountOpen} onClick={() => setAccountOpen((open) => !open)}>
              <span>D</span>
              Demo
            </button>
            {accountOpen && (
              <div className="quiet-popover" role="menu">
                <p>Development session. Replies are mocked.</p>
                <button type="button" role="menuitem" onClick={() => { service.failNextSave(); setAccountOpen(false); setToast('The next Save will fail.') }}>Fail next save</button>
                <button type="button" role="menuitem" onClick={() => { service.failNextReply(); setAccountOpen(false); setToast('The next reply will fail.') }}>Fail next reply</button>
                <button type="button" role="menuitem" onClick={signOut}>Sign out</button>
              </div>
            )}
          </div>
        </div>
      </header>
      {!mobile && !compactLaptop && (
        <Sidebar
          open
          page={route.page}
          activityOpen={activityOpen}
          onActivityToggle={() => setActivityOpen((open) => !open)}
          onGo={(page) => {
            if (page === 'activity') setActivityOpen(true)
            go({ ...route, page, conversationId: page === 'activity' ? route.conversationId : null, editor: false, filter: false })
          }}
        />
      )}
      <div className="app-main">
        <main id="main" className="workspace">
          {route.page === 'activity' && (
            <ActivityPage
              conversationId={route.conversationId}
              filterOpen={route.filter}
              mobile={mobile}
              onOpen={(id) => go({ ...route, page: 'activity', conversationId: id, filter: false })}
              onFilter={(open) => go({ ...route, page: 'activity', filter: open })}
            />
          )}
          {route.page === 'compare' && (
            <CompareView
              panes={comparePanes}
              sync={compareSync}
              mobile={mobile}
              onBack={() => go({ ...route, page: 'playground' })}
              onSync={setCompareSync}
              onComposer={(id, value) => setComparePanes((prev) => prev.map((pane) => {
                if (compareSync) return { ...pane, composer: value }
                return pane.id === id ? { ...pane, composer: value } : pane
              }))}
              onModel={(id, model) => setComparePanes((prev) => prev.map((pane) => pane.id === id ? { ...pane, model } : pane))}
              onSend={sendCompare}
              onReset={() => setComparePanes((prev) => prev.map((pane) => ({
                ...pane,
                composer: '',
                sending: false,
                messages: conversationFromOpener(saved.opener, uid('msg')),
              })))}
            />
          )}
          {route.page === 'playground' && (
            <div className="playground">
              {!mobile && inspector}
              <section className="canvas" aria-label="Agent tester canvas">
                {loading ? <div className="canvas-skeleton" aria-busy="true"><span /><span /><span /></div> : tester}
              </section>
            </div>
          )}
        </main>
      </div>

      <Drawer open={(mobile || compactLaptop) && sidebarOpen} side="left" labelledBy="mobile-nav-title" onClose={() => setSidebarOpen(false)}>
        <div className="mobile-nav-panel">
          <header>
            <div className="brand"><span>w</span><strong id="mobile-nav-title">wasup</strong></div>
            <button className="icon-button" type="button" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><CloseIcon /></button>
          </header>
          <SidebarNav
            open
            page={route.page}
            activityOpen={activityOpen}
            onActivityToggle={() => setActivityOpen((open) => !open)}
            onGo={(page) => {
              setSidebarOpen(false)
              go({ ...route, page, conversationId: page === 'activity' ? route.conversationId : null, editor: false, filter: false })
            }}
          />
        </div>
      </Drawer>

      <Drawer
        open={mobile && route.page === 'playground' && route.editor}
        side="bottom"
        labelledBy="refine-title"
        onClose={() => go({ ...route, editor: false })}
      >
        <div className="refine-panel">
          <header>
            <h2 id="refine-title">Configure</h2>
            <button className="ghost-button" type="button" onClick={() => go({ ...route, editor: false })}>Done</button>
          </header>
          {inspector}
        </div>
      </Drawer>

      <Dialog
        open={!mobile && route.page === 'playground' && route.editor}
        title="Instructions"
        labelledBy="instructions-title"
        wide
        onClose={() => go({ ...route, editor: false })}
      >
        <textarea
          className="dialog-editor"
          aria-label="Instructions"
          value={draft.instructions}
          onChange={(event) => updateDraft({ instructions: event.target.value })}
        />
        <label className="stack-field dialog-opener">
          <span>Opening message</span>
          <textarea
            className="opener-input"
            aria-label="Opening message"
            value={draft.opener}
            onChange={(event) => updateDraft({ opener: event.target.value })}
          />
          <small>first_name = Rasmus · registration_number = ABC-123</small>
          <p>{openerPreview(draft.opener)}</p>
        </label>
      </Dialog>

      <span className="chat-fab" aria-hidden="true"><ChatFabIcon /></span>

      <AnimatePresence>
        {toast && (
          <motion.div className="toast" role="status" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={fade}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Sidebar({
  open,
  page,
  activityOpen,
  onActivityToggle,
  onGo,
}: {
  open: boolean
  page: Route['page']
  activityOpen: boolean
  onActivityToggle: () => void
  onGo: (page: NavId) => void
}) {
  return (
    <aside className="sidebar" aria-label="Workspace">
      <SidebarNav open={open} page={page} activityOpen={activityOpen} onActivityToggle={onActivityToggle} onGo={onGo} />
    </aside>
  )
}

function SidebarNav({
  open,
  page,
  activityOpen,
  onActivityToggle,
  onGo,
}: {
  open: boolean
  page: Route['page']
  activityOpen: boolean
  onActivityToggle: () => void
  onGo: (page: NavId) => void
}) {
  return (
    <nav className="sidebar-nav">
      <NavButton active={page === 'playground' || page === 'compare'} label="Playground" open={open} onClick={() => onGo('playground')}>
        <PlaygroundIcon />
      </NavButton>
      <div className="nav-group">
        <button type="button" className="nav-item" onClick={onActivityToggle} aria-expanded={activityOpen}>
          <ActivityIcon />
          {open && <span>Activity</span>}
          {open && <motion.i className="nav-chevron" aria-hidden="true" animate={{ rotate: activityOpen ? 180 : 0 }}><ChevronIcon /></motion.i>}
        </button>
        <AnimatePresence initial={false}>
          {open && activityOpen && (
            <motion.div
              className="nav-sub"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            >
              <button type="button" className={page === 'activity' ? 'is-active' : ''} onClick={() => onGo('activity')}>
                <ChatIcon /> Chat logs
              </button>
              <button type="button" className="is-unavailable" title="Leads has no Figma frames in this file" disabled>
                <LeadsIcon /> Leads
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <NavButton label="Analytics" open={open} unavailable />
      <NavButton label="Data sources" open={open} unavailable />
      <NavButton label="Actions" open={open} unavailable />
      <NavButton label="Contacts" open={open} unavailable />
      <NavButton label="Deploy" open={open} unavailable />
      <NavButton label="Settings" open={open} unavailable />
    </nav>
  )
}

function NavButton({
  label,
  open,
  active,
  unavailable,
  onClick,
  children,
}: {
  label: string
  open: boolean
  active?: boolean
  unavailable?: boolean
  onClick?: () => void
  children?: ReactNode
}) {
  const icon = children ?? (
    label === 'Analytics' ? <ChartIcon />
      : label === 'Data sources' ? <SourceIcon />
        : label === 'Actions' ? <BoltIcon />
          : label === 'Contacts' ? <PeopleIcon />
            : label === 'Deploy' ? <RocketIcon />
              : label === 'Settings' ? <GearIcon />
                : <PlaygroundIcon />
  )
  return (
    <button
      type="button"
      className={`nav-item${active ? ' is-active' : ''}${unavailable ? ' is-unavailable' : ''}`}
      aria-current={active ? 'page' : undefined}
      aria-disabled={unavailable || undefined}
      title={unavailable ? `${label} is not in this Figma file` : label}
      onClick={unavailable ? undefined : onClick}
    >
      {icon}
      {open && <span>{label}</span>}
    </button>
  )
}

function Inspector({
  draft,
  dirty,
  saveStatus,
  saveError,
  loading,
  modelOpen,
  presetOpen,
  preset,
  onChange,
  onExpand,
  onSave,
  onDiscard,
  onCompare,
  onModelOpen,
  onPresetOpen,
  onPreset,
}: {
  draft: AgentConfig
  dirty: boolean
  saveStatus: SaveStatus
  saveError: string | null
  loading: boolean
  modelOpen: boolean
  presetOpen: boolean
  preset: string
  onChange: (patch: Partial<AgentConfig>) => void
  onExpand: () => void
  onSave: () => void
  onDiscard: () => void
  onCompare: () => void
  onModelOpen: (open: boolean) => void
  onPresetOpen: (open: boolean) => void
  onPreset: (id: string) => void
}) {
  return (
    <section className="inspector" aria-label="Agent configuration">
      <div className="inspector-body">
        <h1>Playground</h1>
        {loading ? (
          <div className="inspector-skeleton" aria-busy="true"><span /><span /><span /></div>
        ) : (
          <>
            <div className="status-card">
              <strong><i /> Trained</strong>
              <span>Last trained 3 days ago</span>
            </div>
            <div className="compare-row">
              <span>Compare AI models</span>
              <button className="ghost-button" type="button" onClick={onCompare}>Compare</button>
            </div>
            <div className="field-block">
              <h2>Model</h2>
              <button type="button" className="select-row" onClick={() => onModelOpen(!modelOpen)} aria-expanded={modelOpen}>
                <span>{draft.model}</span>
                <ChevronIcon />
              </button>
              {modelOpen && (
                <div className="menu-card" role="listbox">
                  <div className="menu-search"><SearchIcon /><span>Search models</span></div>
                  {MODELS.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      role="option"
                      aria-selected={draft.model === model.id}
                      onClick={() => { onChange({ model: model.id }); onModelOpen(false) }}
                    >
                      <em>{model.group}</em>
                      {model.id}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="field-block">
              <h2>AI Actions</h2>
              <div className="select-row is-static">
                <span>1 Action Enabled</span>
                <ChevronIcon />
              </div>
            </div>
            <div className="field-block">
              <div className="field-label-row">
                <h2>Instructions (System prompt)</h2>
                <button className="icon-button" type="button" onClick={onExpand} aria-label="Expand instructions">
                  <ExpandDialogIcon />
                </button>
              </div>
              <div className="preset-row">
                <button type="button" className="select-row" onClick={() => onPresetOpen(!presetOpen)} aria-expanded={presetOpen}>
                  <span>{PRESETS.find((item) => item.id === preset)?.label}</span>
                  <ChevronIcon />
                </button>
                <button className="icon-button" type="button" aria-label="Refresh preset" onClick={() => onPreset(preset)}>
                  <RefreshIcon />
                </button>
              </div>
              {presetOpen && (
                <div className="menu-card">
                  {PRESETS.map((item) => (
                    <button key={item.id} type="button" onClick={() => onPreset(item.id)}>{item.label}</button>
                  ))}
                </div>
              )}
              <textarea
                className="instructions-input"
                aria-label="Instructions"
                value={draft.instructions}
                onChange={(event) => onChange({ instructions: event.target.value })}
              />
            </div>
          </>
        )}
      </div>
      {(dirty || saveStatus === 'saving' || saveError) && (
        <footer className="savebar">
          <p className={`save-copy${saveError ? ' is-error' : ' is-draft'}`} role="status">
            {saveStatus === 'saving' ? 'Saving…' : saveError ?? 'You have unsaved changes. Do you wish to save them?'}
          </p>
          <div className="savebar-actions">
            <button className="ghost-button" type="button" onClick={onDiscard} disabled={saveStatus === 'saving'}>Discard</button>
            <button className="primary-button" type="button" onClick={onSave} disabled={saveStatus === 'saving'}>
              {saveStatus === 'saving' ? 'Saving…' : saveError ? 'Retry save' : 'Save to agent'}
            </button>
          </div>
        </footer>
      )}
    </section>
  )
}

function Tester({
  messages,
  composer,
  sending,
  replyError,
  loading,
  mobile,
  onComposer,
  onSend,
  onRetry,
  onNewTest,
}: {
  messages: ChatMessage[]
  composer: string
  sending: boolean
  replyError: string | null
  loading: boolean
  mobile: boolean
  onComposer: (value: string) => void
  onSend: () => void
  onRetry: () => void
  onNewTest: () => void
}) {
  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      onSend()
    }
  }
  return (
    <div className={`tester${mobile ? ' is-mobile' : ''}`} aria-label="Agent tester">
      <header className="tester-head">
        <div className="tester-identity">
          <span className="tester-mark" aria-hidden="true">K</span>
          <strong>K1 Katsastus</strong>
        </div>
        <button className="tester-reset" type="button" onClick={onNewTest} aria-label="New test" disabled={sending}>
          <ResetIcon />
        </button>
      </header>
      <div className="messages" aria-live="polite">
        {loading && <div className="tester-skeleton" aria-busy="true"><span /><span /></div>}
        {messages.map((message) => (
          <article key={message.id} className={`message ${message.role}`}>
            <p>{message.text}</p>
            {message.mocked && <span className="mock-tag">Mocked</span>}
          </article>
        ))}
        {sending && <div className="typing" aria-label="Waiting for mocked reply"><span /><span /><span /></div>}
      </div>
      {replyError && (
        <div className="reply-error" role="status">
          <span>{replyError}</span>
          <button type="button" onClick={onRetry} disabled={sending}>Retry</button>
        </div>
      )}
      <p className="tester-credit">Powered by Wasup</p>
      <Composer value={composer} sending={sending} onChange={onComposer} onKeyDown={onKeyDown} onSend={onSend} />
    </div>
  )
}

function Composer({
  value,
  sending,
  onChange,
  onKeyDown,
  onSend,
}: {
  value: string
  sending: boolean
  onChange: (value: string) => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  onSend: () => void
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const area = areaRef.current
    if (!area) return
    const styles = getComputedStyle(area)
    const line = Number.parseFloat(styles.lineHeight) || 20
    const pad = (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0)
    const single = line + pad
    area.style.height = '0px'
    area.style.height = `${Math.min(Math.max(area.scrollHeight, single), 96)}px`
  }, [value])
  return (
    <div className="composer">
      <textarea
        ref={areaRef}
        rows={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Message…"
        aria-label="Test message"
      />
      <button className="icon-button composer-mic" type="button" tabIndex={-1} aria-hidden="true">
        <MicIcon />
      </button>
      <button className="send-button" type="button" onClick={onSend} disabled={!value.trim() || sending} aria-label="Send message">
        <ArrowUpIcon />
      </button>
    </div>
  )
}

function CompareView({
  panes,
  sync,
  mobile,
  onBack,
  onSync,
  onComposer,
  onModel,
  onSend,
  onReset,
}: {
  panes: ComparePane[]
  sync: boolean
  mobile: boolean
  onBack: () => void
  onSync: (value: boolean) => void
  onComposer: (id: string, value: string) => void
  onModel: (id: string, model: string) => void
  onSend: (id: string) => void
  onReset: () => void
}) {
  const reducedMotion = useReducedMotion()
  return (
    <div className={`compare${mobile ? ' is-mobile' : ''}`}>
      <header className="compare-head">
        <div>
          <button className="compare-back" type="button" onClick={onBack}>
            <BackIcon /> Back to Playground
          </button>
          <h1>Compare</h1>
        </div>
        <div className="compare-actions">
          <button className="ghost-button" type="button" onClick={onReset}>Clear all chats</button>
          <button className="ghost-button" type="button" onClick={onReset}>Reset</button>
          <button className="primary-button" type="button" onClick={() => {}}>Add an instance</button>
        </div>
      </header>
      <p className="visually-hidden">Side-by-side labels only. Both panes use the same mocked playground replies.</p>
      <div className="compare-grid">
        {panes.map((pane) => (
          <section key={pane.id} className="compare-pane">
            <header>
              <label>
                <span className="visually-hidden">Model</span>
                <select value={pane.model} onChange={(event) => onModel(pane.id, event.target.value)}>
                  {MODELS.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}
                </select>
              </label>
              <div className="compare-pane-tools">
                <label className="sync-toggle">
                  <span>Sync</span>
                  <input type="checkbox" checked={sync} onChange={(event) => onSync(event.target.checked)} />
                </label>
                <span className="icon-button" aria-hidden="true"><DotsIcon /></span>
              </div>
            </header>
            <div className="messages">
              {pane.messages.map((message) => (
                <article key={message.id} className={`message ${message.role}`}>
                  <p>{message.text}</p>
                  {message.mocked && <span className="mock-tag">Mocked</span>}
                </article>
              ))}
              {pane.sending && <div className="typing" aria-label="Waiting for mocked reply"><span /><span /><span /></div>}
            </div>
            <Composer
              value={pane.composer}
              sending={pane.sending}
              onChange={(value) => onComposer(pane.id, value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  onSend(pane.id)
                }
              }}
              onSend={() => onSend(pane.id)}
            />
          </section>
        ))}
      </div>
      {!reducedMotion && null}
    </div>
  )
}

export default App
