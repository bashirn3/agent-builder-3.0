#!/usr/bin/env python3
"""Self-test of the judge and the gate without an LLM or n8n.

  python3 tests/test_judge.py
"""
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


judge = load(HERE / 'v2_judge.py', 'v2_judge')
SLOTS = json.dumps({'ok': True, 'days': [{'all_times': [{'time': '09:00'}, {'time': '13:00'}, {'time': '16:45'}]}]})


def chat(cid, user, reply, steps=None, lang='fi'):
    return {'id': cid, 'suite': 'usual', 'lang': lang, 'lead': {'lang': lang, 'station': 'K1 Katsastus Jyväskylä Palokka'},
            'turns': [{'user': user, 'reply': reply, 'status': 200, 'fallback': False, 'steps': steps or []}], 'flags': []}


def offline(result):
    return judge.offline_scores(result)['turns'][0]


FAILURES = []


def expect(label, condition):
    if not condition:
        FAILURES.append(label)


def test_offline_rubric():
    good = chat('good', 'joo', 'To 1.10. klo 9.00, 13.00 tai 16.45. Mikä sopii?', [{'tool': 'get_slots', 'input': {}, 'output': SLOTS}])
    score = offline(good)
    expect('a clean offer scores 5 on grounded, language and one_question', (score['grounded'], score['language'], score['one_question']) == (5, 5, 5))
    expect('a lead-in is not natural', offline(chat('leadin', 'joo', 'Selvä! Mikä päivä sopii?'))['natural'] <= 2)
    expect('two questions fail one_question', offline(chat('two', 'moi', 'Moi! Haluatko ajan? Mikä päivä sopii?'))['one_question'] <= 2)
    expect('English to a Finnish message fails language', offline(chat('lang', 'Mitä aikoja huomenna on?', 'We have times at 09:00 and 13:00 tomorrow, which one would you like?'))['language'] == 1)
    expect('a time no tool gave is not grounded', offline(chat('made_up', 'joo', 'To 1.10. klo 10.30. Sopiiko?', [{'tool': 'get_slots', 'input': {}, 'output': SLOTS}]))['grounded'] <= 2)
    expect('a date is not mistaken for a time', offline(chat('date', 'joo', 'Palokka on su 4.10. kiinni. Ma 5.10. klo 9.00. Sopiiko?', [{'tool': 'get_slots', 'input': {}, 'output': SLOTS}]))['grounded'] == 5)
    long = chat('long', 'hinta?', ' '.join(['sana'] * 80))
    expect('a wall of text is not brief', offline(long)['brief'] <= 2)


def test_pair_votes():
    os.environ['K1_JUDGE_PROVIDER'] = 'openai'
    os.environ['K1_JUDGE_CACHE'] = tempfile.mkdtemp()
    judge.CACHE = Path(os.environ['K1_JUDGE_CACHE'])
    better = chat('s', 'joo', 'To 1.10. klo 9.00, 13.00 tai 16.45. Mikä sopii?')
    worse = chat('s', 'joo', 'Selvä! Mikä päivä sopisi sinulle parhaiten?')

    def always_first(prompt):
        return {'winner': '1'}

    def prefers_offer(prompt):
        one = prompt.split('Conversation 1:')[1].split('Conversation 2:')[0]
        return {'winner': '1' if 'Mikä sopii' in one else '2'}

    judge.ask = always_first
    expect('a judge that always picks the first conversation gives a tie', judge.pair_one(better, worse)['winner'] == 'tie')
    judge.CACHE = Path(tempfile.mkdtemp())
    judge.ask = prefers_offer
    expect('a consistent preference wins in both orders', judge.pair_one(better, worse)['winner'] == 'a')
    expect('and the other way round', judge.pair_one(worse, better)['winner'] == 'b')
    os.environ['K1_JUDGE_PROVIDER'] = 'offline'


def test_gate():
    gate = load(ROOT / 'tools/k1-gate.py', 'k1_gate')
    ids = [f'voice.ack.fi.{i}' for i in range(10)]
    base = [dict(chat(i, 'joo', 'To 1.10. klo 9.00. Sopiiko?'), flags=[]) for i in ids]
    same = gate.compare(base, base, catalog=gate.load_catalog())
    expect('a run compared with itself passes', same['pass'])
    broken = [dict(r, flags=['asked which day']) if n < 3 else r for n, r in enumerate(base)]
    verdict = gate.compare(base, broken, catalog=gate.load_catalog())
    expect('three newly flagged voice.ack scenarios fail the gate', not verdict['pass'])
    expect('the failing rule is named', any('voice.no_lead_in' in reason or 'voice.terse' in reason for reason in verdict['reasons']))
    noisy = [dict(r, turns=[dict(r['turns'][0], fallback=True)], flags=['fallback']) if n < 3 else r for n, r in enumerate(base)]
    expect('fallback replies are not counted as rule failures', gate.compare(base, noisy, catalog=gate.load_catalog())['pass'])
    scores_base = {'meta': {'overall': 4.5}, 'scores': {}}
    scores_drop = {'meta': {'overall': 4.2}, 'scores': {}}
    expect('a lower judge score fails', not gate.compare(base, base, catalog=gate.load_catalog(), judge_base=scores_base, judge_cand=scores_drop)['pass'])
    golden = {'meta': {'lost_to_golden': ['voice.ack.fi.1'], 'missing': []}}
    expect('losing to a golden chat fails', not gate.compare(base, base, catalog=gate.load_catalog(), golden=golden)['pass'])


def test_golden_passes_checks():
    evaluation = load(ROOT / 'tools/k1-v2-eval.py', 'k1_v2_eval')
    scenarios = {s['id']: s for s in load(HERE / 'v2_scenarios.py', 'v2_scenarios').build(evaluation.Customer, evaluation.Auto)}
    checks = load(HERE / 'v2_checks.py', 'v2_checks_golden')
    for gold in judge.golden_results():
        expect(f'golden {gold["id"]} is a scenario', gold['id'] in scenarios)
        if gold['id'] not in scenarios:
            continue
        turns = [dict(t, tools=[s['tool'] for s in t['steps']], params=[s['input'] for s in t['steps']], latency=1, error='') for t in gold['turns']]
        flags = checks.evaluate(scenarios[gold['id']], turns)
        expect(f'golden {gold["id"]} passes the mechanical checks: {flags}', not flags)
        scored = judge.offline_scores(gold)['turns']
        expect(f'golden {gold["id"]} asks at most one question per reply', all(t['one_question'] == 5 for t in scored))


def main():
    os.environ['K1_JUDGE_PROVIDER'] = 'offline'
    test_offline_rubric()
    test_pair_votes()
    test_gate()
    test_golden_passes_checks()
    if FAILURES:
        print('\n'.join('FAIL ' + f for f in FAILURES))
        sys.exit(1)
    print('ok: judge and gate self-tests')


if __name__ == '__main__':
    main()
