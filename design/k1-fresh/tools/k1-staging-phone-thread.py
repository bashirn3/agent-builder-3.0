#!/usr/bin/env python3
"""One WhatsApp thread per phone on the staging chats tab.

Each reset inserts a new k1_staging_conversations row, and the thread endpoint
used to load only that row. The list then kept each fragment and sliced to 50,
so the same phone looked like several chats that stop early.

Patches live workflow Huk3NIxdfcjVvb7c (K1 Agent Builder API — Test Chats):
the opened id still drives Shape One, but messages, counts, thumbs, last reply,
and the created/updated span cover every row with that phone_key. The list
queries expose phone_key and the shape nodes collapse on it before the slice.

  python3 k1-staging-phone-thread.py
"""
import importlib.util
import json
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('gate', HERE / 'n8n-gate.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

WORKFLOW = 'Huk3NIxdfcjVvb7c'
POSTGRES = {'postgres': {'id': 'OFlPRP5F4peeJpaM', 'name': 'v2back-working'}}
SETTINGS_KEEP = ('executionOrder', 'timezone', 'saveDataErrorExecution', 'saveDataSuccessExecution')
OPENED = '6ee570ee-f156-4801-bda3-8450e4cbd790'
NEEDLES = ('Kenen nimellä varaan', 'Huomenna olisi hyvä päivä', 'Joku jaskanen')

THREAD_QUERY = """with opened as (
  select * from k1_staging_conversations where id = '__CONVERSATION_ID__'::uuid
),
threads as (
  select c.id, c.created_at, c.updated_at
  from opened o
  join k1_staging_conversations c on (
    (coalesce(o.phone_key, '') <> '' and c.phone_key = o.phone_key)
    or c.id = o.id
  )
),
msgs as (
  select m.id, m.role, m.text, m.is_opener, m.feedback, m.created_at
  from k1_staging_messages m
  join threads t on t.id = m.conversation_id
)
select coalesce((
  select json_build_object(
    'conversation', json_build_object(
      'id', o.id,
      'version_id', o.version_id,
      'version_number', o.version_number,
      'is_draft', false,
      'source', 'staging',
      'title', o.title,
      'started_by', o.started_by,
      'created_at', (select min(c.created_at) from threads c),
      'updated_at', (select max(c.updated_at) from threads c),
      'message_count', (select count(*) from msgs m where not m.is_opener),
      'thumbs_up', (select count(*) from msgs m where m.feedback = 'up'),
      'thumbs_down', (select count(*) from msgs m where m.feedback = 'down'),
      'last_reply', coalesce((
        select m.text from msgs m
        where m.role = 'agent' and not m.is_opener and btrim(coalesce(m.text, '')) <> ''
        order by m.created_at desc, m.id desc
        limit 1
      ), '')
    ),
    'messages', coalesce((
      select json_agg(json_build_object(
        'id', m.id, 'role', m.role, 'text', m.text, 'isOpener', m.is_opener,
        'feedback', m.feedback, 'createdAt', m.created_at
      ) order by m.created_at, m.id)
      from msgs m
    ), '[]'::json)
  )
  from opened o
), 'null'::json) as payload"""

LIST_SQL = """select coalesce((
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
    'phone_key', c.phone_key,
    'message_count', (select count(*) from k1_staging_messages m where m.conversation_id = c.id and not m.is_opener),
    'thumbs_up', (select count(*) from k1_staging_messages m where m.conversation_id = c.id and m.feedback = 'up'),
    'thumbs_down', (select count(*) from k1_staging_messages m where m.conversation_id = c.id and m.feedback = 'down'),
    'last_reply', coalesce((select m.text from k1_staging_messages m where m.conversation_id = c.id and m.role = 'agent' and not m.is_opener order by m.created_at desc limit 1), ''),
    'texts', coalesce((select json_agg(m.text) from k1_staging_messages m where m.conversation_id = c.id), '[]'::json)
  ) order by c.updated_at desc)
  from k1_staging_conversations c
), '[]'::json) as rows"""

HELPERS = r"""function rowsOf(raw) {
  if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch (error) { raw = [] } }
  return Array.isArray(raw) ? raw : []
}
function textsOf(row) {
  let texts = row.texts || []
  if (typeof texts === 'string') { try { texts = JSON.parse(texts) } catch (error) { texts = [] } }
  return Array.isArray(texts) ? texts : []
}
function mapStaging(raw) {
  return rowsOf(raw).map((row) => ({
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
    thumbsUp: Number(row.thumbs_up || 0),
    thumbsDown: Number(row.thumbs_down || 0),
    lastReply: row.last_reply || '',
    phoneKey: row.phone_key == null ? '' : String(row.phone_key).trim(),
    texts: textsOf(row),
  }))
}
function newer(a, b) {
  const time = String(a.updatedAt).localeCompare(String(b.updatedAt))
  if (time) return time > 0
  return String(a.id).localeCompare(String(b.id)) > 0
}
function collapseByPhone(items) {
  const groups = new Map()
  for (const item of items) {
    const phone = String(item.phoneKey || '').trim()
    const key = phone ? `phone:${phone}` : `id:${item.id}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  return [...groups.values()].map((parts) => {
    const newest = parts.reduce((best, item) => (newer(item, best) ? item : best))
    const createdAt = parts.reduce((min, item) => (String(item.createdAt) < String(min) ? item.createdAt : min), parts[0].createdAt)
    const reply = parts.filter((item) => String(item.lastReply || '').trim()).reduce((best, item) => (!best || newer(item, best) ? item : best), null)
    return {
      id: newest.id,
      versionId: newest.versionId,
      versionNumber: newest.versionNumber,
      isDraft: newest.isDraft,
      source: newest.source,
      title: newest.title || '',
      startedBy: newest.startedBy ?? null,
      createdAt,
      updatedAt: newest.updatedAt,
      messageCount: parts.reduce((sum, item) => sum + Number(item.messageCount || 0), 0),
      thumbsUp: parts.reduce((sum, item) => sum + Number(item.thumbsUp || 0), 0),
      thumbsDown: parts.reduce((sum, item) => sum + Number(item.thumbsDown || 0), 0),
      lastReply: reply ? reply.lastReply : '',
      phoneKey: String(newest.phoneKey || '').trim(),
      texts: parts.flatMap((item) => item.texts || []),
      titles: parts.map((item) => item.title || ''),
      versionNumbers: parts.map((item) => item.versionNumber),
      updatedAts: parts.map((item) => item.updatedAt),
    }
  })
}
function keepCollapsed(filters, item) {
  if (item.source !== 'staging') return true
  const versions = Array.isArray(filters.p_versions) ? filters.p_versions.map((value) => Number(value)) : null
  const query = String(filters.p_query || '').toLowerCase()
  if (versions && versions.length && !item.versionNumbers.some((value) => versions.includes(Number(value)))) return false
  if (filters.p_feedback === 'up' && item.thumbsUp === 0) return false
  if (filters.p_feedback === 'down' && item.thumbsDown === 0) return false
  if (filters.p_feedback === 'none' && (item.thumbsUp > 0 || item.thumbsDown > 0)) return false
  if (filters.p_from || filters.p_to) {
    const hit = item.updatedAts.some((stamp) => {
      if (filters.p_from && String(stamp) < String(filters.p_from)) return false
      if (filters.p_to && String(stamp) >= String(filters.p_to)) return false
      return true
    })
    if (!hit) return false
  }
  if (query && ![...item.titles, ...(item.texts || [])].join('\n').toLowerCase().includes(query)) return false
  return true
}
function present(item) {
  return {
    id: item.id,
    versionId: item.versionId,
    versionNumber: item.versionNumber,
    isDraft: item.isDraft,
    source: item.source,
    title: item.title,
    startedBy: item.startedBy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    messageCount: item.messageCount,
    thumbsUp: item.thumbsUp,
    thumbsDown: item.thumbsDown,
    lastReply: item.lastReply,
  }
}
"""

SHAPE_JS = HELPERS + """const filters = $('Build Filters').first().json
const items = collapseByPhone(mapStaging($input.first().json.rows))
  .filter((item) => keepCollapsed(filters, item))
  .map(present)
  .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
const limit = Math.min(Number(filters.p_limit) || 50, 200)
const offset = Math.max(Number(filters.p_offset) || 0, 0)
return [{ json: { items: items.slice(offset, offset + limit) } }]
"""

MERGE_JS = HELPERS + """const filters = $('Build Filters').first().json
const existing = $('Shape List').first().json.items || []
const items = collapseByPhone([...existing, ...mapStaging($input.first().json.rows)])
  .filter((item) => keepCollapsed(filters, item))
  .map(present)
  .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
const limit = Math.min(Number(filters.p_limit) || 50, 200)
return [{ json: { items: items.slice(0, limit) } }]
"""

PREPARE_JS = """const id = String($('One Webhook · Pass Request').first().json.query?.id || '')
const ok = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
const safe = ok ? id : '00000000-0000-0000-0000-000000000000'
const query = `__SQL__`
return [{ json: { query } }]
""".replace('__SQL__', THREAD_QUERY.replace('__CONVERSATION_ID__', '${safe}'))

CHECK_JS = r"""let payload = $input.first().json.payload
if (typeof payload === 'string') { try { payload = JSON.parse(payload) } catch (error) { payload = null } }
const conversation = payload && payload.conversation
const messages = (payload && payload.messages) || []
const texts = messages.map((message) => String(message.text || ''))
const at = (needle) => texts.findIndex((text) => text.includes(needle))
const times = messages.map((message) => Date.parse(message.createdAt)).filter((value) => !Number.isNaN(value))
const nonOpeners = messages.filter((message) => !message.isOpener).length
return [{ json: {
  id: conversation && conversation.id,
  source: conversation && conversation.source,
  message_count: conversation && Number(conversation.message_count),
  non_openers: nonOpeners,
  n: messages.length,
  created_at: conversation && conversation.created_at,
  updated_at: conversation && conversation.updated_at,
  last_reply: conversation && conversation.last_reply,
  created_covers: !times.length || Date.parse(conversation.created_at) <= Math.min(...times),
  updated_covers: !times.length || Date.parse(conversation.updated_at) >= Math.max(...times) - 2000,
  hits: {
    name: at('Kenen nimellä varaan'),
    tomorrow: at('Huomenna olisi hyvä päivä'),
    jaska: at('Joku jaskanen'),
  },
  texts,
} }]
"""


def call(method, path, body=None):
    try:
        return gate.request(method, path, body)
    except urllib.error.HTTPError as error:
        detail = error.read().decode('utf-8', 'replace')[:2000]
        raise SystemExit(f'{method} {path} -> HTTP {error.code}: {detail}') from error


def settings_of(workflow):
    current = workflow.get('settings') or {}
    kept = {key: current[key] for key in SETTINGS_KEEP if key in current}
    if kept.get('saveDataSuccessExecution') not in (None, 'none'):
        raise SystemExit(f"refusing to change saveDataSuccessExecution from {kept.get('saveDataSuccessExecution')}")
    kept['saveDataSuccessExecution'] = 'none'
    return kept


def patch(workflow):
    nodes = json.loads(json.dumps(workflow['nodes']))
    found = {node['name']: node for node in nodes}
    for name in ('Prepare staging thread', 'Staging chats', 'All staging chats', 'Shape staging list', 'Merge staging chats'):
        if name not in found:
            raise SystemExit(f'missing node {name}')
    found['Prepare staging thread']['parameters']['jsCode'] = PREPARE_JS
    found['Staging chats']['parameters']['query'] = LIST_SQL
    found['All staging chats']['parameters']['query'] = LIST_SQL
    found['Shape staging list']['parameters']['jsCode'] = SHAPE_JS
    found['Merge staging chats']['parameters']['jsCode'] = MERGE_JS
    return {'name': workflow['name'], 'nodes': nodes, 'connections': workflow['connections'], 'settings': settings_of(workflow)}


def check_collapse():
    parsed = "new Function(" + json.dumps(PREPARE_JS) + "); new Function(" + json.dumps(SHAPE_JS) + "); new Function(" + json.dumps(MERGE_JS) + "); new Function(" + json.dumps(CHECK_JS) + ");"
    syntax = subprocess.run(['node', '-e', parsed], capture_output=True, text=True)
    if syntax.returncode != 0:
        raise SystemExit(syntax.stderr)
    harness = HELPERS + r"""
const filters = { p_query: 'jaskanen', p_versions: null, p_feedback: null, p_from: null, p_to: null }
const rows = [
  { id: 'old', phone_key: '358', title: 'ABC-848', version_id: 'v15', version_number: 15, started_by: 'a', created_at: '2026-11-02T08:00:00.000Z', updated_at: '2026-11-02T09:00:00.000Z', message_count: 11, thumbs_up: 1, thumbs_down: 0, last_reply: 'Kenen nimellä varaan?', texts: ['Kenen nimellä varaan?', 'Joku jaskanen vain vanhassa'] },
  { id: 'new', phone_key: '358', title: 'Later', version_id: 'v16', version_number: 16, started_by: 'b', created_at: '2026-11-02T10:00:00.000Z', updated_at: '2026-11-02T11:00:00.000Z', message_count: 4, thumbs_up: 0, thumbs_down: 2, last_reply: '', texts: ['Huomenna'] },
  { id: 'empty', phone_key: '358', title: 'Reset', version_id: 'v17', version_number: 17, started_by: 'c', created_at: '2026-11-02T11:30:00.000Z', updated_at: '2026-11-02T11:30:00.000Z', message_count: 0, thumbs_up: 0, thumbs_down: 0, last_reply: '', texts: [] },
  { id: 'other', phone_key: '999', title: 'Other', version_id: 'v9', version_number: 9, started_by: null, created_at: '2026-11-02T07:00:00.000Z', updated_at: '2026-11-02T12:00:00.000Z', message_count: 1, thumbs_up: 0, thumbs_down: 0, last_reply: 'hei', texts: ['hei'] },
]
const collapsed = collapseByPhone(mapStaging(rows)).filter((item) => keepCollapsed(filters, item)).map(present)
if (collapsed.length !== 1) throw new Error('query must keep the phone when any fragment matches')
const phone = collapsed[0]
if (phone.id !== 'empty' || phone.title !== 'Reset' || phone.versionId !== 'v17' || phone.versionNumber !== 17) throw new Error('newest id/title/version: ' + JSON.stringify(phone))
if (phone.messageCount !== 15 || phone.thumbsUp !== 1 || phone.thumbsDown !== 2) throw new Error('sums: ' + JSON.stringify(phone))
if (phone.createdAt !== '2026-11-02T08:00:00.000Z' || phone.updatedAt !== '2026-11-02T11:30:00.000Z') throw new Error('span: ' + JSON.stringify(phone))
if (phone.lastReply !== 'Kenen nimellä varaan?') throw new Error('last reply: ' + phone.lastReply)
if (phone.phoneKey || phone.texts) throw new Error('list item leaked helper fields')
const versions = collapseByPhone(mapStaging(rows)).filter((item) => keepCollapsed({ p_versions: [15], p_feedback: null }, item))
if (versions.length !== 1) throw new Error('version filter must see older fragments')
const dated = collapseByPhone(mapStaging(rows)).filter((item) => keepCollapsed({ p_from: '2026-11-02T11:00:00.000Z', p_to: '2026-11-02T12:00:00.000Z', p_feedback: null }, item))
if (dated.length !== 1 || dated[0].id !== 'empty') throw new Error('date filter must accept any fragment')
const many = []
for (let i = 0; i < 60; i++) {
  many.push({ id: 'frag-' + i, phone_key: '358', title: 'T', version_id: 'v', version_number: 16, started_by: null, created_at: '2026-11-02T08:00:00.000Z', updated_at: '2026-11-02T09:00:00.000Z', message_count: 1, thumbs_up: 0, thumbs_down: 0, last_reply: 'a', texts: ['x'] })
}
many.push({ id: 'solo', phone_key: '111', title: 'Solo', version_id: 'v', version_number: 16, started_by: null, created_at: '2026-11-02T08:00:00.000Z', updated_at: '2026-11-02T10:00:00.000Z', message_count: 3, thumbs_up: 0, thumbs_down: 0, last_reply: 'b', texts: ['y'] })
const playground = [{ id: 'play-1', versionId: null, versionNumber: null, isDraft: true, source: 'playground', title: 'Play', startedBy: null, createdAt: '2026-11-02T06:00:00.000Z', updatedAt: '2026-11-02T13:00:00.000Z', messageCount: 2, thumbsUp: 0, thumbsDown: 0, lastReply: 'ok' }]
const listed = collapseByPhone([...playground, ...mapStaging(many)]).map(present).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 50)
if (listed.length !== 3) throw new Error('collapse must run before the 50 slice, got ' + listed.length)
if (listed[0].id !== 'play-1' || listed[0].source !== 'playground') throw new Error('playground row without phoneKey was merged')
const summed = listed.find((item) => item.messageCount === 60)
if (!summed) throw new Error('phone fragments were not summed')
console.log('collapse ok')
"""
    path = Path('/tmp/k1-phone-thread-check.js')
    path.write_text(harness)
    result = subprocess.run(['node', str(path)], capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(result.stdout + result.stderr)
    print(result.stdout.strip())


def thread_sql(conversation_id):
    if conversation_id != OPENED:
        raise SystemExit('verify id changed')
    return THREAD_QUERY.replace('__CONVERSATION_ID__', conversation_id)


def run_select(sql):
    suffix = uuid.uuid4().hex[:10]
    path = 'k1-phone-thread-check-' + suffix
    nodes = [
        {'id': str(uuid.uuid4()), 'name': 'Webhook', 'type': 'n8n-nodes-base.webhook', 'typeVersion': 2, 'position': [0, 0], 'webhookId': str(uuid.uuid4()),
         'parameters': {'httpMethod': 'POST', 'path': path, 'responseMode': 'lastNode', 'options': {}}},
        {'id': str(uuid.uuid4()), 'name': 'Read', 'type': 'n8n-nodes-base.postgres', 'typeVersion': 2.6, 'position': [280, 0],
         'credentials': POSTGRES, 'parameters': {'operation': 'executeQuery', 'query': sql, 'options': {}}},
        {'id': str(uuid.uuid4()), 'name': 'Check', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [560, 0],
         'parameters': {'mode': 'runOnceForAllItems', 'jsCode': CHECK_JS}},
    ]
    connections = {
        'Webhook': {'main': [[{'node': 'Read', 'type': 'main', 'index': 0}]]},
        'Read': {'main': [[{'node': 'Check', 'type': 'main', 'index': 0}]]},
    }
    created = call('POST', '/workflows', {'name': 'tmp phone thread ' + suffix[:5], 'nodes': nodes, 'connections': connections, 'settings': {'executionOrder': 'v1', 'saveDataSuccessExecution': 'none', 'saveDataErrorExecution': 'all'}})
    wid = created['id']
    try:
        call('POST', f'/workflows/{wid}/activate')
        url = (gate.local_env().get('N8N_RAPID_BASE_URL') or gate.DEFAULT_BASE).rstrip('/') + '/webhook/' + path
        last = None
        for _ in range(15):
            request = urllib.request.Request(url, data=b'{}', method='POST', headers={'Content-Type': 'application/json'})
            try:
                with urllib.request.urlopen(request, timeout=90) as response:
                    return json.load(response)
            except urllib.error.HTTPError as error:
                last = f'HTTP {error.code}: {error.read().decode("utf-8", "replace")[:800]}'
                if error.code != 404:
                    raise SystemExit(last)
                time.sleep(2)
        raise SystemExit(last or 'webhook never became reachable')
    finally:
        try:
            call('POST', f'/workflows/{wid}/deactivate')
        except SystemExit:
            pass
        for _ in range(6):
            try:
                call('DELETE', f'/workflows/{wid}')
                print('deleted temporary workflow', wid)
                break
            except SystemExit:
                time.sleep(2)
        else:
            raise SystemExit(f'could not delete temporary workflow {wid}')


def unwrap(result):
    if isinstance(result, list):
        result = result[0] if result else {}
    if isinstance(result, dict) and 'hits' not in result and isinstance(result.get('json'), dict):
        result = result['json']
    return result


def assert_thread(result):
    result = unwrap(result)
    hits = result.get('hits') or {}
    order = [hits.get('name'), hits.get('tomorrow'), hits.get('jaska')]
    texts = result.get('texts') or []
    if result.get('id') != OPENED or result.get('source') != 'staging':
        raise SystemExit(f"opened conversation was not preserved: {result.get('id')} {result.get('source')}")
    if not (result.get('n', 0) > 11 and result.get('message_count') == result.get('non_openers')):
        raise SystemExit(f"counts do not cover the phone: {json.dumps({k: result.get(k) for k in ('n', 'message_count', 'non_openers')})}")
    if any(index is None or index < 0 for index in order) or not (order[0] < order[1] and order[1] < order[2]):
        preview = [text.replace('\n', ' ')[:140] for text in texts]
        raise SystemExit('stitched messages missing the later turns: ' + json.dumps(preview, ensure_ascii=False))
    if not result.get('created_covers') or not result.get('updated_covers'):
        raise SystemExit(f"timestamps do not span the phone: created {result.get('created_at')} updated {result.get('updated_at')}")
    print('stitched', OPENED, 'messages', result['n'], 'counted', result['message_count'], 'last_reply_len', len(result.get('last_reply') or ''))


def deployed_query(js):
    runner = "const $ = () => ({ first: () => ({ json: { query: { id: " + json.dumps(OPENED) + " } } }) });\nconst produced = (() => {\n" + js + "\n})();\nprocess.stdout.write(produced[0].json.query);\n"
    path = Path('/tmp/k1-phone-thread-query.js')
    path.write_text(runner)
    result = subprocess.run(['node', str(path)], capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(result.stderr)
    return result.stdout


def assert_live(workflow):
    nodes = {node['name']: node for node in workflow['nodes']}
    prepare = nodes['Prepare staging thread']['parameters']['jsCode']
    if 'c.phone_key = o.phone_key' not in prepare or 'join k1_staging_conversations c' not in prepare:
        raise SystemExit('live thread query is missing the phone_key join')
    if deployed_query(prepare).strip() != thread_sql(OPENED).strip():
        raise SystemExit('live Prepare staging thread SQL drifted from the stitched query')
    for name in ('Staging chats', 'All staging chats'):
        if nodes[name]['parameters']['query'] != LIST_SQL:
            raise SystemExit(f'{name} is missing phone_key')
    for name in ('Shape staging list', 'Merge staging chats'):
        code = nodes[name]['parameters']['jsCode']
        if 'function collapseByPhone' not in code or code.find('collapseByPhone(') > code.find('.slice('):
            raise SystemExit(f'{name} does not collapse before the slice')
    if not workflow.get('active'):
        raise SystemExit('workflow is not active')
    if workflow.get('settings', {}).get('saveDataSuccessExecution') != 'none':
        raise SystemExit('saveDataSuccessExecution changed')
    print('live nodes contain the phone_key join and the list collapse')


def apply_live(workflow):
    body = patch(workflow)
    call('POST', f'/workflows/{WORKFLOW}/deactivate')
    try:
        call('PUT', f'/workflows/{WORKFLOW}', body)
    finally:
        call('POST', f'/workflows/{WORKFLOW}/activate')
    saved = call('GET', f'/workflows/{WORKFLOW}')
    assert_live(saved)
    return saved


def main():
    if 'c.phone_key = o.phone_key' not in PREPARE_JS or "'phone_key', c.phone_key" not in LIST_SQL:
        raise SystemExit('patch text lost the phone join')
    check_collapse()
    print('checking stitched sql before the live edit')
    assert_thread(run_select(thread_sql(OPENED)))
    workflow = call('GET', f'/workflows/{WORKFLOW}')
    Path('/tmp').mkdir(exist_ok=True)
    Path(f'/tmp/{WORKFLOW}-before-phone-thread.json').write_text(json.dumps(workflow))
    apply_live(workflow)
    print('active', call('GET', f'/workflows/{WORKFLOW}')['active'])


if __name__ == '__main__':
    main()
