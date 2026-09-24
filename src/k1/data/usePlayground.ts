import { useCallback, useEffect, useRef, useState } from 'react'
import { addEntry, type QnaEntry } from './qna'
import { describeError, loadConfig, openerPreview, sameDraft, saveConfig, sendTest, type AgentConfig, type Draft } from './agentConfig'

export type TestMessage = {
  id: string
  role: 'agent' | 'user'
  text: string
  at: number
  opener?: boolean
  demo?: boolean
  feedback?: 'up' | 'down' | null
  revised?: boolean
}

type Notify = (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void

let seq = 0
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`

function openerMessage(opener: string): TestMessage[] {
  const text = openerPreview(opener)
  return text ? [{ id: uid('msg'), role: 'agent', text, at: Date.now(), opener: true }] : []
}

export function usePlayground(notify: Notify) {
  const [config, setConfig] = useState<AgentConfig | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [versionId, setVersionId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [messages, setMessages] = useState<TestMessage[]>([])
  const [pending, setPending] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)
  const [composer, setComposer] = useState('')
  const threadRef = useRef(uid('thread'))

  const load = useCallback(() => {
    let cancelled = false
    setLoadError(null)
    loadConfig()
      .then((next) => {
        if (cancelled) return
        setConfig(next)
        setDraft({ locked: next.locked, masterPrompt: next.masterPrompt, additional: next.additional, opener: next.opener })
        setVersionId(next.versions.find((item) => item.active)?.id ?? next.versions[0]?.id ?? null)
        setMessages((current) => (current.some((message) => message.role === 'user') ? current : openerMessage(next.opener)))
      })
      .catch((error: Error) => { if (!cancelled) setLoadError(describeError(error)) })
    return () => { cancelled = true }
  }, [])

  useEffect(load, [load])

  const saved: Draft | null = config ? { locked: config.locked, masterPrompt: config.masterPrompt, additional: config.additional, opener: config.opener } : null
  const dirty = Boolean(draft && saved && !sameDraft(draft, saved))

  const hasUserMessages = messages.some((message) => message.role === 'user')
  useEffect(() => {
    if (!draft || hasUserMessages) return
    setMessages(openerMessage(draft.opener))
  }, [draft?.opener])

  const edit = (patch: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...patch } : current))

  const discard = () => {
    if (!saved || !config) return
    setDraft(saved)
    setVersionId(config.versions.find((item) => item.active)?.id ?? null)
  }

  const loadVersion = (id: string) => {
    if (!config || !draft) return
    const version = config.versions.find((item) => item.id === id)
    if (!version) return
    if (draft.locked && version.masterPrompt !== draft.masterPrompt) {
      notify({ tone: 'error', title: 'Base prompt is locked', body: `Unlock the base prompt before loading v${version.number}.` })
      return
    }
    setVersionId(id)
    setDraft({ ...draft, masterPrompt: version.masterPrompt, additional: version.additional, opener: version.opener })
  }

  const save = async () => {
    if (!config || !draft || saving) return
    setSaving(true)
    try {
      const next = await saveConfig(config, draft)
      setConfig(next)
      setDraft({ locked: next.locked, masterPrompt: next.masterPrompt, additional: next.additional, opener: next.opener })
      setVersionId(next.versions[0]?.id ?? null)
      notify({ title: 'Success', body: 'Your changes are saved.' })
    } catch (error) {
      notify({ tone: 'error', title: 'Save failed', body: `Nothing was saved (${describeError(error)}). Your draft is still here.` })
    } finally {
      setSaving(false)
    }
  }

  const resetConversation = () => {
    threadRef.current = uid('thread')
    setPending(false)
    setTestError(null)
    setMessages(openerMessage(draft?.opener ?? ''))
  }

  const send = async (text = composer, base = messages) => {
    const body = text.trim()
    if (!body || !draft || pending) return
    const thread = threadRef.current
    const userMessage: TestMessage = { id: uid('msg'), role: 'user', text: body, at: Date.now() }
    const history = [...base, userMessage]
    setMessages(history)
    setComposer('')
    setPending(true)
    setTestError(null)
    try {
      const result = await sendTest(draft, history.map(({ role, text: line }) => ({ role, text: line })))
      if (thread !== threadRef.current) return
      setMessages((list) => [...list, { id: uid('msg'), role: 'agent', text: result.reply, at: Date.now(), demo: result.mode === 'demo', feedback: null }])
    } catch (error) {
      if (thread !== threadRef.current) return
      setTestError(`The test reply failed (${describeError(error)}).`)
    } finally {
      if (thread === threadRef.current) setPending(false)
    }
  }

  const retry = () => {
    const lastUser = [...messages].reverse().find((message) => message.role === 'user')
    if (!lastUser) return
    void send(lastUser.text, messages.filter((message) => message.id !== lastUser.id))
  }

  const rate = (id: string, value: 'up' | 'down') => setMessages((list) => list.map((message) => (
    message.id === id ? { ...message, feedback: message.feedback === value ? null : value } : message
  )))

  const addAnswer = (entry: Omit<QnaEntry, 'id'>, messageId?: string) => {
    setDraft((current) => (current ? { ...current, additional: addEntry(current.additional, entry) } : current))
    if (messageId) setMessages((list) => list.map((message) => (message.id === messageId ? { ...message, revised: true } : message)))
  }

  return {
    config, loadError, reload: load, draft, dirty, saving, versionId,
    edit, discard, save, loadVersion,
    messages, pending, testError, composer, setComposer, send, retry, resetConversation, rate, addAnswer,
  }
}

export type PlaygroundStore = ReturnType<typeof usePlayground>
