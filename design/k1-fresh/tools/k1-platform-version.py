#!/usr/bin/env python3
"""Reads and saves agent-builder VERSIONS in the platform database (Supabase, through the platform's own n8n credential).

A version is the builder prompt, additional information, opener, reminders and translations that the playground sends with every turn.

  k1-platform-version.py render          write prompts/k1-platform-v9.json from the rule catalog (K1_PROMPT_SOURCE=legacy: v8.json from the old head + brief)
  k1-platform-version.py render13        write prompts/k1-platform-v13.json from prompts/k1-whatsapp-prompt-v13.md
  k1-platform-version.py show            print the latest saved versions (numbers, notes, who saved them)
  k1-platform-version.py fold            write the rendered content into version 5, make it active, delete newer versions
  k1-platform-version.py save FILE       save FILE (as written by render) as the next version; keeps the current lock flag
  k1-platform-version.py save13          save the v13 prompt as the next version, keeping the current opener and reminders

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
prompt_spec = importlib.util.spec_from_file_location('k1_prompt', HERE / 'k1-prompt.py')
k1_prompt = importlib.util.module_from_spec(prompt_spec)
prompt_spec.loader.exec_module(k1_prompt)

SUPABASE = 'https://wuejgskyjzuffqsgvunp.supabase.co/rest/v1/'
CREDENTIAL = {'supabaseApi': {'id': 'sKZQDTU3b68ZSLwX', 'name': 'K1 Agent builder DB'}}
TENANT = 'k1_katsastus_demo'
LEGACY = os.environ.get('K1_PROMPT_SOURCE') == 'legacy'
OUT = ROOT / ('prompts/k1-platform-v8.json' if LEGACY else 'prompts/k1-platform-v9.json')
NOTE_V8 = ('Agent v8: never claims a booking failed without a tool error and never sends the customer to 0306 over a name (a first name with any surname is booked), '
        'a rejected name gets one question that says why, opt-out replies are friendly, fit the reason (already inspected or stop messages) and are never repeated word for word, '
        'a booking made in the chat is named with an offer to cancel it when the car turns out to be inspected; plus everything in v7')
NOTE_V9 = ('Agent v9: the prompt is rendered from the rule catalog (prompts/k1-guidelines.yaml): one rule per condition and action, with a priority, '
           'no duplicated language rules, one stated order between the apology and the no-apology rules, and a test for every rule. Same behaviour as v8 intended.')
NOTE_V11 = ('Agent v11: vihreä hinta is a 34 euro inspection base paid now in the chat, or 38 euros for that base at the station. '
            'Every station takes cards and most take cash. A payment link is sent only after the appointment is booked and the customer chooses to pay now. '
            'Measuring stays the tool amount and is paid at the station. A greeting on its own, such as yo, does not switch language.')
NOTE_V12 = ('Agent v12: a day with free, vapaa or ledig is open or closed from get_station_info, never a price. '
            '34 euros is the inspection base paid now, 38 euros is that base at the station, and the visit total is inspection plus measuring. '
            'A clash between those amounts is two short sentences, then an offer of a time. '
            'A joke, an insult, a puncture, or someone about to leave gets one friendly line and then the booking again. '
            'The system date stays the day only, so the prompt cache still holds.')
NOTE = NOTE_V8 if LEGACY else NOTE_V12
NOTE_V13 = ('Agent v13: WhatsApp prompt v4.2. Finnish first, station-desk voice. A joke, a puncture, or leaving gets one line, then the booking. '
            'free, vapaa, or ledig means the day is open. A green price is only what a tool returns. '
            'In-chat payment is off: never call create_payment_link or offer prepayment. '
            'Playground and Staging still choose any saved version. WhatsApp with no pinned version uses this active one.')
PROMPT_V13 = ROOT / 'prompts/k1-whatsapp-prompt-v13.md'
OUT_V13 = ROOT / 'prompts/k1-platform-v13.json'
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


def openers():
    translations = {
        'fi': {'opener': 'Hei! Täällä {{station}}. Autosi {{registration_number}} katsastusaika lähestyy. Haluatko, että etsin sinulle sopivan ajan? 😊', 'reminders': [{'days': None, 'text': ''}] * 3},
        'sv': {'opener': 'Hej! Det är K1 Katsastus. Det är snart dags att besikta bilen {{registration_number}}. Vill du att jag hjälper dig hitta en tid? 😊', 'reminders': [{'days': None, 'text': ''}] * 3},
    }
    return {
        'openingMessage': "Hi! It's K1 Katsastus. Your car {{registration_number}} is due for inspection soon. Want me to find a time that works for you? 😊",
        'reminders': [{'days': 3, 'text': ''}, {'days': None, 'text': ''}, {'days': None, 'text': ''}],
        'translations': translations,
    }


def render():
    version = {
        'masterPrompt': k1_prompt.prompt(), 'additionalInformation': ADDITIONAL,
        **openers(), 'note': NOTE,
    }
    OUT.write_text(json.dumps(version, ensure_ascii=False, indent=1))
    print('wrote', OUT.relative_to(ROOT.parent.parent), len(version['masterPrompt']), 'characters')


def v13_document(kept=None):
    if len(NOTE_V13) > 500:
        raise SystemExit(f'v13 note is {len(NOTE_V13)} characters')
    kept = kept or openers()
    return {
        'masterPrompt': PROMPT_V13.read_text().strip() + '\n',
        'additionalInformation': '',
        'openingMessage': kept['openingMessage'],
        'reminders': kept['reminders'],
        'translations': kept['translations'],
        'note': NOTE_V13,
    }


def render13():
    version = v13_document()
    OUT_V13.write_text(json.dumps(version, ensure_ascii=False, indent=1))
    print('wrote', OUT_V13.relative_to(ROOT.parent.parent), len(version['masterPrompt']), 'characters')


def save13():
    """Saves the v4.2 WhatsApp prompt as the next version and leaves every older version in place."""
    current = call('GET', 'agent_builder_versions?is_active=eq.true&select=version_number,opening_message,reminders,translations')
    if isinstance(current, list):
        current = current[0] if current else {}
    number = current.get('version_number')
    if number != 12:
        raise SystemExit(f'expected the active version to be 12 before saving 13, found {number}')
    kept = openers()
    if current.get('opening_message'):
        kept = {
            'openingMessage': current['opening_message'],
            'reminders': current.get('reminders') or kept['reminders'],
            'translations': current.get('translations') or kept['translations'],
        }
    version = v13_document(kept)
    OUT_V13.write_text(json.dumps(version, ensure_ascii=False, indent=1))
    result = save(OUT_V13)
    row = result[0] if isinstance(result, list) else result
    if not isinstance(row, dict) or row.get('version_number') != 13:
        raise SystemExit(f'v13 was not created: {json.dumps(result, ensure_ascii=False)[:300]}')
    print('active version', row.get('version_number'), row.get('version_id'))


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
        'p_locked': bool(config.get('locked')), 'p_note': data['note'][:500], 'p_saved_by': os.environ.get('K1_SAVED_BY', 'Wasup agent v13' if 'v13' in data.get('note', '') else 'Wasup agent v8'), 'p_reminders': data['reminders'], 'p_translations': data['translations'],
    })
    print('saved', json.dumps(result, ensure_ascii=False)[:500])
    return result


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
               'note': data['note'][:500], 'saved_by': 'Wasup agent v8', 'reminders': data['reminders'], 'translations': data['translations']}
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
    elif command == 'render13':
        render13()
    elif command == 'save13':
        save13()
    elif command == 'show':
        show()
    elif command == 'fold':
        fold(sys.argv[2] if len(sys.argv) > 2 else None, int(sys.argv[3]) if len(sys.argv) > 3 else 5)
    elif command == 'save' and len(sys.argv) > 2:
        save(sys.argv[2])
    else:
        raise SystemExit(__doc__)
