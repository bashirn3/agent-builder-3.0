#!/usr/bin/env python3
"""LLM judge for how the K1 agent talks. Reads results files written by k1-v2-eval.py.

  python3 tests/v2_judge.py score RESULTS --out SCORES.json                 rubric scores, 1 to 5, for every reply
  python3 tests/v2_judge.py pair A.json B.json --out PAIRS.json             which version handled each shared scenario better
  python3 tests/v2_judge.py golden RESULTS --out GOLDEN.json                the candidate against the golden chats (tests/golden)

Provider: K1_JUDGE_PROVIDER = openai (OPENAI_API_KEY), anthropic (ANTHROPIC_API_KEY), azure (AZURE_OPENAI_ENDPOINT plus
AZURE_OPENAI_API_KEY or an `az login` session; K1_JUDGE_MODEL is the deployment name) or offline (rule-based, no key; for
self-tests and a rough first look). Model: K1_JUDGE_MODEL. Temperature 0, and every pair is judged twice with the order
swapped, so a judge that prefers whatever comes first cancels out. Answers are cached in /tmp/k1judge by content hash.
"""
import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
GOLDEN = HERE / 'golden'
CACHE = Path(os.environ.get('K1_JUDGE_CACHE', '/tmp/k1judge'))
RUBRIC_VERSION = 1
CRITERIA = {
    'natural': 'Sounds like a friendly person at a K1 station texting on WhatsApp, not a form, a script or a call centre.',
    'brief': 'As short as it can be: one short bubble, two at most, no filler, no restating the customer.',
    'human_beat': 'Answers what the customer actually said first (greeting, joke, frustration, question) before moving on.',
    'one_question': 'At most one question, and only for the next detail that is really needed.',
    'language': 'Entirely in the language of the customer\'s latest message, with no words from another language.',
    'grounded': 'Every time, price, hour, booking or failure it states is backed by the tool results shown in that turn or earlier.',
}
LEAD_INS = re.compile(r'^(sure|okay|ok|great|absolutely|of course|alright|sounds good|selvä|okei|hyvä|kiva|visst|okej|toppen|absolut)\b', re.I)
SYSTEM = (
    'You review replies of the K1 Katsastus WhatsApp booking assistant (Finnish vehicle inspections; it books at Palokka and '
    'Itäharju and sends other stations to a link or 0306 100 100). You are strict and consistent. You only judge how the '
    'assistant talks and whether what it says is backed by its tool results; you never rewrite replies.')


def load_v2_checks():
    import importlib.util
    spec = importlib.util.spec_from_file_location('v2_checks', HERE / 'v2_checks.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def transcript(result, tool_chars=500):
    lead = result.get('lead') or {}
    lines = [f"Lead: language {lead.get('lang', '?')}, station {lead.get('station', '?')}, product {lead.get('product', '?')}, plate {lead.get('plate', '?')}"]
    for index, turn in enumerate(result.get('turns') or [], 1):
        lines.append(f'--- turn {index}')
        lines.append(f"Customer: {turn.get('user', '')}")
        for step in turn.get('steps') or []:
            lines.append(f"Tool {step.get('tool')}({json.dumps(step.get('input', {}), ensure_ascii=False)[:200]}) -> {str(step.get('output', ''))[:tool_chars]}")
        if turn.get('fallback') or turn.get('status') not in (200, None):
            lines.append('(the platform returned a fallback or an error for this turn)')
        lines.append(f"Assistant: {turn.get('reply', '')}")
    return '\n'.join(lines)


# ---------- providers ----------

def cached(key, compute):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / (hashlib.sha256(key.encode()).hexdigest()[:24] + '.json')
    if path.exists():
        return json.loads(path.read_text())
    value = compute()
    path.write_text(json.dumps(value, ensure_ascii=False))
    return value


def http_json(url, body, headers, timeout=120):
    for attempt in range(5):
        req = urllib.request.Request(url, data=json.dumps(body).encode(), method='POST', headers={'Content-Type': 'application/json', **headers})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return json.load(res)
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 529) or attempt == 4:
                raise RuntimeError(f'judge HTTP {error.code}: {error.read().decode()[:300]}')
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt == 4:
                raise RuntimeError(f'judge unreachable: {error}')
        time.sleep(3 * (attempt + 1))


_AZURE_TOKEN = {}


def azure_auth():
    if os.environ.get('AZURE_OPENAI_API_KEY'):
        return {'api-key': os.environ['AZURE_OPENAI_API_KEY']}
    # Without a key, borrow an Entra token from the logged-in az CLI; tokens live about an hour.
    if _AZURE_TOKEN.get('expires', 0) < time.time() + 300:
        import subprocess
        out = subprocess.run(['az', 'account', 'get-access-token', '--resource', 'https://cognitiveservices.azure.com', '-o', 'json'],
                             check=True, capture_output=True, text=True).stdout
        token = json.loads(out)
        _AZURE_TOKEN.update(value=token['accessToken'], expires=float(token.get('expires_on') or time.time() + 3000))
    return {'Authorization': 'Bearer ' + _AZURE_TOKEN['value']}


def ask(prompt):
    provider = os.environ.get('K1_JUDGE_PROVIDER', 'openai')
    if provider == 'openai':
        model = os.environ.get('K1_JUDGE_MODEL', 'gpt-4.1')
        data = http_json('https://api.openai.com/v1/chat/completions',
                         {'model': model, 'temperature': 0, 'response_format': {'type': 'json_object'},
                          'messages': [{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': prompt}]},
                         {'Authorization': 'Bearer ' + os.environ['OPENAI_API_KEY']})
        text = data['choices'][0]['message']['content']
    elif provider == 'anthropic':
        model = os.environ.get('K1_JUDGE_MODEL', 'claude-sonnet-4-5')
        data = http_json('https://api.anthropic.com/v1/messages',
                         {'model': model, 'max_tokens': 2000, 'temperature': 0, 'system': SYSTEM, 'messages': [{'role': 'user', 'content': prompt}]},
                         {'x-api-key': os.environ['ANTHROPIC_API_KEY'], 'anthropic-version': '2023-06-01'})
        text = ''.join(part.get('text', '') for part in data['content'])
    elif provider == 'azure':
        deployment = os.environ.get('K1_JUDGE_MODEL', 'gpt-6-luna')
        endpoint = os.environ['AZURE_OPENAI_ENDPOINT'].rstrip('/')
        version = os.environ.get('AZURE_OPENAI_API_VERSION', '2025-04-01-preview')
        body = {'response_format': {'type': 'json_object'},
                'messages': [{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': prompt}]}
        if os.environ.get('K1_JUDGE_TEMPERATURE'):
            body['temperature'] = float(os.environ['K1_JUDGE_TEMPERATURE'])
        data = http_json(f'{endpoint}/openai/deployments/{deployment}/chat/completions?api-version={version}', body, azure_auth())
        text = data['choices'][0]['message']['content']
    else:
        raise RuntimeError(f'unknown provider {provider}')
    match = re.search(r'\{.*\}', text, re.S)
    if not match:
        raise RuntimeError(f'judge did not answer JSON: {text[:200]}')
    return json.loads(match.group(0))


def model_id():
    provider = os.environ.get('K1_JUDGE_PROVIDER', 'openai')
    default = {'openai': 'gpt-4.1', 'anthropic': 'claude-sonnet-4-5', 'azure': 'gpt-6-luna', 'offline': 'rules'}.get(provider, '?')
    return f"{provider}:{os.environ.get('K1_JUDGE_MODEL', default)}"


# ---------- offline judge (no LLM): the mechanical part of the rubric ----------

def offline_turn(turn, lang_of, earlier=''):
    reply = turn.get('reply', '') or ''
    user = turn.get('user', '') or ''
    words = len(reply.split())
    questions = reply.count('?')
    expected, got = lang_of(user), lang_of(reply)
    tool_text = earlier + ' '.join(str(s.get('output', '')) for s in turn.get('steps') or []) + ' ' + (turn.get('user') or '')
    undated = re.sub(r'(?<!klo )(?<!kl )(?<!kl\. )(?<!at )(?<![\d.:])\d{1,2}\.(?:0?[1-9]|1[0-2])(\.(?!\d)|(?=,)|(?=\s+(?:kl|klo|at|klockan)\b))', ' ', reply)
    undated = re.sub(r'\b(?:ma|ti|ke|to|pe|la|su|mån|tis|ons|tors|fre|lör|sön|mon|tue|wed|thu|fri|sat|sun)\w*\.?\s+\d{1,2}\.\d{1,2}\b', ' ', undated, flags=re.I)
    stated = set(re.findall(r'\b([01]?\d|2[0-3])[:.]([0-5]\d)\b', undated))
    backed = all(f'{int(h):02d}:{m}' in tool_text or f'{h}:{m}' in tool_text for h, m in stated) if stated else True
    return {
        'natural': 2 if LEAD_INS.search(reply.strip()) else (3 if re.search(r'certainly|happy to help|autan mielelläni|hjälper gärna', reply, re.I) else 4),
        'brief': 5 if words <= 25 else 4 if words <= 45 else 3 if words <= 70 else 2,
        'human_beat': 4,
        'one_question': 5 if questions <= 1 else 2,
        'language': 5 if not expected or not got or expected == got else 1,
        'grounded': 5 if backed else 2,
        'reason': f'{words} words, {questions} questions',
    }


def offline_scores(result):
    checks = load_v2_checks()
    scored, earlier = [], ''
    for turn in result.get('turns') or []:
        scored.append(offline_turn(turn, checks.detect, earlier))
        earlier += ' '.join(str(s.get('output', '')) for s in turn.get('steps') or []) + ' ' + (turn.get('user') or '') + ' '
    return {'turns': scored}


# ---------- rubric scoring ----------

SCORE_PROMPT = """Score every assistant reply in this conversation from 1 (bad) to 5 (excellent) on each criterion:
{criteria}

Use 3 for "acceptable but a K1 reviewer would want it better" and 5 only when nothing should change. A reply in the wrong
language, or one that states a time, price or booking outcome that no tool result backs, gets 1 on that criterion.

Answer JSON only: {{"turns": [{{"natural": n, "brief": n, "human_beat": n, "one_question": n, "language": n, "grounded": n, "reason": "one short line about the weakest point"}}, ...]}}
with exactly {count} entries, one per assistant reply in order.

Conversation:
{transcript}"""


def score_one(result):
    if os.environ.get('K1_JUDGE_PROVIDER') == 'offline':
        data = offline_scores(result)
    else:
        text = transcript(result)
        count = len(result.get('turns') or [])
        prompt = SCORE_PROMPT.format(criteria='\n'.join(f'- {k}: {v}' for k, v in CRITERIA.items()), count=count, transcript=text)
        data = cached(f'score|{RUBRIC_VERSION}|{model_id()}|{text}', lambda: ask(prompt))
    turns = [{k: (max(1, min(5, int(t.get(k, 3)))) if k in CRITERIA else t.get(k, '')) for k in [*CRITERIA, 'reason']} for t in data.get('turns', [])]
    means = {k: round(sum(t[k] for t in turns) / len(turns), 2) for k in CRITERIA} if turns else {}
    return {'turns': turns, 'mean': means, 'overall': round(sum(means.values()) / len(means), 2) if means else None}


def judgeable(result):
    turns = result.get('turns') or []
    return bool(turns) and not any(t.get('status') not in (200, None) or t.get('fallback') for t in turns)


def score(results, workers=6):
    out = {}
    todo = [r for r in results if judgeable(r)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for result, scored in zip(todo, pool.map(score_one, todo)):
            out[result['id']] = scored
    skipped = sorted(r['id'] for r in results if not judgeable(r))
    overall = [s['overall'] for s in out.values() if s['overall'] is not None]
    by_criterion = {k: round(sum(s['mean'][k] for s in out.values() if s['mean']) / max(1, len(out)), 3) for k in CRITERIA}
    return {'meta': {'judge': model_id(), 'rubric': RUBRIC_VERSION, 'scored': len(out), 'skipped': skipped,
                     'overall': round(sum(overall) / len(overall), 3) if overall else None, 'by_criterion': by_criterion},
            'scores': out}


# ---------- pairwise ----------

PAIR_PROMPT = """Two versions of the assistant handled the same scenario (same customer messages where the customer is scripted).
Which conversation would a K1 reviewer rather send to real customers? Judge only on: {criteria}.
The two may have run on different days, so dates, times, booking numbers and prices can differ: judge each against its own
tool results, never prefer one for the day it found. If they are equally good or equally bad, answer "tie".

Answer JSON only: {{"winner": "1" | "2" | "tie", "reason": "one short line"}}

Conversation 1:
{one}

Conversation 2:
{two}"""


def offline_total(result):
    scored = score_one(result)
    return scored['overall'] or 0


def pair_one(a, b):
    if os.environ.get('K1_JUDGE_PROVIDER') == 'offline':
        diff = offline_total(a) - offline_total(b)
        return {'winner': 'a' if diff > 0.15 else 'b' if diff < -0.15 else 'tie', 'votes': [], 'reason': f'offline totals differ by {diff:+.2f}'}
    ta, tb = transcript(a), transcript(b)
    criteria = ', '.join(CRITERIA)
    votes = []
    for first, second, first_name, second_name in ((ta, tb, 'a', 'b'), (tb, ta, 'b', 'a')):
        answer = cached(f'pair|{RUBRIC_VERSION}|{model_id()}|{first}|{second}', lambda f=first, s=second: ask(PAIR_PROMPT.format(criteria=criteria, one=f, two=s)))
        winner = str(answer.get('winner', 'tie')).strip()
        votes.append({'1': first_name, '2': second_name}.get(winner, 'tie'))
    decided = [v for v in votes if v != 'tie']
    winner = decided[0] if decided and len(set(decided)) == 1 else 'tie'
    return {'winner': winner, 'votes': votes}


def base_id(scenario_id):
    return scenario_id.split('#', 1)[0]


def pair(a_results, b_results, workers=6):
    a = {}
    for r in a_results:
        if judgeable(r):
            a.setdefault(base_id(r['id']), r)
    b = {}
    for r in b_results:
        if judgeable(r):
            b.setdefault(base_id(r['id']), r)
    shared = sorted(set(a) & set(b))
    out = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for sid, verdict in zip(shared, pool.map(lambda sid: pair_one(a[sid], b[sid]), shared)):
            out[sid] = verdict
    tally = {k: sum(v['winner'] == k for v in out.values()) for k in ('a', 'b', 'tie')}
    return {'meta': {'judge': model_id(), 'rubric': RUBRIC_VERSION, 'shared': len(shared), **tally}, 'pairs': out}


def golden_results():
    items = []
    for path in sorted(GOLDEN.glob('*.json')):
        data = json.loads(path.read_text())
        items.extend(data if isinstance(data, list) else [data])
    return items


def golden(candidate_results):
    gold = golden_results()
    verdicts = pair(gold, candidate_results)
    ids = {base_id(g['id']) for g in gold}
    missing = sorted(ids - set(verdicts['pairs']))
    losses = sorted(sid for sid, v in verdicts['pairs'].items() if v['winner'] == 'a')
    verdicts['meta'].update({'golden': len(ids), 'missing': missing, 'lost_to_golden': losses})
    return verdicts


def read(path):
    data = json.loads(Path(path).read_text())
    return data if isinstance(data, list) else data.get('results', [])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['score', 'pair', 'golden'])
    parser.add_argument('files', nargs='+')
    parser.add_argument('--out', required=True)
    parser.add_argument('--workers', type=int, default=6)
    args = parser.parse_args()
    if args.command == 'score':
        result = score(read(args.files[0]), args.workers)
        print(f"scored {result['meta']['scored']}, skipped {len(result['meta']['skipped'])}, overall {result['meta']['overall']}, {result['meta']['by_criterion']}")
    elif args.command == 'pair':
        result = pair(read(args.files[0]), read(args.files[1]), args.workers)
        m = result['meta']
        print(f"{m['shared']} shared scenarios: A better {m['a']}, B better {m['b']}, tie {m['tie']}")
    else:
        result = golden(read(args.files[0]))
        m = result['meta']
        print(f"{m['golden']} golden chats: lost {len(m['lost_to_golden'])}, missing from the run {len(m['missing'])}")
    Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    sys.exit(main())
