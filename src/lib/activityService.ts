export type ActivitySource = 'Playground' | 'Widget'
export type ActivityFeedback = 'none' | 'good' | 'bad'

export type ActivityMessage = {
  id: string
  role: 'agent' | 'user'
  text: string
}

export type ActivityConversation = {
  id: string
  title: string
  preview: string
  timeLabel: string
  started: string
  source: ActivitySource
  feedback: ActivityFeedback
  leadId: string | null
  registration: string | null
  station: string | null
  messages: ActivityMessage[]
}

export type ActivityFilters = {
  source: 'all' | ActivitySource
  feedback: 'all' | ActivityFeedback
  range: 'all' | '7d'
}

export const DEFAULT_FILTERS: ActivityFilters = {
  source: 'all',
  feedback: 'all',
  range: 'all',
}

const FIXTURES: ActivityConversation[] = [
  {
    id: 'conv-abc-123',
    title: 'Inspection due for ABC-123',
    preview: 'Which K1 station and date would you prefer?',
    timeLabel: 'Just now',
    started: 'Today, 09:14',
    source: 'Widget',
    feedback: 'none',
    leadId: 'lead-rasmus',
    registration: 'ABC-123',
    station: null,
    messages: [
      {
        id: 'm1',
        role: 'agent',
        text: 'Hi Rasmus, this is K1 Katsastus. Your vehicle with registration ABC-123 is due for inspection soon. Would you like to book an appointment?',
      },
      {
        id: 'm2',
        role: 'user',
        text: 'Yes. I can do Thursday afternoon.',
      },
      {
        id: 'm3',
        role: 'agent',
        text: 'Which K1 station and date would you prefer? I need the station before I can check live availability.',
      },
    ],
  },
  {
    id: 'conv-docs',
    title: 'Documents for inspection',
    preview: 'Bring the registration certificate and a valid ID.',
    timeLabel: '1 hour ago',
    started: 'Today, 08:02',
    source: 'Playground',
    feedback: 'good',
    leadId: null,
    registration: null,
    station: 'K1 Espoo',
    messages: [
      {
        id: 'm4',
        role: 'user',
        text: 'What documents do I need for a passenger-car inspection?',
      },
      {
        id: 'm5',
        role: 'agent',
        text: 'Bring the registration certificate and a valid ID. I cannot list fees or deadlines from this preview.',
      },
    ],
  },
  {
    id: 'conv-station',
    title: 'Nearest station',
    preview: 'I can look up K1 stations once you share a city or postcode.',
    timeLabel: 'Yesterday',
    started: 'Yesterday, 16:40',
    source: 'Widget',
    feedback: 'none',
    leadId: 'lead-anna',
    registration: 'XYZ-441',
    station: null,
    messages: [
      {
        id: 'm6',
        role: 'user',
        text: 'Which station is nearest to Leppävaara?',
      },
      {
        id: 'm7',
        role: 'agent',
        text: 'I can look up K1 stations once you share a city or postcode. This preview cannot confirm live distances.',
      },
    ],
  },
  {
    id: 'conv-booking',
    title: 'Booking handoff',
    preview: 'I will hand this to staff if the booking workflow is unavailable.',
    timeLabel: '2 days ago',
    started: 'Mon, 11:20',
    source: 'Playground',
    feedback: 'bad',
    leadId: 'lead-rasmus',
    registration: 'ABC-123',
    station: 'K1 Vantaa',
    messages: [
      {
        id: 'm8',
        role: 'user',
        text: 'Book Vantaa tomorrow at 10:00 for ABC-123.',
      },
      {
        id: 'm9',
        role: 'agent',
        text: 'I will hand this to staff if the booking workflow is unavailable. This record is a fixture, not a live booking.',
      },
    ],
  },
]

export type ActivityService = {
  listConversations: (filters?: ActivityFilters) => Promise<ActivityConversation[]>
  getConversation: (id: string) => Promise<ActivityConversation | null>
}

function matches(item: ActivityConversation, filters: ActivityFilters) {
  if (filters.source !== 'all' && item.source !== filters.source) return false
  if (filters.feedback !== 'all' && item.feedback !== filters.feedback) return false
  if (filters.range === '7d' && item.timeLabel === '2 days ago') return true
  return true
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function createFixtureActivityService(): ActivityService {
  return {
    async listConversations(filters = DEFAULT_FILTERS) {
      await wait(90)
      return FIXTURES.filter((item) => matches(item, filters)).map((item) => ({
        ...item,
        messages: item.messages.map((message) => ({ ...message })),
      }))
    },
    async getConversation(id) {
      await wait(60)
      const found = FIXTURES.find((item) => item.id === id)
      return found ? { ...found, messages: found.messages.map((message) => ({ ...message })) } : null
    },
  }
}
