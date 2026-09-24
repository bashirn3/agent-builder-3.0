type DraftFields = { locked: boolean; masterPrompt: string; additional: string; opener: string; reminders?: Array<{ text: string; days: number | null }> }

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
  return changes.join(' · ')
}
