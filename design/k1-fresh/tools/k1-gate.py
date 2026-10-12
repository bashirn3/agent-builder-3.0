#!/usr/bin/env python3
"""Regression gate: a candidate version may only be promoted when it is not worse than the baseline on any rule.

  python3 k1-gate.py check --base BASE.json[,MORE.json] --cand CAND.json[,MORE.json]
                           [--judge-base S.json --judge-cand S.json] [--pairs P.json] [--golden G.json] [--out FILE]
  python3 k1-gate.py verify           exit 0 only if gates/ holds a passing gate for the prompt the build would ship now

A run fails the gate when
- any catalog rule's pass rate (its test scenarios without flags) drops more than RULE_DROP points and more scenarios fail,
- the share of flagged scenarios overall rises more than RULE_DROP points,
- the judge's average score drops more than JUDGE_DROP, or any single criterion more than CRITERION_DROP,
- pairwise, the baseline wins clearly more scenarios than the candidate,
- the candidate loses to any golden chat.
Turns with a platform fallback or an HTTP error are left out on both sides: an outage is not a rule failure.

check writes gates/<time>-<prompt hash>.json; k1-agent-v2-build.py promote calls verify first.
"""
import argparse
import importlib.util
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
GATES = ROOT / 'gates'
RULE_DROP = 0.02
JUDGE_DROP = 0.05
CRITERION_DROP = 0.15


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


k1_prompt = load_module(HERE / 'k1-prompt.py', 'k1_prompt')


def load_catalog():
    return k1_prompt.load()


def read_results(spec):
    results = []
    for part in [p for p in str(spec).split(',') if p]:
        data = json.loads(Path(part).read_text())
        results.extend(data if isinstance(data, list) else data.get('results', []))
    return results


def noisy(result):
    turns = result.get('turns') or []
    return not turns or any(t.get('fallback') or t.get('status') not in (200, None) for t in turns)


def base_id(scenario_id):
    return scenario_id.split('#', 1)[0]


def matches(test, scenario_id):
    sid = base_id(scenario_id)
    return sid == test or sid.startswith(test + '.')


def rule_rates(results, catalog):
    clean = [r for r in results if not noisy(r)]
    rates = {}
    for rule in catalog['guidelines']:
        hit = [r for r in clean if any(matches(t, r['id']) for t in rule.get('tests') or [])]
        if hit:
            failed = sorted({base_id(r['id']) for r in hit if r.get('flags')})
            rates[rule['id']] = {'runs': len(hit), 'failed_runs': sum(bool(r.get('flags')) for r in hit), 'rate': round(1 - sum(bool(r.get('flags')) for r in hit) / len(hit), 4), 'failed': failed}
    return rates


def flag_share(results):
    clean = [r for r in results if not noisy(r)]
    return round(sum(bool(r.get('flags')) for r in clean) / len(clean), 4) if clean else 0.0


def compare(base, cand, catalog=None, judge_base=None, judge_cand=None, pairs=None, golden=None):
    catalog = catalog or load_catalog()
    reasons, rules = [], {}
    base_rates, cand_rates = rule_rates(base, catalog), rule_rates(cand, catalog)
    for rid, before in base_rates.items():
        after = cand_rates.get(rid)
        if not after:
            continue
        drop = before['rate'] - after['rate']
        rules[rid] = {'base': before['rate'], 'cand': after['rate'], 'runs': [before['runs'], after['runs']], 'newly_failed': sorted(set(after['failed']) - set(before['failed']))}
        if drop > RULE_DROP and after['failed_runs'] > before['failed_runs'] * after['runs'] / max(1, before['runs']):
            reasons.append(f"{rid}: pass rate {before['rate']:.0%} -> {after['rate']:.0%} (newly failing: {', '.join(rules[rid]['newly_failed'][:6]) or 'more runs of the same scenarios'})")
    share_base, share_cand = flag_share(base), flag_share(cand)
    if share_cand - share_base > RULE_DROP:
        reasons.append(f'flagged scenarios overall {share_base:.1%} -> {share_cand:.1%}')
    untested = sorted(g['id'] for g in catalog['guidelines'] if g['id'] not in cand_rates)
    judge = None
    if judge_base and judge_cand:
        b, c = judge_base['meta'], judge_cand['meta']
        judge = {'base': b.get('overall'), 'cand': c.get('overall'), 'by_criterion': {}}
        if b.get('overall') is not None and c.get('overall') is not None and b['overall'] - c['overall'] > JUDGE_DROP:
            reasons.append(f"judge average {b['overall']} -> {c['overall']}")
        for key, before in (b.get('by_criterion') or {}).items():
            after = (c.get('by_criterion') or {}).get(key)
            if after is None:
                continue
            judge['by_criterion'][key] = [before, after]
            if before - after > CRITERION_DROP:
                reasons.append(f'judge {key} {before} -> {after}')
    pair_summary = None
    if pairs:
        m = pairs['meta']
        pair_summary = {'base_better': m.get('a', 0), 'cand_better': m.get('b', 0), 'tie': m.get('tie', 0)}
        if m.get('a', 0) > m.get('b', 0) * 1.2 + 2:
            losses = [sid for sid, v in pairs['pairs'].items() if v['winner'] == 'a'][:8] if pairs.get('pairs') else []
            reasons.append(f"pairwise the baseline is better in {m['a']} scenarios, the candidate in {m['b']} (e.g. {', '.join(losses)})")
    golden_summary = None
    if golden:
        m = golden['meta']
        golden_summary = {'lost': m.get('lost_to_golden', []), 'missing': m.get('missing', [])}
        if m.get('lost_to_golden'):
            reasons.append(f"lost to golden chats: {', '.join(m['lost_to_golden'])}")
        if m.get('missing'):
            reasons.append(f"golden chats not run by the candidate: {', '.join(m['missing'][:8])}")
    return {'pass': not reasons, 'reasons': reasons, 'rules': rules, 'flag_share': [share_base, share_cand], 'untested_rules': untested,
            'excluded_noisy': [sum(map(noisy, base)), sum(map(noisy, cand))], 'judge': judge, 'pairs': pair_summary, 'golden': golden_summary}


def read_json(path):
    return json.loads(Path(path).read_text()) if path else None


def check(args):
    verdict = compare(read_results(args.base), read_results(args.cand), judge_base=read_json(args.judge_base), judge_cand=read_json(args.judge_cand),
                      pairs=read_json(args.pairs), golden=read_json(args.golden))
    verdict.update({'prompt_hash': k1_prompt.digest(), 'base': args.base, 'cand': args.cand, 'at': time.strftime('%Y-%m-%d %H:%M:%S')})
    GATES.mkdir(exist_ok=True)
    out = Path(args.out) if args.out else GATES / f"{time.strftime('%Y%m%d-%H%M%S')}-{verdict['prompt_hash']}.json"
    out.write_text(json.dumps(verdict, ensure_ascii=False, indent=1))
    print('PASS' if verdict['pass'] else 'FAIL', out)
    for reason in verdict['reasons']:
        print('  ' + reason)
    if verdict['untested_rules']:
        print(f"  note: {len(verdict['untested_rules'])} rules had no scenario in this run")
    return 0 if verdict['pass'] else 1


def verify(quiet=False):
    current = k1_prompt.digest()
    for path in sorted(GATES.glob(f'*-{current}.json'), reverse=True):
        data = json.loads(path.read_text())
        if data.get('pass') and data.get('prompt_hash') == current:
            if not quiet:
                print('gate passed for this prompt:', path.name)
            return path
    if not quiet:
        print(f'no passing gate for prompt {current}: run the baseline and candidate suites, then k1-gate.py check')
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['check', 'verify'])
    parser.add_argument('--base')
    parser.add_argument('--cand')
    parser.add_argument('--judge-base')
    parser.add_argument('--judge-cand')
    parser.add_argument('--pairs')
    parser.add_argument('--golden')
    parser.add_argument('--out')
    args = parser.parse_args()
    if args.command == 'verify':
        return 0 if verify() else 1
    if not (args.base and args.cand):
        parser.error('check needs --base and --cand')
    return check(args)


if __name__ == '__main__':
    sys.exit(main())
