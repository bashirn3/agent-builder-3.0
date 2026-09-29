"""Creates the K1 Muster booking workflow (staging chain 91) and activates it.

The webhook is public until n8n-gate.py is applied. Run the gate immediately after the staging test.
Do not rerun this creator against a live workflow; patch the existing gated workflow in place.
"""
import json, os, re, urllib.request

BASE = 'https://n8n-rapid-czbff9cnafhkhmhf.eastus-01.azurewebsites.net/api/v1'
HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = open(os.path.join(HERE, 'muster-engine.js')).read()
SUPABASE = {'supabaseApi': {'id': 'sKZQDTU3b68ZSLwX', 'name': 'K1 Agent builder DB'}}


def api_key():
    text = open(os.path.expanduser('~/.cursor/mcp.json')).read()
    return re.search(r'N8N_API_KEY"?\s*:\s*"([^"]+)', text).group(1)


def request(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={'X-N8N-API-KEY': api_key(), 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as res:
        raw = res.read()
        return json.loads(raw) if raw else None


SHAPE = r"""
const muster = $('Muster').first().json
const request = (options) => this.helpers.httpRequest.call(this, options)
let recorded = false
let recordError = null
try {
  const saved = $('Record booking').isExecuted ? $('Record booking').first().json : null
  if (saved) {
    const raw = saved.message || saved.error || saved.hint || null
    recordError = raw && typeof raw === 'object' ? (raw.message || raw.description || 'save failed') : raw
    recorded = !recordError && Boolean(saved.id || saved.phoneKey)
  }
} catch (error) {
  recordError = String(error)
}
if (muster.record && !recorded && muster.group_id) {
  try {
    await request({ method: 'DELETE', url: 'https://staging-booking-api.muster.fi/v3/91/Reservations/' + muster.group_id + '?sendConfirmation=false', json: true })
  } catch (error) {}
  return [{ json: { ok: false, success: false, compensated: true, error: 'The booking was made in Muster but could not be saved, so it was cancelled.', recordError: String(recordError).slice(0, 400) } }]
}
const copy = { ...muster }
delete copy.record
delete copy.cancelLocal
return [{ json: { ...copy, recorded, recordError: recordError ? String(recordError).slice(0, 400) : null } }]
"""

CANCELLATION_RESULT = r"""
const muster = $('Muster').first().json
const saved = $input.first().json
const raw = saved && (saved.message || saved.error || saved.hint)
const value = typeof saved === 'number' ? saved : saved && (saved.updated ?? saved.count ?? saved.data ?? saved.body ?? saved.result ?? saved.value ?? saved.json)
let updated = NaN
try {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  updated = Number(Array.isArray(parsed) ? parsed[0]?.mark_booking_cancelled : parsed && typeof parsed === 'object' ? parsed.mark_booking_cancelled : parsed)
} catch (error) {}
if (raw || !Number.isInteger(updated) || updated < 1) {
  return [{ json: {
    ...muster,
    ok: false,
    success: false,
    step: 'mark_booking_cancelled',
    error: raw ? String(typeof raw === 'object' ? raw.message || raw.description || 'save failed' : raw).slice(0, 400) : 'Booking cancelled in Muster, but the stored booking was not marked cancelled.',
  } }]
}
return [{ json: { ...muster, recorded: true, updated } }]
"""

nodes = [
    {'id': 'k1-booking-hook', 'name': 'Webhook', 'type': 'n8n-nodes-base.webhook', 'typeVersion': 2.1, 'position': [240, 280],
     'parameters': {'httpMethod': 'POST', 'path': 'k1-agent-builder/booking', 'responseMode': 'responseNode', 'options': {}}},
    {'id': 'k1-booking-exec', 'name': 'When called by the agent', 'type': 'n8n-nodes-base.executeWorkflowTrigger', 'typeVersion': 1.1, 'position': [240, 480],
     'parameters': {'inputSource': 'passthrough'}},
    {'id': 'k1-booking-muster', 'name': 'Muster', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [520, 360],
     'parameters': {'mode': 'runOnceForAllItems', 'jsCode': ENGINE}},
    {'id': 'k1-booking-record-if', 'name': 'Save it?', 'type': 'n8n-nodes-base.if', 'typeVersion': 2.2, 'position': [780, 360],
     'parameters': {'conditions': {'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2}, 'conditions': [{'id': 'rec', 'leftValue': '={{ $json.record ? "yes" : "no" }}', 'rightValue': 'yes', 'operator': {'type': 'string', 'operation': 'equals'}}], 'combinator': 'and'}, 'options': {}}},
    {'id': 'k1-booking-record', 'name': 'Record booking', 'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 4.2, 'position': [1040, 260],
     'onError': 'continueRegularOutput', 'credentials': SUPABASE,
     'parameters': {'method': 'POST', 'url': 'https://wuejgskyjzuffqsgvunp.supabase.co/rest/v1/rpc/record_booking', 'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'supabaseApi', 'sendBody': True, 'specifyBody': 'json', 'jsonBody': '={{ $json.record }}', 'options': {}}},
    {'id': 'k1-booking-cancel-if', 'name': 'Cancelled in Muster?', 'type': 'n8n-nodes-base.if', 'typeVersion': 2.2, 'position': [1040, 500],
     'parameters': {'conditions': {'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2}, 'conditions': [{'id': 'cancel', 'leftValue': '={{ $json.cancelLocal && $json.ok ? "yes" : "no" }}', 'rightValue': 'yes', 'operator': {'type': 'string', 'operation': 'equals'}}], 'combinator': 'and'}, 'options': {}}},
    {'id': 'k1-booking-mark-cancelled', 'name': 'Mark booking cancelled', 'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 4.2, 'position': [1290, 480],
     'onError': 'continueRegularOutput', 'credentials': SUPABASE,
     'parameters': {'method': 'POST', 'url': 'https://wuejgskyjzuffqsgvunp.supabase.co/rest/v1/rpc/mark_booking_cancelled', 'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'supabaseApi', 'sendBody': True, 'specifyBody': 'json', 'jsonBody': '={{ { p_tenant_key: "k1_katsastus_demo", p_group_id: $json.group_id } }}', 'options': {}}},
    {'id': 'k1-booking-cancel-result', 'name': 'Confirm cancellation', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [1500, 480],
     'parameters': {'mode': 'runOnceForAllItems', 'jsCode': CANCELLATION_RESULT}},
    {'id': 'k1-booking-shape', 'name': 'Shape', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [1300, 360],
     'parameters': {'mode': 'runOnceForAllItems', 'jsCode': SHAPE}},
    {'id': 'k1-booking-web-if', 'name': 'From webhook?', 'type': 'n8n-nodes-base.if', 'typeVersion': 2.2, 'position': [1540, 360],
     'parameters': {'conditions': {'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2}, 'conditions': [{'id': 'web', 'leftValue': '={{ $("Webhook").isExecuted ? "yes" : "no" }}', 'rightValue': 'yes', 'operator': {'type': 'string', 'operation': 'equals'}}], 'combinator': 'and'}, 'options': {}}},
    {'id': 'k1-booking-respond', 'name': 'Respond', 'type': 'n8n-nodes-base.respondToWebhook', 'typeVersion': 1.5, 'position': [1780, 260],
     'parameters': {'respondWith': 'json', 'responseBody': '={{ $json }}', 'options': {'responseCode': '={{ $json.ok ? 200 : 400 }}'}}},
    {'id': 'k1-booking-done', 'name': 'Done', 'type': 'n8n-nodes-base.noOp', 'typeVersion': 1, 'position': [1780, 460], 'parameters': {}},
]
link = lambda name: [{'node': name, 'type': 'main', 'index': 0}]
connections = {
    'Webhook': {'main': [link('Muster')]},
    'When called by the agent': {'main': [link('Muster')]},
    'Muster': {'main': [link('Save it?')]},
    'Save it?': {'main': [link('Record booking'), link('Cancelled in Muster?')]},
    'Record booking': {'main': [link('Shape')]},
    'Cancelled in Muster?': {'main': [link('Mark booking cancelled'), link('Shape')]},
    'Mark booking cancelled': {'main': [link('Confirm cancellation')]},
    'Confirm cancellation': {'main': [link('From webhook?')]},
    'Shape': {'main': [link('From webhook?')]},
    'From webhook?': {'main': [link('Respond'), link('Done')]},
}
created = request('POST', '/workflows', {'name': 'K1 Muster Booking (staging)', 'nodes': nodes, 'connections': connections, 'settings': {'executionOrder': 'v1', 'timezone': 'Europe/Helsinki'}})
request('POST', f"/workflows/{created['id']}/activate")
print(created['id'])
