import type { AgentVersion } from '../data/agentConfig'
import { localizeNote } from '../data/changes'
import { locale, type Copy } from '../i18n'

const NOTE_LIMIT = 42

export function shortVersionDate(iso: string) {
  return new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })
}

export function versionNote(version: AgentVersion, t: Copy) {
  const note = version.note ? localizeNote(version.note, t) : ''
  return note.length > NOTE_LIMIT ? `${note.slice(0, NOTE_LIMIT - 1).trimEnd()}…` : note
}

// "Live · Changed opener · 24 Sep · 2 chats": one line per version in every version list.
export function versionHint(version: AgentVersion, t: Copy, { chats = true }: { chats?: boolean } = {}) {
  return [
    version.live && t.common.live,
    versionNote(version, t),
    shortVersionDate(version.createdAt),
    chats && t.versions.chats(version.conversations),
  ].filter(Boolean).join(' · ')
}

// Live first, then newest first.
export function orderVersions(versions: AgentVersion[]) {
  return [...versions].sort((a, b) => Number(b.live) - Number(a.live) || b.number - a.number)
}
