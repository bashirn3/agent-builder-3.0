#!/usr/bin/env python3
"""Conversation evaluation for the K1 agent v2 candidate. Live workflows are never touched.

  python3 k1-v2-eval.py run [--suite usual|devil|all] [--only TEXT] [--workers N] [--out FILE]
  python3 k1-v2-eval.py cleanup            cancel every booking the run created, delete the eval copies

How it works
- An isolated copy of the candidate agent gets a random webhook path and a random header key. The Clerk gate is bypassed on the
  copy only, memory uses a separate namespace, and nothing is written to the builder's chat history.
- The copy returns the full tool inputs and outputs, so replies can be checked against what the tools actually said
  (times, prices) and bookings can be tracked.
- Every booking or reschedule is tracked by event_id. When the run ends (also on errors) each one is cancelled through an
  ungated copy of the booking workflow, so the cancellation goes through Muster staging and the bookings table like a real cancel.
"""
import argparse
import concurrent.futures
import copy
import importlib.util
import json
import os
import threading
import re
import secrets
import statistics
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
STATE = Path(os.environ.get('K1_EVAL_STATE', '/tmp/k1eval/state.json'))


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


gate = load(HERE / 'n8n-gate.py', 'n8n_gate')
AGENT_NAME = os.environ.get('K1_EVAL_AGENT', 'K1 Muster agent v2 (candidate)')
BOOKING_NAME = os.environ.get('K1_EVAL_BOOKING', 'K1 Muster Booking v2 (candidate)')


def workflow_id(name):
    for item in gate.request('GET', '/workflows?limit=250')['data']:
        if item['name'] == name:
            return item['id']
    raise SystemExit(f'{name} does not exist. Run k1-agent-v2-build.py build first.')


def base_url():
    return (gate.local_env().get('N8N_RAPID_BASE_URL') or gate.DEFAULT_BASE).rstrip('/')


REPLY_STEPS_JS = r"""
const evalSteps = (Array.isArray($('AI Agent').first().json.intermediateSteps) ? $('AI Agent').first().json.intermediateSteps : []).map((step) => {
  const observation = step.observation
  return {
    tool: String(step.action?.tool || step.tool || ''),
    input: step.action?.toolInput ?? step.toolInput ?? {},
    output: String(typeof observation === 'string' ? observation : JSON.stringify(observation ?? '')).slice(0, 6000),
  }
})
"""


def create_copies(secret):
    agent_id = workflow_id(AGENT_NAME)
    booking_id = workflow_id(BOOKING_NAME)
    suffix = secrets.token_urlsafe(14).replace('_', 'x').replace('-', 'y')

    agent = copy.deepcopy(gate.request('GET', f'/workflows/{agent_id}'))
    nodes = {n['name']: n for n in agent['nodes']}
    for hook in [n for n in agent['nodes'] if n['type'] == 'n8n-nodes-base.webhook']:
        hook['parameters']['path'] = ('k1-v2-eval-' if hook['name'] == 'Playground' else 'k1-v2-eval-inbound-') + suffix
        hook['webhookId'] = str(uuid.uuid4())
    agent['connections']['Playground'] = {'main': [[{'node': 'Playground Turn', 'type': 'main', 'index': 0}]]}
    turn = nodes['Playground Turn']['parameters']
    turn['jsCode'] = (
        "if (String($('Playground').first().json.headers?.['x-k1-eval-key'] || '') !== " + json.dumps(secret) + ") throw new Error('Unauthorized evaluation');\n"
        + turn['jsCode'].replace("'k1_katsastus_demo_' + phone", "'k1_eval_" + suffix + "_' + phone"))
    assert "'k1_eval_" in turn['jsCode'], 'memory was not isolated'
    record = nodes['Record playground turn']
    record['type'] = 'n8n-nodes-base.code'
    record['typeVersion'] = 2
    record.pop('credentials', None)
    record.pop('onError', None)
    record['parameters'] = {'mode': 'runOnceForAllItems', 'jsCode': 'return [{ json: { recorded: false } }]'}
    reply = nodes['Playground reply']['parameters']
    assert '  toolCalls,\n} }]' in reply['jsCode']
    reply['jsCode'] = REPLY_STEPS_JS + reply['jsCode'].replace('  toolCalls,\n} }]', "  toolCalls,\n  steps: evalSteps,\n  fallback: Boolean($('Normalize playground reply').first().json.fallback),\n} }]")
    agent_body = {'name': 'K1 v2 evaluation agent ' + suffix[:6], 'nodes': agent['nodes'], 'connections': agent['connections'],
                  'settings': {**{k: v for k, v in agent['settings'].items() if k in ('executionOrder', 'timezone')}, 'saveDataSuccessExecution': 'none', 'saveDataErrorExecution': 'all'}}
    created_agent = gate.request('POST', '/workflows', agent_body)['id']

    booking = copy.deepcopy(gate.request('GET', f'/workflows/{booking_id}'))
    hook = next(n for n in booking['nodes'] if n['name'] == 'Webhook')
    hook['parameters']['path'] = 'k1-v2-eval-booking-' + suffix
    hook['webhookId'] = str(uuid.uuid4())
    check = {'id': str(uuid.uuid4()), 'name': 'Eval key', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [hook['position'][0] + 200, hook['position'][1]],
             'parameters': {'mode': 'runOnceForAllItems', 'jsCode': "if (String($input.first().json.headers?.['x-k1-eval-key'] || '') !== " + json.dumps(secret) + ") throw new Error('Unauthorized evaluation');\nreturn $input.all()"}}
    booking['nodes'].append(check)
    booking['connections']['Webhook'] = {'main': [[{'node': 'Eval key', 'type': 'main', 'index': 0}]]}
    booking['connections']['Eval key'] = {'main': [[{'node': 'Which action?', 'type': 'main', 'index': 0}]]}
    booking_body = {'name': 'K1 v2 evaluation cancel ' + suffix[:6], 'nodes': booking['nodes'], 'connections': booking['connections'],
                    'settings': {k: v for k, v in booking['settings'].items() if k in ('executionOrder', 'timezone')}}
    created_booking = gate.request('POST', '/workflows', booking_body)['id']

    for wid in (created_agent, created_booking):
        gate.request('POST', f'/workflows/{wid}/activate')
    state = {'secret': secret, 'agent_wf': created_agent, 'booking_wf': created_booking, 'agent_url': f'{base_url()}/webhook/k1-v2-eval-{suffix}',
             'booking_url': f'{base_url()}/webhook/k1-v2-eval-booking-{suffix}', 'events': []}
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state))
    for url in (state['agent_url'], state['booking_url']):
        for _ in range(15):
            try:
                urllib.request.urlopen(urllib.request.Request(url, data=b'{}', method='POST', headers={'Content-Type': 'application/json'}), timeout=8)
                break
            except urllib.error.HTTPError as error:
                if error.code != 404:
                    break
            except Exception:
                pass
            time.sleep(2)
    return state


def post(url, secret, payload, timeout=170):
    for attempt in range(8):
        status, data, took = post_once(url, secret, payload, timeout)
        if status != 503 and not (status == 0 and 'SSL' in str(data) and attempt < 2):
            break
        time.sleep(4 + attempt * 3)
    return status, data, took


def post_once(url, secret, payload, timeout=170):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method='POST', headers={'Content-Type': 'application/json', 'x-k1-eval-key': secret})
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            data = json.load(res)
            status = res.status
    except urllib.error.HTTPError as error:
        status, data = error.code, {'error': error.read().decode()[:300]}
    except Exception as error:
        status, data = 0, {'error': f'{type(error).__name__}: {str(error)[:200]}'}
    return status, data, round(time.monotonic() - started, 1)


def cleanup(state=None):
    state = state or (json.loads(STATE.read_text()) if STATE.exists() else None)
    if not state:
        print('nothing to clean up')
        return []
    report = []
    done = set(state.get('cancelled', []))
    for event_id in sorted(set(state.get('events', []))):
        if event_id.split('|')[0] in done:
            report.append({'event': event_id.split('|')[0], 'status': 200, 'ok': True, 'detail': None})
            continue
        status, data, _ = post(state['booking_url'], state['secret'], {'action': 'cancel', 'event_id': event_id}, timeout=90)
        ok = status == 200 and isinstance(data, dict) and (data.get('ok') or data.get('already_cancelled'))
        report.append({'event': event_id.split('|')[0], 'status': status, 'ok': bool(ok), 'detail': None if ok else json.dumps(data, ensure_ascii=False)[:200]})
    for wid in (state['agent_wf'], state['booking_wf']):
        try:
            gate.request('POST', f'/workflows/{wid}/deactivate')
        except urllib.error.HTTPError:
            pass
        for _ in range(8):
            try:
                gate.request('DELETE', f'/workflows/{wid}')
                break
            except urllib.error.HTTPError:
                time.sleep(2)
    STATE.unlink(missing_ok=True)
    print(f"cancelled {sum(r['ok'] for r in report)} of {len(report)} bookings; copies deleted")
    for row in report:
        if not row['ok']:
            print('  NOT CANCELLED', row)
    return report


# ---------- Lead context (mirrors src/k1/data/language.ts) ----------
LANG_NAMES = {'fi': 'Finnish', 'sv': 'Swedish', 'en': 'English'}
POWER_TYPES = {'004': 'combustion engine or multi-power (petrol, diesel, hybrid or gas)', '0040': 'combustion engine (camper or larger car)', '004e': 'electric'}
PRODUCT_NOTES = {
    '004': 'periodic inspection of a car or van up to 3500 kg with a combustion engine; statutory measuring (0020) is added',
    '0040': 'periodic inspection of a camper or larger car; statutory measuring (0020) is added; not offered at every station',
    '004e': 'periodic inspection of a fully electric car; no measuring product',
}
OPENERS = {
    'fi': 'Hei! Täällä K1 Katsastus. Autosi {plate} katsastusaika lähestyy. Haluatko, että etsin sinulle sopivan ajan?',
    'sv': 'Hej! Det är K1 Katsastus. Det är snart dags att besikta bilen {plate}. Vill du att jag hjälper dig hitta en tid?',
    'en': 'Hi, this is K1 Katsastus. Your vehicle {plate} is due for inspection soon. Would you like me to find you a time?',
}
PLATFORM_FILE = ROOT / os.environ.get('K1_EVAL_PLATFORM', 'prompts/k1-platform-v7.json')
MASTER = """You are the appointment-booking assistant for K1 Katsastus, a Finnish vehicle inspection company.

Ask whether the customer wants to book an inspection and collect the details needed to check availability: registration number, preferred K1 station, preferred date or time window, and contact details when needed.

Use connected workflow results for available appointments and booking outcomes. Do not invent inspection deadlines, prices, available appointments, or booking confirmations.

If a required detail is missing, ask one clear follow-up question. If workflow data is unavailable, say so and hand off to staff."""


PLATFORM = json.loads(PLATFORM_FILE.read_text()) if os.environ.get('K1_EVAL_MASTER') != 'generic' else {'masterPrompt': MASTER, 'additionalInformation': ''}


def lead_context(lead):
    lang = lead['lang']
    lines = [
        "LEAD CONTEXT (from K1's lead data for this customer)",
        f"- Customer's language: {LANG_NAMES[lang]}. Reply in {LANG_NAMES[lang]} unless the customer writes in another language; then follow the LANGUAGE rules.",
        f"- Station the customer last visited: {lead['station']}. Default to this station; use get_station_info for its live opening hours and for any other station they ask about.",
        *([] if lead.get('noproduct') else [f"- Product on the reminder: {lead['product']} ({PRODUCT_NOTES[lead['product']]}). This applies to the registration below only.", f"- Vehicle category: {lead['cat']}.", f"- Power type of the vehicle: {lead.get('power') or POWER_TYPES[lead['product']]}. Use it in your answers about this vehicle."]),
        f"- Customer phone: {lead['phone']}. It belongs to this customer only and must NEVER be given as a station contact number. Verified national K1 booking number: 0306 100 100.",
        f"- Registration: {lead['plate']}",
        f"- Inspection due by: {lead.get('due', '20.10.2026')}",
        f"- Last inspection: {lead.get('last', '20.10.2024')}",
    ]
    return '\n'.join(lines)


def payload_for(lead, text, conversation_id):
    return {
        'text': text, 'messages': [{'role': 'user', 'content': text}], 'phone': lead['phone'], 'stationId': lead.get('sid'), 'stationName': lead['station'],
        'product': '' if lead.get('noproduct') else lead['product'], 'vehicleCategory': '' if lead.get('noproduct') else lead['cat'], 'plate': lead['plate'], 'leadContext': lead_context(lead),
        'conversationId': conversation_id, 'versionId': None, 'isDraft': True, 'opener': OPENERS[lead['lang']].format(plate=lead['plate']),
        'masterPrompt': PLATFORM['masterPrompt'], 'additionalInformation': PLATFORM['additionalInformation'],
    }


# ---------- Rule-based customer for booking flows ----------
TIME = re.compile(r'(?<![\d:.–-])([01]?\d|2[0-3])[:.]([0-5]\d)(?![\d]|\s*[–-]\s*\d)')
PHRASES = {
    'fi': {'day': 'Huomenna sopii', 'time': 'Klo {t} sopii', 'yes': 'Kyllä, se on oikein', 'name': 'Matti Meikäläinen', 'noemail': 'Ei sähköpostia', 'other': 'Kyllä'},
    'sv': {'day': 'Imorgon passar', 'time': 'Kl {t} passar bra', 'yes': 'Ja, det stämmer', 'name': 'Anna Andersson', 'noemail': 'Ingen e-post', 'other': 'Ja'},
    'en': {'day': 'Tomorrow works', 'time': 'The {t} one works for me', 'yes': 'Yes, that is correct', 'name': 'John Smith', 'noemail': 'No email, sorry', 'other': 'Yes'},
}


class Customer:
    def __init__(self, lang, pick='first', name=None, email=None, fuel=None, plate=None):
        self.lang, self.pick, self.email, self.fuel, self.plate = lang, pick, email, fuel, plate
        self.phrases = dict(PHRASES[lang])
        if name:
            self.phrases['name'] = name

    def question(self, reply):
        parts = [p.strip() for p in re.split(r'(?<=[.!?])\s+|\n+', reply) if p.strip()]
        asked = [p for p in parts if '?' in p]
        return (asked[-1] if asked else parts[-1] if parts else '').lower()

    def respond(self, reply):
        q = self.question(reply)
        if re.search(r'e-?mail|sähköposti|e-post', q):
            return self.email or self.phrases['noemail']
        if re.search(r'\b(name|nimi|nimesi|nimellä|namn|namnet|heißt)\b', q):
            return self.phrases['name']
        if re.search(r'petrol|diesel|bensa|electric|sähkö|hybrid|elbil|polttomoot|bensin', q) and self.fuel:
            return self.fuel
        if re.search(r'plate|registration|rekisteri|registrering|reg\.', q):
            return self.plate or self.phrases['yes']
        undated = re.sub(r'(?<!klo )(?<!kl )(?<![\d.:])([1-9]|[12]\d|3[01])\.(0?[1-9]|1[0-2])\.(?!\d)', ' ', reply)
        undated = re.sub(r'\b\d{1,2}\.\d{1,2}(?=\s+(?:kl|klo|at|klockan)\b)', ' ', undated)
        undated = re.sub(r'\b(?:ma|ti|ke|to|pe|la|su|mån|tis|ons|tors|fre|lör|sön|mon|tue|wed|thu|fri|sat|sun)\.?\s+\d{1,2}\.\d{1,2}\b\.?(?![:\d])', ' ', undated, flags=re.I)
        times = [f'{int(h):02d}:{m}' for h, m in TIME.findall(undated)]
        if times and re.search(r'time|kello|klo|tid|kl|which|kumpi|mikä|vilken|passar|sopii|works', q):
            choice = {'first': times[0], 'last': times[-1], 'second': times[min(1, len(times) - 1)]}[self.pick]
            return self.phrases['time'].format(t=choice)
        if re.search(r'day|date|päivä|päivälle|dag|when|milloin|quando|vilken dag', q):
            return self.phrases['day']
        return self.phrases['other']


class Auto:
    """Marker: keep answering with the rule-based customer until the goal happens or turns run out."""
    def __init__(self, customer, goal='booked', turns=8):
        self.customer, self.goal, self.turns = customer, goal, turns


def parse_output(text):
    try:
        data = json.loads(text)
    except Exception:
        return None
    if isinstance(data, list):
        data = data[0] if data else None
    return data if isinstance(data, dict) else None


def tool_ok(steps, name):
    for step in steps:
        if step['tool'] == name:
            data = parse_output(step['output'])
            if data and (data.get('success') or data.get('ok')):
                return data
    return None


STATE_LOCK = threading.Lock()
CTX = threading.local()


def steal_slot(turns, pick='first'):
    """Book the slot the agent just offered as another customer, so the real customer's pick collides with it."""
    for t in reversed(turns):
        for step in t['steps']:
            if step['tool'] in ('get_slots', 'get_station_info'):
                data = parse_output(step['output']) or {}
                times = [x for day in data.get('days', []) for x in day.get('all_times', [])] or [x for day in data.get('availability', []) for x in day.get('suggestions', [])]
                if times:
                    chosen = times[0] if pick == 'first' else times[-1]
                    state = CTX.state
                    status, out, _ = post(state['booking_url'], state['secret'], {'action': 'book', 'start_time': chosen['slot_id'], 'phone': '358000000001', 'rek': 'TST-STL', 'name': 'Slot Stealer', 'language': 'en'})
                    if isinstance(out, list):
                        out = out[0] if out else {}
                    if isinstance(out, dict) and out.get('event_id'):
                        CTX.last_event = out['event_id']
                        CTX.events.append(out['event_id'])
                        with STATE_LOCK:
                            state['events'].append(out['event_id'])
                            STATE.write_text(json.dumps(state))
                    return chosen.get('time', '09:00')
    return '09:00'




def is_booking_flow(scenario):
    return any(isinstance(t, Auto) for t in scenario['turns']) or scenario.get('books', False)


def release(state, scenario_id, events, turns):
    agent_cancelled = set()
    for t in turns:
        for step in t['steps']:
            if step['tool'] == 'cancel_booking':
                out = parse_output(step['output']) or {}
                if out.get('success') or out.get('ok'):
                    agent_cancelled.add(str(out.get('group_id', '')))
    for event_id in events:
        group = event_id.split('|')[0]
        if group in agent_cancelled:
            with STATE_LOCK:
                state.setdefault('cancelled', []).append(group)
            continue
        status, data, _ = post(state['booking_url'], state['secret'], {'action': 'cancel', 'event_id': event_id}, timeout=90)
        if status == 200 and isinstance(data, dict) and (data.get('ok') or data.get('already_cancelled')):
            with STATE_LOCK:
                state.setdefault('cancelled', []).append(group)
    with STATE_LOCK:
        STATE.write_text(json.dumps(state))


def run_scenario(state, scenario):
    events = []
    CTX.state, CTX.events, CTX.last_event = state, events, ''
    turns = _run(state, scenario, events)
    release(state, scenario['id'], events, turns)
    return turns


def _run(state, scenario, events):
    lead = {'phone': f"35899{abs(hash(scenario['id'])) % 10**8:08d}", **scenario['lead']}
    conversation_id = str(uuid.uuid4())
    turns, history_steps = [], []
    queue = list(scenario['turns'])
    auto = None
    last_reply = ''
    while queue or auto:
        if auto:
            if auto.turns <= 0 or (auto.goal == 'booked' and any(tool_ok(t['steps'], 'book_inspection_invite') for t in turns)):
                auto = None
                continue
            if auto.goal == 'cancelled' and any(tool_ok(t['steps'], 'cancel_booking') for t in turns):
                auto = None
                continue
            if auto.goal == 'rescheduled' and any(tool_ok(t['steps'], 'reschedule_booking') for t in turns):
                auto = None
                continue
            text = auto.customer.respond(last_reply)
            auto.turns -= 1
        else:
            item = queue.pop(0)
            if isinstance(item, Auto):
                auto = item
                continue
            text = item(turns) if callable(item) else item
            if text is None:
                continue
        status, data, latency = post(state['agent_url'], state['secret'], payload_for(lead, text, conversation_id))
        data = data if isinstance(data, dict) else {}
        steps = data.get('steps') or []
        for step in steps:
            if step['tool'] in ('book_inspection_invite', 'reschedule_booking'):
                out = parse_output(step['output']) or {}
                if out.get('event_id'):
                    events.append(out['event_id'])
                    with STATE_LOCK:
                        state['events'].append(out['event_id'])
                        STATE.write_text(json.dumps(state))
        last_reply = data.get('reply', '') or ''
        turns.append({'user': text, 'reply': last_reply, 'status': status, 'latency': latency, 'fallback': bool(data.get('fallback')), 'error': data.get('error', ''),
                      'tools': [t['name'] for t in data.get('toolCalls', [])], 'params': [t['params'] for t in data.get('toolCalls', [])], 'steps': steps})
        if status != 200:
            break
    return turns


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['run', 'cleanup'])
    parser.add_argument('--suite', default='all')
    parser.add_argument('--only', default='')
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--out', default='')
    parser.add_argument('--repeat', type=int, default=1)
    parser.add_argument('--books', default='', choices=['', 'no', 'only'], help='no: skip scenarios that need a working booking; only: run just those')
    parser.add_argument('--shard', default='', help='i/n: run every n-th scenario of the cost-sorted list (longest first), so parallel processes finish together')
    args = parser.parse_args()
    if args.command == 'cleanup':
        cleanup()
        return
    scenarios_module = load(ROOT / 'tests/v2_scenarios.py', 'v2_scenarios')
    checks_module = load(ROOT / 'tests/v2_checks.py', 'v2_checks')
    Auto.steal_slot = staticmethod(steal_slot)
    Auto.last_event = staticmethod(lambda: getattr(CTX, 'last_event', ''))
    scenarios = scenarios_module.build(Customer, Auto)
    if args.suite != 'all':
        scenarios = [s for s in scenarios if s['suite'] == args.suite]
    if args.only:
        wanted = [part for part in args.only.split(',') if part]
        scenarios = [s for s in scenarios if any(part in s['id'] for part in wanted)]
    if args.books:
        needs = lambda s: is_booking_flow(s) or any(c[0] in ('booked', 'cancelled', 'rescheduled', 'turns_to_book') or (c[0] in ('success', 'max_success') and c[1] in ('book_inspection_invite', 'cancel_booking', 'reschedule_booking')) for c in s.get('checks', []))
        scenarios = [s for s in scenarios if needs(s) == (args.books == 'only')]
    if args.shard:
        index, count = (int(part) for part in args.shard.split('/'))
        cost = lambda s: -(len(s['turns']) * 2 + (6 if s.get('books') else 0) + sum(5 for t in s['turns'] if not isinstance(t, str)))
        scenarios = sorted(scenarios, key=cost)[index::count]
    if args.repeat > 1:
        scenarios = [dict(s, id=f"{s['id']}#{k}") for s in scenarios for k in range(args.repeat)]
    print(f'{len(scenarios)} scenarios', flush=True)
    state = create_copies(secrets.token_urlsafe(24))
    results = []
    started = time.monotonic()
    try:
        def handle(scenario, future_result):
            try:
                turns = future_result()
            except Exception as error:
                turns = [{'user': '', 'reply': '', 'status': 0, 'latency': 0, 'fallback': False, 'error': f'harness: {error}', 'tools': [], 'params': [], 'steps': []}]
            flags = checks_module.evaluate(scenario, turns)
            results.append({'id': scenario['id'], 'suite': scenario['suite'], 'lang': scenario['lead']['lang'], 'lead': scenario['lead'], 'turns': turns, 'flags': flags, 'note': scenario.get('note', '')})
            if len(results) % 20 == 0:
                print(f'progress {len(results)}/{len(scenarios)} flagged {sum(bool(r["flags"]) for r in results)} elapsed {round(time.monotonic() - started)}s', flush=True)

        def booking_lane(items):
            for scenario in items:
                try:
                    turns = run_scenario(state, scenario)
                    handle(scenario, lambda t=turns: t)
                except Exception as error:
                    handle(scenario, lambda e=error: (_ for _ in ()).throw(e))

        bookings = [s for s in scenarios if is_booking_flow(s)]
        others = [s for s in scenarios if not is_booking_flow(s)]
        lane = threading.Thread(target=booking_lane, args=(bookings,))
        lane.start()
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {pool.submit(run_scenario, state, s): s for s in others}
            for future in concurrent.futures.as_completed(futures):
                handle(futures[future], future.result)
        lane.join()
    finally:
        results.sort(key=lambda r: r['id'])
        out = Path(args.out or ROOT / f'tests/v2-results-{args.suite}.json')
        out.write_text(json.dumps(results, ensure_ascii=False, indent=1))
        print('saved', out)
        cleanup(state)
    lat = [t['latency'] for r in results for t in r['turns'] if t['latency']]
    print(json.dumps({'scenarios': len(results), 'clean': sum(not r['flags'] for r in results), 'flagged': sum(bool(r['flags']) for r in results),
                      'turns': len(lat), 'p50': statistics.median(lat) if lat else 0, 'p95': sorted(lat)[int(len(lat) * .95) - 1] if lat else 0}))


if __name__ == '__main__':
    main()
