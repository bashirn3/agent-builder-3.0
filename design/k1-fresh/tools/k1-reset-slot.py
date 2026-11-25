"""Cancel the Muster staging slot when a chat is reset.

The staging reset button already asked the booking workflow to cancel open
rows. It left conversation_state in place, so the next "I want to book"
booked that same time again. Saying reset only deleted chat memory and never
called Muster.

This patches the live booking and agent workflows in place. It does not
replace them from a repo snapshot. Pass --phone <digits> to run one reset
for that number through the same path and print what is left.
"""
import importlib.util
import json
import sys
import time
import uuid
import urllib.request
from pathlib import Path

LIVE_BOOKING = 'wAE7EHLyJk6JsMue'
LIVE_AGENT = 'w8a9S1uxB5U9qnNO'
SETTINGS_KEEP = (
    'executionOrder', 'saveDataErrorExecution', 'saveDataSuccessExecution',
    'saveManualExecutions', 'timezone', 'errorWorkflow', 'executionTimeout', 'binaryMode',
)

RESET_REQUEST_JS = r"""const item = $input.first().json || {}
const raw = item.phone || (item.body && item.body.phone) || ''
return [{ json: { phone: String(raw).trim() } }]
"""

PREPARE_RESET_JS = r"""const turn = $input.first().json || {}
return [{ json: { action: 'reset', phone: String(turn.from_phone || '').replace(/\D/g, '') } }]
"""

CLEAR_SQL = r"""delete from chat_history where session_id in (
  '{{ 'k1_katsastus_demo_' + String($('Reset request').first().json.phone || '').replace(/\D/g, '') }}',
  '{{ 'k1_katsastus_demo_+' + String($('Reset request').first().json.phone || '').replace(/\D/g, '') }}'
);
delete from conversation_state where session_key in (
  '{{ 'k1_katsastus_demo_' + String($('Reset request').first().json.phone || '').replace(/\D/g, '') }}',
  '{{ 'k1_katsastus_demo_+' + String($('Reset request').first().json.phone || '').replace(/\D/g, '') }}'
);
delete from inbound_message_queue where from_phone in (
  '{{ String($('Reset request').first().json.phone || '').replace(/\D/g, '') }}',
  '{{ '+' + String($('Reset request').first().json.phone || '').replace(/\D/g, '') }}'
);"""

PHONE_BODY = "={{ { p_tenant_key: \"k1_katsastus_demo\", p_phone: $('Reset request').first().json.phone } }}"

# DELETE /Reservations/{groupId} is rejected (400). The reservation route is
# /Reservations/{stationId}/{reservationUid}. A missing reservation is already gone.
# A proxy 407 never reached Muster, so try another proxy before the next url.
CANCEL_LOOP = r"""const incoming = $input.all().map((item) => item.json)
const only = incoming.length === 1 ? incoming[0] : null
const rows = Array.isArray(only) ? only : incoming.filter((row) => row && row.groupId)
const seen = new Set()
const bookings = []
for (const row of rows) {
  if (!row || !row.groupId || seen.has(row.groupId)) continue
  seen.add(row.groupId)
  bookings.push(row)
}
const request = (options) => this.helpers.httpRequest.call(this, options)
const cancelled = []
for (const booking of bookings) {
  const urls = []
  if (booking.stationId && booking.reservationUid) {
    urls.push('https://staging-booking-api.muster.fi/v3/91/Reservations/' + booking.stationId + '/' + booking.reservationUid + '?sendConfirmation=false')
  }
  urls.push('https://staging-booking-api.muster.fi/v3/91/Reservations/' + booking.groupId + '?sendConfirmation=false')
  let ok = false
  let status = 0
  for (const url of urls) {
    if (ok) break
    for (let attempt = 0; attempt < 4 && !ok; attempt++) {
      try {
        const response = await request({
          method: 'DELETE', url, json: true, timeout: 25000,
          returnFullResponse: true, ignoreHttpStatusErrors: true,
          proxy: PROXIES[Math.floor(Math.random() * PROXIES.length)],
        })
        status = Number(response.statusCode || response.status || 0)
        if (status === 407 || status === 0 || status >= 500) continue
        if ((status >= 200 && status < 300) || status === 404) ok = true
        else break
      } catch (error) {
        status = Number(error.statusCode || error.httpCode || error.status || 0)
        if (status === 404) ok = true
        if (status === 407 || status === 0 || status >= 500) continue
        break
      }
    }
  }
  cancelled.push({ groupId: booking.groupId, ok, status })
}
return [{ json: { cancelled } }]
"""

# The agent cancel_booking tool deletes by group id and gets the same 400.
# owned_details carries the station id; the event id carries the reservation uid.
CANCEL_FN_OLD = """async function cancel() {
  const groupId = repairedEventId(body.event_id || body.group_id).split('|')[0]
  if (!groupId) return { ok: false, error: 'cancel needs the event_id from the booking' }
  const notOwner = ownershipError(groupId)
  if (notOwner) return notOwner
  const response = await muster('DELETE', `/Reservations/${groupId}?sendConfirmation=false`)
  if (response.status !== 200 && response.status !== 204) return { ok: false, step: 'cancel', status: response.status, error: response.data }
  return { ok: true, success: true, already_cancelled: response.status === 204, group_id: groupId, cancelLocal: true }
}"""

CANCEL_FN_NEW = """async function cancel() {
  const repaired = repairedEventId(body.event_id || body.group_id)
  const parts = String(repaired || '').split('|')
  const groupId = parts[0]
  if (!groupId) return { ok: false, error: 'cancel needs the event_id from the booking' }
  const notOwner = ownershipError(groupId)
  if (notOwner) return notOwner
  const owned = (input.owned_details || []).find((row) => row && row.groupId === groupId) || {}
  const stationId = owned.stationId || body.station_id || body.stationId
  const reservationUid = parts[1] || owned.reservationUid
  const path = stationId && reservationUid
    ? `/Reservations/${stationId}/${reservationUid}?sendConfirmation=false`
    : `/Reservations/${groupId}?sendConfirmation=false`
  const response = await muster('DELETE', path)
  if (response.status !== 200 && response.status !== 204 && response.status !== 404) return { ok: false, step: 'cancel', status: response.status, error: response.data }
  return { ok: true, success: true, already_cancelled: response.status === 204 || response.status === 404, group_id: groupId, cancelLocal: true }
}"""

SETTLED_JS = r"""const muster = $input.first().json || {}
const rows = Array.isArray(muster.cancelled) ? muster.cancelled : []
return [{ json: { ...muster, settled: rows.every((row) => row && row.ok !== false) } }]
"""

RESET_FAILED_JS = r"""const muster = $('Cancel in Muster').first().json || {}
return [{ json: { ok: false, cancelled: muster.cancelled || [], error: 'muster_cancel_failed', memoryCleared: false } }]
"""

RESET_RESULT_JS = r"""const cleared = $('Clear local customer').first().json || {}
const muster = $('Cancel in Muster').first().json || {}
const failed = (muster.cancelled || []).some((row) => row && row.ok === false)
return [{ json: { ok: !cleared.message && !failed, cancelled: muster.cancelled || [], local: cleared, memoryCleared: true } }]
"""


def load_gate():
    path = Path(__file__).with_name('n8n-gate.py')
    spec = importlib.util.spec_from_file_location('n8n_gate', path)
    gate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gate)
    return gate


def link(name):
    return {'node': name, 'type': 'main', 'index': 0}


def node_id(name):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f'k1-reset-slot/{name}'))


def upsert(workflow, node):
    for index, existing in enumerate(workflow['nodes']):
        if existing['name'] != node['name']:
            continue
        merged = dict(existing)
        merged.update(node)
        merged['id'] = existing['id']
        if 'credentials' in existing:
            merged['credentials'] = existing['credentials']
        workflow['nodes'][index] = merged
        return
    workflow['nodes'].append(node)


def truth_if(left):
    return {
        'conditions': {
            'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2},
            'conditions': [{
                'id': 'settled',
                'leftValue': left,
                'rightValue': '',
                'operator': {'type': 'boolean', 'operation': 'true', 'singleValue': True},
            }],
            'combinator': 'and',
        },
        'options': {},
    }


def equals_if(left, right):
    return {
        'conditions': {
            'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2},
            'conditions': [{
                'id': 'reset-action',
                'leftValue': left,
                'rightValue': right,
                'operator': {'type': 'string', 'operation': 'equals'},
            }],
            'combinator': 'and',
        },
        'options': {},
    }


def code_node(name, position, js):
    return {
        'id': node_id(name),
        'name': name,
        'type': 'n8n-nodes-base.code',
        'typeVersion': 2,
        'position': position,
        'parameters': {'mode': 'runOnceForAllItems', 'jsCode': js},
    }


def patch_booking(workflow):
    named = {item['name']: item for item in workflow['nodes']}
    for required in ('When called by the agent', 'Needs ownership?', 'Which action?', 'Open bookings', 'Clear local customer', 'Clear chat memory', 'Cancel in Muster', 'Reset result'):
        if required not in named:
            raise SystemExit(f'booking workflow is missing {required}')
    trigger = named['When called by the agent']['position']
    opened = named['Open bookings']['position']
    upsert(workflow, {
        'id': node_id('Agent reset?'),
        'name': 'Agent reset?',
        'type': 'n8n-nodes-base.if',
        'typeVersion': 2.2,
        'position': [trigger[0] + 220, trigger[1] - 80],
        'parameters': equals_if('={{ $json.action }}', 'reset'),
    })
    upsert(workflow, code_node('Reset request', [opened[0] - 220, opened[1]], RESET_REQUEST_JS))
    named = {item['name']: item for item in workflow['nodes']}
    named['Open bookings']['alwaysOutputData'] = True
    named['Open bookings']['parameters']['jsonBody'] = PHONE_BODY
    named['Clear local customer']['parameters']['jsonBody'] = PHONE_BODY
    named['Clear chat memory']['parameters']['query'] = CLEAR_SQL
    named['Reset result']['parameters']['jsCode'] = RESET_RESULT_JS
    muster = named.get('Muster')
    if muster is None:
        raise SystemExit('booking workflow is missing Muster')
    muster_js = muster['parameters']['jsCode']
    if CANCEL_FN_NEW not in muster_js:
        if CANCEL_FN_OLD not in muster_js:
            raise SystemExit('booking tool cancel() no longer matches the group-id delete')
        muster['parameters']['jsCode'] = muster_js.replace(CANCEL_FN_OLD, CANCEL_FN_NEW, 1)
    cancel = named['Cancel in Muster']
    js = cancel['parameters']['jsCode']
    marker = 'const incoming = $input.all().map((item) => item.json)'
    start = js.find(marker)
    if start < 0:
        raise SystemExit('cancel node lost its request loop')
    if "booking.stationId + '/' + booking.reservationUid" not in js:
        cancel['parameters']['jsCode'] = js[:start] + CANCEL_LOOP
    settled_at = named['Cancel in Muster']['position']
    upsert(workflow, code_node('Cancel settled', [settled_at[0] + 220, settled_at[1]], SETTLED_JS))
    upsert(workflow, {
        'id': node_id('Cancel ok?'),
        'name': 'Cancel ok?',
        'type': 'n8n-nodes-base.if',
        'typeVersion': 2.2,
        'position': [settled_at[0] + 440, settled_at[1]],
        'parameters': truth_if('={{ $json.settled }}'),
    })
    upsert(workflow, code_node('Reset failed', [settled_at[0] + 660, settled_at[1] + 160], RESET_FAILED_JS))
    connections = workflow['connections']
    connections['When called by the agent'] = {'main': [[link('Agent reset?')]]}
    connections['Agent reset?'] = {'main': [[link('Reset request')], [link('Needs ownership?')]]}
    which = connections['Which action?']['main']
    if len(which) < 3:
        raise SystemExit('booking action switch has no reset output')
    which[2] = [link('Reset request')]
    connections['Reset request'] = {'main': [[link('Open bookings')]]}
    connections['Cancel in Muster'] = {'main': [[link('Cancel settled')]]}
    connections['Cancel settled'] = {'main': [[link('Cancel ok?')]]}
    connections['Cancel ok?'] = {'main': [[link('Clear local customer')], [link('Reset failed')]]}
    connections['Reset failed'] = {'main': [[link('Respond')]]}


def patch_agent(workflow):
    named = {item['name']: item for item in workflow['nodes']}
    for required in ('Is Reset?', 'Purge Session'):
        if required not in named:
            raise SystemExit(f'agent workflow is missing {required}')
    reset = named['Is Reset?']['position']
    upsert(workflow, code_node('Prepare reset call', [reset[0] + 220, reset[1] - 160], PREPARE_RESET_JS))
    upsert(workflow, {
        'id': node_id('Cancel Bookings'),
        'name': 'Cancel Bookings',
        'type': 'n8n-nodes-base.executeWorkflow',
        'typeVersion': 1.2,
        'position': [reset[0] + 440, reset[1] - 160],
        'parameters': {
            'workflowId': {
                '__rl': True,
                'mode': 'id',
                'value': LIVE_BOOKING,
                'cachedResultName': 'K1 Muster Booking (staging)',
            },
            'workflowInputs': {
                'mappingMode': 'defineBelow',
                'value': {'action': 'reset', 'phone': '={{ $json.phone }}'},
                'matchingColumns': [],
                'schema': [
                    {'id': 'action', 'displayName': 'action', 'type': 'string', 'required': False, 'defaultMatch': False, 'display': True, 'canBeUsedToMatch': True},
                    {'id': 'phone', 'displayName': 'phone', 'type': 'string', 'required': False, 'defaultMatch': False, 'display': True, 'canBeUsedToMatch': True},
                ],
                'attemptToConvertTypes': False,
                'convertFieldsToString': True,
            },
            'options': {'waitForSubWorkflow': True},
        },
    })
    false_branch = workflow['connections']['Is Reset?']['main'][1]
    workflow['connections']['Is Reset?'] = {'main': [[link('Prepare reset call')], false_branch]}
    workflow['connections']['Prepare reset call'] = {'main': [[link('Cancel Bookings')]]}
    workflow['connections']['Cancel Bookings'] = {'main': [[link('Purge Session')]]}


def put_live(gate, wid, body):
    was_active = bool(body.get('active'))
    payload = {
        'name': body['name'],
        'nodes': body['nodes'],
        'connections': body['connections'],
        'settings': {key: value for key, value in (body.get('settings') or {}).items() if key in SETTINGS_KEEP},
    }
    if body.get('staticData') is not None:
        payload['staticData'] = body['staticData']
    if body.get('pinData'):
        payload['pinData'] = body['pinData']
    gate.request('POST', f'/workflows/{wid}/deactivate')
    try:
        try:
            gate.request('PUT', f'/workflows/{wid}', payload)
        except Exception:
            payload.pop('staticData', None)
            payload.pop('pinData', None)
            gate.request('PUT', f'/workflows/{wid}', payload)
    finally:
        if was_active:
            gate.request('POST', f'/workflows/{wid}/activate')


def assert_live(gate):
    booking = gate.request('GET', f'/workflows/{LIVE_BOOKING}')
    agent = gate.request('GET', f'/workflows/{LIVE_AGENT}')
    if not booking.get('active') or not agent.get('active'):
        raise SystemExit('workflow left inactive')
    muster = next(node['parameters']['jsCode'] for node in booking['nodes'] if node['name'] == 'Muster')
    if len(muster) < 100000:
        raise SystemExit('booking code node was shortened')
    query = next(node['parameters']['query'] for node in booking['nodes'] if node['name'] == 'Clear chat memory')
    if 'conversation_state' not in query:
        raise SystemExit('conversation state is not cleared on reset')
    cancel_js = next(node['parameters']['jsCode'] for node in booking['nodes'] if node['name'] == 'Cancel in Muster')
    if "booking.stationId + '/' + booking.reservationUid" not in cancel_js:
        raise SystemExit('reset still deletes the muster slot by group id')
    if 'attempt < 4' not in cancel_js:
        raise SystemExit('muster cancel does not retry')
    if '/Reservations/${stationId}/${reservationUid}?sendConfirmation=false' not in muster:
        raise SystemExit('booking tool cancel still deletes by group id only')
    if booking['connections']['Cancel ok?']['main'][1][0]['node'] != 'Reset failed':
        raise SystemExit('a failed muster cancel still clears the local booking')
    if booking['connections']['Agent reset?']['main'][0][0]['node'] != 'Reset request':
        raise SystemExit('agent reset does not cancel bookings')
    if agent['connections']['Cancel Bookings']['main'][0][0]['node'] != 'Purge Session':
        raise SystemExit('reset keyword does not cancel before it clears memory')
    if agent['connections']['Is Reset?']['main'][1][0]['node'] != 'Attach booking site':
        raise SystemExit('normal replies no longer continue past reset')
    return booking, agent


def run_phone(gate, phone):
    path = 'k1-slot-check-' + uuid.uuid4().hex
    check_js = (
        "const item = $input.first().json || {}\n"
        "const check = String((item.query || {}).check || '') === '1'\n"
        f"return [{{ json: {{ action: check ? 'my_bookings' : 'reset', phone: '{phone}' }} }}]\n"
    )
    hook_id = str(uuid.uuid4())
    nodes = [
        {
            'id': hook_id, 'name': 'Webhook', 'type': 'n8n-nodes-base.webhook', 'typeVersion': 2.1,
            'position': [240, 300], 'webhookId': hook_id,
            'parameters': {'httpMethod': 'POST', 'path': path, 'responseMode': 'responseNode', 'options': {}},
        },
        code_node('Prepare check', [460, 300], check_js),
        {
            'id': node_id('Run check'), 'name': 'Run check', 'type': 'n8n-nodes-base.executeWorkflow', 'typeVersion': 1.2,
            'position': [680, 300], 'onError': 'continueRegularOutput',
            'parameters': {
                'workflowId': {'__rl': True, 'mode': 'id', 'value': LIVE_BOOKING, 'cachedResultName': 'K1 Muster Booking (staging)'},
                'workflowInputs': {
                    'mappingMode': 'defineBelow',
                    'value': {'action': '={{ $json.action }}', 'phone': '={{ $json.phone }}'},
                    'matchingColumns': [],
                    'schema': [
                        {'id': 'action', 'displayName': 'action', 'type': 'string', 'required': False, 'defaultMatch': False, 'display': True, 'canBeUsedToMatch': True},
                        {'id': 'phone', 'displayName': 'phone', 'type': 'string', 'required': False, 'defaultMatch': False, 'display': True, 'canBeUsedToMatch': True},
                    ],
                    'attemptToConvertTypes': False,
                    'convertFieldsToString': True,
                },
                'options': {'waitForSubWorkflow': True},
            },
        },
        {
            'id': node_id('Respond check'), 'name': 'Respond', 'type': 'n8n-nodes-base.respondToWebhook', 'typeVersion': 1.5,
            'position': [900, 300],
            'parameters': {'respondWith': 'json', 'responseBody': '={{ $json }}', 'options': {'responseCode': 200}},
        },
    ]
    connections = {
        'Webhook': {'main': [[link('Prepare check')]]},
        'Prepare check': {'main': [[link('Run check')]]},
        'Run check': {'main': [[link('Respond')]]},
    }
    created = gate.request('POST', '/workflows', {
        'name': 'tmp slot check',
        'nodes': nodes,
        'connections': connections,
        'settings': {'executionOrder': 'v1', 'saveDataSuccessExecution': 'none', 'saveDataErrorExecution': 'none'},
    })
    wid = created['id']
    try:
        gate.request('POST', f'/workflows/{wid}/activate')
        time.sleep(2)
        origin = __import__('os').environ.get('N8N_RAPID_BASE_URL') or gate.local_env().get('N8N_RAPID_BASE_URL') or gate.DEFAULT_BASE

        def call(check):
            url = origin.rstrip('/') + '/webhook/' + path + ('?check=1' if check else '')
            req = urllib.request.Request(url, data=b'{}', method='POST', headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=120) as res:
                return json.loads(res.read().decode())

        reset = call(False)
        left = call(True)
        cancelled = reset.get('cancelled') or []
        local = reset.get('local') or {}
        bookings = left.get('bookings') or []
        print(json.dumps({
            'ok': bool(reset.get('ok')),
            'cancelled': [
                {'groupId': row.get('groupId'), 'ok': row.get('ok'), 'status': row.get('status')}
                for row in cancelled if isinstance(row, dict)
            ],
            'local': {
                'removedBookings': local.get('removedBookings'),
                'removedContext': local.get('removedContext'),
            },
            'memoryCleared': reset.get('memoryCleared') is True,
            'error': reset.get('error'),
            'remaining': left.get('count', len(bookings) if isinstance(bookings, list) else None),
        }))
    finally:
        try:
            gate.request('POST', f'/workflows/{wid}/deactivate')
        except Exception:
            pass
        last_error = None
        for _ in range(4):
            time.sleep(1)
            try:
                gate.request('DELETE', f'/workflows/{wid}')
                last_error = None
                break
            except Exception as error:
                last_error = error
        if last_error:
            raise last_error


def main():
    gate = load_gate()
    booking = gate.request('GET', f'/workflows/{LIVE_BOOKING}')
    agent = gate.request('GET', f'/workflows/{LIVE_AGENT}')
    patch_booking(booking)
    patch_agent(agent)
    put_live(gate, LIVE_BOOKING, booking)
    put_live(gate, LIVE_AGENT, agent)
    assert_live(gate)
    print('reset path updated')
    if len(sys.argv) >= 3 and sys.argv[1] == '--phone':
        digits = ''.join(ch for ch in sys.argv[2] if ch.isdigit())
        if len(digits) < 8:
            raise SystemExit('phone needs digits')
        run_phone(gate, digits)


if __name__ == '__main__':
    main()
