import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ease } from '../../lib/motion'
import { draftTarget, versionTarget, type AgentConfig, type TestTarget } from '../data/agentConfig'
import { newId } from '../data/builderApi'
import type { PlaygroundStore } from '../data/usePlayground'
import { useTestChat } from '../data/useTestChat'
import { go } from '../routes'
import { Menu, Select, Skeleton, type SelectOption } from '../ui/controls'
import { ArrowUp, MoreHorizontal, Rocket, ThumbsDown, ThumbsUp } from '../ui/icons'
import { Bubble, useAutoGrow } from './PlaygroundPage'
import { useCopy } from '../i18n'
import { versionHint } from './versionText'

const MAX_COLUMNS = 3
const DRAFT = 'draft'

type Column = { key: string; pick: string }

function defaultPicks(config: AgentConfig): string[] {
  const live = config.liveVersion?.id
  const latest = config.versions[0]?.id
  const first = live ?? latest
  if (!first) return [DRAFT, DRAFT]
  const second = latest && latest !== first ? latest : config.versions.find((version) => version.id !== first)?.id ?? DRAFT
  return [first, second]
}

function CompareColumn({ store, config, pick, onPick, options, index, total, onMove, onRemove, clearSignal }: {
  store: PlaygroundStore
  config: AgentConfig
  pick: string
  onPick: (pick: string) => void
  options: SelectOption<string>[]
  index: number
  total: number
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
  clearSignal: number
}) {
  const t = useCopy()
  const version = config.versions.find((item) => item.id === pick) ?? null
  const target: TestTarget | null = useMemo(() => {
    if (pick === DRAFT) return store.draft ? draftTarget(config, store.draft) : null
    return version ? versionTarget(version) : null
  }, [pick, version, store.draft, config])
  const chat = useTestChat(target, 'compare', store.lead)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  useAutoGrow(inputRef, chat.composer)

  useEffect(() => { if (clearSignal) chat.reset() }, [clearSignal])
  useEffect(() => {
    const node = threadRef.current
    if (node) node.scrollTo({ top: node.scrollHeight })
  }, [chat.messages.length, chat.pending])

  const canSend = chat.composer.trim().length > 0 && !chat.pending && Boolean(target)
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void chat.send()
    }
  }
  const deployable = version && !version.live

  return (
    <section className="k1-compare__col" aria-label={t.compare.chat(index + 1)}>
      <header className="k1-compare__head">
        <Select label={t.compare.versionFor(index + 1)} value={pick} options={options} placeholder={t.compare.chooseVersion} onChange={onPick} className="k1-compare__picker" />
        {version && (
          <span className="k1-compare__score" title={t.compare.score}>
            <ThumbsUp size={12} strokeWidth={1.75} />{version.thumbsUp}<ThumbsDown size={12} strokeWidth={1.75} />{version.thumbsDown}
          </span>
        )}
        <button
          type="button"
          className="k1-icon-btn"
          aria-label={deployable ? t.compare.deploy(version.number) : t.compare.notDeployable}
          title={deployable ? t.compare.deploy(version.number) : version?.live ? t.compare.alreadyLive : t.compare.saveFirst}
          disabled={!deployable}
          onClick={() => version && go({ page: 'deploy', version: version.id })}
        >
          <Rocket size={15} strokeWidth={1.75} />
        </button>
        <Menu
          label={t.compare.actions(index + 1)}
          items={[
            ...(index > 0 ? [{ label: t.compare.moveLeft, onSelect: () => onMove(-1) }] : []),
            ...(index < total - 1 ? [{ label: t.compare.moveRight, onSelect: () => onMove(1) }] : []),
            { label: t.compare.clearChat, onSelect: chat.reset },
            ...(total > 1 ? [{ label: t.common.remove, tone: 'danger' as const, onSelect: onRemove }] : []),
          ]}
          trigger={(props) => (
            <button type="button" className="k1-icon-btn" aria-label={t.compare.actions(index + 1)} {...props}>
              <MoreHorizontal size={16} />
            </button>
          )}
        />
      </header>
      <div className="k1-compare__thread" ref={threadRef} aria-live="polite">
        {chat.messages.map((message) => (
          <Bubble key={message.id} message={message} onRate={(value) => chat.rate(message.id, value)} />
        ))}
        <AnimatePresence>
          {chat.pending && (
            <motion.div key="typing" className="k1-msg k1-msg--agent" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease }}>
              <div className="k1-msg__bubble k1-typing" aria-label={t.tester.replying}><span /><span /><span /></div>
            </motion.div>
          )}
        </AnimatePresence>
        {chat.error && (
          <div className="k1-tester__error" role="alert">
            <span>{chat.error}</span>
            <button type="button" className="k1-link" onClick={chat.retry}>{t.common.tryAgain}</button>
          </div>
        )}
      </div>
      <form className="k1-tester__composer k1-compare__composer" onSubmit={(event) => { event.preventDefault(); void chat.send() }}>
        <textarea
          ref={inputRef}
          rows={1}
          value={chat.composer}
          placeholder={t.tester.placeholder}
          aria-label={t.compare.messageFor(index + 1)}
          onChange={(event) => chat.setComposer(event.target.value)}
          onKeyDown={onKey}
        />
        <button type="submit" className="k1-send" aria-label={t.compare.sendTo(index + 1)} disabled={!canSend}>
          <ArrowUp size={16} strokeWidth={2.25} />
        </button>
      </form>
    </section>
  )
}

export function ComparePage({ store }: { store: PlaygroundStore }) {
  const t = useCopy()
  const config = store.config
  const [columns, setColumns] = useState<Column[]>([])
  const [clearSignal, setClearSignal] = useState(0)

  useEffect(() => { void store.refresh() }, [])

  useEffect(() => {
    if (config && !columns.length) setColumns(defaultPicks(config).map((pick) => ({ key: newId(), pick })))
  }, [config])

  if (!config) {
    return (
      <div className="k1-compare" role="status" aria-label={t.compare.loading}>
        <div className="k1-compare__bar"><Skeleton width={120} height={28} /></div>
        <div className="k1-compare__grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <div className="k1-compare__col"><Skeleton height={36} /><Skeleton width="70%" height={60} radius={20} /></div>
          <div className="k1-compare__col"><Skeleton height={36} /><Skeleton width="70%" height={60} radius={20} /></div>
        </div>
      </div>
    )
  }

  const options: SelectOption<string>[] = [
    { value: DRAFT, label: store.dirty ? t.compare.draftUnsaved : t.common.draft, group: t.compare.workingCopy, hint: t.compare.workingCopyHint },
    ...config.versions.map((version) => ({
      value: version.id,
      label: `v${version.number}`,
      hint: versionHint(version, t),
      group: t.playground.savedVersions,
    })),
  ]

  const update = (index: number, pick: string) => setColumns((list) => list.map((column, i) => (i === index ? { ...column, pick } : column)))
  const move = (index: number, delta: -1 | 1) => setColumns((list) => {
    const next = [...list]
    const [column] = next.splice(index, 1)
    next.splice(index + delta, 0, column)
    return next
  })

  return (
    <div className="k1-compare">
      <div className="k1-compare__bar">
        <div>
          <h1 className="k1-page-title">{t.compare.title}</h1>
        </div>
        <div className="k1-compare__actions">
          <button type="button" className="k1-btn k1-btn--outline k1-btn--sm" onClick={() => setClearSignal((n) => n + 1)}>{t.compare.clearAll}</button>
          <button
            type="button"
            className="k1-btn k1-btn--primary k1-btn--sm"
            disabled={columns.length >= MAX_COLUMNS}
            onClick={() => setColumns((list) => [...list, { key: newId(), pick: config.versions.find((version) => !list.some((column) => column.pick === version.id))?.id ?? DRAFT }])}
          >
            {t.compare.add}
          </button>
        </div>
      </div>
      <p className="k1-compare__hint">{t.compare.hint}</p>
      <div className="k1-compare__grid" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
        {columns.map((column, index) => (
          <CompareColumn
            key={column.key}
            store={store}
            config={config}
            pick={column.pick}
            onPick={(pick) => update(index, pick)}
            options={options}
            index={index}
            total={columns.length}
            onMove={(delta) => move(index, delta)}
            onRemove={() => setColumns((list) => list.filter((_, i) => i !== index))}
            clearSignal={clearSignal}
          />
        ))}
      </div>
    </div>
  )
}
