#!/usr/bin/env python3
"""Builds the v2 K1 agent as two CANDIDATE workflows next to the live ones. Nothing live is changed.

  K1 Muster Booking v2 (candidate)   copy of the live booking workflow, Muster node replaced by k1-muster-v2.js
  K1 Muster agent v2 (candidate)     copy of the live playground agent, tools repointed and extended, prompt v2

Usage:
  python3 k1-agent-v2-build.py build     create or update both candidates (idempotent, by name)
  python3 k1-agent-v2-build.py smoke     run the Code node inside n8n against staging, production (GET only) and the K1 site
  python3 k1-agent-v2-build.py delete    remove both candidates
  python3 k1-agent-v2-build.py promote   REPLACE the live booking + agent workflows with the candidates (live paths, ids and names are kept);
                                         the previous live workflows are saved to design/k1-fresh/backups/ first
  python3 k1-agent-v2-build.py rollback  restore the live workflows from the newest backup

The candidates keep the live Clerk gate. Their webhook paths end in -v2 (playground: /booking-chat-v2).
"""
import importlib.util
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
spec = importlib.util.spec_from_file_location('gate', HERE / 'n8n-gate.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

BACKUPS = ROOT / 'backups'
LIVE_BOOKING = 'wAE7EHLyJk6JsMue'
LIVE_AGENT = 'w8a9S1uxB5U9qnNO'
BOOKING_NAME = 'K1 Muster Booking v2 (candidate)'
AGENT_NAME = 'K1 Muster agent v2 (candidate)'
SUFFIX = '-v2'
SETTINGS_KEEP = ('executionOrder', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'saveManualExecutions', 'timezone', 'errorWorkflow')
PROMPT_MARKERS = ('# K1 Muster staging assistant', '# K1 Katsastus assistant — authoritative business rules')


def proxy_pool():
    """K1_STAGING_PROXY_URLS (comma separated; env or .env.local, never committed), falling back to K1_STAGING_PROXY_URL."""
    from urllib.parse import urlparse
    env_file = ROOT.parents[1] / '.env.local'
    values = {}
    if env_file.is_file():
        for line in env_file.read_text().splitlines():
            if line.startswith('K1_STAGING_PROXY_URL') and '=' in line:
                key, value = line.strip().split('=', 1)
                values[key] = value
    raw = os.environ.get('K1_STAGING_PROXY_URLS') or values.get('K1_STAGING_PROXY_URLS') or os.environ.get('K1_STAGING_PROXY_URL') or values.get('K1_STAGING_PROXY_URL') or ''
    pool = []
    if not raw:
        return live_pool()
    for url in [item.strip() for item in raw.split(',') if item.strip()]:
        parsed = urlparse(url)
        proxy = {'protocol': parsed.scheme or 'http', 'host': parsed.hostname, 'port': parsed.port}
        if parsed.username:
            proxy['auth'] = {'username': parsed.username, 'password': parsed.password or ''}
        pool.append(proxy)
    return pool


def proxy_mode():
    """'fallback' (default): staging calls go direct (the n8n IP is whitelisted) and use a proxy only on retries. 'always': every call uses a proxy."""
    mode = (os.environ.get('K1_STAGING_PROXY_MODE') or 'fallback').strip().lower()
    return mode if mode in ('fallback', 'always') else 'fallback'


_LIVE_POOL = []


def live_pool():
    """No proxy secrets in this environment: keep the pool the live booking workflow already carries (it is only used for retries)."""
    if not _LIVE_POOL:
        try:
            code = next(n for n in gate.request('GET', f'/workflows/{LIVE_BOOKING}')['nodes'] if n['name'] == 'Muster')['parameters']['jsCode']
            match = re.search(r'^const STAGING_PROXIES = (\[.*\])$', code, re.M)
            pool = json.loads(match.group(1)) if match else []
            _LIVE_POOL.append([p for p in pool if 'REDACTED' not in json.dumps(p)])
        except Exception:
            _LIVE_POOL.append([])
    return _LIVE_POOL[0]


def proxy_literal():
    return json.dumps(proxy_pool(), separators=(',', ':'))


def library():
    directory = json.dumps(json.loads((ROOT / 'data/k1-directory.json').read_text()), ensure_ascii=False, separators=(',', ':'))
    code = (HERE / 'k1-muster-v2.js').read_text()
    assert 'const DIRECTORY = __DIRECTORY__' in code
    faq = json.dumps([{k: v for k, v in e.items() if k in ('id', 'category', 'question', 'answer', 'links')} for e in json.loads((ROOT / 'data/a-katsastus-faq.json').read_text())], ensure_ascii=False, separators=(',', ':'))
    assert 'const FAQ = __FAQ__' in code
    return code.replace('const FAQ = __FAQ__', 'const FAQ = ' + faq).replace('const DIRECTORY = __DIRECTORY__', f'const DIRECTORY = {directory}').replace('__STAGING_PROXIES__', proxy_literal()).replace('__STAGING_PROXY_MODE__', json.dumps(proxy_mode()))


def all_workflows():
    items, cursor = [], None
    while True:
        page = gate.request('GET', '/workflows?limit=250' + (f'&cursor={cursor}' if cursor else ''))
        items += page['data']
        cursor = page.get('nextCursor')
        if not cursor:
            return items


def by_name(name):
    for item in all_workflows():
        if item['name'] == name:
            return item['id']
    return None


def save(name, nodes, connections, source, activate):
    body = {'name': name, 'nodes': nodes, 'connections': connections, 'settings': {k: v for k, v in source.get('settings', {}).items() if k in SETTINGS_KEEP}}
    existing = by_name(name)
    if existing:
        gate.request('POST', f'/workflows/{existing}/deactivate')
        gate.request('PUT', f'/workflows/{existing}', body)
        wid = existing
    else:
        wid = gate.request('POST', '/workflows', body)['id']
    if activate:
        gate.request('POST', f'/workflows/{wid}/activate')
    return wid


def suffix_webhooks(nodes, owner):
    for node in nodes:
        if node['type'] == 'n8n-nodes-base.webhook':
            path = node['parameters']['path']
            if not path.endswith(SUFFIX):
                node['parameters']['path'] = path + SUFFIX
            node['webhookId'] = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{owner}/{node['name']}"))


OWNER_ATTACH_JS = """const original = $('When called by the agent').first().json
const rows = $input.all().flatMap((item) => (Array.isArray(item.json) ? item.json : [item.json]))
const failed = rows.some((row) => row && (row.message || row.error || row.code) && !row.groupId)
const tail = (value) => String(value || '').replace(/\\D/g, '').slice(-9)
const caller = tail(original.phone)
const mine = rows.filter((row) => caller && row && row.groupId && row.status === 'confirmed' && tail(row.phone) === caller)
const details = mine.map((row) => ({ groupId: row.groupId, reservationUid: row.reservationUid, customerUid: row.customerUid, bookingNumber: row.bookingNumber, stationId: row.stationId, stationName: row.stationName, plate: row.plate, startsAt: row.startsAt, productIds: row.productIds || [] }))
return [{ json: { ...original, require_owner: true, owned_bookings: mine.map((row) => row.groupId), owned_details: details, owner_lookup_failed: failed } }]"""


def harden_booking(nodes, connections):
    """Idempotent: safe retries for the database save, and an ownership lookup before the agent cancels or moves a booking."""
    named = {node['name']: node for node in nodes}
    pool = proxy_literal()
    if pool != '[]':
        for node_name in ('Shape', 'Cancel in Muster'):
            js = named[node_name]['parameters']['jsCode']
            js = re.sub(r"^const PROXIES = .*\n", '', js, flags=re.M)
            js = re.sub(r", proxy: PROXIES\[[^\]]*\]", '', js)
            js = js.replace("json: true })", "json: true, proxy: PROXIES[Math.floor(Math.random() * PROXIES.length)] })")
            named[node_name]['parameters']['jsCode'] = f'const PROXIES = {pool}\n' + js
    record = named['Record booking']
    record.update({'retryOnFail': True, 'maxTries': 4, 'waitBetweenTries': 2000})
    record['parameters'].setdefault('options', {})['timeout'] = 15000
    if 'Attach owner data' in named:
        named['Attach owner data']['parameters']['jsCode'] = OWNER_ATTACH_JS
    if 'Needs ownership?' in named:
        return
    trigger = named['When called by the agent']
    x, y = trigger['position']
    uid = lambda name: str(uuid.uuid5(uuid.NAMESPACE_URL, f'k1-booking-owner/{name}'))
    nodes.append({'id': uid('if'), 'name': 'Needs ownership?', 'type': 'n8n-nodes-base.if', 'typeVersion': 2.2, 'position': [x + 140, y + 200], 'parameters': {
        'conditions': {'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2},
                       'conditions': [{'id': 'own', 'leftValue': '={{ ["cancel", "reschedule", "my_bookings"].includes($json.action) ? "yes" : "no" }}', 'rightValue': 'yes', 'operator': {'type': 'string', 'operation': 'equals'}}], 'combinator': 'and'}, 'options': {}}})
    nodes.append({'id': uid('lookup'), 'name': 'Owned bookings', 'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 4.2, 'position': [x + 300, y + 280], 'onError': 'continueRegularOutput', 'alwaysOutputData': True,
                  'retryOnFail': True, 'maxTries': 2, 'waitBetweenTries': 1000,
                  'credentials': {'supabaseApi': {'id': 'sKZQDTU3b68ZSLwX', 'name': 'K1 Agent builder DB'}},
                  'parameters': {'method': 'POST', 'url': 'https://wuejgskyjzuffqsgvunp.supabase.co/rest/v1/rpc/list_bookings', 'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'supabaseApi',
                                 'sendBody': True, 'specifyBody': 'json', 'jsonBody': '={{ { p_tenant_key: "k1_katsastus_demo", p_from: new Date(Date.now() - 86400000).toISOString(), p_to: new Date(Date.now() + 400 * 86400000).toISOString() } }}', 'options': {'timeout': 15000}}})
    nodes.append({'id': uid('attach'), 'name': 'Attach owner data', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [x + 460, y + 280], 'parameters': {'mode': 'runOnceForAllItems', 'jsCode': OWNER_ATTACH_JS}})
    connections['When called by the agent'] = {'main': [[{'node': 'Needs ownership?', 'type': 'main', 'index': 0}]]}
    connections['Needs ownership?'] = {'main': [[{'node': 'Owned bookings', 'type': 'main', 'index': 0}], [{'node': 'Muster', 'type': 'main', 'index': 0}]]}
    connections['Owned bookings'] = {'main': [[{'node': 'Attach owner data', 'type': 'main', 'index': 0}]]}
    connections['Attach owner data'] = {'main': [[{'node': 'Muster', 'type': 'main', 'index': 0}]]}


def base_workflow(kind, wid):
    """The live workflow as it was before the first promote (backups/), so builds stay reproducible after the live ones run v2."""
    saved = sorted(BACKUPS.glob(f'*-{kind}.json'))
    return json.loads(saved[0].read_text()) if saved else gate.request('GET', f'/workflows/{wid}')


def build_booking():
    live = base_workflow('booking', LIVE_BOOKING)
    nodes = json.loads(json.dumps(live['nodes']))
    suffix_webhooks(nodes, BOOKING_NAME)
    for node in nodes:
        if node['name'] == 'Muster':
            node['parameters']['jsCode'] = library()
    connections = json.loads(json.dumps(live['connections']))
    harden_booking(nodes, connections)
    return save(BOOKING_NAME, nodes, connections, live, activate=True)


def from_ai(name, description):
    assert '`' not in description and '{{' not in description
    return "={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('%s', `%s`, 'string') }}" % (name, description)


PT = "$('Playground Turn')"
LEAD = lambda key: "={{ %s.isExecuted ? String(%s.first().json.%s || '') : '' }}" % (PT, PT, key)
LEAD_FIELDS = {
    'lead_station': LEAD('lead_station'),
    'lead_station_id': LEAD('lead_station_id'),
    'lead_product': LEAD('lead_product'),
    'lead_vehicle_category': LEAD('lead_vehicle_category'),
}
PHONE = "={{ %s.isExecuted ? %s.first().json.from_phone : $('Webhook').first().json.body.from_phone }}" % (PT, PT)

STATION_HINT = 'Station name or city ONLY when the customer asks about a different station than their own. Leave EMPTY for the customer\'s own station (the lead\'s station).'
PRODUCT_HINT = 'Vehicle product: 004 (petrol/diesel/hybrid car or van), 004e (fully electric), 0040 (camper or larger car). Leave empty to use the lead\'s product for the lead\'s own plate. Pass unknown if the customer gave another plate or vehicle and you have not yet asked what it is.'
MEASURING_HINT = 'true (default) or false. The statutory emissions measuring is included by default for petrol/diesel/hybrid cars and campers. Pass false ONLY when the customer asked to leave the measuring out of this inspection (it can be done elsewhere). Leave empty otherwise.'
CATEGORY_HINT = 'Vehicle category: M1 (car or camper) or N1 (van). Leave empty to use the lead\'s category (default M1).'

TOOLS = {
    'get_slots': {
        'description': 'Live free appointment times for one station, already limited to that station\'s opening hours, with a price for the vehicle. The ONLY source of appointment times and slot_id values. Pass date_from and date_to as YYYY-MM-DD (Europe/Helsinki, at most 14 days apart). Leave station empty for the customer\'s own station. Returns a per-day summary (station_hours, free_count, first, last, up to three suggestions, and all_times for a single day). If it returns needs_product, ask the vehicle question it gives. If bookable_by_assistant is false, times are informational only and there are no slot_ids.',
        'ai': {
            'station': STATION_HINT, 'product': PRODUCT_HINT, 'vehicle_category': CATEGORY_HINT, 'include_measuring': MEASURING_HINT,
            'date_from': 'YYYY-MM-DD, Europe/Helsinki. Default: tomorrow.', 'date_to': 'YYYY-MM-DD, Europe/Helsinki. Same as date_from for a single day.',
        },
        'fixed': {'action': 'get_slots', 'phone': PHONE, **LEAD_FIELDS},
    },
    'get_station_info': {
        'description': 'Live facts for ONE K1 station: opening hours for a date (default today) and the next days, address, whether the assistant can book there, prices for the vehicle, and a short preview of free times inside the opening hours. Use it first for any question about hours, prices, another station, or whether you can book somewhere. Leave station empty for the customer\'s own station; name another station or city only when the customer asks about it. Returns ambiguous candidates when a city has several stations: ask which one.',
        'ai': {
            'station': STATION_HINT, 'date': 'YYYY-MM-DD, Europe/Helsinki. Default today.',
            'product': PRODUCT_HINT, 'vehicle_category': CATEGORY_HINT, 'include_measuring': MEASURING_HINT,
        },
        'fixed': {'action': 'station_info', 'phone': PHONE, **LEAD_FIELDS},
    },
}
TOOLS['get_my_bookings'] = {
    'description': 'The customer\'s own upcoming bookings made through this chat, found from their phone number: count and a list with event_id, booking_number, station_name, plate, date, time, includes_measuring. Call it first, without asking anything, when the customer asks whether they have a booking, or wants to cancel or move one. It has no inputs.',
    'ai': {},
    'fixed': {'action': 'my_bookings', 'phone': PHONE},
}
TOOLS['faq_lookup'] = {
    'description': 'Look up the official A-Katsastus FAQ (inspections and post-inspection, receipts, leasing, registering, decommissioning and commissioning vehicles, change of ownership, plates, insurance, wipers and screenwash, Autotohtori, the Muistakatsastus reminder, emission tests, driving licences and permits). Pass 2 to 6 English keywords for the topic, for example "post-inspection deadline" or "change of ownership". Returns up to three matching entries with question, answer and links. Answer only from the best entry; if matches is empty say you do not have that information. Not for opening hours or prices.',
    'ai': {'query': '2 to 6 English keywords for the topic of the customer\'s question, whatever language the customer wrote in.'},
    'fixed': {'action': 'faq', 'phone': PHONE},
}
SCHEMA_ENTRY = lambda key: {'id': key, 'displayName': key, 'type': 'string', 'display': True, 'required': False, 'defaultMatch': False, 'canBeUsedToMatch': True}
SLOT_TOOLS = {
    'book_inspection_invite': 'Book a NEW inspection. FORBIDDEN unless the customer named a clock time. start_time MUST be the exact slot_id from get_slots (it already contains the station, the products and the vehicle category); copy the slot_id of the entry whose time is the chosen one, and also pass that chosen clock time in time. Reuse plate, name and phone. success true includes booking_number and event_id. If success is false, it is not booked.',
    'reschedule_booking': 'Move an existing booking. start_time is the new slot_id from get_slots (the entry whose time is the chosen one); also pass that chosen clock time in time. event_id comes from get_my_bookings (or from the booking made in this conversation). The booking number stays the same.',
    'cancel_booking': 'Cancel an existing booking. event_id is required and comes from get_my_bookings (or from the booking made in this conversation). sendConfirmation is never used. If already_cancelled is true, it was already gone.',
}

LANGUAGE_CORE = '''const LANGUAGE_WORDS = {
  English: 'the a an and or is are was be you your can could would please do does have has what which when where how much many about after before tomorrow today times time day week next book booking me my we our to of for with on at in it this that yes no hi hello thanks thank want need move cancel price cost open close hours station',
  Swedish: 'och jag det att är på för inte kan vill har vilken vilka vilket imorgon idag tid tider boka bokning vad kostar hur en ett till av som då fredag måndag tisdag onsdag torsdag lördag söndag hej tack ja nej öppet öppettider stationen avboka flytta pris',
  Finnish: 'ja on ei en mitä miten paljon huomenna tänään aikoja aika ajan haluan haluaisin varata varaus kiitos voisinko voidaanko onko olen minä minulle mulle sopii se että kuinka maksaa katsastus auki milloin mihin asti kello klo moi hei joo kyllä perjantaina maanantaina peruuta siirtää hinta asema aseman jatkaa suomeksi suomea suomi paremmin olette me ollaan oman omaa kanssa sulla sulle sun mun mut mutta muuten miks miksi mitäs mistä missä kuka mikä onks oon kyl tuo tämä nyt vielä siis vai tai jos kun niin vaan ihan voin voi pitää pitäisi mä sä ole ollut sinä sinun teidän ettei jotta tai myös',
}
const LANGUAGE_STEMS = {
  Finnish: ['peruu', 'peruut', 'varau', 'varat', 'tunniste', 'katsast', 'rekister', 'haluai', 'haluan', 'huomen', 'aukio', 'aikoj', 'maksa', 'suome', 'kiitos', 'tarvit', 'siirt', 'vapaa'],
  Swedish: ['bokning', 'avbok', 'besikt', 'registrer', 'öppettid', 'lediga', 'kostar'],
}
const FINNISH_ENDING = /(?:ssa|ssä|stä|llä|ltä|ksi|aan|ään|nsa|nsä|ttä|isiä)$/
const LANGUAGE_REQUESTS = [
  ['Finnish', /suomeksi|suomen kiel|suomea\\b|på finska|\\bfinska\\b|\\b(?:in|speak|write|reply|answer|respond|use|switch to|talk|chat|continue in|go with)\\s+(?:in\\s+)?finnish\\b(?!\\s+(?:time|timezone|time zone|station|stations|prices?|market|euros?|currency|law|rules?))|\\bfinnish\\s+(?:please|pls|only)\\b|^\\s*finnish[\\s?!.]*$|\\bpuhu suomea/i],
  ['Swedish', /ruotsiksi|ruotsin kiel|ruotsia\\b|på svenska|\\bsvenska\\b|\\b(?:in|speak|write|reply|answer|respond|use|switch to|talk|chat|continue in|go with)\\s+(?:in\\s+)?swedish\\b(?!\\s+(?:time|timezone|time zone|station|stations|prices?|market|euros?|currency|law|rules?))|\\bswedish\\s+(?:please|pls|only)\\b|^\\s*swedish[\\s?!.]*$/i],
  ['English', /englanniksi|englannin kiel|englantia\\b|på engelska|\\bengelska\\b|\\b(?:in|speak|write|reply|answer|respond|use|switch to|talk|chat|continue in|go with)\\s+(?:in\\s+)?english\\b(?!\\s+(?:time|timezone|time zone|station|stations|prices?|market|euros?|currency|law|rules?))|\\benglish\\s+(?:please|pls|only)\\b|^\\s*english[\\s?!.]*$/i],
]
const detectLanguage = (value) => {
  const translating = /k[aä]ännä|kääntä|translate|översätt|\\böversätta/i.test(String(value || ''))
  const asked = translating ? [] : LANGUAGE_REQUESTS.filter(([, pattern]) => pattern.test(String(value || ''))).map(([name]) => name)
  if (asked.length === 1) return asked[0]
  const words = (String(value || '').toLowerCase().replace(/\\S*\\d\\S*/g, ' ').match(/[\\p{L}]+/gu) || []).filter((word) => word.length > 1)
  const scores = Object.entries(LANGUAGE_WORDS).map(([name, list]) => [name, words.filter((word) => list.split(' ').includes(word) || (LANGUAGE_STEMS[name] || []).some((stem) => word.length > stem.length && word.startsWith(stem)) || (name === 'Finnish' && word.length >= 5 && FINNISH_ENDING.test(word))).length]).sort((a, b) => b[1] - a[1])
  return scores[0][1] >= 2 && scores[0][1] > scores[1][1] ? scores[0][0] : ''
}
const languageOrder = (language) => `REPLY LANGUAGE: ${language}. Write every word of your reply in ${language}, including the first sentence and any confirmation of the switch. The lead's stored language and the language of the opener or earlier turns no longer apply.`
'''
LANGUAGE_JS = LANGUAGE_CORE + '''const languageText = String(body.text || (((Array.isArray(body.messages) ? body.messages : []).filter((message) => message.role === 'user').pop()) || {}).content || '')
const languageHint = detectLanguage(languageText)
'''
PLAYGROUND_LANGUAGE = (
    "  'turn_type: user_message',",
    "  'turn_type: user_message',\n  languageHint ? `customer_latest_message_language: ${languageHint}` : '',",
)
PLAYGROUND_LEADLANG = (
    "  String(body.leadContext || ''),",
    "  languageHint ? String(body.leadContext || '').replace(/(Customer's language:)[^\\n]*/i, `$1 ${languageHint} (the customer is now writing in or asking for ${languageHint}; the stored lead language no longer applies)`) : String(body.leadContext || ''),",
)
PLAYGROUND_TAIL = (
    "  text || (latest && latest.content) || ''\n].join('\\n')",
    "  text || (latest && latest.content) || '',\n  languageHint ? '\\n[' + languageOrder(languageHint) + ']' : ''\n].join('\\n')",
)
BUILD_TURN_LANGUAGE = (
    "const agent_input = [\n  '[TURN]',\n  'turn_type: user_message',",
    LANGUAGE_CORE.rstrip() + "\nconst languageHint = detectLanguage(text)\nconst agent_input = [\n  '[TURN]',\n  'turn_type: user_message',\n  languageHint ? `customer_latest_message_language: ${languageHint}` : null,",
)
BUILD_TURN_TAIL = (
    "  '[USER]',\n  text\n].filter(Boolean)",
    "  '[USER]',\n  text,\n  languageHint ? '\\n[' + languageOrder(languageHint) + ']' : null\n].filter(Boolean)",
)
PLAYGROUND_PATCH = (
    "  `station_id: ${body.stationId || 'unknown'}`,",
    "  `station: ${body.stationName || 'unknown'}`,\n  `lead_product: ${leadProduct || 'unknown'}`,\n  `lead_vehicle_category: ${leadCategory || 'unknown'}`,\n  `lead_plate: ${body.plate || ''}`,",
)
PLAYGROUND_PREAMBLE = (
    "const phone = String(body.phone || '').trim()",
    "const phone = String(body.phone || '').trim()\n"
    "const contextLine = (label) => { const hit = String(body.leadContext || '').match(new RegExp(label + ':\\\\s*([A-Za-z0-9]+)', 'i')); return hit ? hit[1] : '' }\n"
    "const leadProduct = String(body.product || contextLine('Product on the reminder') || '').trim().toLowerCase()\n"
    "const leadCategory = String(body.vehicleCategory || contextLine('Vehicle category') || '').trim().toUpperCase()\n" + LANGUAGE_JS.rstrip(),
)
# The reply-language order is appended after [USER] for the model only; the stored chat history keeps just what the customer wrote.
RECORD_USER_TEXT = (
    'p_user_text: $("Playground Turn").first().json.agent_input.split("[USER]").pop().trim()',
    'p_user_text: $("Playground Turn").first().json.agent_input.split("[USER]").pop().replace(/\\n\\[REPLY LANGUAGE:[\\s\\S]*$/, "").trim()',
)
PLAYGROUND_OPENER = (
    "  '[LEAD]',",
    "  '[OPENER ALREADY SENT TO CUSTOMER]',\n  String(body.opener || ''),\n  'The customer is replying to this message. Do not send the opener again; answer what they said.',\n  '',\n  '[LEAD]',",
)
PLAYGROUND_RETURN = (
    "  station_id: body.stationId || null,",
    "  station_id: body.stationId || null,\n  lead_station: String(body.stationName || ''),\n  lead_station_id: body.stationId || '',\n  lead_product: leadProduct,\n  lead_vehicle_category: leadCategory,",
)


DASH_CLEAN = "String(m ?? '').replace(/\\s*[\u2014]\\s*|\\s+[\u2013-]\\s+/g, ', ').trim().replace(/^(?:Absolut|Visst|Okej|Okey|Toppen|Självklart|Sure|Okay|Absolutely|Of course|Certainly|Alright|Sounds good|Selvä|Okei|Kiva kuulla)\\s*[,!.]\\s+(?=\\S)/i, '').replace(/^\\p{Ll}/u, (c) => c.toUpperCase())"
PLAN_DELIVERY_CLEAN = (
    "msgs = msgs.map(m => String(m ?? '').trim()).filter(Boolean).slice(0, maxBubbles);",
    "msgs = msgs.map(m => " + DASH_CLEAN + ").filter(Boolean).slice(0, maxBubbles);",
)
PLAN_FOLLOWUP_CLEAN = (
    "const text = msgs.map(m => String(m ?? '').trim()).filter(Boolean).join(' ').trim();",
    "const text = msgs.map(m => " + DASH_CLEAN + ").filter(Boolean).join(' ').trim();",
)
NORMALIZE_PATCHES = (
    ("const messages = lines.filter((line) => typeof line === 'string').map((line) => line.trim()).filter(Boolean)",
     "const messages = lines.filter((line) => typeof line === 'string').map((line) => String(line).replace(/\\s*[\u2014]\\s*|\\s+[\u2013-]\\s+/g, ', ').trim().replace(/^(?:Absolut|Visst|Okej|Okey|Toppen|Självklart|Sure|Okay|Absolutely|Of course|Certainly|Alright|Sounds good|Selvä|Okei|Kiva kuulla)\\s*[,!.]\\s+(?=\\S)/i, '').replace(/^\\p{Ll}/u, (c) => c.toUpperCase())).filter(Boolean)"),
    ("fallback: !lines.some((line) => typeof line === 'string' && line.trim()) }", "fallback: !lines.some((line) => typeof line === 'string' && line.trim()) && !reactionOnly }"),
    ("if (!messages.length) {\n", "const reactionOnly = String(raw.reaction || '').trim()\nif (!messages.length && reactionOnly) messages.push(reactionOnly)\nif (!messages.length) {\n"),
    ("const agent = $('AI Agent').first().json\n", LANGUAGE_CORE.rstrip() + "\nconst agent = $('AI Agent').first().json\n"),
    (r"""  const lang = /\b(hej|visst|tack|boka|besiktning)\b|nästa|imorgon/i.test(text) ? 'sv'
    : /\b(joo|moi|hei|kiitos|huomenna|ensi|varaa|katsastus)\b|kyllä/i.test(text) ? 'fi' : 'en'
""", r"""  const leadName = (String(body.leadContext || '').match(/Customer's language:\s*([A-Za-z]+)/i) || [])[1] || ''
  const pastText = [...(Array.isArray(body.messages) ? body.messages : [])].reverse().filter((entry) => entry.role === 'user').map((entry) => String(entry.content || '')).find((value) => detectLanguage(value)) || ''
  const lang = { Finnish: 'fi', Swedish: 'sv', English: 'en' }[detectLanguage(text) || detectLanguage(pastText)] || { finnish: 'fi', swedish: 'sv', english: 'en' }[leadName.toLowerCase()] || 'fi'
"""),
    ("fi: 'Hyvä! Mille päivälle katsotaan katsastusaikaa?', sv: 'Absolut! Vilken dag passar dig för besiktningen?', en: 'Sure! Which day would suit you for the inspection?'",
     "fi: 'Mille päivälle?', sv: 'Vilken dag passar?', en: 'What day works best?'"),
)
SYSTEM_STYLE_PATCHES = (
    (("Split like a person does: acknowledgement, then substance, then the question.", "Default to ONE bubble. Give the substance and the single question together; never add an acknowledgement bubble."), 'shape'),
    (("Say something warm and ask for a day.", "Do not ask which day. Call get_slots from tomorrow and offer the first day's times. Do not echo their word and do not open with an acknowledgement."), 'ack'),
    (("(\"no rush — want me to leave this with you?\")", "(\"no rush, want me to leave this with you?\")"), 'dash example'),
    (("## OUTPUT CONTRACT\n", "## STYLE (overrides everything above)\n- Terse: one bubble, one short sentence, two at most.\n- Never open with an acknowledgement or an echo of the customer's word (Sure, Okay, Great, Absolutely, Of course, Selvä, Okei, Hyvä, Visst, Okej). If they answer \"sure\", \"yes\", \"joo\" or \"ok\" to your offer to find a time, the reply is the times themselves from get_slots.\n- No em dashes, no spaced en dashes or hyphens as punctuation. Use a comma or a new sentence.\n\n## OUTPUT CONTRACT\n"), 'style'),
)


def replace_once(text, pair, label):
    old, new = pair
    if text.count(old) != 1:
        raise SystemExit(f'cannot patch {label}: expected one match, found {text.count(old)}')
    return text.replace(old, new)


def business_prompt(current):
    head = (ROOT / 'prompts/k1-conversational-head.md').read_text().rstrip()
    rules = (ROOT / 'prompts/k1-business-prompt-v2.md').read_text().strip()
    return f'{head}\n\n{rules}\n'


def build_agent(booking_id):
    live = base_workflow('agent', LIVE_AGENT)
    nodes = json.loads(json.dumps(live['nodes']))
    connections = json.loads(json.dumps(live['connections']))
    suffix_webhooks(nodes, AGENT_NAME)
    named = {node['name']: node for node in nodes}
    point = lambda node: node['parameters']['workflowId'].update({'value': booking_id, 'cachedResultName': BOOKING_NAME})

    for name, node in named.items():
        if node['name'] == '⚙️ CONFIG':
            for item in node['parameters']['assignments']['assignments']:
                if item['name'] == 'business_prompt':
                    item['value'] = business_prompt(item['value'])
        if node['name'] == 'opt_out':
            node['parameters']['description'] = 'Stop reminders for this number. Call when the customer asks to stop messages or not be contacted, refuses reminders, or says the car is already inspected. Never for a sold car, a new plate or another vehicle. Pass puhelin.'
        if node['name'] == 'escalate_to_human':
            node['parameters']['description'] = 'Flag the conversation for staff. Only when the customer asks for a person, demands compensation, refuses to continue, or reports a legal, safety or accident matter. Never for swearing or rudeness alone, payment methods, phone hours, off-topic chat, or a question you can answer or point to 0306 100 100 for. Pass syy.'
        if node['name'] == 'AI Agent':
            options = node['parameters']['options']
            options['systemMessage'] = replace_once(
                options['systemMessage'],
                ("Never invent prices, availability, dates or policy that aren't in the brief below.", "Never invent prices, availability, opening hours, dates or policy that are not in the brief below or in a tool result."),
                'system message')
            for pair, label in SYSTEM_STYLE_PATCHES:
                options['systemMessage'] = replace_once(options['systemMessage'], pair, f'system message {label}')
        if node['name'] == 'Plan Delivery':
            node['parameters']['jsCode'] = replace_once(node['parameters']['jsCode'], PLAN_DELIVERY_CLEAN, 'Plan Delivery dashes')
        if node['name'] == 'Plan Follow-up Delivery':
            node['parameters']['jsCode'] = replace_once(node['parameters']['jsCode'], PLAN_FOLLOWUP_CLEAN, 'Plan Follow-up Delivery dashes')
        if node['name'] == 'Normalize playground reply':
            code = node['parameters']['jsCode']
            for label, pair in enumerate(NORMALIZE_PATCHES):
                code = replace_once(code, pair, f'Normalize playground reply {label}')
            node['parameters']['jsCode'] = code
        if node['name'] == 'Playground Turn':
            code = node['parameters']['jsCode']
            for pair, label in ((PLAYGROUND_PREAMBLE, 'preamble'), (PLAYGROUND_OPENER, 'opener'), (PLAYGROUND_LANGUAGE, 'language'), (PLAYGROUND_LEADLANG, 'lead language'), (PLAYGROUND_TAIL, 'language order'), (PLAYGROUND_PATCH, 'agent input'), (PLAYGROUND_RETURN, 'return')):
                code = replace_once(code, pair, f'Playground Turn {label}')
            node['parameters']['jsCode'] = code
        if node['name'] == 'Record playground turn':
            node['parameters']['jsonBody'] = replace_once(node['parameters']['jsonBody'], RECORD_USER_TEXT, 'Record playground turn user text')
        if node['name'] == 'Build Turn':
            code = node['parameters']['jsCode']
            for pair, label in ((BUILD_TURN_LANGUAGE, 'language'), (BUILD_TURN_TAIL, 'language order')):
                code = replace_once(code, pair, f'Build Turn {label}')
            node['parameters']['jsCode'] = code
        if node['name'] == 'Playground reply':
            code = node['parameters']['jsCode']
            code = replace_once(code, ("new Set(['get_slots',", "new Set(['faq_lookup', 'get_station_info', 'get_my_bookings', 'get_slots',"), 'allowed tools')
            code = replace_once(code, ("new Set(['station_id',", "new Set(['query', 'station', 'product', 'vehicle_category', 'include_measuring', 'date', 'station_id',"), 'allowed inputs')
            node['parameters']['jsCode'] = code

    def define(node, ai, fixed):
        values = {'email': '', 'start_time': '', 'name': '', 'rek': '', 'language': '', 'date_from': '', 'date_to': '', 'event_id': '', 'station_id': ''}
        values.update(fixed)
        for key, hint in ai.items():
            values[key] = from_ai(key, hint)
        node['parameters']['workflowInputs'] = {'mappingMode': 'defineBelow', 'value': values, 'matchingColumns': [], 'schema': [SCHEMA_ENTRY(key) for key in values], 'attemptToConvertTypes': False, 'convertFieldsToString': True}

    for name, spec in TOOLS.items():
        if name in named:
            node = named[name]
        else:
            template = named['get_slots']
            node = json.loads(json.dumps(template))
            node.update({'id': str(uuid.uuid4()), 'name': name, 'position': [template['position'][0], template['position'][1] + 220]})
            node['parameters']['name'] = name
            nodes.append(node)
            named[name] = node
            connections[name] = {'ai_tool': [[{'node': 'AI Agent', 'type': 'ai_tool', 'index': 0}]]}
        point(node)
        node['parameters']['description'] = spec['description']
        define(node, spec['ai'], spec['fixed'])

    for name, description in SLOT_TOOLS.items():
        node = named[name]
        point(node)
        node['parameters']['description'] = description
        value = node['parameters']['workflowInputs']['value']
        value['station_id'] = ''
        value['phone'] = PHONE
        if name in ('book_inspection_invite', 'reschedule_booking'):
            value['time'] = from_ai('time', 'The clock time the customer chose, written HH:MM in Finnish local time exactly as the get_slots time field shows it (for example 16:30). Always fill it in.')
        for key in ('lead_station', 'lead_station_id', 'lead_product', 'lead_vehicle_category'):
            value.pop(key, None)
        node['parameters']['workflowInputs']['schema'] = [entry for entry in node['parameters']['workflowInputs'].get('schema', []) if entry['id'] in value]
        for key in value:
            if not any(entry['id'] == key for entry in node['parameters']['workflowInputs']['schema']):
                node['parameters']['workflowInputs']['schema'].append(SCHEMA_ENTRY(key))

    add_agent_error_branch(nodes, connections)
    return save(AGENT_NAME, nodes, connections, live, activate=True)


AGENT_ERROR_JS = r"""// The model provider can refuse a message (for example content it treats as a cyber-security risk). The builder chat then gets a safe answer instead of a 500.
let playground = false
try { playground = Boolean($('Playground Turn').isExecuted) } catch (error) { playground = false }
if (!playground) return []
const body = $('Playground').first().json.body || {}
const text = String(body.text || '')
const leadLanguage = (String(body.leadContext || '').match(/Customer's language:\s*([A-Za-z]+)/i) || [])[1] || ''
const fallbackLang = { finnish: 'fi', swedish: 'sv', english: 'en' }[leadLanguage.toLowerCase()] || 'fi'
const lang = /\b(hej|visst|tack|boka|besiktning|vad|hur|vilken|var|har|du|fått|jag|mitt|min|inte|och|det)\b|nästa|imorgon/i.test(text) ? 'sv'
  : /\b(joo|moi|hei|kiitos|huomenna|ensi|varaa|katsastus|mitä|milloin|mistä|olet|minun|miksi)\b|kyllä/i.test(text) ? 'fi'
  : /\b(the|what|when|where|how|can|please|you|my|is|are|do|does)\b/i.test(text) ? 'en' : fallbackLang
const reply = { fi: 'En voinut käsitellä tuota viestiä. Voitko kirjoittaa sen toisin, tai soittaa numeroon 0306 100 100?',
  sv: 'Jag kunde inte behandla det meddelandet. Kan du skriva det på ett annat sätt, eller ringa 0306 100 100?',
  en: "I couldn't process that message. Could you rephrase it, or call 0306 100 100?" }[lang]
return [{ json: { reply, mode: 'muster', recorded: false, messageId: null, userMessageId: null, toolCalls: [], fallback: true } }]"""


def add_agent_error_branch(nodes, connections):
    agent = next(n for n in nodes if n['name'] == 'AI Agent')
    agent['onError'] = 'continueErrorOutput'
    if not any(n['name'] == 'Agent error reply' for n in nodes):
        nodes.append({'id': str(uuid.uuid4()), 'name': 'Agent error reply', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [agent['position'][0] + 400, agent['position'][1] + 520],
                      'parameters': {'mode': 'runOnceForAllItems', 'jsCode': AGENT_ERROR_JS}})
    main = connections['AI Agent']['main']
    assert len(main) >= 1
    connections['AI Agent']['main'] = [main[0], [{'node': 'Agent error reply', 'type': 'main', 'index': 0}]]
    connections['Agent error reply'] = {'main': [[{'node': 'Respond to playground', 'type': 'main', 'index': 0}]]}


SMOKE_CASES = [
    ('station_info, lead station Palokka', {'action': 'station_info', 'lead_station': 'K1 Katsastus Jyväskylä Palokka', 'lead_product': '004', 'lead_vehicle_category': 'M1'}),
    ('station_info, other station (Tampere is ambiguous)', {'action': 'station_info', 'station': 'Tampere'}),
    ('station_info, other station not bookable here', {'action': 'station_info', 'station': 'Kuopio', 'product': '004'}),
    ('get_slots, Itäharju, electric', {'action': 'get_slots', 'station': 'Turku Itäharju', 'product': '004e'}),
    ('get_slots, Palokka, unknown vehicle', {'action': 'get_slots', 'station': 'Palokka'}),
    ('get_slots, readable-only station', {'action': 'get_slots', 'station': 'Oulu Alppila', 'product': '004'}),
]


def smoke():
    smoke_path = 'k1-v2-smoke-' + uuid.uuid4().hex[:10]
    body = {
        'name': 'K1 v2 smoke (temporary)',
        'nodes': [
            {'id': str(uuid.uuid4()), 'name': 'Hook', 'type': 'n8n-nodes-base.webhook', 'typeVersion': 2.1, 'webhookId': str(uuid.uuid4()), 'position': [0, 0], 'parameters': {'httpMethod': 'POST', 'path': smoke_path, 'responseMode': 'lastNode', 'options': {}}},
            {'id': str(uuid.uuid4()), 'name': 'Muster', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [240, 0], 'parameters': {'mode': 'runOnceForAllItems', 'jsCode': library()}},
        ],
        'connections': {'Hook': {'main': [[{'node': 'Muster', 'type': 'main', 'index': 0}]]}},
        'settings': {'executionOrder': 'v1'},
    }
    wid = gate.request('POST', '/workflows', body)['id']
    try:
        gate.request('POST', f'/workflows/{wid}/activate')
        base = (os.environ.get('N8N_RAPID_BASE_URL') or gate.local_env().get('N8N_RAPID_BASE_URL') or gate.DEFAULT_BASE).rstrip('/')
        for label, payload in SMOKE_CASES:
            req = lambda: urllib.request.Request(f'{base}/webhook/{smoke_path}', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'}, method='POST')
            for attempt in range(6):
                try:
                    with urllib.request.urlopen(req(), timeout=120) as res:
                        out = json.loads(res.read())
                    break
                except urllib.error.HTTPError as error:
                    if error.code != 404 or attempt == 5:
                        raise
                    time.sleep(3)
            out = out[0] if isinstance(out, list) else out
            print('---', label)
            print(json.dumps(summarise(out), ensure_ascii=False, indent=1)[:1600])
    finally:
        gate.request('POST', f'/workflows/{wid}/deactivate')
        for attempt in range(5):
            try:
                gate.request('DELETE', f'/workflows/{wid}')
                break
            except urllib.error.HTTPError:
                time.sleep(3)


def summarise(out):
    keep = ('ok', 'error', 'ambiguous', 'needs_product', 'unsupported', 'station', 'hours', 'booking', 'bookable_by_assistant', 'price', 'price_estimate_for_this_vehicle', 'availability', 'days', 'candidates', 'vehicle')
    trimmed = {k: out[k] for k in keep if k in out}
    if isinstance(trimmed.get('days'), list):
        trimmed['days'] = [{k: v for k, v in day.items() if k != 'all_times'} for day in trimmed['days'][:2]]
    if isinstance(trimmed.get('hours'), dict):
        trimmed['hours'] = {k: v for k, v in trimmed['hours'].items() if k != 'next_days'}
    return trimmed


LIVE_BOOKING_NAME = 'K1 Muster Booking (staging)'


def scrub_secrets(text):
    """Backups are committed; proxy passwords in the live nodes must not be."""
    for proxy in proxy_pool():
        for secret in (proxy.get('auth') or {}).values():
            if secret:
                text = text.replace(secret, 'REDACTED')
    return text


def snapshot(wid):
    workflow = gate.request('GET', f'/workflows/{wid}')
    return {k: workflow[k] for k in ('id', 'name', 'nodes', 'connections', 'settings', 'active')}


def put_live(wid, body, activate):
    gate.request('POST', f'/workflows/{wid}/deactivate')
    gate.request('PUT', f'/workflows/{wid}', {'name': body['name'], 'nodes': body['nodes'], 'connections': body['connections'], 'settings': {k: v for k, v in body['settings'].items() if k in SETTINGS_KEEP}})
    if activate:
        gate.request('POST', f'/workflows/{wid}/activate')


def transplant(candidate, live, booking_target=None):
    """Candidate content with the live workflow's webhook paths/ids, name and (for the agent) booking-tool target."""
    live_hooks = {n['name']: n for n in live['nodes'] if n['type'] == 'n8n-nodes-base.webhook'}
    nodes = json.loads(json.dumps(candidate['nodes']))
    for node in nodes:
        if node['type'] == 'n8n-nodes-base.webhook':
            source = live_hooks[node['name']]
            node['parameters']['path'] = source['parameters']['path']
            node['webhookId'] = source['webhookId']
        if booking_target and node['type'] == '@n8n/n8n-nodes-langchain.toolWorkflow':
            node['parameters']['workflowId'].update({'value': booking_target[0], 'cachedResultName': booking_target[1]})
    text = json.dumps(nodes)
    assert booking_target is None or candidate_booking_id() not in text, 'candidate booking id left in the agent'
    return {'name': live['name'], 'nodes': nodes, 'connections': candidate['connections'], 'settings': candidate['settings']}


def candidate_booking_id():
    return by_name(BOOKING_NAME)


def promote():
    booking_id, agent_id = by_name(BOOKING_NAME), by_name(AGENT_NAME)
    assert booking_id and agent_id, 'build the candidates first'
    live_booking, live_agent = snapshot(LIVE_BOOKING), snapshot(LIVE_AGENT)
    BACKUPS.mkdir(exist_ok=True)
    stamp = time.strftime('%Y%m%d-%H%M%S')
    (BACKUPS / f'{stamp}-booking.json').write_text(scrub_secrets(json.dumps(live_booking, ensure_ascii=False)))
    (BACKUPS / f'{stamp}-agent.json').write_text(scrub_secrets(json.dumps(live_agent, ensure_ascii=False)))
    new_booking = transplant(snapshot(booking_id), live_booking)
    new_agent = transplant(snapshot(agent_id), live_agent, (LIVE_BOOKING, live_booking['name']))
    put_live(LIVE_BOOKING, new_booking, live_booking['active'])
    put_live(LIVE_AGENT, new_agent, live_agent['active'])
    print(f'promoted: backups {stamp}-*.json; live booking {LIVE_BOOKING}, live agent {LIVE_AGENT}')


def rollback():
    stamps = sorted({p.name.split('-booking')[0].split('-agent')[0] for p in BACKUPS.glob('*.json')})
    assert stamps, 'no backups'
    stamp = stamps[-1]
    for wid, kind in ((LIVE_BOOKING, 'booking'), (LIVE_AGENT, 'agent')):
        body = json.loads((BACKUPS / f'{stamp}-{kind}.json').read_text())
        put_live(wid, body, body['active'])
    print('rolled back to', stamp)


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else 'build'
    if command == 'build':
        booking = build_booking()
        agent = build_agent(booking)
        print(f'booking candidate {booking}\nagent candidate   {agent}\nplayground path   booking-chat{SUFFIX}')
    elif command == 'agent':
        booking = by_name(BOOKING_NAME)
        print('agent candidate  ', build_agent(booking))
    elif command == 'smoke':
        smoke()
    elif command == 'promote':
        promote()
    elif command == 'rollback':
        rollback()
    elif command == 'delete':
        for name in (AGENT_NAME, BOOKING_NAME):
            wid = by_name(name)
            if wid:
                gate.request('POST', f'/workflows/{wid}/deactivate')
                gate.request('DELETE', f'/workflows/{wid}')
                print('deleted', name)
    else:
        raise SystemExit(__doc__)


if __name__ == '__main__':
    main()
