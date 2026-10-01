import { copy } from '../i18n'
import { useEffect, useReducer, useRef } from 'react'
import { describeError, localized, openerPreview, personalize, SAMPLE_LEAD, sendTest, type TestLead, type TestTarget } from './agentConfig'
import { hasVisibleReply, newId, recordReminder, setFeedback, type ChatSource, type ReminderKind, type ToolCall } from './builderApi'

export type TestMessage = {
  id: string
  role: 'agent' | 'user'
  text: string
  at: number
  opener?: boolean
  kind?: string | null
  demo?: boolean
  feedback?: 'up' | 'down' | null
  // Id of the stored reply; null when the backend did not record the turn.
  serverId?: string | null
  toolCalls?: ToolCall[]
}

function openerMessages(target: TestTarget | null, lead: TestLead): TestMessage[] {
  const used = target ? localized(target, lead) : null
  const text = used ? openerPreview(used.opener, lead, used.lang) : ''
  return text ? [{ id: newId(), role: 'agent', text, at: Date.now(), opener: true }] : []
}

type Session = { conversationId: string; messages: TestMessage[]; composer: string; pending: boolean; error: string | null }

export function useTestChat(target: TestTarget | null, source: ChatSource, lead: TestLead = SAMPLE_LEAD) {
  const targetKey = `${target ? (target.isDraft ? 'draft' : target.versionId) : 'none'}:${lead.plateNumber}:${lead.language}`
  // Every lead/version keeps its own conversation until it is reset, so switching away and back finds the chat as it was.
  const sessions = useRef(new Map<string, Session>())
  const [, redraw] = useReducer((count: number) => count + 1, 0)
  const keyRef = useRef(targetKey)
  keyRef.current = targetKey

  const open = (key: string): Session => {
    let session = sessions.current.get(key)
    if (!session) {
      session = { conversationId: newId(), messages: openerMessages(target, lead), composer: '', pending: false, error: null }
      sessions.current.set(key, session)
    }
    return session
  }
  const patch = (key: string, change: Partial<Session> | ((session: Session) => Partial<Session>)) => {
    const session = sessions.current.get(key)
    if (!session) return
    sessions.current.set(key, { ...session, ...(typeof change === 'function' ? change(session) : change) })
    if (key === keyRef.current) redraw()
  }

  const session = open(targetKey)
  const { messages, pending, error, composer } = session
  const hasUserMessages = messages.some((message) => message.role === 'user')

  // The opener tracks edits until the conversation starts.
  useEffect(() => {
    if (!target || hasUserMessages) return
    patch(targetKey, { messages: openerMessages(target, lead) })
  }, [target?.opener, JSON.stringify(target?.translations ?? null), targetKey])

  const setComposer = (value: string) => patch(targetKey, { composer: value })

  const reset = () => {
    patch(targetKey, { conversationId: newId(), pending: false, error: null, composer: '', messages: openerMessages(target, lead) })
  }

  const send = async (text = composer, base = messages) => {
    const body = text.trim()
    if (!body || !target || pending) return
    const key = targetKey
    const conversationId = session.conversationId
    const userMessage: TestMessage = { id: newId(), role: 'user', text: body, at: Date.now() }
    const history = [...base, userMessage]
    patch(key, { messages: history, composer: '', pending: true, error: null })
    const current = () => sessions.current.get(key)?.conversationId === conversationId
    try {
      const result = await sendTest(target, history.map(({ role, text: line }) => ({ role, text: line })), { conversationId, source, lead })
      if (!current()) return
      if (!hasVisibleReply(result.reply)) throw new Error('empty_agent_reply')
      patch(key, (live) => ({
        messages: [...live.messages, { id: newId(), role: 'agent', text: result.reply, at: Date.now(), demo: result.demo, feedback: null, serverId: result.messageId, toolCalls: result.toolCalls }],
      }))
    } catch (failure) {
      if (!current()) return
      patch(key, { error: copy().tester.replyFailed(describeError(failure)) })
    } finally {
      if (current()) patch(key, { pending: false })
    }
  }

  const retry = () => {
    const lastUser = [...messages].reverse().find((message) => message.role === 'user')
    if (!lastUser) return
    void send(lastUser.text, messages.filter((message) => message.id !== lastUser.id))
  }

  const sendReminder = (index: number) => {
    const used = target ? localized(target, lead) : null
    const reminder = used?.reminders[index]
    if (!target || !used || !reminder?.text.trim() || pending) return
    const kind = `reminder_${index + 1}` as ReminderKind
    const text = personalize(reminder.text, lead, used.lang).trim()
    const conversationId = session.conversationId
    const id = newId()
    patch(targetKey, (live) => ({ messages: [...live.messages, { id, role: 'agent', text, at: Date.now(), kind }] }))
    void recordReminder({
      conversationId,
      versionId: target.versionId,
      versionNumber: target.versionNumber,
      isDraft: target.isDraft,
      source,
      opener: openerPreview(used.opener, lead, used.lang),
      text,
      kind,
    }).catch(() => undefined)
  }

  const rate = (id: string, value: 'up' | 'down') => {
    const target = messages.find((message) => message.id === id)
    if (!target) return
    const next = target.feedback === value ? null : value
    patch(targetKey, (live) => ({ messages: live.messages.map((message) => (message.id === id ? { ...message, feedback: next } : message)) }))
    if (target.serverId) void setFeedback(target.serverId, next).catch(() => undefined)
  }

  return { messages, pending, error, composer, setComposer, send, retry, reset, rate, sendReminder, conversationId: session.conversationId }
}

export type TestChatStore = ReturnType<typeof useTestChat>
