import { animate } from 'motion'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { KeyboardEvent as ReactKeyboardEvent, ReactNode, SVGProps, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { shouldAcceptTestReply, type ChatMessage } from './lib/refinement'
import {
  conversationFromOpener,
  createMockPlaygroundService,
  openerPreview,
  type AgentConfig,
  type PlaygroundService,
} from './lib/playgroundService'
import { ease, fade, sheetMotion, space } from './lib/motion'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type NavId = 'playground' | 'activity' | 'leads'
type LocalTab = 'overview' | 'display'

const service: PlaygroundService = createMockPlaygroundService()
const SUGGESTIONS = ['Book an inspection', 'Which station is nearest?', 'What documents do I need?']

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
  return {
    width,
    mobile: width < 900,
    compactLaptop: width >= 900 && width < 1280,
  }
}

function focusableIn(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>('button, [href], textarea, input, select')]
    .filter((node) => !node.hasAttribute('disabled') && node.tabIndex !== -1)
}

function useOverlayChrome(onClose: () => void) {
  const rootRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !rootRef.current) return
      const nodes = focusableIn(rootRef.current)
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      previous?.focus?.()
    }
  }, [])
  return rootRef
}

function App() {
  const { mobile, compactLaptop } = useViewport()
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1280)
  const [accountOpen, setAccountOpen] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [refineOpen, setRefineOpen] = useState(false)
  const [tab, setTab] = useState<LocalTab>('overview')
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [openerOpen, setOpenerOpen] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState<AgentConfig>({ instructions: '', opener: '' })
  const [draft, setDraft] = useState<AgentConfig>({ instructions: '', opener: '' })
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState(() => uid('thread'))
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [composer, setComposer] = useState('')
  const [sending, setSending] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const accountRef = useRef<HTMLDivElement>(null)
  const versionsRef = useRef<HTMLDivElement>(null)
  const savedToast = useRef<number>(0)
  const conversationIdRef = useRef(conversationId)
  const pendingRef = useRef<string | null>(null)
  conversationIdRef.current = conversationId
  const dirty = draft.instructions !== saved.instructions || draft.opener !== saved.opener
  const hasUserTurn = messages.some((message) => message.role === 'user')

  useEffect(() => {
    if (mobile || compactLaptop) setSidebarOpen(false)
  }, [mobile, compactLaptop])

  useEffect(() => {
    if (!mobile) setRefineOpen(false)
  }, [mobile])

  useEffect(() => {
    let cancelled = false
    void service.loadConfig().then((config) => {
      if (cancelled) return
      setSaved(config)
      setDraft(config)
      setConversationId(uid('thread'))
      setMessages(conversationFromOpener(config.opener, uid('msg')))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!accountOpen && !versionsOpen) return
    const onPointer = (event: MouseEvent) => {
      if (accountOpen && !accountRef.current?.contains(event.target as Node)) setAccountOpen(false)
      if (versionsOpen && !versionsRef.current?.contains(event.target as Node)) setVersionsOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAccountOpen(false)
        setVersionsOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [accountOpen, versionsOpen])

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
      window.clearTimeout(savedToast.current)
      savedToast.current = window.setTimeout(() => setSaveStatus('idle'), 1600)
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

  const inspector = (
    <Inspector
      tab={tab}
      draft={draft}
      dirty={dirty}
      saveStatus={saveStatus}
      saveError={saveError}
      openerOpen={openerOpen}
      loading={loading}
      onTab={setTab}
      onToggleOpener={() => setOpenerOpen((open) => !open)}
      onChange={updateDraft}
      onExpand={() => setInstructionsOpen(true)}
      onSave={save}
      onDiscard={discard}
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
      showSuggestions={!hasUserTurn}
      onComposer={setComposer}
      onSend={() => sendText(composer)}
      onSuggest={sendText}
      onRetry={retryReply}
      onNewTest={newTest}
    />
  )

  return (
    <div className={`app${mobile ? ' is-mobile' : ''}${sidebarOpen ? ' sidebar-open' : ' sidebar-collapsed'}`}>
      <a className="skip-link" href="#playground">Skip to playground</a>
      {!mobile && (
        <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen((open) => !open)} />
      )}
      <div className="app-main">
        <header className="app-header">
          {mobile && (
            <button className="icon-button" type="button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">
              <MenuIcon />
            </button>
          )}
          <div className="header-agent">
            <strong>K1 Katsastus</strong>
          </div>
          <div className="header-actions">
            {mobile && (
              <button className="header-quiet" type="button" onClick={() => setRefineOpen(true)}>
                Refine
                {dirty && <i className="pending-dot" aria-hidden="true" />}
              </button>
            )}
            <div className="header-menu" ref={versionsRef}>
              <button className="header-quiet" type="button" aria-expanded={versionsOpen} onClick={() => setVersionsOpen((open) => !open)}>
                Versions
              </button>
              {versionsOpen && (
                <div className="quiet-popover" role="menu">
                  <p>Current saved configuration</p>
                  <button type="button" role="menuitem" disabled>Active</button>
                </div>
              )}
            </div>
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
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="playground" className="playground">
          {!mobile && inspector}
          <section className="canvas" aria-label="Agent tester canvas">
            {loading ? <div className="canvas-skeleton" aria-busy="true"><span /><span /><span /></div> : tester}
          </section>
        </main>
      </div>

      <AnimatePresence>
        {mobile && sidebarOpen && (
          <MobileNav
            onClose={() => setSidebarOpen(false)}
            onFailSave={() => { service.failNextSave(); setSidebarOpen(false); setToast('The next Save will fail.') }}
            onFailReply={() => { service.failNextReply(); setSidebarOpen(false); setToast('The next reply will fail.') }}
          />
        )}
      </AnimatePresence>

      {mobile && refineOpen && (
        <RefineOverlay onClose={() => setRefineOpen(false)}>
          {inspector}
        </RefineOverlay>
      )}

      {instructionsOpen && (
        <InstructionsDialog
          value={draft.instructions}
          onChange={(instructions) => updateDraft({ instructions })}
          onClose={() => setInstructionsOpen(false)}
        />
      )}

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

function Sidebar({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <aside
      className="sidebar"
      aria-label="Workspace"
    >
      <div className="sidebar-top">
        {open && <div className="brand"><span>w</span><strong>wasup</strong></div>}
        <button className="icon-button" type="button" onClick={onToggle} aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}>
          {open ? <CollapseIcon /> : <ExpandIcon />}
        </button>
      </div>
      {open && (
        <div className="sidebar-agent">
          <span className="agent-avatar" aria-hidden="true">K</span>
          <div>
            <strong>K1 Katsastus</strong>
            <em>Workspace</em>
          </div>
        </div>
      )}
      <nav className="sidebar-nav">
        <NavItem id="playground" label="Playground" open={open} active />
        <NavItem id="activity" label="Activity" open={open} unavailable />
        <NavItem id="leads" label="Leads" open={open} unavailable />
      </nav>
    </aside>
  )
}

function NavItem({ id, label, active, unavailable, open }: {
  id: NavId
  label: string
  active?: boolean
  unavailable?: boolean
  open: boolean
}) {
  return (
    <button
      type="button"
      className={`nav-item${active ? ' is-active' : ''}${unavailable ? ' is-unavailable' : ''}`}
      aria-current={active ? 'page' : undefined}
      aria-disabled={unavailable || undefined}
      title={unavailable ? `${label} is not available in this milestone` : label}
    >
      <NavIcon id={id} />
      {open && <span>{label}</span>}
    </button>
  )
}

function MobileNav({ onClose, onFailSave, onFailReply }: {
  onClose: () => void
  onFailSave: () => void
  onFailReply: () => void
}) {
  const reducedMotion = useReducedMotion()
  const rootRef = useOverlayChrome(onClose)
  const closeRef = useRef<HTMLButtonElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  useEffect(() => { closeRef.current?.focus() }, [])
  useLayoutEffect(() => {
    const backdrop = backdropRef.current
    const panel = panelRef.current
    if (!backdrop || !panel || reducedMotion) return
    animate(backdrop, { opacity: [0, 1] }, fade)
    animate(panel, { transform: ['translateX(-16px)', 'translateX(0px)'] }, sheetMotion)
  }, [reducedMotion])
  return (
    <div ref={rootRef} className="mobile-nav" role="presentation">
      <div ref={backdropRef} className="overlay-backdrop" aria-hidden="true" onClick={onClose} />
      <aside ref={panelRef} className="mobile-nav-panel" role="dialog" aria-modal="true" aria-labelledby="mobile-nav-title">
        <header>
          <div className="brand"><span>w</span><strong id="mobile-nav-title">wasup</strong></div>
          <button ref={closeRef} className="icon-button" type="button" onClick={onClose} aria-label="Close navigation"><CloseIcon /></button>
        </header>
        <nav>
          <NavItem id="playground" label="Playground" open active />
          <NavItem id="activity" label="Activity" open unavailable />
          <NavItem id="leads" label="Leads" open unavailable />
        </nav>
        <div className="mobile-nav-foot">
          <p>Demo</p>
          <button type="button" className="ghost-button" onClick={onFailSave}>Fail next save</button>
          <button type="button" className="ghost-button" onClick={onFailReply}>Fail next reply</button>
        </div>
      </aside>
    </div>
  )
}

function Inspector({ tab, draft, dirty, saveStatus, saveError, openerOpen, loading, onTab, onToggleOpener, onChange, onExpand, onSave, onDiscard }: {
  tab: LocalTab
  draft: AgentConfig
  dirty: boolean
  saveStatus: SaveStatus
  saveError: string | null
  openerOpen: boolean
  loading: boolean
  onTab: (tab: LocalTab) => void
  onToggleOpener: () => void
  onChange: (patch: Partial<AgentConfig>) => void
  onExpand: () => void
  onSave: () => void
  onDiscard: () => void
}) {
  const preview = openerPreview(draft.opener)
  return (
    <section className="inspector" aria-label="Agent configuration">
      <div className="local-tabs" role="tablist" aria-label="Playground sections">
        <button type="button" role="tab" aria-selected={tab === 'overview'} className={tab === 'overview' ? 'is-active' : ''} onClick={() => onTab('overview')}>Overview</button>
        <button type="button" role="tab" aria-selected={tab === 'display'} className={tab === 'display' ? 'is-active' : ''} onClick={() => onTab('display')}>Display</button>
      </div>
      <div className="inspector-body">
        {loading ? (
          <div className="inspector-skeleton" aria-busy="true"><span /><span /><span /></div>
        ) : tab === 'overview' ? (
          <div className="field-block">
            <div className="field-label-row">
              <h2>Instructions</h2>
            </div>
            <p className="field-help">These instructions apply to this agent.</p>
            <div className="editor-shell">
              <div className="editor-toolbar">
                <button className="icon-button toolbar-expand" type="button" onClick={onExpand} aria-label="Expand instructions">
                  <ExpandDialogIcon />
                </button>
              </div>
              <textarea
                className="instructions-input"
                aria-label="Instructions"
                value={draft.instructions}
                onChange={(event) => onChange({ instructions: event.target.value })}
              />
            </div>
          </div>
        ) : (
          <Accordion id="opening-message" title="Opening message" open={openerOpen} onToggle={onToggleOpener}>
            <label className="stack-field">
              <span>Message template</span>
              <textarea
                className="opener-input"
                aria-label="Opening message"
                value={draft.opener}
                onChange={(event) => onChange({ opener: event.target.value })}
              />
            </label>
            <div className="opener-preview">
              <span>Sample preview</span>
              <small>first_name = Rasmus · registration_number = ABC-123</small>
              {preview ? <p>{preview}</p> : <p className="empty-preview">No opening message is saved.</p>}
            </div>
          </Accordion>
        )}
      </div>
      <footer className="savebar">
        <p className={`save-copy${saveStatus === 'error' ? ' is-error' : dirty ? ' is-draft' : saveStatus === 'saved' ? ' is-saved' : ''}`} role="status">
          {saveStatus === 'saving'
            ? 'Saving…'
            : saveError
              ? saveError
              : dirty
                ? 'You have unsaved changes.'
                : saveStatus === 'saved'
                  ? 'Saved'
                  : ''}
        </p>
        <div className="savebar-actions">
          <button className="ghost-button" type="button" onClick={onDiscard} disabled={!dirty || saveStatus === 'saving'}>Discard</button>
          <button className="primary-button" type="button" onClick={onSave} disabled={!dirty || saveStatus === 'saving'}>
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Retry save' : 'Save'}
          </button>
        </div>
      </footer>
    </section>
  )
}

function Tester({ messages, composer, sending, replyError, loading, mobile, showSuggestions, onComposer, onSend, onSuggest, onRetry, onNewTest }: {
  messages: ChatMessage[]
  composer: string
  sending: boolean
  replyError: string | null
  loading: boolean
  mobile: boolean
  showSuggestions: boolean
  onComposer: (value: string) => void
  onSend: () => void
  onSuggest: (value: string) => void
  onRetry: () => void
  onNewTest: () => void
}) {
  const reducedMotion = useReducedMotion()
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
      {showSuggestions && !sending && (
        <div className="chips">
          {SUGGESTIONS.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => onSuggest(suggestion)}>{suggestion}</button>
          ))}
        </div>
      )}
      {replyError && (
        <div className="reply-error" role="status">
          <span>{replyError}</span>
          <button type="button" onClick={onRetry} disabled={sending}>Retry</button>
        </div>
      )}
      <p className="tester-credit">Agent tester</p>
      <Composer value={composer} sending={sending} onChange={onComposer} onKeyDown={onKeyDown} onSend={onSend} />
      {!reducedMotion && null}
    </div>
  )
}

function Composer({ value, sending, onChange, onKeyDown, onSend }: {
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
      <button className="send-button" type="button" onClick={onSend} disabled={!value.trim() || sending} aria-label="Send message">
        <ArrowUpIcon />
      </button>
    </div>
  )
}

function Accordion({ id, title, open, onToggle, children }: {
  id: string
  title: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const reducedMotion = useReducedMotion()
  const [clip, setClip] = useState(!open)
  const buttonId = `${id}-toggle`
  const panelId = `${id}-panel`
  return (
    <section className={`accordion${open ? ' is-open' : ''}`}>
      <button id={buttonId} type="button" className="accordion-toggle" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
        {title}
        <motion.span className="accordion-chevron" aria-hidden="true" animate={{ rotate: open ? 180 : 0 }} transition={reducedMotion ? { duration: 0 } : space}>
          <ChevronIcon />
        </motion.span>
      </button>
      <motion.div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        initial={false}
        animate={open ? 'open' : 'closed'}
        variants={{ open: { height: 'auto', opacity: 1 }, closed: { height: 0, opacity: 0 } }}
        transition={reducedMotion ? { duration: 0 } : { height: space, opacity: { duration: 0.18, ease } }}
        style={{ overflow: clip ? 'hidden' : 'visible' }}
        onAnimationStart={() => setClip(true)}
        onAnimationComplete={() => { if (open) setClip(false) }}
        {...(open ? {} : { inert: true })}
      >
        <div className="accordion-body">{children}</div>
      </motion.div>
    </section>
  )
}

function InstructionsDialog({ value, onChange, onClose }: {
  value: string
  onChange: (value: string) => void
  onClose: () => void
}) {
  const reducedMotion = useReducedMotion()
  const rootRef = useOverlayChrome(onClose)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { areaRef.current?.focus() }, [])
  return (
    <motion.div className="dialog-root" ref={rootRef} initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={reducedMotion ? { duration: 0 } : fade}>
      <div className="overlay-backdrop" aria-hidden="true" onClick={onClose} />
      <motion.div
        className="instructions-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="instructions-title"
        initial={reducedMotion ? false : { scale: 0.95 }}
        animate={{ scale: 1 }}
        transition={reducedMotion ? { duration: 0 } : { duration: 0.2, ease }}
      >
        <header>
          <h2 id="instructions-title">Instructions</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close instructions"><CloseIcon /></button>
        </header>
        <textarea ref={areaRef} aria-label="Instructions" value={value} onChange={(event) => onChange(event.target.value)} />
      </motion.div>
    </motion.div>
  )
}

function RefineOverlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const reducedMotion = useReducedMotion()
  const rootRef = useOverlayChrome(onClose)
  const closeRef = useRef<HTMLButtonElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => { closeRef.current?.focus() }, [])
  useLayoutEffect(() => {
    const backdrop = backdropRef.current
    const panel = panelRef.current
    if (!backdrop || !panel || reducedMotion) return
    animate(backdrop, { opacity: [0, 1] }, fade)
    animate(panel, { transform: ['translateY(16px)', 'translateY(0px)'] }, sheetMotion)
  }, [reducedMotion])
  return (
    <div ref={rootRef} className="refine-overlay">
      <div ref={backdropRef} className="overlay-backdrop" aria-hidden="true" onClick={onClose} />
      <div ref={panelRef} className="refine-panel" role="dialog" aria-modal="true" aria-labelledby="refine-title">
        <header>
          <h2 id="refine-title">Refine</h2>
          <button ref={closeRef} className="ghost-button" type="button" onClick={onClose}>Done</button>
        </header>
        {children}
      </div>
    </div>
  )
}

function Svg(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" {...props} />
}

function ChevronIcon() { return <Svg><path d="M4 6.25 8 10l4-3.75" /></Svg> }
function CloseIcon() { return <Svg><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></Svg> }
function ArrowUpIcon() { return <Svg><path d="M8 13V4M8 4 4.4 7.6M8 4l3.6 3.6" /></Svg> }
function MenuIcon() { return <Svg><path d="M3 4.5h10M3 8h10M3 11.5h10" /></Svg> }
function CollapseIcon() { return <Svg><path d="M10.5 3.5 6 8l4.5 4.5" /></Svg> }
function ExpandIcon() { return <Svg><path d="M5.5 3.5 10 8 5.5 12.5" /></Svg> }
function ExpandDialogIcon() { return <Svg><path d="M6 3.5H3.5V6M10 3.5h2.5V6M6 12.5H3.5V10M10 12.5h2.5V10" /></Svg> }
function ResetIcon() { return <Svg><path d="M12.2 8A4.2 4.2 0 1 1 8 3.8h1.4M9.4 2.4 11.2 3.8 9.4 5.2" /></Svg> }
function PlaygroundIcon() { return <Svg><path d="M4.2 3.6 12 8 4.2 12.4z" /></Svg> }
function ActivityIcon() { return <Svg><path d="M3.2 10.8 6 7.4l2.2 2.4 4.6-5.6" /></Svg> }
function LeadsIcon() { return <Svg><circle cx="6.2" cy="6" r="2" /><path d="M3.4 12.4c.4-2 1.8-3 2.8-3s2.4 1 2.8 3" /></Svg> }

function NavIcon({ id }: { id: NavId }) {
  if (id === 'activity') return <ActivityIcon />
  if (id === 'leads') return <LeadsIcon />
  return <PlaygroundIcon />
}

export default App
