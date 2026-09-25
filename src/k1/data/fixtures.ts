// Sample data for Activity and Leads. Nothing here comes from a customer system:
// names, phone numbers, e-mail addresses, and registrations are invented, and the
// UI labels every screen that reads from this module as sample data.

export const FIXTURE_NOTICE = 'Sample data — Activity and Leads are not connected to a live source yet.'

export type Channel = 'WhatsApp' | 'Playground'
export type Outcome = 'Booked' | 'Needs follow-up' | 'Handed to staff' | 'No reply'
export type Feedback = 'up' | 'down' | null

export type ThreadMessage = {
  id: string
  role: 'agent' | 'user'
  text: string
  at: string
}

export type Conversation = {
  id: string
  leadId: string | null
  customer: string | null
  registration: string | null
  channel: Channel
  outcome: Outcome
  feedback: Feedback
  station: string | null
  startedAt: string
  messages: ThreadMessage[]
}

// Lead fields mirror the Muster API record (StationName, isClosed, PlateNumber, Product,
// NextInspectionDateRangeEnd, PhoneNumber, Language, LastInspection, Reason).
export type Lead = {
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
  addedAt: string
  sample: boolean
  live?: boolean
  conversationIds: string[]
}

function thread(id: string, start: string, lines: Array<['agent' | 'user', string, number]>): ThreadMessage[] {
  const base = new Date(start).getTime()
  return lines.map(([role, text, minutes], index) => ({
    id: `${id}-m${index + 1}`,
    role,
    text,
    at: new Date(base + minutes * 60_000).toISOString(),
  }))
}

export const CONVERSATIONS: Conversation[] = [
  {
    id: 'c-1042',
    leadId: 'l-abc123',
    customer: 'Rasmus Virtanen',
    registration: 'ABC-123',
    channel: 'WhatsApp',
    outcome: 'Booked',
    feedback: 'up',
    station: 'K1 Espoo',
    startedAt: '2026-09-23T09:14:00+03:00',
    messages: thread('c-1042', '2026-09-23T09:14:00+03:00', [
      ['agent', 'Hi, this is K1 Katsastus. Your vehicle with registration ABC-123 is due for inspection soon. Would you like to book an appointment?', 0],
      ['user', 'Yes please. Thursday afternoon would work.', 6],
      ['agent', 'Thanks. Which K1 station suits you best? Once I know the station I can check Thursday afternoon for you.', 6],
      ['user', 'Espoo.', 9],
      ['agent', 'Thursday 25 September at K1 Espoo has a free slot at 14:30. Shall I book it for ABC-123?', 10],
      ['user', 'Book it.', 12],
      ['agent', 'Done — ABC-123 is booked at K1 Espoo on Thursday 25 September at 14:30. Please bring the registration certificate. You can reply here if you need to change the time.', 12],
    ]),
  },
  {
    id: 'c-1041',
    leadId: 'l-xyz441',
    customer: 'Anna Korhonen',
    registration: 'XYZ-441',
    channel: 'WhatsApp',
    outcome: 'Needs follow-up',
    feedback: null,
    station: null,
    startedAt: '2026-09-23T08:02:00+03:00',
    messages: thread('c-1041', '2026-09-23T08:02:00+03:00', [
      ['agent', 'Hi, this is K1 Katsastus. Your vehicle with registration XYZ-441 is due for inspection soon. Would you like to book an appointment?', 0],
      ['user', 'Maybe, which station is closest to Leppävaara?', 41],
      ['agent', 'I can suggest stations near Leppävaara. Would you prefer a weekday morning or afternoon, so I can check the right one?', 41],
    ]),
  },
  {
    id: 'c-1039',
    leadId: 'l-klm908',
    customer: 'Mikko Nieminen',
    registration: 'KLM-908',
    channel: 'WhatsApp',
    outcome: 'Handed to staff',
    feedback: 'down',
    station: 'K1 Vantaa',
    startedAt: '2026-09-22T16:40:00+03:00',
    messages: thread('c-1039', '2026-09-22T16:40:00+03:00', [
      ['agent', 'Hi, this is K1 Katsastus. Your vehicle with registration KLM-908 is due for inspection soon. Would you like to book an appointment?', 0],
      ['user', 'My van has a tow hitch installed since last inspection, is that a problem?', 18],
      ['agent', 'A change like a new tow hitch may need a modification inspection. I will pass this to our staff so they can confirm what applies to KLM-908.', 18],
      ['user', 'Ok thanks.', 20],
      ['agent', 'Our K1 Vantaa team will contact you on this number during opening hours.', 20],
    ]),
  },
  {
    id: 'c-1036',
    leadId: 'l-rty256',
    customer: 'Laura Mäkinen',
    registration: 'RTY-256',
    channel: 'WhatsApp',
    outcome: 'Booked',
    feedback: null,
    station: 'K1 Helsinki',
    startedAt: '2026-09-21T11:20:00+03:00',
    messages: thread('c-1036', '2026-09-21T11:20:00+03:00', [
      ['agent', 'Hi, this is K1 Katsastus. Your vehicle with registration RTY-256 is due for inspection soon. Would you like to book an appointment?', 0],
      ['user', 'Can I come on Saturday?', 3],
      ['agent', 'This station is open Monday to Friday only. Would a weekday early morning work instead?', 3],
      ['user', 'Monday 8:00 then', 5],
      ['agent', 'Monday 29 September at 08:00 at K1 Helsinki is booked for RTY-256.', 6],
    ]),
  },
  {
    id: 'c-1033',
    leadId: null,
    customer: null,
    registration: null,
    channel: 'Playground',
    outcome: 'No reply',
    feedback: 'up',
    station: null,
    startedAt: '2026-09-19T14:05:00+03:00',
    messages: thread('c-1033', '2026-09-19T14:05:00+03:00', [
      ['user', 'What documents do I need for a passenger-car inspection?', 0],
      ['agent', 'Please bring the vehicle registration certificate and a valid ID. If anything on the vehicle has been modified, bring the related paperwork too.', 0],
    ]),
  },
  {
    id: 'c-1030',
    leadId: 'l-ghf771',
    customer: 'Juha Laine',
    registration: 'GHF-771',
    channel: 'WhatsApp',
    outcome: 'No reply',
    feedback: null,
    station: null,
    startedAt: '2026-09-16T10:12:00+03:00',
    messages: thread('c-1030', '2026-09-16T10:12:00+03:00', [
      ['agent', 'Hi, this is K1 Katsastus. Your vehicle with registration GHF-771 is due for inspection soon. Would you like to book an appointment?', 0],
    ]),
  },
  {
    id: 'c-1027',
    leadId: 'l-pqe310',
    customer: 'Sanna Heikkinen',
    registration: 'PQE-310',
    channel: 'WhatsApp',
    outcome: 'Needs follow-up',
    feedback: null,
    station: 'K1 Espoo',
    startedAt: '2026-09-12T13:48:00+03:00',
    messages: thread('c-1027', '2026-09-12T13:48:00+03:00', [
      ['agent', 'Hi, this is K1 Katsastus. Your vehicle with registration PQE-310 is due for inspection soon. Would you like to book an appointment?', 0],
      ['user', 'Not this week, I am travelling. Can you remind me next week?', 55],
      ['agent', 'Of course. I have noted that you would like a reminder next week. You can also reply here any time to book.', 55],
    ]),
  },
]

const sampleLead = (id: string, fields: Omit<Lead, 'id' | 'product' | 'sample'>): Lead => ({ id, product: '004', sample: true, ...fields })

export const LEADS: Lead[] = [
  sampleLead('l-abc123', { stationName: 'K1 Katsastus Kouvola Kankaanpää', isClosed: false, plateNumber: 'ABC-123', nextInspection: '2026-10-23', phoneNumber: '+358 40 000 0101', language: 'Suomi', lastInspection: '2025-10-23', reason: 'previous visit', addedAt: '2026-09-23T09:26:00+03:00', conversationIds: ['c-1042'] }),
  sampleLead('l-xyz441', { stationName: 'K1 Katsastus Tampere Lakalaiva', isClosed: false, plateNumber: 'XYZ-441', nextInspection: '2026-10-18', phoneNumber: '+358 40 000 0102', language: 'Suomi', lastInspection: '2024-10-18', reason: 'previous visit', addedAt: '2026-09-23T08:43:00+03:00', conversationIds: ['c-1041'] }),
  sampleLead('l-klm908', { stationName: 'K1 Katsastus Helsinki Vuosaari', isClosed: false, plateNumber: 'KLM-908', nextInspection: '2026-11-02', phoneNumber: '+358 40 000 0103', language: 'Svenska', lastInspection: '2025-11-02', reason: 'previous visit', addedAt: '2026-09-22T17:00:00+03:00', conversationIds: ['c-1039'] }),
  sampleLead('l-rty256', { stationName: 'K1 Katsastus Espoo Suomenoja', isClosed: false, plateNumber: 'RTY-256', nextInspection: '2026-10-05', phoneNumber: '+358 40 000 0104', language: 'English', lastInspection: '2025-10-05', reason: 'previous visit', addedAt: '2026-09-21T11:26:00+03:00', conversationIds: ['c-1036'] }),
  sampleLead('l-ghf771', { stationName: 'K1 Katsastus Imatra Mansikkala', isClosed: true, plateNumber: 'GHF-771', nextInspection: '2026-09-30', phoneNumber: '+358 40 000 0105', language: 'Suomi', lastInspection: '2025-09-30', reason: 'previous visit', addedAt: '2026-09-16T10:12:00+03:00', conversationIds: ['c-1030'] }),
  sampleLead('l-pqe310', { stationName: 'K1 Katsastus Kouvola Korjala', isClosed: false, plateNumber: 'PQE-310', nextInspection: '2026-10-12', phoneNumber: '+358 40 000 0106', language: 'Suomi', lastInspection: '2025-10-12', reason: 'previous visit', addedAt: '2026-09-12T14:43:00+03:00', conversationIds: ['c-1027'] }),
]

export type ActivityFilters = {
  from: string | null
  to: string | null
  outcome: Outcome | null
  channel: Channel | null
  feedback: 'up' | 'down' | null
}

export const EMPTY_FILTERS: ActivityFilters = { from: null, to: null, outcome: null, channel: null, feedback: null }

export function activeFilterCount(filters: ActivityFilters) {
  return (filters.from ? 1 : 0) + (filters.outcome ? 1 : 0) + (filters.channel ? 1 : 0) + (filters.feedback ? 1 : 0)
}

function dayKey(iso: string) {
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function filterConversations(list: Conversation[], filters: ActivityFilters) {
  return list.filter((item) => {
    const day = dayKey(item.startedAt)
    if (filters.from && day < filters.from) return false
    if (filters.to && day > filters.to) return false
    if (filters.outcome && item.outcome !== filters.outcome) return false
    if (filters.channel && item.channel !== filters.channel) return false
    if (filters.feedback && item.feedback !== filters.feedback) return false
    return true
  })
}

// Filters on the end of the next inspection window.
export function filterLeads(list: Lead[], range: { from: string | null; to: string | null }) {
  return list.filter((lead) => {
    if (!range.from) return true
    if (!lead.nextInspection) return false
    if (lead.nextInspection < range.from) return false
    if (range.to && lead.nextInspection > range.to) return false
    return true
  })
}

export function shortStation(name: string) {
  return name.replace(/^SULJETTU\s+/i, '').replace(/^K1 Katsastus\s+/i, '')
}

export function submittedStamp(iso: string) {
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${dayKey(iso)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export const fixtureActivity = {
  async list(filters: ActivityFilters) {
    await wait(120)
    return filterConversations(CONVERSATIONS, filters)
  },
  get(id: string) {
    return CONVERSATIONS.find((item) => item.id === id) ?? null
  },
}

export const fixtureLeads = {
  async list() {
    await wait(120)
    return LEADS
  },
  get(id: string) {
    return LEADS.find((item) => item.id === id) ?? null
  },
  conversationsFor(lead: Lead) {
    return lead.conversationIds.map((id) => fixtureActivity.get(id)).filter((item): item is Conversation => Boolean(item))
  },
}

export function toCsv(rows: Array<Record<string, string>>) {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)
  return [headers.join(','), ...rows.map((row) => headers.map((key) => escape(row[key] ?? '')).join(','))].join('\n')
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
