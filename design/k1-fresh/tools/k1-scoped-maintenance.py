"""Scoped, short-lived K1 staging maintenance via existing n8n Supabase credential.

The n8n API key is read from ignored .env.local by n8n-gate.py. The temporary
webhook uses a random path and header, validates the exact permitted operation,
and is removed even if an RPC fails. No credential or response is saved in Git.
"""
import importlib.util
import json
import secrets
import time
import urllib.error
import urllib.request
import uuid

spec = importlib.util.spec_from_file_location('gate', __file__.replace('k1-scoped-maintenance.py', 'n8n-gate.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

CREDENTIAL_WORKFLOW = 'mvi33Vmzi5ucaayN'
BOOKING_WORKFLOW = 'wAE7EHLyJk6JsMue'


def invoke(operation, payload):
    if operation not in ('state', 'mark_cancelled', 'save', 'reset_versions'):
        raise ValueError('operation not allowed')
    source_id, source_name = (BOOKING_WORKFLOW, 'Mark booking cancelled') if operation == 'mark_cancelled' else (
        ('n1ECNCaTydplDq9l', 'Save Version RPC') if operation == 'save' else
        ('GQP7PPLJQA1Mmz2B', 'Reset Versions RPC') if operation == 'reset_versions' else
        (CREDENTIAL_WORKFLOW, 'Get State RPC'))
    template = next(node for node in gate.request('GET', f'/workflows/{source_id}')['nodes'] if node['name'] == source_name)
    if operation == 'mark_cancelled' and (payload.get('p_tenant_key') != 'k1_katsastus_demo' or payload.get('p_group_id') not in {
        '538e88ca-51fd-4a9f-bd71-ee952e3a1e5d', 'cb72c662-4bbe-472d-9db4-6be51cc1cadf'}):
        raise ValueError('only the known canceled evaluation groups may be reconciled')
    if operation in ('state', 'reset_versions') and payload.get('p_tenant_key') != 'k1_katsastus_demo':
        raise ValueError('unexpected tenant')
    if operation == 'save' and payload.get('p_tenant_key') != 'k1_katsastus_demo':
        raise ValueError('unexpected tenant')
    nonce = secrets.token_urlsafe(20)
    key = secrets.token_urlsafe(30)
    route = 'k1-scoped-maintenance-' + nonce
    hook = {'id': str(uuid.uuid4()), 'name': 'Scoped request', 'type': 'n8n-nodes-base.webhook', 'typeVersion': 2.1, 'position': [0, 0],
            'parameters': {'httpMethod': 'POST', 'path': route, 'responseMode': 'responseNode', 'options': {}}}
    verify = {'id': str(uuid.uuid4()), 'name': 'Verify exact input', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [230, 0],
              'parameters': {'mode': 'runOnceForAllItems', 'jsCode':
                "const request=$input.first().json; if(String(request.headers?.['x-k1-maintenance']||'')!==" + json.dumps(key) +
                " || String(request.body?.p_tenant_key||'')!=='k1_katsastus_demo'" +
                (" || String(request.body?.p_group_id||'')!==" + json.dumps(payload['p_group_id']) if operation == 'mark_cancelled' else "") +
                ") throw new Error('forbidden'); return [{json:{body:request.body}}];"}}
    # Building a long prompt into an n8n expression exceeds its expression parser.
    # Read the already-authenticated, verified request body as data instead.
    rpc = {'id': str(uuid.uuid4()), 'name': 'Scoped RPC', 'type': template['type'], 'typeVersion': template['typeVersion'],
           'position': [460, 0], 'credentials': template['credentials'],
           'parameters': {**template['parameters'], 'jsonBody': '={{ $json.body }}'}}
    response = {'id': str(uuid.uuid4()), 'name': 'Scoped response', 'type': 'n8n-nodes-base.respondToWebhook', 'typeVersion': 1.5, 'position': [690, 0],
                'parameters': {'respondWith': 'json', 'responseBody': '={{ $json }}', 'options': {}}}
    link = lambda name: {'main': [[{'node': name, 'type': 'main', 'index': 0}]]}
    body = {'name': 'K1 scoped maintenance ' + nonce[:7], 'nodes': [hook, verify, rpc, response],
            'connections': {hook['name']: link(verify['name']), verify['name']: link(rpc['name']), rpc['name']: link(response['name'])},
            'settings': {'executionOrder': 'v1', 'saveDataErrorExecution': 'all', 'saveDataSuccessExecution': 'all'}}
    workflow_id = None
    try:
        workflow_id = gate.request('POST', '/workflows', body)['id']
        gate.request('POST', f'/workflows/{workflow_id}/activate')
        url = (gate.local_env().get('N8N_RAPID_BASE_URL') or gate.DEFAULT_BASE).rstrip('/') + '/webhook/' + route
        # A 404 just after activation is webhook registration lag. Do not repeat
        # writes on any other response, including 500 or timeout.
        for attempt in range(12):
            request = urllib.request.Request(url, method='POST', data=json.dumps(payload, separators=(',', ':')).encode(),
                headers={'Content-Type': 'application/json', 'x-k1-maintenance': key})
            try:
                with urllib.request.urlopen(request, timeout=35) as result:
                    return workflow_id, result.status, result.read().decode()
            except urllib.error.HTTPError as error:
                details = error.read().decode()
                if error.code == 404 and 'not registered' in details and attempt < 11:
                    time.sleep(1)
                    continue
                if error.code >= 500:
                    executions = gate.request('GET', f'/executions?workflowId={workflow_id}&limit=5').get('data', [])
                    diagnostics = []
                    for item in executions:
                        data = gate.request('GET', f"/executions/{item['id']}?includeData=true")
                        fault = data.get('data', {}).get('resultData', {}).get('error') or {}
                        diagnostics.append({'status': item.get('status'), 'node': (fault.get('node') or {}).get('name'), 'message': fault.get('message')})
                    print('scoped execution diagnostics', json.dumps(diagnostics), flush=True)
                return workflow_id, error.code, details
        raise RuntimeError('route did not become ready')
    finally:
        if workflow_id:
            try:
                gate.request('POST', f'/workflows/{workflow_id}/deactivate')
            except urllib.error.HTTPError as error:
                if error.code != 409:
                    print('deactivation failed', workflow_id, error.code, flush=True)
            for attempt in range(10):
                try:
                    gate.request('DELETE', f'/workflows/{workflow_id}')
                    break
                except urllib.error.HTTPError as error:
                    if error.code != 409 or attempt == 9:
                        print('cleanup failed', workflow_id, error.code, flush=True)
                        break
                    time.sleep(1)


if __name__ == '__main__':
    import sys
    if len(sys.argv) != 3:
        raise SystemExit('usage: k1-scoped-maintenance.py <state|mark_cancelled|save|reset_versions> <json-payload>')
    result = invoke(sys.argv[1], json.loads(sys.argv[2]))
    print(json.dumps({'workflow': result[0], 'status': result[1], 'result': result[2]}))
