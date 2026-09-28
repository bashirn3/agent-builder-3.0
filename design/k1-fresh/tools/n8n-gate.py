"""Puts the Clerk session and team check in front of every K1 builder webhook.

Usage:
  python3 n8n-gate.py apply <workflowId>...                 gate live workflows (backs up to /tmp/k1gate first)
  python3 n8n-gate.py clone <workflowId> <pathSuffix>       gated test copy with suffixed paths, prints its id
  python3 n8n-gate.py delete <workflowId>                   remove a test copy

Reads the n8n API key from ~/.cursor/mcp.json. The check matches the customer data
endpoint (GQP7PPLJQA1Mmz2B): a valid Clerk session from a trusted issuer and one of the allowed teams.
"""
import json, os, re, sys, urllib.request, uuid

BASE = 'https://n8n-rapid-czbff9cnafhkhmhf.eastus-01.azurewebsites.net/api/v1'
ALLOWED_TEAMS = ['org_3JnrOo6wYLChqTm3DpvDZXlNgW7', 'org_3JnkbIdnkJiAQQo7qBAh2vtiXSa']
PROD_ISSUER = 'https://clerk.a-katsastus.wasup.co'
TRUSTED_ISSUERS = [PROD_ISSUER, 'https://maximum-beetle-5151.clerk.accounts.dev']
PROD_JWT = {'jwtAuth': {'id': 'zsBlQDlTXe4CcON9', 'name': 'K1 Clerk sessions (production)'}}
DEV_JWT = {'jwtAuth': {'id': 'NTjMVvR2Igb3bKWr', 'name': 'K1 Clerk sessions (development)'}}
MARK = ' · Check Access'


def api_key():
    text = open(os.path.expanduser('~/.cursor/mcp.json')).read()
    return re.search(r'N8N_API_KEY"?\s*:\s*"([^"]+)', text).group(1)


def request(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={'X-N8N-API-KEY': api_key(), 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as res:
        raw = res.read()
        return json.loads(raw) if raw else None


def gate_nodes(hook, x, y):
    name = hook['name']
    n = lambda suffix: f'{name} · {suffix}'
    read = f"""const req = $('{name}').first().json;
const raw = String(req.headers?.['x-k1-session'] || '');
const token = raw.replace(/^Bearer\\s+/i, '').trim();
let iss = '';
try {{
  const part = token.split('.')[1] || '';
  iss = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).iss || '';
}} catch (error) {{}}
return [{{ json: {{ token: token || 'missing', iss }} }}];"""
    check = f"""// Only signed-in members of these Clerk teams can use the agent builder.
const ALLOWED_TEAMS = {json.dumps(ALLOWED_TEAMS)};
const TRUSTED_ISSUERS = {json.dumps(TRUSTED_ISSUERS)};
const verified = $input.first().json;
const claims = verified.payload || verified;
if (verified.error || !claims || !claims.sub || !TRUSTED_ISSUERS.includes(claims.iss)) {{
  return [{{ json: {{ ok: false, status: 401, error: 'signin_required' }} }}];
}}
const team = (claims.o && claims.o.id) || claims.org_id || null;
if (!ALLOWED_TEAMS.includes(team)) {{
  return [{{ json: {{ ok: false, status: 403, error: 'team_required' }} }}];
}}
return [{{ json: {{ ok: true }} }}];"""
    cond = lambda cid, left, right: {'conditions': {'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'strict', 'version': 2}, 'conditions': [{'id': cid, 'leftValue': left, 'rightValue': right, 'operator': {'type': 'string', 'operation': 'equals'}}], 'combinator': 'and'}, 'options': {}}
    ident = lambda: str(uuid.uuid4())
    nodes = [
        {'id': ident(), 'name': n('Read Session'), 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [x + 200, y + 260], 'parameters': {'mode': 'runOnceForAllItems', 'jsCode': read}},
        {'id': ident(), 'name': n('Production Session?'), 'type': 'n8n-nodes-base.if', 'typeVersion': 2.2, 'position': [x + 400, y + 260], 'parameters': cond('prod', '={{ $json.iss }}', PROD_ISSUER)},
        {'id': ident(), 'name': n('Verify Production'), 'type': 'n8n-nodes-base.jwt', 'typeVersion': 1, 'onError': 'continueRegularOutput', 'position': [x + 600, y + 180], 'credentials': PROD_JWT, 'parameters': {'operation': 'verify', 'token': '={{ $json.token }}', 'options': {'algorithm': 'RS256'}}},
        {'id': ident(), 'name': n('Verify Development'), 'type': 'n8n-nodes-base.jwt', 'typeVersion': 1, 'onError': 'continueRegularOutput', 'position': [x + 600, y + 340], 'credentials': DEV_JWT, 'parameters': {'operation': 'verify', 'token': '={{ $json.token }}', 'options': {'algorithm': 'RS256'}}},
        {'id': ident(), 'name': n('Check Access'), 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [x + 800, y + 260], 'parameters': {'mode': 'runOnceForAllItems', 'jsCode': check}},
        {'id': ident(), 'name': n('Allowed?'), 'type': 'n8n-nodes-base.if', 'typeVersion': 2.2, 'position': [x + 1000, y + 260], 'parameters': cond('ok', '={{ String($json.ok) }}', 'true')},
        {'id': ident(), 'name': n('Pass Request'), 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [x + 1200, y + 180], 'parameters': {'mode': 'runOnceForAllItems', 'jsCode': f"return $('{name}').all();"}},
        {'id': ident(), 'name': n('Deny'), 'type': 'n8n-nodes-base.respondToWebhook', 'typeVersion': 1.5, 'position': [x + 1200, y + 340], 'parameters': {'respondWith': 'json', 'responseBody': '={{ JSON.stringify({ ok: false, error: $json.error }) }}', 'options': {'responseCode': '={{ $json.status }}'}}},
    ]
    return nodes, n


def gate(workflow, suffix=None):
    nodes = list(workflow['nodes'])
    connections = dict(workflow['connections'])
    if any(node['name'].endswith(MARK) for node in nodes):
        raise SystemExit(f"{workflow['id']} is already gated")
    for hook in [node for node in nodes if node['type'] == 'n8n-nodes-base.webhook']:
        if hook['parameters'].get('responseMode') != 'responseNode':
            raise SystemExit(f"{workflow['id']} {hook['name']}: respond mode is not responseNode")
        if suffix:
            hook['parameters']['path'] = hook['parameters']['path'] + suffix
            hook.pop('webhookId', None)
        x, y = hook['position']
        added, n = gate_nodes(hook, x, y)
        nodes += added
        downstream = connections.get(hook['name'], {'main': [[]]})
        connections[hook['name']] = {'main': [[{'node': n('Read Session'), 'type': 'main', 'index': 0}]]}
        link = lambda target: [{'node': target, 'type': 'main', 'index': 0}]
        connections[n('Read Session')] = {'main': [link(n('Production Session?'))]}
        connections[n('Production Session?')] = {'main': [link(n('Verify Production')), link(n('Verify Development'))]}
        connections[n('Verify Production')] = {'main': [link(n('Check Access'))]}
        connections[n('Verify Development')] = {'main': [link(n('Check Access'))]}
        connections[n('Check Access')] = {'main': [link(n('Allowed?'))]}
        connections[n('Allowed?')] = {'main': [link(n('Pass Request')), link(n('Deny'))]}
        connections[n('Pass Request')] = downstream
    return {'name': workflow['name'], 'nodes': nodes, 'connections': connections, 'settings': {k: v for k, v in workflow.get('settings', {}).items() if k in ('executionOrder', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'saveManualExecutions', 'timezone', 'errorWorkflow')}}


def main():
    command, *args = sys.argv[1:]
    if command == 'apply':
        os.makedirs('/tmp/k1gate', exist_ok=True)
        for wid in args:
            workflow = request('GET', f'/workflows/{wid}')
            json.dump(workflow, open(f'/tmp/k1gate/{wid}.backup.json', 'w'))
            request('PUT', f'/workflows/{wid}', gate(workflow))
            request('POST', f'/workflows/{wid}/activate')
            print('gated', wid, workflow['name'])
    elif command == 'clone':
        wid, suffix = args
        body = gate(request('GET', f'/workflows/{wid}'), suffix)
        body['name'] = body['name'] + ' (gate test)'
        created = request('POST', '/workflows', body)
        request('POST', f"/workflows/{created['id']}/activate")
        print(created['id'])
    elif command == 'delete':
        request('POST', f'/workflows/{args[0]}/deactivate')
        request('DELETE', f'/workflows/{args[0]}')
        print('deleted', args[0])


if __name__ == '__main__':
    main()
