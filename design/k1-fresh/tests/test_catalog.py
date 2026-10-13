#!/usr/bin/env python3
"""Checks the rule catalog: every rule is well formed, every reference resolves, and every rule has a test.

  python3 tests/test_catalog.py

Runs without n8n. Exit code 1 lists every problem.
"""
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def scenario_ids():
    evaluation = load(ROOT / 'tools/k1-v2-eval.py', 'k1_v2_eval')
    scenarios = load(ROOT / 'tests/v2_scenarios.py', 'v2_scenarios')
    return [s['id'] for s in scenarios.build(evaluation.Customer, evaluation.Auto)]


def matches(test, ids):
    return [i for i in ids if i == test or i.startswith(test + '.') or i.startswith(test + '#')]


def problems(catalog, ids):
    found = []
    sections = {s['id'] for s in catalog['sections']}
    seen = set()
    rules = catalog['guidelines']
    known = {g['id'] for g in rules}
    for rule in rules:
        rid = rule.get('id', '?')
        if rid in seen:
            found.append(f'{rid}: duplicate id')
        seen.add(rid)
        if rule.get('section') not in sections:
            found.append(f'{rid}: unknown section {rule.get("section")}')
        if rule.get('priority') not in (1, 2, 3, 4):
            found.append(f'{rid}: priority must be 1 to 4')
        if not str(rule.get('action', '')).strip():
            found.append(f'{rid}: no action')
        if rule.get('core') and rule.get('condition'):
            found.append(f'{rid}: a core rule has no condition (it always applies)')
        if not rule.get('core') and not str(rule.get('condition', '')).strip():
            found.append(f'{rid}: a non-core rule needs a condition')
        for key in ('excludes', 'depends_on'):
            for ref in rule.get(key) or []:
                if ref not in known:
                    found.append(f'{rid}: {key} {ref} does not exist')
                if ref == rid:
                    found.append(f'{rid}: {key} itself')
        for lang in (rule.get('examples') or {}):
            if lang not in ('fi', 'sv', 'en'):
                found.append(f'{rid}: example language {lang}')
        tests = rule.get('tests') or []
        if not tests:
            found.append(f'{rid}: no test proves this rule')
        for test in tests:
            if not matches(test, ids):
                found.append(f'{rid}: test {test} matches no scenario')
        if '—' in rule.get('action', '') and 'em dash' not in rule['action']:
            found.append(f'{rid}: em dash in the action (the voice rules forbid it)')
    for rule in rules:
        for ref in rule.get('excludes') or []:
            other = next(g for g in rules if g['id'] == ref) if ref in known else None
            if other and rid_in(rule['id'], other.get('excludes')):
                found.append(f'{rule["id"]} and {ref} exclude each other')
    return found


def rid_in(rid, refs):
    return rid in (refs or [])


def main():
    prompt = load(ROOT / 'tools/k1-prompt.py', 'k1_prompt')
    catalog = prompt.load()
    found = problems(catalog, scenario_ids())
    text = prompt.render(catalog)
    if len(text) > 60000:
        found.append(f'rendered prompt is {len(text)} characters')
    for rule in catalog['guidelines']:
        if f'[{rule["id"]}]' not in text:
            found.append(f'{rule["id"]}: missing from the rendered prompt')
    core = prompt.render(catalog, only=set())
    if any(f'[{g["id"]}]' in core for g in catalog['guidelines'] if not g.get('core')):
        found.append('select() leaked a non-core rule')
    if found:
        print('\n'.join(found))
        print(f'{len(found)} problems')
        sys.exit(1)
    tested = sum(len(g['tests']) for g in catalog['guidelines'])
    print(f'ok: {len(catalog["guidelines"])} guidelines, {tested} test links, prompt {len(text)} characters')


if __name__ == '__main__':
    main()
