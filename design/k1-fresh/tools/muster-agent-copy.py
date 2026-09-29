"""Copy WF-2 into a Muster staging agent. The live workflow is only read.

The copy's webhook path is changed before it is activated, so Wasup keeps calling the original.
Booking tools call the Muster booking workflow. A playground webhook runs the same agent and
returns the reply instead of sending WhatsApp.
"""
import json, uuid, importlib.util

spec = importlib.util.spec_from_file_location('gate', __file__.replace('muster-agent-copy.py', 'n8n-gate.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

SOURCE = 'q7Z8SWaiZH2QgYuC'
BOOKING = 'wAE7EHLyJk6JsMue'
OVERRIDE = """# K1 Muster staging assistant — authoritative business rules
You are a concise booking assistant for K1 Katsastus inspections on Muster staging chain 91, vehicle category M1. This is a customer-facing test chat, not a calendar invitation. The customer's language controls the reply: Finnish, English, or Swedish. The latest customer message determines the response language, regardless of the lead's stored language or previous thread: if the latest message is Swedish, the ENTIRE reply is Swedish (including cancellation, rescheduling, station changes, and handoffs); if English, English only; if Finnish, Finnish only. Never copy the tool output language. Swedish must not contain Finnish words or phrases such as 'meillä', 'maksulinkki', 'en pysty', 'tarkistaa', 'varaus', 'asemalle', 'ota yhteyttä'. Before returning, silently reread every customer-facing message in the chosen language and rewrite a mixed-language message in that language. Ask exactly ONE question per turn, for the single next missing detail (date → time → plate confirmation → name); do not combine time, name, and plate into one question. Use short natural messages, and never invent availability, an address, a price, a link, a phone number, or a tool result.

Stations: 256 K1 Katsastus Jyväskylä Palokka (Palokanorsi 1, 40270 Jyväskylä), published hours Mon–Fri 09:00–17:00; 241 K1 Katsastus Turku Itäharju (Munkkionkuja 1, 20520 Turku), published hours Mon–Fri 08:40–17:00. Both are closed on weekends. These are the currently published station opening hours (checked on the official station pages on 28 September 2026), NOT proof that a slot can be booked: check live get_slots and warn if staging returns a time outside the published opening hours; do not offer or book such a time as an ordinary appointment. Special dates may differ; defer to the station for exceptions. For Itäharju Fridays, use the official station listing for the specific Friday when available; do not confidently generalize 08:40–17:00 to all Fridays if the date-specific hours differ. If you cannot verify a date-specific exception, qualify the hours. Do not confuse the national booking phone service hours with physical station opening hours. Use the station_id supplied for this customer, and use its own hours when asked; ask before changing stations. Never mention Vuosaari, Google Calendar, Meet, an email invite, a fixed price, or a payment link. Payment is at the station. Do not imply a human was alerted: the escalation tool stores an internal flag only, not a notification. If a human must act, say that you cannot complete the request here and suggest the verified national booking number 0306 100 100 or the official station website, without claiming a team has received it. NEVER present the customer's phone, chat phone, lead phone, tool input phone, or any number starting +358 400 as the station's phone or ask them to call it. The customer's phone is for session/booking identity only. If no verified station-specific number is available, give 0306 100 100 or just direct them to the official K1 station page. An opt-out is not complete merely because you promise it; call opt_out and only confirm what the tool actually reports.

Date arithmetic: Use the current calendar date in Europe/Helsinki supplied by the system. A week runs Monday through Sunday (ISO 8601). 'Next week', 'ensi viikolla', and 'nästa vecka' mean the NEXT Monday through Sunday, never tomorrow or a day in the current week. 'Tomorrow', 'huomenna', and 'i morgon' are the next Helsinki calendar day. If the date cannot be resolved confidently, ask for an exact date instead of calling get_slots with an implicit default. Ask for the preferred day if only a week is given; do not present slots for a day in the wrong week. Never offer a past time.

Real tool rules: get_slots(date_from, date_to, station_id) is the ONLY source of available 15-minute slots. Offer at most two actual returned slots for the requested day that also fall within the selected station's published opening hours. Do not call book_inspection_invite just because a day was named; require the customer to choose an exact available clock time, and confirm the vehicle plate and name. Email may be requested if useful, but Muster does not require email and does not send an email invite: never block an otherwise valid booking solely for a missing email. book_inspection_invite(start_time, rek, name, phone, language) must use the exact slot_id from get_slots and return success true AND booking_number before you say booked; state that number. If it fails or was compensated, say it is NOT booked. For a change, first get_slots and use reschedule_booking with the actual event_id from a previous successful booking; never create a second booking. For cancellation, use cancel_booking with the actual event_id from a previous successful booking. Only say cancelled after success true AND recorded true (or already_cancelled with no live booking). If event_id is unknown, do not guess or claim a cancellation; ask for the booking details. A booking number, name, or plate alone is NOT an event_id and cannot authorize a different reservation. If the user provides a different plate than the lead record, ask which is correct and wait for explicit confirmation before any booking; never silently pick one. Do not claim a handoff was sent, do not expose internal identifiers unless it is the customer-facing booking number. A requested booking link must be verified; otherwise state that no verified link is available and offer to help in chat. Never use the old hold_slot or book_slot simulation tools.

If the user asks to stop messages, treat it as opt-out; if a matter is outside these two stations or requires human help, do not invent an outcome. Preserve customer facts across turns and never contradict a confirmed plate, time, or station.
"""

source = gate.request('GET', f'/workflows/{SOURCE}')
nodes = source['nodes']
connections = source['connections']

for node in nodes:
    if node['type'].endswith('webhook'):
        node['parameters']['path'] = 'k1-muster-agent-inbound'
        node.pop('webhookId', None)
    if node['name'] == '⚙️ CONFIG':
        for assignment in node['parameters']['assignments']['assignments']:
            if assignment['name'] == 'business_prompt':
                assignment['value'] = OVERRIDE
    if node['name'] in ('get_slots', 'book_inspection_invite', 'reschedule_booking', 'cancel_booking'):
        node['parameters']['workflowId']['value'] = BOOKING
        node['parameters']['workflowId']['cachedResultName'] = 'K1 Muster Booking (staging)'
        phone = node['parameters']['workflowInputs']['value'].get('phone', '')
        node['parameters']['workflowInputs']['value']['phone'] = phone.replace(
            "$('Webhook').first().json.body.from_phone",
            "$('Playground Turn').isExecuted ? $('Playground Turn').first().json.from_phone : $('Webhook').first().json.body.from_phone",
        )
        if node['name'] in ('get_slots', 'book_inspection_invite', 'reschedule_booking'):
            node['parameters']['workflowInputs']['value']['station_id'] = "={{ $('Playground Turn').isExecuted && $('Playground Turn').first().json.station_id ? String($('Playground Turn').first().json.station_id) : $fromAI('station_id', '256 Palokka or 241 Itäharju. Use the lead station_id. Ask if it is unknown.', 'string') }}"
            schema = node['parameters']['workflowInputs'].setdefault('schema', [])
            if not any(field.get('id') == 'station_id' for field in schema):
                schema.append({'id': 'station_id', 'displayName': 'station_id', 'type': 'string', 'display': True, 'required': False, 'defaultMatch': False, 'canBeUsedToMatch': True})
    if node['name'] == 'Postgres Chat Memory':
        node['parameters']['sessionKey'] = "={{ $('Playground Turn').isExecuted ? $('Playground Turn').first().json.session_key : ($('⚙️ CONFIG').first().json.tenant_key + '_' + $('Webhook').first().json.body.from_phone) }}"

descriptions = {
    'get_slots': 'Get live free 15-minute inspection slots from Muster staging. Pass date_from and date_to as YYYY-MM-DD (Europe/Helsinki) and station_id 256 or 241. Returns slots[].slot_id and display_fi. Offer MAX TWO. Never invent a slot_id.',
    'book_inspection_invite': 'Book a NEW 15-minute inspection on Muster staging. FORBIDDEN unless the customer named a clock time. start_time MUST be the exact slot_id from get_slots. Reuse plate, name and phone. success true includes booking_number and event_id. If success is false, it is not booked.',
    'reschedule_booking': 'Move an existing Muster booking. start_time is the new slot_id. event_id is the one returned when it was booked. The booking number stays the same.',
    'cancel_booking': 'Cancel an existing Muster booking. event_id is required. sendConfirmation is never used. If already_cancelled is true, it was already gone.',
}
for node in nodes:
    if node['name'] in descriptions:
        node['parameters']['description'] = descriptions[node['name']]

playground_turn = r"""
const body = $input.first().json.body || {}
const phone = String(body.phone || '').trim()
const text = String(body.text || '').trim()
const messages = Array.isArray(body.messages) ? body.messages : []
const latest = [...messages].reverse().find((message) => message.role === 'user')
const agent_input = [
  '[BUILDER PROMPT]',
  String(body.masterPrompt || ''),
  String(body.additionalInformation || ''),
  '',
  '[OPENER ALREADY SENT TO CUSTOMER]',
  String(body.opener || ''),
  'This is an existing conversation. Answer the customer after this opener; do not send the opener again.',
  '',
  '[LEAD]',
  String(body.leadContext || ''),
  `phone: ${phone}`,
  `station_id: ${body.stationId || 'unknown'}`,
  '',
  '[TURN]',
  'turn_type: user_message',
  '',
  '[USER]',
  text || (latest && latest.content) || ''
].join('\n')
return [{ json: {
  agent_input,
  is_reset: false,
  from_phone: phone,
  station_id: body.stationId || null,
  // A new test conversation must never inherit memory from a previous test for this phone.
  session_key: 'k1_katsastus_demo_' + phone.replace(/\D/g, '') + '_chat_' + String(body.conversationId || '').replace(/[^a-zA-Z0-9-]/g, ''),
} }]
"""

reply = r"""
const agent = $('AI Agent').first().json
const out = agent.output || {}
const messages = Array.isArray(out.messages) ? out.messages.map((line) => String(line).trim()).filter(Boolean) : []
const saved = $input.first().json || {}
const row = Array.isArray(saved) ? (saved[0] || {}) : saved
const allowedTools = new Set(['get_slots', 'book_inspection_invite', 'reschedule_booking', 'cancel_booking', 'opt_out', 'escalate_to_human'])
const allowInputs = new Set(['station_id', 'date_from', 'date_to', 'start_time', 'rek', 'language', 'event_id'])
const steps = Array.isArray(agent.intermediateSteps) ? agent.intermediateSteps : []
const toolCalls = steps.flatMap((step) => {
  const name = String(step.action?.tool || step.tool || '')
  if (!allowedTools.has(name)) return []
  let input = step.action?.toolInput ?? step.toolInput ?? {}
  if (typeof input === 'string') { try { input = JSON.parse(input) } catch { input = {} } }
  const params = Object.fromEntries(Object.entries(input && typeof input === 'object' ? input : {})
    .filter(([key]) => allowInputs.has(key)).map(([key, value]) => [key, String(value).slice(0, 160)]))
  return [{ name, params }]
})
return [{ json: {
  reply: messages.join('\n\n'),
  mode: 'muster',
  recorded: Boolean(row.agent_message_id || row.conversation_id),
  messageId: row.agent_message_id || null,
  userMessageId: row.user_message_id || null,
  toolCalls,
} }]
"""

added = [
    {'id': str(uuid.uuid4()), 'name': 'Playground', 'type': 'n8n-nodes-base.webhook', 'typeVersion': 2.1, 'position': [-5200, 1100],
     'parameters': {'httpMethod': 'POST', 'path': 'k1-agent-builder/booking-chat', 'responseMode': 'responseNode', 'options': {}}},
    {'id': str(uuid.uuid4()), 'name': 'Playground Turn', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [-4900, 1100],
     'parameters': {'mode': 'runOnceForAllItems', 'jsCode': playground_turn}},
    {'id': str(uuid.uuid4()), 'name': 'Playground call?', 'type': 'n8n-nodes-base.if', 'typeVersion': 2.2, 'position': [-2800, 860],
     'parameters': {'conditions': {'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2}, 'conditions': [{'id': 'pg', 'leftValue': '={{ $("Playground Turn").isExecuted ? "yes" : "no" }}', 'rightValue': 'yes', 'operator': {'type': 'string', 'operation': 'equals'}}], 'combinator': 'and'}, 'options': {}}},
    {'id': str(uuid.uuid4()), 'name': 'Record playground turn', 'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 4.2, 'position': [-2500, 720],
     'onError': 'continueRegularOutput', 'credentials': {'supabaseApi': {'id': 'sKZQDTU3b68ZSLwX', 'name': 'K1 Agent builder DB'}},
     'parameters': {'method': 'POST', 'url': 'https://wuejgskyjzuffqsgvunp.supabase.co/rest/v1/rpc/record_test_turn', 'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'supabaseApi', 'sendBody': True, 'specifyBody': 'json', 'jsonBody': '={{ { p_tenant_key: "k1_katsastus_demo", p_conversation_id: $("Playground").first().json.body.conversationId, p_version_id: $("Playground").first().json.body.versionId, p_is_draft: $("Playground").first().json.body.isDraft, p_source: $("Playground").first().json.body.source || "playground", p_opener: $("Playground").first().json.body.opener || "", p_user_text: $("Playground Turn").first().json.agent_input.split("[USER]").pop().trim(), p_agent_text: (Array.isArray($("AI Agent").first().json.output.messages) ? $("AI Agent").first().json.output.messages : []).join("\\n\\n"), p_started_by: null } }}', 'options': {}}},
    {'id': str(uuid.uuid4()), 'name': 'Playground reply', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [-2200, 720],
     'parameters': {'mode': 'runOnceForAllItems', 'jsCode': reply}},
    {'id': str(uuid.uuid4()), 'name': 'Respond to playground', 'type': 'n8n-nodes-base.respondToWebhook', 'typeVersion': 1.5, 'position': [-1900, 720],
     'parameters': {'respondWith': 'json', 'responseBody': '={{ $json }}', 'options': {}}},
]
nodes.extend(added)
link = lambda name: [{'node': name, 'type': 'main', 'index': 0}]
connections['Playground'] = {'main': [link('Playground Turn')]}
connections['Playground Turn'] = {'main': [link('AI Agent')]}
connections['AI Agent'] = {'main': [link('Playground call?')]}
connections['Playground call?'] = {'main': [link('Record playground turn'), link('Plan Delivery')]}
connections['Record playground turn'] = {'main': [link('Playground reply')]}
connections['Playground reply'] = {'main': [link('Respond to playground')]}

created = gate.request('POST', '/workflows', {
    'name': 'K1 Muster agent (staging copy of WF-2)',
    'nodes': nodes,
    'connections': connections,
    'settings': {'executionOrder': 'v1', 'timezone': 'Europe/Helsinki', 'saveDataErrorExecution': 'all', 'saveDataSuccessExecution': 'none'},
})
print(created['id'])
