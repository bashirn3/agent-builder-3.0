#!/usr/bin/env python3
"""Adds the `chats.delete` action to the signed-in builder API workflow (K1 Agent Builder API, Customer Data).

  k1-chat-delete.py test     copy the patched workflow, bypass sign-in in the copy, create two test chats, delete one, check the other survives, remove the copy
  k1-chat-delete.py apply    patch the live workflow (keeps a scrubbed backup in /tmp) and re-activate it

The action takes { ids: [uuid, ...] } (at most 500), looks up the K1 agent by tenant key and deletes only those test
conversations that belong to it. Messages go with the conversation (on delete cascade). Nothing else is touched.
"""
import importlib.util
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('gate', HERE / 'n8n-gate.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
spec = importlib.util.spec_from_file_location('platform_version', HERE / 'k1-platform-version.py')
platform = importlib.util.module_from_spec(spec)
spec.loader.exec_module(platform)

WORKFLOW = 'GQP7PPLJQA1Mmz2B'
SUPABASE = 'https://wuejgskyjzuffqsgvunp.supabase.co/rest/v1/'
CREDENTIAL = {'supabaseApi': {'id': 'sKZQDTU3b68ZSLwX', 'name': 'K1 Agent builder DB'}}
TENANT = 'k1_katsastus_demo'
NEW = ['Delete Chats?', 'Prepare Delete', 'Find Agent', 'Delete Chats', 'Shape Delete']
SETTINGS_KEEP = ('executionOrder', 'timezone', 'saveDataErrorExecution', 'saveDataSuccessExecution')


def http(name, node_id, position, method, url, headers=None):
    parameters = {'method': method, 'url': url, 'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'supabaseApi', 'options': {}}
    if headers:
        parameters.update({'sendHeaders': True, 'headerParameters': {'parameters': [{'name': k, 'value': v} for k, v in headers.items()]}})
    return {'id': node_id, 'name': name, 'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 4.2, 'alwaysOutputData': True, 'onError': 'continueRegularOutput',
            'position': position, 'credentials': CREDENTIAL, 'parameters': parameters}


def code(name, node_id, position, js):
    return {'id': node_id, 'name': name, 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': position, 'parameters': {'mode': 'runOnceForAllItems', 'jsCode': js}}


PREPARE = """const body = $('Check Access').first().json.body || {};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map((id) => String(id).toLowerCase()).filter((id) => UUID.test(id)))].slice(0, 500);
return [{ json: { ids, filter: '(' + (ids.length ? ids.join(',') : '00000000-0000-0000-0000-000000000000') + ')' } }];"""

SHAPE = """const requested = $('Prepare Delete').first().json.ids.length;
const items = $input.all().map((item) => item.json);
const failed = items.find((item) => item && (item.code || item.message) && !item.id);
if (failed) return [{ json: { ok: false, status: 502, error: 'delete_failed' } }];
if (!requested) return [{ json: { ok: false, status: 400, error: 'no_ids' } }];
return [{ json: { ok: true, status: 200, deleted: items.filter((item) => item && item.id).length } }];"""


def patch(workflow):
    if any(node['name'] in NEW for node in workflow['nodes']):
        raise SystemExit('already patched')
    by = {node['name']: node for node in workflow['nodes']}
    x, y = by['Reset Versions?']['position']
    find_url = f"={{{{ '{SUPABASE}agent_builder_agents?tenant_key=eq.{TENANT}&select=id' }}}}"
    delete_url = ("={{ '" + SUPABASE + "agent_builder_test_conversations?agent_id=eq.' + $('Find Agent').first().json.id + '&id=in.' + $('Prepare Delete').first().json.filter + '&select=id' }}")
    nodes = [
        {'id': 'k1-secure-delete-if', 'name': 'Delete Chats?', 'type': 'n8n-nodes-base.if', 'typeVersion': 2.2, 'position': [x + 220, y + 120],
         'parameters': {'conditions': {'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'strict', 'version': 2}, 'conditions': [
             {'id': 'c-chats.delete', 'leftValue': '={{ $json.action }}', 'rightValue': 'chats.delete', 'operator': {'type': 'string', 'operation': 'equals'}}], 'combinator': 'and'}, 'options': {}}},
        code('Prepare Delete', 'k1-secure-delete-prepare', [x + 440, y + 40], PREPARE),
        http('Find Agent', 'k1-secure-delete-agent', [x + 660, y + 40], 'GET', find_url),
        http('Delete Chats', 'k1-secure-delete-rpc', [x + 880, y + 40], 'DELETE', delete_url, {'Prefer': 'return=representation'}),
        code('Shape Delete', 'k1-secure-delete-shape', [x + 1100, y + 40], SHAPE),
    ]
    connections = json.loads(json.dumps(workflow['connections']))
    connections['Reset Versions?']['main'][1] = [{'node': 'Delete Chats?', 'type': 'main', 'index': 0}]
    connections['Delete Chats?'] = {'main': [[{'node': 'Prepare Delete', 'type': 'main', 'index': 0}], [{'node': 'Unknown Action', 'type': 'main', 'index': 0}]]}
    connections['Prepare Delete'] = {'main': [[{'node': 'Find Agent', 'type': 'main', 'index': 0}]]}
    connections['Find Agent'] = {'main': [[{'node': 'Delete Chats', 'type': 'main', 'index': 0}]]}
    connections['Delete Chats'] = {'main': [[{'node': 'Shape Delete', 'type': 'main', 'index': 0}]]}
    connections['Shape Delete'] = {'main': [[{'node': 'Respond', 'type': 'main', 'index': 0}]]}
    return {'name': workflow['name'], 'nodes': workflow['nodes'] + nodes, 'connections': connections,
            'settings': {k: v for k, v in workflow['settings'].items() if k in SETTINGS_KEEP}}


def trigger(url, body):
    for _ in range(20):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(body).encode(), method='POST', headers={'Content-Type': 'application/json'}), timeout=60) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                return error.code, json.loads(error.read().decode() or '{}')
            time.sleep(2)
    raise SystemExit('webhook never came up')


def test():
    live = gate.request('GET', f'/workflows/{WORKFLOW}')
    body = patch(live)
    suffix = uuid.uuid4().hex[:10]
    nodes = {n['name']: n for n in body['nodes']}
    hook = nodes['Secure Webhook']
    hook['parameters']['path'] = 'k1-chat-delete-test-' + suffix
    hook['webhookId'] = str(uuid.uuid4())
    body['nodes'] = [n for n in body['nodes'] if n['name'] not in ('Read Session', 'Production Session?', 'Verify Production Session', 'Verify Development Session')]
    body['nodes'] = [n for n in body['nodes'] if n['name'] != 'Check Access'] + [code(
        'Check Access', 'k1-secure-delete-test-access', nodes['Check Access']['position'],
        "const req = $('Secure Webhook').first().json; const body = req.body || {}; return [{ json: { ok: true, status: 200, action: String(body.action || ''), body } }];")]
    body['connections'] = {k: v for k, v in body['connections'].items() if k not in ('Read Session', 'Production Session?', 'Verify Production Session', 'Verify Development Session')}
    body['connections']['Secure Webhook'] = {'main': [[{'node': 'Check Access', 'type': 'main', 'index': 0}]]}
    body['name'] = 'tmp chat delete test ' + suffix[:5]
    wid = gate.request('POST', '/workflows', body)['id']
    made = [str(uuid.uuid4()) for _ in range(2)]
    try:
        for index, conversation in enumerate(made):
            platform.call('POST', 'rpc/record_test_turn', {
                'p_tenant_key': TENANT, 'p_conversation_id': conversation, 'p_version_id': None, 'p_is_draft': True, 'p_source': 'playground',
                'p_opener': 'opener', 'p_user_text': f'delete test {index}', 'p_agent_text': 'reply', 'p_started_by': 'chat-delete-test'})
        gate.request('POST', f'/workflows/{wid}/activate')
        url = (gate.local_env().get('N8N_RAPID_BASE_URL') or gate.DEFAULT_BASE).rstrip('/') + '/webhook/' + hook['parameters']['path']
        print('delete one:', trigger(url, {'action': 'chats.delete', 'ids': [made[0]]}))
        print('delete it again:', trigger(url, {'action': 'chats.delete', 'ids': [made[0]]}))
        print('no ids:', trigger(url, {'action': 'chats.delete', 'ids': ['not-a-uuid']}))
        print('bad action still unknown:', trigger(url, {'action': 'nope'}))
        left = platform.call('POST', 'rpc/list_test_conversations', {'p_tenant_key': TENANT, 'p_include_draft': True, 'p_limit': 500})
        found = sorted(row['id'] for row in left if row.get('id') in made) if isinstance(left, list) else left
        print('left of the two test chats:', found, 'expected', [made[1]])
        print('delete the other:', trigger(url, {'action': 'chats.delete', 'ids': [made[1]]}))
    finally:
        gate.request('POST', f'/workflows/{wid}/deactivate')
        for _ in range(8):
            try:
                gate.request('DELETE', f'/workflows/{wid}')
                print('temporary workflow removed')
                break
            except urllib.error.HTTPError:
                time.sleep(3)


def apply():
    live = gate.request('GET', f'/workflows/{WORKFLOW}')
    Path('/tmp/k1-customer-data-before-chat-delete.json').write_text(json.dumps(live))
    body = patch(live)
    gate.request('POST', f'/workflows/{WORKFLOW}/deactivate')
    gate.request('PUT', f'/workflows/{WORKFLOW}', body)
    gate.request('POST', f'/workflows/{WORKFLOW}/activate')
    print('patched and active:', gate.request('GET', f'/workflows/{WORKFLOW}')['active'])


if __name__ == '__main__':
    {'test': test, 'apply': apply}[sys.argv[1]]()
