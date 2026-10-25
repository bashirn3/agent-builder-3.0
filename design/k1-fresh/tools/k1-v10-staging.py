#!/usr/bin/env python3
"""Inactive WhatsApp copy of the live K1 agent for v10 staging.

Copies w8a9S1uxB5U9qnNO to "K1 v10 staging" and leaves it inactive.
The copy gets its own webhook paths, the rendered catalog prompt, the candidate
booking workflow (the one that stores the WhatsApp note), a pay-now tool, and
Wasup CTA buttons when a bubble has one booking or payment URL.

Nothing here activates the copy or changes the live workflow.
"""
import json
import uuid

import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('build', HERE / 'k1-agent-v2-build.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)
gate = build.gate

LIVE_AGENT = build.LIVE_AGENT
LIVE_BOOKING = build.LIVE_BOOKING
STAGING_NAME = 'K1 v10 staging'
INSTANCE = 'wa_mt1j5bcl_sch23'
SETTINGS_KEEP = build.SETTINGS_KEEP

CTA_JS = r"""const URL_RE = /https?:\/\/[^\s<>)]+/gi
function decorate(item) {
  const text = String(item.text || '')
  const urls = text.match(URL_RE) || []
  const raw = urls.length === 1 ? urls[0] : ''
  const only = raw.replace(/[.,;:!?]+$/g, '')
  const payment = /https?:\/\/(?:buy|checkout)\.stripe\.com/i.test(only)
  const booking = /https?:\/\/(?:www\.)?(?:ajanvaraus\.)?k1katsastus\.fi/i.test(only)
  if (!(payment || booking)) return { ...item, cta_url: '', cta_label: '', cta_body: text }
  const body = text.replace(raw, ' ').replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim()
  return {
    ...item,
    cta_url: only,
    cta_label: (payment ? 'Maksa nyt' : 'Varaa aika').slice(0, 25),
    cta_body: body || (payment ? 'Maksa katsastuksen perushinta tästä.' : 'Varaa aika tästä.'),
  }
}
return $input.all().map((row) => ({ json: decorate(row.json) }))
"""


def schema_entry(key):
    return {'id': key, 'displayName': key, 'type': 'string', 'display': True, 'required': False, 'defaultMatch': False, 'canBeUsedToMatch': True}


def retarget_paths(nodes):
    for node in nodes:
        if node['type'] != 'n8n-nodes-base.webhook':
            continue
        path = node['parameters'].get('path') or ''
        if path == 'k1-muster-agent-inbound':
            node['parameters']['path'] = 'k1-v10-staging-inbound'
        elif not str(path).endswith('-v10-staging'):
            node['parameters']['path'] = f'{path}-v10-staging'
        node['webhookId'] = str(uuid.uuid4())


def add_source(node):
    value = node['parameters']['workflowInputs']['value']
    value['source'] = 'whatsapp'
    schema = node['parameters']['workflowInputs'].setdefault('schema', [])
    if not any(entry.get('id') == 'source' for entry in schema):
        schema.append(schema_entry('source'))


def add_payment_tool(nodes, connections, named, payment_id):
    name = 'create_payment_link'
    template = named['get_slots']
    if name in named:
        node = named[name]
    else:
        node = json.loads(json.dumps(template))
        node.update({'id': str(uuid.uuid4()), 'name': name, 'position': [template['position'][0], template['position'][1] + 440]})
        nodes.append(node)
        named[name] = node
        connections[name] = {'ai_tool': [[{'node': 'AI Agent', 'type': 'ai_tool', 'index': 0}]]}
    node['parameters']['name'] = name
    node['parameters']['description'] = (
        'The 34 euro Stripe checkout url for a booking already made in this chat. Call it only after the customer chooses to pay now. '
        'Pass the booking number, station name and the confirmed weekday, date and time. Returns url. '
        'Tell the customer it is 34 euros for the inspection base and that they can enter WASUP100 on that page. Measuring is still paid at the station.'
    )
    node['parameters']['workflowId'] = {'__rl': True, 'value': payment_id, 'mode': 'id', 'cachedResultName': build.PAYMENT_NAME}
    phone = template['parameters']['workflowInputs']['value'].get('phone', '')
    value = {
        'phone': phone,
        'booking_number': "={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('booking_number', `The booking number returned by book_inspection_invite for the appointment just made.`, 'string') }}",
        'station_name': "={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('station_name', `The station name from that booking result.`, 'string') }}",
        'when_text': "={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('when_text', `Weekday, date and time of that booking, as confirmed to the customer.`, 'string') }}",
        'language': "={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('language', `fi, sv or en, the language of this chat.`, 'string') }}",
    }
    node['parameters']['workflowInputs'] = {
        'mappingMode': 'defineBelow', 'value': value, 'matchingColumns': [],
        'schema': [schema_entry(key) for key in value], 'attemptToConvertTypes': False, 'convertFieldsToString': True,
    }


def allow_payment_in_playground(nodes):
    for node in nodes:
        if node['name'] != 'Playground reply':
            continue
        code = node['parameters'].get('jsCode') or ''
        old = "new Set(['faq_lookup', 'get_station_info', 'get_my_bookings', 'get_slots',"
        new = "new Set(['create_payment_link', 'faq_lookup', 'get_station_info', 'get_my_bookings', 'get_slots',"
        if old in code and 'create_payment_link' not in code:
            node['parameters']['jsCode'] = code.replace(old, new, 1)


def if_parameters():
    return {
        'conditions': {
            'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2},
            'conditions': [{
                'id': str(uuid.uuid4()),
                'leftValue': '={{ $json.cta_url }}',
                'rightValue': '',
                'operator': {'type': 'string', 'operation': 'notEquals'},
            }],
            'combinator': 'and',
        },
        'looseTypeValidation': True,
        'options': {},
    }


def add_cta(nodes, connections, send_name):
    send = next(node for node in nodes if node['name'] == send_name)
    prep_name = f'{send_name} CTA fields'
    if_name = f'{send_name} CTA?'
    button_name = f'{send_name} CTA'
    if any(node['name'] == prep_name for node in nodes):
        return
    x, y = send['position']
    prep = {'id': str(uuid.uuid4()), 'name': prep_name, 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [x - 420, y],
            'parameters': {'mode': 'runOnceForAllItems', 'jsCode': CTA_JS}}
    gate_node = {'id': str(uuid.uuid4()), 'name': if_name, 'type': 'n8n-nodes-base.if', 'typeVersion': 2.2, 'position': [x - 200, y],
                 'parameters': if_parameters()}
    button = {
        'id': str(uuid.uuid4()), 'name': button_name, 'type': send['type'], 'typeVersion': send.get('typeVersion', 1),
        'position': [x, y - 160], 'credentials': json.loads(json.dumps(send.get('credentials') or {})),
        'parameters': {
            'resource': 'message',
            'operation': 'sendCta',
            'instanceId': json.loads(json.dumps(send['parameters']['instanceId'])),
            'to': send['parameters']['to'],
            'text': '={{ $json.cta_body }}',
            'ctaUrl': '={{ $json.cta_url }}',
            'ctaLabel': '={{ $json.cta_label }}',
        },
    }
    nodes.extend([prep, gate_node, button])
    for outs in connections.values():
        for branches in outs.values():
            for branch in branches or []:
                for link in branch or []:
                    if link.get('node') == send_name:
                        link['node'] = prep_name
    downstream = json.loads(json.dumps(connections.get(send_name, {'main': [[]]})))
    connections[prep_name] = {'main': [[{'node': if_name, 'type': 'main', 'index': 0}]]}
    connections[if_name] = {'main': [[{'node': button_name, 'type': 'main', 'index': 0}], [{'node': send_name, 'type': 'main', 'index': 0}]]}
    connections[button_name] = downstream


def apply(live, booking_id, payment_id):
    nodes = json.loads(json.dumps(live['nodes']))
    connections = json.loads(json.dumps(live['connections']))
    retarget_paths(nodes)
    named = {node['name']: node for node in nodes}
    prompt = build.k1_prompt.prompt()
    for item in named['⚙️ CONFIG']['parameters']['assignments']['assignments']:
        if item['name'] == 'business_prompt':
            item['value'] = prompt
        if item['name'] == 'wasup_instance_id' and item['value'] != INSTANCE:
            raise SystemExit(f'live instance changed: {item["value"]}')
    for node in nodes:
        workflow = (node.get('parameters') or {}).get('workflowId')
        if isinstance(workflow, dict) and workflow.get('value') == LIVE_BOOKING:
            workflow['value'] = booking_id
            workflow['cachedResultName'] = build.BOOKING_NAME
    for name in ('book_inspection_invite', 'reschedule_booking'):
        add_source(named[name])
    add_payment_tool(nodes, connections, named, payment_id)
    allow_payment_in_playground(nodes)
    add_cta(nodes, connections, 'Send Bubble')
    add_cta(nodes, connections, 'Send Double-Text')
    return nodes, connections


def save_inactive(nodes, connections, settings):
    body = {'name': STAGING_NAME, 'nodes': nodes, 'connections': connections, 'settings': {k: v for k, v in settings.items() if k in SETTINGS_KEEP}}
    existing = build.by_name(STAGING_NAME)
    if existing:
        gate.request('POST', f'/workflows/{existing}/deactivate')
        gate.request('PUT', f'/workflows/{existing}', body)
        wid = existing
    else:
        wid = gate.request('POST', '/workflows', body)['id']
    saved = gate.request('GET', f'/workflows/{wid}')
    if saved.get('active'):
        gate.request('POST', f'/workflows/{wid}/deactivate')
        saved = gate.request('GET', f'/workflows/{wid}')
    return saved


def check(saved, booking_id, payment_id):
    assert saved['active'] is False, 'staging workflow must stay inactive'
    paths = [node['parameters'].get('path') for node in saved['nodes'] if node['type'] == 'n8n-nodes-base.webhook']
    assert 'k1-muster-agent-inbound' not in paths, paths
    assert 'k1-v10-staging-inbound' in paths, paths
    named = {node['name']: node for node in saved['nodes']}
    config = {item['name']: item['value'] for item in named['⚙️ CONFIG']['parameters']['assignments']['assignments']}
    assert config['wasup_instance_id'] == INSTANCE
    assert 'do not mention Etuaika' in config['business_prompt']
    assert '34 euro' in config['business_prompt']
    assert 'create_payment_link' in config['business_prompt']
    for name in ('book_inspection_invite', 'reschedule_booking'):
        value = named[name]['parameters']['workflowInputs']['value']
        assert value.get('source') == 'whatsapp', name
        assert named[name]['parameters']['workflowId']['value'] == booking_id
    assert named['create_payment_link']['parameters']['workflowId']['value'] == payment_id
    for name in ('Send Bubble CTA', 'Send Double-Text CTA'):
        params = named[name]['parameters']
        assert params['operation'] == 'sendCta'
        assert params['ctaLabel'] == '={{ $json.cta_label }}'
        assert named[name]['credentials']['wasupApi']['id'] == 'SW7J0tWGyyYAPdkN'
    live = gate.request('GET', f'/workflows/{LIVE_AGENT}')
    live_paths = [node['parameters'].get('path') for node in live['nodes'] if node['type'] == 'n8n-nodes-base.webhook']
    assert 'k1-muster-agent-inbound' in live_paths
    assert live['active'] is True
    assert not any(node['name'] == 'Send Bubble CTA' for node in live['nodes'])


def main():
    booking_id = build.by_name(build.BOOKING_NAME)
    payment_id = build.by_name(build.PAYMENT_NAME)
    if not booking_id or not payment_id:
        raise SystemExit('candidate booking or payment workflow is missing; build those first')
    live = gate.request('GET', f'/workflows/{LIVE_AGENT}')
    nodes, connections = apply(live, booking_id, payment_id)
    saved = save_inactive(nodes, connections, live.get('settings') or {})
    check(saved, booking_id, payment_id)
    print(f'{STAGING_NAME} {saved["id"]} active={saved["active"]} inbound=k1-v10-staging-inbound')


if __name__ == '__main__':
    main()
