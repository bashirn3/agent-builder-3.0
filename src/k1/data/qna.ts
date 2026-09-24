export type QnaEntry = { id: string; title: string; questions: string[]; answer: string }

// Q&A lives inside the existing "additional information" field so the test and
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
    const lines = block.trim().split('\n')
    if (!lines[0]?.startsWith('### ')) continue
    const questions: string[] = []
    let cursor = 1
    while (cursor < lines.length && lines[cursor].startsWith('Q: ')) questions.push(lines[cursor++].slice(3).trim())
    if (!questions.length || !lines[cursor]?.startsWith('A: ')) continue
    const answer = [lines[cursor].slice(3), ...lines.slice(cursor + 1)].join('\n').trim()
    entries.push({ id: `qna-${entries.length}`, title: lines[0].slice(4).trim(), questions, answer })
  }
  return { notes, entries }
}

const oneLine = (value: string) => value.replace(/\s*\n\s*/g, ' ').trim()

export function serializeAdditional(notes: string, entries: QnaEntry[]) {
  const clean = entries
    .map((entry) => {
      const questions = entry.questions.map(oneLine).filter(Boolean)
      return { title: oneLine(entry.title) || questions[0] || '', questions, answer: entry.answer.trim() }
    })
    .filter((entry) => entry.questions.length && entry.answer)
  const parts = [notes.trim()]
  if (clean.length) {
    parts.push([QNA_MARKER, ...clean.map((entry) => [`### ${entry.title}`, ...entry.questions.map((q) => `Q: ${q}`), `A: ${entry.answer}`].join('\n'))].join('\n\n'))
  }
  return parts.filter(Boolean).join('\n\n')
}

const STOP = new Set(['a', 'an', 'the', 'is', 'are', 'do', 'does', 'you', 'your', 'i', 'my', 'me', 'we', 'to', 'of', 'on', 'in', 'for', 'and', 'or', 'it', 'can', 'what', 'how', 'when', 'please'])
const stem = (word: string) => (word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word)
const words = (text: string) => new Set(text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((word) => word && !STOP.has(word)).map(stem))

// A wording-similarity guess for the UI; the model itself decides whether it uses an entry.
export function matchEntry(entries: QnaEntry[], message: string): QnaEntry | null {
  const asked = words(message)
  if (!asked.size) return null
  let best: { entry: QnaEntry; score: number } | null = null
  for (const entry of entries) {
    for (const question of entry.questions) {
      const known = words(question)
      if (!known.size) continue
      const shared = [...asked].filter((word) => known.has(word)).length
      const score = shared / (asked.size + known.size - shared)
      if ((score >= 0.5 || (shared >= 2 && shared === known.size)) && (!best || score > best.score)) best = { entry, score }
    }
  }
  return best?.entry ?? null
}

export function addEntry(text: string, entry: Omit<QnaEntry, 'id'>) {
  const { notes, entries } = parseAdditional(text)
  return serializeAdditional(notes, [...entries, { ...entry, id: newId() }])
}
