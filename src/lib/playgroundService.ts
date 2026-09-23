import { renderWithSampleData, starterMessages, type ChatMessage } from './refinement'

export type AgentConfig = {
  instructions: string
  opener: string
}

export type PlaygroundService = {
  loadConfig: () => Promise<AgentConfig>
  saveConfig: (draft: AgentConfig) => Promise<AgentConfig>
  sendTestMessage: (input: {
    conversationId: string
    messages: ChatMessage[]
    instructions: string
  }) => Promise<{ reply: string }>
  failNextSave: () => void
  failNextReply: () => void
}

export const DEFAULT_INSTRUCTIONS = `You are the appointment-booking assistant for K1 Katsastus, a Finnish vehicle inspection company.

Ask whether the customer wants to book an inspection and collect the details needed to check availability: registration number, preferred K1 station, preferred date or time window, and contact details when needed.

Use connected workflow results for available appointments and booking outcomes. Do not invent inspection deadlines, prices, available appointments, or booking confirmations.

If a required detail is missing, ask one clear follow-up question. If workflow data is unavailable, say so and hand off to staff.`

export const DEFAULT_OPENER = 'Hi {{first_name}}, this is K1 Katsastus. Your vehicle with registration {{registration_number}} is due for inspection soon. Would you like to book an appointment?'

const MOCK_REPLIES = [
  'I can help with that. Which K1 station and date or time window would you prefer?',
  'Please share the registration number first so the live workflow can check the right vehicle record.',
  'This prototype cannot confirm prices or appointment availability. In production I would wait for the connected workflow result before confirming.',
  'Using the sample due-soon record for ABC-123, I can ask for your preferred station and time before checking appointments.',
]

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function createMockPlaygroundService(): PlaygroundService {
  let saved: AgentConfig = {
    instructions: DEFAULT_INSTRUCTIONS,
    opener: DEFAULT_OPENER,
  }
  let replyIndex = 0
  let failSave = false
  let failReply = false

  return {
    async loadConfig() {
      await wait(80)
      return { ...saved }
    },
    async saveConfig(draft) {
      await wait(220)
      if (failSave) {
        failSave = false
        throw new Error('save_failed')
      }
      saved = {
        instructions: draft.instructions,
        opener: draft.opener,
      }
      return { ...saved }
    },
    async sendTestMessage() {
      await wait(280)
      if (failReply) {
        failReply = false
        throw new Error('reply_failed')
      }
      const reply = MOCK_REPLIES[replyIndex % MOCK_REPLIES.length]
      replyIndex += 1
      return { reply }
    },
    failNextSave() {
      failSave = true
    },
    failNextReply() {
      failReply = true
    },
  }
}

export function openerPreview(opener: string) {
  return renderWithSampleData(opener).trim()
}

export function conversationFromOpener(opener: string, id: string): ChatMessage[] {
  return starterMessages(opener, id)
}
