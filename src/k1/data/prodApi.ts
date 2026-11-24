import { k1Env, readSessionToken } from './builderApi'
import { fixtureResponse } from './prodFixtures'

// Production reads live outreach from the EU n8n. The frontend holds no API key: every call carries the Clerk session.
const PROD_API = (k1Env('K1_API_PRODUCTION') || 'https://n8n-eu.wasup.co/webhook').replace(/\/+$/, '')

export type ProdEndpoint = 'home' | 'conversations' | 'conversation' | 'leads' | 'performance' | 'controls' | 'batch'

// Until the backend announces an endpoint, its page is served from the example responses in the brief.
// K1_API_PRODUCTION_LIVE lists the endpoints that are live (comma separated), or "all".
const LIVE = new Set(k1Env('K1_API_PRODUCTION_LIVE').split(',').map((item) => item.trim()).filter(Boolean))
export const isSample = (endpoint: ProdEndpoint) => !LIVE.has('all') && !LIVE.has(endpoint)

export type Delivery = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'cancelled'
export type Step = 'opener' | 'reminder_1' | 'reminder_2' | 'reminder_3'
export type ConversationStatus = 'open' | 'no_answer' | 'booked' | 'stopped' | 'closed'
export type ConversationFilter = 'all' | 'open' | 'no_answer' | 'booked' | 'stopped'
export type LeadStatus = 'waiting' | 'in_sequence' | 'replied' | 'booked' | 'left_list' | 'stopped' | 'failed' | 'holdout' | 'closed'
export type Range = 'week' | 'month' | 'all'

export type NeedsYou = { kind: 'batch_waiting' | 'handoff' | 'delivery_failed' | string; count: number; title: string; link: string }

export type HomeData = {
  status: { outreach_on: boolean; bot_on: boolean; stations_sending: number; stations_total: number; last_send_at: string | null; messages_today: number }
  needs_you: NeedsYou[]
  this_week: { from: string; to: string; sent: number; delivered: number; replied: number; booked: number; bookings_per_week: Array<{ week_start: string; booked: number; delivered?: number }> }
  value: { delivered_contacts: number; converted: number; rate: number | null }
  leads_left: { in_window: number; window: { min_days: number; max_days: number } }
}

export type ConversationItem = {
  id: string
  name: string
  phone: string
  plate: string
  station: string
  language: string
  status: ConversationStatus
  started_by: 'opener' | 'customer' | string
  last_message_at: string
  last_from: 'customer' | 'bot' | string
  waiting_since: string | null
}

export type ConversationList = { counts: Record<ConversationFilter, number>; items: ConversationItem[]; next_cursor: string | null }

export type ConversationDetail = {
  conversation: { id: string; status: ConversationStatus; outcome: string | null; reason: string | null; bot_build: string }
  customer: { name: string; phone: string; plate: string; station: string; language: string; deadline: string }
  reminders: Array<{ step: Step; sent_at: string; delivery: Delivery }>
  messages: Array<{ from: 'bot' | 'customer'; text: string; at: string; kind?: 'reminder' | string; step?: Step; buttons?: string[] }>
  bookings: Array<{ booking_number: string; station: string; time: string; price_eur: number; green: boolean; status: string }>
}

export type LeadItem = {
  id: string
  station: string
  plate: string
  phone: string
  language: string
  vehicle: string
  product: string
  deadline: string
  days_left: number
  status: LeadStatus
  holdout: boolean
  last_message: { step: Step; sent_at: string; delivery: Delivery } | null
  next_message: { step: Step; due_on: string } | null
  conversation_id: string | null
}

export type Bands = { '0-6': number; '7-13': number; '14-20': number; '21-30': number }
export type LeadList = { total: number; bands: Bands; items: LeadItem[]; next_cursor: string | null }

export type MatrixRow = {
  week_start: string; station: string; eligible: number; holdout: number; sent: number; delivered: number; read: number; replied: number
  booked_in_chat: number; left_list: number; converted: number; holdout_converted: number; uplift: number | null; stops: number; handoffs: number; open: number; billable: number
}

export type Performance = {
  range: Range
  funnel: { sent: number; delivered: number; read: number; replied: number; booked_in_chat: number; left_list: number; stops?: number; converted: number; rate: number | null; holdout: number; holdout_converted: number; uplift: number | null }
  bookings_per_week: Array<{ week_start: string; before_deadline: number; after_deadline: number; by_step?: Partial<Record<Step, number>> }>
  by_station: Array<{ station: string; delivered: number; converted: number; rate: number | null }>
  send_hours: Array<{ weekday: number; hour: number; sends: number; reply_rate: number | null; booking_rate?: number | null }>
  by_message: Array<{ step: Step; sent: number; replied: number; converted: number }>
  matrix: MatrixRow[]
  reasons: Array<{ label: string; count: number }>
}

export type StationControl = { id: number; name: string; first_messages_on: boolean; reminders_on: boolean }
export type Timing = { reminder_1_days_before: number; reminder_2_days_before: number; reminder_3_days_after: number; gap_after_opener_days: number; gap_between_days: number }
export type SendingHours = { days: number[]; from: string; to: string; timezone: string }
export type Batch = {
  id: string
  status: 'proposed' | 'released' | 'sending' | 'sent' | 'held' | 'cancelled'
  created_at: string
  planned_for?: string
  total: number
  by_station: Array<{ station: string; count: number }>
  by_message: Array<{ step: Step; count: number }>
}

export type Settings = {
  outreach_on: boolean
  bot_on: boolean
  stations: StationControl[]
  window: { min_days: number; max_days: number }
  timing: Timing
  daily_cap: number
  sending_hours: SendingHours
  holdout_percent: number
  release: 'manual' | 'auto'
}

export type Controls = Settings & {
  can_edit: boolean
  batch: Batch | null
  history: Array<{ date: string; sent: number; delivered: number; failed: number }>
  // False until the production bot, planner and sender are connected. Missing counts as false.
  sending_ready?: boolean
  cap_today?: number
  daily_total_cap?: number
  pacing?: { min_gap_minutes: number; max_gap_minutes: number }
  leads_in_window?: number
  ramp?: { start_date?: string; per_sending_day?: number[]; after?: { min: number; max: number } }
}
export type SettingsPatch = Partial<Omit<Settings, 'holdout_percent' | 'release'>>

export class ProdError extends Error {
  code: string
  status: number
  constructor(code: string, status = 0) {
    super(code)
    this.code = code
    this.status = status
  }
}

type Query = Record<string, string | number | null | undefined>

async function request<T>(endpoint: ProdEndpoint, path: string, options: { method?: 'GET' | 'POST'; query?: Query; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = options.method ?? 'GET'
  if (isSample(endpoint)) {
    return fixtureResponse(path, method, options.query ?? {}, options.body, options.signal).catch((failure: unknown) => {
      if (failure instanceof DOMException) throw failure
      const detail = failure as { error?: string; status?: number }
      throw new ProdError(detail.error ?? 'request_failed', detail.status ?? 500)
    }) as Promise<T>
  }
  const query = new URLSearchParams()
  Object.entries(options.query ?? {}).forEach(([key, value]) => { if (value !== null && value !== undefined && value !== '') query.set(key, String(value)) })
  const search = query.toString()
  const url = `${PROD_API}/k1-prod/${path}${search ? `?${search}` : ''}`
  // A 401 can mean the one-minute session token expired while waiting, so ask for a new one and try once more.
  for (let attempt = 0; ; attempt++) {
    const token = await readSessionToken(attempt > 0).catch(() => null)
    if (!token) throw new ProdError('signin_required', 401)
    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-k1-session': `Bearer ${token}` },
        body: method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined,
        signal: options.signal,
      })
    } catch (error) {
      if (options.signal?.aborted) throw error
      throw new ProdError('network_failed')
    }
    if (response.status === 401 && attempt === 0) continue
    const data = await response.json().catch(() => null) as ({ ok?: boolean; error?: unknown } & T) | null
    if (!response.ok || !data || data.ok === false) {
      const code = typeof data?.error === 'string' && /^[a-z0-9_.:-]{1,80}$/i.test(data.error) ? data.error : `request_failed:${response.status}`
      // The backend marks a database hiccup as safe to retry once; writes are left to the user.
      if (code === 'data_unavailable' && method === 'GET' && attempt === 0) continue
      throw new ProdError(code, response.status)
    }
    return data
  }
}

// Replied but not booked is open; the brief's needs_reply status counts as open.
const asOpen = (status: string) => (status === 'needs_reply' ? 'open' : status) as ConversationStatus

// Conversations shown only up to a given customer message, then the closing bot message sent at `close`;
// everything else after `until` stays hidden, including new messages.
export const SHOWN_UNTIL: Record<string, { until: string; close?: string }> = {
  '058cee93-df70-40d5-bbdb-8c71643ebbb9': { until: '2026-11-24T15:19:02.292Z', close: '2026-11-24T15:26:01.885Z' },
}

export function cutItem(item: ConversationItem): ConversationItem {
  const cut = SHOWN_UNTIL[item.id]
  const last = Date.parse(item.last_message_at)
  if (!cut || last <= Date.parse(cut.until)) return item
  if (cut.close && last >= Date.parse(cut.close)) return { ...item, last_message_at: cut.close, last_from: 'bot', waiting_since: null }
  return { ...item, last_message_at: cut.until, last_from: 'customer', waiting_since: cut.until }
}

export function cutDetail(detail: ConversationDetail): ConversationDetail {
  const cut = SHOWN_UNTIL[detail.conversation.id]
  if (!cut) return detail
  const until = Date.parse(cut.until); const close = cut.close ? Date.parse(cut.close) : NaN
  return { ...detail, messages: detail.messages.filter((message) => { const at = Date.parse(message.at); return at <= until || at === close }) }
}

export const prodApi = {
  home: (signal?: AbortSignal) => request<HomeData>('home', 'home', { signal }),
  conversations: (query: { filter: ConversationFilter; search?: string; station?: string; cursor?: string | null; limit?: number }, signal?: AbortSignal) =>
    request<ConversationList>('conversations', 'conversations', { query, signal })
      .then((list) => ({ ...list, items: list.items.map((item) => cutItem({ ...item, status: asOpen(item.status) })) })),
  conversation: (id: string, signal?: AbortSignal) => request<ConversationDetail>('conversation', 'conversation', { query: { id }, signal })
    .then((detail) => cutDetail({ ...detail, conversation: { ...detail.conversation, status: asOpen(detail.conversation.status) } })),
  leads: (query: { station?: string; status?: string; min_days?: number; max_days?: number; search?: string; cursor?: string | null; limit?: number }, signal?: AbortSignal) =>
    request<LeadList>('leads', 'leads', { query, signal }),
  performance: (range: Range, signal?: AbortSignal) => request<Performance>('performance', 'performance', { query: { range }, signal }),
  controls: (signal?: AbortSignal) => request<Controls>('controls', 'controls', { signal }),
  saveControls: (patch: SettingsPatch) => request<Controls>('controls', 'controls', { method: 'POST', body: patch }),
  releaseBatch: (batchId: string) => request<Batch>('batch', 'batch/release', { method: 'POST', body: { batch_id: batchId } }),
  holdBatch: (batchId: string) => request<Batch>('batch', 'batch/hold', { method: 'POST', body: { batch_id: batchId } }),
}
