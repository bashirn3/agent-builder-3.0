"""Creates the K1 Muster booking workflow (staging chain 91) and activates it.

The webhook is public until n8n-gate.py is applied. Run the gate immediately after the staging test.
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
let recorded = false
let recordError = null
try {
  const saved = $('Record booking').isExecuted ? $('Record booking').first().json : null
  if (saved) {
    recordError = saved.message || saved.error || saved.hint || null
    recorded = !recordError && Boolean(saved.id || saved.phoneKey)
  }
} catch (error) {
  recordError = String(error)
}
const copy = { ...muster }
delete copy.record
return [{ json: { ...copy, recorded, recordError } }]
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
    'Save it?': {'main': [link('Record booking'), link('Shape')]},
    'Record booking': {'main': [link('Shape')]},
    'Shape': {'main': [link('From webhook?')]},
    'From webhook?': {'main': [link('Respond'), link('Done')]},
}
created = request('POST', '/workflows', {'name': 'K1 Muster Booking (staging)', 'nodes': nodes, 'connections': connections, 'settings': {'executionOrder': 'v1', 'timezone': 'Europe/Helsinki'}})
request('POST', f"/workflows/{created['id']}/activate")
print(created['id'])
