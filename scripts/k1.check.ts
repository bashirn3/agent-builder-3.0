import {
  activeFilterCount,
  CONVERSATIONS,
  EMPTY_FILTERS,
  filterConversations,
  filterLeads,
  LEADS,
  submittedStamp,
  toCsv,
} from '../src/k1/data/fixtures.ts'
import { applyFormat } from '../src/k1/ui/format.ts'
import { href, parse } from '../src/k1/routes.ts'
import { hasVisibleReply, matchesFilters, requireAgentReply, type TestChatSummary } from '../src/k1/data/builderApi.ts'
import { describeChanges, localizeNote } from '../src/k1/data/changes.ts'
import { en, fi } from '../src/k1/i18n/copy.ts'
import { normalizeDate, parseCsv, readLeads } from '../src/k1/data/csv.ts'
import { detectLanguage, fillTemplate, leadContext } from '../src/k1/data/language.ts'
import { TJ_SHOWCASE, matchingShowcase, showcaseById } from '../src/k1/data/tjShowcase.ts'

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

assert(TJ_SHOWCASE.length === 4, 'four editorial TJ journeys must stay available')
assert(new Set(TJ_SHOWCASE.map((chat) => chat.conversation.id)).size === 4, 'showcase chat links must be stable and unique')
assert(TJ_SHOWCASE.every((chat) => chat.messages.every((message, i) =>
  (message.origin === 'supplied' || message.origin === 'illustrative') &&
  (!i || new Date(message.createdAt) >= new Date(chat.messages[i - 1].createdAt)))), 'showcase turns must carry provenance and chronological display times')
assert(TJ_SHOWCASE.every((chat) => chat.conversation.messageCount === chat.messages.length), 'showcase counts must match visible turns')
assert(TJ_SHOWCASE.every((chat) => showcaseById(chat.conversation.id)?.conversation.id === chat.conversation.id), 'showcase detail links must resolve')
assert(matchingShowcase('CGP-3').length === 1 && matchingShowcase('viikolla 41').length === 1, 'showcase search must include plates and customer messages')

for (const route of [
  { page: 'signin' },
  { page: 'signup' },
  { page: 'playground' },
  { page: 'compare' },
  { page: 'deploy', version: 'abc-123' },
  { page: 'deploy' },
  { page: 'chats', id: null },
  { page: 'chats', id: 'c-1042' },
  { page: 'leads', id: null },
  { page: 'leads', id: 'l-virtanen' },
] as const) {
  assert(JSON.stringify(parse(href(route))) === JSON.stringify(route), `route round-trip failed for ${JSON.stringify(route)}`)
}

for (const lead of LEADS) {
  for (const id of lead.conversationIds) {
    const conversation = CONVERSATIONS.find((item) => item.id === id)
    assert(Boolean(conversation), `lead ${lead.id} links to missing conversation ${id}`)
    assert(conversation?.leadId === lead.id, `conversation ${id} does not link back to lead ${lead.id}`)
  }
  assert(lead.phoneNumber.startsWith('+358 40 000 '), `lead ${lead.id} must use a placeholder phone number`)
  assert(lead.product === '004' && lead.sample, `lead ${lead.id} must be a sample 004 inspection lead`)
}

assert(filterConversations(CONVERSATIONS, EMPTY_FILTERS).length === CONVERSATIONS.length, 'empty filters must keep every conversation')
const ranged = filterConversations(CONVERSATIONS, { ...EMPTY_FILTERS, from: '2026-09-20', to: '2026-09-23' })
assert(ranged.every((item) => item.startedAt.slice(0, 10) >= '2026-09-20' && item.startedAt.slice(0, 10) <= '2026-09-23'), 'date range must bound conversations')
assert(ranged.length === 4, `expected 4 conversations between 20 and 23 September, got ${ranged.length}`)
const thumbsUp = filterConversations(CONVERSATIONS, { ...EMPTY_FILTERS, from: '2026-09-20', to: '2026-09-23', feedback: 'up' })
assert(thumbsUp.length === 1 && thumbsUp[0].id === 'c-1042', 'combined filters must intersect')
assert(activeFilterCount({ ...EMPTY_FILTERS, from: '2026-09-01', to: '2026-09-02', outcome: 'Booked' }) === 2, 'a date range counts as one filter')

assert(toCsv([{ a: 'x,y', b: 'say "hi"' }]) === 'a,b\n"x,y","say ""hi"""', 'CSV must escape commas and quotes')
assert(toCsv([]) === '', 'empty CSV is empty')

assert(filterLeads(LEADS, { from: null, to: null }).length === LEADS.length, 'no date range keeps every lead')
const dueSoon = filterLeads(LEADS, { from: '2026-10-01', to: '2026-10-20' })
assert(dueSoon.length === 3 && dueSoon.every((lead) => lead.nextInspection! >= '2026-10-01' && lead.nextInspection! <= '2026-10-20'), `expected 3 leads due 1–20 October, got ${dueSoon.length}`)
assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(submittedStamp(LEADS[0].addedAt)), 'added-at uses the YYYY-MM-DD HH:mm shape')

const text = 'Role\nTone\nRules'
const bullets = applyFormat(text, 0, text.length, 'bullet')
assert(bullets.value === '- Role\n- Tone\n- Rules', 'bullet formats every selected line')
assert(applyFormat(bullets.value, 0, bullets.value.length, 'bullet').value === text, 'bullet toggles off when every line has it')
assert(applyFormat(bullets.value, 0, bullets.value.length, 'number').value === '1. Role\n2. Tone\n3. Rules', 'numbering replaces an existing list prefix')
assert(applyFormat(text, 5, 5, 'heading').value === 'Role\n### Tone\nRules', 'heading applies to the caret line only')
const bold = applyFormat(text, 0, 4, 'bold')
assert(bold.value.startsWith('**Role**') && bold.start === 2 && bold.end === 6, 'bold wraps the selection and keeps it selected')
const unbold = applyFormat(bold.value, bold.start, bold.end, 'bold')
assert(unbold.value === text && unbold.start === 0 && unbold.end === 4, 'bold toggles off when the selection is already bold')
assert(applyFormat('**Role**', 0, 8, 'bold').value === 'Role', 'bold toggles off when the markers are selected too')
const italic = applyFormat(text, 5, 9, 'italic')
assert(italic.value === 'Role\n_Tone_\nRules' && italic.start === 6 && italic.end === 10, 'italic wraps the selection in underscores')
assert(applyFormat('Role\nTone\n', 0, 5, 'bullet').value === '- Role\nTone\n', 'a selection ending at a line break does not format the next line')

const chat = (over: Partial<TestChatSummary>): TestChatSummary => ({
  id: 'c', versionId: 'v', versionNumber: 3, isDraft: false, source: 'playground', title: 'Saturday?', startedBy: null,
  createdAt: '2026-09-20T10:00:00.000Z', updatedAt: '2026-09-20T10:00:00.000Z', messageCount: 2, thumbsUp: 0, thumbsDown: 1, lastReply: 'No', ...over,
})
const none = { versions: [], includeDraft: true, feedback: null, source: null, from: null, to: null, query: '' } as const
assert(matchesFilters(chat({}), { ...none, versions: [3] }), 'version filter keeps chats on that version')
assert(!matchesFilters(chat({}), { ...none, versions: [4] }), 'version filter drops other versions')
assert(matchesFilters(chat({ isDraft: true }), { ...none, versions: [4] }), 'drafts stay when drafts are included')
assert(!matchesFilters(chat({ isDraft: true }), { ...none, includeDraft: false }), 'drafts can be hidden')
assert(matchesFilters(chat({}), { ...none, feedback: 'down' }) && !matchesFilters(chat({}), { ...none, feedback: 'up' }), 'feedback filter')
assert(!matchesFilters(chat({}), { ...none, source: 'compare' }), 'source filter')
assert(matchesFilters(chat({}), { ...none, query: 'SATURDAY' }) && !matchesFilters(chat({}), { ...none, query: 'price' }), 'search matches the title, ignoring case')
assert(!matchesFilters(chat({}), { ...none, from: '2026-09-21T00:00:00.000Z' }), 'date filter')
for (const empty of [undefined, null, '', '   ', '\n\t', '\u200B\u200D\uFEFF']) {
  assert(!hasVisibleReply(empty), 'empty and invisible agent replies must be rejected')
  let rejected = false
  try { requireAgentReply(empty) } catch (error) { rejected = (error as Error).message === 'empty_agent_reply' }
  assert(rejected, 'an empty agent reply must trigger a recoverable error')
}
assert(requireAgentReply('  Sure, what day works for you?  ') === 'Sure, what day works for you?', 'visible replies are preserved and trimmed')
const base = { locked: false, masterPrompt: 'a', additional: '', opener: 'hi' }
assert(describeChanges(base, { ...base, masterPrompt: 'b', opener: 'hey' }) === 'Edited base prompt · Changed English opener', 'change note lists edits')
assert(describeChanges(base, { ...base, additional: 'Open Mon–Fri.' }) === 'Edited additional instructions', 'change note mentions additional instructions')

const rem = (texts: string[]) => texts.map((text) => ({ text, days: text ? 3 : null }))
assert(describeChanges({ ...base, reminders: rem(['', '', '']) }, { ...base, reminders: rem(['Hi again', '', '']) }) === 'Changed reminder 1', 'change note names the changed reminder')
assert(describeChanges({ ...base, reminders: rem(['a', 'b', '']) }, { ...base, reminders: rem(['a', 'c', 'd']) }) === 'Changed reminders 2, 3', 'change note lists several reminders')

assert(JSON.stringify(parseCsv('a;b\n"x;1";"he said ""hi"""\n')) === JSON.stringify([['a', 'b'], ['x;1', 'he said "hi"']]), 'CSV handles semicolons and quotes')
assert(normalizeDate('1.10.2026') === '2026-10-01' && normalizeDate('2026-10-01') === '2026-10-01' && normalizeDate('31/02/2026') === '', 'dates: Finnish, ISO, and impossible dates')
const csv = readLeads('StationName;isClosed;PlateNumber;Product;NextInspectionDateRangeEnd;PhoneNumber;Language;LastInspection;Reason\nK1 Katsastus Kouvola Kankaanpää;0;JJ-190;D04;2026-09-23T00:00:00;0401234567;Suomi;2025-09-23T00:00:00;previous visit\nK1 Katsastus Imatra;1;CON-150;D04;1.10.2026;0409999999;Svenska;;previous visit\n;0;;D04;;;;;\nX;0;BAD-1;D04;soon;;;;\n')
assert(csv.error === null && csv.rows.length === 2, 'Muster columns are read')
assert(csv.rows[0].NextInspectionDateRangeEnd === '2026-09-23' && csv.rows[0].LastInspection === '2025-09-23' && !csv.rows[0].isClosed, 'Muster datetimes become dates')
assert(csv.rows[1].isClosed && csv.rows[1].NextInspectionDateRangeEnd === '2026-10-01', 'isClosed and Finnish dates are read')
assert(csv.skipped.map((row) => row.reason).join('|') === 'no plate number|next inspection by “soon” not recognised', 'bad rows are skipped with a reason')
assert(readLeads('Rekisterinumero,Puhelin\nABC-123,040\n').rows[0].PlateNumber === 'ABC-123', 'Finnish headers still map')
assert(readLeads('email,phone\na@x.fi,1\n').error === 'The file needs a PlateNumber column.', 'a missing plate column is explained')

const lead = { plateNumber: 'JJ-190', stationName: 'K1 Katsastus Kouvola', nextInspection: '2026-09-23', lastInspection: '2025-09-23', language: 'Suomi' }
assert(detectLanguage('Ruotsi') === 'sv' && detectLanguage('Englanti') === 'en' && detectLanguage(' suomi ') === 'fi', 'Muster writes languages in Finnish (Suomi, Ruotsi, Englanti)')
assert(localizeNote('Edited base prompt · Changed reminders 1, 3 · Changed Finnish opener', fi) === 'Muokattu perusohjetta · Muutettu muistutuksia 1, 3 · Muutettu suomenkielistä avausviestiä', 'saved change notes are shown in Finnish')
assert(localizeNote('Edited base prompt · Something new', en) === 'Edited base prompt · Something new', 'unknown note parts pass through unchanged')
const missing = (a: Record<string, unknown>, b: Record<string, unknown>, path = ''): string[] => Object.keys(a).flatMap((key) => {
  if (!(key in b)) return [`${path}${key}`]
  const left = a[key]
  const right = b[key]
  return left && typeof left === 'object' && !Array.isArray(left) ? missing(left as Record<string, unknown>, right as Record<string, unknown>, `${path}${key}.`) : []
})
assert(!missing(en, fi).length, `Finnish copy is missing: ${missing(en, fi).join(', ')}`)
assert(detectLanguage('Suomi') === 'fi' && detectLanguage('svenska') === 'sv' && detectLanguage('Deutsch') === 'en' && detectLanguage('') === 'fi', 'a missing language is Finnish and other languages get English')
assert(fillTemplate('Hi {{first_name}}, {{registration_number}} is due by {{due_date}} at {{station}} (last {{last_inspection}}).', lead) === 'Hi, JJ-190 is due by 23.9.2026 at K1 Katsastus Kouvola (last 23.9.2025).', 'placeholders fill from the lead; first name is dropped')
assert(fillTemplate('{{due_date}}', { ...lead, language: 'English' }) === '23 Sep 2026', 'English dates are written out')
assert(fillTemplate('Täällä K1 Katsastus {{station}}.', lead) === 'Täällä K1 Katsastus Kouvola.', 'the brand is not written twice when the station name already carries it')
assert(fillTemplate('Täällä K1 Katsastus {{station}}.', { ...lead, stationName: 'Palokka' }) === 'Täällä K1 Katsastus Palokka.', 'the brand is kept when the station name does not carry it')
assert(describeChanges({ ...base, translations: { fi: { opener: '', reminders: [] } } }, { ...base, translations: { fi: { opener: 'Hei', reminders: [] } } }) === 'Changed Finnish opener', 'change note names the language')

console.log('k1 checks passed')

const swedish = leadContext({ plateNumber: 'ABC-123', stationName: 'SULJETTU K1 Katsastus Turku Itäharju', nextInspection: '2026-10-05', lastInspection: '2025-10-05', language: 'Ruotsi' }, 'en')
assert(swedish.includes("Customer's language: Swedish. Reply in Swedish") && swedish.includes('sent in English because no Swedish version') && swedish.includes('Station the customer last visited: K1 Katsastus Turku Itäharju. Default to this station') && swedish.includes('Inspection due by: 5.10.2026'), 'lead context names the language, the fallback opener and the station')
assert(!leadContext({ plateNumber: 'X-1', stationName: '', nextInspection: null, lastInspection: null, language: 'Suomi' }, 'fi').includes('opening message was sent'), 'no fallback note when the opener matched the language')
const electric = leadContext({ plateNumber: 'X-1', stationName: 'K1 Katsastus Espoo Suomenoja', nextInspection: null, lastInspection: null, language: 'Suomi', product: '004e', vehicleCategory: 'M1' }, 'fi')
assert(electric.includes('Product on the reminder: 004e') && electric.includes('no measuring product') && electric.includes('Vehicle category: M1'), 'lead context carries the reminder product and vehicle category')
assert(electric.includes('Power type of the vehicle: electric'), 'lead context gives the power type derived from the product')
assert(leadContext({ plateNumber: 'X-2', stationName: '', nextInspection: null, lastInspection: null, language: 'Suomi', product: '004', powerType: 'multi-power' }, 'fi').includes('Power type of the vehicle: multi-power.'), 'a power type on the lead wins over the derived one')
assert(!/opening hours \(Europe\/Helsinki\)/i.test(electric) && !/Published station opening hours/.test(electric), 'lead context no longer hardcodes station hours')
console.log('lead context checks passed')
