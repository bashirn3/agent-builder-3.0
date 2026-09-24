import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  ArrowUp, Bold, ChevronDown, ChevronRight, FileText, Heading, List, ListOrdered, Lock, LockOpen,
  Italic, Maximize2, RefreshCw, RotateCcw, ThumbsDown, ThumbsUp,
} from '../ui/icons'
import { ease } from '../../lib/motion'

const easeInOut = [0.4, 0, 0.2, 1] as const
import { backendLabel, backendMode } from '../data/agentConfig'
import type { PlaygroundStore, TestMessage } from '../data/usePlayground'
import { K1Mark } from '../shell/Shell'
import { Select, Skeleton, Spinner } from '../ui/controls'
import { applyFormat, stripPrefix, type Format } from '../ui/format'
import { Collapse, Dialog } from '../ui/overlay'
import { href } from '../routes'
import { UnderlineTabs } from './SplitView'

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

const TOOLS: Array<{ kind: Format; label: string; icon: ReactNode } | 'sep'> = [
  { kind: 'bold', label: 'Bold', icon: <Bold /> },
  { kind: 'italic', label: 'Italic', icon: <Italic /> },
  { kind: 'heading', label: 'Heading', icon: <Heading /> },
  'sep',
  { kind: 'bullet', label: 'Bulleted list', icon: <List /> },
  { kind: 'number', label: 'Numbered list', icon: <ListOrdered /> },
]

function PromptEditor({ id, value, onChange, readOnly, describedBy, onExpand, size = 'panel', label }: {
  id: string
  value: string
  onChange: (value: string) => void
  readOnly: boolean
  describedBy?: string
  onExpand?: () => void
  size?: 'panel' | 'dialog'
  label?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const format = (kind: Format) => {
    const node = ref.current
    if (!node || readOnly) return
    const next = applyFormat(value, node.selectionStart, node.selectionEnd, kind)
    onChange(next.value)
    requestAnimationFrame(() => {
      node.focus()
      node.setSelectionRange(next.start, next.end)
    })
  }
  return (
    <div className={`k1-editor k1-editor--${size}${readOnly ? ' is-readonly' : ''}`}>
      <div className="k1-editor__toolbar" role="toolbar" aria-label="Formatting" aria-controls={id}>
        {TOOLS.map((tool, index) => tool === 'sep' ? <span key={`sep-${index}`} className="k1-editor__sep" aria-hidden="true" /> : (
          <button key={tool.kind} type="button" className="k1-editor__tool" aria-label={tool.label} title={tool.label} disabled={readOnly} onClick={() => format(tool.kind)}>
            {tool.icon}
          </button>
        ))}
        {onExpand && (
          <button type="button" className="k1-editor__tool k1-editor__expand" aria-label="Expand instructions" title="Expand" onClick={onExpand}>
            <Maximize2 size={14} strokeWidth={1.75} />
          </button>
        )}
      </div>
      <textarea
        ref={ref}
        id={id}
        aria-label={label}
        className="k1-editor__input"
        value={value}
        readOnly={readOnly}
        spellCheck
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function Switch({ checked, onChange, labelledBy, describedBy }: { checked: boolean; onChange: (next: boolean) => void; labelledBy: string; describedBy?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={`k1-switch${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="k1-switch__thumb" />
    </button>
  )
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string }) {
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const list = event.currentTarget
    const index = options.findIndex((option) => option.value === value)
    const next = options[(index + (event.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length]
    onChange(next.value)
    requestAnimationFrame(() => list.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus())
  }
  return (
    <div className="k1-segmented" role="tablist" aria-label={label} onKeyDown={onKey}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button key={option.value} type="button" role="tab" aria-selected={active} tabIndex={active ? 0 : -1} className={active ? 'is-active' : undefined} onClick={() => onChange(option.value)}>
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function Accordion({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  return (
    <div className="k1-accordion">
      <button type="button" className="k1-accordion__trigger" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
        {title}
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2, ease }} style={{ display: 'inline-flex' }}>
          <ChevronDown size={16} strokeWidth={1.75} />
        </motion.span>
      </button>
      <Collapse open={open} id={panelId}>
        <div className="k1-accordion__panel">{children}</div>
      </Collapse>
    </div>
  )
}

function summarise(text: string) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return { title: 'None added', meta: 'Add rules that sit on top of the base prompt' }
  return { title: stripPrefix(lines[0]), meta: `${lines.length} line${lines.length === 1 ? '' : 's'}` }
}

type PanelTab = 'overview' | 'display'

function Inspector({ store, showTitle = true, tab: controlledTab }: { store: PlaygroundStore; showTitle?: boolean; tab?: PanelTab }) {
  const { config, draft, dirty, saving } = store
  const [ownTab, setTab] = useState<PanelTab>('overview')
  const tab = controlledTab ?? ownTab
  const [expanded, setExpanded] = useState(false)
  const [extraOpen, setExtraOpen] = useState(false)
  const ids = {
    master: useId(), expanded: useId(), additional: useId(), opener: useId(),
    lockLabel: useId(), lockNote: useId(), instructions: useId(),
  }
  if (!config || !draft) return null
  const versionOptions = config.versions.length
    ? config.versions.map((version) => ({
      value: version.id,
      label: `Version ${version.number}`,
      hint: version.active ? 'Active' : new Date(version.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short' }),
      group: version.active ? 'Active configuration' : 'Saved versions',
    }))
    : [{ value: 'default', label: 'Default K1 instructions', group: 'Not saved yet' }]
  const extra = summarise(draft.additional)
  const editPrompt = (masterPrompt: string) => store.edit({ masterPrompt })

  return (
    <div className="k1-inspector__inner">
      {showTitle && <h1 className="k1-page-title">Playground</h1>}
      {!controlledTab && (
        <Segmented<PanelTab>
          label="Agent settings"
          value={tab}
          onChange={setTab}
          options={[{ value: 'overview', label: 'Overview' }, { value: 'display', label: 'Display' }]}
        />
      )}

        <div
          role="tabpanel"
          aria-label={tab === 'overview' ? 'Overview' : 'Display'}
          className="k1-inspector__panel"
        >
          {tab === 'overview' ? (
            <>
              <section className="k1-inspector__section" aria-labelledby={ids.instructions}>
                <h2 className="k1-section-title" id={ids.instructions}>Instructions</h2>
                <div className="k1-inspector__row">
                  <Select
                    label="Instruction version"
                    value={store.versionId ?? 'default'}
                    options={versionOptions}
                    placeholder="Choose a version"
                    onChange={(value) => value !== 'default' && store.loadVersion(value)}
                  />
                  <button type="button" className="k1-icon-btn k1-icon-btn--boxed" aria-label="Reset to the saved instructions" title="Reset to saved" disabled={!dirty} onClick={store.discard}>
                    <RotateCcw size={15} strokeWidth={1.75} />
                  </button>
                </div>
                <PromptEditor
                  id={ids.master}
                  label="Base prompt"
                  value={draft.masterPrompt}
                  onChange={editPrompt}
                  readOnly={draft.locked}
                  describedBy={ids.lockNote}
                  onExpand={() => setExpanded(true)}
                />
                <div className="k1-switch-row">
                  <span className="k1-switch-row__label" id={ids.lockLabel}>
                    {draft.locked ? <Lock size={14} strokeWidth={1.75} /> : <LockOpen size={14} strokeWidth={1.75} />}
                    Lock base prompt
                  </span>
                  <Switch checked={draft.locked} onChange={(locked) => store.edit({ locked })} labelledBy={ids.lockLabel} describedBy={ids.lockNote} />
                </div>
                <p className="k1-hint" id={ids.lockNote}>
                  {draft.locked
                    ? 'The base prompt is read-only. Additional instructions and the opening message stay editable.'
                    : 'Anyone editing this agent can change the base prompt. Lock it once it is approved.'}
                </p>
              </section>

              <section className="k1-inspector__section">
                <h2 className="k1-section-title">Additional instructions</h2>
                <button type="button" className="k1-rowcard" aria-haspopup="dialog" onClick={() => setExtraOpen(true)}>
                  <span className="k1-rowcard__icon"><FileText size={15} strokeWidth={1.75} /></span>
                  <span className="k1-rowcard__text">
                    <strong>{extra.title}</strong>
                    <small>{extra.meta}</small>
                  </span>
                  <ChevronRight size={16} strokeWidth={1.75} className="k1-rowcard__chevron" />
                </button>
              </section>
            </>
          ) : (
            <div className="k1-accordions">
              <Accordion title="Content" defaultOpen>
                <label className="k1-label" htmlFor={ids.opener}>Initial message</label>
                <textarea
                  id={ids.opener}
                  className="k1-textarea"
                  rows={5}
                  value={draft.opener}
                  onChange={(event) => store.edit({ opener: event.target.value })}
                />
                <p className="k1-hint">The first message a customer sees. {'{{first_name}}'} and {'{{registration_number}}'} show as Rasmus and ABC-123 in the test chat.</p>
              </Accordion>
            </div>
          )}
        </div>

      <p className="k1-inspector__source">{backendLabel}</p>

      <AnimatePresence>
        {dirty && (
          <motion.div
            className="k1-unsaved"
            role="region"
            aria-label="Unsaved changes"
            initial={{ opacity: 0, y: '100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '100%' }}
            transition={{ duration: 0.3, ease: easeInOut }}
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

      <Dialog open={expanded} title="Instructions" width={896} onClose={() => setExpanded(false)}>
        <PromptEditor
          id={ids.expanded}
          label="Base prompt"
          size="dialog"
          value={draft.masterPrompt}
          onChange={editPrompt}
          readOnly={draft.locked}
        />
        {draft.locked && <p className="k1-hint k1-dialog__note">The base prompt is locked. Close this and switch off “Lock base prompt” to edit.</p>}
      </Dialog>

      <Dialog open={extraOpen} title="Additional instructions" width={560} onClose={() => setExtraOpen(false)}>
        <div className="k1-form-stack">
          <p className="k1-hint">Short, specific rules added on top of the base prompt, for example opening hours or what to do when a station is full.</p>
          <textarea
            id={ids.additional}
            aria-label="Additional instructions"
            className="k1-textarea"
            rows={8}
            value={draft.additional}
            placeholder="e.g. If the customer asks for Saturday, explain the station is open Monday to Friday."
            onChange={(event) => store.edit({ additional: event.target.value })}
          />
        </div>
        <div className="k1-dialog__foot">
          <button type="button" className="k1-btn k1-btn--primary" onClick={() => setExtraOpen(false)}>Done</button>
        </div>
      </Dialog>
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

function TesterSkeleton() {
  return (
    <div className="k1-tester k1-tester--skeleton" role="status" aria-label="Loading the test chat">
      <div className="k1-tester__head"><Skeleton width={26} height={26} radius={999} /><Skeleton width={180} height={14} /></div>
      <div className="k1-tester__thread">
        <Skeleton width="72%" height={76} radius={20} />
      </div>
      <div className="k1-tester__composer k1-tester__composer--skeleton"><Skeleton width="40%" height={12} /></div>
    </div>
  )
}

function InspectorSkeleton({ showTitle = true }: { showTitle?: boolean }) {
  return (
    <div className="k1-inspector__inner" role="status" aria-label="Loading the agent configuration">
      {showTitle && <h1 className="k1-page-title">Playground</h1>}
      <Skeleton height={36} radius={10} className="k1-skel--tabs" />
      <div className="k1-inspector__panel">
        <section className="k1-inspector__section">
          <h2 className="k1-section-title">Instructions</h2>
          <div className="k1-inspector__row"><Skeleton height={40} style={{ flex: 1 }} /><Skeleton width={36} height={36} /></div>
          <div className="k1-skel-card k1-skel-card--editor">
            {[92, 78, 86, 64, 90, 70, 82].map((width, index) => <Skeleton key={index} height={12} width={`${width}%`} />)}
          </div>
        </section>
        <section className="k1-inspector__section">
          <h2 className="k1-section-title">Additional instructions</h2>
          <div className="k1-skel-card k1-skel-card--row"><Skeleton width={30} height={30} /><span className="k1-skel-card__lines"><Skeleton height={12} width="60%" /><Skeleton height={10} width="30%" /></span></div>
        </section>
      </div>
    </div>
  )
}

type MobileTab = PanelTab | 'preview'

export function PlaygroundPage({ store, compact }: { store: PlaygroundStore; compact: boolean }) {
  const [mobileTab, setMobileTab] = useState<MobileTab>('overview')

  if (store.loadError) {
    return (
      <div className="k1-state">
        <h1 className="k1-page-title">Playground</h1>
        <p>The agent configuration could not be loaded ({store.loadError}). {backendMode === 'n8n' ? 'The n8n agent-builder workflow did not respond.' : ''}</p>
        <button type="button" className="k1-btn k1-btn--outline" onClick={store.reload}>Try again</button>
      </div>
    )
  }
  const loading = !store.config

  if (compact) {
    return (
      <div className="k1-playground k1-playground--compact">
        <div className="k1-mobilebar">
          <h1 className="k1-page-title">Playground</h1>
          {store.dirty && <span className="k1-badge k1-badge--draft">Unsaved</span>}
        </div>
        <UnderlineTabs<MobileTab>
          label="Playground"
          value={mobileTab}
          onChange={setMobileTab}
          options={[{ value: 'overview', label: 'Overview' }, { value: 'display', label: 'Display' }, { value: 'preview', label: 'Preview' }]}
        />
        {mobileTab === 'preview' ? (
          <div className="k1-canvas">{loading ? <TesterSkeleton /> : <Tester store={store} />}</div>
        ) : (
          <div className="k1-inspector k1-inspector--sheet">
            {loading ? <InspectorSkeleton showTitle={false} /> : <Inspector store={store} showTitle={false} tab={mobileTab} />}
          </div>
        )}
        {!store.dirty && (
          <div className="k1-mobile-deploy">
            <a className="k1-btn k1-btn--primary k1-btn--block" href={href({ page: 'deploy' })}>Deploy<ChevronRight /></a>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="k1-playground">
      <aside className="k1-inspector">{loading ? <InspectorSkeleton /> : <Inspector store={store} />}</aside>
      <div className="k1-canvas">{loading ? <TesterSkeleton /> : <Tester store={store} />}</div>
    </div>
  )
}
