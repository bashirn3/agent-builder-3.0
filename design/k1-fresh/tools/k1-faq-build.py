#!/usr/bin/env python3
"""Parse the A-Katsastus FAQ brief (markdown) into data/a-katsastus-faq.json."""
import json, re, sys

src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else 'data/a-katsastus-faq.json'
text = open(src, encoding='utf-8').read()
start = text.index('## FAQ: Vehicle inspections')
cat = None
items = []
cur = None
for line in text[start:].splitlines():
    if line.startswith('## FAQ: '):
        cat = line[8:].strip()
        continue
    if line.startswith('### '):
        cur = {'category': cat, 'question': line[4:].strip(), 'lines': []}
        items.append(cur)
        continue
    if cur is not None:
        cur['lines'].append(line)

seen = {}
faqs = []
for it in items:
    body = '\n'.join(it['lines']).strip()
    links = [{'text': t, 'url': u} for t, u in re.findall(r'\[([^\]]+)\]\((https?://[^)]+)\)', body)]
    key = it['question'].lower()
    if key in seen:
        seen[key]['also_in'].append(it['category'])
        continue
    entry = {
        'id': 'faq-%02d' % (len(faqs) + 1),
        'category': it['category'],
        'question': it['question'],
        'answer': re.sub(r'\n{3,}', '\n\n', body),
        'links': links,
        'also_in': [],
    }
    seen[key] = entry
    faqs.append(entry)
CUSTOM = [
    {
        'category': 'Vehicle inspections and statutory measuring',
        'question': 'When should the emission tests be done? Which cars need an emission test?',
        'answer': 'Emission tests (statutory measuring) apply to cars registered after August 1976 (1976/8). Anything older is a historic vehicle. The measuring is normally done at the periodic inspection, and a certificate from an earlier measuring is valid for three months.',
    },
]
for extra in CUSTOM:
    faqs.append({'id': 'faq-%02d' % (len(faqs) + 1), 'links': [], 'also_in': [], 'source': 'dev brief', **extra})
json.dump(faqs, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(items), 'parsed,', len(faqs), 'after dedupe, plus custom ->', out)
