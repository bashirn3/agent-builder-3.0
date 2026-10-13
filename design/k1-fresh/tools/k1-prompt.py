#!/usr/bin/env python3
"""Renders the K1 agent prompt from the rule catalog (prompts/k1-guidelines.yaml).

  python3 k1-prompt.py render [--out FILE]        the full prompt (what the workflow and the platform version get)
  python3 k1-prompt.py select ID [ID ...]         core rules plus the named guidelines only (per-turn routing)
  python3 k1-prompt.py hash                       short hash of the rendered prompt (the gate file records it)

K1_PROMPT_SOURCE=legacy keeps the old hand-written prompt (conversational head + business brief) for rebuilding v8.
"""
import hashlib
import os
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / 'prompts/k1-guidelines.yaml'
LANG_LABEL = {'fi': 'Finnish', 'sv': 'Swedish', 'en': 'English'}


def load(path=CATALOG):
    return yaml.safe_load(Path(path).read_text())


def legacy():
    head = (ROOT / 'prompts/k1-conversational-head.md').read_text().rstrip()
    rules = (ROOT / 'prompts/k1-business-prompt-v2.md').read_text().strip()
    return f'{head}\n\n{rules}\n'


def bullet(rule):
    text = ' '.join(rule['action'].split())
    if rule.get('condition'):
        condition = ' '.join(rule['condition'].split())
        first = text.split(' ', 1)[0]
        keep = len(first) > 1 and first.isupper()
        text = f'When {condition}: {text if keep else text[0].lower() + text[1:]}'
    examples = rule.get('examples') or {}
    if examples:
        shown = '; '.join(f'{LANG_LABEL[lang]} "{line}"' for lang, lines in examples.items() for line in lines)
        text += f' Examples (format only, facts come from tools): {shown}.'
    overrides = rule.get('excludes') or []
    if overrides:
        text += f' This overrides [{", ".join(overrides)}].'
    return f'- [{rule["id"]}] (priority {rule["priority"]}) {text}'


def render(catalog=None, only=None):
    catalog = catalog or load()
    agent = catalog['agent']
    picked = [g for g in catalog['guidelines'] if only is None or g.get('core') or g['id'] in only]
    out = [f'# {agent["name"]}', '', ' '.join(agent['intro'].split()), '', ' '.join(agent['precedence'].split())]
    for section in catalog['sections']:
        rules = sorted((g for g in picked if g['section'] == section['id']), key=lambda g: (g['priority'], not g.get('core')))
        if not rules:
            continue
        out += ['', f'## {section["title"]}'] + [bullet(rule) for rule in rules]
    return '\n'.join(out) + '\n'


def prompt():
    """The business prompt the build tools ship: the catalog, or the hand-written v8 prompt with K1_PROMPT_SOURCE=legacy."""
    return legacy() if os.environ.get('K1_PROMPT_SOURCE') == 'legacy' else render()


def digest(text=None):
    return hashlib.sha256((text if text is not None else prompt()).encode()).hexdigest()[:16]


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else ''
    if command == 'render':
        text = prompt()
        if '--out' in sys.argv:
            target = Path(sys.argv[sys.argv.index('--out') + 1])
            target.write_text(text)
            print('wrote', target, len(text), 'characters')
        else:
            sys.stdout.write(text)
    elif command == 'select':
        sys.stdout.write(render(only=set(sys.argv[2:])))
    elif command == 'hash':
        print(digest())
    else:
        raise SystemExit(__doc__)


if __name__ == '__main__':
    main()
