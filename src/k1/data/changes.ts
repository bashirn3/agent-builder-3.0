import type { Copy } from '../i18n'

type Reminder = { text: string; days: number | null }
type DraftFields = { locked: boolean; masterPrompt: string; additional: string; opener: string; reminders?: Reminder[]; translations?: Partial<Record<'fi' | 'sv', { opener: string; reminders: Reminder[] }>> }

const LANGUAGE_NAMES = { fi: 'Finnish', sv: 'Swedish' } as const

export function describeChanges(before: DraftFields, after: DraftFields) {
  const changes: string[] = []
  if (before.masterPrompt !== after.masterPrompt) changes.push('Edited base prompt')
  if (before.locked !== after.locked) changes.push(after.locked ? 'Locked base prompt' : 'Unlocked base prompt')
  if (before.additional !== after.additional) changes.push('Edited additional instructions')
  if (before.opener !== after.opener) changes.push('Changed opener')
  const was = before.reminders ?? []
  const now = after.reminders ?? []
  const changed = Array.from({ length: Math.max(was.length, now.length) }, (_, index) => index)
    .filter((index) => JSON.stringify(was[index] ?? null) !== JSON.stringify(now[index] ?? null))
    .map((index) => index + 1)
  if (changed.length) changes.push(changed.length === 1 ? `Changed reminder ${changed[0]}` : `Changed reminders ${changed.join(', ')}`)
  for (const code of ['fi', 'sv'] as const) {
    if (JSON.stringify(before.translations?.[code] ?? null) !== JSON.stringify(after.translations?.[code] ?? null)) changes.push(`Changed ${LANGUAGE_NAMES[code]} opener`)
  }
  return changes.join(' · ')
}

// Notes are stored in English; show them in the interface language.
export function localizeNote(note: string, t: Copy) {
  const fixed: Record<string, string> = {
    'Edited base prompt': t.changes.basePrompt,
    'Locked base prompt': t.changes.locked,
    'Unlocked base prompt': t.changes.unlocked,
    'Edited additional instructions': t.changes.additional,
    'Changed opener': t.changes.opener,
    'Changed Finnish opener': t.changes.finnish,
    'Changed Swedish opener': t.changes.swedish,
    'Saved without changes': t.changes.none,
  }
  return note.split(' · ').map((part) => {
    if (fixed[part]) return fixed[part]
    const one = /^Changed reminder (\d+)$/.exec(part)
    if (one) return t.changes.reminder(one[1])
    const many = /^Changed reminders ([\d, ]+)$/.exec(part)
    if (many) return t.changes.reminders(many[1])
    return part
  }).join(' · ')
}
