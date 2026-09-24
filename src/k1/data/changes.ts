type DraftFields = { locked: boolean; masterPrompt: string; additional: string; opener: string }

export function describeChanges(before: DraftFields, after: DraftFields) {
  const changes: string[] = []
  if (before.masterPrompt !== after.masterPrompt) changes.push('Edited base prompt')
  if (before.locked !== after.locked) changes.push(after.locked ? 'Locked base prompt' : 'Unlocked base prompt')
  if (before.additional !== after.additional) changes.push('Edited additional instructions')
  if (before.opener !== after.opener) changes.push('Changed opener')
  return changes.join(' · ')
}
