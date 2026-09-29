"""Promote a previously validated K1 conversation variant without replacing tools.

Guards exact source version and node wiring. Preserves existing webhook IDs,
auth checks, booking tools, inbound debounce/typing chain, and credentials.
Use the scoped maintenance helper separately for builder version persistence.
"""
import importlib.util
import json
import uuid

spec = importlib.util.spec_from_file_location('eval', __file__.replace('k1-promote-conversation.py', 'muster-conversation-eval.py'))
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)
gate = evaluation.gate

WORKFLOW_ID = evaluation.SOURCE
EXPECTED_VERSION = '95ae3e4f-c08e-477e-8fa7-f43a3dfa020b'
OLD_KEY = "'k1_katsastus_demo_' + phone.replace(/\\D/g, '')"
NEW_KEY = "'k1_katsastus_demo_' + phone.replace(/\\D/g, '') + '_chat_' + String(body.conversationId || '').replace(/[^a-zA-Z0-9-]/g, '')"
OLD_RECORD = '(Array.isArray($("AI Agent").first().json.output.messages) ? $("AI Agent").first().json.output.messages : []).join("\\n\\n")'


def updated(workflow):
    if workflow['id'] != WORKFLOW_ID or workflow['versionId'] != EXPECTED_VERSION or not workflow['active']:
        raise RuntimeError('workflow changed since validation; re-run the tests before promotion')
    assert not any(node['name'] == 'Normalize playground reply' for node in workflow['nodes'])
    evaluation.blend(workflow)
    turn = next(node for node in workflow['nodes'] if node['name'] == 'Playground Turn')
    source = turn['parameters']['jsCode']
    assert source.count(OLD_KEY) == 1
    turn['parameters']['jsCode'] = source.replace(OLD_KEY, NEW_KEY)
    assert 'conversationId' in turn['parameters']['jsCode']
    normalizer = {'id': str(uuid.uuid4()), 'name': 'Normalize playground reply', 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
        'position': [-2650, 720], 'parameters': {'mode': 'runOnceForAllItems', 'jsCode': evaluation.NORMALIZE_REPLY_JS}}
    workflow['nodes'].append(normalizer)
    connection = workflow['connections']['Playground call?']['main'][0]
    assert len(connection) == 1 and connection[0]['node'] == 'Record playground turn'
    workflow['connections']['Playground call?']['main'][0] = [{'node': normalizer['name'], 'type': 'main', 'index': 0}]
    workflow['connections'][normalizer['name']] = {'main': [[{'node': 'Record playground turn', 'type': 'main', 'index': 0}]]}
    record = next(node for node in workflow['nodes'] if node['name'] == 'Record playground turn')
    old_body = record['parameters']['jsonBody']
    assert old_body.count(OLD_RECORD) == 1
    record['parameters']['jsonBody'] = old_body.replace(OLD_RECORD, '$("Normalize playground reply").first().json.reply')
    reply = next(node for node in workflow['nodes'] if node['name'] == 'Playground reply')
    old_reply = "  reply: messages.join('\\n\\n'),"
    assert reply['parameters']['jsCode'].count(old_reply) == 1
    reply['parameters']['jsCode'] = reply['parameters']['jsCode'].replace(old_reply,
        "  reply: $('Normalize playground reply').first().json.reply,")
    for node in workflow['nodes']:
        if node['name'] == 'Playground':
            assert node['parameters']['path'] == 'k1-agent-builder/booking-chat' and node.get('webhookId')
        if node['name'] == 'Webhook':
            assert node['parameters']['path'] == 'k1-muster-agent-inbound' and node.get('webhookId')
    return workflow


def main():
    original = gate.request('GET', f'/workflows/{WORKFLOW_ID}')
    changed = updated(original)
    payload = {key: changed[key] for key in ('name', 'nodes', 'connections', 'settings')}
    result = gate.request('PUT', f'/workflows/{WORKFLOW_ID}', payload)
    verified = gate.request('GET', f'/workflows/{WORKFLOW_ID}')
    assert verified['active'] and len(verified['nodes']) == len(original['nodes'])
    assert 'CONVERSATIONAL K1 BEHAVIOUR' in next(a['value'] for a in next(n for n in verified['nodes'] if n['name'] == '⚙️ CONFIG')['parameters']['assignments']['assignments'] if a['name'] == 'business_prompt')
    assert 'Normalize playground reply' in verified['connections']
    print(json.dumps({'workflowId': verified['id'], 'versionId': verified['versionId'], 'active': verified['active'], 'updated': result.get('updatedAt')}))


if __name__ == '__main__':
    main()
