import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUp, ChevronDown, Lock, LockOpen, RefreshCw, RotateCcw, SlidersHorizontal, ThumbsDown, ThumbsUp } from 'lucide-react'
import { ease } from '../../lib/motion'
import { backendLabel, backendMode } from '../data/agentConfig'
import type { PlaygroundStore, TestMessage } from '../data/usePlayground'
import { K1Mark } from '../shell/Shell'
import { Select, Spinner } from '../ui/controls'
import { Drawer } from '../ui/overlay'

function relative(at: number) {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string, max = 120) {
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, max)}px`
  }, [ref, value, max])
}

function Inspector({ store, showTitle = true }: { store: PlaygroundStore; showTitle?: boolean }) {
  const { config, draft, dirty, saving } = store
  const ids = { master: useId(), additional: useId(), opener: useId(), lockNote: useId() }
  if (!config || !draft) return null
  const versionOptions = config.versions.length
    ? config.versions.map((version) => ({
      value: version.id,
      label: `Version ${version.number}`,
      hint: version.active ? 'Active' : new Date(version.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short' }),
      group: version.active ? 'Active configuration' : 'Saved versions',
    }))
    : [{ value: 'default', label: 'Default K1 instructions', group: 'Not saved yet' }]

  return (
    <div className="k1-inspector__inner">
      {showTitle && <h1 className="k1-page-title">Playground</h1>}

      <section className="k1-inspector__section">
        <label className="k1-label" htmlFor={ids.master}>Instructions (System prompt)</label>
        <div className="k1-inspector__row">
          <Select
            label="Prompt version"
            value={store.versionId ?? 'default'}
            options={versionOptions}
            placeholder="Choose a version"
            onChange={(value) => value !== 'default' && store.loadVersion(value)}
          />
          <button type="button" className="k1-icon-btn k1-icon-btn--boxed" aria-label="Revert to the saved configuration" title="Revert to saved" disabled={!dirty} onClick={store.discard}>
            <RotateCcw size={15} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="k1-icon-btn k1-icon-btn--boxed"
            aria-label={draft.locked ? 'Unlock base prompt' : 'Lock base prompt'}
            aria-pressed={draft.locked}
            title={draft.locked ? 'Unlock base prompt' : 'Lock base prompt'}
            onClick={() => store.edit({ locked: !draft.locked })}
          >
            {draft.locked ? <Lock size={15} strokeWidth={1.75} /> : <LockOpen size={15} strokeWidth={1.75} />}
          </button>
        </div>
        <textarea
          id={ids.master}
          className="k1-textarea k1-textarea--prompt"
          value={draft.masterPrompt}
          readOnly={draft.locked}
          aria-describedby={draft.locked ? ids.lockNote : undefined}
          onChange={(event) => store.edit({ masterPrompt: event.target.value })}
        />
        {draft.locked && <p className="k1-hint" id={ids.lockNote}>The base prompt is locked. Unlock it to edit; additional instructions and the opening message stay editable.</p>}
      </section>

      <section className="k1-inspector__section">
        <label className="k1-label" htmlFor={ids.additional}>Additional instructions</label>
        <textarea
          id={ids.additional}
          className="k1-textarea"
          rows={4}
          value={draft.additional}
          placeholder="e.g. If the customer asks for Saturday, explain the station is open Monday to Friday."
          onChange={(event) => store.edit({ additional: event.target.value })}
        />
      </section>

      <section className="k1-inspector__section">
        <label className="k1-label" htmlFor={ids.opener}>Opening message</label>
        <textarea
          id={ids.opener}
          className="k1-textarea"
          rows={3}
          value={draft.opener}
          onChange={(event) => store.edit({ opener: event.target.value })}
        />
        <p className="k1-hint">{'{{first_name}}'} and {'{{registration_number}}'} show as Rasmus and ABC-123 in the test chat.</p>
      </section>

      <p className="k1-inspector__source">{backendLabel}</p>

      <AnimatePresence>
        {dirty && (
          <motion.div
            className="k1-unsaved"
            role="region"
            aria-label="Unsaved changes"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2, ease }}
          >
            <p>You have unsaved changes. Do you wish to save them?</p>
            <div className="k1-unsaved__actions">
              <button type="button" className="k1-btn k1-btn--outline" onClick={store.discard} disabled={saving}>Discard</button>
              <button type="button" className="k1-btn k1-btn--primary" onClick={() => void store.save()} disabled={saving} aria-busy={saving}>
                {saving && <Spinner />}Save to agent
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Bubble({ message, onRate }: { message: TestMessage; onRate: (value: 'up' | 'down') => void }) {
  const agent = message.role === 'agent'
  return (
    <motion.div
      className={`k1-msg k1-msg--${message.role}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease }}
    >
      <div className="k1-msg__bubble">{message.text}</div>
      {agent && !message.opener && (
        <div className="k1-msg__meta">
          <span>{relative(message.at)}{message.demo ? ' · demo reply' : ''}</span>
          <span className="k1-msg__rule" aria-hidden="true" />
          <button type="button" aria-label="Good reply" aria-pressed={message.feedback === 'up'} className={message.feedback === 'up' ? 'is-on' : undefined} onClick={() => onRate('up')}>
            <ThumbsUp size={13} strokeWidth={1.75} />
          </button>
          <button type="button" aria-label="Bad reply" aria-pressed={message.feedback === 'down'} className={message.feedback === 'down' ? 'is-on' : undefined} onClick={() => onRate('down')}>
            <ThumbsDown size={13} strokeWidth={1.75} />
          </button>
        </div>
      )}
    </motion.div>
  )
}

function Tester({ store }: { store: PlaygroundStore }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [spin, setSpin] = useState(0)
  useAutoGrow(inputRef, store.composer)

  const scrollToEnd = (smooth = true) => {
    const node = scrollRef.current
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }

  useEffect(() => {
    if (atBottom) scrollToEnd(false)
  }, [store.messages.length, store.pending])

  const onScroll = () => {
    const node = scrollRef.current
    if (!node) return
    setAtBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 24)
  }

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      setAtBottom(true)
      void store.send()
    }
  }

  const canSend = store.composer.trim().length > 0 && !store.pending && Boolean(store.draft)

  return (
    <div className="k1-tester">
      <header className="k1-tester__head">
        <span className="k1-tester__avatar"><K1Mark size={24} /></span>
        <h2>K1 Katsastus booking agent</h2>
        {store.dirty && <span className="k1-badge k1-badge--draft" title="Replies use your unsaved draft">Draft</span>}
        <button
          type="button"
          className="k1-icon-btn k1-tester__reset"
          aria-label="Start a new test conversation"
          title="New conversation"
          onClick={() => { setSpin((turns) => turns + 1); store.resetConversation(); inputRef.current?.focus() }}
        >
          <motion.span animate={{ rotate: spin * 180 }} transition={{ duration: 0.4, ease }} style={{ display: 'inline-flex' }}>
            <RefreshCw size={16} strokeWidth={1.75} />
          </motion.span>
        </button>
      </header>
      <div className="k1-tester__thread" ref={scrollRef} onScroll={onScroll} aria-live="polite" aria-label="Test conversation">
        {store.messages.map((message) => (
          <Bubble key={message.id} message={message} onRate={(value) => store.rate(message.id, value)} />
        ))}
        <AnimatePresence>
          {store.pending && (
            <motion.div
              key="typing"
              className="k1-msg k1-msg--agent"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease }}
            >
              <div className="k1-msg__bubble k1-typing" aria-label="Agent is replying"><span /><span /><span /></div>
            </motion.div>
          )}
        </AnimatePresence>
        {store.testError && (
          <div className="k1-tester__error" role="alert">
            <span>{store.testError}</span>
            <button type="button" className="k1-link" onClick={store.retry}>Try again</button>
          </div>
        )}
      </div>
      <AnimatePresence>
        {!atBottom && (
          <motion.button
            type="button"
            className="k1-tester__jump"
            aria-label="Scroll to latest message"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.16, ease }}
            onClick={() => scrollToEnd()}
          >
            <ChevronDown size={16} strokeWidth={1.75} />
          </motion.button>
        )}
      </AnimatePresence>
      <p className="k1-tester__powered"><K1Mark size={12} /> Prompt-only test · nothing is sent to customers</p>
      <form className="k1-tester__composer" onSubmit={(event) => { event.preventDefault(); setAtBottom(true); void store.send() }}>
        <textarea
          ref={inputRef}
          rows={1}
          value={store.composer}
          placeholder="Message..."
          aria-label="Test message"
          onChange={(event) => store.setComposer(event.target.value)}
          onKeyDown={onKey}
        />
        <button type="submit" className="k1-send" aria-label="Send test message" disabled={!canSend}>
          <ArrowUp size={16} strokeWidth={2.25} />
        </button>
      </form>
    </div>
  )
}

export function PlaygroundPage({ store, compact }: { store: PlaygroundStore; compact: boolean }) {
  const [configOpen, setConfigOpen] = useState(false)

  if (store.loadError) {
    return (
      <div className="k1-state">
        <h1 className="k1-page-title">Playground</h1>
        <p>The agent configuration could not be loaded ({store.loadError}). {backendMode === 'n8n' ? 'The n8n agent-builder workflow did not respond.' : ''}</p>
        <button type="button" className="k1-btn k1-btn--outline" onClick={store.reload}>Try again</button>
      </div>
    )
  }
  if (!store.config) {
    return <div className="k1-state" aria-busy="true"><Spinner size={18} /><p>Loading the K1 agent configuration…</p></div>
  }

  if (compact) {
    return (
      <div className="k1-playground k1-playground--compact">
        <div className="k1-mobilebar">
          <h1 className="k1-page-title">Playground</h1>
          <button type="button" className="k1-btn k1-btn--outline k1-btn--sm" onClick={() => setConfigOpen(true)} aria-haspopup="dialog">
            <SlidersHorizontal size={14} strokeWidth={1.75} />Instructions{store.dirty ? ' · unsaved' : ''}
          </button>
        </div>
        <div className="k1-canvas"><Tester store={store} /></div>
        <Drawer open={configOpen} side="bottom" label="Agent instructions" onClose={() => setConfigOpen(false)}>
          <div className="k1-drawer__grab" aria-hidden="true" />
          <div className="k1-drawer__bar">
            <h2>Instructions</h2>
            <button type="button" className="k1-btn k1-btn--outline k1-btn--sm" onClick={() => setConfigOpen(false)}>Done</button>
          </div>
          <div className="k1-inspector k1-inspector--sheet"><Inspector store={store} showTitle={false} /></div>
        </Drawer>
      </div>
    )
  }

  return (
    <div className="k1-playground">
      <aside className="k1-inspector"><Inspector store={store} /></aside>
      <div className="k1-canvas"><Tester store={store} /></div>
    </div>
  )
}
