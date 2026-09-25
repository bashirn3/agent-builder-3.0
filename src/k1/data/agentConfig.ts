import { DEFAULT_INSTRUCTIONS } from '../../lib/playgroundService'
import { LEADS } from './fixtures'
import { detectLanguage, fillTemplate, TRANSLATED, type Lang, type TemplateLead } from './language'
import {
  currentActor,
  loadState,
  remote,
  saveVersion,
  sendTurn,
  type ChatSource,
  type DeployRequest,
  type Reminder,
  type Translation,
  type Translations,
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
  reminders: Reminder[]
  translations: Translations
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
  reminders: Reminder[]
  translations: Translations
  versions: AgentVersion[]
  liveVersion: AgentVersion | null
  liveSince: string | null
  liveBy: string | null
  deployRequests: DeployRequest[]
  // False until the backend stores test chats, ratings and deploy requests.
  tracking: boolean
}

export type Draft = Pick<AgentConfig, 'locked' | 'masterPrompt' | 'additional' | 'opener' | 'reminders' | 'translations'>

export type TestTarget = {
  versionId: string | null
  versionNumber: number | null
  isDraft: boolean
  masterPrompt: string
  additional: string
  opener: string
  reminders: Reminder[]
  translations: Translations
}

export type TestLead = TemplateLead

export const SAMPLE_LEAD: TestLead = LEADS[0]

export const K1_DEFAULT_OPENER = 'Hi, this is K1 Katsastus. Your vehicle {{registration_number}} is due for inspection by {{due_date}}. Would you like to book a time at {{station}}?'

export const REMINDER_SLOTS = 3

export function normalizeReminders(value: unknown): Reminder[] {
  const list = Array.isArray(value) ? value : []
  return Array.from({ length: REMINDER_SLOTS }, (_, index) => {
    const item = list[index] as Partial<Reminder> | undefined
    const days = Number(item?.days)
    return { text: typeof item?.text === 'string' ? item.text : '', days: Number.isFinite(days) && days > 0 ? Math.round(days) : null }
  })
}

export function normalizeTranslations(value: unknown): Translations {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, Partial<Translation> | undefined>
  return Object.fromEntries(TRANSLATED.map((code) => [code, {
    opener: typeof source[code]?.opener === 'string' ? source[code]!.opener! : '',
    reminders: normalizeReminders(source[code]?.reminders),
  }])) as Translations
}

// Picks the lead's language when that version has text, otherwise English.
export function localized(target: Pick<TestTarget, 'opener' | 'reminders' | 'translations'>, lead: TestLead): { lang: Lang; opener: string; reminders: Reminder[] } {
  const lang = detectLanguage(lead.language)
  const translation = lang === 'en' ? undefined : target.translations[lang]
  return {
    lang: translation?.opener.trim() ? lang : 'en',
    opener: translation?.opener.trim() ? translation.opener : target.opener,
    reminders: target.reminders.map((reminder, index) => {
      const text = translation?.reminders[index]?.text.trim() ? translation.reminders[index].text : reminder.text
      return { text, days: reminder.days }
    }),
  }
}

export const backendConnected = remote

function toVersion(record: VersionRecord, liveId: string | null): AgentVersion {
  return {
    id: record.id,
    number: record.versionNumber,
    masterPrompt: record.masterPrompt,
    additional: record.additionalInformation ?? '',
    opener: record.openingMessage ?? '',
    reminders: normalizeReminders(record.reminders),
    translations: normalizeTranslations(record.translations),
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
    opener: active?.opener ?? K1_DEFAULT_OPENER,
    reminders: active?.reminders ?? normalizeReminders([]),
    translations: active?.translations ?? normalizeTranslations({}),
    versions,
    liveVersion: versions.find((version) => version.live) ?? null,
    liveSince: state.liveSince,
    liveBy: state.liveBy,
    deployRequests: state.deployRequests,
    tracking: state.tracking,
  }
}

export async function saveConfig(config: AgentConfig, draft: Draft): Promise<AgentConfig> {
  const before: Draft = { locked: config.locked, masterPrompt: config.masterPrompt, additional: config.additional, opener: config.opener, reminders: config.reminders, translations: config.translations }
  await saveVersion({
    displayName: config.displayName,
    masterPrompt: draft.masterPrompt,
    openingMessage: draft.opener,
    additionalInformation: draft.additional,
    reminders: draft.reminders,
    translations: draft.translations,
    locked: draft.locked,
    note: describeChanges(before, draft) || 'Saved without changes',
    savedBy: currentActor()?.name ?? null,
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
    reminders: draft.reminders,
    translations: draft.translations,
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
    reminders: version.reminders,
    translations: version.translations,
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
  meta: { conversationId: string; source: ChatSource; lead: TestLead },
) {
  const fallback = DEMO_REPLIES[demoIndex++ % DEMO_REPLIES.length]
  return sendTurn({
    conversationId: meta.conversationId,
    versionId: target.versionId,
    versionNumber: target.versionNumber,
    isDraft: target.isDraft,
    source: meta.source,
    opener: (() => { const used = localized(target, meta.lead); return openerPreview(used.opener, meta.lead, used.lang) })(),
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

export function personalize(text: string, lead: TestLead = SAMPLE_LEAD, lang?: Lang) {
  return fillTemplate(text, lead, lang)
}

export function openerPreview(opener: string, lead: TestLead = SAMPLE_LEAD, lang?: Lang) {
  return personalize(opener, lead, lang).trim()
}

export function sameDraft(a: Draft, b: Draft) {
  return a.locked === b.locked && a.masterPrompt === b.masterPrompt && a.additional === b.additional && a.opener === b.opener
    && JSON.stringify(a.reminders) === JSON.stringify(b.reminders)
    && JSON.stringify(a.translations) === JSON.stringify(b.translations)
}

export function versionLabel(version: Pick<AgentVersion, 'number'> | null, isDraft = false) {
  if (isDraft) return version ? `Draft (from v${version.number})` : 'Draft'
  return version ? `v${version.number}` : 'Unsaved'
}
