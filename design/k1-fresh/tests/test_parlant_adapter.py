#!/usr/bin/env python3
"""Tests the K1_EVAL_TARGET=parlant adapter in k1-v2-eval.py against a stand-in for the Parlant REST API (routes and event
shapes as in parlant 3.3 api/sessions.py). No n8n, no LLM.

  python3 tests/test_parlant_adapter.py
"""
import importlib.util
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
EVENTS, LEADS, STEPS = {}, {}, {}


class FakeParlant(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, data, code=200):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        return json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')

    def add(self, sid, kind, source, data):
        event = {'id': f'e{len(EVENTS[sid])}', 'kind': kind, 'source': source, 'offset': len(EVENTS[sid]), 'data': data}
        EVENTS[sid].append(event)
        return event

    def do_GET(self):
        url = urlparse(self.path)
        query = {k: v[0] for k, v in parse_qs(url.query).items()}
        if url.path == '/agents':
            return self.reply([{'id': 'other', 'name': 'Someone else'}, {'id': 'k1', 'name': 'K1 Katsastus'}])
        if url.path == '/k1/steps':
            return self.reply({'steps': STEPS.get(query['session_id'], [])[int(query.get('offset', 0)):]})
        if url.path.endswith('/events'):
            sid = url.path.split('/')[2]
            return self.reply([e for e in EVENTS[sid] if e['offset'] >= int(query.get('min_offset', 0))])
        self.reply({'detail': 'not found'}, 404)

    def do_POST(self):
        url = urlparse(self.path)
        data = self.body()
        if url.path == '/customers':
            return self.reply({'id': 'c-' + data['name'], 'name': data['name']}, 201)
        if url.path == '/sessions':
            assert 'allow_greeting=false' in url.query, 'the agent must not greet first: the opener is posted instead'
            sid = f's{len(EVENTS)}'
            EVENTS[sid] = []
            return self.reply({'id': sid, 'agent_id': data['agent_id']}, 201)
        if url.path == '/k1/lead':
            LEADS[data['session_id']] = data
            return self.reply({'ok': True})
        if url.path.endswith('/events'):
            sid = url.path.split('/')[2]
            event = self.add(sid, data['kind'], data['source'], {'message': data.get('message')})
            if data['source'] == 'customer':
                if 'explode' in data['message']:
                    self.add(sid, 'status', 'ai_agent', {'status': 'error', 'data': {}})
                else:
                    STEPS.setdefault(sid, []).append({'tool': 'get_slots', 'input': {'date_from': '2026-10-15'}, 'output': '{"ok": true}'})
                    self.add(sid, 'status', 'ai_agent', {'status': 'processing', 'data': {}})
                    self.add(sid, 'message', 'ai_agent', {'message': 'To 15.10. klo 9.00, 13.00 tai 16.45. Mikä sopii?'})
                    self.add(sid, 'status', 'ai_agent', {'status': 'ready', 'data': {}})
            return self.reply(event, 201)
        self.reply({'detail': 'not found'}, 404)


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), FakeParlant)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    os.environ['K1_EVAL_TARGET'] = 'parlant'
    os.environ['K1_PARLANT_URL'] = f'http://127.0.0.1:{server.server_address[1]}'
    spec = importlib.util.spec_from_file_location('k1_v2_eval', ROOT / 'tools/k1-v2-eval.py')
    evaluation = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(evaluation)
    failures = []
    lead = {'phone': '35899000001', 'lang': 'fi', 'station': 'K1 Katsastus Jyväskylä Palokka', 'sid': 256, 'product': '004', 'cat': 'M1', 'plate': 'TST-001'}
    state = {'booking_url': 'https://n8n.example/webhook/k1-v2-eval-booking-x', 'secret': 's3cret'}
    conversation = evaluation.parlant_session(state, lead)
    sid = conversation['id']
    registered = LEADS.get(sid, {})
    if registered.get('booking_url') != state['booking_url'] or registered.get('secret') != state['secret'] or 'TST-001' not in registered.get('lead_context', ''):
        failures.append('the session was not registered with its lead, booking copy and key')
    if not EVENTS[sid] or EVENTS[sid][0]['source'] != 'human_agent_on_behalf_of_ai_agent' or 'TST-001' not in EVENTS[sid][0]['data']['message']:
        failures.append('the opener was not posted as the agent\'s first message')
    status, data, latency = evaluation.parlant_turn(conversation, 'joo')
    if status != 200 or 'Mikä sopii' not in data['reply'] or data['fallback']:
        failures.append(f'a normal turn did not come back as a reply: {status} {data}')
    if [s['tool'] for s in data['steps']] != ['get_slots'] or data['toolCalls'][0]['params'] != {'date_from': '2026-10-15'}:
        failures.append(f'tool steps were not passed through: {data["steps"]}')
    status, data, _ = evaluation.parlant_turn(conversation, 'kiitos')
    if len(data['steps']) != 1:
        failures.append('steps from an earlier turn were repeated')
    status, data, _ = evaluation.parlant_turn(conversation, 'explode')
    if status != 500 or data['error'] != 'engine error':
        failures.append(f'an engine error was not reported as a failed turn: {status} {data}')
    server.shutdown()
    if failures:
        print('\n'.join('FAIL ' + f for f in failures))
        sys.exit(1)
    print('ok: parlant eval adapter')


if __name__ == '__main__':
    main()
