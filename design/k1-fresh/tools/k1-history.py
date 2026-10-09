#!/usr/bin/env python3
"""Writes evaluation conversations into the platform's chat history (Test chats of a saved version).

  k1-history.py list [--started-by TEXT]
  k1-history.py record RESULTS.json --ids ID,ID,... [--version 7] [--started-by "Wasup v7 replay"] [--replace]

`record` takes the scripted conversations from an evaluation results file and stores them through the same record_test_turn function the
playground uses (opener bubble, then customer message and agent reply per turn), tagged with the saved version and `started_by`, so the
testers see them in the Test chats list of that version. --replace first deletes chats with the same started_by on that version.
Everything goes through one throwaway n8n workflow that uses the platform's own database credential.
"""
import argparse
import importlib.util
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('platform_version', HERE / 'k1-platform-version.py')
platform = importlib.util.module_from_spec(spec)
spec.loader.exec_module(platform)
gate = platform.gate
spec = importlib.util.spec_from_file_location('evaluation', HERE / 'k1-v2-eval.py')
evaluation = importlib.util.module_from_spec(spec)
sys.modules['evaluation'] = evaluation
spec.loader.exec_module(evaluation)

ALL_ROWS_JS = 'return [{ json: { rows: $input.all().map((item) => item.json) } }]'
EXPAND_JS = 'return $input.first().json.body.calls.map((call) => ({ json: call }))'


def run(nodes, connections, payload):
    suffix = uuid.uuid4().hex[:10]
    hook = 'k1-hist-' + suffix
    nodes = [{'id': str(uuid.uuid4()), 'name': 'Webhook', 'type': 'n8n-nodes-base.webhook', 'typeVersion': 2, 'position': [0, 0], 'webhookId': str(uuid.uuid4()),
              'parameters': {'httpMethod': 'POST', 'path': hook, 'responseMode': 'lastNode', 'options': {}}}] + nodes
    wid = gate.request('POST', '/workflows', {'name': 'tmp chat history ' + suffix[:5], 'nodes': nodes, 'connections': connections, 'settings': {'executionOrder': 'v1'}})['id']
    try:
        gate.request('POST', f'/workflows/{wid}/activate')
        url = (gate.local_env().get('N8N_RAPID_BASE_URL') or gate.DEFAULT_BASE).rstrip('/') + '/webhook/' + hook
        for _ in range(15):
            try:
                request = urllib.request.Request(url, data=json.dumps(payload).encode(), method='POST', headers={'Content-Type': 'application/json'})
                with urllib.request.urlopen(request, timeout=170) as response:
                    return json.load(response)
            except urllib.error.HTTPError as error:
                if error.code != 404:
                    raise RuntimeError(f'HTTP {error.code}: {error.read().decode()[:400]}')
                time.sleep(2)
        raise RuntimeError('webhook never became reachable')
    finally:
        try:
            gate.request('POST', f'/workflows/{wid}/deactivate')
        except Exception:
            pass
        for _ in range(6):
            try:
                gate.request('DELETE', f'/workflows/{wid}')
                break
            except Exception:
                time.sleep(2)


def code(name, js, position):
    return {'id': str(uuid.uuid4()), 'name': name, 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': position, 'parameters': {'mode': 'runOnceForAllItems', 'jsCode': js}}


def http(name, method, url, body_expression, position):
    parameters = {'method': method, 'url': url, 'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'supabaseApi', 'options': {}}
    if body_expression:
        parameters.update({'sendBody': True, 'contentType': 'json', 'specifyBody': 'json', 'jsonBody': body_expression})
    return {'id': str(uuid.uuid4()), 'name': name, 'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 4.2, 'position': position, 'credentials': platform.CREDENTIAL,
            'alwaysOutputData': True, 'parameters': parameters}


def chain(*names):
    return {a: {'main': [[{'node': b, 'type': 'main', 'index': 0}]]} for a, b in zip(names, names[1:])}


def read(path):
    call = http('Call', 'GET', platform.SUPABASE + path, None, [300, 0])
    result = run([call, code('All', ALL_ROWS_JS, [600, 0])], chain('Webhook', 'Call', 'All'), {})
    return result['rows']


def write_all(calls, url_suffix):
    """Runs the calls in order, one request per item (n8n sends them sequentially)."""
    call = http('Call', 'POST', platform.SUPABASE + url_suffix, '={{ JSON.stringify($json.body) }}', [600, 0])
    call['parameters']['options'] = {'batching': {'batch': {'batchSize': 1, 'batchInterval': 200}}}
    result = run([code('Expand', EXPAND_JS, [300, 0]), call, code('All', ALL_ROWS_JS, [900, 0])], chain('Webhook', 'Expand', 'Call', 'All'),
                 {'calls': [{'body': item} for item in calls]})
    return result['rows']


def version_id(number):
    rows = read(f'agent_builder_versions?version_number=eq.{number}&select=id,version_number')
    if not rows or not rows[0].get('id'):
        raise SystemExit(f'version {number} not found')
    return rows[0]['id']


def listing(started_by=''):
    query = 'agent_builder_test_conversation_list?select=id,version_number,title,started_by,message_count,updated_at&order=updated_at.desc&limit=40'
    if started_by:
        query += '&started_by=eq.' + urllib.request.quote(started_by)
    for row in read(query):
        print(json.dumps(row, ensure_ascii=False))


def record(path, ids, number, started_by, replace):
    data = json.loads(Path(path).read_text())
    data = data['results'] if isinstance(data, dict) else data
    wanted = [item for item in data if item['id'] in ids]
    missing = set(ids) - {item['id'] for item in wanted}
    if missing:
        raise SystemExit(f'not in results: {sorted(missing)}')
    bad = [item['id'] for item in wanted if item['flags']]
    if bad:
        raise SystemExit(f'refusing to record flagged conversations: {bad}')
    vid = version_id(number)
    existing = read(f'agent_builder_test_conversation_list?select=id,title&version_id=eq.{vid}&started_by=eq.' + urllib.request.quote(started_by))
    existing = [row for row in existing if row.get('id')]
    if existing and not replace:
        raise SystemExit(f'{len(existing)} chats by "{started_by}" already exist on v{number}; use --replace')
    if existing:
        delete = http('Delete', 'DELETE', '', None, [600, 0])
        delete['parameters']['options'] = {'batching': {'batch': {'batchSize': 1, 'batchInterval': 100}}}
        delete['parameters']['url'] = '=' + platform.SUPABASE + 'agent_builder_test_conversations?id=eq.{{ $json.body.id }}'
        run([code('Expand', EXPAND_JS, [300, 0]), delete, code('All', ALL_ROWS_JS, [900, 0])], chain('Webhook', 'Expand', 'Delete', 'All'), {'calls': [{'body': {'id': row['id']}} for row in existing]})
        print('removed', len(existing), 'earlier chats')
    calls = []
    for item in wanted:
        conversation = str(uuid.uuid4())
        opener = evaluation.OPENERS[item['lang']].format(plate=item['lead']['plate'])
        for index, turn in enumerate(item['turns']):
            calls.append({'p_tenant_key': platform.TENANT, 'p_conversation_id': conversation, 'p_version_id': vid, 'p_is_draft': False, 'p_source': 'playground',
                          'p_opener': opener if index == 0 else '', 'p_user_text': turn['user'], 'p_agent_text': turn['reply'], 'p_started_by': started_by})
    rows = write_all(calls, 'rpc/record_test_turn')
    failed = [row for row in rows if not row.get('conversation_id')]
    print(f'recorded {len(wanted)} chats, {len(calls)} turns, {len(failed)} failed')
    if failed:
        print(json.dumps(failed[:3], ensure_ascii=False))
        raise SystemExit(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['list', 'record'])
    parser.add_argument('results', nargs='?')
    parser.add_argument('--ids', default='')
    parser.add_argument('--version', type=int, default=7)
    parser.add_argument('--started-by', default='Wasup v7 replay')
    parser.add_argument('--replace', action='store_true')
    args = parser.parse_args()
    if args.command == 'list':
        listing(args.started_by if '--started-by' in sys.argv else '')
    else:
        record(args.results, [part for part in args.ids.split(',') if part], args.version, args.started_by, args.replace)


if __name__ == '__main__':
    main()
