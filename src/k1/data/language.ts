export type Lang = 'en' | 'fi' | 'sv'

export const LANGUAGES: Array<{ code: Lang; label: string }> = [
  { code: 'fi', label: 'Finnish' },
  { code: 'sv', label: 'Swedish' },
  { code: 'en', label: 'English' },
]

export const TRANSLATED: Array<Exclude<Lang, 'en'>> = ['fi', 'sv']

const ALIASES: Record<Lang, string[]> = {
  en: ['englanti', 'english', 'en', 'eng', 'engelska'],
  fi: ['suomi', 'finnish', 'fi', 'fin', 'suomeksi', 'finska'],
  sv: ['svenska', 'swedish', 'sv', 'swe', 'ruotsi', 'ruotsiksi'],
}

// Anything that is not recognisably Finnish or Swedish gets English.
export function detectLanguage(value: string | null | undefined): Lang {
  const text = (value ?? '').trim().toLowerCase()
  if (ALIASES.fi.includes(text)) return 'fi'
  if (ALIASES.sv.includes(text)) return 'sv'
  return 'en'
}

export function formatDate(iso: string | null | undefined, lang: Lang) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  if (!match) return ''
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (lang === 'en') return `${day} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1]} ${year}`
  return `${day}.${month}.${year}`
}

export type TemplateLead = {
  plateNumber: string
  stationName: string
  nextInspection: string | null
  lastInspection: string | null
  language: string
}

export function fillTemplate(text: string, lead: TemplateLead, lang: Lang = detectLanguage(lead.language)) {
  return text
    .replace(/[ \t]*{{\s*first[-_\s]?name\s*}}/gi, '')
    .replace(/{{\s*(registration[-_\s]?number|plate[-_\s]?number)\s*}}/gi, lead.plateNumber)
    .replace(/{{\s*due[-_\s]?date\s*}}/gi, formatDate(lead.nextInspection, lang))
    .replace(/{{\s*last[-_\s]?inspection\s*}}/gi, formatDate(lead.lastInspection, lang))
    .replace(/{{\s*station\s*}}/gi, lead.stationName)
}

const LANGUAGE_NAMES: Record<Lang, string> = { fi: 'Finnish', sv: 'Swedish', en: 'English' }

// Sent with every test turn so the agent knows who it is talking to; the saved prompt is never changed.
export function leadContext(lead: TemplateLead, openerLang: Lang) {
  const lang = detectLanguage(lead.language)
  const station = lead.stationName.replace(/^SULJETTU\s+/i, '').trim()
  const lines = [
    "LEAD CONTEXT (from K1's lead data for this customer)",
    `- Customer's language: ${LANGUAGE_NAMES[lang]}. Reply in ${LANGUAGE_NAMES[lang]} unless the customer writes in another language; then follow the LANGUAGE rules.`,
    openerLang !== lang && `- The opening message was sent in ${LANGUAGE_NAMES[openerLang]} because no ${LANGUAGE_NAMES[lang]} version exists yet.`,
    station && `- Station: ${station}. Offer this station first for bookings.`,
    lead.plateNumber && `- Registration: ${lead.plateNumber}`,
    lead.nextInspection && `- Inspection due by: ${formatDate(lead.nextInspection, 'fi')}`,
    lead.lastInspection && `- Last inspection: ${formatDate(lead.lastInspection, 'fi')}`,
  ]
  return lines.filter(Boolean).join('\n')
}
