export type Role = 'agent' | 'user'

export type ChatMessage = {
  id: string
  role: Role
  text: string
  mocked?: boolean
  sample?: boolean
}

export type PromptVersion = {
  id: string
  meta: string
  prompt: string
  opener?: string
  additionalInformation?: string
  sample?: boolean
}

export type PreviousTest = {
  messages: ChatMessage[]
  versionLabel: string | null
}

export type SaveSnapshot = {
  base: string
  opener: string
  draftAdditional: string
  additional: string
  pendingInstruction: string
  locked: boolean
  lockedAtClick: boolean
}

export type AgentDraft = {
  locked: boolean
  savedLocked: boolean
  conversationId: string
  testingVersionId: string | null
  savedBase: string
  savedAdditional: string
  savedOpener: string
  draftBase: string
  draftAdditional: string
  draftOpener: string
  versions: PromptVersion[]
  activeVersion: string
  messages: ChatMessage[]
  previousTest: PreviousTest | null
  replyIndex: number
}

export function appendAdditionalInstruction(existing: string, pending: string) {
  const instruction = pending.trim()
  if (!instruction) return existing.trim()
  const bullet = `- ${instruction}`
  const lines = existing.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
  if (lines.includes(bullet)) return existing.trim()
  if (!existing.trim()) return bullet
  return `${existing.trim()}\n${bullet}`
}

export function composeEffectivePrompt(base: string, additional: string) {
  const extra = additional.trim()
  if (!extra) return base
  if (/^additional guidance:\s*/i.test(extra)) return `${base.trim()}\n\n${extra}`
  return `${base.trim()}\n\nAdditional guidance:\n${extra}`
}

export function hasMeaningfulChanges(input: {
  instructionDraft: string
  draftBase: string
  savedBase: string
  draftOpener: string
  savedOpener: string
  draftAdditional: string
  savedAdditional: string
  locked: boolean
  savedLocked: boolean
}) {
  return input.instructionDraft.trim().length > 0
    || input.draftBase !== input.savedBase
    || input.draftOpener !== input.savedOpener
    || input.draftAdditional !== input.savedAdditional
    || input.locked !== input.savedLocked
}

export function captureSaveSnapshot(input: {
  draftBase: string
  draftOpener: string
  draftAdditional: string
  instructionDraft: string
  locked: boolean
  persistLocked?: boolean
}): SaveSnapshot {
  return {
    base: input.draftBase,
    opener: input.draftOpener,
    draftAdditional: input.draftAdditional,
    additional: appendAdditionalInstruction(input.draftAdditional, input.instructionDraft),
    pendingInstruction: input.instructionDraft,
    locked: input.persistLocked ?? input.locked,
    lockedAtClick: input.locked,
  }
}

export function instructionDraftAfterSave(current: string, captured: string) {
  return current === captured ? '' : current
}

export function shouldAcceptTestReply(input: {
  responseRequestId: string
  pendingResponseId: string | null
  responseConversationId: string
  currentConversationId: string
}) {
  return input.pendingResponseId === input.responseRequestId
    && input.currentConversationId === input.responseConversationId
}

export function renderWithSampleData(value: string) {
  return value
    .replace(/{{\s*first[-_\s]?name\s*}}/gi, 'Rasmus')
    .replace(/{{\s*registration[-_\s]?number\s*}}/gi, 'ABC-123')
}

export function starterMessages(opener: string, id: string): ChatMessage[] {
  const text = renderWithSampleData(opener).trim()
  if (!text) return []
  return [{
    id,
    role: 'agent',
    text,
    sample: /{{\s*[^}]+\s*}}/.test(opener),
  }]
}

export function lastCustomerQuestion(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'user' && message.text.trim()) return message.text
  }
  return ''
}

export function versionScope(version: PromptVersion) {
  const parts = ['Base prompt']
  if (typeof version.additionalInformation === 'string') {
    parts.push(version.additionalInformation.trim() ? 'additional instructions' : 'no additional instructions')
  } else {
    parts.push('additional instructions were not stored separately')
  }
  parts.push(typeof version.opener === 'string' ? 'opening message' : 'opening message was not stored')
  return parts.join(' · ')
}

export function restorePlan(version: PromptVersion, savedBase: string, locked: boolean) {
  if (locked && version.prompt !== savedBase) {
    return { ok: false as const, reason: 'unlock-required' as const }
  }
  return {
    ok: true as const,
    base: version.prompt,
    opener: typeof version.opener === 'string' ? version.opener : undefined,
    additional: typeof version.additionalInformation === 'string' ? version.additionalInformation : undefined,
  }
}

type ApplySavedInput = {
  agent: AgentDraft
  snapshot: SaveSnapshot
  version: PromptVersion
  current: {
    draftBase: string
    draftOpener: string
    draftAdditional: string
    instructionDraft: string
    locked: boolean
  }
  started: { conversationId: string; messages: ChatMessage[] } | null
}

export function applySavedConfig({ agent, snapshot, version, current, started }: ApplySavedInput) {
  const instructionDraft = instructionDraftAfterSave(current.instructionDraft, snapshot.pendingInstruction)
  const draftBase = current.draftBase === snapshot.base ? snapshot.base : current.draftBase
  const draftOpener = current.draftOpener === snapshot.opener ? snapshot.opener : current.draftOpener
  const draftAdditional = current.draftAdditional === snapshot.draftAdditional ? snapshot.additional : current.draftAdditional
  const locked = current.locked === snapshot.lockedAtClick ? snapshot.locked : current.locked
  const versions = [version, ...agent.versions.filter((item) => item.id !== version.id)]
  const savedAgent: AgentDraft = {
    ...agent,
    locked,
    savedLocked: snapshot.locked,
    savedBase: snapshot.base,
    savedAdditional: snapshot.additional,
    savedOpener: snapshot.opener,
    draftBase,
    draftOpener,
    draftAdditional,
    versions,
    activeVersion: version.id,
  }

  if (!started) {
    return { agent: savedAgent, instructionDraft, testStarted: false as const }
  }

  return {
    agent: {
      ...savedAgent,
      conversationId: started.conversationId,
      testingVersionId: null,
      messages: started.messages,
      previousTest: agent.messages.length
        ? { messages: agent.messages, versionLabel: agent.testingVersionId }
        : agent.previousTest,
    },
    instructionDraft,
    testStarted: true as const,
  }
}

export function beginFreshTest(opener: string, createId: (prefix: string) => string) {
  return {
    conversationId: createId('thread'),
    messages: starterMessages(opener, createId('msg')),
  }
}

export function applyFreshTest(agent: AgentDraft, started: { conversationId: string; messages: ChatMessage[] }) {
  return {
    ...agent,
    conversationId: started.conversationId,
    testingVersionId: null,
    messages: started.messages,
    previousTest: agent.messages.length
      ? { messages: agent.messages, versionLabel: agent.testingVersionId }
      : agent.previousTest,
  }
}
