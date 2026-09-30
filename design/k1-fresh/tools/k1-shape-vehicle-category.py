#!/usr/bin/env python3
"""Additive patch: the customer-data endpoint keeps VehicleCategory from the reminders API.

Backs the workflow up to /tmp/k1gate first. Safe to rerun.
"""
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('gate', Path(__file__).with_name('n8n-gate.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

WORKFLOW = 'GQP7PPLJQA1Mmz2B'
OLD = "    Reason: String(row.Reason || ''),\n  }))"
NEW = "    Reason: String(row.Reason || ''),\n    VehicleCategory: String(row.VehicleCategory || ''),\n  }))"

workflow = gate.request('GET', f'/workflows/{WORKFLOW}')
Path('/tmp/k1gate').mkdir(exist_ok=True)
Path(f'/tmp/k1gate/{WORKFLOW}.backup.json').write_text(json.dumps(workflow))
node = next(n for n in workflow['nodes'] if n['name'] == 'Shape Muster Day')
code = node['parameters']['jsCode']
if 'VehicleCategory' in code:
    print('already patched')
else:
    assert code.count(OLD) == 1
    node['parameters']['jsCode'] = code.replace(OLD, NEW)
    keep = ('executionOrder', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'saveManualExecutions', 'timezone', 'errorWorkflow')
    gate.request('PUT', f'/workflows/{WORKFLOW}', {'name': workflow['name'], 'nodes': workflow['nodes'], 'connections': workflow['connections'], 'settings': {k: v for k, v in workflow.get('settings', {}).items() if k in keep}})
    gate.request('POST', f'/workflows/{WORKFLOW}/activate')
    print('patched')
after = gate.request('GET', f'/workflows/{WORKFLOW}')
print('active', after['active'], 'VehicleCategory' in next(n for n in after['nodes'] if n['name'] == 'Shape Muster Day')['parameters']['jsCode'], len(after['nodes']) == len(workflow['nodes']))
