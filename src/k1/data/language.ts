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

// A missing language means Finnish; any other language that is not Finnish or Swedish gets English.
export function detectLanguage(value: string | null | undefined): Lang {
  const text = (value ?? '').trim().toLowerCase()
  if (!text || ALIASES.fi.includes(text)) return 'fi'
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
  phoneNumber?: string
  product?: string
  vehicleCategory?: string
  powerType?: string
}

// Staging chain 91. Only the two K1 stations can be booked.
export function bookingStationId(name: string): number | null {
  const text = name.replace(/^SULJETTU\s+/i, '')
  if (/palokka/i.test(text)) return 256
  if (/it[aä]harju/i.test(text)) return 241
  return null
}

export function fillTemplate(text: string, lead: TemplateLead, lang: Lang = detectLanguage(lead.language)) {
  return text
    .replace(/[ \t]*{{\s*first[-_\s]?name\s*}}/gi, '')
    .replace(/{{\s*(registration[-_\s]?number|plate[-_\s]?number)\s*}}/gi, lead.plateNumber)
    .replace(/{{\s*due[-_\s]?date\s*}}/gi, formatDate(lead.nextInspection, lang))
    .replace(/{{\s*last[-_\s]?inspection\s*}}/gi, formatDate(lead.lastInspection, lang))
    .replace(/(K1 Katsastus\s+)?{{\s*station\s*}}/gi, (_match, brand) => (brand && /^K1 Katsastus\b/i.test(lead.stationName) ? '' : brand ?? '') + lead.stationName)
}

const LANGUAGE_NAMES: Record<Lang, string> = { fi: 'Finnish', sv: 'Swedish', en: 'English' }

const PRODUCT_NOTES: Record<string, string> = {
  '004': 'periodic inspection of a car or van up to 3500 kg with a combustion engine; statutory measuring (0020) is added',
  '0040': 'periodic inspection of a camper or larger car; statutory measuring (0020) is added; not offered at every station',
  '004e': 'periodic inspection of a fully electric car; no measuring product',
}

const POWER_FROM_PRODUCT: Record<string, string> = {
  '004e': 'electric',
  '004': 'combustion engine or multi-power (petrol, diesel, hybrid or gas)',
  '0040': 'combustion engine (camper or larger car)',
}

// The lead's own power type wins; otherwise it is derived from the reminder product.
export function powerTypeOf(lead: Pick<TemplateLead, 'powerType' | 'product'>) {
  const given = (lead.powerType ?? '').trim()
  if (given) return given
  return POWER_FROM_PRODUCT[(lead.product ?? '').trim().toLowerCase()] ?? ''
}

// Sent with every test turn so the agent knows who it is talking to; the saved prompt is never changed.
// Station hours are never listed here: the agent reads them live per station from the get_station_info tool.
export function leadContext(lead: TemplateLead, openerLang: Lang) {
  const lang = detectLanguage(lead.language)
  const station = lead.stationName.replace(/^SULJETTU\s+/i, '').trim()
  const product = (lead.product ?? '').trim().toLowerCase()
  const lines = [
    "LEAD CONTEXT (from K1's lead data for this customer)",
    `- Customer's language: ${LANGUAGE_NAMES[lang]}. Reply in ${LANGUAGE_NAMES[lang]} unless the customer writes in another language; then follow the LANGUAGE rules.`,
    openerLang !== lang && `- The opening message was sent in ${LANGUAGE_NAMES[openerLang]} because no ${LANGUAGE_NAMES[lang]} version exists yet.`,
    station ? `- Station the customer last visited: ${station}. Default to this station; use get_station_info for its live opening hours and for any other station they ask about.` : '- Station: unknown. Ask which K1 station or city they mean.',
    product && `- Product on the reminder: ${product}${PRODUCT_NOTES[product] ? ` (${PRODUCT_NOTES[product]})` : ''}. This applies to the registration below only.`,
    lead.vehicleCategory && `- Vehicle category: ${lead.vehicleCategory}.`,
    powerTypeOf(lead) && `- Power type of the vehicle: ${powerTypeOf(lead)}. Use it in your answers about this vehicle.`,
    lead.phoneNumber && `- Customer phone: ${lead.phoneNumber}. It belongs to this customer only and must NEVER be given as a station contact number. Verified national K1 booking number: 0306 100 100.`,
    lead.plateNumber && `- Registration: ${lead.plateNumber}`,
    lead.nextInspection && `- Inspection due by: ${formatDate(lead.nextInspection, 'fi')}`,
    lead.lastInspection && `- Last inspection: ${formatDate(lead.lastInspection, 'fi')}`,
  ]
  return lines.filter(Boolean).join('\n')
}
