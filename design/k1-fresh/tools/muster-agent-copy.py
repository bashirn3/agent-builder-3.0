"""Copy WF-2 into a Muster staging agent. The live workflow is only read.

The copy's webhook path is changed before it is activated, so Wasup keeps calling the original.
Booking tools call the Muster booking workflow. A playground webhook runs the same agent and
returns the reply instead of sending WhatsApp.
"""
import json, uuid, importlib.util

spec = importlib.util.spec_from_file_location('gate', '/Users/bashirsani/Desktop/Projects/agent-builder-3.0/design/k1-fresh/tools/n8n-gate.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

SOURCE = 'q7Z8SWaiZH2QgYuC'
BOOKING = 'wAE7EHLyJk6JsMue'
OVERRIDE = """MUSTER STAGING OVERRIDE. This copy books on Muster staging, chain 91, vehicle category M1. Ignore every instruction below about Google Calendar, 45-minute slots, Vuosaari, price 59, and plate ABC-123.
Stations: 256 K1 Katsastus Jyväskylä Palokka (Palokanorsi 1) and 241 K1 Katsastus Turku Itäharju (Munkkionkuja 1). Use the station_id from the lead. If none is given, ask which of these two.
get_slots returns slot_id values. Pass that exact slot_id as start_time to book or reschedule. Offer at most two times. Never invent a time.
A booking is real only when book_inspection_invite returns success true and a booking_number. Tell the customer that number. Reuse event_id for reschedule and cancel.
Slots are 15 minutes. Do not send a payment link. The customer pays at the station.
If the tool returns success false or compensated, the booking does not exist. Say so.

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
                assignment['value'] = OVERRIDE + assignment['value']
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
  session_key: 'k1_katsastus_demo_' + phone.replace(/\D/g, ''),
} }]
"""

reply = r"""
const out = $('AI Agent').first().json.output || {}
const messages = Array.isArray(out.messages) ? out.messages.map((line) => String(line).trim()).filter(Boolean) : []
const saved = $input.first().json || {}
const row = Array.isArray(saved) ? (saved[0] || {}) : saved
return [{ json: {
  reply: messages.join('\n\n'),
  mode: 'muster',
  recorded: Boolean(row.agent_message_id || row.conversation_id),
  messageId: row.agent_message_id || null,
  userMessageId: row.user_message_id || null,
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
