#!/usr/bin/env python3
"""Calls the booking workflow the way the agent's tools do (Execute Workflow with the tool input) and proves that cancel and
reschedule only work for the phone that made the booking. Uses fake phones; the one staging booking it makes is cancelled.

  python3 k1-ownership-check.py [booking workflow name]     default: K1 Muster Booking v2 (candidate)
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
spec = importlib.util.spec_from_file_location('gate', HERE.parent / 'tools/n8n-gate.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

NAME = sys.argv[1] if len(sys.argv) > 1 else 'K1 Muster Booking v2 (candidate)'
OWNER, STRANGER = '358000000041', '358000000042'


def workflow_id(name):
    return next(w['id'] for w in gate.request('GET', '/workflows?limit=250')['data'] if w['name'] == name)


def main():
    target = workflow_id(NAME)
    hook = 'k1-own-' + uuid.uuid4().hex[:10]
    nodes = [
        {'id': str(uuid.uuid4()), 'name': 'Webhook', 'type': 'n8n-nodes-base.webhook', 'typeVersion': 2, 'position': [0, 0], 'webhookId': str(uuid.uuid4()),
         'parameters': {'httpMethod': 'POST', 'path': hook, 'responseMode': 'lastNode', 'options': {}}},
        {'id': str(uuid.uuid4()), 'name': 'Prepare', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [220, 0],
         'parameters': {'mode': 'runOnceForAllItems', 'jsCode': 'return [{ json: $input.first().json.body }]'}},
        {'id': str(uuid.uuid4()), 'name': 'Call booking', 'type': 'n8n-nodes-base.executeWorkflow', 'typeVersion': 1.2, 'position': [440, 0],
         'parameters': {'source': 'database', 'workflowId': {'__rl': True, 'value': target, 'mode': 'id'}, 'workflowInputs': {'mappingMode': 'passthrough'}, 'options': {}}},
    ]
    conns = {'Webhook': {'main': [[{'node': 'Prepare', 'type': 'main', 'index': 0}]]}, 'Prepare': {'main': [[{'node': 'Call booking', 'type': 'main', 'index': 0}]]}}
    wid = gate.request('POST', '/workflows', {'name': 'tmp ownership check', 'nodes': nodes, 'connections': conns, 'settings': {'executionOrder': 'v1'}})['id']
    url = (gate.local_env().get('N8N_RAPID_BASE_URL') or gate.DEFAULT_BASE).rstrip('/') + '/webhook/' + hook
    results, events = [], []

    def call(payload):
        for _ in range(15):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(payload).encode(), method='POST', headers={'Content-Type': 'application/json'}), timeout=120) as response:
                    data = json.load(response)
                    return data[0] if isinstance(data, list) and data else data
            except urllib.error.HTTPError as error:
                if error.code != 404:
                    return {'http_error': error.code, 'body': error.read().decode()[:300]}
                time.sleep(2)

    def check(label, condition, detail=''):
        results.append((label, bool(condition)))
        print(('ok   ' if condition else 'FAIL ') + label + ('' if condition else f' {detail}'))

    try:
        gate.request('POST', f'/workflows/{wid}/activate')
        day = time.strftime('%Y-%m-%d', time.gmtime(time.time() + 3 * 86400))
        slots = call({'action': 'get_slots', 'phone': OWNER, 'station': 'Palokka', 'product': '004', 'vehicle_category': 'M1', 'date_from': day, 'date_to': day})
        days = [d for d in slots.get('days', []) if d.get('all_times')]
        if not days:
            print('no free times on', day, '- rerun another day'); return 2
        slot = days[0]['all_times'][-1]['slot_id']
        booked = call({'action': 'book', 'phone': OWNER, 'start_time': slot, 'rek': 'TST-OWN', 'name': 'Owner Check', 'language': 'en'})
        check('booking is made and recorded', booked.get('ok') and booked.get('recorded'), booked)
        event = booked['event_id']
        events.append(event)
        stranger_cancel = call({'action': 'cancel', 'phone': STRANGER, 'event_id': event})
        check('another phone cannot cancel it', stranger_cancel.get('ok') is False and stranger_cancel.get('not_owner'), stranger_cancel)
        stranger_move = call({'action': 'reschedule', 'phone': STRANGER, 'event_id': event, 'start_time': days[0]['all_times'][0]['slot_id'], 'rek': 'TST-OWN', 'name': 'Someone Else', 'language': 'en'})
        check('another phone cannot move it', stranger_move.get('ok') is False and stranger_move.get('not_owner'), stranger_move)
        empty = call({'action': 'cancel', 'phone': STRANGER, 'event_id': 'made-up|id|here'})
        check('made-up ids are refused without touching Muster', empty.get('ok') is False and empty.get('not_owner'), empty)
        moved = call({'action': 'reschedule', 'phone': OWNER, 'event_id': event, 'start_time': days[0]['all_times'][0]['slot_id'], 'rek': 'TST-OWN', 'name': 'Owner Check', 'language': 'en'})
        check('the owner can move it', moved.get('ok') and moved.get('recorded', True), moved)
        event = moved.get('event_id', event)
        cancelled = call({'action': 'cancel', 'phone': OWNER, 'event_id': event})
        check('the owner can cancel it', cancelled.get('ok') and cancelled.get('recorded'), cancelled)
        again = call({'action': 'cancel', 'phone': OWNER, 'event_id': event})
        check('a cancelled booking cannot be cancelled again', again.get('ok') is False, again)
    finally:
        for event in events:
            call({'action': 'cancel', 'phone': OWNER, 'event_id': event})
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
    failed = [label for label, ok in results if not ok]
    print(f'{len(results) - len(failed)} of {len(results)} ownership checks passed')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
