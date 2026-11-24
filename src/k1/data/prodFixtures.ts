import type {
  Bands, Batch, ConversationDetail, ConversationFilter, ConversationItem, ConversationStatus, Controls, Delivery, HomeData,
  LeadItem, LeadStatus, MatrixRow, Performance, Range, SettingsPatch, Step,
} from './prodApi'

// Invented records in the shape of the brief's example responses. Names, plates and numbers are not real customers.

const STATIONS = [
  { id: 1466, name: 'Mikkeli Pitkäjärvi' },
  { id: 1461, name: 'Salo Meriniitty' },
  { id: 1462, name: 'Rauma Papinhaka' },
  { id: 1488, name: 'Kemi Karjalahti' },
]
const FIRST = ['Matti', 'Liisa', 'Juha', 'Anna', 'Timo', 'Sari', 'Mikko', 'Kaisa', 'Jari', 'Tiina', 'Pekka', 'Hanna', 'Antti', 'Elina', 'Ville', 'Johanna', 'Erik', 'Maria', 'Lauri', 'Noora']
const LAST = ['Virtanen', 'Korhonen', 'Mäkinen', 'Nieminen', 'Mäkelä', 'Hämäläinen', 'Laine', 'Heikkinen', 'Koskinen', 'Järvinen', 'Lehtonen', 'Lindqvist']
const LETTERS = 'ABCEFGHIJKLMNOPRSTUVXYZ'
const DAY = 86_400_000

let seed = 20261124
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}
const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)]
const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1))

const now = Date.now()
const isoDay = (time: number) => new Date(time).toISOString().slice(0, 10)
const at = (time: number) => new Date(time).toISOString()
const weekStart = (time: number) => {
  const date = new Date(time)
  const offset = (date.getUTCDay() + 6) % 7
  return isoDay(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - offset))
}
const masked = (digits: string) => `+358 40 ••• ••${digits.slice(-2)}`
const full = (digits: string) => `+358 40 000 ${digits.slice(0, 2)} ${digits.slice(2)}`
const plate = () => `${LETTERS[int(0, 22)]}${LETTERS[int(0, 22)]}${LETTERS[int(0, 22)]}-${int(10, 999)}`
const fiDate = (time: number) => {
  const date = new Date(time)
  return `${date.getUTCDate()}.${date.getUTCMonth() + 1}.`
}

type Person = { name: string; short: string; digits: string; plate: string; station: string; language: string; deadline: number }

function person(): Person {
  const first = pick(FIRST)
  const last = pick(LAST)
  return {
    name: `${first} ${last}`,
    short: `${first} ${last[0]}.`,
    digits: String(int(1000, 9999)),
    plate: plate(),
    station: pick(STATIONS).name,
    language: random() < 0.85 ? 'fi' : random() < 0.5 ? 'sv' : 'en',
    deadline: now + int(-3, 30) * DAY,
  }
}

type StoredConversation = { item: ConversationItem; detail: ConversationDetail }

function opener(who: Person) {
  if (who.language === 'sv') return `Hej! Det är K1 Katsastus ${who.station}. Det är snart dags att besikta bilen ${who.plate}. Vill du att jag hjälper dig hitta en tid? 😊`
  if (who.language === 'en') return `Hi! It's K1 Katsastus ${who.station}. Your car ${who.plate} is, according to our data, due for inspection soon. Want me to find a time that works for you? 😊`
  return `Hei! Täällä K1 Katsastus ${who.station}. Autosi ${who.plate} katsastusaika lähestyy tietojemme mukaan. Haluatko, että etsin sinulle sopivan ajan? 😊`
}

function conversation(index: number, status: ConversationStatus): StoredConversation {
  const who = person()
  const id = `c_${100 + index}`
  const start = now - int(1, 9) * DAY - int(0, 8) * 3_600_000
  const messages: ConversationDetail['messages'] = [{ from: 'bot', text: opener(who), at: at(start), kind: 'reminder', step: 'opener' }]
  const reminders: ConversationDetail['reminders'] = [{ step: 'opener', sent_at: at(start), delivery: status === 'no_answer' ? 'delivered' : 'read' }]
  const bookings: ConversationDetail['bookings'] = []
  let outcome: string | null = null
  let reason: string | null = null
  let waiting: string | null = null
  const reply = start + int(10, 300) * 60_000
  if (status === 'booked') {
    const slot = now + int(3, 12) * DAY
    const number = `${LETTERS[int(0, 22)]}${LETTERS[int(0, 22)]}${int(10, 99)}${LETTERS[int(0, 22)]}${LETTERS[int(0, 22)]}${int(10, 99)}`
    messages.push(
      { from: 'customer', text: 'Joo, ensi viikolla kävisi', at: at(reply) },
      { from: 'bot', text: `${fiDate(slot)} olisi vapaana klo 9.30, 11.15 tai 14.00. Mikä näistä sopii?`, at: at(reply + 20_000) },
      { from: 'customer', text: '11.15', at: at(reply + 180_000) },
      { from: 'bot', text: `Varattu ${fiDate(slot)} klo 11.15, K1 Katsastus ${who.station}, ${who.plate}. Varausnumero *${number}*.`, at: at(reply + 200_000), buttons: ['Muu aika'] },
    )
    bookings.push({ booking_number: number, station: who.station, time: at(slot), price_eur: 68, green: random() < 0.3, status: 'confirmed' })
    outcome = 'booked'
  } else if (status === 'needs_reply') {
    waiting = at(now - int(20, 240) * 60_000)
    messages.push(
      { from: 'customer', text: 'Voinko puhua jonkun kanssa? Autossa on vikaa jarruissa.', at: waiting },
      { from: 'bot', text: 'Välitin viestisi asemalle. Henkilökunta ottaa sinuun yhteyttä mahdollisimman pian.', at: at(new Date(waiting).getTime() + 15_000) },
    )
    outcome = 'handoff'
  } else if (status === 'stopped') {
    messages.push(
      { from: 'customer', text: 'Lopeta viestit', at: at(reply) },
      { from: 'bot', text: 'Selvä, en lähetä enää muistutuksia tähän numeroon.', at: at(reply + 12_000) },
    )
    outcome = 'stopped'
    reason = 'asked to stop'
  } else if (status === 'no_answer') {
    const second = start + 7 * DAY
    if (second < now) {
      messages.push({ from: 'bot', text: `Muistutus: autosi ${who.plate} katsastus lähestyy. Vastaa tähän viestiin, niin etsin sopivan ajan.`, at: at(second), kind: 'reminder', step: 'reminder_1' })
      reminders.push({ step: 'reminder_1', sent_at: at(second), delivery: 'delivered' })
    }
  } else {
    messages.push(
      { from: 'customer', text: 'Paljonko katsastus maksaa?', at: at(reply) },
      { from: 'bot', text: 'Henkilöauton määräaikaiskatsastus maksaa 68 €. Haluatko, että katson vapaita aikoja?', at: at(reply + 18_000) },
    )
  }
  const last = messages[messages.length - 1]
  return {
    item: {
      id, name: who.short, phone: masked(who.digits), plate: who.plate, station: who.station, language: who.language, status,
      started_by: 'opener', last_message_at: last.at, last_from: last.from, waiting_since: waiting,
    },
    detail: {
      conversation: { id, status, outcome, reason, bot_build: 'prod1' },
      customer: { name: who.name, phone: full(who.digits), plate: who.plate, station: who.station, language: who.language, deadline: isoDay(who.deadline) },
      reminders, messages, bookings,
    },
  }
}

const STATUS_PLAN: ConversationStatus[] = ['booked', 'no_answer', 'open', 'booked', 'needs_reply', 'no_answer', 'booked', 'stopped', 'no_answer', 'open', 'booked', 'no_answer', 'needs_reply', 'booked', 'no_answer', 'booked', 'stopped', 'no_answer', 'open', 'booked', 'no_answer', 'booked', 'no_answer', 'booked', 'open', 'no_answer']
const CONVERSATIONS = STATUS_PLAN.map((status, index) => conversation(index, status))
  .sort((a, b) => b.item.last_message_at.localeCompare(a.item.last_message_at))

const NEXT: Record<Step, Step | null> = { opener: 'reminder_1', reminder_1: 'reminder_2', reminder_2: 'reminder_3', reminder_3: null }
const LEAD_STATUS: LeadStatus[] = ['waiting', 'waiting', 'waiting', 'in_sequence', 'in_sequence', 'in_sequence', 'in_sequence', 'replied', 'booked', 'left_list', 'failed', 'holdout', 'closed']

const LEADS: LeadItem[] = [
  ...CONVERSATIONS.map(({ item, detail }, index): LeadItem => {
    const status: LeadStatus = item.status === 'booked' ? 'booked' : item.status === 'stopped' ? 'stopped' : item.status === 'no_answer' ? 'in_sequence' : 'replied'
    const lastReminder = detail.reminders[detail.reminders.length - 1]
    const next = status === 'in_sequence' ? NEXT[lastReminder.step] : null
    return {
      id: `l_${400 + index}`, station: item.station, plate: item.plate, phone: item.phone, language: item.language, vehicle: 'M1', product: random() < 0.8 ? '004' : '004e',
      deadline: detail.customer.deadline, days_left: Math.round((new Date(detail.customer.deadline).getTime() - now) / DAY), status, holdout: false,
      last_message: lastReminder, next_message: next ? { step: next, due_on: isoDay(now + int(1, 6) * DAY) } : null, conversation_id: item.id,
    }
  }),
  ...Array.from({ length: 94 }, (_, index): LeadItem => {
    const who = person()
    const status = pick(LEAD_STATUS)
    const days = Math.max(0, int(0, 30))
    const sent = status !== 'waiting' && status !== 'holdout'
    const delivery: Delivery = status === 'failed' ? 'failed' : random() < 0.6 ? 'read' : 'delivered'
    return {
      id: `l_${500 + index}`, station: who.station, plate: who.plate, phone: masked(who.digits), language: who.language, vehicle: random() < 0.9 ? 'M1' : 'N1', product: random() < 0.8 ? '004' : '004e',
      deadline: isoDay(now + days * DAY), days_left: days, status, holdout: status === 'holdout',
      last_message: sent ? { step: 'opener', sent_at: at(now - int(1, 8) * DAY), delivery } : null,
      next_message: status === 'waiting' ? { step: 'opener', due_on: isoDay(now + int(0, 3) * DAY) } : status === 'in_sequence' ? { step: 'reminder_1', due_on: isoDay(now + int(1, 6) * DAY) } : null,
      conversation_id: null,
    }
  }),
].sort((a, b) => a.days_left - b.days_left)

const settings: Omit<Controls, 'can_edit' | 'batch' | 'history'> = {
  outreach_on: true,
  bot_on: true,
  stations: STATIONS.map((station) => ({ ...station, first_messages_on: true, reminders_on: true })),
  window: { min_days: 2, max_days: 21 },
  timing: { reminder_1_days_before: 10, reminder_2_days_before: 3, reminder_3_days_after: 3, gap_after_opener_days: 7, gap_between_days: 4 },
  daily_cap: 50,
  sending_hours: { days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00', timezone: 'Europe/Helsinki' },
  holdout_percent: 10,
  release: 'manual',
}

let batch: Batch = {
  id: 'b_789',
  status: 'proposed',
  created_at: at(now - 3 * 3_600_000),
  total: 50,
  by_station: [{ station: 'Mikkeli Pitkäjärvi', count: 13 }, { station: 'Salo Meriniitty', count: 14 }, { station: 'Rauma Papinhaka', count: 12 }, { station: 'Kemi Karjalahti', count: 11 }],
  by_message: [{ step: 'opener', count: 38 }, { step: 'reminder_1', count: 9 }, { step: 'reminder_2', count: 3 }],
}

const history = Array.from({ length: 10 }, (_, index) => {
  const sent = index === 0 ? 0 : int(30, 50)
  const failed = sent ? int(0, 3) : 0
  return { date: isoDay(now - index * DAY), sent, delivered: sent - failed, failed }
})

const counts = (items: ConversationItem[]) => ({
  all: items.length,
  needs_reply: items.filter((item) => item.status === 'needs_reply').length,
  no_answer: items.filter((item) => item.status === 'no_answer').length,
  booked: items.filter((item) => item.status === 'booked').length,
  stopped: items.filter((item) => item.status === 'stopped').length,
})

function page<T>(items: T[], cursor: unknown, limit: unknown) {
  const start = Number(cursor) || 0
  const size = Math.max(1, Math.min(200, Number(limit) || 50))
  const end = start + size
  return { items: items.slice(start, end), next_cursor: end < items.length ? String(end) : null }
}

function matches(text: string, search: unknown) {
  const needle = String(search ?? '').trim().toLowerCase()
  return !needle || text.toLowerCase().includes(needle)
}

function bands(items: LeadItem[]): Bands {
  const count = (min: number, max: number) => items.filter((item) => item.days_left >= min && item.days_left <= max).length
  return { '0-6': count(0, 6), '7-13': count(7, 13), '14-20': count(14, 20), '21-30': count(21, 30) }
}

function home(): HomeData {
  const items = CONVERSATIONS.map((entry) => entry.item)
  const handoffs = items.filter((item) => item.status === 'needs_reply').length
  const failed = LEADS.filter((lead) => lead.status === 'failed').length
  const weeks = Array.from({ length: 8 }, (_, index) => ({ week_start: weekStart(now - (7 - index) * 7 * DAY), booked: index < 2 ? 0 : int(4, 15) }))
  weeks[7].booked = items.filter((item) => item.status === 'booked').length
  return {
    status: {
      outreach_on: settings.outreach_on,
      bot_on: settings.bot_on,
      stations_sending: settings.stations.filter((station) => station.first_messages_on || station.reminders_on).length,
      stations_total: settings.stations.length,
      last_send_at: at(now - 95 * 60_000),
      messages_today: 38,
    },
    needs_you: [
      ...(batch.status === 'proposed' ? [{ kind: 'batch_waiting', count: batch.total, title: `Batch of ${batch.total} waiting for release`, link: 'control' }] : []),
      ...(handoffs ? [{ kind: 'handoff', count: handoffs, title: `${handoffs} customers asked for a person`, link: 'conversations?filter=needs_reply' }] : []),
      ...(failed ? [{ kind: 'delivery_failed', count: failed, title: `${failed} messages failed to deliver`, link: 'leads?status=failed' }] : []),
    ],
    this_week: { from: weekStart(now), to: isoDay(new Date(weekStart(now)).getTime() + 6 * DAY), sent: 214, delivered: 207, replied: 61, booked: weeks[7].booked, bookings_per_week: weeks },
    value: { delivered_contacts: 712, converted: 94, rate: 94 / 712 },
    leads_left: { in_window: LEADS.filter((lead) => lead.status === 'waiting' && lead.days_left >= settings.window.min_days && lead.days_left <= settings.window.max_days).length, window: settings.window },
  }
}

function performance(range: Range): Performance {
  const weekCount = range === 'week' ? 1 : range === 'month' ? 4 : 8
  const weeks = Array.from({ length: weekCount }, (_, index) => weekStart(now - (weekCount - 1 - index) * 7 * DAY))
  const matrix: MatrixRow[] = weeks.flatMap((week) => STATIONS.map((station) => {
    const eligible = int(45, 70)
    const holdout = Math.round(eligible * 0.1)
    const sent = eligible - holdout
    const delivered = sent - int(0, 2)
    const read = Math.round(delivered * 0.82)
    const replied = Math.round(delivered * (0.24 + random() * 0.1))
    const bookedInChat = Math.round(replied * 0.45)
    const leftList = int(1, 5)
    const converted = bookedInChat + leftList
    const holdoutConverted = int(0, 1)
    return {
      week_start: week, station: station.name, eligible, holdout, sent, delivered, read, replied, booked_in_chat: bookedInChat, left_list: leftList,
      converted, holdout_converted: holdoutConverted, uplift: holdout ? converted / delivered - holdoutConverted / holdout : null,
      stops: int(0, 2), handoffs: int(0, 2), open: int(0, 4), billable: bookedInChat,
    }
  }))
  const sum = (key: keyof MatrixRow) => matrix.reduce((total, row) => total + (typeof row[key] === 'number' ? row[key] as number : 0), 0)
  const delivered = sum('delivered')
  const converted = sum('converted')
  const holdout = sum('holdout')
  const holdoutConverted = sum('holdout_converted')
  return {
    range,
    funnel: {
      sent: sum('sent'), delivered, read: sum('read'), replied: sum('replied'), booked_in_chat: sum('booked_in_chat'), left_list: sum('left_list'), converted,
      rate: delivered ? converted / delivered : null, holdout, holdout_converted: holdoutConverted,
      uplift: holdout >= 20 && delivered ? converted / delivered - holdoutConverted / holdout : null,
    },
    bookings_per_week: weeks.map((week) => {
      const rows = matrix.filter((row) => row.week_start === week)
      const total = rows.reduce((value, row) => value + row.converted, 0)
      const after = Math.round(total * 0.18)
      return { week_start: week, before_deadline: total - after, after_deadline: after }
    }),
    by_station: STATIONS.map((station) => {
      const rows = matrix.filter((row) => row.station === station.name)
      const stationDelivered = rows.reduce((value, row) => value + row.delivered, 0)
      const stationConverted = rows.reduce((value, row) => value + row.converted, 0)
      return { station: station.name, delivered: stationDelivered, converted: stationConverted, rate: stationDelivered ? stationConverted / stationDelivered : null }
    }),
    send_hours: [1, 2, 3, 4, 5].flatMap((weekday) => Array.from({ length: 9 }, (_, offset) => {
      const sends = Math.round(int(0, 40) * weekCount / 2)
      const replyRate = sends ? 0.12 + random() * 0.3 : null
      return { weekday, hour: 9 + offset, sends, reply_rate: replyRate, booking_rate: replyRate === null ? null : replyRate * (0.35 + random() * 0.3) }
    })),
    by_message: (['opener', 'reminder_1', 'reminder_2', 'reminder_3'] as Step[]).map((step, index) => {
      const sent = Math.round(sum('sent') / (index + 1) / (index ? 1.6 : 1))
      const replied = Math.round(sent * (0.28 - index * 0.05))
      return { step, sent, replied, converted: Math.round(replied * 0.5) }
    }),
    matrix,
    reasons: [
      { label: 'already booked elsewhere', count: Math.round(weekCount * 4.5) },
      { label: 'car sold or scrapped', count: Math.round(weekCount * 2.2) },
      { label: 'wants to call the station', count: Math.round(weekCount * 1.8) },
      { label: 'price', count: Math.round(weekCount * 1.1) },
    ],
  }
}

function controls(): Controls {
  return { ...structuredClone(settings), can_edit: true, batch: { ...batch }, history }
}

function applyPatch(patch: SettingsPatch) {
  const range = patch.window ?? settings.window
  if (range.min_days < 0 || range.max_days > 30 || range.min_days > range.max_days) throw { error: 'invalid_window', status: 400 }
  const timing = patch.timing ? { ...settings.timing, ...patch.timing } : settings.timing
  if (timing.reminder_2_days_before >= timing.reminder_1_days_before) throw { error: 'invalid_timing', status: 400 }
  if (patch.daily_cap !== undefined && (patch.daily_cap < 0 || patch.daily_cap > 1000)) throw { error: 'invalid_daily_cap', status: 400 }
  Object.assign(settings, structuredClone(patch), { timing })
  if (patch.stations) settings.stations = settings.stations.map((station) => ({ ...station, ...patch.stations?.find((item) => item.id === station.id) }))
}

function respond(path: string, method: string, query: Record<string, unknown>, body: unknown) {
  if (path === 'home') return home()
  if (path === 'conversations') {
    const filter = (query.filter as ConversationFilter) || 'all'
    const searched = CONVERSATIONS.map((entry) => entry.item).filter((item) => matches(`${item.name} ${item.phone} ${item.plate}`, query.search) && (!query.station || item.station === query.station))
    const shown = filter === 'all' ? searched : searched.filter((item) => item.status === filter)
    return { counts: counts(searched), ...page(shown, query.cursor, query.limit) }
  }
  if (path === 'conversation') {
    const found = CONVERSATIONS.find((entry) => entry.item.id === query.id)
    if (!found) throw { error: 'not_found', status: 404 }
    return found.detail
  }
  if (path === 'leads') {
    const min = query.min_days === undefined ? 0 : Number(query.min_days)
    const max = query.max_days === undefined ? 30 : Number(query.max_days)
    const shown = LEADS.filter((lead) => (!query.station || lead.station === query.station)
      && (!query.status || lead.status === query.status)
      && lead.days_left >= min && lead.days_left <= max
      && matches(`${lead.plate} ${lead.phone}`, query.search))
    return { total: shown.length, bands: bands(shown), ...page(shown, query.cursor, query.limit) }
  }
  if (path === 'performance') return performance((query.range as Range) || 'all')
  if (path === 'controls' && method === 'GET') return controls()
  if (path === 'controls') {
    applyPatch(body as SettingsPatch)
    return controls()
  }
  if (path === 'batch/release' || path === 'batch/hold') {
    batch = { ...batch, status: path === 'batch/release' ? 'released' : 'held' }
    return batch
  }
  throw { error: 'not_found', status: 404 }
}

export function fixtureResponse(path: string, method: string, query: Record<string, unknown>, body: unknown, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      try {
        resolve({ ok: true, ...structuredClone(respond(path, method, query, body)) })
      } catch (failure) {
        reject(failure)
      }
    }, 250 + Math.round(random() * 250))
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })
}
