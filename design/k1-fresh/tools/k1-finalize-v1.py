"""Save validated K1 conversation config as the sole version 1 and clear test chats.

Only run after the n8n agent was promoted and the 200-case regression passed.
This explicitly resets saved test conversations and deploy requests; existing real
staging bookings are NOT touched by the versions reset RPC.
"""
import importlib.util
import json

spec = importlib.util.spec_from_file_location('maint', __file__.replace('k1-finalize-v1.py', 'k1-scoped-maintenance.py'))
maint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(maint)
gate = maint.gate
AGENT = 'w8a9S1uxB5U9qnNO'
EXPECTED_WORKFLOW_VERSION = '84e6bb3d-027e-4957-ac69-684298d4c641'
EXPECTED_CURRENT_VERSION = 'e10c9ecb-a60b-4cab-971d-9582e28e4a19'
TENANT = 'k1_katsastus_demo'


def state():
    _, status, raw = maint.invoke('state', {'p_tenant_key': TENANT, 'p_include_prompts': True})
    if status != 200:
        raise RuntimeError(f'state query failed: HTTP {status}')
    return json.loads(raw)


def invoke_exact(op, data):
    _, status, raw = maint.invoke(op, data)
    if status != 200:
        raise RuntimeError(f'{op} failed: HTTP {status}: {raw[:400]}')
    return json.loads(raw)


def main():
    workflow = gate.request('GET', f'/workflows/{AGENT}')
    if not workflow['active'] or workflow['versionId'] != EXPECTED_WORKFLOW_VERSION:
        raise RuntimeError('agent workflow changed; refuse to reset history')
    prompt = next(a['value'] for a in next(n for n in workflow['nodes'] if n['name'] == '⚙️ CONFIG')['parameters']['assignments']['assignments'] if a['name'] == 'business_prompt')
    if not prompt.startswith('## CONVERSATIONAL K1 BEHAVIOUR') or 'Real tool rules:' not in prompt:
        raise RuntimeError('agent prompt is not the validated safety + style hybrid')
    current = state()
    if current['liveVersionId'] is not None or current['deployRequests']:
        raise RuntimeError('deployment state changed; refuse destructive reset')
    # The RPC may commit before an HTTP response is shaped. Resume from a
    # verified v3 rather than creating another version on retry.
    already_saved = len(current['versions']) == 3 and current['versions'][0]['versionNumber'] == 3
    if already_saved:
        if (current['versions'][0]['masterPrompt'] != prompt
            or not current['versions'][0]['openingMessage'].startswith("Hi! It's K1 Katsastus.")):
            raise RuntimeError('unexpected v3; refuse destructive reset')
        latest = current['versions'][1]
    elif (current['activeVersionId'] == EXPECTED_CURRENT_VERSION and len(current['versions']) == 2
          and current['versions'][0]['id'] == EXPECTED_CURRENT_VERSION):
        latest = current['versions'][0]
    else:
        raise RuntimeError('saved versions changed; refuse destructive reset')
    translations = latest['translations']
    translations['fi']['opener'] = 'Hei! Täällä K1 Katsastus. Autosi {{registration_number}} katsastusaika lähestyy. Haluatko, että etsin sinulle sopivan ajan?'
    translations['sv']['opener'] = 'Hej! Det är K1 Katsastus. Det är snart dags att besikta bilen {{registration_number}}. Vill du att jag hjälper dig hitta en tid?'
    # These openers ask exactly one question and don't claim a station-specific booking.
    input = {
        'p_tenant_key': TENANT,
        'p_master_prompt': prompt,
        'p_opening_message': "Hi! It's K1 Katsastus. Your car {{registration_number}} is due for inspection soon. Want me to find a time that works for you?",
        'p_additional_information': 'Only two stations are supported on Muster staging: Palokka (256) and Itäharju (241). Use the verified business rules above; do not quote prices or confirm bookings without live tool results.',
        'p_locked': True,
        'p_note': 'Approved WF-2 conversational K1 staging baseline — 200-case safety validation',
        'p_saved_by': 'Wasup handoff',
        'p_reminders': latest['reminders'],
        'p_translations': translations,
    }
    if not already_saved:
        invoke_exact('save', input)
    before_reset = state()
    if (len(before_reset['versions']) != 3 or before_reset['versions'][0]['versionNumber'] != 3
        or before_reset['versions'][0]['masterPrompt'] != prompt
        or before_reset['versions'][0]['openingMessage'] != input['p_opening_message']):
        raise RuntimeError('saved prompt not active; refuse reset')
    saved_id = before_reset['versions'][0]['id']
    result = invoke_exact('reset_versions', {'p_tenant_key': TENANT})
    after = state()
    if (len(after['versions']) != 1 or after['versions'][0]['versionNumber'] != 1
        or after['versions'][0]['id'] != saved_id or after['versions'][0]['masterPrompt'] != prompt
        or after['versions'][0]['openingMessage'] != input['p_opening_message'] or after['liveVersionId'] is not None):
        raise RuntimeError('post-reset state mismatch; investigate immediately')
    print(json.dumps({'activeVersionId': after['activeVersionId'], 'versionNumber': after['versions'][0]['versionNumber'],
        'locked': after['locked'], 'removedVersions': result['removedVersions'], 'removedChats': result['removedChats'],
        'removedRequests': result['removedRequests'], 'liveVersionId': after['liveVersionId'],
        'openerLanguages': list(after['versions'][0]['translations'])}))


if __name__ == '__main__':
    main()
