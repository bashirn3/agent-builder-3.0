export type Format = 'heading' | 'bold' | 'italic' | 'bullet' | 'number'

const LINE_PREFIX: Record<Exclude<Format, 'bold' | 'italic'>, RegExp> = {
  heading: /^### /,
  bullet: /^- /,
  number: /^\d+\. /,
}

const ANY_PREFIX = /^(### |- |\d+\. )/

export function applyFormat(value: string, start: number, end: number, kind: Format) {
  if (kind === 'bold' || kind === 'italic') {
    const mark = kind === 'bold' ? '**' : '_'
    const inner = value.slice(start, end)
    return { value: `${value.slice(0, start)}${mark}${inner}${mark}${value.slice(end)}`, start: start + mark.length, end: end + mark.length }
  }
  const lastSelected = end > start && value[end - 1] === '\n' ? end - 1 : end
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const nextBreak = value.indexOf('\n', lastSelected)
  const lineEnd = nextBreak === -1 ? value.length : nextBreak
  const lines = value.slice(lineStart, lineEnd).split('\n')
  const pattern = LINE_PREFIX[kind]
  const remove = lines.every((line) => pattern.test(line))
  const block = lines.map((line, index) => {
    if (remove) return line.replace(pattern, '')
    const prefix = kind === 'heading' ? '### ' : kind === 'bullet' ? '- ' : `${index + 1}. `
    return prefix + line.replace(ANY_PREFIX, '')
  }).join('\n')
  return { value: value.slice(0, lineStart) + block + value.slice(lineEnd), start: lineStart, end: lineStart + block.length }
}

export function stripPrefix(line: string) {
  return line.replace(ANY_PREFIX, '')
}
