#!/usr/bin/env python3
"""Builds a second agent candidate whose prompt is a given base prompt plus the business rules WITHOUT their "## Voice" section.
Used to compare a rewritten base prompt against the current one on the same eval suite.

  python3 k1-variant-build.py BASE_PROMPT.md "K1 Muster agent variant (candidate)" -v2var

Then: K1_EVAL_AGENT="K1 Muster agent variant (candidate)" python3 k1-v2-eval.py run ...
The booking candidate is shared with the main candidate and is not touched.
"""
import importlib.util
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('build', HERE / 'k1-agent-v2-build.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

base = Path(sys.argv[1]).read_text().strip()
build.AGENT_NAME = sys.argv[2]
build.SUFFIX = sys.argv[3]


def business_prompt(current):
    rules = (build.ROOT / 'prompts/k1-business-prompt-v2.md').read_text().strip()
    rules = re.sub(r'\n## Voice \(overrides any example phrasing elsewhere\)\n.*?(?=\n## )', '\n', rules, flags=re.S)
    assert '## Voice' not in rules
    return f'{base}\n\n{rules}\n'


build.business_prompt = business_prompt
booking = build.by_name(build.BOOKING_NAME)
print('agent variant', build.build_agent(booking))
