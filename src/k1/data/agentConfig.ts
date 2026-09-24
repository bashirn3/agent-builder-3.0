import {
  getK1TenantKey,
  loadAgentBuilderConfig,
  saveAgentBuilderConfig,
  testAgentBuilderMessage,
  type AgentBuilderVersionRecord,
} from '../../lib/agentBuilderService'
import { DEFAULT_INSTRUCTIONS, DEFAULT_OPENER } from '../../lib/playgroundService'
import { renderWithSampleData } from '../../lib/refinement'

export type AgentVersion = {
  id: string
  number: number
  masterPrompt: string
  additional: string
  opener: string
  createdAt: string
  active: boolean
}

export type AgentConfig = {
  displayName: string
  locked: boolean
  masterPrompt: string
  additional: string
  opener: string
  versions: AgentVersion[]
}

export type Draft = Pick<AgentConfig, 'locked' | 'masterPrompt' | 'additional' | 'opener'>

function toVersion(record: AgentBuilderVersionRecord): AgentVersion {
  return {
    id: record.id,
    number: record.versionNumber,
    masterPrompt: record.masterPrompt,
    additional: record.additionalInformation ?? '',
    opener: record.openingMessage ?? '',
    createdAt: record.createdAt,
    active: record.isActive,
  }
}

export async function loadConfig(): Promise<AgentConfig> {
  const snapshot = await loadAgentBuilderConfig()
  if (!snapshot) {
    return {
      displayName: 'K1 Katsastus',
      locked: false,
      masterPrompt: DEFAULT_INSTRUCTIONS,
      additional: '',
      opener: DEFAULT_OPENER,
      versions: [],
    }
  }
  const versions = (snapshot.versions.length ? snapshot.versions : [snapshot.activeVersion])
    .map(toVersion)
    .sort((a, b) => b.number - a.number)
  return {
    displayName: snapshot.displayName,
    locked: snapshot.locked,
    masterPrompt: snapshot.activeVersion.masterPrompt,
    additional: snapshot.activeVersion.additionalInformation ?? '',
    opener: snapshot.activeVersion.openingMessage ?? '',
    versions,
  }
}

export async function saveConfig(config: AgentConfig, draft: Draft): Promise<AgentConfig> {
  const saved = toVersion(await saveAgentBuilderConfig({
    tenantKey: getK1TenantKey(),
    displayName: config.displayName,
    masterPrompt: draft.masterPrompt,
    openingMessage: draft.opener,
    additionalInformation: draft.additional,
    locked: draft.locked,
  }))
  const version = { ...saved, masterPrompt: draft.masterPrompt, additional: draft.additional, opener: draft.opener, active: true }
  return {
    ...config,
    ...draft,
    versions: [version, ...config.versions.filter((item) => item.id !== version.id).map((item) => ({ ...item, active: false }))],
  }
}

const DEMO_REPLIES = [
  'Thanks. Which K1 station would suit you, and do you prefer a morning or an afternoon?',
  'I can help with that. Could you confirm the registration number so I check the right vehicle?',
  'In this demo mode I cannot check live availability. Once connected, I would look up free times before confirming anything.',
]
let demoIndex = 0

export async function sendTest(draft: Draft, history: Array<{ role: 'agent' | 'user'; text: string }>) {
  const fallback = DEMO_REPLIES[demoIndex++ % DEMO_REPLIES.length]
  const result = await testAgentBuilderMessage({
    tenantKey: getK1TenantKey(),
    masterPrompt: draft.masterPrompt,
    additionalInformation: draft.additional,
    messages: history,
  }, fallback)
  return result
}

export function describeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const status = /_failed:(\d+)$/.exec(message)
  return status ? `server error ${status[1]}` : message.replace(/n8n[_\s-]*/gi, '')
}

export function openerPreview(opener: string) {
  return renderWithSampleData(opener).trim()
}

export function sameDraft(a: Draft, b: Draft) {
  return a.locked === b.locked && a.masterPrompt === b.masterPrompt && a.additional === b.additional && a.opener === b.opener
}
