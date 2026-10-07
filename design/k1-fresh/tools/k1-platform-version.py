#!/usr/bin/env python3
"""Reads and saves agent-builder VERSIONS in the platform database (Supabase, through the platform's own n8n credential).

A version is the builder prompt, additional information, opener, reminders and translations that the playground sends with every turn.

  k1-platform-version.py render          write prompts/k1-platform-v7.json (conversational head + business rules v2) from the repo
  k1-platform-version.py show            print the latest saved versions (numbers, notes, who saved them)
  k1-platform-version.py fold            write the rendered content into version 5, make it active, delete newer versions
  k1-platform-version.py save FILE       save FILE (as written by render) as the next version; keeps the current lock flag

Saving runs one throwaway n8n workflow (created, called, deleted) that calls the same save_agent_builder_version function as the platform's Save Config.
"""
import importlib.util
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
spec = importlib.util.spec_from_file_location('gate', HERE / 'n8n-gate.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

SUPABASE = 'https://wuejgskyjzuffqsgvunp.supabase.co/rest/v1/'
CREDENTIAL = {'supabaseApi': {'id': 'sKZQDTU3b68ZSLwX', 'name': 'K1 Agent builder DB'}}
TENANT = 'k1_katsastus_demo'
OUT = ROOT / 'prompts/k1-platform-v7.json'
NOTE = ('Agent v7: no price until the fuel type is known (never the website "from" prices), the measuring is optional and an old car or a question about it never escalates, '
        'a rejected weekday finds the next one by itself, "book it" goes straight on without re-asking the plate, no hours hedging on bookable times, follow-ups about "they" mean the stations just named, '
        'plus everything from v6 (measuring included by default but removable, direct staging calls)')
ADDITIONAL = ('All K1 stations can be asked about; hours, prices and free times always come from the tools. '
              'Booking works only at Palokka (256) and Itäharju (241) on Muster staging; other stations get the official booking link or 0306 100 100. '
              'Book at the lead\'s station unless the customer asks for another one or it is closed; use the lead\'s product and vehicle category unless the customer talks about another vehicle. A booking can only be cancelled or moved from the phone that made it; find it with get_my_bookings instead of asking the customer for details. Never quote prices or confirm bookings without a tool result.')


def call(method, path, body=None):
    suffix = uuid.uuid4().hex[:10]
    hook = 'k1-ver-' + suffix
    call_node = {'id': str(uuid.uuid4()), 'name': 'Call', 'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 4.2, 'position': [300, 0], 'credentials': CREDENTIAL, 'onError': 'continueRegularOutput',
                 'parameters': {'method': method, 'url': SUPABASE + path, 'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'supabaseApi', 'options': {}}}
    if body is not None:
        call_node['parameters'].update({'sendBody': True, 'contentType': 'json', 'specifyBody': 'json', 'jsonBody': json.dumps(body)})
    nodes = [{'id': str(uuid.uuid4()), 'name': 'Webhook', 'type': 'n8n-nodes-base.webhook', 'typeVersion': 2, 'position': [0, 0], 'webhookId': str(uuid.uuid4()),
              'parameters': {'httpMethod': 'POST', 'path': hook, 'responseMode': 'lastNode', 'options': {}}}, call_node]
    wid = gate.request('POST', '/workflows', {'name': 'tmp platform version ' + suffix[:5], 'nodes': nodes, 'connections': {'Webhook': {'main': [[{'node': 'Call', 'type': 'main', 'index': 0}]]}}, 'settings': {'executionOrder': 'v1'}})['id']
    try:
        gate.request('POST', f'/workflows/{wid}/activate')
        url = (gate.local_env().get('N8N_RAPID_BASE_URL') or gate.DEFAULT_BASE).rstrip('/') + '/webhook/' + hook
        for _ in range(15):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, data=b'{}', method='POST', headers={'Content-Type': 'application/json'}), timeout=60) as response:
                    return json.load(response)
            except urllib.error.HTTPError as error:
                if error.code != 404:
                    return {'http_error': error.code, 'body': error.read().decode()[:500]}
                time.sleep(2)
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


def render():
    head = (ROOT / 'prompts/k1-conversational-head.md').read_text().rstrip()
    rules = (ROOT / 'prompts/k1-business-prompt-v2.md').read_text().strip()
    translations = {
        'fi': {'opener': 'Hei! Täällä K1 Katsastus {{station}}. Autosi {{registration_number}} katsastusaika lähestyy. Haluatko, että etsin sinulle sopivan ajan?', 'reminders': [{'days': None, 'text': ''}] * 3},
        'sv': {'opener': 'Hej! Det är K1 Katsastus. Det är snart dags att besikta bilen {{registration_number}}. Vill du att jag hjälper dig hitta en tid?', 'reminders': [{'days': None, 'text': ''}] * 3},
    }
    version = {
        'masterPrompt': f'{head}\n\n{rules}\n', 'additionalInformation': ADDITIONAL,
        'openingMessage': "Hi! It's K1 Katsastus. Your car {{registration_number}} is due for inspection soon. Want me to find a time that works for you?",
        'reminders': [{'days': 3, 'text': ''}, {'days': None, 'text': ''}, {'days': None, 'text': ''}], 'translations': translations, 'note': NOTE,
    }
    OUT.write_text(json.dumps(version, ensure_ascii=False, indent=1))
    print('wrote', OUT.relative_to(ROOT.parent.parent), len(version['masterPrompt']), 'characters')


def latest(number):
    return call('GET', f'agent_builder_versions?version_number=eq.{number}&select=version_number,is_active,note,saved_by,created_at')


def show():
    top = call('GET', 'agent_builder_versions?select=version_number&order=version_number.desc&limit=1')
    number = (top or {}).get('version_number')
    for n in range(number, max(number - 3, 0), -1):
        print(json.dumps(latest(n), ensure_ascii=False))
    print(json.dumps(call('GET', f'agent_builder_active_config?tenant_key=eq.{TENANT}&select=version_number,locked,display_name'), ensure_ascii=False))


def save(path):
    data = json.loads(Path(path).read_text())
    config = call('GET', f'agent_builder_active_config?tenant_key=eq.{TENANT}&select=locked,version_number')
    print('current', config)
    result = call('POST', 'rpc/save_agent_builder_version', {
        'p_tenant_key': TENANT, 'p_master_prompt': data['masterPrompt'], 'p_opening_message': data['openingMessage'], 'p_additional_information': data['additionalInformation'],
        'p_locked': bool(config.get('locked')), 'p_note': data['note'][:500], 'p_saved_by': 'Wasup agent v7', 'p_reminders': data['reminders'], 'p_translations': data['translations'],
    })
    print('saved', json.dumps(result, ensure_ascii=False))


def fold(path=None, into=5):
    """Writes FILE (as produced by render) into version `into`, makes it the active version and removes every newer version (their test chats move to `into`)."""
    data = json.loads(Path(path or OUT).read_text())
    top = call('GET', 'agent_builder_versions?select=version_number&order=version_number.desc&limit=1')['version_number']
    rows = [call('GET', f'agent_builder_versions?version_number=eq.{number}&select=id,agent_id,version_number') for number in range(into, top + 1)]
    rows = [row for row in rows if row.get('id')]
    target = next((row for row in rows if row['version_number'] == into), None)
    if not target:
        raise SystemExit(f'v{into} does not exist')
    newer = [row for row in rows if row['version_number'] > into]
    content = {'master_prompt': data['masterPrompt'], 'additional_information': data['additionalInformation'], 'opening_message': data['openingMessage'],
               'note': data['note'][:500], 'saved_by': 'Wasup agent v7', 'reminders': data['reminders'], 'translations': data['translations']}
    for row in newer:
        print('deactivate', row['version_number'], call('PATCH', f'agent_builder_versions?id=eq.{row["id"]}', {'is_active': False}))
        print('retag chats', call('PATCH', f'agent_builder_test_conversations?version_id=eq.{row["id"]}', {'version_id': target['id'], 'version_number': into}))
    print('update', call('PATCH', f'agent_builder_versions?id=eq.{target["id"]}', {**content, 'is_active': True}))
    print('agent', call('PATCH', f'agent_builder_agents?id=eq.{target["agent_id"]}', {'active_version_id': target['id']}))
    for row in newer:
        print('remove', row['version_number'], call('DELETE', f'agent_builder_versions?id=eq.{row["id"]}'))


if __name__ == '__main__':
    command = sys.argv[1] if len(sys.argv) > 1 else ''
    if command == 'render':
        render()
    elif command == 'show':
        show()
    elif command == 'fold':
        fold(sys.argv[2] if len(sys.argv) > 2 else None, int(sys.argv[3]) if len(sys.argv) > 3 else 5)
    elif command == 'save' and len(sys.argv) > 2:
        save(sys.argv[2])
    else:
        raise SystemExit(__doc__)
