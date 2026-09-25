const BASE = import.meta.env?.VITE_N8N_BUILDER_BASE_URL as string | undefined
const TOKEN = import.meta.env?.VITE_N8N_BUILDER_PUBLIC_TOKEN as string | undefined
export const TENANT_KEY = 'k1_katsastus_demo'
export const remote = Boolean(BASE)

export type Reminder = { text: string; days: number | null }

export type Translation = { opener: string; reminders: Reminder[] }
export type Translations = Partial<Record<'fi' | 'sv', Translation>>

export type UploadedLead = {
  id: string
  stationName: string
  isClosed: boolean
  plateNumber: string
  product: string
  nextInspection: string | null
  phoneNumber: string
  language: string
  lastInspection: string | null
  reason: string
  createdAt: string
}

export type LeadRow = {
  StationName: string
  isClosed: boolean
  PlateNumber: string
  Product: string
  NextInspectionDateRangeEnd: string
  PhoneNumber: string
  Language: string
  LastInspection: string
  Reason: string
}

export type VersionRecord = {
  id: string
  versionNumber: number
  masterPrompt: string
  additionalInformation: string
  openingMessage: string
  reminders?: Reminder[]
  translations?: Translations
  note: string
  savedBy: string | null
  createdAt: string
  isActive: boolean
  thumbsUp: number
  thumbsDown: number
  conversations: number
}

export type DeployRequestStatus = 'requested' | 'deployed' | 'superseded'

export type DeployRequest = {
  id: string
  versionId: string
  versionNumber: number
  requestedBy: string
  goLive: string
  notes: string
  status: DeployRequestStatus
  createdAt: string
  deployedAt: string | null
  deployedBy: string | null
}

export type BuilderState = {
  displayName: string
  locked: boolean
  activeVersionId: string | null
  liveVersionId: string | null
  liveSince: string | null
  liveBy: string | null
  versions: VersionRecord[]
  deployRequests: DeployRequest[]
  // False while the backend still only has the original config endpoints.
  tracking: boolean
}

export type Feedback = 'up' | 'down' | null
export type ChatSource = 'playground' | 'compare'

export type TestChatSummary = {
  id: string
  versionId: string | null
  versionNumber: number | null
  isDraft: boolean
  source: ChatSource
  title: string
  startedBy: string | null
  createdAt: string
  updatedAt: string
  messageCount: number
  thumbsUp: number
  thumbsDown: number
  lastReply: string
}

export type TestChatMessage = {
  id: string
  role: 'user' | 'agent'
  text: string
  isOpener: boolean
  kind?: string | null
  feedback: Feedback
  createdAt: string
}

export type TestChat = { conversation: TestChatSummary; messages: TestChatMessage[] }

export type TestChatFilters = {
  versions: number[]
  includeDraft: boolean
  feedback: 'up' | 'down' | 'none' | null
  source: ChatSource | null
  from: string | null
  to: string | null
  query: string
}

export type TurnInput = {
  conversationId: string
  versionId: string | null
  versionNumber: number | null
  isDraft: boolean
  source: ChatSource
  opener: string
  masterPrompt: string
  additionalInformation: string
  history: Array<{ role: 'agent' | 'user'; text: string }>
}

export type TurnResult = {
  reply: string
  demo: boolean
  recorded: boolean
  messageId: string | null
  userMessageId: string | null
}

export type SaveInput = {
  displayName: string
  masterPrompt: string
  openingMessage: string
  additionalInformation: string
  reminders: Reminder[]
  translations: Translations
  locked: boolean
  note: string
  savedBy: string | null
}

export type DeployRequestInput = {
  versionId: string
  requestedBy: string
  email: string
  goLive: string
  notes: string
}

export const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`)

const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

let sessionToken: (() => Promise<string | null>) | null = null
export const setSessionTokenProvider = (provider: (() => Promise<string | null>) | null) => { sessionToken = provider }

export class AccessError extends Error {
  reason: 'signin_required' | 'team_required'
  constructor(reason: 'signin_required' | 'team_required') {
    super(reason)
    this.reason = reason
  }
}

async function secure<T>(action: string, body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  let token: string | null = null
  try {
    token = sessionToken ? await sessionToken() : null
  } catch {
    throw new AccessError('signin_required')
  }
  if (!token) throw new AccessError('signin_required')
  let response: Response
  try {
    response = await fetch(`${BASE}/secure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-K1-Session': token },
      body: JSON.stringify({ action, ...body }),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('network_failed')
  }
  const data = await response.json().catch(() => null) as ({ error?: string } & T) | null
  if (response.status === 401) throw new AccessError('signin_required')
  if (response.status === 403) throw new AccessError('team_required')
  if (!response.ok || !data) throw new Error(`request_failed:${response.status}`)
  return data
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) throw new Error(`request_failed:${response.status}`)
  return await response.json() as T
}

// ---------- Offline store (no backend configured) ----------

type LocalStore = {
  versions: VersionRecord[]
  liveVersionId: string | null
  liveSince: string | null
  locked: boolean
  deployRequests: DeployRequest[]
  chats: Array<TestChat>
  leads?: UploadedLead[]
}

const LOCAL_KEY = 'k1-builder-local-v2'

function readLocal(): LocalStore {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY)
    if (raw) return JSON.parse(raw) as LocalStore
  } catch { /* fall through to an empty store */ }
  return { versions: [], liveVersionId: null, liveSince: null, locked: false, deployRequests: [], chats: [] }
}

function writeLocal(store: LocalStore) {
  window.localStorage.setItem(LOCAL_KEY, JSON.stringify(store))
}

function withStats(store: LocalStore): VersionRecord[] {
  return store.versions.map((version) => {
    const chats = store.chats.filter((chat) => chat.conversation.versionId === version.id && !chat.conversation.isDraft)
    const replies = chats.flatMap((chat) => chat.messages)
    return {
      ...version,
      conversations: chats.length,
      thumbsUp: replies.filter((message) => message.feedback === 'up').length,
      thumbsDown: replies.filter((message) => message.feedback === 'down').length,
    }
  })
}

function summarise(chat: TestChat): TestChatSummary {
  const replies = chat.messages.filter((message) => !message.isOpener)
  const agent = replies.filter((message) => message.role === 'agent')
  return {
    ...chat.conversation,
    messageCount: replies.length,
    thumbsUp: agent.filter((message) => message.feedback === 'up').length,
    thumbsDown: agent.filter((message) => message.feedback === 'down').length,
    lastReply: agent[agent.length - 1]?.text ?? '',
  }
}

export function matchesFilters(chat: TestChatSummary, filters: TestChatFilters, messages?: TestChatMessage[]) {
  const versionOk = filters.versions.length
    ? (chat.isDraft ? filters.includeDraft : filters.versions.includes(chat.versionNumber ?? -1))
    : (filters.includeDraft || !chat.isDraft)
  if (!versionOk) return false
  if (filters.feedback === 'up' && chat.thumbsUp === 0) return false
  if (filters.feedback === 'down' && chat.thumbsDown === 0) return false
  if (filters.feedback === 'none' && (chat.thumbsUp > 0 || chat.thumbsDown > 0)) return false
  if (filters.source && chat.source !== filters.source) return false
  if (filters.from && chat.updatedAt < filters.from) return false
  if (filters.to && chat.updatedAt >= filters.to) return false
  const query = filters.query.trim().toLowerCase()
  if (query && !(messages ?? []).some((message) => message.text.toLowerCase().includes(query)) && !chat.title.toLowerCase().includes(query)) return false
  return true
}

// ---------- Public API ----------

type LegacyConfig = {
  displayName: string
  locked: boolean
  activeVersion: { versionNumber: number }
  versions: Array<{ id: string; versionNumber: number; masterPrompt: string; additionalInformation?: string; openingMessage?: string; createdAt: string; isActive: boolean }>
}

export async function loadState(): Promise<BuilderState> {
  if (!remote) {
    await pause(300)
    const store = readLocal()
    return {
      displayName: 'K1 Katsastus',
      locked: store.locked,
      activeVersionId: store.versions.find((version) => version.isActive)?.id ?? null,
      liveVersionId: store.liveVersionId,
      liveSince: store.liveSince,
      liveBy: store.liveVersionId ? 'Wasup' : null,
      versions: withStats(store).sort((a, b) => b.versionNumber - a.versionNumber),
      deployRequests: store.deployRequests,
      tracking: true,
    }
  }
  try {
    const state = await call<Omit<BuilderState, 'tracking'> | null>(`/state?tenantKey=${TENANT_KEY}`)
    if (state && Array.isArray(state.versions)) return { ...state, tracking: true }
  } catch { /* migration not applied yet: use the original endpoint */ }
  const legacy = await call<LegacyConfig>(`/config?tenantKey=${TENANT_KEY}`)
  const versions = legacy.versions.map((version) => ({
    id: version.id,
    versionNumber: version.versionNumber,
    masterPrompt: version.masterPrompt,
    additionalInformation: version.additionalInformation ?? '',
    openingMessage: version.openingMessage ?? '',
    note: '',
    savedBy: null,
    createdAt: version.createdAt,
    isActive: version.isActive,
    thumbsUp: 0,
    thumbsDown: 0,
    conversations: 0,
  }))
  return {
    displayName: legacy.displayName,
    locked: legacy.locked,
    activeVersionId: versions.find((version) => version.isActive)?.id ?? null,
    liveVersionId: null,
    liveSince: null,
    liveBy: null,
    versions,
    deployRequests: [],
    tracking: false,
  }
}

export async function saveVersion(input: SaveInput): Promise<void> {
  if (!remote) {
    await pause(400)
    const store = readLocal()
    const number = (store.versions[0]?.versionNumber ?? 0) + 1
    store.versions = [
      {
        id: newId(), versionNumber: number, masterPrompt: input.masterPrompt,
        additionalInformation: input.additionalInformation, openingMessage: input.openingMessage, reminders: input.reminders, translations: input.translations,
        note: input.note, savedBy: input.savedBy, createdAt: new Date().toISOString(), isActive: true,
        thumbsUp: 0, thumbsDown: 0, conversations: 0,
      },
      ...store.versions.map((version) => ({ ...version, isActive: false })),
    ]
    store.locked = input.locked
    writeLocal(store)
    return
  }
  await call('/config/save', {
    method: 'POST',
    body: JSON.stringify({ tenantKey: TENANT_KEY, ...input }),
  })
}

export async function sendTurn(input: TurnInput, fallbackReply: string): Promise<TurnResult> {
  if (!remote) {
    await pause(450)
    const store = readLocal()
    let chat = store.chats.find((item) => item.conversation.id === input.conversationId)
    const now = new Date().toISOString()
    if (!chat) {
      const version = store.versions.find((item) => item.id === input.versionId)
      chat = {
        conversation: {
          id: input.conversationId, versionId: input.versionId, versionNumber: version?.versionNumber ?? input.versionNumber,
          isDraft: input.isDraft, source: input.source, title: '', startedBy: null, createdAt: now, updatedAt: now,
          messageCount: 0, thumbsUp: 0, thumbsDown: 0, lastReply: '',
        },
        messages: input.opener ? [{ id: newId(), role: 'agent', text: input.opener, isOpener: true, feedback: null, createdAt: now }] : [],
      }
      store.chats.unshift(chat)
    }
    const lastUser = [...input.history].reverse().find((message) => message.role === 'user')?.text ?? ''
    if (!chat.conversation.title) chat.conversation.title = lastUser.slice(0, 140)
    const userMessage: TestChatMessage = { id: newId(), role: 'user', text: lastUser, isOpener: false, feedback: null, createdAt: now }
    const agentMessage: TestChatMessage = { id: newId(), role: 'agent', text: fallbackReply, isOpener: false, feedback: null, createdAt: new Date().toISOString() }
    chat.messages.push(userMessage, agentMessage)
    chat.conversation.updatedAt = agentMessage.createdAt
    writeLocal(store)
    return { reply: fallbackReply, demo: true, recorded: true, messageId: agentMessage.id, userMessageId: userMessage.id }
  }
  const result = await call<{ reply: string; mode: string; recorded?: boolean; messageId?: string | null; userMessageId?: string | null }>('/chat/test', {
    method: 'POST',
    body: JSON.stringify({
      tenantKey: TENANT_KEY,
      record: true,
      conversationId: input.conversationId,
      versionId: input.versionId,
      versionNumber: input.versionNumber,
      isDraft: input.isDraft,
      source: input.source,
      opener: input.opener,
      masterPrompt: input.masterPrompt,
      additionalInformation: input.additionalInformation,
      messages: input.history.map((message) => ({ role: message.role === 'agent' ? 'assistant' : 'user', content: message.text })),
    }),
  })
  return {
    reply: result.reply,
    demo: result.mode === 'demo',
    recorded: Boolean(result.recorded),
    messageId: result.messageId ?? null,
    userMessageId: result.userMessageId ?? null,
  }
}

export async function setFeedback(messageId: string, feedback: Feedback): Promise<void> {
  if (!remote) {
    const store = readLocal()
    for (const chat of store.chats) {
      const message = chat.messages.find((item) => item.id === messageId)
      if (message) message.feedback = feedback
    }
    writeLocal(store)
    return
  }
  await call('/feedback', { method: 'POST', body: JSON.stringify({ messageId, feedback }) })
}

export async function listTestChats(filters: TestChatFilters): Promise<TestChatSummary[]> {
  if (!remote) {
    await pause(250)
    return readLocal().chats
      .map((chat) => ({ summary: summarise(chat), messages: chat.messages }))
      .filter(({ summary, messages }) => matchesFilters(summary, filters, messages))
      .map(({ summary }) => summary)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  const params = new URLSearchParams({ tenantKey: TENANT_KEY, draft: String(filters.includeDraft) })
  if (filters.versions.length) params.set('versions', filters.versions.join(','))
  if (filters.feedback) params.set('feedback', filters.feedback)
  if (filters.source) params.set('source', filters.source)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.query.trim()) params.set('q', filters.query.trim())
  const { items } = await call<{ items: TestChatSummary[] }>(`/test-chats?${params}`)
  return items
}

export async function getTestChat(id: string): Promise<TestChat | null> {
  if (!remote) {
    const chat = readLocal().chats.find((item) => item.conversation.id === id)
    return chat ? { conversation: summarise(chat), messages: chat.messages } : null
  }
  const result = await call<TestChat | { error: string }>(`/test-chat?id=${encodeURIComponent(id)}`)
  return 'error' in result ? null : result
}

export async function requestDeploy(input: DeployRequestInput): Promise<DeployRequest> {
  if (!remote) {
    await pause(500)
    const store = readLocal()
    const version = store.versions.find((item) => item.id === input.versionId)
    if (!version) throw new Error('unknown_version')
    const request: DeployRequest = {
      id: newId(), versionId: version.id, versionNumber: version.versionNumber, requestedBy: input.requestedBy,
      goLive: input.goLive, notes: input.notes, status: 'requested', createdAt: new Date().toISOString(),
      deployedAt: null, deployedBy: null,
    }
    store.deployRequests.unshift(request)
    writeLocal(store)
    return request
  }
  const result = await call<DeployRequest & { ok?: boolean; error?: string }>('/deploy/request', {
    method: 'POST',
    body: JSON.stringify({ tenantKey: TENANT_KEY, ...input }),
  })
  if (result.ok === false) throw new Error(result.error ?? 'request_failed')
  return { ...result, deployedAt: null, deployedBy: null }
}

export const registrationKey = (value: string) => value.toUpperCase().replace(/[\s-]/g, '')

export async function listLeads(): Promise<UploadedLead[]> {
  if (!remote) {
    await pause(200)
    return readLocal().leads ?? []
  }
  const { items } = await secure<{ items: UploadedLead[] }>('leads.list')
  return items
}

export async function importLeads(rows: LeadRow[]): Promise<{ inserted: number; updated: number }> {
  if (!remote) {
    await pause(500)
    const store = readLocal()
    const leads = store.leads ?? []
    let inserted = 0
    let updated = 0
    for (const row of rows) {
      const existing = leads.find((lead) => registrationKey(lead.plateNumber) === registrationKey(row.PlateNumber))
      const next = {
        stationName: row.StationName, isClosed: row.isClosed, plateNumber: row.PlateNumber, product: row.Product,
        nextInspection: row.NextInspectionDateRangeEnd || null, phoneNumber: row.PhoneNumber, language: row.Language,
        lastInspection: row.LastInspection || null, reason: row.Reason,
      }
      if (existing) { Object.assign(existing, next); updated += 1 } else {
        leads.unshift({ id: newId(), createdAt: new Date().toISOString(), ...next })
        inserted += 1
      }
    }
    store.leads = leads
    writeLocal(store)
    return { inserted, updated }
  }
  const result = await secure<{ ok: boolean; inserted?: number; updated?: number; error?: string }>('leads.import', { rows })
  if (!result.ok) throw new Error(result.error ?? 'import_failed')
  return { inserted: result.inserted ?? 0, updated: result.updated ?? 0 }
}

export type Actor = { name: string; email: string }
let actor: Actor | null = null
export const setActor = (next: Actor | null) => { actor = next }
export const currentActor = () => actor

export type MusterStation = { id: number; name: string }

export const MUSTER_STATIONS: MusterStation[] = [
  { id: 256, name: 'K1 Katsastus Jyväskylä Palokka' },
  { id: 241, name: 'K1 Katsastus Turku Itäharju' },
]

export type StationStatus = 'all' | 'open' | 'closed'

export type MusterDay = { day: string; total: number; items: LeadRow[] }

function sampleMusterDay(day: string, stationIds: number[], closed: StationStatus): MusterDay {
  const weekday = new Date(`${day}T12:00:00`).getDay()
  if (weekday === 0 || weekday === 6) return { day, total: 0, items: [] }
  const seed = Number(day.replace(/-/g, '')) % 97
  const items: LeadRow[] = MUSTER_STATIONS.filter((station) => stationIds.includes(station.id)).flatMap((station, index) =>
    Array.from({ length: 2 }, (_, offset) => {
      const number = (seed * 7 + index * 31 + offset * 13) % 900 + 100
      const isClosed = offset === 1 && seed % 5 === 0
      return {
        StationName: isClosed ? `SULJETTU ${station.name}` : station.name,
        isClosed,
        PlateNumber: `${['KLM', 'RTY', 'JKL', 'TKU'][(seed + index + offset) % 4]}-${number}`,
        Product: ['004', '004', '004e', '0040'][(seed + offset) % 4],
        NextInspectionDateRangeEnd: day,
        PhoneNumber: `+358 40 000 0${number}`,
        Language: ['Suomi', 'Suomi', 'Ruotsi', 'Englanti'][(seed + index + offset) % 4],
        LastInspection: `${Number(day.slice(0, 4)) - 1}${day.slice(4)}`,
        Reason: 'Customer relationship',
      }
    }))
  const filtered = items.filter((row) => closed === 'all' || (closed === 'closed') === row.isClosed)
  return { day, total: items.length + 40, items: filtered }
}

export async function fetchMusterDay(day: string, stationIds: number[], closed: StationStatus, signal?: AbortSignal): Promise<MusterDay> {
  if (!remote) {
    await pause(250)
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return sampleMusterDay(day, stationIds, closed)
  }
  const result = await secure<{ ok: boolean; day: string; total?: number; items?: LeadRow[]; error?: string }>('muster.fetch', { day, stationIds, closed }, signal)
  if (!result.ok) throw new Error(result.error ?? 'muster_failed')
  return { day, total: result.total ?? 0, items: result.items ?? [] }
}

export type ReminderKind = 'reminder_1' | 'reminder_2' | 'reminder_3'

export type ReminderInput = Omit<TurnInput, 'masterPrompt' | 'additionalInformation' | 'history'> & { text: string; kind: ReminderKind }

export async function recordReminder(input: ReminderInput): Promise<{ recorded: boolean; messageId: string | null }> {
  if (!remote) {
    const store = readLocal()
    let chat = store.chats.find((item) => item.conversation.id === input.conversationId)
    const now = new Date().toISOString()
    if (!chat) {
      const version = store.versions.find((item) => item.id === input.versionId)
      chat = {
        conversation: {
          id: input.conversationId, versionId: input.versionId, versionNumber: version?.versionNumber ?? input.versionNumber,
          isDraft: input.isDraft, source: input.source, title: input.text.slice(0, 140), startedBy: null, createdAt: now, updatedAt: now,
          messageCount: 0, thumbsUp: 0, thumbsDown: 0, lastReply: '',
        },
        messages: input.opener ? [{ id: newId(), role: 'agent', text: input.opener, isOpener: true, feedback: null, createdAt: now }] : [],
      }
      store.chats.unshift(chat)
    }
    const message: TestChatMessage = { id: newId(), role: 'agent', text: input.text, isOpener: false, kind: input.kind, feedback: null, createdAt: new Date().toISOString() }
    chat.messages.push(message)
    chat.conversation.updatedAt = message.createdAt
    writeLocal(store)
    return { recorded: true, messageId: message.id }
  }
  const result = await call<{ recorded: boolean; messageId?: string }>('/chat/reminder', {
    method: 'POST',
    body: JSON.stringify({ tenantKey: TENANT_KEY, ...input }),
  })
  return { recorded: result.recorded, messageId: result.messageId ?? null }
}
