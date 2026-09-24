export type QnaEntry = { id: string; title: string; question: string; answer: string }

// Q&A lives inside the existing "additional information" field so the n8n test and
// production prompts receive it without a schema change. Text above the marker is
// kept verbatim as free-form notes.
export const QNA_MARKER = '## Q&A — answer these questions exactly as written'

let seq = 0
const newId = () => `qna-${Date.now().toString(36)}-${(seq++).toString(36)}`

export function parseAdditional(text: string): { notes: string; entries: QnaEntry[] } {
  const index = text.indexOf(QNA_MARKER)
  if (index < 0) return { notes: text.trim(), entries: [] }
  const notes = text.slice(0, index).trim()
  const blocks = text.slice(index + QNA_MARKER.length).split(/\n(?=### )/)
  const entries: QnaEntry[] = []
  for (const block of blocks) {
    const match = /^### (.*)\nQ: ([\s\S]*?)\nA: ([\s\S]*)$/.exec(block.trim())
    if (!match) continue
    entries.push({ id: `qna-${entries.length}`, title: match[1].trim(), question: match[2].trim(), answer: match[3].trim() })
  }
  return { notes, entries }
}

export function serializeAdditional(notes: string, entries: QnaEntry[]) {
  const clean = entries
    .map((entry) => ({ ...entry, title: entry.title.trim() || entry.question.trim(), question: entry.question.trim(), answer: entry.answer.trim() }))
    .filter((entry) => entry.question && entry.answer)
  const parts = [notes.trim()]
  if (clean.length) {
    parts.push([QNA_MARKER, ...clean.map((entry) => `### ${entry.title.replace(/\n/g, ' ')}\nQ: ${entry.question}\nA: ${entry.answer}`)].join('\n\n'))
  }
  return parts.filter(Boolean).join('\n\n')
}

export function addEntry(text: string, entry: Omit<QnaEntry, 'id'>) {
  const { notes, entries } = parseAdditional(text)
  return serializeAdditional(notes, [...entries, { ...entry, id: newId() }])
}
