export type LeadField = 'name' | 'email' | 'phone' | 'registration' | 'inspection_due'

export type ParsedLead = { name: string; email: string; phone: string; registration: string; inspection_due: string }

export type ParseResult = {
  rows: ParsedLead[]
  skipped: Array<{ line: number; reason: string }>
  missing: LeadField[]
  error: string | null
}

export const FIELD_LABELS: Record<LeadField, string> = {
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  registration: 'Registration',
  inspection_due: 'Inspection due',
}

const ALIASES: Record<LeadField, string[]> = {
  name: ['name', 'full name', 'customer', 'customer name', 'nimi', 'asiakas'],
  email: ['email', 'e-mail', 'email address', 'sahkoposti', 'sähköposti'],
  phone: ['phone', 'phone number', 'mobile', 'telephone', 'puhelin', 'puhelinnumero'],
  registration: ['registration', 'registration number', 'reg', 'reg number', 'plate', 'licence plate', 'license plate', 'rekisteri', 'rekisterinumero', 'rekisteritunnus'],
  inspection_due: ['inspection due', 'inspection due date', 'due date', 'inspection date', 'expiry', 'expires', 'katsastus', 'seuraava katsastus', 'katsastuspaiva', 'katsastuspäivä'],
}

const REQUIRED: LeadField[] = ['name', 'registration']

const clean = (value: string) => value.toLowerCase().replace(/[_\s]+/g, ' ').trim()

function detectDelimiter(firstLine: string) {
  const counts = [',', ';', '\t'].map((char) => ({ char, count: firstLine.split(char).length - 1 }))
  return counts.sort((a, b) => b.count - a.count)[0].count > 0 ? counts[0].char : ','
}

export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '')
  const delimiter = detectDelimiter(source.split(/\r?\n/, 1)[0] ?? '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i += 1 } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === delimiter) { row.push(field); field = '' } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''))
}

export function normalizeDate(value: string): string {
  const text = value.trim()
  if (!text) return ''
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text)
  if (match) return iso(Number(match[1]), Number(match[2]), Number(match[3]))
  match = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(text)
  if (match) return iso(Number(match[3]), Number(match[2]), Number(match[1]))
  return ''
}

function iso(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function readLeads(text: string): ParseResult {
  const table = parseCsv(text)
  if (table.length < 2) return { rows: [], skipped: [], missing: [], error: 'The file has no rows under the header.' }
  const header = table[0].map(clean)
  const index = Object.fromEntries((Object.keys(ALIASES) as LeadField[]).map((field) => [
    field,
    header.findIndex((cell) => ALIASES[field].includes(cell)),
  ])) as Record<LeadField, number>
  const missing = (Object.keys(index) as LeadField[]).filter((field) => index[field] < 0)
  const missingRequired = REQUIRED.filter((field) => index[field] < 0)
  if (missingRequired.length) {
    return { rows: [], skipped: [], missing, error: `The file needs ${missingRequired.map((field) => `a ${FIELD_LABELS[field].toLowerCase()}`).join(' and ')} column.` }
  }
  const rows: ParsedLead[] = []
  const skipped: ParseResult['skipped'] = []
  table.slice(1).forEach((cells, offset) => {
    const get = (field: LeadField) => (index[field] >= 0 ? (cells[index[field]] ?? '').trim() : '')
    const line = offset + 2
    const name = get('name')
    const registration = get('registration')
    if (!name) { skipped.push({ line, reason: 'no name' }); return }
    if (!registration) { skipped.push({ line, reason: 'no registration' }); return }
    const rawDue = get('inspection_due')
    const due = normalizeDate(rawDue)
    if (rawDue && !due) { skipped.push({ line, reason: `inspection date “${rawDue}” not recognised` }); return }
    rows.push({ name, email: get('email'), phone: get('phone'), registration, inspection_due: due })
  })
  return { rows, skipped, missing, error: rows.length ? null : 'No rows could be imported.' }
}
