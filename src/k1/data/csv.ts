// Columns follow the Muster API record so an exported file can be uploaded again.
export type LeadField = 'StationName' | 'isClosed' | 'PlateNumber' | 'Product' | 'NextInspectionDateRangeEnd' | 'PhoneNumber' | 'Language' | 'LastInspection' | 'Reason'

export const LEAD_FIELDS: LeadField[] = ['StationName', 'isClosed', 'PlateNumber', 'Product', 'NextInspectionDateRangeEnd', 'PhoneNumber', 'Language', 'LastInspection', 'Reason']

export type ParsedLead = {
  StationName: string
  isClosed: boolean
  PlateNumber: string
  Product: string
  NextInspectionDateRangeEnd: string
  PhoneNumber: string
  Language: string
  LastInspection: string
  Reason: string
}

export type ParseResult = {
  rows: ParsedLead[]
  skipped: Array<{ line: number; reason: string }>
  missing: LeadField[]
  error: string | null
}

export const FIELD_LABELS: Record<LeadField, string> = {
  StationName: 'Station',
  isClosed: 'Station closed',
  PlateNumber: 'Plate number',
  Product: 'Product',
  NextInspectionDateRangeEnd: 'Next inspection by',
  PhoneNumber: 'Phone',
  Language: 'Language',
  LastInspection: 'Last inspection',
  Reason: 'Reason',
}

const ALIASES: Record<LeadField, string[]> = {
  StationName: ['stationname', 'station name', 'station', 'asema', 'katsastusasema'],
  isClosed: ['isclosed', 'is closed', 'closed', 'suljettu'],
  PlateNumber: ['platenumber', 'plate number', 'plate', 'registration', 'registration number', 'rekisteri', 'rekisterinumero', 'rekisteritunnus'],
  Product: ['product', 'tuote'],
  NextInspectionDateRangeEnd: ['nextinspectiondaterangeend', 'next inspection', 'next inspection by', 'inspection due', 'due date', 'seuraava katsastus'],
  PhoneNumber: ['phonenumber', 'phone number', 'phone', 'mobile', 'puhelin', 'puhelinnumero'],
  Language: ['language', 'kieli', 'språk'],
  LastInspection: ['lastinspection', 'last inspection', 'last visit', 'date of visit', 'edellinen katsastus'],
  Reason: ['reason', 'syy'],
}

const REQUIRED: LeadField[] = ['PlateNumber']

const clean = (value: string) => value.toLowerCase().replace(/[_\s]+/g, ' ').trim()

function detectDelimiter(firstLine: string) {
  const counts = [',', ';', '\t'].map((char) => ({ char, count: firstLine.split(char).length - 1 }))
  counts.sort((a, b) => b.count - a.count)
  return counts[0].count > 0 ? counts[0].char : ','
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

export function parseClosed(value: string) {
  return ['1', 'true', 'yes', 'kyllä', 'closed'].includes(value.trim().toLowerCase())
}

export type CsvMessages = {
  noRows: string
  needsPlate: string
  nothingImportable: string
  noPlate: string
  notRecognised: (label: string, value: string) => string
  fields?: Record<string, string>
}

const ENGLISH: CsvMessages = {
  noRows: 'The file has no rows under the header.',
  needsPlate: 'The file needs a PlateNumber column.',
  nothingImportable: 'No rows could be imported.',
  noPlate: 'no plate number',
  notRecognised: (label, value) => `${label} “${value}” not recognised`,
}

export function readLeads(text: string, messages: CsvMessages = ENGLISH): ParseResult {
  const table = parseCsv(text)
  if (table.length < 2) return { rows: [], skipped: [], missing: [], error: messages.noRows }
  const header = table[0].map(clean)
  const index = Object.fromEntries(LEAD_FIELDS.map((field) => [field, header.findIndex((cell) => ALIASES[field].includes(cell))])) as Record<LeadField, number>
  const missing = LEAD_FIELDS.filter((field) => index[field] < 0)
  const missingRequired = REQUIRED.filter((field) => index[field] < 0)
  if (missingRequired.length) return { rows: [], skipped: [], missing, error: messages.needsPlate }
  const rows: ParsedLead[] = []
  const skipped: ParseResult['skipped'] = []
  table.slice(1).forEach((cells, offset) => {
    const get = (field: LeadField) => (index[field] >= 0 ? (cells[index[field]] ?? '').trim() : '')
    const line = offset + 2
    const plate = get('PlateNumber')
    if (!plate) { skipped.push({ line, reason: messages.noPlate }); return }
    const dates = { NextInspectionDateRangeEnd: get('NextInspectionDateRangeEnd'), LastInspection: get('LastInspection') }
    const normalized = { NextInspectionDateRangeEnd: normalizeDate(dates.NextInspectionDateRangeEnd), LastInspection: normalizeDate(dates.LastInspection) }
    const bad = (Object.keys(dates) as Array<keyof typeof dates>).find((key) => dates[key] && !normalized[key])
    if (bad) { skipped.push({ line, reason: messages.notRecognised((messages.fields?.[bad] ?? FIELD_LABELS[bad]).toLowerCase(), dates[bad]) }); return }
    rows.push({
      StationName: get('StationName'),
      isClosed: parseClosed(get('isClosed')),
      PlateNumber: plate,
      Product: get('Product'),
      NextInspectionDateRangeEnd: normalized.NextInspectionDateRangeEnd,
      PhoneNumber: get('PhoneNumber'),
      Language: get('Language'),
      LastInspection: normalized.LastInspection,
      Reason: get('Reason'),
    })
  })
  return { rows, skipped, missing, error: rows.length ? null : messages.nothingImportable }
}
