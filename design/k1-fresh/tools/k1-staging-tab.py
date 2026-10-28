#!/usr/bin/env python3
"""Staging tab on the live K1 WhatsApp number.

Patches the live listener so a phone sent from Staging uses that saved version.
WhatsApp with no pin uses the active playground version, and a playground chat
uses the version selected for that turn. The inactive workflow "K1 v10 staging"
is not activated.

  python3 k1-staging-tab.py dry      patch the newest backups in memory
  python3 k1-staging-tab.py apply    back up, migrate, and update the live workflows
  python3 k1-staging-tab.py publish  staging thumbs, feedback webhook, and the 004e price rule
  python3 k1-staging-tab.py electric book 004e on the standard inspection, without measuring

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
FEEDBACK = 'gRUR5dxaG4bvu8FN'
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
BRIEF_PINNED = "{{ ($('Build Turn').isExecuted && $('Build Turn').first().json.staging_prompt) ? $('Build Turn').first().json.staging_prompt : $('⚙️ CONFIG').first().json.business_prompt }}"
BRIEF_STAGING = "{{ $('Playground Turn').isExecuted && $('Playground').first().json.body.masterPrompt ? ($('Playground').first().json.body.masterPrompt + ($('Playground').first().json.body.additionalInformation ? '\\n\\n' + $('Playground').first().json.body.additionalInformation : '')) : (($('Build Turn').isExecuted && $('Build Turn').first().json.staging_prompt) ? $('Build Turn').first().json.staging_prompt : $('⚙️ CONFIG').first().json.business_prompt) }}"
PROMPT_V13 = ROOT / 'prompts/k1-whatsapp-prompt-v13.md'
PAYMENT_DESCRIPTION = (
    'Stripe test checkout url for a booking already made in this chat. '
    'Call it only when the business brief for this turn says in-chat payment is enabled and the customer has chosen to pay now. '
    'If the brief says create_payment_link is not enabled, never call it. '
    'Pass the booking number, station name, and the confirmed weekday, date and time. Returns url.'
)
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


# Wasup refuses sendText when the chat has no privacy token. sendRaw accepts
# allowColdWithoutToken. Typing and delay stay off on that fallback: with them
# on, n8n hits its 300s timeout while Wasup still delivers afterwards, and a
# second attempt of the same bubble arrives as a duplicate. A typed reset is
# also seen as a person sending from the phone, which pauses the bot on that chat.
COLD_SEND_RAW = "={{ JSON.stringify({ to: $json.to_phone, message: $json.text, linkPreview: false, allowColdWithoutToken: true, typingSimulation: false, delayEnabled: false }) }}"
SEND_RAW = {
    'Send Bubble': COLD_SEND_RAW,
    'Send Double-Text': COLD_SEND_RAW,
    'Send Reset Notice': "={{ JSON.stringify({ to: $('Webhook').first().json.body.from_phone, message: 'Conversation RESET (' + DateTime.now().toFormat('HH:mm:ss') + ')', linkPreview: false, allowColdWithoutToken: true, typingSimulation: false, delayEnabled: false }) }}",
    'Send Bubble CTA': "={{ JSON.stringify({ to: $json.to_phone, text: $json.cta_body, ctaUrl: $json.cta_url ? { url: $json.cta_url, label: $json.cta_label } : undefined, linkPreview: false, allowColdWithoutToken: true, typingSimulation: true, delayEnabled: true }) }}",
    'Send Double-Text CTA': "={{ JSON.stringify({ to: $json.to_phone, text: $json.cta_body, ctaUrl: $json.cta_url ? { url: $json.cta_url, label: $json.cta_label } : undefined, linkPreview: false, allowColdWithoutToken: true, typingSimulation: true, delayEnabled: true }) }}",
}
RECENT_SENDS_URL = f'https://wasup.northeurope.cloudapp.azure.com/api/instances/{INSTANCE}/messages?limit=30'
ONCE_GUARDS = {
    'Send Bubble': ('Hold Bubble Text', 'Recent Bubble Sends', 'Bubble Already Sent?', 'Send Bubble Again?'),
    'Send Double-Text': ('Hold Double-Text', 'Recent Double-Text Sends', 'Double-Text Already Sent?', 'Send Double-Text Again?'),
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


QUEUE_OLD = """WITH ins AS (
  INSERT INTO inbound_message_queue (message_id, from_phone, to_phone, message, created_at)
  VALUES (
    '{{ $('Webhook').first().json.body.message_id }}',
    '{{ $('Webhook').first().json.body.from_phone }}',
    '{{ $('Webhook').first().json.body.to_phone }}',
    '{{ ($('Webhook').first().json.body.message || '').replace(/'/g, "''") }}',
    COALESCE(NULLIF('{{ $('Webhook').first().json.body.created_at || '' }}', '')::timestamptz, NOW())
  )
  ON CONFLICT (message_id) DO NOTHING
  RETURNING id
),"""

QUEUE_NEW = """WITH incoming AS (
  SELECT
    '{{ $('Webhook').first().json.body.message_id }}' AS message_id,
    '{{ $('Webhook').first().json.body.from_phone }}' AS from_phone,
    '{{ $('Webhook').first().json.body.to_phone }}' AS to_phone,
    '{{ ($('Webhook').first().json.body.message || '').replace(/'/g, "''") }}' AS message,
    COALESCE(NULLIF('{{ $('Webhook').first().json.body.created_at || '' }}', '')::timestamptz, NOW()) AS created_at,
    lower('{{ String($('Webhook').first().json.body.event || 'message').replace(/'/g, '') }}') AS event,
    lower('{{ String($('Webhook').first().json.body.status || 'received').replace(/'/g, '') }}') AS status
),
ins AS (
  INSERT INTO inbound_message_queue (message_id, from_phone, to_phone, message, created_at)
  SELECT message_id, from_phone, to_phone, message, created_at
  FROM incoming
  WHERE length(trim(coalesce(message, ''))) > 0
    AND event = 'message'
    AND status IN ('received', '')
  ON CONFLICT (message_id) DO NOTHING
  RETURNING id
),"""

LATEST_OLD = """SELECT COALESCE(
  (SELECT last_inbound_message_id FROM conversation_state WHERE session_key = '{{ $('⚙️ CONFIG').first().json.tenant_key }}_{{ $('Webhook').first().json.body.from_phone }}')
  = '{{ $('Webhook').first().json.body.message_id }}', FALSE) AS is_latest;"""

LATEST_NEW = """SELECT NOT EXISTS (
  SELECT 1 FROM inbound_message_queue q
  WHERE regexp_replace(q.from_phone, '\\D', '', 'g') = regexp_replace('{{ $('Webhook').first().json.body.from_phone }}', '\\D', '', 'g')
    AND q.message_id IS DISTINCT FROM '{{ $('Webhook').first().json.body.message_id }}'
    AND length(trim(coalesce(q.message, ''))) > 0
    AND q.created_at > COALESCE(
      (SELECT created_at FROM inbound_message_queue WHERE message_id = '{{ $('Webhook').first().json.body.message_id }}'),
      NOW()
    )
) AS is_latest;"""


def only_customer_messages(nodes):
    """A delivery receipt is not a new customer turn.

    Wasup posts a fresh id when a tick arrives. The old queue treated that id
    as the latest inbound, so the answer was saved and the send was skipped.
    Only a non-empty message with status received is queued, and an execution
    stays latest unless a newer customer text is actually waiting.
    """
    named = {item['name']: item for item in nodes}
    queue = named.get('Queue Inbound')
    if queue and QUEUE_OLD in (queue['parameters'].get('query') or ''):
        queue['parameters']['query'] = queue['parameters']['query'].replace(QUEUE_OLD, QUEUE_NEW, 1)
    latest = named.get('Am I The Latest?')
    if latest and (latest['parameters'].get('query') or '').strip() == LATEST_OLD.strip():
        latest['parameters']['query'] = LATEST_NEW


HOLD_JS = """// Wasup closes this webhook after 10s. A real customer message stays open until
// Plan Delivery has a first bubble, or 8s. That text goes back as {reply} so
// Wasup can run its typing choreographer. Test events (10-digit from_phone)
// and non-messages return {skip:true} immediately and never include reply.
// Do not wait on the send nodes: the send waits on this hold.
const body = $('Webhook').first().json.body || {}
const event = String(body.event || 'message').toLowerCase()
const incoming = String(body.message || '').trim()
const digits = String(body.from_phone || '').replace(/\\D/g, '')
if (event !== 'message' || !incoming || digits.length === 10) return [{ json: { skip: true } }]
const limit = Date.now() + 8000
function firstText() {
  try {
    if (!$('Plan Delivery').isExecuted) return ''
    const items = $('Plan Delivery').all()
    for (const item of items) {
      const row = item.json || {}
      const text = String(row.text || '').trim()
      if (Number(row.seq) === 1 && text) return text
    }
  } catch (error) {}
  return ''
}
let text = ''
while (Date.now() < limit) {
  text = firstText()
  if (text) break
  await new Promise((resolve) => setTimeout(resolve, 200))
}
if (!text) return [{ json: { skip: true } }]
return [{ json: { reply: text } }]
"""

ACK_BODY = '={{ $json.reply ? { reply: $json.reply } : { skip: true } }}'

MERGE_CHECK_JS = """let bubble;
try { bubble = $('Loop Bubbles').first().json; } catch (e) { bubble = null; }
if (!bubble || bubble.text === undefined) bubble = $('Plan Delivery').first().json;
const db = $input.first().json || {};
const rem = Number(db.typing_remaining_seconds || 0);
const slice = Math.min(Math.max(rem, 0), Number(($('⚙️ CONFIG').first().json.typing_recheck_seconds) || 3));
const limit = Date.now() + 1000
let hold = null
while (Date.now() < limit) {
  try {
    if ($('Hold For Composing').isExecuted) {
      hold = $('Hold For Composing').first().json || {}
      break
    }
  } catch (error) {}
  await new Promise((resolve) => setTimeout(resolve, 100))
}
const reply = hold && typeof hold.reply === 'string' ? hold.reply.trim() : ''
const owned = Number(bubble.seq) === 1 && !!reply && reply === String(bubble.text || '').trim()
return [{ json: {
  ...bubble,
  skip_send: owned ? true : bubble.skip_send === true,
  webhook_owned: owned,
  user_replied: db.user_replied === true,
  user_typing: db.user_typing === true,
  typing_remaining_seconds: rem,
  typing_wait_seconds: slice > 0 ? slice : Number(($('⚙️ CONFIG').first().json.typing_recheck_seconds) || 3)
} }];
"""

PAUSE_REPLY_JS = """// Plan Delivery has already unblocked the hold. Give Wasup a moment to accept
// {reply} before the read-only check. This sleep does not send a message.
await new Promise((resolve) => setTimeout(resolve, 2000))
return [{ json: $input.first().json || {} }]
"""

REPLY_LANDED_JS = """const bubble = $('Pause For Reply').first().json || {}
const reply = String(bubble.text || '').trim()
const digits = String(bubble.to_phone || '').replace(/\\D/g, '')
const body = $('Webhook').first().json.body || {}
const since = Date.parse(body.created_at || '') || 0
const floor = since || (Date.now() - 30000)
function norm(value) {
  return String(value || '').replace(/\\s+/g, ' ').trim()
}
const needle = norm(reply).slice(0, 24)
function sameText(value) {
  const hay = norm(value)
  if (!needle) return false
  if (needle.length < 8) return hay === norm(reply)
  return hay.includes(needle) || norm(reply).startsWith(hay.slice(0, needle.length))
}
function read(name) {
  try { return $(name).first().json || {} } catch (error) { return null }
}
const logsBody = read('Read Reply Logs')
const messagesBody = read('Read Reply Messages')
const logs = logsBody && Array.isArray(logsBody.logs) ? logsBody.logs : null
const messages = messagesBody && Array.isArray(messagesBody.messages) ? messagesBody.messages : null
const readable = logs !== null && messages !== null
let landed = false
if (messages) {
  landed = messages.some((message) => {
    if (String(message.direction || '') !== 'outbound') return false
    if (!sameText(message.text)) return false
    const toDigits = String(message.to || '').replace(/\\D/g, '')
    if (digits && toDigits && toDigits !== digits) return false
    const at = Date.parse(message.timestamp || '')
    if (Number.isFinite(at) && at + 5000 < floor) return false
    return true
  })
}
let coldAfter = false
if (logs && digits.length >= 11) {
  for (const line of logs) {
    const at = Date.parse(line.timestamp || '')
    if (Number.isFinite(at) && at + 1000 < floor) continue
    const msg = String(line.message || '')
    if (!msg.replace(/\\D/g, '').includes(digits)) continue
    if (/Sent to/.test(msg) && sameText(msg)) landed = true
    if (/Cold send blocked|classified as COLD/.test(msg)) coldAfter = true
  }
}
function plans(name) {
  const payload = read(name)
  if (!payload) return null
  const root = payload.antibanV2 || payload
  const stats = ((root.stats || {}).presence) || null
  if (!stats) return null
  const count = Number(stats.typingPlansExecuted)
  return Number.isFinite(count) ? count : null
}
const before = plans('Typing Baseline')
const after = plans('Read Reply Antiban')
const typingStarted = before !== null && after !== null && after > before
let send_fallback = false
if (bubble.user_replied === true || landed || typingStarted) send_fallback = false
else if (coldAfter || readable) send_fallback = true
return [{ json: { ...bubble, send_fallback, webhook_landed: landed } }]
"""

WASUP_READS = {
    'Typing Baseline': 'https://wasup.northeurope.cloudapp.azure.com/api/instances/wa_mt1j5bcl_sch23/antiban-v2',
    'Read Reply Logs': 'https://wasup.northeurope.cloudapp.azure.com/api/instances/wa_mt1j5bcl_sch23/logs?limit=80',
    'Read Reply Antiban': 'https://wasup.northeurope.cloudapp.azure.com/api/instances/wa_mt1j5bcl_sch23/antiban-v2',
    'Read Reply Messages': 'https://wasup.northeurope.cloudapp.azure.com/api/instances/wa_mt1j5bcl_sch23/messages?direction=outbound&limit=15',
}


def wasup_get(nodes, named, name, url, position):
    params = {
        'method': 'GET',
        'url': url,
        'authentication': 'predefinedCredentialType',
        'nodeCredentialType': 'wasupApi',
        'options': {'timeout': 15000},
    }
    if name in named:
        named[name]['parameters'] = params
        named[name]['credentials'] = json.loads(json.dumps(WASUP))
        named[name]['onError'] = 'continueRegularOutput'
        return
    item = node(name, 'n8n-nodes-base.httpRequest', 4.2, position, params, json.loads(json.dumps(WASUP)), {'onError': 'continueRegularOutput'})
    nodes.append(item)
    named[name] = item


def true_if(left):
    return {
        'conditions': {
            'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2},
            'conditions': [{'id': str(uuid.uuid4()), 'leftValue': left, 'rightValue': '', 'operator': {'type': 'boolean', 'operation': 'true', 'singleValue': True}}],
            'combinator': 'and',
        },
        'looseTypeValidation': True,
        'options': {},
    }


def hold_composing(nodes, connections):
    """Hold the Wasup webhook open, then pass {reply} through only for a real customer."""
    named = {item['name']: item for item in nodes}
    ack = named.get('Ack Webhook (empty)')
    webhook = connections.get('Webhook')
    if not ack or not webhook:
        return
    ack['parameters']['responseBody'] = ACK_BODY
    if 'Hold For Composing' not in named:
        pos = ack.get('position') or [0, 0]
        nodes.append(node('Hold For Composing', 'n8n-nodes-base.code', 2, [pos[0] - 220, pos[1]], {
            'mode': 'runOnceForAllItems', 'jsCode': HOLD_JS,
        }))
    else:
        named['Hold For Composing']['parameters']['jsCode'] = HOLD_JS
    links = webhook.get('main', [[]])[0] or []
    kept = [link for link in links if link.get('node') != 'Ack Webhook (empty)']
    if not any(link.get('node') == 'Hold For Composing' for link in kept):
        kept.append({'node': 'Hold For Composing', 'type': 'main', 'index': 0})
    webhook['main'][0] = kept
    connections['Hold For Composing'] = link('Ack Webhook (empty)')


def hand_webhook_reply(nodes, connections):
    """Hand the first bubble to Wasup as {reply}, and sendRaw only if that reply did not land.

    The confirmation reads are GET logs, message history, and antiban stats.
    None of them include a recipient, so they cannot deliver a chat message.
    """
    named = {item['name']: item for item in nodes}
    merge = named.get('Merge Check')
    webhook = connections.get('Webhook')
    if not merge or not webhook or 'Send Bubble' not in named or 'Skip Bubble' not in named:
        return
    merge['parameters']['mode'] = 'runOnceForAllItems'
    merge['parameters']['jsCode'] = MERGE_CHECK_JS
    spot = merge.get('position') or [0, 0]
    wasup_get(nodes, named, 'Typing Baseline', WASUP_READS['Typing Baseline'], [spot[0] - 3400, spot[1] - 280])
    links = webhook.get('main', [[]])[0] or []
    if not any(item.get('node') == 'Typing Baseline' for item in links):
        links.append({'node': 'Typing Baseline', 'type': 'main', 'index': 0})
    webhook['main'][0] = links
    if 'Pause For Reply' not in named:
        nodes.append(node('Pause For Reply', 'n8n-nodes-base.code', 2, [spot[0] + 220, spot[1] + 220], {
            'mode': 'runOnceForAllItems', 'jsCode': PAUSE_REPLY_JS,
        }))
    else:
        named['Pause For Reply']['parameters']['jsCode'] = PAUSE_REPLY_JS
    wasup_get(nodes, named, 'Read Reply Logs', WASUP_READS['Read Reply Logs'], [spot[0] + 440, spot[1] + 220])
    wasup_get(nodes, named, 'Read Reply Antiban', WASUP_READS['Read Reply Antiban'], [spot[0] + 660, spot[1] + 220])
    wasup_get(nodes, named, 'Read Reply Messages', WASUP_READS['Read Reply Messages'], [spot[0] + 880, spot[1] + 220])
    if 'Reply Landed?' not in named:
        nodes.append(node('Reply Landed?', 'n8n-nodes-base.code', 2, [spot[0] + 1100, spot[1] + 220], {
            'mode': 'runOnceForAllItems', 'jsCode': REPLY_LANDED_JS,
        }))
    else:
        named['Reply Landed?']['parameters']['jsCode'] = REPLY_LANDED_JS
    if 'Webhook Reply?' not in named:
        nodes.append(node('Webhook Reply?', 'n8n-nodes-base.if', 2.2, [spot[0] + 220, spot[1]], true_if('={{ $json.webhook_owned === true }}')))
    else:
        named['Webhook Reply?']['parameters'] = true_if('={{ $json.webhook_owned === true }}')
    if 'Send Fallback?' not in named:
        nodes.append(node('Send Fallback?', 'n8n-nodes-base.if', 2.2, [spot[0] + 1320, spot[1] + 220], true_if('={{ $json.send_fallback === true }}')))
    else:
        named['Send Fallback?']['parameters'] = true_if('={{ $json.send_fallback === true }}')
    previous = connections.get('Merge Check', {}).get('main', [[]])[0] or []
    false_target = 'Still Our Turn?'
    if previous and previous[0].get('node') not in ('Webhook Reply?',):
        false_target = previous[0]['node']
    elif 'Webhook Reply?' in connections:
        false_branch = connections['Webhook Reply?'].get('main', [[], []])
        if len(false_branch) > 1 and false_branch[1]:
            false_target = false_branch[1][0]['node']
    connections['Merge Check'] = link('Webhook Reply?')
    connections['Webhook Reply?'] = {'main': [
        [{'node': 'Pause For Reply', 'type': 'main', 'index': 0}],
        [{'node': false_target, 'type': 'main', 'index': 0}],
    ]}
    connections['Pause For Reply'] = link('Read Reply Logs')
    connections['Read Reply Logs'] = link('Read Reply Antiban')
    connections['Read Reply Antiban'] = link('Read Reply Messages')
    connections['Read Reply Messages'] = link('Reply Landed?')
    connections['Reply Landed?'] = link('Send Fallback?')
    fallback_target = 'Hold Bubble Text' if any(item['name'] == 'Hold Bubble Text' for item in nodes) else 'Send Bubble'
    connections['Send Fallback?'] = {'main': [
        [{'node': fallback_target, 'type': 'main', 'index': 0}],
        [{'node': 'Skip Bubble', 'type': 'main', 'index': 0}],
    ]}


OFFER_TIME_JS = r"""const wantsTime = /reconcil|täsm|tasma|stämmer inte|somewhere else|muualle|annanstan|somwehre/i.test(rawUser)
if (wantsTime && msgs.length && !msgs.join('\n').includes('?')) {
  const sample = (rawUser + '\n' + msgs.join('\n')).toLowerCase()
  const swedish = /\b(varför|jag|inte|stämmer|annanstan|besikt)\b/.test(sample)
  const finnish = /[äö]|miksi|mitä|lähden|muualle|etsitä/.test(sample)
  const ask = finnish && !swedish ? 'Etsitäänkö silti aika?' : swedish ? 'Ska jag hitta en tid?' : 'Want me to find you a time?'
  msgs[msgs.length - 1] = msgs[msgs.length - 1].replace(/[.!\s]+$/, '') + '. ' + ask
}
"""


def ensure_active_version(nodes, connections):
    """WhatsApp with no pinned phone reads the active playground version."""
    named = {item['name']: item for item in nodes}
    if 'Fetch active version' not in named:
        load = named.get('Load Staging Session')
        spot = load['position'] if load else [0, 0]
        nodes.append(node(
            'Fetch active version', 'n8n-nodes-base.httpRequest', 4.2, [spot[0], spot[1] + 180],
            {
                'method': 'GET',
                'url': 'https://wuejgskyjzuffqsgvunp.supabase.co/rest/v1/agent_builder_active_config?tenant_key=eq.k1_katsastus_demo&select=version_number,master_prompt,additional_information',
                'authentication': 'predefinedCredentialType',
                'nodeCredentialType': 'supabaseApi',
                'options': {'timeout': 15000},
            },
            SUPABASE,
            {'onError': 'continueRegularOutput'},
        ))
    chain_staging_lookup(connections)


def prompt_v13():
    return PROMPT_V13.read_text().strip() + '\n'


def install_prompt_hook(nodes, connections):
    """Point WhatsApp and the playground at the saved versions. v13 is the fallback brief."""
    named = {item['name']: item for item in nodes}
    prompt = prompt_v13()
    if 'documented but NOT ENABLED FOR K1' not in prompt:
        raise SystemExit('v13 prompt is missing the payment rule')
    for item in named['⚙️ CONFIG']['parameters']['assignments']['assignments']:
        if item['name'] == 'business_prompt':
            item['value'] = prompt
    for agent_name in ('AI Agent', 'Follow-up Agent'):
        message = named[agent_name]['parameters']['options']['systemMessage']
        if BRIEF_STAGING not in message:
            if BRIEF_PINNED in message:
                message = must_replace(message, BRIEF_PINNED, BRIEF_STAGING, agent_name)
            elif BRIEF in message:
                message = must_replace(message, BRIEF, BRIEF_STAGING, agent_name)
            else:
                raise SystemExit(f'{agent_name} has no business brief expression')
        named[agent_name]['parameters']['options']['systemMessage'] = message
    turn = named['Build Turn']['parameters']['jsCode']
    old_line = "staging_prompt: stagingSession ? String(stagingSession.prompt || '') : '',"
    new_line = "staging_prompt: stagingSession ? String(stagingSession.prompt || '') : String(row.defaultPrompt || ''),"
    if new_line not in turn:
        turn = must_replace(turn, old_line, new_line, 'Build Turn default prompt')
        named['Build Turn']['parameters']['jsCode'] = turn
    if 'create_payment_link' in named:
        named['create_payment_link']['parameters']['description'] = PAYMENT_DESCRIPTION
    if 'Merge Staging' in named:
        named['Merge Staging']['parameters']['jsCode'] = MERGE_STAGING
    ensure_active_version(nodes, connections)


def chain_staging_lookup(connections):
    """Run the staging lookup to the end before the debounce Wait starts.

    n8n runs one sibling to the end, and a Wait is the sibling it runs first even
    when it is listed last. The plate, the station, the power type and the sandbox
    save are read on the other siblings, so they have to finish before that Wait.
    """
    incoming = connections.get('New Message?', {}).get('main') or []
    if not incoming or 'Fetch staging version' not in connections or 'Debounce' not in connections:
        return
    first = incoming[0]
    if not any(item.get('node') == 'Load Staging Session' for item in first):
        return
    rest = [item for item in first if item.get('node') not in ('Load Staging Session', 'Fetch active version', 'Debounce')]
    incoming[0] = [{'node': 'Load Staging Session', 'type': 'main', 'index': 0}] + rest
    assigned = connections.get('Staging assigned?', {}).get('main')
    if not assigned:
        return
    while len(assigned) < 2:
        assigned.append([])
    assigned[0] = [{'node': 'Fetch staging version', 'type': 'main', 'index': 0}]
    assigned[1] = [{'node': 'Fetch active version', 'type': 'main', 'index': 0}]
    connections['Fetch staging version'] = link('Fetch active version')
    connections['Fetch active version'] = link('Debounce')


def prefetch_staging(nodes, connections):
    """Read the assigned version before the debounce Wait, so the model sees the lead."""
    named = {item['name']: item for item in nodes}
    merge = named.get('Merge Staging')
    incoming = connections.get('New Message?', {}).get('main') or []
    if not merge or not incoming:
        return
    merge['parameters']['jsCode'] = MERGE_STAGING
    first = incoming[0]
    if not any(item.get('node') == 'Load Staging Session' for item in first):
        first.append({'node': 'Load Staging Session', 'type': 'main', 'index': 0})
    connections['Drain Queue'] = link('Merge Staging')
    ensure_active_version(nodes, connections)
    chain_staging_lookup(connections)


def offer_time(nodes):
    """A price clash or a customer about to leave always ends by offering a time."""
    named = {item['name']: item for item in nodes}
    plan = named.get('Plan Delivery')
    if not plan:
        return
    code = plan['parameters'].get('jsCode') or ''
    if 'const wantsTime' in code:
        return
    needle = 'if (msgs.length === 0) {'
    if needle not in code:
        return
    plan['parameters']['jsCode'] = code.replace(needle, OFFER_TIME_JS + needle, 1)


def read_agent_output(nodes):
    """The staging save sits in front of delivery, so the bubble must still come from the agent.

    Plan Delivery used to read whatever node ran immediately before it. After the
    staging row is written, that input is the database result and the reply is
    saved with nothing to send. Read the agent output by name instead.
    """
    named = {item['name']: item for item in nodes}
    node = named.get('Plan Delivery')
    if not node:
        return
    code = node['parameters'].get('jsCode') or ''
    old = 'const out = $input.first().json.output || {};'
    new = "const out = $('AI Agent').first().json.output || {};"
    if old in code:
        node['parameters']['jsCode'] = code.replace(old, new, 1)


def arm_sends(nodes):
    for item in nodes:
        raw = SEND_RAW.get(item['name'])
        if not raw:
            continue
        params = item['parameters']
        params['resource'] = 'message'
        params['operation'] = 'sendRaw'
        params['rawBody'] = raw


# Plain bubbles try Wasup's own typing send first. That path is the one that
# shows the indicator. A chat with no privacy token comes back cold-blocked
# and the existing sendRaw still delivers. CTA buttons stay on sendRaw.
TYPED_SENDS = (
    ('Send Bubble', 'Send Bubble CTA?', 'Loop Bubbles', 'Type Bubble', 'Bubble Keep', 'Bubble Typed?'),
    ('Send Double-Text', 'Send Double-Text CTA?', 'Mark Follow-up Sent', 'Type Double-Text', 'Double-Text Keep', 'Double-Text Typed?'),
)


def _keep_js(source):
    return (
        "const sent = $input.item.json || {}\n"
        "let bubble = {}\n"
        f"try {{ bubble = $('{source}').item.json || {{}} }} catch (error) {{ bubble = {{}} }}\n"
        "const id = String(sent.message_id || sent.messageId || '')\n"
        "const via = String(sent.via || '')\n"
        "const delivered = id.length > 0 && sent.success === true && via !== 'cold-blocked'\n"
        "return { json: { ...bubble, _typed: delivered ? 'yes' : 'no' } }\n"
    )


def _already_sent_js(hold_name):
    return (
        f"const bubble = $('{hold_name}').item.json || {{}}\n"
        "const raw = $input.item.json || {}\n"
        "const bag = Array.isArray(raw.messages) ? raw.messages : Array.isArray(raw.data) ? raw.data : []\n"
        "const phone = String(bubble.to_phone || '').replace(/\\D/g, '')\n"
        "const text = String(bubble.text || '').trim()\n"
        "const cutoff = Date.now() - 20 * 60 * 1000\n"
        "let already = false\n"
        "if (phone && text && raw.error == null) {\n"
        "  for (const item of bag) {\n"
        "    if (!item || typeof item !== 'object') continue\n"
        "    const to = String(item.to_phone || item.to || '').replace(/\\D/g, '')\n"
        "    const body = String(item.message || item.text || item.body || '').trim()\n"
        "    const when = Date.parse(item.created_at || item.timestamp || item.createdAt || '')\n"
        "    const outbound = item.direction === 'outbound' || item.fromMe === true\n"
        "    if (!outbound || body !== text) continue\n"
        "    if (to && !to.endsWith(phone)) continue\n"
        "    if (Number.isFinite(when) && when < cutoff) continue\n"
        "    already = true\n"
        "    break\n"
        "  }\n"
        "}\n"
        "return { json: { ...bubble, _already: already ? 'yes' : 'no' } }\n"
    )


def _retarget(connections, source, output, old, new):
    branch = (connections.get(source, {}).get('main') or [])
    if len(branch) <= output:
        return
    for item in branch[output] or []:
        if item.get('node') in (old, new):
            item['node'] = new


def arm_typed_sends(nodes, connections):
    named = {item['name']: item for item in nodes}
    for raw_name, source, nxt, type_name, keep_name, if_name in TYPED_SENDS:
        raw = named.get(raw_name)
        source_links = connections.get(source, {}).get('main') or []
        if not raw or len(source_links) < 2:
            continue
        if type_name not in named:
            x, y = raw.get('position') or [0, 0]
            typed = node(type_name, 'n8n-nodes-wasup.wasup', 1, [x, y + 160], {
                'resource': 'message',
                'operation': 'sendText',
                'instanceId': json.loads(json.dumps(raw['parameters'].get('instanceId') or {})),
                'to': '={{ $json.to_phone }}',
                'message': '={{ $json.text }}',
                'linkPreview': False,
                'advancedOptions': {'typingSimulation': True, 'delayEnabled': True},
            }, json.loads(json.dumps(raw.get('credentials') or {})), {'onError': 'continueRegularOutput'})
            keep = node(keep_name, 'n8n-nodes-base.code', 2, [x + 200, y + 160], {
                'mode': 'runOnceForEachItem', 'jsCode': _keep_js(source),
            })
            typed_if = node(if_name, 'n8n-nodes-base.if', 2.2, [x + 400, y + 160], equals_if('={{ $json._typed }}', 'yes'))
            nodes.extend([typed, keep, typed_if])
            named[type_name] = typed
            named[keep_name] = keep
            named[if_name] = typed_if
        else:
            named[keep_name]['parameters']['jsCode'] = _keep_js(source)
            named[type_name]['parameters']['operation'] = 'sendText'
            named[type_name]['parameters']['advancedOptions'] = {'typingSimulation': True, 'delayEnabled': True}
        for link_item in source_links[1]:
            if link_item.get('node') == raw_name:
                link_item['node'] = type_name
        hold_name, history_name, already_name, again_name = ONCE_GUARDS[raw_name]
        x, y = raw.get('position') or [0, 0]
        creds = json.loads(json.dumps(raw.get('credentials') or {}))
        if hold_name not in named:
            hold = node(hold_name, 'n8n-nodes-base.code', 2, [x - 200, y + 80], {
                'mode': 'runOnceForEachItem', 'jsCode': 'return { json: $input.item.json || {} }\n',
            })
            history = node(history_name, 'n8n-nodes-base.httpRequest', 4.2, [x, y + 80], {
                'method': 'GET',
                'url': RECENT_SENDS_URL,
                'authentication': 'predefinedCredentialType',
                'nodeCredentialType': 'wasupApi',
                'options': {'timeout': 15000},
            }, creds, {'onError': 'continueRegularOutput'})
            already = node(already_name, 'n8n-nodes-base.code', 2, [x + 220, y + 80], {
                'mode': 'runOnceForEachItem', 'jsCode': _already_sent_js(hold_name),
            })
            again = node(again_name, 'n8n-nodes-base.if', 2.2, [x + 440, y + 80], equals_if('={{ $json._already }}', 'yes'))
            nodes.extend([hold, history, already, again])
            named[hold_name] = hold
            named[history_name] = history
            named[already_name] = already
            named[again_name] = again
        else:
            named[history_name]['parameters']['url'] = RECENT_SENDS_URL
            named[already_name]['parameters']['jsCode'] = _already_sent_js(hold_name)
        connections[type_name] = link(keep_name)
        connections[keep_name] = link(if_name)
        connections[if_name] = {'main': [
            [{'node': nxt, 'type': 'main', 'index': 0}],
            [{'node': hold_name, 'type': 'main', 'index': 0}],
        ]}
        connections[hold_name] = link(history_name)
        connections[history_name] = link(already_name)
        connections[already_name] = link(again_name)
        connections[again_name] = {'main': [
            [{'node': nxt, 'type': 'main', 'index': 0}],
            [{'node': raw_name, 'type': 'main', 'index': 0}],
        ]}
        connections[raw_name] = link(nxt)
        if raw_name == 'Send Bubble':
            _retarget(connections, 'Send Fallback?', 0, raw_name, hold_name)


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
const limit = Date.now() + 4000
let parsed = { found: false }
while (Date.now() < limit) {
  try {
    if ($('Parse Staging').isExecuted) {
      parsed = $('Parse Staging').first().json.staging || { found: false }
      const pinned = parsed.found === true
      const pinReady = !pinned || $('Fetch staging version').isExecuted
      let activeReady = false
      try { activeReady = $('Fetch active version').isExecuted } catch (error) { activeReady = true }
      if (pinReady && (pinned || activeReady)) break
    }
  } catch (error) {}
  await new Promise((resolve) => setTimeout(resolve, 50))
}
function promptOf(version) {
  if (Array.isArray(version)) version = version[0] || {}
  if (!version || typeof version !== 'object') return ''
  return [version.masterPrompt || version.master_prompt, version.additionalInformation || version.additional_information]
    .filter((part) => String(part || '').trim()).join('\n\n')
}
if (parsed.found === true) {
  let version = $('Fetch staging version').isExecuted ? ($('Fetch staging version').first().json || {}) : {}
  if (Array.isArray(version)) version = version[0] || {}
  const prompt = [version.masterPrompt, version.additionalInformation, parsed.leadContext].filter((part) => String(part || '').trim()).join('\n\n')
  return [{ json: { ...drain, defaultPrompt: '', staging: {
    found: true,
    prompt,
    versionNumber: parsed.versionNumber || version.versionNumber || null,
    conversationId: String(parsed.conversationId || ''),
    versionId: String(parsed.versionId || ''),
    leadContext: String(parsed.leadContext || ''),
  } } }]
}
let active = {}
try { if ($('Fetch active version').isExecuted) active = $('Fetch active version').first().json || {} } catch (error) {}
return [{ json: { ...drain, staging: null, defaultPrompt: promptOf(active) } }]
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
    'thumbs_up', (select count(*) from k1_staging_messages m where m.conversation_id = c.id and m.feedback = 'up'),
    'thumbs_down', (select count(*) from k1_staging_messages m where m.conversation_id = c.id and m.feedback = 'down'),
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
      thumbsUp: Number(row.thumbs_up || 0),
      thumbsDown: Number(row.thumbs_down || 0),
      lastReply: row.last_reply || '',
      texts: Array.isArray(texts) ? texts : [],
    }
  }).filter((item) => {
    if (versions && versions.length && !versions.includes(Number(item.versionNumber))) return false
    if (filters.p_feedback === 'up' && item.thumbsUp === 0) return false
    if (filters.p_feedback === 'down' && item.thumbsDown === 0) return false
    if (filters.p_feedback === 'none' && (item.thumbsUp > 0 || item.thumbsDown > 0)) return false
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
alter table k1_staging_messages add column if not exists feedback text;
alter table k1_staging_messages add column if not exists feedback_at timestamptz;
alter table k1_staging_messages add column if not exists feedback_by text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'k1_staging_messages_feedback_chk') then
    alter table k1_staging_messages
      add constraint k1_staging_messages_feedback_chk check (feedback is null or feedback in ('up', 'down'));
  end if;
end $$;
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
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'k1_staging_messages' and column_name = 'feedback'
  ) then
    raise exception 'staging feedback column missing';
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
  staging_prompt: stagingSession ? String(stagingSession.prompt || '') : String(row.defaultPrompt || ''),
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
    tool['parameters']['description'] = PAYMENT_DESCRIPTION
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
        if BRIEF_STAGING not in message and BRIEF_PINNED not in message and 'staging_prompt' not in message:
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
    # n8n finishes the first sibling before it starts the next. The send sits on
    # Plan Delivery, and a Wasup call can hang until the execution dies, so the
    # sandbox row has to be written before that send starts.
    if 'Staging turn?' in {item['name'] for item in nodes} and 'Plan Delivery' in {item['name'] for item in nodes}:
        connections['Staging turn?'] = {'main': [
            [{'node': 'Prepare staging record', 'type': 'main', 'index': 0}],
            [{'node': 'Plan Delivery', 'type': 'main', 'index': 0}],
        ]}
        connections['Prepare staging record'] = link('Record staging?')
        connections['Record staging?'] = {'main': [
            [{'node': 'Record staging turn', 'type': 'main', 'index': 0}],
            [{'node': 'Plan Delivery', 'type': 'main', 'index': 0}],
        ]}
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
    only_customer_messages(nodes)
    read_agent_output(nodes)
    offer_time(nodes)
    prefetch_staging(nodes, connections)
    install_prompt_hook(nodes, connections)
    hold_composing(nodes, connections)
    arm_typed_sends(nodes, connections)
    hand_webhook_reply(nodes, connections)
    return nodes, connections


PRODUCTS_CACHE_OLD = "return cached(`products:${src.base}:${src.id}:${category}`, HOUR, async () => {"
PRODUCTS_CACHE_NEW = "return cached(`products:${src.base}:${src.id}:${category}`, 10 * 60 * 1000, async () => {"
PRICES_CACHE_OLD = "return cached(`prices:${src.base}:${src.id}:${ids.join('+')}`, HOUR, async () => {"
PRICES_CACHE_NEW = "return cached(`prices:${src.base}:${src.id}:${ids.join('+')}`, 10 * 60 * 1000, async () => {"
ELECTRIC_FALLBACK_OLD = "if (!main) { main = inspections.find(car); assumption = 'This station has no separate electric-car inspection product; the standard inspection is used and no measuring product is added.' }"
ELECTRIC_FALLBACK_NEW = "if (!main) return { ok: false, code: wanted, unsupported: true, missing_electric: true, reason: 'This station has no separate electric-car inspection product, so the standard inspection price is not used. Say that plainly and do not quote a price.' }"
ELECTRIC_BOOK_NEW = """if (!main) {
    main = inspections.find(car)
    if (!main) return { ok: false, code: wanted, unsupported: true, missing_electric: true, reason: 'This station has no car inspection product, so an electric car cannot be booked here. Say that plainly and do not quote a price.' }
    assumption = 'No separate electric inspection product at this station. The standard car inspection is booked and measuring is not added. Quote only this tool total. Do not add a measuring amount and do not use a station-page from-price.'
  }"""
MISSING_ELECTRIC_FLAG_OLD = "  const code = normalizeProduct(body.product || body.lead_product)\n  if (src && !entry.closed) {\n    const { category, plan } = await planFor(src, body)\n"
MISSING_ELECTRIC_FLAG_NEW = "  const code = normalizeProduct(body.product || body.lead_product)\n  let missingElectric = false\n  if (src && !entry.closed) {\n    const { category, plan } = await planFor(src, body)\n    missingElectric = plan.missing_electric === true\n"
PAGE_ESTIMATE_OLD = "  if (!result.price && page && page.prices.length && code) {"
PAGE_ESTIMATE_NEW = "  if (!result.price && !missingElectric && page && page.prices.length && code) {"


def patch_muster_prices(code):
    """Keep product and price lists for 10 minutes, and never price 004e from the combustion product."""
    if PRODUCTS_CACHE_OLD in code:
        code = must_replace(code, PRODUCTS_CACHE_OLD, PRODUCTS_CACHE_NEW, 'products cache')
    elif PRODUCTS_CACHE_NEW not in code:
        raise SystemExit('products cache: neither the hour cache nor the 10 minute cache')
    if PRICES_CACHE_OLD in code:
        code = must_replace(code, PRICES_CACHE_OLD, PRICES_CACHE_NEW, 'prices cache')
    elif PRICES_CACHE_NEW not in code:
        raise SystemExit('prices cache: neither the hour cache nor the 10 minute cache')
    if ELECTRIC_FALLBACK_OLD in code:
        code = must_replace(code, ELECTRIC_FALLBACK_OLD, ELECTRIC_BOOK_NEW, '004e fallback')
    elif ELECTRIC_FALLBACK_NEW in code:
        code = must_replace(code, ELECTRIC_FALLBACK_NEW, ELECTRIC_BOOK_NEW, '004e book')
    elif 'standard car inspection is booked and measuring is not added' not in code:
        raise SystemExit('004e fallback: neither the refuse rule nor the bookable inspection rule')
    if MISSING_ELECTRIC_FLAG_OLD in code:
        code = must_replace(code, MISSING_ELECTRIC_FLAG_OLD, MISSING_ELECTRIC_FLAG_NEW, '004e page price')
    elif 'missingElectric = plan.missing_electric === true' not in code:
        raise SystemExit('004e page price: the missing-electric flag is not set')
    if PAGE_ESTIMATE_OLD in code:
        code = must_replace(code, PAGE_ESTIMATE_OLD, PAGE_ESTIMATE_NEW, '004e page estimate')
    elif PAGE_ESTIMATE_NEW not in code:
        raise SystemExit('004e page estimate: the page price is still attached for a missing electric product')
    return code


def patch_booking(workflow):
    nodes = json.loads(json.dumps(workflow['nodes']))
    named = {item['name']: item for item in nodes}
    code = named['Muster']['parameters']['jsCode']
    if 'WHATSAPP_NOTE' not in code:
        anchor = "const action = String(body.action || '')\n"
        code = must_replace(code, anchor, anchor + NOTE_HELPERS, 'Muster action')
        code = must_replace(code, RESERVE_OLD, RESERVE_NEW, 'Muster reserve', 2)
    named['Muster']['parameters']['jsCode'] = patch_muster_prices(code)
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
    opened = [item.get('node') for item in workflow['connections']['New Message?']['main'][0]]
    assert opened[0] == 'Load Staging Session'
    assert 'Debounce' not in opened
    assert workflow['connections']['Fetch staging version']['main'][0][0]['node'] == 'Fetch active version'
    assert workflow['connections']['Fetch active version']['main'][0][0]['node'] == 'Debounce'
    assert workflow['connections']['Staging assigned?']['main'][1][0]['node'] == 'Fetch active version'
    assert workflow['connections']['Drain Queue']['main'][0][0]['node'] == 'Merge Staging'
    assert 'Date.now() + 4000' in named['Merge Staging']['parameters']['jsCode']
    assert 'defaultPrompt' in named['Merge Staging']['parameters']['jsCode']
    assert 'agent_builder_active_config' in named['Fetch active version']['parameters']['url']
    assert 'row.defaultPrompt' in named['Build Turn']['parameters']['jsCode']
    assert 'Playground Turn' in named['AI Agent']['parameters']['options']['systemMessage']
    config = {item['name']: item['value'] for item in named['⚙️ CONFIG']['parameters']['assignments']['assignments']}
    assert 'documented but NOT ENABLED FOR K1' in config['business_prompt']
    assert 'never call it' in named['create_payment_link']['parameters']['description']
    assert named['Record staging turn']['parameters']['query'] == '={{ $json.query }}'
    assert workflow['connections']['Staging turn?']['main'][0][0]['node'] == 'Prepare staging record'
    assert 'Plan Delivery' not in [item.get('node') for item in workflow['connections']['Staging turn?']['main'][0]]
    assert workflow['connections']['Record staging turn']['main'][0][0]['node'] == 'Plan Delivery'
    assert 'gen_random_uuid' in named['Reset Staging Session']['parameters']['query']
    assert 'SELECT 1 AS purged' in named['Purge Session']['parameters']['query']
    assert '_staging_%' in named['Purge Session']['parameters']['query']
    for name in REPLY_CHECK_NODES:
        replied = named[name]['parameters']['query']
        assert 'inbound_message_queue q' in replied
        assert 'last_inbound_message_id' not in replied
    queued = named['Queue Inbound']['parameters']['query']
    assert "event = 'message'" in queued
    assert "status IN ('received', '')" in queued
    latest = named['Am I The Latest?']['parameters']['query']
    assert 'inbound_message_queue q' in latest
    assert 'last_inbound_message_id' not in latest
    plan = named['Plan Delivery']['parameters']['jsCode']
    assert "$('AI Agent').first().json.output" in plan
    assert 'const wantsTime' in plan
    assert '$input.first().json.output' not in plan
    assert 'k1_staging_messages' in named['Prepare staging record']['parameters']['jsCode']
    assert 'chr(36)' in named['Prepare staging record']['parameters']['jsCode']
    assert "let tag = 'stg'" not in named['Prepare staging record']['parameters']['jsCode']
    for send_name in ('Send Bubble', 'Send Double-Text'):
        params = named[send_name]['parameters']
        assert params['operation'] == 'sendRaw'
        assert 'allowColdWithoutToken: true' in params['rawBody']
        assert 'typingSimulation: false' in params['rawBody']
        assert 'delayEnabled: false' in params['rawBody']
    reset = named['Send Reset Notice']['parameters']
    assert reset['operation'] == 'sendRaw' and 'typingSimulation: false' in reset['rawBody'] and 'delayEnabled: false' in reset['rawBody']
    for raw_name, source, nxt, type_name, keep_name, if_name in TYPED_SENDS:
        hold_name, history_name, already_name, again_name = ONCE_GUARDS[raw_name]
        assert named[type_name]['parameters']['operation'] == 'sendText'
        assert named[type_name]['parameters']['advancedOptions']['typingSimulation'] is True
        assert workflow['connections'][source]['main'][1][0]['node'] == type_name
        assert workflow['connections'][if_name]['main'][0][0]['node'] == nxt
        assert workflow['connections'][if_name]['main'][1][0]['node'] == hold_name
        assert workflow['connections'][again_name]['main'][0][0]['node'] == nxt
        assert workflow['connections'][again_name]['main'][1][0]['node'] == raw_name
        assert named[history_name]['parameters']['url'] == RECENT_SENDS_URL
        assert '_already' in named[already_name]['parameters']['jsCode']
        assert "_typed: delivered ? 'yes' : 'no'" in named[keep_name]['parameters']['jsCode']
        callers = [
            source_name for source_name, payload in workflow['connections'].items()
            for output in (payload.get('main') or [])
            for item in (output or [])
            if item.get('node') == raw_name
        ]
        assert callers == [again_name]
    hold = named['Hold For Composing']['parameters']['jsCode']
    assert 'digits.length === 10' in hold and '8000' in hold and 'reply: text' in hold
    assert '_typed' not in hold and 'Send Bubble' not in hold
    assert named['Ack Webhook (empty)']['parameters']['responseBody'] == ACK_BODY
    merge = named['Merge Check']['parameters']['jsCode']
    assert 'Date.now() + 1000' in merge and 'webhook_owned' in merge
    assert workflow['connections']['Merge Check']['main'][0][0]['node'] == 'Webhook Reply?'
    assert workflow['connections']['Webhook Reply?']['main'][0][0]['node'] == 'Pause For Reply'
    assert workflow['connections']['Webhook Reply?']['main'][1][0]['node'] == 'Still Our Turn?'
    assert 'setTimeout(resolve, 2000)' in named['Pause For Reply']['parameters']['jsCode']
    assert workflow['connections']['Send Fallback?']['main'][0][0]['node'] == 'Hold Bubble Text'
    assert workflow['connections']['Send Fallback?']['main'][1][0]['node'] == 'Skip Bubble'
    assert 'typingPlansExecuted' in named['Reply Landed?']['parameters']['jsCode']
    assert 'Cold send blocked' in named['Reply Landed?']['parameters']['jsCode']
    assert any(item.get('node') == 'Typing Baseline' for item in workflow['connections']['Webhook']['main'][0])
    for read_name, url in WASUP_READS.items():
        params = named[read_name]['parameters']
        assert params['method'] == 'GET'
        assert params['url'] == url
        assert 'to=' not in params['url'] and '/send' not in params['url']
        assert params['nodeCredentialType'] == 'wasupApi'
    config = {item['name']: item['value'] for item in named['⚙️ CONFIG']['parameters']['assignments']['assignments']}
    assert config['wasup_instance_id'] == INSTANCE


def check_booking(workflow):
    named = {item['name']: item for item in workflow['nodes']}
    code = named['Muster']['parameters']['jsCode']
    assert 'Varattu WhatsApp-botin kautta' in code
    assert code.count('postReservation') >= 3
    assert '_staging_%' in named['Clear chat memory']['parameters']['query']
    assert 'fromWhatsApp' in code
    assert PRODUCTS_CACHE_NEW in code
    assert PRICES_CACHE_NEW in code
    assert 'missing_electric' in code
    assert ELECTRIC_FALLBACK_OLD not in code
    assert ELECTRIC_FALLBACK_NEW not in code
    assert 'standard car inspection is booked and measuring is not added' in code
    assert 'missingElectric = plan.missing_electric === true' in code
    assert PAGE_ESTIMATE_NEW in code


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
      'thumbs_up', (select count(*) from k1_staging_messages m where m.conversation_id = c.id and m.feedback = 'up'),
      'thumbs_down', (select count(*) from k1_staging_messages m where m.conversation_id = c.id and m.feedback = 'down'),
      'last_reply', coalesce((select m.text from k1_staging_messages m where m.conversation_id = c.id and m.role = 'agent' and not m.is_opener order by m.created_at desc limit 1), '')
    ),
    'messages', coalesce((
      select json_agg(json_build_object(
        'id', m.id, 'role', m.role, 'text', m.text, 'isOpener', m.is_opener, 'feedback', m.feedback, 'createdAt', m.created_at
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
    named = {item['name']: item for item in nodes}
    named['Staging chats']['parameters']['query'] = LIST_CHATS_SQL
    named['All staging chats']['parameters']['query'] = LIST_CHATS_SQL
    named['Shape staging list']['parameters']['jsCode'] = SHAPE_LIST_JS
    named['Merge staging chats']['parameters']['jsCode'] = MERGE_LIST_JS
    named['Prepare staging thread']['parameters']['jsCode'] = PREPARE_THREAD_JS
    return nodes, connections


def check_chats(workflow):
    named = {item['name']: item for item in workflow['nodes']}
    assert "['playground', 'compare', 'staging']" in named['Build Filters']['parameters']['jsCode']
    assert "$('One Webhook · Pass Request')" in named['Get One RPC']['parameters']['jsonBody']
    assert 'k1_staging_conversations' in named['Staging chats']['parameters']['query']
    assert workflow['connections']['Staging list?']['main'][1][0]['node'] == 'List RPC'
    assert workflow['connections']['Staging thread?']['main'][1][0]['node'] == 'Get One RPC'
    assert 'k1_staging_messages' in named['Prepare staging thread']['parameters']['jsCode']
    assert "m.feedback = 'up'" in named['Staging chats']['parameters']['query']
    assert "m.feedback = 'down'" in named['All staging chats']['parameters']['query']
    shape = named['Shape staging list']['parameters']['jsCode']
    assert "filters.p_feedback === 'up' && item.thumbsUp === 0" in shape
    assert "filters.p_feedback === 'down' && item.thumbsDown === 0" in shape
    assert "filters.p_feedback === 'none' && (item.thumbsUp > 0 || item.thumbsDown > 0)" in shape
    assert "filters.p_feedback === 'up' || filters.p_feedback === 'down') return false" not in shape
    thread = named['Prepare staging thread']['parameters']['jsCode']
    assert "'feedback', m.feedback" in thread
    assert "m.feedback = 'up'" in thread


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


PREPARE_FEEDBACK_JS = r"""const body = $('Webhook').first().json.body || {}
const id = String(body.messageId || '')
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
const safe = uuid ? id : '00000000-0000-0000-0000-000000000000'
const kind = body.feedback === 'up' ? 'up' : body.feedback === 'down' ? 'down' : 'clear'
const feedbackSql = kind === 'up' ? "'up'" : kind === 'down' ? "'down'" : 'null'
const atSql = kind === 'clear' ? 'null' : 'now()'
const query = `update k1_staging_messages
set feedback = ${feedbackSql},
    feedback_at = ${atSql},
    feedback_by = null
where id = '${safe}'::uuid and role = 'agent'
returning id as message_id, feedback`
return [{ json: { query } }]
"""

READ_FEEDBACK_JS = r"""const row = $input.all().map((item) => item.json).find((value) => value && value.message_id)
if (!row) return [{ json: { ok: false, error: 'message_not_found' } }]
return [{ json: { ok: true, messageId: row.message_id, feedback: row.feedback ?? null } }]
"""


def patch_feedback(workflow):
    """When the playground message is missing, store the same thumb on the staging message."""
    nodes = json.loads(json.dumps(workflow['nodes']))
    connections = json.loads(json.dumps(workflow['connections']))
    named = {item['name']: item for item in nodes}
    if 'Prepare staging feedback' not in named:
        spot = named['Normalize']['position']
        nodes.extend([
            node('Playground feedback?', 'n8n-nodes-base.if', 2.2, [spot[0] + 220, spot[1]],
                 equals_if("={{ $json.ok === true ? 'yes' : 'no' }}", 'yes')),
            node('Prepare staging feedback', 'n8n-nodes-base.code', 2, [spot[0] + 440, spot[1] + 160],
                 {'mode': 'runOnceForAllItems', 'jsCode': PREPARE_FEEDBACK_JS}),
            pg('Set staging feedback', '={{ $json.query }}', [spot[0] + 660, spot[1] + 160]),
            node('Read staging feedback', 'n8n-nodes-base.code', 2, [spot[0] + 880, spot[1] + 160],
                 {'mode': 'runOnceForAllItems', 'jsCode': READ_FEEDBACK_JS}),
        ])
        connections['Normalize'] = link('Playground feedback?')
        connections['Playground feedback?'] = {'main': [
            [{'node': 'Respond', 'type': 'main', 'index': 0}],
            [{'node': 'Prepare staging feedback', 'type': 'main', 'index': 0}],
        ]}
        connections['Prepare staging feedback'] = link('Set staging feedback')
        connections['Set staging feedback'] = link('Read staging feedback')
        connections['Read staging feedback'] = link('Respond')
    named = {item['name']: item for item in nodes}
    named['Prepare staging feedback']['parameters']['jsCode'] = PREPARE_FEEDBACK_JS
    named['Set staging feedback']['parameters']['query'] = '={{ $json.query }}'
    named['Read staging feedback']['parameters']['jsCode'] = READ_FEEDBACK_JS
    return nodes, connections


def check_feedback(workflow):
    named = {item['name']: item for item in workflow['nodes']}
    code = named['Prepare staging feedback']['parameters']['jsCode']
    assert 'k1_staging_messages' in code
    assert "role = 'agent'" in code
    assert 'feedback_by = null' in code
    assert workflow['connections']['Playground feedback?']['main'][0][0]['node'] == 'Respond'
    assert workflow['connections']['Playground feedback?']['main'][1][0]['node'] == 'Prepare staging feedback'
    assert workflow['connections']['Read staging feedback']['main'][0][0]['node'] == 'Respond'
    assert named['Set staging feedback']['parameters']['query'] == '={{ $json.query }}'


def feedback_stub():
    return {
        'nodes': [
            {'id': '1', 'name': 'Webhook', 'type': 'n8n-nodes-base.webhook', 'position': [0, 0], 'parameters': {'path': 'k1-agent-builder/feedback'}},
            {'id': '2', 'name': 'Set Feedback RPC', 'type': 'n8n-nodes-base.httpRequest', 'position': [240, 0], 'parameters': {}},
            {'id': '3', 'name': 'Normalize', 'type': 'n8n-nodes-base.code', 'position': [480, 0], 'parameters': {'jsCode': "const row = $input.all().map((item) => item.json).find((value) => value && value.message_id);\nif (!row) return [{ json: { ok: false, error: 'message_not_found' } }];\nreturn [{ json: { ok: true, messageId: row.message_id, feedback: row.feedback } }];"}},
            {'id': '4', 'name': 'Respond', 'type': 'n8n-nodes-base.respondToWebhook', 'position': [720, 0], 'parameters': {}},
            {'id': '5', 'name': 'Webhook · Pass Request', 'type': 'n8n-nodes-base.code', 'position': [0, 200], 'parameters': {'jsCode': ''}},
        ],
        'connections': {
            'Webhook · Pass Request': link('Set Feedback RPC'),
            'Set Feedback RPC': link('Normalize'),
            'Normalize': link('Respond'),
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
    feedback_nodes, feedback_connections = patch_feedback(feedback_stub())
    check_feedback({'nodes': feedback_nodes, 'connections': feedback_connections})
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
    feedback = gate.request('GET', f'/workflows/{FEEDBACK}')
    backup(agent, 'agent')
    backup(booking, 'booking')
    backup(chats, 'test-chats')
    backup(feedback, 'feedback')
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
    feedback_nodes, feedback_connections = patch_feedback(feedback)
    check_feedback({'nodes': feedback_nodes, 'connections': feedback_connections})
    put(LIVE_BOOKING, booking['name'], booking_nodes, booking_connections, settings_of(booking), booking.get('active'))
    put(LIVE_AGENT, agent['name'], agent_nodes, agent_connections, settings_of(agent), agent.get('active'))
    put(TEST_CHATS, chats['name'], chat_nodes, chat_connections, settings_of(chats), chats.get('active'))
    put(FEEDBACK, feedback['name'], feedback_nodes, feedback_connections, settings_of(feedback), feedback.get('active'))
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
    rated = gate.request('GET', f'/workflows/{FEEDBACK}')
    assert rated.get('active') is True
    check_feedback(rated)


def electric():
    """Book an electric car on the standard inspection, without measuring. Does not rewrite the WhatsApp prompt."""
    booking = gate.request('GET', f'/workflows/{LIVE_BOOKING}')
    if not booking.get('active'):
        raise SystemExit('refusing to edit an inactive booking workflow')
    backup(booking, 'booking')
    booking_nodes, booking_connections = patch_booking(booking)
    check_booking({'nodes': booking_nodes, 'connections': booking_connections})
    put(LIVE_BOOKING, booking['name'], booking_nodes, booking_connections, settings_of(booking), True)
    booked = gate.request('GET', f'/workflows/{LIVE_BOOKING}')
    check_booking(booked)
    if booked.get('active') is not True:
        raise SystemExit('booking workflow did not reactivate')
    print(f'booking {LIVE_BOOKING} 004e=inspection-only')


def publish():
    """Store staging thumbs and the 004e price rule. Does not rewrite the WhatsApp prompt."""
    booking = gate.request('GET', f'/workflows/{LIVE_BOOKING}')
    chats = gate.request('GET', f'/workflows/{TEST_CHATS}')
    feedback = gate.request('GET', f'/workflows/{FEEDBACK}')
    backup(booking, 'booking')
    backup(chats, 'test-chats')
    backup(feedback, 'feedback')
    postgres = POSTGRES['postgres']
    apply_sql(postgres)
    booking_nodes, booking_connections = patch_booking(booking)
    check_booking({'nodes': booking_nodes})
    chat_nodes, chat_connections = patch_chats(chats)
    check_chats({'nodes': chat_nodes, 'connections': chat_connections})
    feedback_nodes, feedback_connections = patch_feedback(feedback)
    check_feedback({'nodes': feedback_nodes, 'connections': feedback_connections})
    put(LIVE_BOOKING, booking['name'], booking_nodes, booking_connections, settings_of(booking), booking.get('active'))
    put(TEST_CHATS, chats['name'], chat_nodes, chat_connections, settings_of(chats), chats.get('active'))
    put(FEEDBACK, feedback['name'], feedback_nodes, feedback_connections, settings_of(feedback), feedback.get('active'))
    booked = gate.request('GET', f'/workflows/{LIVE_BOOKING}')
    listed = gate.request('GET', f'/workflows/{TEST_CHATS}')
    rated = gate.request('GET', f'/workflows/{FEEDBACK}')
    check_booking(booked)
    check_chats(listed)
    check_feedback(rated)
    assert booked.get('active') is True and listed.get('active') is True and rated.get('active') is True
    print(f'booking {LIVE_BOOKING} prices=10m 004e=inspection-only; chats {TEST_CHATS}; feedback {FEEDBACK}')


def pin_open_sessions():
    """Move a staging phone that is still on v12 onto active v13. Does not send a message or rotate the chat.

    Version rows live in Supabase. Staging sessions live in the listener database, so the id is looked up and passed in.
    """
    spec = importlib.util.spec_from_file_location('versions', HERE / 'k1-platform-version.py')
    versions = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(versions)
    row = versions.call('GET', 'agent_builder_versions?version_number=eq.13&is_active=eq.true&select=id,version_number')
    if isinstance(row, list):
        row = row[0] if row else {}
    version_id = str((row or {}).get('id') or '')
    if not re.fullmatch(r'[0-9a-f-]{36}', version_id):
        raise SystemExit('active v13 was not found')
    query = f"""
with moved as (
  update k1_staging_sessions
  set version_id = '{version_id}', version_number = 13, updated_at = now()
  where version_number = 12
  returning 1
)
select 13 as active_version, (select count(*) from moved) as moved
"""
    path = f'k1-v13-pin-{uuid.uuid4().hex[:12]}'
    respond = node('Respond', 'n8n-nodes-base.respondToWebhook', 1.5, [640, 300], {'respondWith': 'json', 'responseBody': '={{ $json }}', 'options': {}})
    hook_node = node('Webhook', 'n8n-nodes-base.webhook', 2.1, [240, 300], {'httpMethod': 'POST', 'path': path, 'responseMode': 'responseNode', 'options': {}})
    sql = node('Pin', 'n8n-nodes-base.postgres', 2.6, [440, 300], {'operation': 'executeQuery', 'query': query, 'options': {}}, POSTGRES)
    created = gate.request('POST', '/workflows', {'name': 'K1 v13 pin once', 'nodes': [hook_node, sql, respond], 'connections': {'Webhook': link('Pin'), 'Pin': link('Respond')}, 'settings': {'executionOrder': 'v1'}})
    wid = created['id']
    try:
        gate.request('POST', f'/workflows/{wid}/activate')
        status, body = post_webhook(path)
        compact = body.replace(' ', '')
        if status != 200 or ('"active_version":13' not in compact and '"active_version":"13"' not in compact):
            raise SystemExit(f'v13 pin did not confirm ({status})')
        print('staging pin', body.replace('\n', ' ')[:240])
    finally:
        delete_workflow(wid)


def send_once():
    """Send a cold reply once. Does not rewrite the WhatsApp prompt."""
    agent = gate.request('GET', f'/workflows/{LIVE_AGENT}')
    if not agent.get('active'):
        raise SystemExit('refusing to edit an inactive agent')
    backup(agent, 'agent')
    nodes = json.loads(json.dumps(agent['nodes']))
    connections = json.loads(json.dumps(agent['connections']))
    arm_sends(nodes)
    arm_typed_sends(nodes, connections)
    payment_id = next(item['parameters']['workflowId']['value'] for item in nodes if item['name'] == 'create_payment_link')
    check_agent({'nodes': nodes, 'connections': connections}, payment_id)
    put(LIVE_AGENT, agent['name'], nodes, connections, settings_of(agent), True)
    live = gate.request('GET', f'/workflows/{LIVE_AGENT}')
    if live.get('active') is not True:
        raise SystemExit('live agent did not reactivate')
    check_agent(live, payment_id)
    prompt = next(item['value'] for item in next(node for node in live['nodes'] if node['name'] == '⚙️ CONFIG')['parameters']['assignments']['assignments'] if item['name'] == 'business_prompt')
    print(f'live agent {LIVE_AGENT} active={live.get("active")} cold-fallback=once prompt={len(prompt)}')


def hook():
    """Publish the v13 brief on the live WhatsApp agent and pin the current staging phone to the active version."""
    agent = gate.request('GET', f'/workflows/{LIVE_AGENT}')
    if not agent.get('active'):
        raise SystemExit('refusing to edit an inactive agent')
    backup(agent, 'agent')
    nodes = json.loads(json.dumps(agent['nodes']))
    connections = json.loads(json.dumps(agent['connections']))
    install_prompt_hook(nodes, connections)
    payment_id = next(item['parameters']['workflowId']['value'] for item in nodes if item['name'] == 'create_payment_link')
    check_agent({'nodes': nodes, 'connections': connections}, payment_id)
    put(LIVE_AGENT, agent['name'], nodes, connections, settings_of(agent), True)
    live = gate.request('GET', f'/workflows/{LIVE_AGENT}')
    if live.get('active') is not True:
        raise SystemExit('live agent did not reactivate')
    check_agent(live, payment_id)
    pin_open_sessions()
    print(f'live agent {LIVE_AGENT} active={live.get("active")} brief=v13')


if __name__ == '__main__':
    import sys
    command = sys.argv[1] if len(sys.argv) > 1 else 'dry'
    if command == 'dry':
        dry()
    elif command == 'apply':
        apply()
    elif command == 'publish':
        publish()
    elif command == 'electric':
        electric()
    elif command == 'send-once':
        send_once()
    elif command == 'hook':
        hook()
    else:
        raise SystemExit(__doc__)
