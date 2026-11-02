#!/usr/bin/env python3
"""Builds the v2 K1 agent as two CANDIDATE workflows next to the live ones. Nothing live is changed.

  K1 Muster Booking v2 (candidate)   copy of the live booking workflow, Muster node replaced by k1-muster-v2.js
  K1 Muster agent v2 (candidate)     copy of the live playground agent, tools repointed and extended, prompt v2

Usage:
  python3 k1-agent-v2-build.py build     create or update both candidates (idempotent, by name)
  python3 k1-agent-v2-build.py smoke     run the Code node inside n8n against staging, production (GET only) and the K1 site
  python3 k1-agent-v2-build.py delete    remove both candidates
  python3 k1-agent-v2-build.py promote   REPLACE the live booking + agent workflows with the candidates (live paths, ids and names are kept);
                                         the previous live workflows are saved to design/k1-fresh/backups/ first; refused unless
                                         k1-gate.py check passed for the prompt being shipped (--without-gate only for an emergency fix)
  python3 k1-agent-v2-build.py rollback  restore the live workflows from the newest backup
  python3 k1-agent-v2-build.py wire      patch the live booking links and the WhatsApp test-chat log in place
  python3 k1-agent-v2-build.py finish    patch the live reply nodes and the WhatsApp rewrite log in place
  python3 k1-agent-v2-build.py cta       put link buttons back on live sends, and the first-bubble footer
  python3 k1-agent-v2-build.py typing    ack Wasup with skip:true before the agent, and keep composing off the reply path

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
prompt_spec = importlib.util.spec_from_file_location('k1_prompt', HERE / 'k1-prompt.py')
k1_prompt = importlib.util.module_from_spec(prompt_spec)
prompt_spec.loader.exec_module(k1_prompt)
spec.loader.exec_module(gate)

BACKUPS = ROOT / 'backups'
LIVE_BOOKING = 'wAE7EHLyJk6JsMue'
LIVE_AGENT = 'w8a9S1uxB5U9qnNO'
STAGING_SEND = 'p6V9Jtytz4eN4MYw'
BOOKING_NAME = 'K1 Muster Booking v2 (candidate)'
AGENT_NAME = 'K1 Muster agent v2 (candidate)'
PAYMENT_NAME = 'K1 v10 payment'
SUFFIX = '-v2'
SETTINGS_KEEP = ('executionOrder', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'saveManualExecutions', 'timezone', 'errorWorkflow', 'executionTimeout')
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
# Reply language for booking links. Read from the turn the model already sees, so English and Swedish
# chats get /en/reservation and /sv/bokning without the model having to pass a field.
LINK_LANG = (
    "={{ (() => { let raw = ''; "
    "try { if ($('Playground Turn').isExecuted) raw = String($('Playground Turn').first().json.agent_input || ''); } catch (e) {} "
    "if (!raw) { try { if ($('Build Turn').isExecuted) raw = String($('Build Turn').first().json.agent_input || ''); } catch (e) {} } "
    "const hint = (raw.match(/customer_latest_message_language:\\s*([A-Za-z]+)/) || [])[1] "
    "|| (raw.match(/Customer's language:\\s*([A-Za-z]+)/i) || [])[1] || 'Finnish'; "
    "const code = String(hint).toLowerCase(); "
    "if (code.startsWith('en')) return 'en'; "
    "if (code.startsWith('sv') || code.startsWith('swe')) return 'sv'; "
    "return 'fi'; })() }}"
)
# Live leads get the production booking site. A phone with a staging test conversation (link_host
# staging) gets the staging site, and the booking tool still falls back to production for stations
# the staging site cannot open. Playground turns are staging tests.
BOOKING_SITE = (
    "={{ (() => { "
    "try { const site = String($('Attach booking site').first().json.booking_site || '').toLowerCase(); "
    "if (site === 'staging' || site === 'live') return site; } catch (e) {} "
    "try { if ($('Playground Turn').isExecuted) return 'staging'; } catch (e) {} "
    "return 'live'; })() }}"
)

STATION_HINT = 'Station name or city ONLY when the customer asks about a different station than their own. Leave EMPTY for the customer\'s own station (the lead\'s station).'
PRODUCT_HINT = 'Vehicle product: 004 (petrol/diesel/hybrid car or van), 004e (fully electric), 0040 (camper or larger car). Leave empty to use the lead\'s product for the lead\'s own plate. Pass unknown if the customer gave another plate or vehicle and you have not yet asked what it is.'
MEASURING_HINT = 'true (default) or false. The statutory emissions measuring is included by default for petrol/diesel/hybrid cars and campers. Pass false ONLY when the customer asked to leave the measuring out of this inspection (it can be done elsewhere). Leave empty otherwise.'
CATEGORY_HINT = 'Vehicle category: M1 (car or camper) or N1 (van). Leave empty to use the lead\'s category (default M1).'

TOOLS = {
    'get_slots': {
        'description': 'Live free appointment times for one station, already limited to that station\'s opening hours, with station and online-payment prices for the vehicle. The ONLY source of appointment times and slot_id values. Pass date_from and date_to as YYYY-MM-DD (Europe/Helsinki, at most 14 days apart). Leave station empty for the customer\'s own station. Returns per-day station_hours, free_count, green_count, suggestions (time may include is_green, station_eur, online_payment_eur), all_times for a single day, price (station_eur + online_payment_eur when Vihreä hinta exists), and official_booking_link for online pay. If needs_product, ask the vehicle question it gives. If bookable_by_assistant is false, times are informational only and there are no slot_ids.',
        'ai': {
            'station': STATION_HINT, 'product': PRODUCT_HINT, 'vehicle_category': CATEGORY_HINT, 'include_measuring': MEASURING_HINT,
            'date_from': 'YYYY-MM-DD, Europe/Helsinki. Default: tomorrow.', 'date_to': 'YYYY-MM-DD, Europe/Helsinki. Same as date_from for a single day.',
        },
        'fixed': {'action': 'get_slots', 'phone': PHONE, 'language': LINK_LANG, 'booking_site': BOOKING_SITE, **LEAD_FIELDS},
    },
    'get_station_info': {
        'description': 'Live facts for ONE K1 station: opening hours for a date (default today) and the next days, address, whether the assistant can book there, prices (station_eur and online_payment_eur when green), official_booking_link, and a short preview of free times inside the opening hours. Use it first for any question about hours, prices, another station, or whether you can book somewhere. Leave station empty for the customer\'s own station; name another station or city only when the customer asks about it. Returns ambiguous candidates when a city has several stations: ask which one.',
        'ai': {
            'station': STATION_HINT, 'date': 'YYYY-MM-DD, Europe/Helsinki. Default today.',
            'product': PRODUCT_HINT, 'vehicle_category': CATEGORY_HINT, 'include_measuring': MEASURING_HINT,
        },
        'fixed': {'action': 'station_info', 'phone': PHONE, 'language': LINK_LANG, 'booking_site': BOOKING_SITE, **LEAD_FIELDS},
    },
    'send_booking_confirmation': {
        'description': 'Send a Muster reservation confirmation SMS for an existing chat booking. Call only after the customer clearly asks for an SMS confirmation. Pass event_id and station_id from the booking result or get_my_bookings.',
        'ai': {
            'event_id': 'Exact event_id from book_inspection_invite or get_my_bookings.',
            'station_id': 'station_id from the booking result (Muster station id).',
        },
        'fixed': {'action': 'send_booking_confirmation', 'phone': PHONE},
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
    'book_inspection_invite': 'Book a NEW inspection. FORBIDDEN unless the customer named a clock time. start_time MUST be the exact slot_id from get_slots (it already contains the station, the products and the vehicle category); copy the slot_id of the entry whose time is the chosen one, and also pass that chosen clock time in time. Reuse plate, name and phone. success true includes booking_number, event_id, station_id, official_booking_link and ask_sms_confirmation. If success is false, it is not booked.',
    'reschedule_booking': 'Move an existing booking. start_time is the new slot_id from get_slots (the entry whose time is the chosen one); also pass that chosen clock time in time. event_id comes from get_my_bookings (or from the booking made in this conversation). The booking number stays the same.',
    'cancel_booking': 'Cancel an existing booking. event_id is required and comes from get_my_bookings (or from the booking made in this conversation). sendConfirmation is never used. If already_cancelled is true, it was already gone.',
}

LANGUAGE_CORE = '''const LANGUAGE_WORDS = {
  English: 'the a an and or is are was be you your can could would please do does have has what which when where how much many about after before tomorrow today times time day week next book booking me my we our to of for with on at in it this that yes no hi hello thanks thank want need move cancel price cost open close hours station',
  Swedish: 'och jag det att är på för inte kan vill har vilken vilka vilket imorgon idag tid tider boka bokning vad kostar hur en ett till av som då fredag måndag tisdag onsdag torsdag lördag söndag hej tack ja nej öppet öppettider stationen avboka flytta pris',
  Finnish: 'ja on ei en mitä miten paljon paljonko kauanko montako kuinkahan millon mihinkä huomenna tänään aikoja aika ajan haluan haluaisin varata varaus kiitos voisinko voidaanko onko olen minä minulle mulle sopii se että kuinka maksaa katsastus auki milloin mihin asti kello klo moi hei joo kyllä perjantaina maanantaina peruuta siirtää hinta asema aseman jatkaa suomeksi suomea suomi paremmin olette me ollaan oman omaa kanssa sulla sulle sun mun mut mutta muuten miks miksi mitäs mistä missä kuka mikä onks oon kyl tuo tämä nyt vielä siis vai tai jos kun niin vaan ihan voin voi pitää pitäisi mä sä ole ollut sinä sinun teidän ettei jotta tai myös',
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
# Prompt caching reuses a request only up to the first change, and the system message is the first block. The date stays
# where the model has always read it, but only to the day, so the system message changes once a day instead of every
# minute; the clock moves into the [TURN] block (moving the whole date there cost replies their referents). Caching
# stops at the end of the system message, so the second copy of the brief in [BUILDER PROMPT] stays at full price;
# K1_DEDUPE_BRIEF=1 drops it when it equals the business brief, which flagged more scenarios in a small A/B (4 of 36
# against 1 of 36), so it is off by default.
HELSINKI_CLOCK = "$now.setZone('Europe/Helsinki').toFormat('HH:mm')"
CURRENT_DATE_LINE = "`current_time: ${" + HELSINKI_CLOCK + "} (Europe/Helsinki)`,"
SYSTEM_DATE = (
    'CURRENT DATE (Europe/Helsinki, authoritative for relative dates): {{ $now.setZone("Europe/Helsinki").toFormat("yyyy-MM-dd EEEE HH:mm") }}. ISO week starts Monday.',
    'CURRENT DATE (Europe/Helsinki, authoritative for relative dates): {{ $now.setZone("Europe/Helsinki").toFormat("yyyy-MM-dd EEEE") }}; the current clock time is the current_time line of each [TURN] block. ISO week starts Monday.',
)
PLAYGROUND_DATE = ("  'turn_type: user_message',", "  'turn_type: user_message',\n  " + CURRENT_DATE_LINE)
BUILD_TURN_DATE = ("  `local_time: ${new Date().toISOString()}`,", "  `local_time: ${new Date().toISOString()}`,\n  " + CURRENT_DATE_LINE)
AGENT_TEXT = (
    '={{ $json.agent_input }}',
    "={{ (() => { const input = String($json.agent_input || ''); const brief = String($('⚙️ CONFIG').first().json.business_prompt || '').trim(); "
    "const head = '[BUILDER PROMPT]\\n'; if (!brief || !input.startsWith(head) || !input.slice(head.length).startsWith(brief)) return input; "
    "return head + '(Same text as the K1 business brief in the system message; it is not repeated here.)' + input.slice(head.length + brief.length) })() }}",
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
    (("## OUTPUT CONTRACT\n", "## STYLE (overrides everything above)\n- Terse: one bubble, one short sentence, two at most.\n- Never open with an acknowledgement or an echo of the customer's word (Sure, Okay, Great, Absolutely, Of course, Selvä, Okei, Hyvä, Visst, Okej). If they answer \"sure\", \"yes\", \"joo\" or \"ok\", or they switch language, call the tool and the reply is the times. Palokka and Itäharju: get_slots. Every other station: get_station_info, then the free times and the official booking link. Never say you will check, look, or come back.\n- No em dashes, no spaced en dashes or hyphens as punctuation. Use a comma or a new sentence.\n\n## OUTPUT CONTRACT\n"), 'style'),
)


def replace_once(text, pair, label):
    old, new = pair
    if text.count(old) != 1:
        raise SystemExit(f'cannot patch {label}: expected one match, found {text.count(old)}')
    return text.replace(old, new)


# After the model reply: turn "; " into ". ". If a green price is quoted without the
# station total, append it ("At the station: 76 €."). If that reply also has no link,
# append official_booking_link from this turn's tool result. A URL the tools did not
# return is replaced with that link, or removed when the turn has none. Never add the
# link on a turn that already booked. rewrites names what changed, for the WhatsApp log.
FINISH_FN = r"""function separateFuelLink(line) {
  const fuel = /bensiini|bensa|diesel|petrol|electric|bensin|\belbil\b|hybrid|polttoaine|fuel|bränsle|käyttövoima|sähkö(?!posti)/i
  if (!fuel.test(line) || !line.includes('?')) return line
  const parts = line.split(/(?<=[.!?])\s+|\n+/)
  let changed = false
  const next = parts.map((part) => {
    if (!fuel.test(part) || !part.includes('?')) return part
    const urls = part.match(/https:\/\/\S+/g)
    if (!urls) return part
    let rest = part
    for (const url of urls) rest = rest.replace(url, ' ')
    rest = rest.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.:;])/g, '$1').trim()
    changed = true
    return [rest, ...urls].filter(Boolean).join('\n')
  })
  return changed ? next.join('\n') : line
}
function dedupeLinks(line) {
  const seen = new Set()
  const next = String(line).replace(/https:\/\/\S+/g, (url) => {
    const key = url.replace(/[),.;]+$/, '')
    if (seen.has(key)) return ''
    seen.add(key)
    return url
  })
  return next.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').trim()
}
function addToolUrls(value, allowed) {
  if (value == null) return
  if (typeof value === 'string') {
    const text = value.replace(/\\\//g, '/')
    for (const raw of text.match(/https:\/\/[^"\s\\<>]+/g) || []) allowed.add(raw.replace(/[),.;]+$/, ''))
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) addToolUrls(item, allowed)
    return
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) addToolUrls(item, allowed)
  }
}
function groundLinks(line, allowed, fallback) {
  const urls = String(line).match(/https:\/\/\S+/g) || []
  if (!urls.length) return line
  const keyOf = (url) => url.replace(/[),.;]+$/, '')
  const known = (url) => {
    const key = keyOf(url)
    for (const item of allowed) {
      if (key === item || key.startsWith(item) || item.startsWith(key)) return true
    }
    return false
  }
  if (urls.every(known)) return line
  return line.replace(/https:\/\/\S+/g, (url) => known(url) ? url : (fallback || '')).replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.:])/g, '$1').trim()
}
function dropExtraNameAsk(line, offeringTimes) {
  if (!offeringTimes || !/nimesi|nimellä|mikä nimi|kenen nimi/i.test(line)) return line
  return line
    .replace(/,?\s+ja\s+(?:kenen\s+nimellä|nimesi|mikä nimi|kenen nimi)\??/giu, '?')
    .replace(/\?\s*\?/g, '?')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
function unclaimBooking(line, booked) {
  if (booked || !/ei ole|en näe|ei vahvist|not confirmed|is not confirmed|inte bekräft/i.test(line)) return line
  return line.replace(/\b(varausnumero|booking number|bokningsnummer)\s+(?!0306\b)[A-Z0-9-]*\d+\b/gi, 'ehdottamasi numero')
}
function finishReply(messages, agent) {
  const notes = []
  const cleaned = (Array.isArray(messages) ? messages : []).map((line) => {
    const text = String(line)
    const punctuated = text.replace(/; /g, '. ')
    if (punctuated !== text) notes.push('semicolon')
    const cased = punctuated.replace(/\bhttps?:\/\//gi, (found) => found.toLowerCase())
    if (cased !== punctuated) notes.push('link_scheme')
    return cased
  })
  if (!cleaned.length) return { messages: [], rewrites: [] }
  const steps = Array.isArray(agent && agent.intermediateSteps) ? agent.intermediateSteps : []
  const dataOf = (step) => {
    let data = step && step.observation
    if (typeof data === 'string') {
      try { data = JSON.parse(data) } catch (e) { data = null }
    }
    if (Array.isArray(data)) data = data[0]
    if (data && data.json && typeof data.json === 'object') data = data.json
    return data && typeof data === 'object' ? data : null
  }
  const booked = steps.some((step) => {
    if (String(step.action?.tool || step.tool || '') !== 'book_inspection_invite') return false
    const data = dataOf(step)
    return Boolean(data && data.booking_number && (data.success || data.ok))
  })
  let link = ''
  let station = ''
  let offeredSlots = false
  const allowedUrls = new Set()
  for (const step of steps) {
    addToolUrls(step && step.observation, allowedUrls)
    const tool = String(step.action?.tool || step.tool || '')
    if (tool === 'get_slots') offeredSlots = true
    if (tool !== 'get_slots' && tool !== 'get_station_info') continue
    const data = dataOf(step)
    const direct = data && (data.official_booking_link || data.booking_url || (data.booking && data.booking.official_booking_link))
    if (typeof direct === 'string' && direct.startsWith('https://')) link = direct
    else {
      const text = String(step.observation ?? '').replace(/\\\//g, '/')
      const found = text.match(/https:\/\/(?:ajanvaraus\.k1katsastus\.fi|k1-katsastus-ajanvaraus\.stage\.geniem\.io)[^"\s\\]*/)
      if (found) link = found[0].replace(/[),.;]+$/, '')
    }
    const price = data && data.price
    const raw = price && (price.station_eur != null ? price.station_eur : price.total_eur)
    if (raw != null && Number.isFinite(Number(raw))) station = String(Math.round(Number(raw)))
  }
  let reply = cleaned.join('\n\n')
  const quotesGreen = /vihre|green price|prepaid|ennakkoon|verkossa makset|online/i.test(reply)
  if (quotesGreen && station && !new RegExp('(^|[^0-9])' + station + '([^0-9]|$)').test(reply)) {
    const sentence = /asemalla|verkossa|vihre|huomenna|ennakkoon|varaa|maks/i.test(reply)
      ? 'Asemalla: ' + station + ' €.'
      : /stationen|imorgon|grön|priset|jämfört|boka/i.test(reply)
        ? 'På stationen: ' + station + ' €.'
        : 'At the station: ' + station + ' €.'
    cleaned[cleaned.length - 1] = cleaned[cleaned.length - 1].replace(/\s*$/, '') + ' ' + sentence
    notes.push('station_price')
    reply = cleaned.join('\n\n')
  }
  if (!(booked || /https:\/\//i.test(reply) || !quotesGreen || !link)) {
    cleaned[cleaned.length - 1] = cleaned[cleaned.length - 1].replace(/\s*$/, '') + ' ' + link
    notes.push('booking_link')
    reply = cleaned.join('\n\n')
  }
  if (link) allowedUrls.add(link)
  const mapNote = (name, fn) => {
    let changed = false
    const next = cleaned.map((row) => {
      const out = fn(row)
      if (out !== row) changed = true
      return out
    })
    if (changed) notes.push(name)
    cleaned.splice(0, cleaned.length, ...next)
  }
  mapNote('fuel_link', separateFuelLink)
  mapNote('ground_link', (row) => groundLinks(row, allowedUrls, booked ? '' : link))
  mapNote('dedupe_link', dedupeLinks)
  mapNote('name_ask', (row) => dropExtraNameAsk(row, offeredSlots && !booked))
  mapNote('unclaim', (row) => unclaimBooking(row, booked))
  return { messages: cleaned.filter(Boolean), rewrites: [...new Set(notes)] }
}
"""
PLAN_FINISH_OLD = "msgs = finishReply(msgs, $input.first().json);"
PLAN_FINISH_CALL = """const finished = finishReply(msgs, $input.first().json);
msgs = finished.messages;
const replyRewrites = finished.rewrites || [];"""
PLAN_REWRITES_FIELD = (
    "delay_seconds: d, skip_send: false",
    "delay_seconds: d, skip_send: false, rewrites: replyRewrites",
)
NORMALIZE_JOIN_OLD = "reply: finished.join('\\n\\n'), fallback:"
NORMALIZE_JOIN_NEW = "reply: finished.messages.join('\\n\\n'), rewrites: finished.rewrites || [], fallback:"
NORMALIZE_INSERT = (
    "return [{ json: { reply: messages.join('\\n\\n'), fallback: !lines.some((line) => typeof line === 'string' && line.trim()) && !reactionOnly } }]",
    "const finished = finishReply(messages, agent)\nreturn [{ json: { reply: finished.messages.join('\\n\\n'), rewrites: finished.rewrites || [], fallback: !lines.some((line) => typeof line === 'string' && line.trim()) && !reactionOnly } }]",
)


def ensure_finish(code, kind):
    if kind == 'plan':
        if PLAN_FINISH_CALL not in code:
            if PLAN_FINISH_OLD in code:
                code = replace_once(code, (PLAN_FINISH_OLD, PLAN_FINISH_CALL), 'Plan Delivery finish call')
            else:
                anchor = '.filter(Boolean).slice(0, maxBubbles);'
                if code.count(anchor) != 1:
                    raise SystemExit(f'cannot patch Plan Delivery finish: anchor count {code.count(anchor)}')
                code = code.replace(anchor, anchor + '\n' + PLAN_FINISH_CALL, 1)
        if 'rewrites: replyRewrites' not in code:
            code = replace_once(code, PLAN_REWRITES_FIELD, 'Plan Delivery rewrites')
    if kind == 'normalize' and 'finished.messages.join' not in code:
        if NORMALIZE_JOIN_OLD in code:
            code = replace_once(code, (NORMALIZE_JOIN_OLD, NORMALIZE_JOIN_NEW), 'Normalize finish join')
        else:
            code = replace_once(code, NORMALIZE_INSERT, 'Normalize finish')
    return upsert_finish_fn(code)


def upsert_finish_fn(code):
    """Insert finishReply, or replace an older copy. The call sites stay where they are."""
    fresh = FINISH_FN.rstrip() + '\n'
    if fresh.strip() in code:
        return code
    names = (
        'function separateFuelLink(', 'function dedupeLinks(', 'function addToolUrls(', 'function groundLinks(',
        'function bookingLinkFor(', 'function leadBookingLink(', 'function replaceInventedLink(',
        'function dropExtraNameAsk(', 'function unclaimBooking(', 'function emailIsNotFuel(', 'function finishReply(',
    )
    positions = [code.find(name) for name in names if code.find(name) >= 0]
    if not positions:
        return fresh + code
    start = min(positions)
    reply_at = code.find('function finishReply(')
    if reply_at < 0:
        return code[:start] + fresh + code[start:]
    brace = code.find('{', reply_at)
    depth = 0
    end = None
    for index in range(brace, len(code)):
        if code[index] == '{':
            depth += 1
        elif code[index] == '}':
            depth -= 1
            if depth == 0:
                end = index + 1
                break
    if end is None:
        raise SystemExit('finishReply brace mismatch')
    if code[end:end + 1] == '\n':
        end += 1
    return code[:start] + fresh + code[end:]


def patch_agent_finish(agent):
    for node in agent['nodes']:
        if node['name'] == 'Plan Delivery':
            node['parameters']['jsCode'] = ensure_finish(node['parameters']['jsCode'], 'plan')
        elif node['name'] == 'Normalize playground reply':
            node['parameters']['jsCode'] = ensure_finish(node['parameters']['jsCode'], 'normalize')
        elif node['name'] == 'Log WhatsApp turn':
            node['parameters']['jsCode'] = WHATSAPP_LOG_JS
            node['onError'] = 'continueRegularOutput'
        elif node['name'] == '⚙️ CONFIG':
            for item in node['parameters']['assignments']['assignments']:
                if item['name'] == 'business_prompt':
                    item['value'] = business_prompt(item['value'])
    return agent


def assert_reply_node(code, label):
    if 'function groundLinks(' not in code or 'function emailIsNotFuel(' in code or 'meili' in code:
        raise SystemExit(f'{label} still has the old reply rewrite')
    if 'function replaceInventedLink(' in code or 'function bookingLinkFor(' in code:
        raise SystemExit(f'{label} still invents a station link')
    if 'rewrites:' not in code:
        raise SystemExit(f'{label} does not record rewrites')


HOLD_FOR_COMPOSING_JS = """// Ack Wasup immediately with {skip:true}.
// n8n runs Webhook siblings one after another under executionOrder v1.
// This node MUST run before CONFIG: if CONFIG (RESET send / AI / bubbles)
// runs while the inbound webhook is still open, Wasup locks the chat and
// /api/send hard-times out after 25s with no typing and no reply.
// Do not wait for Plan Delivery here — that used to delay CONFIG too.
return [{ json: { skip: true } }];
"""


def ensure_wasup_inbound(agent):
    """Wasup calls the inbound webhook with no Clerk session. The builder sign-in stays on Playground only.

    Friday's working run answered the webhook with {skip:true} before CONFIG touched Wasup.
    A later {ok:true} from the same webhook left the chat locked, so sends never left.
    """
    named = {item['name']: item for item in agent['nodes']}
    webhook = named['Webhook']['position']
    _upsert_node(agent, {
        'id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'k1-composing/Hold For Composing')),
        'name': 'Hold For Composing',
        'type': 'n8n-nodes-base.code',
        'typeVersion': 2,
        'position': [webhook[0] + 220, webhook[1] - 180],
        'onError': 'continueRegularOutput',
        'parameters': {'mode': 'runOnceForAllItems', 'jsCode': HOLD_FOR_COMPOSING_JS},
    })
    ack = named['Ack Webhook (empty)']
    ack['parameters']['responseBody'] = "={{ $json.reply ? { reply: $json.reply } : { skip: true } }}"
    agent['connections']['Webhook'] = {'main': [[
        {'node': 'Hold For Composing', 'type': 'main', 'index': 0},
        {'node': 'Webhook · Pass Request', 'type': 'main', 'index': 0},
    ]]}
    agent['connections']['Hold For Composing'] = {'main': [[{'node': 'Ack Webhook (empty)', 'type': 'main', 'index': 0}]]}
    agent['connections']['Webhook · Pass Request'] = {'main': [[{'node': '⚙️ CONFIG', 'type': 'main', 'index': 0}]]}
    return agent


WASUP_CRED = {'wasupApi': {'id': 'SW7J0tWGyyYAPdkN', 'name': 'Wasup Account'}}
PRESENCE_URL = (
    "={{ 'https://wasup.northeurope.cloudapp.azure.com/api/instances/' + "
    "(($('Webhook').first().json.body && $('Webhook').first().json.body.webhook_id) || "
    "$('⚙️ CONFIG').first().json.wasup_instance_id || 'wa_mt1j5bcl_sch23') + '/presence' }}"
)
INBOUND_DM_EXPR = (
    "={{ (() => { const b = $('Webhook').first().json.body || {}; "
    "return !b.is_group && !String(b.from_jid || '').includes('@g.us') && "
    "String(b.event || 'message').toLowerCase() === 'message'; })() }}"
)
KEEP_BUBBLE_JS = """let bubble = null
try { bubble = $('Still Our Turn?').first().json } catch (error) {}
if (!bubble || bubble.text === undefined) {
  try { bubble = $('Loop Bubbles').first().json } catch (error) {}
}
if (!bubble || bubble.text === undefined) {
  try { bubble = $('Plan Delivery').first().json } catch (error) {}
}
if (!bubble || bubble.text === undefined) bubble = $input.first().json || {}
return [{ json: { ...bubble } }]
"""
KEEP_FOLLOWUP_JS = """let bubble = null
try { bubble = $('Clear To Chase?').first().json } catch (error) {}
if (!bubble || bubble.text === undefined) {
  try { bubble = $('Plan Follow-up Delivery').first().json } catch (error) {}
}
if (!bubble || bubble.text === undefined) bubble = $input.first().json || {}
return [{ json: { ...bubble } }]
"""


def _link(name):
    return {'node': name, 'type': 'main', 'index': 0}


def _presence_body(state, hold, prefer_jid=False):
    if prefer_jid:
        target = (
            "($('Webhook').first().json.body || {}).from_jid || "
            "($('Webhook').first().json.body || {}).sender_jid || "
            "($('Webhook').first().json.body || {}).from_phone || $json.to_phone"
        )
    else:
        target = "($('Webhook').first().json.body || {}).from_phone || $json.to_phone"
    return "={{ JSON.stringify({ to: " + target + ", state: '" + state + "', hold: " + ('true' if hold else 'false') + " }) }}"


def _upsert_node(agent, node):
    named = {item['name']: item for item in agent['nodes']}
    current = named.get(node['name'])
    if current:
        keep = ('id', 'position')
        for key, value in node.items():
            if key not in keep:
                current[key] = value
        if 'credentials' not in node:
            current.pop('credentials', None)
        return current
    agent['nodes'].append(node)
    return node


def _retarget(agent, source, branch, old, new):
    links = agent['connections'][source]['main'][branch]
    nodes = [item.get('node') for item in links]
    if new in nodes:
        agent['connections'][source]['main'][branch] = [item for item in links if item.get('node') != old]
        return
    if old not in nodes:
        raise SystemExit(f'{source} output {branch} is {nodes}, expected {old}')
    for item in links:
        if item.get('node') == old:
            item['node'] = new


def ensure_composing(agent):
    """Show WhatsApp typing while a real inbound is answered, then clear it after the send.

    The 30 Oct presence calls (Hold Composing, Pulse Typing, Pause Composing) are what put the
    dots on screen. Send Bubble's own typing switch stays off; Wasup kept the chat locked when
    typing lived inside the send. Hold Composing is a side branch: Friday left it with no
    downstream. Chaining the agent behind it dropped the reply whenever the presence call
    returned nothing ("Can't use .first() here" on Restore Inbound, executions 1155691 and
    1155772). A failed presence call must not block the reply.
    """
    named = {item['name']: item for item in agent['nodes']}
    for required in ('From playground?', 'Still Our Turn?', 'Send Bubble', 'Clear To Chase?', 'Send Double-Text', 'Purge Session', 'Loop Bubbles'):
        if required not in named:
            raise SystemExit(f'composing restore cannot find {required}')

    def code(name, position, js, each=False):
        return {
            'id': str(uuid.uuid5(uuid.NAMESPACE_URL, f'k1-composing/{name}')),
            'name': name,
            'type': 'n8n-nodes-base.code',
            'typeVersion': 2,
            'position': position,
            'parameters': {'mode': 'runOnceForEachItem' if each else 'runOnceForAllItems', 'jsCode': js},
        }

    def presence(name, position, state, hold, prefer_jid=False):
        return {
            'id': str(uuid.uuid5(uuid.NAMESPACE_URL, f'k1-composing/{name}')),
            'name': name,
            'type': 'n8n-nodes-base.httpRequest',
            'typeVersion': 4.2,
            'position': position,
            'onError': 'continueRegularOutput',
            'credentials': json.loads(json.dumps(WASUP_CRED)),
            'parameters': {
                'method': 'POST',
                'url': PRESENCE_URL,
                'authentication': 'predefinedCredentialType',
                'nodeCredentialType': 'wasupApi',
                'sendBody': True,
                'contentType': 'json',
                'specifyBody': 'json',
                'jsonBody': _presence_body(state, hold, prefer_jid),
                'options': {'timeout': 3000},
            },
        }

    playground = named['From playground?']['position']
    send = named['Send Bubble']['position']
    chase = named['Clear To Chase?']['position']
    reset = named['Purge Session']['position']
    _upsert_node(agent, {
        'id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'k1-composing/Inbound DM?')),
        'name': 'Inbound DM?',
        'type': 'n8n-nodes-base.if',
        'typeVersion': 2.2,
        'position': [playground[0] + 220, playground[1] + 180],
        'parameters': {
            'conditions': {
                'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2},
                'conditions': [{
                    'id': 'inbound-dm',
                    'leftValue': INBOUND_DM_EXPR,
                    'rightValue': '',
                    'operator': {'type': 'boolean', 'operation': 'true', 'singleValue': True},
                }],
                'combinator': 'and',
            },
            'looseTypeValidation': True,
            'options': {},
        },
    })
    _upsert_node(agent, presence('Hold Composing', [playground[0] + 440, playground[1] + 80], 'composing', True, True))
    _upsert_node(agent, presence('Pulse Typing', [send[0] - 420, send[1]], 'composing', False))
    _upsert_node(agent, code('Keep Bubble', [send[0] - 200, send[1]], KEEP_BUBBLE_JS))
    _upsert_node(agent, presence('Pause Composing', [send[0] + 220, send[1]], 'paused', False))
    _upsert_node(agent, presence('Pulse Follow-up', [chase[0] + 220, chase[1] - 80], 'composing', False))
    _upsert_node(agent, code('Keep Follow-up', [chase[0] + 440, chase[1] - 80], KEEP_FOLLOWUP_JS))
    _upsert_node(agent, presence('Pause Composing Follow-up', [chase[0] + 880, chase[1]], 'paused', False))
    _upsert_node(agent, presence('Release Before Reset', [reset[0] + 220, reset[1] - 120], 'paused', False))

    # Inbound DM? runs first and ends at Hold Composing. Presence Event? is the sibling that
    # carries the message, so an empty presence response cannot stop the agent.
    agent['connections']['From playground?']['main'][1] = [_link('Inbound DM?'), _link('Presence Event?')]
    agent['connections']['Inbound DM?'] = {'main': [[_link('Hold Composing')], []]}
    agent['connections'].pop('Hold Composing', None)
    agent['connections'].pop('Restore Inbound', None)
    _retarget(agent, 'Still Our Turn?', 0, 'Send Bubble', 'Pulse Typing')
    agent['connections']['Pulse Typing'] = {'main': [[_link('Keep Bubble')]]}
    agent['connections']['Keep Bubble'] = {'main': [[_link('Send Bubble')]]}
    _retarget(agent, 'Send Bubble', 0, 'Loop Bubbles', 'Pause Composing')
    agent['connections']['Pause Composing'] = {'main': [[_link('Loop Bubbles')]]}
    _retarget(agent, 'Clear To Chase?', 0, 'Send Double-Text', 'Pulse Follow-up')
    agent['connections']['Pulse Follow-up'] = {'main': [[_link('Keep Follow-up')]]}
    agent['connections']['Keep Follow-up'] = {'main': [[_link('Send Double-Text')]]}
    _retarget(agent, 'Send Double-Text', 0, 'Mark Follow-up Sent', 'Pause Composing Follow-up')
    agent['connections']['Pause Composing Follow-up'] = {'main': [[_link('Mark Follow-up Sent')]]}
    _retarget(agent, 'Purge Session', 0, 'Send Reset Notice', 'Release Before Reset')
    agent['connections']['Release Before Reset'] = {'main': [[_link('Send Reset Notice')]]}
    return agent


LOAD_STAGING_SQL = (
    "select coalesce(( select json_build_object( 'found', true, 'phone', s.phone, 'phoneKey', s.phone_key, "
    "'versionId', s.version_id, 'versionNumber', s.version_number, 'conversationId', s.conversation_id::text, "
    "'leadContext', s.lead_context, 'opener', s.opener, 'plate', coalesce(s.lead->>'plateNumber', ''), "
    "'stationName', coalesce(s.lead->>'stationName', ''), 'product', coalesce(s.lead->>'product', '')) "
    "from k1_staging_sessions s where s.phone_key = '{{ String($('Webhook').first().json.body.from_phone || '').replace(/\\D/g, '') }}'), "
    "'{\"found\":false}'::json) as staging"
)
PARSE_STAGING_JS = """const row = $input.first().json || {}
let staging = row.staging
if (typeof staging === 'string') {
  try { staging = JSON.parse(staging) } catch (error) { staging = null }
}
if (!staging || staging.found !== true) staging = { found: false }
return [{ json: { staging } }]
"""
REPLY_RULE_LINE = (
    "const replyRule = '[THIS REPLY] If this reply needs times, hours, a price or a link, call the tool before the JSON. "
    "Palokka and Itäharju: get_slots. Every other station: get_station_info, then the free times and official_booking_link. "
    "Never tell the customer you will check, look, or come back. A language switch is not a pause: answer in their language with the times in this same reply.'\n"
)
LEAD_PREAMBLE = """let leadBlock = ''
let openerBlock = ''
""" + REPLY_RULE_LINE + """try {
  if ($('Parse Staging').isExecuted) {
    const staging = $('Parse Staging').first().json.staging || {}
    if (staging.found === true) {
      leadBlock = String(staging.leadContext || '').trim()
      if (!leadBlock) {
        const bits = [
          staging.plate ? 'Registration: ' + staging.plate : '',
          staging.stationName ? 'Station the customer last visited: ' + staging.stationName : '',
          staging.product ? 'Product on the reminder: ' + staging.product : '',
        ].filter(Boolean)
        if (bits.length) leadBlock = "LEAD CONTEXT (from K1's lead data for this customer)\\n- " + bits.join('\\n- ')
      }
      const opener = String(staging.opener || '').trim()
      if (opener) openerBlock = '[OPENER ALREADY SENT]\\n' + opener + '\\nThe customer is replying to this message. Do not send the opener again.'
    }
  }
} catch (error) {}
"""


def _inject_lead(code):
    if 'let leadBlock' not in code or 'openerBlock || null' not in code:
        needle = 'const agent_input = ['
        if needle not in code:
            raise SystemExit('turn builder has no agent_input')
        code = code.replace(needle, LEAD_PREAMBLE + needle, 1)
        old = "  'turn_type: user_message',\n"
        new = "  'turn_type: user_message',\n  leadBlock || null,\n  openerBlock || null,\n  replyRule,\n"
        if old not in code:
            old = "  'turn_type: your_own_followup',\n"
            new = "  'turn_type: your_own_followup',\n  leadBlock || null,\n  openerBlock || null,\n  replyRule,\n"
        if old not in code:
            raise SystemExit('turn builder has no turn_type line')
        return code.replace(old, new, 1)
    if 'const replyRule' not in code:
        code = code.replace("let openerBlock = ''\n", "let openerBlock = ''\n" + REPLY_RULE_LINE, 1)
        code = code.replace("  openerBlock || null,\n", "  openerBlock || null,\n  replyRule,\n")
    return code


def ensure_lead(agent):
    """A WhatsApp reply does not carry the car. The staging session for that phone does."""
    named = {item['name']: item for item in agent['nodes']}
    for required in ('Queue Inbound', 'New Message?', 'Debounce', 'Build Turn'):
        if required not in named:
            raise SystemExit(f'lead restore cannot find {required}')
    queue = named['Queue Inbound']
    origin = named['New Message?']['position']
    _upsert_node(agent, {
        'id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'k1-lead/Load Staging Session')),
        'name': 'Load Staging Session',
        'type': 'n8n-nodes-base.postgres',
        'typeVersion': 2.6,
        'position': [origin[0] + 220, origin[1]],
        'onError': 'continueRegularOutput',
        'credentials': json.loads(json.dumps(queue['credentials'])),
        'parameters': {'resource': 'database', 'operation': 'executeQuery', 'query': LOAD_STAGING_SQL, 'options': {}},
    })
    _upsert_node(agent, {
        'id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'k1-lead/Parse Staging')),
        'name': 'Parse Staging',
        'type': 'n8n-nodes-base.code',
        'typeVersion': 2,
        'position': [origin[0] + 440, origin[1]],
        'parameters': {'mode': 'runOnceForAllItems', 'jsCode': PARSE_STAGING_JS},
    })
    _retarget(agent, 'New Message?', 0, 'Debounce', 'Load Staging Session')
    agent['connections']['Load Staging Session'] = {'main': [[_link('Parse Staging')]]}
    agent['connections']['Parse Staging'] = {'main': [[_link('Debounce')]]}
    named['Build Turn']['parameters']['jsCode'] = _inject_lead(named['Build Turn']['parameters']['jsCode'])
    if 'Build Follow-up Turn' in named:
        named['Build Follow-up Turn']['parameters']['jsCode'] = _inject_lead(named['Build Follow-up Turn']['parameters']['jsCode'])
    return agent


def assert_lead(agent):
    first = [item.get('node') for item in agent['connections']['New Message?']['main'][0]]
    if first != ['Load Staging Session']:
        raise SystemExit(f'a new message skips the lead lookup: {first}')
    if [item.get('node') for item in agent['connections']['Parse Staging']['main'][0]] != ['Debounce']:
        raise SystemExit('staging parse does not continue into the debounce')
    code = next(node['parameters']['jsCode'] for node in agent['nodes'] if node['name'] == 'Build Turn')
    if 'let leadBlock' not in code or 'leadBlock || null' not in code:
        raise SystemExit('Build Turn does not pass the lead to the model')
    query = next(node['parameters']['query'] for node in agent['nodes'] if node['name'] == 'Load Staging Session')
    if 'k1_staging_sessions' not in query or 'lead_context' not in query:
        raise SystemExit('lead lookup query is wrong')


def assert_composing(agent):
    play = [item.get('node') for item in agent['connections']['From playground?']['main'][1]]
    if play != ['Inbound DM?', 'Presence Event?']:
        raise SystemExit(f'inbound no longer reaches the agent beside composing: {play}')
    inbound = [[item.get('node') for item in branch] for branch in agent['connections']['Inbound DM?']['main']]
    if inbound != [['Hold Composing'], []]:
        raise SystemExit(f'Inbound DM? wiring changed: {inbound}')
    if agent['connections'].get('Hold Composing') or agent['connections'].get('Restore Inbound'):
        raise SystemExit('a presence call is back on the reply path')
    send = [item.get('node') for item in agent['connections']['Still Our Turn?']['main'][0]]
    if send != ['Pulse Typing']:
        raise SystemExit(f'send path skipped the typing pulse: {send}')
    if [item.get('node') for item in agent['connections']['Pause Composing']['main'][0]] != ['Loop Bubbles']:
        raise SystemExit('pause composing does not return to the bubble loop')
    webhook = [item.get('node') for branch in agent['connections']['Webhook']['main'] for item in branch]
    if webhook != ['Hold For Composing', 'Webhook · Pass Request']:
        raise SystemExit(f'Wasup inbound is not acked before the agent: {webhook}')
    if [item.get('node') for item in agent['connections']['Hold For Composing']['main'][0]] != ['Ack Webhook (empty)']:
        raise SystemExit('Hold For Composing does not answer the webhook')
    passed = [item.get('node') for item in agent['connections']['Webhook · Pass Request']['main'][0]]
    if passed != ['⚙️ CONFIG']:
        raise SystemExit(f'pass request still shares the webhook response: {passed}')
    names = {item['name']: item for item in agent['nodes']}
    for name in ('Hold For Composing', 'Hold Composing', 'Pulse Typing', 'Pause Composing', 'Pause Composing Follow-up', 'Release Before Reset'):
        if name not in names:
            raise SystemExit(f'{name} missing')
    ack = names['Ack Webhook (empty)']['parameters'].get('responseBody') or ''
    if 'skip: true' not in ack:
        raise SystemExit('Wasup ack is not skip:true')


CTA_JS = r"""const LABELS = {
  fi: { pay: 'Maksa nyt', book: 'Varaa aika', open: 'Avaa' },
  sv: { pay: 'Betala nu', book: 'Boka tid', open: 'Öppna' },
  en: { pay: 'Pay now', book: 'Book a time', open: 'Open' },
}
function language(text) {
  const t = ' ' + String(text || '').toLowerCase() + ' '
  if (/\b(och|att|för|boka|öppna|betala|på stationen|bokning|tiderna)\b/.test(t)) return 'sv'
  if (/[äöå]/.test(t)) return 'fi'
  if (/\b(the|your|you|book|pay|open|at the|station|time|here|link|can|for)\b/.test(t)) return 'en'
  return 'fi'
}
function hostOf(url) {
  const match = String(url).match(/^https?:\/\/([^/?#]+)/i)
  return match ? match[1].toLowerCase() : ''
}
function firstMark() {
  try {
    const staging = $('Parse Staging').isExecuted ? ($('Parse Staging').first().json.staging || {}) : null
    if (staging && String(staging.opener || '').trim()) return ''
    if ($('Pause Composing').isExecuted || $('Pause Composing Follow-up').isExecuted) return ''
    return 'K1 AI Agent'
  } catch (error) {
    return ''
  }
}
function decorate(item) {
  const text = String(item.text || '')
  const urls = text.match(/https?:\/\/[^\s<>)]+/gi) || []
  if (urls.length !== 1) return { ...item, cta_url: '', cta_label: '', cta_body: text, cta_footer: '' }
  const raw = urls[0]
  const only = raw.replace(/[.,;:!?)]+$/g, '')
  const host = hostOf(only)
  const payment = host === 'buy.stripe.com' || host === 'checkout.stripe.com'
  const booking = host === 'ajanvaraus.k1katsastus.fi' || host === 'www.ajanvaraus.k1katsastus.fi' || host === 'k1-katsastus-ajanvaraus.stage.geniem.io' || /[?&]stationId=/i.test(only)
  const kind = payment ? 'pay' : booking ? 'book' : 'open'
  const lang = language(text)
  let body = text.replace(raw, ' ').replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim()
  if (!body) {
    body = kind === 'pay'
      ? (lang === 'en' ? 'Pay here.' : lang === 'sv' ? 'Betala här.' : 'Maksa tästä.')
      : (lang === 'en' ? 'Here.' : lang === 'sv' ? 'Här.' : 'Tässä.')
  }
  return {
    ...item,
    cta_url: only,
    cta_label: LABELS[lang][kind].slice(0, 20),
    cta_body: body,
    cta_footer: firstMark(),
  }
}
return $input.all().map((row) => ({ json: decorate(row.json) }))
"""
CTA_RAW = (
    "={{ JSON.stringify({ to: $json.to_phone, text: $json.cta_body, "
    "ctaUrl: { url: $json.cta_url, label: $json.cta_label }, "
    "footer: $json.cta_footer || undefined, "
    "linkPreview: false, allowColdWithoutToken: true, typingSimulation: false, delayEnabled: false }) }}"
)
OPENER_RAW = (
    "={{ JSON.stringify({ to: $('Normalize').first().json.to, text: $('Normalize').first().json.opener, "
    "footer: 'K1 Agent', "
    "linkPreview: false, allowColdWithoutToken: true, typingSimulation: false, delayEnabled: false }) }}"
)


def _wire_link_button(agent, keep_name, send_name, pause_name):
    named = {item['name']: item for item in agent['nodes']}
    send = named[send_name]
    x, y = send['position']
    fields, gate_name, button = f'{send_name} CTA fields', f'{send_name} CTA?', f'{send_name} CTA'
    _upsert_node(agent, {
        'id': str(uuid.uuid5(uuid.NAMESPACE_URL, f'k1-cta/{fields}')),
        'name': fields,
        'type': 'n8n-nodes-base.code',
        'typeVersion': 2,
        'position': [x - 420, y],
        'parameters': {'mode': 'runOnceForAllItems', 'jsCode': CTA_JS},
    })
    _upsert_node(agent, {
        'id': str(uuid.uuid5(uuid.NAMESPACE_URL, f'k1-cta/{gate_name}')),
        'name': gate_name,
        'type': 'n8n-nodes-base.if',
        'typeVersion': 2.2,
        'position': [x - 200, y],
        'parameters': {
            'conditions': {
                'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2},
                'conditions': [{
                    'id': 'cta-url',
                    'leftValue': '={{ $json.cta_url }}',
                    'rightValue': '',
                    'operator': {'type': 'string', 'operation': 'notEquals'},
                }],
                'combinator': 'and',
            },
            'looseTypeValidation': True,
            'options': {},
        },
    })
    _upsert_node(agent, {
        'id': str(uuid.uuid5(uuid.NAMESPACE_URL, f'k1-cta/{button}')),
        'name': button,
        'type': send['type'],
        'typeVersion': send.get('typeVersion', 1),
        'position': [x, y - 160],
        'credentials': json.loads(json.dumps(send.get('credentials') or WASUP_CRED)),
        'parameters': {
            'resource': 'message',
            'operation': 'sendRaw',
            'instanceId': json.loads(json.dumps(send['parameters']['instanceId'])),
            'rawBody': CTA_RAW,
        },
    })
    agent['connections'][keep_name] = {'main': [[_link(fields)]]}
    agent['connections'][fields] = {'main': [[_link(gate_name)]]}
    agent['connections'][gate_name] = {'main': [[_link(button)], [_link(send_name)]]}
    agent['connections'][button] = {'main': [[_link(pause_name)]]}
    agent['connections'][send_name] = {'main': [[_link(pause_name)]]}


def ensure_cta(agent):
    """One https link in a bubble becomes the native WhatsApp button. Two links stay as text.

    Friday's button required staging === true and a k1katsastus.fi host, so a staging-host
    link and any other link never became a button, and the current turn does not set that flag.
    A booking host (including the staging booking site) is labelled as a booking. Stripe is a
    payment. Every other single link still gets a button.
    """
    names = {item['name'] for item in agent['nodes']}
    for required in ('Keep Bubble', 'Send Bubble', 'Pause Composing', 'Keep Follow-up', 'Send Double-Text', 'Pause Composing Follow-up'):
        if required not in names:
            raise SystemExit(f'link button cannot find {required}')
    _wire_link_button(agent, 'Keep Bubble', 'Send Bubble', 'Pause Composing')
    _wire_link_button(agent, 'Keep Follow-up', 'Send Double-Text', 'Pause Composing Follow-up')
    return agent


def assert_cta(agent):
    names = {item['name']: item for item in agent['nodes']}
    for keep, send, pause in (
        ('Keep Bubble', 'Send Bubble', 'Pause Composing'),
        ('Keep Follow-up', 'Send Double-Text', 'Pause Composing Follow-up'),
    ):
        fields, gate_name, button = f'{send} CTA fields', f'{send} CTA?', f'{send} CTA'
        if [item.get('node') for item in agent['connections'][keep]['main'][0]] != [fields]:
            raise SystemExit(f'{keep} does not prepare the link button')
        branches = [[item.get('node') for item in branch] for branch in agent['connections'][gate_name]['main']]
        if branches != [[button], [send]]:
            raise SystemExit(f'{gate_name} wiring changed: {branches}')
        if [item.get('node') for item in agent['connections'][button]['main'][0]] != [pause]:
            raise SystemExit(f'{button} does not clear typing')
        if [item.get('node') for item in agent['connections'][send]['main'][0]] != [pause]:
            raise SystemExit(f'{send} does not clear typing')
        code = names[fields]['parameters']['jsCode']
        if 'staging !== true' in code or 'item.staging' in code:
            raise SystemExit(f'{fields} still skips links outside the old staging gate')
        if 'k1-katsastus-ajanvaraus.stage.geniem.io' not in code or 'checkout.stripe.com' not in code:
            raise SystemExit(f'{fields} does not cover booking and payment links')
        params = names[button]['parameters']
        if params.get('operation') != 'sendRaw' or 'ctaUrl' not in (params.get('rawBody') or ''):
            raise SystemExit(f'{button} is not the native link button')
        if names[button]['credentials']['wasupApi']['id'] != WASUP_CRED['wasupApi']['id']:
            raise SystemExit(f'{button} credential changed')


def stamp_opener_footer():
    """The first bubble is the staging opener. The footer field is 'K1 Agent', with no button.

    WhatsApp does not draw that grey line unless the bubble also has a button.
    Do not add a link, a quick reply, or an OK button to make the footer render.
    A later typing, cta, or reply deploy must not put `ctaUrl`, `messageType: 'buttons'`,
    or an OK button back.
    """
    body = snapshot(STAGING_SEND)
    was_active = bool(body['active'])
    node = next(item for item in body['nodes'] if item['name'] == 'Send opener')
    raw = node['parameters'].get('rawBody') or ''
    if "$('Normalize').first().json.opener" not in raw:
        raise SystemExit('opener send no longer uses the stored opener')
    node['parameters']['resource'] = 'message'
    node['parameters']['operation'] = 'sendRaw'
    node['parameters']['rawBody'] = OPENER_RAW
    put_live(STAGING_SEND, body, was_active)
    check = gate.request('GET', f'/workflows/{STAGING_SEND}')
    saved = next(item['parameters'].get('rawBody') or '' for item in check['nodes'] if item['name'] == 'Send opener')
    if "footer: 'K1 Agent'" not in saved or "$('Normalize').first().json.opener" not in saved:
        raise SystemExit('opener footer was not saved')
    if 'ctaUrl' in saved or 'buttons' in saved:
        raise SystemExit('opener button came back')
    if not check.get('active'):
        raise SystemExit('staging send left inactive')
    print(f'opener footer on {STAGING_SEND} active={check["active"]}')


def ensure_reply_discipline(agent):
    """A promise to check is not a reply. The channel rules used to allow that bubble."""
    node = next(item for item in agent['nodes'] if item['name'] == 'AI Agent')
    text = node['parameters']['options']['systemMessage']
    eyes = "a short bubble says you'll look"
    if eyes in text:
        text = '\n'.join(
            "- 👀 — never. Do not tell the customer you will look or check. Call the tool and send the result." if eyes in line else line
            for line in text.split('\n')
        )
    elif 'Do not tell the customer you will look or check' not in text:
        raise SystemExit('reply discipline lost the eyes rule')
    old_style = 'the reply is the times themselves from get_slots.'
    new_style = (
        'call the tool and the reply is the times. Palokka and Itäharju: get_slots. '
        'Every other station: get_station_info, then the free times and the official booking link. '
        'Never say you will check, look, or come back.'
    )
    if old_style in text:
        text = text.replace(old_style, new_style, 1)
    elif 'Never say you will check, look, or come back.' not in text:
        raise SystemExit('reply discipline lost the style rule')
    node['parameters']['options']['systemMessage'] = text
    return agent


def lock_live_path(agent):
    """Put back the WhatsApp path that Friday proved and no backup ever stored.

    A rebuild starts from the 29 Sept workflow. Without this, the next promote drops the
    inbound bypass, the composing calls, the staging car, and the link buttons in one put.
    """
    ensure_wasup_inbound(agent)
    ensure_composing(agent)
    ensure_lead(agent)
    ensure_cta(agent)
    ensure_reply_discipline(agent)
    assert_composing(agent)
    assert_lead(agent)
    assert_cta(agent)
    return agent


def finish_live():
    apply_log_schema()
    agent = snapshot(LIVE_AGENT)
    was_active = bool(agent['active'])
    patch_agent_finish(agent)
    lock_live_path(agent)
    put_live(LIVE_AGENT, agent, was_active)
    check = gate.request('GET', f'/workflows/{LIVE_AGENT}')
    plan = next(node['parameters']['jsCode'] for node in check['nodes'] if node['name'] == 'Plan Delivery')
    norm = next(node['parameters']['jsCode'] for node in check['nodes'] if node['name'] == 'Normalize playground reply')
    log = next(node['parameters']['jsCode'] for node in check['nodes'] if node['name'] == 'Log WhatsApp turn')
    brief = next(item['value'] for node in check['nodes'] if node['name'] == '⚙️ CONFIG' for item in node['parameters']['assignments']['assignments'] if item['name'] == 'business_prompt')
    assert_reply_node(plan, 'Plan Delivery')
    assert_reply_node(norm, 'Normalize playground reply')
    if PLAN_FINISH_CALL not in plan or 'rewrites: replyRewrites' not in plan:
        raise SystemExit('Plan Delivery finish call missing after put')
    if 'finished.messages.join' not in norm:
        raise SystemExit('Normalize finish call missing after put')
    if 'rewrites' not in log or "role, text, is_opener, rewrites" not in log:
        raise SystemExit('WhatsApp log does not store rewrites')
    if "Oulu Alppila bookings go through K1's booking page" not in brief:
        raise SystemExit('business brief line missing after put')
    inbound = (check['connections'].get('Webhook') or {}).get('main') or []
    inbound_to = [link.get('node') for branch in inbound for link in (branch or [])]
    if inbound_to != ['Hold For Composing', 'Webhook · Pass Request']:
        raise SystemExit(f'Wasup inbound is not acked before the agent: {inbound_to}')
    assert_composing(check)
    assert_lead(check)
    assert_cta(check)
    if not check.get('active'):
        raise SystemExit('live agent left inactive')
    stamp_opener_footer()
    print(f'finish live agent {LIVE_AGENT} active={check["active"]} brief={len(brief)}')


def restore_lead():
    """Attach the staging car and station to live WhatsApp turns. Keeps the current prompt."""
    agent = snapshot(LIVE_AGENT)
    was_active = bool(agent['active'])
    lock_live_path(agent)
    put_live(LIVE_AGENT, agent, was_active)
    check = gate.request('GET', f'/workflows/{LIVE_AGENT}')
    assert_composing(check)
    assert_lead(check)
    assert_cta(check)
    if not check.get('active'):
        raise SystemExit('live agent left inactive')
    print(f'lead restored on {LIVE_AGENT} active={check["active"]}')


def restore_typing():
    """Put the composing calls back on the live agent without rewriting the prompt."""
    agent = snapshot(LIVE_AGENT)
    was_active = bool(agent['active'])
    lock_live_path(agent)
    put_live(LIVE_AGENT, agent, was_active)
    check = gate.request('GET', f'/workflows/{LIVE_AGENT}')
    assert_composing(check)
    assert_lead(check)
    assert_cta(check)
    if not check.get('active'):
        raise SystemExit('live agent left inactive')
    hold = next(node for node in check['nodes'] if node['name'] == 'Hold Composing')
    if hold['parameters'].get('jsonBody', '').find("state: 'composing'") < 0 or hold['credentials']['wasupApi']['id'] != WASUP_CRED['wasupApi']['id']:
        raise SystemExit('Hold Composing was not saved')
    print(f'typing restored on {LIVE_AGENT} active={check["active"]}')


def apply_reply_rule():
    """Put the no-promise rule on the live brief and stop a 'I'll check' bubble standing in for the times."""
    agent = snapshot(LIVE_AGENT)
    was_active = bool(agent['active'])
    for item in next(node['parameters']['assignments']['assignments'] for node in agent['nodes'] if node['name'] == '⚙️ CONFIG'):
        if item['name'] == 'business_prompt':
            item['value'] = business_prompt('')
    lock_live_path(agent)
    put_live(LIVE_AGENT, agent, was_active)
    check = gate.request('GET', f'/workflows/{LIVE_AGENT}')
    brief = next(item['value'] for node in check['nodes'] if node['name'] == '⚙️ CONFIG' for item in node['parameters']['assignments']['assignments'] if item['name'] == 'business_prompt')
    system = next(node['parameters']['options']['systemMessage'] for node in check['nodes'] if node['name'] == 'AI Agent')
    turn = next(node['parameters']['jsCode'] for node in check['nodes'] if node['name'] == 'Build Turn')
    if 'Never say you will check, look, or come back' not in brief:
        raise SystemExit('live brief is not the latest prompt')
    if "a short bubble says you'll look" in system or 'Never say you will check, look, or come back.' not in system:
        raise SystemExit('live channel rules still allow a promise to check')
    if 'const replyRule' not in turn or 'replyRule,' not in turn:
        raise SystemExit('the turn does not carry the reply rule')
    assert_composing(check)
    assert_lead(check)
    assert_cta(check)
    if not check.get('active'):
        raise SystemExit('live agent left inactive')
    stamp_opener_footer()
    print(f'reply rule on {LIVE_AGENT} active={check["active"]} brief={len(brief)}')


def restore_cta():
    """Turn a single link into a WhatsApp button, and mark the first bubble. Keeps the current prompt."""
    agent = snapshot(LIVE_AGENT)
    was_active = bool(agent['active'])
    lock_live_path(agent)
    put_live(LIVE_AGENT, agent, was_active)
    check = gate.request('GET', f'/workflows/{LIVE_AGENT}')
    assert_composing(check)
    assert_lead(check)
    assert_cta(check)
    if not check.get('active'):
        raise SystemExit('live agent left inactive')
    stamp_opener_footer()
    print(f'link buttons restored on {LIVE_AGENT} active={check["active"]}')


def cache_layout(named):
    agent = named['AI Agent']['parameters']
    agent['options']['systemMessage'] = replace_once(agent['options']['systemMessage'], SYSTEM_DATE, 'system message date')
    if os.environ.get('K1_DEDUPE_BRIEF') == '1':
        agent['text'] = replace_once(agent['text'], AGENT_TEXT, 'agent text')
    for name, pair in (('Playground Turn', PLAYGROUND_DATE), ('Build Turn', BUILD_TURN_DATE), ('Build Follow-up Turn', BUILD_TURN_DATE)):
        named[name]['parameters']['jsCode'] = replace_once(named[name]['parameters']['jsCode'], pair, f'{name} date')


def business_prompt(current):
    # Live WhatsApp uses the hand-written WhatsApp prompt (v5.x), not the guidelines YAML catalog.
    path = ROOT / 'prompts/k1-whatsapp-prompt-final.md'
    if path.exists():
        text = path.read_text()
        return text if text.endswith('\n') else text + '\n'
    return k1_prompt.prompt()


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
            node['parameters']['description'] = 'Flag the conversation for staff. Only when the customer asks for a person, makes a complaint, or reports a legal, safety or accident matter. Never for a booking question (why don\'t you book it, can you book this, book it for me), payment, hours, prices, links, swearing, or anything you can answer. Pass syy.'
        if node['name'] == 'AI Agent':
            options = node['parameters']['options']
            options['systemMessage'] = replace_once(
                options['systemMessage'],
                ("Never invent prices, availability, dates or policy that aren't in the brief below.", "Never invent prices, availability, opening hours, dates or policy that are not in the brief below or in a tool result."),
                'system message')
            for pair, label in SYSTEM_STYLE_PATCHES:
                options['systemMessage'] = replace_once(options['systemMessage'], pair, f'system message {label}')
        if node['name'] == 'Plan Delivery':
            node['parameters']['jsCode'] = ensure_finish(replace_once(node['parameters']['jsCode'], PLAN_DELIVERY_CLEAN, 'Plan Delivery dashes'), 'plan')
        if node['name'] == 'Plan Follow-up Delivery':
            node['parameters']['jsCode'] = replace_once(node['parameters']['jsCode'], PLAN_FOLLOWUP_CLEAN, 'Plan Follow-up Delivery dashes')
        if node['name'] == 'Normalize playground reply':
            code = node['parameters']['jsCode']
            for label, pair in enumerate(NORMALIZE_PATCHES):
                code = replace_once(code, pair, f'Normalize playground reply {label}')
            node['parameters']['jsCode'] = ensure_finish(code, 'normalize')
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
            code = replace_once(code, ("new Set(['faq_lookup', 'get_station_info', 'get_my_bookings', 'get_slots',",
                                        "new Set(['create_payment_link', 'faq_lookup', 'get_station_info', 'get_my_bookings', 'get_slots', 'send_booking_confirmation',"), 'payment tool')
            # Idempotent if payment tool already present from an earlier build.
            if 'send_booking_confirmation' not in code:
                code = code.replace(
                    "new Set(['create_payment_link', 'faq_lookup', 'get_station_info', 'get_my_bookings', 'get_slots',",
                    "new Set(['create_payment_link', 'faq_lookup', 'get_station_info', 'get_my_bookings', 'get_slots', 'send_booking_confirmation',",
                    1,
                )
            code = replace_once(code, ("new Set(['query', 'station', 'product', 'vehicle_category', 'include_measuring', 'date', 'station_id',",
                                        "new Set(['booking_number', 'station_name', 'when_text', 'query', 'station', 'product', 'vehicle_category', 'include_measuring', 'date', 'station_id', 'event_id',"), 'payment inputs')
            if "'event_id'" not in code.split('allowInputs')[1][:400] if 'allowInputs' in code else True:
                pass
            node['parameters']['jsCode'] = code

    if os.environ.get('K1_CACHE_LAYOUT', '1') != '0':
        cache_layout(named)

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
            value['language'] = LINK_LANG
            value['booking_site'] = BOOKING_SITE
        for key in ('lead_station', 'lead_station_id', 'lead_product', 'lead_vehicle_category'):
            value.pop(key, None)
        node['parameters']['workflowInputs']['schema'] = [entry for entry in node['parameters']['workflowInputs'].get('schema', []) if entry['id'] in value]
        for key in value:
            if not any(entry['id'] == key for entry in node['parameters']['workflowInputs']['schema']):
                node['parameters']['workflowInputs']['schema'].append(SCHEMA_ENTRY(key))

    add_payment_tool(nodes, connections, named, define)
    add_agent_error_branch(nodes, connections)
    add_booking_site_lookup(nodes, connections)
    ensure_booking_site(nodes)
    add_whatsapp_log(nodes, connections)
    locked = lock_live_path({'nodes': nodes, 'connections': connections})
    return save(AGENT_NAME, locked['nodes'], locked['connections'], live, activate=True)


def add_payment_tool(nodes, connections, named, define):
    """Points create_payment_link at the Stripe workflow. A later promote must not retarget this tool at the booking workflow."""
    payment_id = by_name(PAYMENT_NAME)
    if not payment_id:
        raise SystemExit(f'{PAYMENT_NAME} is missing; create it before building the agent')
    name = 'create_payment_link'
    if name in named:
        node = named[name]
    else:
        template = named['get_slots']
        node = json.loads(json.dumps(template))
        node.update({'id': str(uuid.uuid4()), 'name': name, 'position': [template['position'][0], template['position'][1] + 440]})
        nodes.append(node)
        named[name] = node
        connections[name] = {'ai_tool': [[{'node': 'AI Agent', 'type': 'ai_tool', 'index': 0}]]}
    node['parameters']['name'] = name
    node['parameters']['description'] = (
        'The 34 euro Stripe checkout url for a booking already made in this chat. Call it only after the customer chooses to pay now. '
        'Pass the booking number, station name and the confirmed weekday, date and time. Returns url. '
        'Tell the customer it is 34 euros for the inspection base and that they can enter WASUP100 on that page. Measuring is still paid at the station.'
    )
    node['parameters']['workflowId'] = {'__rl': True, 'value': payment_id, 'mode': 'id', 'cachedResultName': PAYMENT_NAME}
    define(node, {
        'booking_number': 'The booking number returned by book_inspection_invite for the appointment just made.',
        'station_name': 'The station name from that booking result.',
        'when_text': 'Weekday, date and time of that booking, as confirmed to the customer.',
        'language': 'fi, sv or en, the language of this chat.',
    }, {'phone': PHONE})
    value = node['parameters']['workflowInputs']['value']
    keep = {'phone', 'booking_number', 'station_name', 'when_text', 'language'}
    for key in list(value):
        if key not in keep:
            value.pop(key, None)
    node['parameters']['workflowInputs']['schema'] = [SCHEMA_ENTRY(key) for key in value]


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
const reply = { fi: 'Pahoittelut, meillä meni jokin vikaan. Lähetä viesti uudelleen hetken päästä, tai soita 0306 100 100.',
  sv: 'Förlåt, något gick fel hos oss. Skicka meddelandet igen om en stund, eller ring 0306 100 100.',
  en: 'Sorry, something went wrong on our side. Send that again in a minute, or call 0306 100 100.' }[lang]
return [{ json: { reply, mode: 'muster', recorded: false, messageId: null, userMessageId: null, toolCalls: [], fallback: true } }]"""

# Without this a failed model call on WhatsApp sent the customer nothing, and the run still counted as a success.
AGENT_ERROR_WHATSAPP_JS = r"""let playground = false
try { playground = Boolean($('Playground Turn').isExecuted) } catch (error) { playground = false }
if (playground) return []
const turn = $('Build Turn').first().json || {}
const text = String(turn.raw_text || '')
const lang = /\b(hej|tack|boka|besiktning|vad|hur|vilken|jag|inte|och|det)\b|nästa|imorgon/i.test(text) ? 'sv'
  : /\b(the|what|when|where|how|can|please|you|my|is|are|do|does)\b/i.test(text) ? 'en' : 'fi'
const message = { fi: 'Pahoittelut, meillä meni jokin vikaan. Lähetä viesti uudelleen hetken päästä, tai soita 0306 100 100.',
  sv: 'Förlåt, något gick fel hos oss. Skicka meddelandet igen om en stund, eller ring 0306 100 100.',
  en: 'Sorry, something went wrong on our side. Send that again in a minute, or call 0306 100 100.' }[lang]
return [{ json: { output: { messages: [message], reaction: '', end_conversation: false, handoff: false }, agent_error: true } }]"""


def add_agent_error_branch(nodes, connections):
    agent = next(n for n in nodes if n['name'] == 'AI Agent')
    agent['onError'] = 'continueErrorOutput'
    agent.update({'retryOnFail': True, 'maxTries': 2, 'waitBetweenTries': 1500})
    for name, code, dy in (('Agent error reply', AGENT_ERROR_JS, 520), ('Agent error WhatsApp', AGENT_ERROR_WHATSAPP_JS, 680)):
        node = next((n for n in nodes if n['name'] == name), None)
        if node is None:
            nodes.append({'id': str(uuid.uuid4()), 'name': name, 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [agent['position'][0] + 400, agent['position'][1] + dy],
                          'parameters': {'mode': 'runOnceForAllItems', 'jsCode': code}})
        else:
            node['parameters']['jsCode'] = code
    main = connections['AI Agent']['main']
    assert len(main) >= 1
    connections['AI Agent']['main'] = [main[0], [{'node': 'Agent error reply', 'type': 'main', 'index': 0}, {'node': 'Agent error WhatsApp', 'type': 'main', 'index': 0}]]
    connections['Agent error reply'] = {'main': [[{'node': 'Respond to playground', 'type': 'main', 'index': 0}]]}
    connections['Agent error WhatsApp'] = {'main': [[{'node': 'Plan Delivery', 'type': 'main', 'index': 0}]]}


ATTACH_BOOKING_SITE_JS = r"""const turn = $('Build Turn').first().json || {}
let booking_site = 'live'
try {
  const site = String($input.first().json.booking_site || '').toLowerCase()
  if (site === 'staging' || site === 'live') booking_site = site
} catch (error) {}
return [{ json: { ...turn, booking_site } }]"""

BOOKING_SITE_QUERY = (
    "={{ (() => { const digits = String(($('Build Turn').first().json.from_phone) || '').replace(/\\D/g, '').slice(0, 15); "
    "return \"select coalesce((select link_host from k1_staging_conversations where phone_key = '\" + digits + \"' order by updated_at desc limit 1), 'live') as booking_site\"; })() }}"
)

# After the WhatsApp reply has already been sent. Same conversation for a phone, and the inbound
# message id is unique, so a retry does not write the turn twice. Errors are caught by the caller.
WHATSAPP_LOG_JS = r"""const sqlLiteral = (value) => "'" + String(value ?? '').replace(/'/g, "''").replace(/\u0000/g, '').slice(0, 8000) + "'"
const maskMatch = (value) => {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length >= 8 ? '···' + digits.slice(-4) : 'WhatsApp'
}
const hidePhones = (value) => String(value || '').replace(/(?:\+|00)?\d[\d\s\-()]{6,}\d/g, (match) => {
  const digits = match.replace(/\D/g, '')
  return digits.length >= 8 ? '···' + digits.slice(-4) : match
})
try {
  const turn = $('Build Turn').first().json || {}
  const digits = String(turn.from_phone || '').replace(/\D/g, '').slice(0, 15)
  const user = String(turn.raw_text || '').trim()
  const bubbles = $('Plan Delivery').all()
  const agent = bubbles.map((item) => String(item.json.text || '').trim()).filter(Boolean).join('\n\n').trim()
  const rewrites = [...new Set(bubbles.flatMap((item) => {
    const value = item.json && item.json.rewrites
    return Array.isArray(value) ? value : String(value || '').split(',')
  }).map((name) => String(name || '').trim()).filter((name) => /^[a-z_]+$/.test(name)))].join(',')
  const messageId = String(turn.anchor_message_id || '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 120)
  if (!digits || !user || !agent || !messageId) return [{ json: { skip: true, query: 'select 0 as saved' } }]
  const mask = maskMatch(digits)
  const title = hidePhones(user).replace(/\s+/g, ' ').trim().slice(0, 140) || mask
  let hex = ''
  let x = 2166136261
  const seed = 'k1-whatsapp:' + digits
  for (let i = 0; i < 8; i++) {
    x = Math.imul(x ^ seed.charCodeAt(i % seed.length), 16777619) >>> 0
    hex += x.toString(16).padStart(8, '0')
  }
  hex = hex.slice(0, 32)
  const conversationId = hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-4' + hex.slice(13, 16) + '-a' + hex.slice(17, 20) + '-' + hex.slice(20, 32)
  const query = [
    'with existing as (',
    '  select id from k1_staging_conversations where phone_key = ' + sqlLiteral(digits) + ' order by updated_at desc limit 1',
    '), inserted as (',
    '  insert into k1_staging_conversations (id, phone_key, phone, version_id, version_number, title, started_by, link_host)',
    '  select ' + sqlLiteral(conversationId) + '::uuid, ' + sqlLiteral(digits) + ', ' + sqlLiteral(mask) + ',',
    "  'fb38cc92-e22b-4ff3-8599-c5672f108902', 16, " + sqlLiteral(title) + ', ' + sqlLiteral('WhatsApp ' + mask) + ", 'live'",
    '  where not exists (select 1 from existing)',
    '  on conflict (id) do nothing',
    '  returning id',
    '), conv as (',
    '  select id from existing union all select id from inserted limit 1',
    '), fresh as (',
    '  insert into k1_staging_messages (conversation_id, role, text, is_opener, inbound_message_id)',
    '  select id, \'user\', ' + sqlLiteral(user) + ', false, ' + sqlLiteral(messageId),
    '  from conv',
    '  where not exists (select 1 from k1_staging_messages where conversation_id = (select id from conv) and role = \'user\' and inbound_message_id = ' + sqlLiteral(messageId) + ')',
    '  returning conversation_id',
    '), agent_row as (',
    '  insert into k1_staging_messages (conversation_id, role, text, is_opener, rewrites)',
    '  select conversation_id, \'agent\', ' + sqlLiteral(agent) + ', false, ' + sqlLiteral(rewrites) + ' from fresh',
    '  returning conversation_id',
    '), touched as (',
    '  update k1_staging_conversations set updated_at = now() where id in (select conversation_id from agent_row) returning id',
    ')',
    'select (select id::text from conv) as conversation_id, (select count(*) from touched) as saved',
  ].join('\n')
  return [{ json: { skip: false, query } }]
} catch (error) {
  return [{ json: { skip: true, query: 'select 0 as saved', error: String(error).slice(0, 200) } }]
}"""


def ensure_booking_site(nodes):
    for node in nodes:
        if node['name'] not in ('get_slots', 'get_station_info', 'book_inspection_invite', 'reschedule_booking'):
            continue
        inputs = node['parameters'].setdefault('workflowInputs', {})
        value = inputs.setdefault('value', {})
        value['booking_site'] = BOOKING_SITE
        schema = inputs.setdefault('schema', [])
        if not any(entry.get('id') == 'booking_site' for entry in schema):
            schema.append(SCHEMA_ENTRY('booking_site'))


def add_booking_site_lookup(nodes, connections):
    """One indexed read before the model. A failure still continues, and defaults the link to production."""
    named = {node['name']: node for node in nodes}
    if 'Is Reset?' not in named or 'Build Turn' not in named or 'Queue Inbound' not in named:
        return
    reset = named['Is Reset?']
    if 'Booking site' not in named:
        nodes.append({
            'id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'k1-booking-site')),
            'name': 'Booking site',
            'type': 'n8n-nodes-base.postgres',
            'typeVersion': named['Queue Inbound']['typeVersion'],
            'position': [reset['position'][0] + 40, reset['position'][1] + 220],
            'onError': 'continueRegularOutput',
            'alwaysOutputData': True,
            'credentials': named['Queue Inbound']['credentials'],
            'parameters': {'operation': 'executeQuery', 'query': BOOKING_SITE_QUERY},
        })
    else:
        named['Booking site']['parameters']['query'] = BOOKING_SITE_QUERY
        named['Booking site']['onError'] = 'continueRegularOutput'
        named['Booking site']['alwaysOutputData'] = True
    if 'Attach booking site' not in named:
        nodes.append({
            'id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'k1-attach-booking-site')),
            'name': 'Attach booking site',
            'type': 'n8n-nodes-base.code',
            'typeVersion': 2,
            'position': [reset['position'][0] + 260, reset['position'][1] + 220],
            'onError': 'continueRegularOutput',
            'parameters': {'mode': 'runOnceForAllItems', 'jsCode': ATTACH_BOOKING_SITE_JS},
        })
    else:
        named['Attach booking site']['parameters']['jsCode'] = ATTACH_BOOKING_SITE_JS
        named['Attach booking site']['onError'] = 'continueRegularOutput'
    false_branch = connections['Is Reset?']['main'][1]
    if not any(item['node'] == 'Booking site' for item in false_branch):
        connections['Is Reset?']['main'][1] = [{'node': 'Booking site', 'type': 'main', 'index': 0}]
    connections['Booking site'] = {'main': [[{'node': 'Attach booking site', 'type': 'main', 'index': 0}]]}
    connections['Attach booking site'] = {'main': [[{'node': 'AI Agent', 'type': 'main', 'index': 0}]]}


def add_whatsapp_log(nodes, connections):
    """Side branch after every bubble has been sent. Loop Bubbles does not wait on it."""
    named = {node['name']: node for node in nodes}
    if 'Loop Bubbles' not in named or 'Queue Inbound' not in named:
        return
    loop = named['Loop Bubbles']
    if 'Log WhatsApp turn' not in named:
        nodes.append({
            'id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'k1-log-whatsapp')),
            'name': 'Log WhatsApp turn',
            'type': 'n8n-nodes-base.code',
            'typeVersion': 2,
            'position': [loop['position'][0] + 220, loop['position'][1] + 260],
            'onError': 'continueRegularOutput',
            'parameters': {'mode': 'runOnceForAllItems', 'jsCode': WHATSAPP_LOG_JS},
        })
    else:
        named['Log WhatsApp turn']['parameters']['jsCode'] = WHATSAPP_LOG_JS
        named['Log WhatsApp turn']['onError'] = 'continueRegularOutput'
    if 'Write WhatsApp turn' not in named:
        nodes.append({
            'id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'k1-write-whatsapp')),
            'name': 'Write WhatsApp turn',
            'type': 'n8n-nodes-base.postgres',
            'typeVersion': named['Queue Inbound']['typeVersion'],
            'position': [loop['position'][0] + 460, loop['position'][1] + 260],
            'onError': 'continueRegularOutput',
            'alwaysOutputData': True,
            'credentials': named['Queue Inbound']['credentials'],
            'parameters': {'operation': 'executeQuery', 'query': '={{ $json.query }}'},
        })
    else:
        named['Write WhatsApp turn']['onError'] = 'continueRegularOutput'
        named['Write WhatsApp turn']['alwaysOutputData'] = True
    done = connections['Loop Bubbles']['main'][0]
    if not any(item['node'] == 'Log WhatsApp turn' for item in done):
        done.append({'node': 'Log WhatsApp turn', 'type': 'main', 'index': 0})
    connections['Log WhatsApp turn'] = {'main': [[{'node': 'Write WhatsApp turn', 'type': 'main', 'index': 0}]]}


def patch_live_booking_link(code):
    start, end = code.find('const linkLang'), code.find('const EXONYMS')
    source = (HERE / 'k1-muster-v2.js').read_text()
    src_start, src_end = source.find('const linkLang'), source.find('const EXONYMS')
    if min(start, end, src_start, src_end) < 0:
        raise SystemExit('bookingLink markers missing')
    return code[:start] + source[src_start:src_end] + code[end:]


def apply_log_schema():
    """Adds the two columns the WhatsApp log writes. Idempotent."""
    agent = gate.request('GET', f'/workflows/{LIVE_AGENT}')
    queue = next(node for node in agent['nodes'] if node['name'] == 'Queue Inbound')
    sql = (ROOT.parent.parent / 'supabase' / 'k1-agent-builder-007-whatsapp-chats.sql').read_text()
    kept = '\n'.join(line for line in sql.splitlines() if not line.strip().startswith('--'))
    statements = [part.strip() for part in kept.split(';') if part.strip()]
    nonce = uuid.uuid4().hex[:10]
    nodes = [{
        'id': 'hook', 'name': 'Hook', 'type': 'n8n-nodes-base.webhook', 'typeVersion': 2.1, 'position': [0, 0],
        'parameters': {'httpMethod': 'POST', 'path': f'k1-whatsapp-schema-{nonce}', 'responseMode': 'responseNode', 'options': {}},
    }]
    connections = {}
    previous = 'Hook'
    for index, statement in enumerate(statements):
        name = f'Sql {index}'
        nodes.append({
            'id': f'sql{index}', 'name': name, 'type': queue['type'], 'typeVersion': queue['typeVersion'],
            'position': [240 * (index + 1), 0], 'credentials': queue['credentials'],
            'parameters': {'operation': 'executeQuery', 'query': statement},
        })
        connections[previous] = {'main': [[{'node': name, 'type': 'main', 'index': 0}]]}
        previous = name
    nodes.append({
        'id': 'out', 'name': 'Out', 'type': 'n8n-nodes-base.respondToWebhook', 'typeVersion': 1.5, 'position': [240 * (len(statements) + 1), 0],
        'parameters': {'respondWith': 'json', 'responseBody': '={{ { ok: true } }}', 'options': {}},
    })
    connections[previous] = {'main': [[{'node': 'Out', 'type': 'main', 'index': 0}]]}
    body = {'name': f'k1 whatsapp schema {nonce}', 'nodes': nodes, 'connections': connections, 'settings': {'executionOrder': 'v1'}}
    wid = gate.request('POST', '/workflows', body)['id']
    try:
        gate.request('POST', f'/workflows/{wid}/activate')
        base = (os.environ.get('N8N_RAPID_BASE_URL') or gate.local_env().get('N8N_RAPID_BASE_URL') or gate.DEFAULT_BASE).rstrip('/')
        url = f'{base}/webhook/k1-whatsapp-schema-{nonce}'
        for attempt in range(8):
            request = urllib.request.Request(url, data=b'{}', headers={'Content-Type': 'application/json'}, method='POST')
            try:
                with urllib.request.urlopen(request, timeout=40) as response:
                    print('schema', response.status)
                    return
            except urllib.error.HTTPError as error:
                if error.code == 404 and attempt < 7:
                    time.sleep(1)
                    continue
                raise
    finally:
        for attempt in range(5):
            try:
                gate.request('POST', f'/workflows/{wid}/deactivate')
            except urllib.error.HTTPError:
                pass
            try:
                gate.request('DELETE', f'/workflows/{wid}')
                break
            except urllib.error.HTTPError:
                time.sleep(1 + attempt)


def wire_live():
    apply_log_schema()
    booking = snapshot(LIVE_BOOKING)
    for node in booking['nodes']:
        if node['name'] == 'Muster':
            node['parameters']['jsCode'] = patch_live_booking_link(node['parameters']['jsCode'])
    put_live(LIVE_BOOKING, booking, booking['active'])
    agent = snapshot(LIVE_AGENT)
    add_booking_site_lookup(agent['nodes'], agent['connections'])
    ensure_booking_site(agent['nodes'])
    add_whatsapp_log(agent['nodes'], agent['connections'])
    patch_agent_finish(agent)
    put_live(LIVE_AGENT, agent, agent['active'])
    print(f'wired live booking {LIVE_BOOKING} and agent {LIVE_AGENT}')


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
        if booking_target and node['type'] == '@n8n/n8n-nodes-langchain.toolWorkflow' and node['name'] != 'create_payment_link':
            node['parameters']['workflowId'].update({'value': booking_target[0], 'cachedResultName': booking_target[1]})
    text = json.dumps(nodes)
    assert booking_target is None or candidate_booking_id() not in text, 'candidate booking id left in the agent'
    return {'name': live['name'], 'nodes': nodes, 'connections': candidate['connections'], 'settings': candidate['settings']}


def candidate_booking_id():
    return by_name(BOOKING_NAME)


def promote(without_gate=False):
    booking_id, agent_id = by_name(BOOKING_NAME), by_name(AGENT_NAME)
    assert booking_id and agent_id, 'build the candidates first'
    gate_spec = importlib.util.spec_from_file_location('k1_gate', HERE / 'k1-gate.py')
    k1_gate = importlib.util.module_from_spec(gate_spec)
    gate_spec.loader.exec_module(k1_gate)
    if without_gate:
        print('WARNING: promoting without a passing regression gate')
    elif not k1_gate.verify():
        raise SystemExit('promote refused: no passing gate for this prompt (k1-gate.py check), or pass --without-gate for an emergency fix')
    live_booking, live_agent = snapshot(LIVE_BOOKING), snapshot(LIVE_AGENT)
    BACKUPS.mkdir(exist_ok=True)
    stamp = time.strftime('%Y%m%d-%H%M%S')
    (BACKUPS / f'{stamp}-booking.json').write_text(scrub_secrets(json.dumps(live_booking, ensure_ascii=False)))
    (BACKUPS / f'{stamp}-agent.json').write_text(scrub_secrets(json.dumps(live_agent, ensure_ascii=False)))
    new_booking = transplant(snapshot(booking_id), live_booking)
    new_agent = lock_live_path(transplant(snapshot(agent_id), live_agent, (LIVE_BOOKING, live_booking['name'])))
    put_live(LIVE_BOOKING, new_booking, live_booking['active'])
    put_live(LIVE_AGENT, new_agent, live_agent['active'])
    print(f'promoted: backups {stamp}-*.json; live booking {LIVE_BOOKING}, live agent {LIVE_AGENT}')


def rollback():
    stamps = sorted({p.name.split('-booking')[0].split('-agent')[0] for p in BACKUPS.glob('*.json')})
    assert stamps, 'no backups'
    stamp = stamps[-1]
    for wid, kind in ((LIVE_BOOKING, 'booking'), (LIVE_AGENT, 'agent')):
        body = json.loads((BACKUPS / f'{stamp}-{kind}.json').read_text())
        if kind == 'agent':
            lock_live_path(body)
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
        promote(without_gate='--without-gate' in sys.argv)
    elif command == 'rollback':
        rollback()
    elif command == 'wire':
        wire_live()
    elif command == 'finish':
        finish_live()
    elif command == 'typing':
        restore_typing()
    elif command == 'lead':
        restore_lead()
    elif command == 'cta':
        restore_cta()
    elif command == 'reply':
        apply_reply_rule()
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
