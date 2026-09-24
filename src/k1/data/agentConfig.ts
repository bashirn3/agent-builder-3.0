import { DEFAULT_INSTRUCTIONS, DEFAULT_OPENER } from '../../lib/playgroundService'
import { renderWithSampleData } from '../../lib/refinement'
import {
  loadState,
  remote,
  saveVersion,
  sendTurn,
  type ChatSource,
  type DeployRequest,
  type VersionRecord,
} from './builderApi'
import { describeChanges } from './changes'

export { describeChanges }

export type AgentVersion = {
  id: string
  number: number
  masterPrompt: string
  additional: string
  opener: string
  note: string
  savedBy: string | null
  createdAt: string
  active: boolean
  live: boolean
  thumbsUp: number
  thumbsDown: number
  conversations: number
}

export type AgentConfig = {
  displayName: string
  locked: boolean
  masterPrompt: string
  additional: string
  opener: string
  versions: AgentVersion[]
  liveVersion: AgentVersion | null
  liveSince: string | null
  liveBy: string | null
  deployRequests: DeployRequest[]
  // False until the backend stores test chats, ratings and deploy requests.
  tracking: boolean
}

export type Draft = Pick<AgentConfig, 'locked' | 'masterPrompt' | 'additional' | 'opener'>

export type TestTarget = {
  versionId: string | null
  versionNumber: number | null
  isDraft: boolean
  masterPrompt: string
  additional: string
  opener: string
}

export const backendConnected = remote

function toVersion(record: VersionRecord, liveId: string | null): AgentVersion {
  return {
    id: record.id,
    number: record.versionNumber,
    masterPrompt: record.masterPrompt,
    additional: record.additionalInformation ?? '',
    opener: record.openingMessage ?? '',
    note: record.note ?? '',
    savedBy: record.savedBy ?? null,
    createdAt: record.createdAt,
    active: record.isActive,
    live: record.id === liveId,
    thumbsUp: Number(record.thumbsUp ?? 0),
    thumbsDown: Number(record.thumbsDown ?? 0),
    conversations: Number(record.conversations ?? 0),
  }
}

export async function loadConfig(): Promise<AgentConfig> {
  const state = await loadState()
  const versions = state.versions.map((record) => toVersion(record, state.liveVersionId)).sort((a, b) => b.number - a.number)
  const active = versions.find((version) => version.active) ?? versions[0]
  return {
    displayName: state.displayName || 'K1 Katsastus',
    locked: state.locked,
    masterPrompt: active?.masterPrompt ?? DEFAULT_INSTRUCTIONS,
    additional: active?.additional ?? '',
    opener: active?.opener ?? DEFAULT_OPENER,
    versions,
    liveVersion: versions.find((version) => version.live) ?? null,
    liveSince: state.liveSince,
    liveBy: state.liveBy,
    deployRequests: state.deployRequests,
    tracking: state.tracking,
  }
}

export async function saveConfig(config: AgentConfig, draft: Draft): Promise<AgentConfig> {
  const before: Draft = { locked: config.locked, masterPrompt: config.masterPrompt, additional: config.additional, opener: config.opener }
  await saveVersion({
    displayName: config.displayName,
    masterPrompt: draft.masterPrompt,
    openingMessage: draft.opener,
    additionalInformation: draft.additional,
    locked: draft.locked,
    note: describeChanges(before, draft) || 'Saved without changes',
    savedBy: null,
  })
  return loadConfig()
}

export function draftTarget(config: AgentConfig, draft: Draft): TestTarget {
  const base = config.versions.find((version) => version.active) ?? null
  return {
    versionId: base?.id ?? null,
    versionNumber: base?.number ?? null,
    isDraft: true,
    masterPrompt: draft.masterPrompt,
    additional: draft.additional,
    opener: draft.opener,
  }
}

export function versionTarget(version: AgentVersion): TestTarget {
  return {
    versionId: version.id,
    versionNumber: version.number,
    isDraft: false,
    masterPrompt: version.masterPrompt,
    additional: version.additional,
    opener: version.opener,
  }
}

const DEMO_REPLIES = [
  'Thanks. Which K1 station would suit you, and do you prefer a morning or an afternoon?',
  'I can help with that. Could you confirm the registration number so I check the right vehicle?',
  'In this demo mode I cannot check live availability. Once connected, I would look up free times before confirming anything.',
]
let demoIndex = 0

export async function sendTest(
  target: TestTarget,
  history: Array<{ role: 'agent' | 'user'; text: string }>,
  meta: { conversationId: string; source: ChatSource },
) {
  const fallback = DEMO_REPLIES[demoIndex++ % DEMO_REPLIES.length]
  return sendTurn({
    conversationId: meta.conversationId,
    versionId: target.versionId,
    versionNumber: target.versionNumber,
    isDraft: target.isDraft,
    source: meta.source,
    opener: openerPreview(target.opener),
    masterPrompt: target.masterPrompt,
    additionalInformation: target.additional,
    history,
  }, fallback)
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

export function versionLabel(version: Pick<AgentVersion, 'number'> | null, isDraft = false) {
  if (isDraft) return version ? `Draft (from v${version.number})` : 'Draft'
  return version ? `v${version.number}` : 'Unsaved'
}
