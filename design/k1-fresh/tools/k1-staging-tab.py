#!/usr/bin/env python3
"""Staging tab on the live K1 WhatsApp number.

Patches the live listener so only phones sent from the Staging page use a saved
version, Stripe test checkout, and CTA buttons. Every other customer stays on
the current live path. The inactive workflow "K1 v10 staging" is not activated.

  python3 k1-staging-tab.py dry     patch the newest backups in memory
  python3 k1-staging-tab.py apply   back up, migrate, and update the live workflows

Sessions live in the agent database (v2back-working). The builder project has no
postgres credential this listener can use, so supabase/k1-agent-builder-007-staging.sql
stays in the repo and is not executed here. Applying that file later does not
switch the listener over.

The n8n API key is read the same way as n8n-gate.py. It is never printed.
"""
import importlib.util
import json
import re
import time
import uuid
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
BACKUPS = ROOT / 'backups'
LIVE_AGENT = 'w8a9S1uxB5U9qnNO'
LIVE_BOOKING = 'wAE7EHLyJk6JsMue'
INACTIVE_STAGING = 'q0Dykjr5jVmTFpEa'
TEST_CHATS = 'Huk3NIxdfcjVvb7c'
PAYMENT_ID = '8vPSqe8SxZDRXJXb'
PAYMENT_NAME = 'K1 v10 payment'
SEND_NAME = 'K1 staging send'
SEND_PATH = 'k1-agent-builder/staging-send'
INSTANCE = 'wa_mt1j5bcl_sch23'
SUPABASE = {'supabaseApi': {'id': 'sKZQDTU3b68ZSLwX', 'name': 'K1 Agent builder DB'}}
WASUP = {'wasupApi': {'id': 'SW7J0tWGyyYAPdkN', 'name': 'Wasup Account'}}
POSTGRES = {'postgres': {'id': 'OFlPRP5F4peeJpaM', 'name': 'v2back-working'}}
RPC = 'https://wuejgskyjzuffqsgvunp.supabase.co/rest/v1/rpc/'
AGENT_DIGITS = "{{ String($('Webhook').first().json.body.from_phone || '').replace(/\\D/g, '') }}"
SETTINGS_KEEP = ('executionOrder', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'saveManualExecutions', 'timezone', 'errorWorkflow')
BRIEF = "{{ $('⚙️ CONFIG').first().json.business_prompt }}"
BRIEF_STAGING = "{{ ($('Build Turn').isExecuted && $('Build Turn').first().json.staging_prompt) ? $('Build Turn').first().json.staging_prompt : $('⚙️ CONFIG').first().json.business_prompt }}"
MEMORY = "={{ $('Playground Turn').isExecuted ? $('Playground Turn').first().json.session_key : (($('Build Turn').isExecuted && $('Build Turn').first().json.staging_session_key) || ($('⚙️ CONFIG').first().json.tenant_key + '_' + $('Webhook').first().json.body.from_phone)) }}"
SOURCE = "={{ ($('Build Turn').isExecuted && $('Build Turn').first().json.staging) ? 'whatsapp' : '' }}"

spec = importlib.util.spec_from_file_location('gate', HERE / 'n8n-gate.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

CTA_JS = r"""const URL_RE = /https?:\/\/[^\s<>)]+/gi
function decorate(item) {
  const text = String(item.text || '')
  if (item.staging !== true) return { ...item, cta_url: '', cta_label: '', cta_body: text }
  const urls = text.match(URL_RE) || []
  const raw = urls.length === 1 ? urls[0] : ''
  const only = raw.replace(/[.,;:!?]+$/g, '')
  const payment = /https?:\/\/(?:buy|checkout)\.stripe\.com/i.test(only)
  const booking = /https?:\/\/(?:www\.)?(?:ajanvaraus\.)?k1katsastus\.fi/i.test(only)
  if (!(payment || booking)) return { ...item, cta_url: '', cta_label: '', cta_body: text }
  const body = text.replace(raw, ' ').replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim()
  return {
    ...item,
    cta_url: only,
    cta_label: (payment ? 'Maksa nyt' : 'Varaa aika').slice(0, 25),
    cta_body: body || (payment ? 'Maksa katsastuksen perushinta tästä.' : 'Varaa aika tästä.'),
  }
}
return $input.all().map((row) => ({ json: decorate(row.json) }))
"""

NOTE_HELPERS = r"""
const WHATSAPP_NOTE = 'Varattu WhatsApp-botin kautta'
const fromWhatsApp = () => /whatsapp/i.test(String(body.source || body.channel || ''))
async function postReservation(payload) {
  const note = payload.additionalInformation
  if (!note) return muster('POST', '/Reservations', payload)
  const withNote = { ...payload }
  delete withNote.additionalInformation
  withNote.reservations = (payload.reservations || []).map((row) => ({
    ...row,
    additionalInformation: row.additionalInformation || note,
    meta: { ...(row.meta || {}), additionalInformation: (row.meta && row.meta.additionalInformation) || note },
  }))
  const reserved = await muster('POST', '/Reservations', withNote)
  if (reserved.status === 200) return reserved
  const plain = { ...payload }
  delete plain.additionalInformation
  return muster('POST', '/Reservations', plain)
}
"""

# n8n's Postgres node reads $ plus digits as a query parameter. A dollar quote
# around a phone or a uuid starts with that pattern ($447835156367, $4111…),
# and a real phone number is past the node's $100000 limit, so the insert
# never runs. Quote with escaped single quotes, and spell a literal $ before
# a digit as chr(36).
DOLLAR_JS = r"""function dollar(value) {
  const raw = String(value ?? '')
  return raw.split(/(\$\d+)/).map((piece) => {
    if (/^\$\d+$/.test(piece)) return "chr(36) || '" + piece.slice(1).replace(/'/g, "''") + "'"
    return "'" + piece.replace(/'/g, "''") + "'"
  }).join(' || ')
}
"""

OLD_DOLLAR = (
    "function dollar(value) {\n"
    "  const text = String(value ?? '')\n"
    "  let tag = 'stg'\n"
    "  while (text.includes('$' + tag + '$')) tag += 'x'\n"
    "  return '$' + tag + '$' + text + '$' + tag + '$'\n"
    "}\n"
)


def quote_records(nodes):
    """Replace dollar-quoting that n8n Postgres treats as a parameter index."""
    for item in nodes:
        if item['name'] not in ('Prepare staging record', 'Prepare staging follow-up'):
            continue
        code = item['parameters'].get('jsCode') or ''
        if OLD_DOLLAR in code:
            item['parameters']['jsCode'] = code.replace(OLD_DOLLAR, DOLLAR_JS, 1)


# Wasup refuses sendText when the chat has no privacy token (via cold-blocked) and
# never starts the typing indicator. The flag is not a sendText field on this node,
# so the reply goes out through sendRaw, which accepts allowColdWithoutToken and
# still asks for typingSimulation.
SEND_RAW = {
    'Send Bubble': "={{ JSON.stringify({ to: $json.to_phone, message: $json.text, linkPreview: false, allowColdWithoutToken: true, typingSimulation: true, delayEnabled: true }) }}",
    'Send Double-Text': "={{ JSON.stringify({ to: $json.to_phone, message: $json.text, linkPreview: false, allowColdWithoutToken: true, typingSimulation: true, delayEnabled: true }) }}",
    'Send Reset Notice': "={{ JSON.stringify({ to: $('Webhook').first().json.body.from_phone, message: 'Conversation RESET (' + DateTime.now().toFormat('HH:mm:ss') + ')', linkPreview: false, allowColdWithoutToken: true, typingSimulation: true, delayEnabled: true }) }}",
    'Send Bubble CTA': "={{ JSON.stringify({ to: $json.to_phone, text: $json.cta_body, ctaUrl: $json.cta_url ? { url: $json.cta_url, label: $json.cta_label } : undefined, linkPreview: false, allowColdWithoutToken: true, typingSimulation: true, delayEnabled: true }) }}",
    'Send Double-Text CTA': "={{ JSON.stringify({ to: $json.to_phone, text: $json.cta_body, ctaUrl: $json.cta_url ? { url: $json.cta_url, label: $json.cta_label } : undefined, linkPreview: false, allowColdWithoutToken: true, typingSimulation: true, delayEnabled: true }) }}",
}


REPLY_HEAD_OLD = """SELECT
  COALESCE(
    (SELECT last_inbound_message_id FROM conversation_state WHERE session_key = '{{ $json.session_key }}')
    IS DISTINCT FROM '{{ $json.anchor_message_id }}', TRUE
  ) AS user_replied,"""

REPLY_HEAD_NEW = """SELECT
  EXISTS (
    SELECT 1 FROM inbound_message_queue q
    WHERE regexp_replace(q.from_phone, '\\D', '', 'g') = regexp_replace('{{ $json.to_phone }}', '\\D', '', 'g')
      AND q.message_id IS DISTINCT FROM '{{ $json.anchor_message_id }}'
      AND length(trim(coalesce(q.message, ''))) > 0
  ) AS user_replied,"""

REPLY_CHECK_NODES = ('User Replied?', 'Did They Reply?', 'Last Check Before Chase')


def keep_replies(nodes):
    """A receipt must not cancel the answer.

    The old check treated any new id on the chat as "the customer spoke again"
    and then dropped the bubble. Delivery receipts do that during the model
    call, so the reply was saved and never sent. Skip only when a newer
    non-empty customer text is actually waiting in the queue. The same check
    guards the live send and the follow-up chase.
    """
    named = {item['name']: item for item in nodes}
    for name in REPLY_CHECK_NODES:
        node = named.get(name)
        if not node:
            continue
        query = node['parameters'].get('query') or ''
        if REPLY_HEAD_OLD in query:
            node['parameters']['query'] = query.replace(REPLY_HEAD_OLD, REPLY_HEAD_NEW, 1)


def arm_sends(nodes):
    for item in nodes:
        raw = SEND_RAW.get(item['name'])
        if not raw:
            continue
        params = item['parameters']
        params['resource'] = 'message'
        params['operation'] = 'sendRaw'
        params['rawBody'] = raw


PREPARE_RECORD = DOLLAR_JS + r"""const turn = $('Build Turn').first().json || {}
const out = $('AI Agent').first().json.output || {}
const msgs = Array.isArray(out.messages) ? out.messages : []
const agent = msgs.map((item) => String(item || '').trim()).filter(Boolean).join('\n\n')
const id = String(turn.staging_conversation_id || '')
if (!turn.staging || !agent || !/^[0-9a-f-]{36}$/i.test(id)) return [{ json: { skip: true } }]
const quoted = dollar(id)
const query = `with ins_user as (
  insert into k1_staging_messages (conversation_id, role, text, is_opener)
  values (${quoted}::uuid, 'user', ${dollar(String(turn.raw_text || ''))}, false) returning 1
), ins_agent as (
  insert into k1_staging_messages (conversation_id, role, text, is_opener)
  values (${quoted}::uuid, 'agent', ${dollar(agent)}, false) returning 1
), touched as (
  update k1_staging_conversations set updated_at = now() where id = ${quoted}::uuid returning 1
)
select (select count(*) from ins_user) + (select count(*) from ins_agent) + (select count(*) from touched) as saved`
return [{ json: { skip: false, query } }]
"""

PREPARE_FOLLOWUP = DOLLAR_JS + r"""const turn = $('Build Turn').first().json || {}
const id = String(turn.staging_conversation_id || '')
if (!/^[0-9a-f-]{36}$/i.test(id)) return [{ json: { query: 'select 1 as saved' } }]
const quoted = dollar(id)
const query = `with ins as (
  insert into k1_staging_messages (conversation_id, role, text, is_opener)
  values (${quoted}::uuid, 'agent', ${dollar(String($json.text || ''))}, false) returning 1
), touched as (
  update k1_staging_conversations set updated_at = now() where id = ${quoted}::uuid returning 1
)
select (select count(*) from ins) + (select count(*) from touched) as saved`
return [{ json: { query } }]
"""

PARSE_STAGING = r"""const row = $input.first().json || {}
let staging = row.staging
if (typeof staging === 'string') {
  try { staging = JSON.parse(staging) } catch (error) { staging = null }
}
if (!staging || staging.found !== true) staging = { found: false }
return [{ json: { staging } }]
"""

MERGE_STAGING = r"""const drain = $('Drain Queue').first().json || {}
const parsed = $('Parse Staging').first().json.staging || { found: false }
if (parsed.found !== true) return [{ json: { ...drain, staging: null } }]
let version = $('Fetch staging version').isExecuted ? ($('Fetch staging version').first().json || {}) : {}
if (Array.isArray(version)) version = version[0] || {}
const prompt = [version.masterPrompt, version.additionalInformation, parsed.leadContext].filter((part) => String(part || '').trim()).join('\n\n')
return [{ json: { ...drain, staging: {
  found: true,
  prompt,
  versionNumber: parsed.versionNumber || version.versionNumber || null,
  conversationId: String(parsed.conversationId || ''),
  versionId: String(parsed.versionId || ''),
  leadContext: String(parsed.leadContext || ''),
} } }]
"""

LOAD_SQL = (
    "select coalesce(("
    " select json_build_object("
    " 'found', true,"
    " 'phone', s.phone,"
    " 'phoneKey', s.phone_key,"
    " 'versionId', s.version_id,"
    " 'versionNumber', s.version_number,"
    " 'conversationId', s.conversation_id::text,"
    " 'leadContext', s.lead_context)"
    " from k1_staging_sessions s"
    f" where s.phone_key = '{AGENT_DIGITS}'"
    "), '{\"found\":false}'::json) as staging"
)

RESET_AGENT_SQL = f"""with rotated as (
  update k1_staging_sessions
  set conversation_id = gen_random_uuid(), updated_at = now()
  where phone_key = '{AGENT_DIGITS}'
  returning *
), copied as (
  insert into k1_staging_conversations (id, phone_key, phone, version_id, version_number, title, started_by)
  select r.conversation_id, r.phone_key, r.phone, r.version_id, r.version_number,
         left(trim(r.phone || ' · ' || coalesce(r.lead->>'plateNumber', '')), 140),
         r.started_by
  from rotated r
  returning id
)
select coalesce((select r.conversation_id::text from rotated r), '') as conversation_id,
       (select count(*) from copied) as copied"""

LIST_CHATS_SQL = """select coalesce((
  select json_agg(json_build_object(
    'id', c.id,
    'version_id', c.version_id,
    'version_number', c.version_number,
    'is_draft', false,
    'source', 'staging',
    'title', c.title,
    'started_by', c.started_by,
    'created_at', c.created_at,
    'updated_at', c.updated_at,
    'message_count', (select count(*) from k1_staging_messages m where m.conversation_id = c.id and not m.is_opener),
    'thumbs_up', 0,
    'thumbs_down', 0,
    'last_reply', coalesce((select m.text from k1_staging_messages m where m.conversation_id = c.id and m.role = 'agent' and not m.is_opener order by m.created_at desc limit 1), ''),
    'texts', coalesce((select json_agg(m.text) from k1_staging_messages m where m.conversation_id = c.id), '[]'::json)
  ) order by c.updated_at desc)
  from k1_staging_conversations c
), '[]'::json) as rows"""

LIST_SESSIONS_SQL = """select coalesce((
  select json_agg(json_build_object(
    'phone', s.phone,
    'phoneKey', s.phone_key,
    'plate', coalesce(s.lead->>'plateNumber', ''),
    'stationName', coalesce(s.lead->>'stationName', ''),
    'versionId', s.version_id,
    'versionNumber', s.version_number,
    'conversationId', s.conversation_id,
    'updatedAt', s.updated_at
  ) order by s.updated_at desc)
  from k1_staging_sessions s
), '[]'::json) as sessions"""

SHAPE_STAGING_JS = r"""function rowsOf(raw) {
  if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch (error) { raw = [] } }
  return Array.isArray(raw) ? raw : []
}
function shapeStaging(filters, raw) {
  const versions = Array.isArray(filters.p_versions) ? filters.p_versions.map((value) => Number(value)) : null
  const query = String(filters.p_query || '').toLowerCase()
  return rowsOf(raw).map((row) => {
    let texts = row.texts || []
    if (typeof texts === 'string') { try { texts = JSON.parse(texts) } catch (error) { texts = [] } }
    return {
      id: row.id,
      versionId: row.version_id,
      versionNumber: row.version_number == null ? null : Number(row.version_number),
      isDraft: false,
      source: 'staging',
      title: row.title || '',
      startedBy: row.started_by || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: Number(row.message_count || 0),
      thumbsUp: 0,
      thumbsDown: 0,
      lastReply: row.last_reply || '',
      texts: Array.isArray(texts) ? texts : [],
    }
  }).filter((item) => {
    if (versions && versions.length && !versions.includes(Number(item.versionNumber))) return false
    if (filters.p_feedback === 'up' || filters.p_feedback === 'down') return false
    if (filters.p_from && String(item.updatedAt) < String(filters.p_from)) return false
    if (filters.p_to && String(item.updatedAt) >= String(filters.p_to)) return false
    if (query && ![item.title, ...(item.texts || [])].join('\n').toLowerCase().includes(query)) return false
    return true
  }).map(({ texts, ...item }) => item)
}
"""

STORE_SQL = r"""
create table if not exists k1_staging_sessions (
  phone_key text primary key,
  phone text not null,
  version_id text,
  version_number integer,
  conversation_id uuid not null,
  lead jsonb not null default '{}'::jsonb,
  lead_context text not null default '',
  opener text not null default '',
  started_by text,
  updated_at timestamptz not null default now()
);
create table if not exists k1_staging_conversations (
  id uuid primary key,
  phone_key text not null,
  phone text not null,
  version_id text,
  version_number integer,
  title text not null default '',
  started_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists k1_staging_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  role text not null,
  text text not null,
  is_opener boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists k1_staging_conversations_phone_idx on k1_staging_conversations (phone_key, updated_at desc);
create index if not exists k1_staging_messages_conversation_idx on k1_staging_messages (conversation_id, created_at);
do $$
declare
  before_id uuid := gen_random_uuid();
  after_id uuid;
  kept integer;
begin
  insert into k1_staging_sessions (phone_key, phone, version_id, version_number, conversation_id, lead, lead_context, opener)
  values ('000000000099', '+000000000099', '4111ac82-461f-4ede-95c4-c05e2f08626d', 11, before_id, '{"plateNumber":"SMOKE"}'::jsonb, 'ctx', 'hei');
  insert into k1_staging_conversations (id, phone_key, phone, version_id, version_number, title)
  values (before_id, '000000000099', '+000000000099', '4111ac82-461f-4ede-95c4-c05e2f08626d', 11, 'smoke');
  insert into k1_staging_messages (conversation_id, role, text, is_opener)
  values (before_id, 'agent', 'hei', true);
  update k1_staging_sessions
  set conversation_id = gen_random_uuid(), updated_at = now()
  where phone_key = '000000000099'
  returning conversation_id into after_id;
  select version_number into kept from k1_staging_sessions where phone_key = '000000000099';
  if kept <> 11 or after_id is null or after_id = before_id then
    raise exception 'staging session smoke failed';
  end if;
  delete from k1_staging_messages where conversation_id in (select id from k1_staging_conversations where phone_key = '000000000099');
  delete from k1_staging_conversations where phone_key = '000000000099';
  delete from k1_staging_sessions where phone_key = '000000000099';
end $$;
select 'ok' as status, (select count(*) from k1_staging_sessions where phone_key = '000000000099') as leftover;
"""

BUILD_TURN_OLD = """const languageHint = detectLanguage(text)
const agent_input = [
  '[TURN]',
  'turn_type: user_message',"""

BUILD_TURN_NEW = """const languageHint = detectLanguage(text)
const stagingSession = row.staging && row.staging.found ? row.staging : null
const stagingDigits = String(wh.from_phone || '').replace(/\\D/g, '')
const agent_input = [
  '[TURN]',
  'turn_type: user_message',
  stagingSession ? `staging_version: v${stagingSession.versionNumber}` : null,
  stagingSession && stagingSession.leadContext ? stagingSession.leadContext : null,"""

RETURN_OLD = """return [{ json: {
  agent_input, is_reset,
  session_key: `${cfg.tenant_key}_${wh.from_phone}`,"""

RETURN_NEW = """return [{ json: {
  agent_input, is_reset,
  staging: Boolean(stagingSession),
  staging_prompt: stagingSession ? String(stagingSession.prompt || '') : '',
  staging_session_key: stagingSession ? `${cfg.tenant_key}_${stagingDigits}_staging_${stagingSession.conversationId}` : '',
  staging_conversation_id: stagingSession ? String(stagingSession.conversationId || '') : '',
  staging_version_id: stagingSession ? String(stagingSession.versionId || '') : '',
  session_key: `${cfg.tenant_key}_${wh.from_phone}`,"""

PLAN_OLD = """const base = {
  to_phone: wh.from_phone,
  session_key: `${cfg.tenant_key}_${wh.from_phone}`,"""

PLAN_NEW = """const base = {
  to_phone: wh.from_phone,
  staging: turn.staging === true,
  session_key: `${cfg.tenant_key}_${wh.from_phone}`,"""

FOLLOW_OLD = 'return [{ json: { ...ctx, text, delay_seconds: d,'
FOLLOW_NEW = "return [{ json: { ...ctx, text, staging: $('Build Turn').isExecuted && $('Build Turn').first().json.staging === true, delay_seconds: d,"

RESERVE_OLD = "const reserved = await muster('POST', '/Reservations', {\n    groupId:"
RESERVE_NEW = "const reserved = await postReservation({\n    ...(fromWhatsApp() ? { additionalInformation: WHATSAPP_NOTE } : {}),\n    groupId:"


def must_replace(text, old, new, label, count=1):
    found = text.count(old)
    if found != count:
        raise SystemExit(f'{label}: expected {count} occurrence(s), found {found}')
    return text.replace(old, new)


def node(name, kind, version, position, parameters, credentials=None, extra=None):
    item = {'id': str(uuid.uuid4()), 'name': name, 'type': kind, 'typeVersion': version, 'position': position, 'parameters': parameters}
    if credentials:
        item['credentials'] = credentials
    if extra:
        item.update(extra)
    return item


def equals_if(left, right):
    return {
        'conditions': {
            'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2},
            'conditions': [{'id': str(uuid.uuid4()), 'leftValue': left, 'rightValue': right, 'operator': {'type': 'string', 'operation': 'equals'}}],
            'combinator': 'and',
        },
        'looseTypeValidation': True,
        'options': {},
    }


def http_rpc(name, fn, body, position):
    return node(name, 'n8n-nodes-base.httpRequest', 4.2, position, {
        'method': 'POST', 'url': RPC + fn, 'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'supabaseApi',
        'sendBody': True, 'specifyBody': 'json', 'jsonBody': body, 'options': {'timeout': 15000},
    }, SUPABASE, {'onError': 'continueRegularOutput'})


def pg(name, query, position):
    return node(name, 'n8n-nodes-base.postgres', 2.6, position, {
        'operation': 'executeQuery', 'query': query, 'options': {},
    }, POSTGRES, {'onError': 'continueRegularOutput'})


def point(connections, source, old, new, output=0):
    branch = connections[source]['main'][output]
    if any(link.get('node') == new for link in branch):
        return
    hit = False
    for link in branch:
        if link.get('node') == old:
            link['node'] = new
            hit = True
    if not hit:
        raise SystemExit(f'{source} output {output} does not point at {old}')


def link(target):
    return {'main': [[{'node': target, 'type': 'main', 'index': 0}]]}


def schema_entry(key):
    return {'id': key, 'displayName': key, 'type': 'string', 'display': True, 'required': False, 'defaultMatch': False, 'canBeUsedToMatch': True}


def add_cta(nodes, connections, send_name):
    send = next(item for item in nodes if item['name'] == send_name)
    prep_name = f'{send_name} CTA fields'
    if_name = f'{send_name} CTA?'
    button_name = f'{send_name} CTA'
    if any(item['name'] == prep_name for item in nodes):
        return
    x, y = send['position']
    nodes.extend([
        node(prep_name, 'n8n-nodes-base.code', 2, [x - 420, y], {'mode': 'runOnceForAllItems', 'jsCode': CTA_JS}),
        node(if_name, 'n8n-nodes-base.if', 2.2, [x - 200, y], {
            'conditions': {
                'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2},
                'conditions': [{'id': str(uuid.uuid4()), 'leftValue': '={{ $json.cta_url }}', 'rightValue': '', 'operator': {'type': 'string', 'operation': 'notEquals'}}],
                'combinator': 'and',
            },
            'looseTypeValidation': True, 'options': {},
        }),
        node(button_name, send['type'], send.get('typeVersion', 1), [x, y - 160], {
            'resource': 'message', 'operation': 'sendCta',
            'instanceId': json.loads(json.dumps(send['parameters']['instanceId'])),
            'to': send['parameters']['to'],
            'text': '={{ $json.cta_body }}', 'ctaUrl': '={{ $json.cta_url }}', 'ctaLabel': '={{ $json.cta_label }}',
        }, json.loads(json.dumps(send.get('credentials') or {}))),
    ])
    for outs in connections.values():
        for branches in outs.values():
            for branch in branches or []:
                for item in branch or []:
                    if item.get('node') == send_name:
                        item['node'] = prep_name
    downstream = json.loads(json.dumps(connections.get(send_name, {'main': [[]]})))
    connections[prep_name] = link(if_name)
    connections[if_name] = {'main': [[{'node': button_name, 'type': 'main', 'index': 0}], [{'node': send_name, 'type': 'main', 'index': 0}]]}
    connections[button_name] = downstream


def add_payment(nodes, connections, payment_id):
    named = {item['name']: item for item in nodes}
    name = 'create_payment_link'
    template = named['get_slots']
    if name not in named:
        item = json.loads(json.dumps(template))
        item.update({'id': str(uuid.uuid4()), 'name': name, 'position': [template['position'][0], template['position'][1] + 440]})
        nodes.append(item)
        named[name] = item
        connections[name] = {'ai_tool': [[{'node': 'AI Agent', 'type': 'ai_tool', 'index': 0}]]}
    tool = named[name]
    phone = template['parameters']['workflowInputs']['value'].get('phone', '')
    value = {
        'phone': phone,
        'booking_number': "={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('booking_number', `The booking number returned by book_inspection_invite for the appointment just made.`, 'string') }}",
        'station_name': "={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('station_name', `The station name from that booking result.`, 'string') }}",
        'when_text': "={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('when_text', `Weekday, date and time of that booking, as confirmed to the customer.`, 'string') }}",
        'language': "={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('language', `fi, sv or en, the language of this chat.`, 'string') }}",
    }
    tool['parameters']['name'] = name
    tool['parameters']['description'] = (
        'The 34 euro Stripe test checkout url for a booking already made in this chat. Call it only after the customer chooses to pay now. '
        'Pass the booking number, station name and the confirmed weekday, date and time. Returns url. '
        'Tell the customer it is 34 euros for the inspection base and that they can enter WASUP100 on that page. Measuring is still paid at the station. '
        'Do not call this for a customer who is not on a staging assignment.'
    )
    tool['parameters']['workflowId'] = {'__rl': True, 'value': payment_id, 'mode': 'id', 'cachedResultName': PAYMENT_NAME}
    tool['parameters']['workflowInputs'] = {
        'mappingMode': 'defineBelow', 'value': value, 'matchingColumns': [],
        'schema': [schema_entry(key) for key in value], 'attemptToConvertTypes': False, 'convertFieldsToString': True,
    }


def add_source(tool):
    value = tool['parameters']['workflowInputs']['value']
    value['source'] = SOURCE
    schema = tool['parameters']['workflowInputs'].setdefault('schema', [])
    if not any(entry.get('id') == 'source' for entry in schema):
        schema.append(schema_entry('source'))


def patch_agent(workflow, payment_id):
    nodes = json.loads(json.dumps(workflow['nodes']))
    connections = json.loads(json.dumps(workflow['connections']))
    named = {item['name']: item for item in nodes}
    turn = named['Build Turn']['parameters']
    if 'staging_session_key' not in turn['jsCode']:
        turn['jsCode'] = must_replace(turn['jsCode'], BUILD_TURN_OLD, BUILD_TURN_NEW, 'Build Turn language')
        turn['jsCode'] = must_replace(turn['jsCode'], RETURN_OLD, RETURN_NEW, 'Build Turn return')
    plan = named['Plan Delivery']['parameters']
    if 'staging: turn.staging' not in plan['jsCode']:
        plan['jsCode'] = must_replace(plan['jsCode'], PLAN_OLD, PLAN_NEW, 'Plan Delivery')
    follow = named['Plan Follow-up Delivery']['parameters']
    if 'staging:' not in follow['jsCode']:
        follow['jsCode'] = must_replace(follow['jsCode'], FOLLOW_OLD, FOLLOW_NEW, 'Plan Follow-up')
    for agent_name in ('AI Agent', 'Follow-up Agent'):
        message = named[agent_name]['parameters']['options']['systemMessage']
        if 'staging_prompt' not in message:
            named[agent_name]['parameters']['options']['systemMessage'] = must_replace(message, BRIEF, BRIEF_STAGING, agent_name)
    memory = named['Postgres Chat Memory']['parameters']
    if 'staging_session_key' not in memory['sessionKey']:
        memory['sessionKey'] = MEMORY
    purge = named['Purge Session']['parameters']
    if '_staging_%' not in purge['query']:
        purge['query'] += f"\nDELETE FROM chat_history WHERE session_id LIKE '{{{{ $('⚙️ CONFIG').first().json.tenant_key }}}}_{AGENT_DIGITS}_staging_%';\nSELECT 1 AS purged;"
    for tool_name in ('book_inspection_invite', 'reschedule_booking'):
        add_source(named[tool_name])
    add_payment(nodes, connections, payment_id)
    add_cta(nodes, connections, 'Send Bubble')
    add_cta(nodes, connections, 'Send Double-Text')
    names = {item['name'] for item in nodes}
    if 'Load Staging Session' not in names:
        drain = named['Drain Queue']['position']
        nodes.append(pg('Load Staging Session', LOAD_SQL, [drain[0] + 180, drain[1]]))
        nodes.append(node('Parse Staging', 'n8n-nodes-base.code', 2, [drain[0] + 380, drain[1]], {'mode': 'runOnceForAllItems', 'jsCode': PARSE_STAGING}))
        nodes.append(node('Staging assigned?', 'n8n-nodes-base.if', 2.2, [drain[0] + 580, drain[1]],
                          equals_if("={{ $json.staging && $json.staging.found === true ? 'yes' : 'no' }}", 'yes')))
        nodes.append(http_rpc('Fetch staging version', 'get_agent_builder_version',
                              "={{ { p_tenant_key: 'k1_katsastus_demo', p_version_id: $('Parse Staging').first().json.staging.versionId } }}",
                              [drain[0] + 780, drain[1] - 80]))
        nodes.append(node('Merge Staging', 'n8n-nodes-base.code', 2, [drain[0] + 980, drain[1]], {'mode': 'runOnceForAllItems', 'jsCode': MERGE_STAGING}))
        point(connections, 'Drain Queue', 'Build Turn', 'Load Staging Session')
        connections['Load Staging Session'] = link('Parse Staging')
        connections['Parse Staging'] = link('Staging assigned?')
        connections['Staging assigned?'] = {'main': [[{'node': 'Fetch staging version', 'type': 'main', 'index': 0}], [{'node': 'Merge Staging', 'type': 'main', 'index': 0}]]}
        connections['Fetch staging version'] = link('Merge Staging')
        connections['Merge Staging'] = link('Build Turn')
    if 'Staging turn?' not in names:
        spot = named['Plan Delivery']['position']
        nodes.append(node('Staging turn?', 'n8n-nodes-base.if', 2.2, [spot[0] - 520, spot[1] + 180],
                          equals_if("={{ $('Build Turn').isExecuted && $('Build Turn').first().json.staging ? 'yes' : 'no' }}", 'yes')))
        nodes.append(node('Prepare staging record', 'n8n-nodes-base.code', 2, [spot[0] - 300, spot[1] + 80], {'mode': 'runOnceForAllItems', 'jsCode': PREPARE_RECORD}))
        nodes.append(node('Record staging?', 'n8n-nodes-base.if', 2.2, [spot[0] - 80, spot[1] + 80], equals_if("={{ $json.skip ? 'skip' : 'save' }}", 'save')))
        nodes.append(pg('Record staging turn', '={{ $json.query }}', [spot[0] + 140, spot[1] + 80]))
        point(connections, 'Playground call?', 'Plan Delivery', 'Staging turn?', 1)
        connections['Staging turn?'] = {'main': [[{'node': 'Prepare staging record', 'type': 'main', 'index': 0}], [{'node': 'Plan Delivery', 'type': 'main', 'index': 0}]]}
        connections['Prepare staging record'] = link('Record staging?')
        connections['Record staging?'] = {'main': [[{'node': 'Record staging turn', 'type': 'main', 'index': 0}], [{'node': 'Plan Delivery', 'type': 'main', 'index': 0}]]}
        connections['Record staging turn'] = link('Plan Delivery')
    if 'Staging follow-up?' not in names:
        spot = named['Plan Follow-up Delivery']['position']
        nodes.append(node('Staging follow-up?', 'n8n-nodes-base.if', 2.2, [spot[0] + 220, spot[1]],
                          equals_if("={{ $json.staging === true ? 'yes' : 'no' }}", 'yes')))
        nodes.append(node('Prepare staging follow-up', 'n8n-nodes-base.code', 2, [spot[0] + 440, spot[1] - 80], {'mode': 'runOnceForAllItems', 'jsCode': PREPARE_FOLLOWUP}))
        nodes.append(pg('Record staging follow-up', '={{ $json.query }}', [spot[0] + 660, spot[1] - 80]))
        point(connections, 'Plan Follow-up Delivery', 'Follow-up Typing Delay', 'Staging follow-up?')
        connections['Staging follow-up?'] = {'main': [[{'node': 'Prepare staging follow-up', 'type': 'main', 'index': 0}], [{'node': 'Follow-up Typing Delay', 'type': 'main', 'index': 0}]]}
        connections['Prepare staging follow-up'] = link('Record staging follow-up')
        connections['Record staging follow-up'] = link('Follow-up Typing Delay')
    if 'Reset Staging Session' not in names:
        spot = named['Purge Session']['position']
        nodes.append(pg('Reset Staging Session', RESET_AGENT_SQL, [spot[0] + 220, spot[1]]))
        point(connections, 'Purge Session', 'Send Reset Notice', 'Reset Staging Session')
        connections['Reset Staging Session'] = link('Send Reset Notice')
    quote_records(nodes)
    arm_sends(nodes)
    keep_replies(nodes)
    return nodes, connections


def patch_booking(workflow):
    nodes = json.loads(json.dumps(workflow['nodes']))
    named = {item['name']: item for item in nodes}
    code = named['Muster']['parameters']['jsCode']
    if 'WHATSAPP_NOTE' not in code:
        anchor = "const action = String(body.action || '')\n"
        code = must_replace(code, anchor, anchor + NOTE_HELPERS, 'Muster action')
        code = must_replace(code, RESERVE_OLD, RESERVE_NEW, 'Muster reserve', 2)
        named['Muster']['parameters']['jsCode'] = code
    query = named['Clear chat memory']['parameters']['query']
    if '_staging_%' not in query:
        digits = "{{ 'k1_katsastus_demo_' + String($('Webhook').first().json.body.phone || '').replace(/\\D/g, '') }}"
        named['Clear chat memory']['parameters']['query'] = (
            f"delete from chat_history where session_id = '{digits}' or session_id like '{digits}_staging_%'"
        )
    return nodes, workflow['connections']


READ_VERSION_JS = r"""let raw = $input.first().json
if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch (error) { raw = {} } }
if (Array.isArray(raw)) raw = raw[0] || {}
if (!raw || typeof raw !== 'object') raw = {}
if (raw.body && typeof raw.body === 'object' && raw.body.versionNumber != null) raw = raw.body
const versionNumber = Number(raw.versionNumber)
const lookupFailed = Boolean(raw.error) && !Number.isInteger(versionNumber)
return [{ json: { versionNumber: Number.isInteger(versionNumber) && versionNumber > 0 ? versionNumber : null, error: lookupFailed ? 'version_lookup_failed' : null } }]
"""

EXPLAIN_JS = r"""function ran(name) { try { return $(name).isExecuted } catch (error) { return false } }
const version = ran('Read version') ? ($('Read version').first().json || {}) : {}
const claim = ran('Unwrap claim') ? ($('Unwrap claim').first().json || {}) : null
const sent = ran('Send opener') ? ($('Send opener').first().json || {}) : null
let error = 'send_failed'
if (!version.versionNumber) error = version.error || 'unknown_version'
else if (!claim || String(claim.ok) !== 'true') {
  const reason = claim && typeof claim.error === 'string' ? claim.error : ''
  error = /^[a-z0-9_.:-]{1,80}$/i.test(reason) && reason !== 'send_failed' ? reason : 'claim_failed'
} else if (sent && sent.error) error = 'whatsapp_failed'
if (typeof error !== 'string' || !/^[a-z0-9_.:-]{1,80}$/i.test(error)) error = 'send_failed'
return [{ json: { ok: false, error } }]
"""

THREAD_JS = r"""const digits = String($('Normalize').first().json.phone || '').replace(/\D/g, '')
if (!/^\d+$/.test(digits)) return [{ json: { query: "select json_build_object('ok', false, 'error', 'phone_required') as result" } }]
const query = `select json_build_object(
  'ok', true,
  'found', s.phone_key is not null,
  'phone', s.phone,
  'plate', coalesce(s.lead->>'plateNumber', ''),
  'stationName', coalesce(s.lead->>'stationName', ''),
  'versionNumber', s.version_number,
  'updatedAt', s.updated_at,
  'messages', coalesce((
    select json_agg(json_build_object('id', m.id, 'role', m.role, 'text', m.text, 'at', m.created_at) order by m.created_at)
    from k1_staging_messages m where m.conversation_id = s.conversation_id
  ), '[]'::json)
) as result
from (select 1) seed
left join k1_staging_sessions s on s.phone_key = '${digits}'`
return [{ json: { query } }]
"""

CLAIM_JS = DOLLAR_JS + r"""const body = $('Normalize').first().json || {}
const version = $('Read version').first().json || {}
const phone = String(body.phone || '').trim()
const digits = phone.replace(/\D/g, '')
const versionId = String(body.versionId || '')
const versionNumber = Number(version.versionNumber)
const fail = (error) => [{ json: { query: `select json_build_object('ok', false, 'error', '${error}') as result` } }]
if (!digits) return fail('phone_required')
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(versionId) || !Number.isInteger(versionNumber)) return fail('unknown_version')
const lead = body.lead && typeof body.lead === 'object' ? body.lead : {}
const plate = String(lead.plateNumber || '')
const title = (phone + ' · ' + plate).replace(/\s+/g, ' ').trim().slice(0, 140)
const opener = String(body.opener || '')
const context = String(body.leadContext || '')
const started = body.startedBy == null ? '' : String(body.startedBy)
const query = `with conv as (
  insert into k1_staging_conversations (id, phone_key, phone, version_id, version_number, title, started_by)
  values (gen_random_uuid(), ${dollar(digits)}, ${dollar(phone)}, ${dollar(versionId)}, ${versionNumber}, ${dollar(title)}, ${dollar(started)})
  returning id, phone_key, phone, version_id, version_number
), msg as (
  insert into k1_staging_messages (conversation_id, role, text, is_opener)
  select id, 'agent', ${dollar(opener)}, true from conv where ${dollar(opener)} <> ''
  returning conversation_id
), sess as (
  insert into k1_staging_sessions (phone_key, phone, version_id, version_number, conversation_id, lead, lead_context, opener, started_by)
  select phone_key, phone, version_id, version_number, id, ${dollar(JSON.stringify(lead))}::jsonb, ${dollar(context)}, ${dollar(opener)}, ${dollar(started)}
  from conv
  on conflict (phone_key) do update set
    phone = excluded.phone,
    version_id = excluded.version_id,
    version_number = excluded.version_number,
    conversation_id = excluded.conversation_id,
    lead = excluded.lead,
    lead_context = excluded.lead_context,
    opener = excluded.opener,
    started_by = excluded.started_by,
    updated_at = now()
  returning conversation_id, version_number, phone
)
select json_build_object('ok', true, 'conversationId', s.conversation_id, 'versionNumber', s.version_number, 'phone', s.phone, 'openerStored', (select count(*) from msg)) as result
from sess s`
return [{ json: { query } }]
"""

RESET_SEND_JS = r"""const digits = String($('Normalize').first().json.phone || '').replace(/\D/g, '')
if (!/^\d+$/.test(digits)) return [{ json: { query: "select json_build_object('ok', false, 'found', false, 'conversationId', null, 'error', 'phone_required') as result" } }]
const query = `with rotated as (
  update k1_staging_sessions set conversation_id = gen_random_uuid(), updated_at = now()
  where phone_key = '${digits}'
  returning *
), copied as (
  insert into k1_staging_conversations (id, phone_key, phone, version_id, version_number, title, started_by)
  select r.conversation_id, r.phone_key, r.phone, r.version_id, r.version_number,
         left(trim(r.phone || ' · ' || coalesce(r.lead->>'plateNumber', '')), 140), r.started_by
  from rotated r returning id
)
select json_build_object('ok', true, 'found', (select count(*) from rotated) > 0, 'conversationId', (select conversation_id from rotated)) as result`
return [{ json: { query } }]
"""

UNWRAP_RESULT_JS = r"""let result = $input.first().json.result
if (typeof result === 'string') { try { result = JSON.parse(result) } catch (error) { result = null } }
if (!result || typeof result !== 'object') result = { ok: false, error: 'send_failed' }
return [{ json: result }]
"""

UNWRAP_LIST_JS = r"""let sessions = $input.first().json.sessions
if (typeof sessions === 'string') { try { sessions = JSON.parse(sessions) } catch (error) { sessions = [] } }
if (!Array.isArray(sessions)) sessions = []
return [{ json: { ok: true, sessions } }]
"""


def send_workflow(settings):
    hook = node('Webhook', 'n8n-nodes-base.webhook', 2.1, [240, 300], {
        'httpMethod': 'POST', 'path': SEND_PATH, 'responseMode': 'responseNode', 'options': {},
    })
    hook['webhookId'] = str(uuid.uuid5(uuid.NAMESPACE_URL, 'k1-agent-builder/staging-send'))
    code = lambda name, position, js: node(name, 'n8n-nodes-base.code', 2, position, {'mode': 'runOnceForAllItems', 'jsCode': js})
    respond = lambda name, position, body, code_no=200: node(name, 'n8n-nodes-base.respondToWebhook', 1.5, position, {
        'respondWith': 'json', 'responseBody': body, 'options': {'responseCode': code_no},
    })
    nodes = [
        hook,
        code('Normalize', [460, 300], r"""const item = $input.first().json || {}
const body = item.body || item
const action = String(body.action || 'list')
const phone = String(body.phone || '').trim()
return [{ json: { ...body, action, phone, to: phone.replace(/\D/g, '') } }]"""),
        node('Send?', 'n8n-nodes-base.if', 2.2, [680, 300], equals_if('={{ $json.action }}', 'send')),
        node('Thread?', 'n8n-nodes-base.if', 2.2, [900, 420], equals_if('={{ $json.action }}', 'thread')),
        node('Reset?', 'n8n-nodes-base.if', 2.2, [1120, 620], equals_if('={{ $json.action }}', 'reset')),
        http_rpc('Fetch saved version', 'get_agent_builder_version',
                 "={{ { p_tenant_key: 'k1_katsastus_demo', p_version_id: $('Normalize').first().json.versionId } }}", [900, 120]),
        code('Read version', [1120, 120], READ_VERSION_JS),
        node('Version ok?', 'n8n-nodes-base.if', 2.2, [1340, 120], equals_if("={{ $json.versionNumber ? 'yes' : 'no' }}", 'yes')),
        code('Prepare claim', [1560, 40], CLAIM_JS),
        pg('Claim session', '={{ $json.query }}', [1780, 40]),
        code('Unwrap claim', [2000, 40], UNWRAP_RESULT_JS),
        node('Claimed?', 'n8n-nodes-base.if', 2.2, [2220, 40], equals_if("={{ String($json.ok) }}", 'true')),
        node('Send opener', 'n8n-nodes-wasup.wasup', 1, [2440, -40], {
            'resource': 'message',
            'operation': 'sendRaw',
            'instanceId': {'__rl': True, 'value': INSTANCE, 'mode': 'id'},
            'rawBody': "={{ JSON.stringify({ to: $('Normalize').first().json.to, message: $('Normalize').first().json.opener, linkPreview: false, allowColdWithoutToken: true }) }}",
        }, WASUP, {'onError': 'continueRegularOutput'}),
        node('Sent?', 'n8n-nodes-base.if', 2.2, [2660, -40], equals_if("={{ $json.error ? 'no' : 'yes' }}", 'yes')),
        respond('Respond send', [2880, -80], "={{ { ok: true, conversationId: $('Unwrap claim').first().json.conversationId, versionNumber: $('Unwrap claim').first().json.versionNumber, phone: $('Normalize').first().json.phone } }}"),
        code('Explain failure', [2440, 180], EXPLAIN_JS),
        respond('Respond send failed', [2660, 180], "={{ { ok: false, error: $json.error || 'send_failed' } }}", 400),
        code('Prepare thread', [1120, 420], THREAD_JS),
        pg('Read thread', '={{ $json.query }}', [1340, 420]),
        code('Unwrap thread', [1560, 420], UNWRAP_RESULT_JS),
        respond('Respond thread', [1780, 420], '={{ $json }}'),
        code('Prepare reset', [1340, 620], RESET_SEND_JS),
        pg('Reset session', '={{ $json.query }}', [1340, 400]),
        code('Unwrap reset', [1560, 400], UNWRAP_RESULT_JS),
        respond('Respond reset', [1780, 400], '={{ $json }}'),
        pg('List sessions', LIST_SESSIONS_SQL, [1120, 620]),
        code('Unwrap list', [1340, 620], UNWRAP_LIST_JS),
        respond('Respond list', [1560, 620], '={{ $json }}'),
    ]
    connections = {
        'Webhook': link('Normalize'),
        'Normalize': link('Send?'),
        'Send?': {'main': [[{'node': 'Fetch saved version', 'type': 'main', 'index': 0}], [{'node': 'Thread?', 'type': 'main', 'index': 0}]]},
        'Thread?': {'main': [[{'node': 'Prepare thread', 'type': 'main', 'index': 0}], [{'node': 'Reset?', 'type': 'main', 'index': 0}]]},
        'Fetch saved version': link('Read version'),
        'Read version': link('Version ok?'),
        'Version ok?': {'main': [[{'node': 'Prepare claim', 'type': 'main', 'index': 0}], [{'node': 'Explain failure', 'type': 'main', 'index': 0}]]},
        'Prepare claim': link('Claim session'),
        'Claim session': link('Unwrap claim'),
        'Unwrap claim': link('Claimed?'),
        'Claimed?': {'main': [[{'node': 'Send opener', 'type': 'main', 'index': 0}], [{'node': 'Explain failure', 'type': 'main', 'index': 0}]]},
        'Send opener': link('Sent?'),
        'Sent?': {'main': [[{'node': 'Respond send', 'type': 'main', 'index': 0}], [{'node': 'Explain failure', 'type': 'main', 'index': 0}]]},
        'Explain failure': link('Respond send failed'),
        'Prepare thread': link('Read thread'),
        'Read thread': link('Unwrap thread'),
        'Unwrap thread': link('Respond thread'),
        'Reset?': {'main': [[{'node': 'Prepare reset', 'type': 'main', 'index': 0}], [{'node': 'List sessions', 'type': 'main', 'index': 0}]]},
        'Prepare reset': link('Reset session'),
        'Reset session': link('Unwrap reset'),
        'Unwrap reset': link('Respond reset'),
        'List sessions': link('Unwrap list'),
        'Unwrap list': link('Respond list'),
    }
    kept = {key: value for key, value in (settings or {}).items() if key in SETTINGS_KEEP}
    return gate.gate({'name': SEND_NAME, 'nodes': nodes, 'connections': connections, 'settings': kept or {'executionOrder': 'v1'}})


def check_agent(workflow, payment_id):
    named = {item['name']: item for item in workflow['nodes']}
    paths = [item['parameters'].get('path') for item in workflow['nodes'] if item['type'] == 'n8n-nodes-base.webhook']
    assert 'k1-muster-agent-inbound' in paths
    assert named['Build Turn']['parameters']['jsCode'].count('staging_session_key') >= 1
    assert 'staging: turn.staging === true' in named['Plan Delivery']['parameters']['jsCode']
    assert BRIEF_STAGING in named['AI Agent']['parameters']['options']['systemMessage']
    assert BRIEF_STAGING in named['Follow-up Agent']['parameters']['options']['systemMessage']
    assert 'staging_session_key' in named['Postgres Chat Memory']['parameters']['sessionKey']
    assert named['create_payment_link']['parameters']['workflowId']['value'] == payment_id
    for tool_name in ('book_inspection_invite', 'reschedule_booking'):
        assert named[tool_name]['parameters']['workflowInputs']['value']['source'] == SOURCE
        assert named[tool_name]['parameters']['workflowId']['value'] == LIVE_BOOKING
    for send_name in ('Send Bubble CTA', 'Send Double-Text CTA'):
        params = named[send_name]['parameters']
        assert params['operation'] == 'sendRaw'
        assert 'allowColdWithoutToken: true' in params['rawBody']
        assert 'typingSimulation: true' in params['rawBody']
        assert params['ctaLabel'] == '={{ $json.cta_label }}'
        assert 'item.staging !== true' in named[f'{send_name[:-4]} CTA fields']['parameters']['jsCode']
    assert named['Load Staging Session']['type'] == 'n8n-nodes-base.postgres'
    assert 'k1_staging_sessions' in named['Load Staging Session']['parameters']['query']
    assert 'get_agent_builder_version' in named['Fetch staging version']['parameters']['url']
    assert 'Fetch staging version' in workflow['connections']['Staging assigned?']['main'][0][0]['node']
    assert named['Record staging turn']['parameters']['query'] == '={{ $json.query }}'
    assert 'gen_random_uuid' in named['Reset Staging Session']['parameters']['query']
    assert 'SELECT 1 AS purged' in named['Purge Session']['parameters']['query']
    assert '_staging_%' in named['Purge Session']['parameters']['query']
    for name in REPLY_CHECK_NODES:
        replied = named[name]['parameters']['query']
        assert 'inbound_message_queue q' in replied
        assert 'last_inbound_message_id' not in replied
    assert 'k1_staging_messages' in named['Prepare staging record']['parameters']['jsCode']
    assert 'chr(36)' in named['Prepare staging record']['parameters']['jsCode']
    assert "let tag = 'stg'" not in named['Prepare staging record']['parameters']['jsCode']
    for send_name in ('Send Bubble', 'Send Double-Text', 'Send Reset Notice'):
        params = named[send_name]['parameters']
        assert params['operation'] == 'sendRaw'
        assert 'allowColdWithoutToken: true' in params['rawBody']
        assert 'typingSimulation: true' in params['rawBody']
    config = {item['name']: item['value'] for item in named['⚙️ CONFIG']['parameters']['assignments']['assignments']}
    assert config['wasup_instance_id'] == INSTANCE


def check_booking(workflow):
    named = {item['name']: item for item in workflow['nodes']}
    code = named['Muster']['parameters']['jsCode']
    assert 'Varattu WhatsApp-botin kautta' in code
    assert code.count('postReservation') >= 3
    assert '_staging_%' in named['Clear chat memory']['parameters']['query']
    assert 'fromWhatsApp' in code


def scrub(text):
    return re.sub(r'("password"\s*:\s*")[^"]*"', r'\1REDACTED"', text)


def newest_backup(kind):
    files = sorted(BACKUPS.glob(f'*-{kind}.json'))
    if not files:
        raise SystemExit(f'no {kind} backup')
    return json.loads(files[-1].read_text())


PREPARE_THREAD_JS = r"""const id = String($('One Webhook · Pass Request').first().json.query?.id || '')
const ok = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
const safe = ok ? id : '00000000-0000-0000-0000-000000000000'
const query = `select coalesce((
  select json_build_object(
    'conversation', json_build_object(
      'id', c.id, 'version_id', c.version_id, 'version_number', c.version_number, 'is_draft', false,
      'source', 'staging', 'title', c.title, 'started_by', c.started_by, 'created_at', c.created_at, 'updated_at', c.updated_at,
      'message_count', (select count(*) from k1_staging_messages m where m.conversation_id = c.id and not m.is_opener),
      'thumbs_up', 0, 'thumbs_down', 0,
      'last_reply', coalesce((select m.text from k1_staging_messages m where m.conversation_id = c.id and m.role = 'agent' and not m.is_opener order by m.created_at desc limit 1), '')
    ),
    'messages', coalesce((
      select json_agg(json_build_object(
        'id', m.id, 'role', m.role, 'text', m.text, 'isOpener', m.is_opener, 'feedback', null, 'createdAt', m.created_at
      ) order by m.created_at)
      from k1_staging_messages m where m.conversation_id = c.id
    ), '[]'::json)
  )
  from k1_staging_conversations c where c.id = '${safe}'::uuid
), 'null'::json) as payload`
return [{ json: { query } }]
"""

READ_THREAD_JS = r"""let payload = $input.first().json.payload
if (typeof payload === 'string') { try { payload = JSON.parse(payload) } catch (error) { payload = null } }
const found = Boolean(payload && payload.conversation)
return [{ json: { found, payload: found ? payload : null } }]
"""

SHAPE_LIST_JS = SHAPE_STAGING_JS + r"""const filters = $('Build Filters').first().json
const items = shapeStaging(filters, $input.first().json.rows)
const limit = Math.min(Number(filters.p_limit) || 50, 200)
const offset = Math.max(Number(filters.p_offset) || 0, 0)
return [{ json: { items: items.slice(offset, offset + limit) } }]
"""

MERGE_LIST_JS = SHAPE_STAGING_JS + r"""const filters = $('Build Filters').first().json
const existing = $('Shape List').first().json.items || []
const extra = shapeStaging(filters, $input.first().json.rows)
const limit = Math.min(Number(filters.p_limit) || 50, 200)
const items = [...existing, ...extra].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, limit)
return [{ json: { items } }]
"""


def patch_chats(workflow):
    nodes = json.loads(json.dumps(workflow['nodes']))
    connections = json.loads(json.dumps(workflow['connections']))
    named = {item['name']: item for item in nodes}
    filters = named['Build Filters']['parameters']['jsCode']
    if "['playground', 'compare', 'staging']" not in filters:
        named['Build Filters']['parameters']['jsCode'] = must_replace(
            filters, "['playground', 'compare']", "['playground', 'compare', 'staging']", 'Build Filters source',
        )
    body = named['Get One RPC']['parameters'].get('jsonBody', '')
    if "$('One Webhook · Pass Request')" not in body:
        named['Get One RPC']['parameters']['jsonBody'] = body.replace('$json.query', "$('One Webhook · Pass Request').first().json.query")
    if 'Staging list?' not in named:
        spot = named['Build Filters']['position']
        nodes.extend([
            node('Staging list?', 'n8n-nodes-base.if', 2.2, [spot[0] + 220, spot[1] - 160],
                 equals_if("={{ $('Build Filters').first().json.p_source === 'staging' ? 'yes' : 'no' }}", 'yes')),
            pg('Staging chats', LIST_CHATS_SQL, [spot[0] + 440, spot[1] - 240]),
            node('Shape staging list', 'n8n-nodes-base.code', 2, [spot[0] + 660, spot[1] - 240], {'mode': 'runOnceForAllItems', 'jsCode': SHAPE_LIST_JS}),
            node('Include staging?', 'n8n-nodes-base.if', 2.2, [spot[0] + 660, spot[1] + 40],
                 equals_if("={{ $('Build Filters').first().json.p_source ? 'no' : 'yes' }}", 'yes')),
            pg('All staging chats', LIST_CHATS_SQL, [spot[0] + 880, spot[1] - 40]),
            node('Merge staging chats', 'n8n-nodes-base.code', 2, [spot[0] + 1100, spot[1] - 40], {'mode': 'runOnceForAllItems', 'jsCode': MERGE_LIST_JS}),
        ])
        point(connections, 'Build Filters', 'List RPC', 'Staging list?')
        point(connections, 'Shape List', 'Respond List', 'Include staging?')
        connections['Staging list?'] = {'main': [[{'node': 'Staging chats', 'type': 'main', 'index': 0}], [{'node': 'List RPC', 'type': 'main', 'index': 0}]]}
        connections['Staging chats'] = link('Shape staging list')
        connections['Shape staging list'] = link('Respond List')
        connections['Include staging?'] = {'main': [[{'node': 'All staging chats', 'type': 'main', 'index': 0}], [{'node': 'Respond List', 'type': 'main', 'index': 0}]]}
        connections['All staging chats'] = link('Merge staging chats')
        connections['Merge staging chats'] = link('Respond List')
    if 'Prepare staging thread' not in {item['name'] for item in nodes}:
        spot = named['Get One RPC']['position']
        nodes.extend([
            node('Prepare staging thread', 'n8n-nodes-base.code', 2, [spot[0] - 220, spot[1] + 160], {'mode': 'runOnceForAllItems', 'jsCode': PREPARE_THREAD_JS}),
            pg('Staging thread', '={{ $json.query }}', [spot[0], spot[1] + 160]),
            node('Read staging thread', 'n8n-nodes-base.code', 2, [spot[0] + 220, spot[1] + 160], {'mode': 'runOnceForAllItems', 'jsCode': READ_THREAD_JS}),
            node('Staging thread?', 'n8n-nodes-base.if', 2.2, [spot[0] + 440, spot[1] + 160], equals_if("={{ $json.found ? 'yes' : 'no' }}", 'yes')),
            node('Use staging thread', 'n8n-nodes-base.code', 2, [spot[0] + 660, spot[1] + 80], {'mode': 'runOnceForAllItems', 'jsCode': 'return [{ json: $json.payload }]'}),
        ])
        point(connections, 'One Webhook · Pass Request', 'Get One RPC', 'Prepare staging thread')
        connections['Prepare staging thread'] = link('Staging thread')
        connections['Staging thread'] = link('Read staging thread')
        connections['Read staging thread'] = link('Staging thread?')
        connections['Staging thread?'] = {'main': [[{'node': 'Use staging thread', 'type': 'main', 'index': 0}], [{'node': 'Get One RPC', 'type': 'main', 'index': 0}]]}
        connections['Use staging thread'] = link('Shape One')
    return nodes, connections


def check_chats(workflow):
    named = {item['name']: item for item in workflow['nodes']}
    assert "['playground', 'compare', 'staging']" in named['Build Filters']['parameters']['jsCode']
    assert "$('One Webhook · Pass Request')" in named['Get One RPC']['parameters']['jsonBody']
    assert 'k1_staging_conversations' in named['Staging chats']['parameters']['query']
    assert workflow['connections']['Staging list?']['main'][1][0]['node'] == 'List RPC'
    assert workflow['connections']['Staging thread?']['main'][1][0]['node'] == 'Get One RPC'
    assert 'k1_staging_messages' in named['Prepare staging thread']['parameters']['jsCode']


def chats_stub():
    return {
        'nodes': [
            {'id': '1', 'name': 'Build Filters', 'type': 'n8n-nodes-base.code', 'position': [240, 0], 'parameters': {'jsCode': "const q = {};\nreturn [{ json: { p_source: ['playground', 'compare'].includes(q.source) ? q.source : null } }];"}},
            {'id': '2', 'name': 'List RPC', 'type': 'n8n-nodes-base.httpRequest', 'position': [480, 0], 'parameters': {}},
            {'id': '3', 'name': 'Shape List', 'type': 'n8n-nodes-base.code', 'position': [720, 0], 'parameters': {'jsCode': 'return [{ json: { items } }];'}},
            {'id': '4', 'name': 'Respond List', 'type': 'n8n-nodes-base.respondToWebhook', 'position': [960, 0], 'parameters': {}},
            {'id': '5', 'name': 'Get One RPC', 'type': 'n8n-nodes-base.httpRequest', 'position': [240, 240], 'parameters': {'jsonBody': "={{ { p_id: /^[0-9a-f-]{36}$/i.test($json.query?.id || '') ? $json.query.id : '00000000-0000-0000-0000-000000000000' } }}"}},
            {'id': '6', 'name': 'Shape One', 'type': 'n8n-nodes-base.code', 'position': [480, 240], 'parameters': {'jsCode': ''}},
            {'id': '7', 'name': 'Respond One', 'type': 'n8n-nodes-base.respondToWebhook', 'position': [720, 240], 'parameters': {}},
            {'id': '8', 'name': 'One Webhook · Pass Request', 'type': 'n8n-nodes-base.code', 'position': [0, 240], 'parameters': {'jsCode': ''}},
        ],
        'connections': {
            'Build Filters': link('List RPC'),
            'List RPC': link('Shape List'),
            'Shape List': link('Respond List'),
            'One Webhook · Pass Request': link('Get One RPC'),
            'Get One RPC': link('Shape One'),
            'Shape One': link('Respond One'),
        },
    }


def dry():
    agent = newest_backup('agent')
    booking = newest_backup('booking')
    nodes, connections = patch_agent(agent, PAYMENT_ID)
    check_agent({'nodes': nodes, 'connections': connections}, PAYMENT_ID)
    booked, _ = patch_booking(booking)
    check_booking({'nodes': booked})
    send = send_workflow(agent.get('settings'))
    assert any(item['name'].endswith(' · Check Access') for item in send['nodes'])
    assert any(item['parameters'].get('path') == SEND_PATH for item in send['nodes'])
    claim = next(item for item in send['nodes'] if item['name'] == 'Prepare claim')
    assert 'k1_staging_sessions' in claim['parameters']['jsCode'] and "$('Read version')" in claim['parameters']['jsCode']
    assert 'chr(36)' in claim['parameters']['jsCode'] and '$stg$' not in claim['parameters']['jsCode']
    assert any(item['name'] == 'Read version' for item in send['nodes'])
    assert any(item['name'] == 'Explain failure' for item in send['nodes'])
    assert any(item['name'] == 'Prepare thread' for item in send['nodes'])
    opener = next(item for item in send['nodes'] if item['name'] == 'Send opener')
    assert opener['parameters']['resource'] == 'message'
    assert opener['parameters']['operation'] == 'sendRaw'
    assert 'allowColdWithoutToken: true' in opener['parameters']['rawBody']
    chat_nodes, chat_connections = patch_chats(chats_stub())
    check_chats({'nodes': chat_nodes, 'connections': chat_connections})
    print('dry ok')


def settings_of(workflow):
    return {key: value for key, value in (workflow.get('settings') or {}).items() if key in SETTINGS_KEEP}


def put(wid, name, nodes, connections, settings, active):
    gate.request('POST', f'/workflows/{wid}/deactivate')
    try:
        gate.request('PUT', f'/workflows/{wid}', {'name': name, 'nodes': nodes, 'connections': connections, 'settings': settings})
    finally:
        if active:
            gate.request('POST', f'/workflows/{wid}/activate')


def backup(workflow, kind):
    BACKUPS.mkdir(exist_ok=True)
    stamp = time.strftime('%Y%m%d-%H%M%S')
    path = BACKUPS / f'{stamp}-{kind}.json'
    path.write_text(scrub(json.dumps(workflow, ensure_ascii=False)))
    return path


def post_webhook(path, payload=b'{}'):
    base = (gate.local_env().get('N8N_RAPID_BASE_URL') or gate.DEFAULT_BASE).rstrip('/')
    delay = 2
    last = (0, '')
    for _ in range(5):
        time.sleep(delay)
        request = urllib.request.Request(base + '/webhook/' + path, data=payload, method='POST', headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                return response.status, response.read().decode()
        except urllib.error.HTTPError as error:
            body = error.read().decode(errors='replace')
            last = (error.code, body)
            if error.code != 404:
                return error.code, body
            delay = min(delay * 2, 16)
    return last


def delete_workflow(wid):
    try:
        gate.request('POST', f'/workflows/{wid}/deactivate')
    except Exception:
        pass
    for delay in (1, 3, 6, 10):
        time.sleep(delay)
        try:
            gate.request('DELETE', f'/workflows/{wid}')
            return
        except urllib.error.HTTPError as error:
            if error.code != 409:
                raise
    raise SystemExit(f'could not delete {wid}')


def apply_sql(postgres):
    path = f'k1-staging-migrate-{uuid.uuid4().hex[:12]}'
    respond = node('Respond', 'n8n-nodes-base.respondToWebhook', 1.5, [640, 300], {'respondWith': 'json', 'responseBody': '={{ $json }}', 'options': {}})
    hook = node('Webhook', 'n8n-nodes-base.webhook', 2.1, [240, 300], {'httpMethod': 'POST', 'path': path, 'responseMode': 'responseNode', 'options': {}})
    sql = node('Migrate', 'n8n-nodes-base.postgres', 2.6, [440, 300], {'operation': 'executeQuery', 'query': STORE_SQL, 'options': {}}, {'postgres': postgres})
    created = gate.request('POST', '/workflows', {'name': 'K1 staging migrate once', 'nodes': [hook, sql, respond], 'connections': {'Webhook': link('Migrate'), 'Migrate': link('Respond')}, 'settings': {'executionOrder': 'v1'}})
    wid = created['id']
    try:
        gate.request('POST', f'/workflows/{wid}/activate')
        status, body = post_webhook(path)
        compact = body.replace(' ', '')
        if status != 200 or '"status":"ok"' not in compact or ('"leftover":0' not in compact and '"leftover":"0"' not in compact):
            raise SystemExit(f'migration did not confirm ({status})')
        print('session store ready')
    finally:
        delete_workflow(wid)


def save_send(body):
    existing = None
    items, cursor = [], None
    while True:
        page = gate.request('GET', '/workflows?limit=250' + (f'&cursor={cursor}' if cursor else ''))
        items += page['data']
        cursor = page.get('nextCursor')
        if not cursor:
            break
    for item in items:
        if item['name'] == SEND_NAME:
            existing = item['id']
        if item['name'] == PAYMENT_NAME:
            body['payment_id'] = item['id']
    if existing:
        gate.request('POST', f'/workflows/{existing}/deactivate')
        try:
            gate.request('PUT', f'/workflows/{existing}', {'name': body['name'], 'nodes': body['nodes'], 'connections': body['connections'], 'settings': body['settings']})
        except Exception:
            gate.request('POST', f'/workflows/{existing}/activate')
            raise
        wid = existing
    else:
        wid = gate.request('POST', '/workflows', {'name': body['name'], 'nodes': body['nodes'], 'connections': body['connections'], 'settings': body['settings']})['id']
    gate.request('POST', f'/workflows/{wid}/activate')
    return wid


def apply():
    agent = gate.request('GET', f'/workflows/{LIVE_AGENT}')
    booking = gate.request('GET', f'/workflows/{LIVE_BOOKING}')
    chats = gate.request('GET', f'/workflows/{TEST_CHATS}')
    backup(agent, 'agent')
    backup(booking, 'booking')
    backup(chats, 'test-chats')
    postgres = next(item['credentials']['postgres'] for item in agent['nodes'] if item['name'] == 'Purge Session')
    apply_sql(postgres)
    payment_id = PAYMENT_ID
    page, cursor = [], None
    while True:
        chunk = gate.request('GET', '/workflows?limit=250' + (f'&cursor={cursor}' if cursor else ''))
        page += chunk['data']
        cursor = chunk.get('nextCursor')
        if not cursor:
            break
    for item in page:
        if item['name'] == PAYMENT_NAME:
            payment_id = item['id']
        if item['name'] == 'K1 staging migrate once':
            delete_workflow(item['id'])
    agent_nodes, agent_connections = patch_agent(agent, payment_id)
    check_agent({'nodes': agent_nodes, 'connections': agent_connections}, payment_id)
    booking_nodes, booking_connections = patch_booking(booking)
    check_booking({'nodes': booking_nodes})
    chat_nodes, chat_connections = patch_chats(chats)
    check_chats({'nodes': chat_nodes, 'connections': chat_connections})
    put(LIVE_BOOKING, booking['name'], booking_nodes, booking_connections, settings_of(booking), booking.get('active'))
    put(LIVE_AGENT, agent['name'], agent_nodes, agent_connections, settings_of(agent), agent.get('active'))
    put(TEST_CHATS, chats['name'], chat_nodes, chat_connections, settings_of(chats), chats.get('active'))
    send = send_workflow(agent.get('settings'))
    send.pop('payment_id', None)
    wid = save_send(send)
    live = gate.request('GET', f'/workflows/{LIVE_AGENT}')
    booked = gate.request('GET', f'/workflows/{LIVE_BOOKING}')
    listed = gate.request('GET', f'/workflows/{TEST_CHATS}')
    assert live.get('active') is True
    check_agent(live, payment_id)
    check_booking(booked)
    check_chats(listed)
    assert listed.get('active') is True
    inactive = gate.request('GET', f'/workflows/{INACTIVE_STAGING}')
    assert inactive.get('active') is False
    saved = gate.request('GET', f'/workflows/{wid}')
    assert saved.get('active') is True
    assert any(item['name'].endswith(' · Check Access') for item in saved['nodes'])
    status, body = post_webhook(SEND_PATH, b'{"action":"list"}')
    if status != 401 or 'signin_required' not in body:
        raise SystemExit(f'staging send gate did not refuse an unsigned call ({status})')
    print(f'live agent {LIVE_AGENT} active={live.get("active")}; booking noted; staging send {wid}')


if __name__ == '__main__':
    import sys
    command = sys.argv[1] if len(sys.argv) > 1 else 'dry'
    if command == 'dry':
        dry()
    elif command == 'apply':
        apply()
    else:
        raise SystemExit(__doc__)
