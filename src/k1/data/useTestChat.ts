import { useEffect, useRef, useState } from 'react'
import { describeError, openerPreview, sendTest, type TestTarget } from './agentConfig'
import { newId, setFeedback, type ChatSource } from './builderApi'

export type TestMessage = {
  id: string
  role: 'agent' | 'user'
  text: string
  at: number
  opener?: boolean
  demo?: boolean
  feedback?: 'up' | 'down' | null
  // Id of the stored reply; null when the backend did not record the turn.
  serverId?: string | null
}

function openerMessages(opener: string): TestMessage[] {
  const text = openerPreview(opener)
  return text ? [{ id: newId(), role: 'agent', text, at: Date.now(), opener: true }] : []
}

export function useTestChat(target: TestTarget | null, source: ChatSource) {
  const [messages, setMessages] = useState<TestMessage[]>(() => openerMessages(target?.opener ?? ''))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [composer, setComposer] = useState('')
  const conversationRef = useRef(newId())
  const targetKey = target ? `${target.isDraft ? 'draft' : target.versionId}` : 'none'

  const hasUserMessages = messages.some((message) => message.role === 'user')

  // The opener tracks edits until the conversation starts.
  useEffect(() => {
    if (!target || hasUserMessages) return
    setMessages(openerMessages(target.opener))
  }, [target?.opener, targetKey])

  const reset = () => {
    conversationRef.current = newId()
    setPending(false)
    setError(null)
    setComposer('')
    setMessages(openerMessages(target?.opener ?? ''))
  }

  // Switching version starts a fresh conversation for that version.
  const lastKey = useRef(targetKey)
  useEffect(() => {
    if (lastKey.current === targetKey) return
    lastKey.current = targetKey
    reset()
  }, [targetKey])

  const send = async (text = composer, base = messages) => {
    const body = text.trim()
    if (!body || !target || pending) return
    const conversationId = conversationRef.current
    const userMessage: TestMessage = { id: newId(), role: 'user', text: body, at: Date.now() }
    const history = [...base, userMessage]
    setMessages(history)
    setComposer('')
    setPending(true)
    setError(null)
    try {
      const result = await sendTest(target, history.map(({ role, text: line }) => ({ role, text: line })), { conversationId, source })
      if (conversationId !== conversationRef.current) return
      setMessages((list) => [...list, {
        id: newId(), role: 'agent', text: result.reply, at: Date.now(), demo: result.demo, feedback: null, serverId: result.messageId,
      }])
    } catch (failure) {
      if (conversationId !== conversationRef.current) return
      setError(`The test reply failed (${describeError(failure)}).`)
    } finally {
      if (conversationId === conversationRef.current) setPending(false)
    }
  }

  const retry = () => {
    const lastUser = [...messages].reverse().find((message) => message.role === 'user')
    if (!lastUser) return
    void send(lastUser.text, messages.filter((message) => message.id !== lastUser.id))
  }

  const rate = (id: string, value: 'up' | 'down') => {
    const target = messages.find((message) => message.id === id)
    if (!target) return
    const next = target.feedback === value ? null : value
    setMessages((list) => list.map((message) => (message.id === id ? { ...message, feedback: next } : message)))
    if (target.serverId) void setFeedback(target.serverId, next).catch(() => undefined)
  }

  return { messages, pending, error, composer, setComposer, send, retry, reset, rate, conversationId: conversationRef.current }
}

export type TestChatStore = ReturnType<typeof useTestChat>
