export type StagingLink = { url: string; label: string }
export type StagingCopy = { label: string; code: string }

export type StagingPart = {
  text: string
  link: StagingLink | null
  copy: StagingCopy | null
  replies: string[]
  // Structured bubbles are the buttons WhatsApp showed. Marker lines are the readable fallback.
  live: boolean
}

type BubbleInput = {
  role: 'user' | 'agent'
  text: string
  bubbles?: unknown
}

const LINK_LINE = /^\[link button:\s*(.+?)\s*(?:→|->)\s*(https?:\/\/\S+?)\]$/i
const REPLIES_LINE = /^\[reply buttons:\s*(.+)\]$/i
const TAP_LINE = /^\[button\]\s*(.+)$/i

function httpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : ''
  } catch {
    return ''
  }
}

function replyLabels(value: string) {
  return value.split(/\s*(?:·|\|)\s*/).map((item) => item.trim()).filter(Boolean)
}

function copyButton(value: unknown): StagingCopy | null {
  if (!value || typeof value !== 'object') return null
  const row = value as { label?: unknown; code?: unknown }
  const code = typeof row.code === 'string' ? row.code.trim() : ''
  if (!code) return null
  const label = typeof row.label === 'string' && row.label.trim() ? row.label.trim() : code
  return { label, code }
}

function structured(value: unknown): StagingPart[] | null {
  let raw = value
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { return null }
  }
  if (!Array.isArray(raw) || raw.length === 0) return null
  const parts: StagingPart[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as { text?: unknown; link?: unknown; copy?: unknown; replies?: unknown }
    const link = row.link && typeof row.link === 'object'
      ? row.link as { url?: unknown; label?: unknown }
      : null
    const url = link && typeof link.url === 'string' ? httpUrl(link.url) : ''
    const replies = Array.isArray(row.replies) ? row.replies.filter((reply): reply is string => typeof reply === 'string' && reply.trim() !== '').map((reply) => reply.trim()) : []
    parts.push({
      text: typeof row.text === 'string' ? row.text.trim() : '',
      link: url ? { url, label: typeof link?.label === 'string' && link.label.trim() ? link.label.trim() : url } : null,
      copy: copyButton(row.copy),
      replies,
      live: true,
    })
  }
  return parts.length ? parts : null
}

function fromText(text: string): StagingPart[] {
  const parts: StagingPart[] = []
  let buffer: string[] = []
  const flush = () => {
    const joined = buffer.join('\n').trim()
    buffer = []
    if (joined) parts.push({ text: joined, link: null, copy: null, replies: [], live: false })
  }
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim()
    const link = line.match(LINK_LINE)
    const replies = line.match(REPLIES_LINE)
    const tap = line.match(TAP_LINE)
    if (link) {
      flush()
      const url = httpUrl(link[2])
      if (url) parts.push({ text: '', link: { label: link[1].trim(), url }, copy: null, replies: [], live: false })
    } else if (replies) {
      flush()
      const labels = replyLabels(replies[1])
      if (labels.length) parts.push({ text: '', link: null, copy: null, replies: labels, live: false })
    } else if (tap) {
      flush()
      parts.push({ text: tap[1].trim(), link: null, copy: null, replies: [], live: false })
    } else {
      buffer.push(raw)
    }
  }
  flush()
  return parts
}

export function stagingParts(message: BubbleInput): StagingPart[] {
  const saved = structured(message.bubbles)
  if (saved) return saved
  const parsed = fromText(message.text)
  return parsed.length ? parsed : [{ text: message.text || '', link: null, copy: null, replies: [], live: false }]
}

export type WhatsAppRun = { bold: boolean; value: string }

// WhatsApp uses *bold*. A space inside the markers, or a marker that runs onto the next line, stays as typed.
const BOLD = /\*([^*\n]+)\*/g

export function whatsappRuns(text: string): WhatsAppRun[] {
  const runs: WhatsAppRun[] = []
  let cursor = 0
  for (const match of text.matchAll(BOLD)) {
    const inner = match[1]
    const start = match.index ?? 0
    if (!inner || /^\s|\s$/.test(inner) || start < cursor) continue
    if (start > cursor) runs.push({ bold: false, value: text.slice(cursor, start) })
    runs.push({ bold: true, value: inner })
    cursor = start + match[0].length
  }
  if (cursor < text.length || runs.length === 0) runs.push({ bold: false, value: text.slice(cursor) })
  return runs
}

export function pickConversation(current: string | null, rows: { conversationId: string }[]) {
  if (current && rows.some((row) => row.conversationId === current)) return current
  return rows[0]?.conversationId ?? null
}

export function latestActivity(sessionAt: string | null | undefined, messages: { at?: string | null }[]) {
  let best = sessionAt || ''
  let bestMs = Date.parse(best)
  if (Number.isNaN(bestMs)) bestMs = Number.NEGATIVE_INFINITY
  for (const message of messages) {
    const at = message.at || ''
    const ms = Date.parse(at)
    if (!Number.isNaN(ms) && ms >= bestMs) {
      best = at
      bestMs = ms
    }
  }
  return best
}
