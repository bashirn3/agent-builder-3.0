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
import { backdropVariants, dialogVariants, ease, fade, sheetMotion, space } from './lib/motion'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type NavId = 'playground' | 'activity' | 'leads'

const service: PlaygroundService = createMockPlaygroundService()

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
  const [refineOpen, setRefineOpen] = useState(false)
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
  const [pendingResponseId, setPendingResponseId] = useState<string | null>(null)
  const [replyError, setReplyError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const accountRef = useRef<HTMLDivElement>(null)
  const savedToast = useRef<number>(0)
  const conversationIdRef = useRef(conversationId)
  const pendingRef = useRef<string | null>(null)
  conversationIdRef.current = conversationId
  const dirty = draft.instructions !== saved.instructions || draft.opener !== saved.opener

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

  const showToast = (value: string) => {
    setToast(value)
    window.setTimeout(() => setToast(null), 2200)
  }

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
    setPendingResponseId(null)
    setReplyError(null)
  }

  const sendMessage = () => {
    const text = composer.trim()
    if (!text || sending) return
    const userMessage: ChatMessage = { id: uid('msg'), role: 'user', text }
    const responseRequestId = uid('reply')
    const threadId = conversationId
    const history = [...messages, userMessage]
    pendingRef.current = responseRequestId
    setComposer('')
    setSending(true)
    setPendingResponseId(responseRequestId)
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
      setPendingResponseId(null)
      setReplyError(null)
      setMessages((prev) => [...prev, { id: uid('msg'), role: 'agent', text: result.reply, mocked: true }])
    }).catch(() => {
      if (!acceptReply(responseRequestId, threadId)) return
      pendingRef.current = null
      setSending(false)
      setPendingResponseId(null)
      setReplyError('Mocked reply failed. Your message is still in the thread.')
    })
  }

  const retryReply = () => {
    if (sending) return
    if (![...messages].reverse().find((message) => message.role === 'user')) return
    const responseRequestId = uid('reply')
    const threadId = conversationId
    pendingRef.current = responseRequestId
    setSending(true)
    setPendingResponseId(responseRequestId)
    setReplyError(null)
    void service.sendTestMessage({
      conversationId: threadId,
      messages,
      instructions: saved.instructions,
    }).then((result) => {
      if (!acceptReply(responseRequestId, threadId)) return
      pendingRef.current = null
      setSending(false)
      setPendingResponseId(null)
      setMessages((prev) => [...prev, { id: uid('msg'), role: 'agent', text: result.reply, mocked: true }])
    }).catch(() => {
      if (!acceptReply(responseRequestId, threadId)) return
      pendingRef.current = null
      setSending(false)
      setPendingResponseId(null)
      setReplyError('Mocked reply failed. Your message is still in the thread.')
    })
  }

  const inspector = (
    <Inspector
      draft={draft}
      dirty={dirty}
      saveStatus={saveStatus}
      saveError={saveError}
      openerOpen={openerOpen}
      openerDirty={draft.opener !== saved.opener}
      loading={loading}
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
      dirty={dirty}
      loading={loading}
      mobile={mobile}
      onComposer={setComposer}
      onSend={sendMessage}
      onRetry={retryReply}
      onNewTest={newTest}
    />
  )

  return (
    <div className={`app${mobile ? ' is-mobile' : ''}${sidebarOpen ? ' sidebar-open' : ' sidebar-collapsed'}`}>
      <a className="skip-link" href="#playground">Skip to playground</a>
      <p className="prototype-banner">Development prototype · replies are mocked · nothing is sent to customers</p>
      {!mobile && (
        <Sidebar
          open={sidebarOpen}
          onToggle={() => setSidebarOpen((open) => !open)}
        />
      )}
      <div className="app-main">
        <header className="app-header">
          {mobile && (
            <button className="icon-button" type="button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">
              <MenuIcon />
            </button>
          )}
          <div className="agent-lockup">
            <span className="agent-avatar" aria-hidden="true">K</span>
            <div className="agent-copy">
              <strong>K1 Katsastus</strong>
              <em>Agent tester</em>
            </div>
          </div>
          {mobile ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => setRefineOpen(true)}
              aria-label={dirty ? 'Refine agent, unsaved changes' : 'Refine agent'}
            >
              Refine
              {dirty && <i className="pending-dot" aria-hidden="true" />}
            </button>
          ) : (
            <div className="header-account" ref={accountRef}>
              <button className="account-button" type="button" aria-haspopup="menu" aria-expanded={accountOpen} onClick={() => setAccountOpen((open) => !open)}>
                <span>D</span>Demo
              </button>
              {accountOpen && <AccountMenu onFailSave={() => { service.failNextSave(); setAccountOpen(false); showToast('The next Save will fail.') }} onFailReply={() => { service.failNextReply(); setAccountOpen(false); showToast('The next reply will fail.') }} />}
            </div>
          )}
        </header>
        <main id="playground" className="playground">
          {!mobile && inspector}
          <section className="canvas" aria-label="Agent tester canvas">
            {tester}
          </section>
        </main>
      </div>

      <AnimatePresence>
        {mobile && sidebarOpen && (
          <MobileNav
            onClose={() => setSidebarOpen(false)}
            onFailSave={() => { service.failNextSave(); setSidebarOpen(false); showToast('The next Save will fail.') }}
            onFailReply={() => { service.failNextReply(); setSidebarOpen(false); showToast('The next reply will fail.') }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {mobile && refineOpen && (
          <RefineOverlay onClose={() => setRefineOpen(false)}>
            {inspector}
          </RefineOverlay>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {instructionsOpen && (
          <InstructionsDialog
            value={draft.instructions}
            onChange={(instructions) => updateDraft({ instructions })}
            onClose={() => setInstructionsOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div className="toast" role="status" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={fade}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Sidebar({ open, onToggle }: {
  open: boolean
  onToggle: () => void
}) {
  const reducedMotion = useReducedMotion()
  return (
    <motion.aside
      className="sidebar"
      aria-label="Workspace"
      initial={false}
      animate={{ width: open ? 256 : 48 }}
      transition={reducedMotion ? { duration: 0 } : space}
    >
      <div className="sidebar-top">
        {open && (
          <div className="brand" title="wasup">
            <span>w</span>
            <strong>wasup</strong>
          </div>
        )}
        <button className="icon-button" type="button" onClick={onToggle} aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}>
          {open ? <CollapseIcon /> : <ExpandIcon />}
        </button>
      </div>
      <nav className="sidebar-nav">
        <NavItem id="playground" active label="Playground" open={open} />
        <NavItem id="activity" label="Activity" open={open} unavailable />
        <NavItem id="leads" label="Leads" open={open} unavailable />
      </nav>
      <div className="sidebar-foot">
        <div className="account-button sidebar-account" aria-hidden="true">
          <span>D</span>
          {open && <em>Demo</em>}
        </div>
      </div>
    </motion.aside>
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
      onClick={unavailable ? undefined : undefined}
    >
      <NavIcon id={id} />
      {open && <span>{label}</span>}
      {open && unavailable && <small>Unavailable</small>}
    </button>
  )
}

function AccountMenu({ onFailSave, onFailReply }: { onFailSave: () => void; onFailReply: () => void }) {
  return (
    <div className="account-popover" role="menu">
      <p>Development controls. These do not change production authentication.</p>
      <button type="button" role="menuitem" onClick={onFailSave}>Fail next save</button>
      <button type="button" role="menuitem" onClick={onFailReply}>Fail next reply</button>
    </div>
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
      <aside
        ref={panelRef}
        className="mobile-nav-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-nav-title"
      >
        <header>
          <div className="brand"><span>w</span><strong id="mobile-nav-title">wasup</strong></div>
          <button ref={closeRef} className="icon-button" type="button" onClick={onClose} aria-label="Close navigation"><CloseIcon /></button>
        </header>
        <nav>
          <NavItem id="playground" active label="Playground" open />
          <NavItem id="activity" label="Activity" open unavailable />
          <NavItem id="leads" label="Leads" open unavailable />
        </nav>
        <div className="mobile-nav-foot">
          <p>Demo session · no sign-in gate</p>
          <button type="button" className="secondary-button" onClick={onFailSave}>Fail next save</button>
          <button type="button" className="secondary-button" onClick={onFailReply}>Fail next reply</button>
        </div>
      </aside>
    </div>
  )
}

function Inspector({ draft, dirty, saveStatus, saveError, openerOpen, openerDirty, loading, onToggleOpener, onChange, onExpand, onSave, onDiscard }: {
  draft: AgentConfig
  dirty: boolean
  saveStatus: SaveStatus
  saveError: string | null
  openerOpen: boolean
  openerDirty: boolean
  loading: boolean
  onToggleOpener: () => void
  onChange: (patch: Partial<AgentConfig>) => void
  onExpand: () => void
  onSave: () => void
  onDiscard: () => void
}) {
  const showBar = dirty || saveStatus === 'saving' || saveStatus === 'error'
  const preview = openerPreview(draft.opener)
  return (
    <section className="inspector" aria-label="Agent configuration">
      {showBar && (
        <div className="savebar">
          <p className={`save-copy ${saveStatus === 'error' ? 'is-error' : saveStatus === 'saving' ? 'is-saving' : 'is-draft'}`} role="status">
            {saveStatus === 'saving' ? 'Saving…' : saveError ?? 'You have unsaved changes.'}
          </p>
          <div className="savebar-actions">
            <button className="secondary-button" type="button" onClick={onDiscard} disabled={saveStatus === 'saving' || !dirty}>Discard</button>
            <button className="primary-button" type="button" onClick={onSave} disabled={saveStatus === 'saving' || !dirty}>
              {saveStatus === 'saving' && <Spinner />}
              {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Retry save' : 'Save'}
            </button>
          </div>
        </div>
      )}
      {saveStatus === 'saved' && !dirty && (
        <p className="save-copy is-saved" role="status">Saved</p>
      )}
      {loading ? (
        <div className="inspector-skeleton" aria-busy="true">
          <span /><span /><span />
        </div>
      ) : (
        <div className="inspector-body">
          <div className="field-block">
            <div className="field-head">
              <div>
                <h2>Instructions</h2>
                <p>How the saved agent should behave.</p>
              </div>
              <button className="icon-button" type="button" onClick={onExpand} aria-label="Expand instructions">
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
          <Accordion id="opening-message" title="Opening message" open={openerOpen} onToggle={onToggleOpener}>
            <textarea
              className="opener-input"
              aria-label="Opening message"
              value={draft.opener}
              onChange={(event) => onChange({ opener: event.target.value })}
            />
            <div className="opener-preview">
              <span>{openerDirty ? 'Draft preview' : 'Saved preview'}</span>
              <small>Sample data: first_name = Rasmus · registration_number = ABC-123</small>
              {preview ? <p>{preview}</p> : <p className="empty-preview">No opening message. A new test waits for the first customer message.</p>}
            </div>
          </Accordion>
        </div>
      )}
    </section>
  )
}

function Tester({ messages, composer, sending, replyError, dirty, loading, mobile, onComposer, onSend, onRetry, onNewTest }: {
  messages: ChatMessage[]
  composer: string
  sending: boolean
  replyError: string | null
  dirty: boolean
  loading: boolean
  mobile: boolean
  onComposer: (value: string) => void
  onSend: () => void
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
    <div className={`tester${mobile ? ' is-mobile' : ''}`}>
      <header className="tester-head">
        <div>
          <strong>Agent tester</strong>
          <em>K1 Katsastus · mocked replies</em>
        </div>
        <div className="tester-actions">
          <button className="secondary-button" type="button" onClick={onNewTest}>New test</button>
        </div>
      </header>
      {dirty && <p className="draft-note">Unsaved edits are not used in this test until you Save.</p>}
      {loading ? (
        <div className="tester-skeleton" aria-busy="true"><span /><span /><span /></div>
      ) : (
        <div className="messages" aria-live="polite">
          {messages.length === 0 && (
            <div className="empty-thread">
              <strong>No opening message is saved.</strong>
              <span>Send a test message to start the thread.</span>
            </div>
          )}
          <AnimatePresence initial={false}>
            {messages.map((message) => (
              <motion.article
                key={message.id}
                className={`message ${message.role}`}
                initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reducedMotion ? 0 : 0.18, ease }}
              >
                <p>{message.text}</p>
                {message.mocked && <span className="mock-tag">Mocked</span>}
              </motion.article>
            ))}
          </AnimatePresence>
          {sending && <div className="typing" aria-label="Waiting for mocked reply"><span /><span /><span /></div>}
        </div>
      )}
      {replyError && (
        <div className="reply-error" role="status">
          <span>{replyError}</span>
          <button className="secondary-button" type="button" onClick={onRetry} disabled={sending}>Retry reply</button>
        </div>
      )}
      <div className="composer-wrap">
        <Composer value={composer} sending={sending} onChange={onComposer} onKeyDown={onKeyDown} onSend={onSend} />
        <p>Mocked replies. Nothing is sent to customers, WhatsApp, or email.</p>
      </div>
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
  const [multiline, setMultiline] = useState(false)
  useLayoutEffect(() => {
    const area = areaRef.current
    if (!area) return
    const styles = getComputedStyle(area)
    const line = Number.parseFloat(styles.lineHeight) || 24
    const pad = (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0)
    const single = line + pad
    area.style.height = '0px'
    const next = Math.min(Math.max(area.scrollHeight, single), 148)
    area.style.height = `${next}px`
    setMultiline(next > single + 2)
  }, [value])
  return (
    <div className={multiline ? 'composer is-multiline' : 'composer'}>
      <textarea
        ref={areaRef}
        rows={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask the saved agent a test question…"
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
  useEffect(() => {
    if (open) return
    setClip(true)
    const panel = document.getElementById(panelId)
    const toggle = document.getElementById(buttonId)
    if (panel && toggle && panel.contains(document.activeElement)) toggle.focus()
  }, [open, buttonId, panelId])
  return (
    <section className={`accordion${open ? ' is-open' : ''}`}>
      <button id={buttonId} type="button" className="accordion-toggle" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
        <motion.span className="accordion-chevron" aria-hidden="true" animate={{ rotate: open ? 180 : 0 }} transition={reducedMotion ? { duration: 0 } : space}>
          <ChevronIcon />
        </motion.span>
        {title}
      </button>
      <motion.div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        className="accordion-clip"
        initial={false}
        animate={open ? 'open' : 'closed'}
        variants={{
          open: { height: 'auto', opacity: 1 },
          closed: { height: 0, opacity: 0 },
        }}
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
  const closeRef = useRef<HTMLButtonElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { areaRef.current?.focus() }, [])
  return (
    <motion.div ref={rootRef} className="dialog-root" initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 1 }}>
      <motion.div
        className="overlay-backdrop"
        aria-hidden="true"
        onClick={onClose}
        initial="hidden"
        animate="shown"
        exit="hidden"
        variants={backdropVariants}
        transition={reducedMotion ? { duration: 0 } : fade}
      />
      <motion.div
        className="instructions-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="instructions-title"
        initial="hidden"
        animate="shown"
        exit="hidden"
        variants={dialogVariants}
        transition={reducedMotion ? { duration: 0 } : { duration: 0.2, ease }}
      >
        <header>
          <h2 id="instructions-title">Instructions</h2>
          <button ref={closeRef} className="icon-button" type="button" onClick={onClose} aria-label="Close instructions"><CloseIcon /></button>
        </header>
        <textarea ref={areaRef} aria-label="Instructions" value={value} onChange={(event) => onChange(event.target.value)} />
        <footer>
          <span>Edits stay in the draft until you Save.</span>
          <button className="primary-button" type="button" onClick={onClose}>Done</button>
        </footer>
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
    if (!backdrop || !panel) return
    if (reducedMotion) return
    animate(backdrop, { opacity: [0, 1] }, fade)
    animate(panel, { transform: ['translateY(16px)', 'translateY(0px)'] }, sheetMotion)
  }, [reducedMotion])
  return (
    <div ref={rootRef} className="refine-overlay">
      <div ref={backdropRef} className="overlay-backdrop" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        className="refine-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="refine-title"
      >
        <header>
          <h2 id="refine-title">Refine agent</h2>
          <button ref={closeRef} className="secondary-button" type="button" onClick={onClose}>Done</button>
        </header>
        {children}
      </div>
    </div>
  )
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />
}

function Svg(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" {...props} />
}

function ChevronIcon() { return <Svg><path d="M4 6.25 8 10l4-3.75" /></Svg> }
function CloseIcon() { return <Svg><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></Svg> }
function ArrowUpIcon() { return <Svg><path d="M8 13V4M8 4 4.4 7.6M8 4l3.6 3.6" /></Svg> }
function MenuIcon() { return <Svg><path d="M3 4.5h10M3 8h10M3 11.5h10" /></Svg> }
function CollapseIcon() { return <Svg><path d="M10.5 3.5 6 8l4.5 4.5M6 3.5v9" /></Svg> }
function ExpandIcon() { return <Svg><path d="M5.5 3.5 10 8 5.5 12.5M10 3.5v9" /></Svg> }
function ExpandDialogIcon() { return <Svg><path d="M6 3.5H3.5V6M10 3.5h2.5V6M6 12.5H3.5V10M10 12.5h2.5V10" /></Svg> }
function PlaygroundIcon() { return <Svg><path d="M4 4.2h8v7.6H4zM6.2 12.6h3.6" /></Svg> }
function ActivityIcon() { return <Svg><path d="M3.2 10.8 6 7.4l2.2 2.4 4.6-5.6" /></Svg> }
function LeadsIcon() { return <Svg><circle cx="6.2" cy="6" r="2" /><path d="M3.4 12.4c.4-2 1.8-3 2.8-3s2.4 1 2.8 3M10.4 6.2a2 2 0 1 1 0 3.4" /></Svg> }

function NavIcon({ id }: { id: NavId }) {
  if (id === 'activity') return <ActivityIcon />
  if (id === 'leads') return <LeadsIcon />
  return <PlaygroundIcon />
}

export default App
