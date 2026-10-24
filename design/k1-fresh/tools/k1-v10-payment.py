#!/usr/bin/env python3
"""Stripe test-mode prices, WASUP100, two hand-test payment links, and the K1 v10 payment workflow.

The credential is the n8n account named "stripe demo" (livemode false). Live clinic Stripe accounts are not used.
The workflow stays the one the agent tool calls. It does not answer WhatsApp inbound traffic.
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

import importlib.util

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('gate', HERE / 'n8n-gate.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

STRIPE = {'stripeApi': {'id': 'WKaKV8Xo5mUbozCV', 'name': 'stripe demo'}}
WASUP = {'wasupApi': {'id': 'SW7J0tWGyyYAPdkN', 'name': 'Wasup Account'}}
SUPABASE = {'supabaseApi': {'id': 'sKZQDTU3b68ZSLwX', 'name': 'K1 Agent builder DB'}}
INSTANCE = 'wa_mt1j5bcl_sch23'
PAYMENT_NAME = 'K1 v10 payment'
PRICE_NOW = 'k1_inspection_now'
PRICE_STATION = 'k1_inspection_station'
SUCCESS_URL = 'https://ajanvaraus.k1katsastus.fi/?payment=success'
CANCEL_URL = 'https://ajanvaraus.k1katsastus.fi/?payment=cancel'
OUT = HERE / 'k1-v10-stripe.json'


def api(method, path, body=None):
    return gate.request(method, path, body)


def public(value):
    """Drop Stripe secrets before anything is printed or written."""
    if isinstance(value, dict):
        return {k: public(v) for k, v in value.items() if k not in ('secret', 'client_secret', 'webhook_secret')}
    if isinstance(value, list):
        return [public(v) for v in value]
    return value


class StripeProxy:
    def __init__(self):
        self.wid = None
        self.url = None

    def __enter__(self):
        suffix = uuid.uuid4().hex[:8]
        path = 'k1-v10-stripe-setup-' + suffix
        http = {
            'method': 'POST',
            'url': "={{ 'https://api.stripe.com' + ($json.body.path || '') }}",
            'authentication': 'predefinedCredentialType',
            'nodeCredentialType': 'stripeApi',
            'sendBody': True,
            'contentType': 'form-urlencoded',
            'specifyBody': 'string',
            'body': '={{ $json.body.form || "" }}',
            'options': {'response': {'response': {'fullResponse': True, 'neverError': True}}},
        }
        get = {
            'method': 'GET',
            'url': "={{ 'https://api.stripe.com' + ($json.body.path || '') }}",
            'authentication': 'predefinedCredentialType',
            'nodeCredentialType': 'stripeApi',
            'options': {'response': {'response': {'fullResponse': True, 'neverError': True}}},
        }
        nodes = [
            {'id': 'wh', 'name': 'Webhook', 'type': 'n8n-nodes-base.webhook', 'typeVersion': 2, 'position': [0, 0], 'webhookId': str(uuid.uuid4()),
             'parameters': {'httpMethod': 'POST', 'path': path, 'responseMode': 'lastNode', 'options': {}}},
            {'id': 'if', 'name': 'Post?', 'type': 'n8n-nodes-base.if', 'typeVersion': 2.2, 'position': [240, 0], 'parameters': {
                'conditions': {'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2},
                               'conditions': [{'id': 'm', 'leftValue': '={{ $json.body.method }}', 'rightValue': 'POST', 'operator': {'type': 'string', 'operation': 'equals'}}],
                               'combinator': 'and'}, 'options': {}}},
            {'id': 'post', 'name': 'Post', 'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 4.2, 'position': [480, -80], 'credentials': STRIPE, 'parameters': http},
            {'id': 'get', 'name': 'Get', 'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 4.2, 'position': [480, 120], 'credentials': STRIPE, 'parameters': get},
            {'id': 'sum', 'name': 'Sum', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [740, 0], 'parameters': {'mode': 'runOnceForAllItems', 'jsCode': SUM_JS}},
        ]
        connections = {
            'Webhook': {'main': [[{'node': 'Post?', 'type': 'main', 'index': 0}]]},
            'Post?': {'main': [[{'node': 'Post', 'type': 'main', 'index': 0}], [{'node': 'Get', 'type': 'main', 'index': 0}]]},
            'Post': {'main': [[{'node': 'Sum', 'type': 'main', 'index': 0}]]},
            'Get': {'main': [[{'node': 'Sum', 'type': 'main', 'index': 0}]]},
        }
        self.wid = api('POST', '/workflows', {'name': 'tmp K1 stripe setup ' + suffix, 'nodes': nodes, 'connections': connections, 'settings': {'executionOrder': 'v1'}})['id']
        api('POST', f'/workflows/{self.wid}/activate')
        self.url = (os.environ.get('N8N_RAPID_BASE_URL') or gate.DEFAULT_BASE).rstrip('/') + '/webhook/' + path
        return self

    def __exit__(self, *_):
        if not self.wid:
            return
        try:
            api('POST', f'/workflows/{self.wid}/deactivate')
        except Exception:
            pass
        for _ in range(8):
            try:
                api('DELETE', f'/workflows/{self.wid}')
                return
            except urllib.error.HTTPError:
                time.sleep(2)

    def call(self, method, path, form=None):
        payload = {'method': method, 'path': path, 'form': urllib.parse.urlencode(form or {}, doseq=True)}
        last = None
        for _ in range(12):
            req = urllib.request.Request(self.url, data=json.dumps(payload).encode(), method='POST', headers={'Content-Type': 'application/json'})
            try:
                with urllib.request.urlopen(req, timeout=60) as res:
                    data = json.load(res)
                break
            except urllib.error.HTTPError as error:
                last = error
                if error.code != 404:
                    raise
                time.sleep(2)
        else:
            raise last
        data = data[0] if isinstance(data, list) else data
        status = int(data.get('status') or 0)
        body = data.get('body')
        if status >= 400 and not (isinstance(body, dict) and body.get('error', {}).get('code') == 'resource_missing'):
            message = ''
            if isinstance(body, dict) and isinstance(body.get('error'), dict):
                message = str(body['error'].get('message') or '')[:240]
            if status not in (404,) or 'No such' not in message:
                if status >= 400 and 'No such coupon' not in message and status != 404:
                    print('stripe', method, path.split('?')[0], status, message)
        return status, body if isinstance(body, dict) else {}


SUM_JS = r"""
const item = $input.first().json || {}
const status = Number(item.statusCode || item.status || 0)
let body = item.body === undefined ? item : item.body
if (typeof body === 'string') {
  try { body = JSON.parse(body) } catch (error) { body = { error: { message: body.slice(0, 240) } } }
}
if (body && body.error) body = { error: { type: body.error.type || '', code: body.error.code || '', message: String(body.error.message || '').slice(0, 300) } }
return [{ json: { status: status || (body && body.error ? 400 : 200), body } }]
"""


def ensure_prices(stripe):
    prices = {}
    for key, amount, label in (
        (PRICE_NOW, '3400', 'K1 inspection base, pay now'),
        (PRICE_STATION, '3800', 'K1 inspection base, at the station'),
    ):
        status, body = stripe.call('GET', f'/v1/prices?lookup_keys%5B%5D={key}&active=true&limit=1')
        found = (body.get('data') or [None])[0]
        if status == 200 and found and found.get('id'):
            prices[key] = found['id']
            continue
        status, made = stripe.call('POST', '/v1/prices', {
            'currency': 'eur', 'unit_amount': amount, 'lookup_key': key, 'product_data[name]': label,
        })
        if status >= 400 or not made.get('id'):
            raise SystemExit(f'could not create price {key}: {status} {(made.get("error") or {}).get("message", "")}')
        prices[key] = made['id']
    return prices


def ensure_coupon(stripe):
    status, body = stripe.call('GET', '/v1/coupons/WASUP100')
    if status == 200 and body.get('id') == 'WASUP100':
        if body.get('percent_off') != 100 or not body.get('valid', True):
            raise SystemExit('coupon WASUP100 exists but is not a valid 100 percent discount')
        return
    status, made = stripe.call('POST', '/v1/coupons', {'id': 'WASUP100', 'percent_off': '100', 'duration': 'forever', 'name': 'WASUP100'})
    if status >= 400:
        raise SystemExit(f'could not create WASUP100: {(made.get("error") or {}).get("message", "")}')


def ensure_promo(stripe):
    status, body = stripe.call('GET', '/v1/promotion_codes?code=WASUP100&limit=5')
    for row in body.get('data') or []:
        if row.get('code') == 'WASUP100' and row.get('active'):
            return row['id']
    status, made = stripe.call('POST', '/v1/promotion_codes', {
        'promotion[type]': 'coupon', 'promotion[coupon]': 'WASUP100', 'code': 'WASUP100',
    })
    if status >= 400 or not made.get('id'):
        raise SystemExit(f'could not create promotion code WASUP100: {(made.get("error") or {}).get("message", "")}')
    return made['id']


def ensure_links(stripe, prices):
    status, body = stripe.call('GET', '/v1/payment_links?active=true&limit=100')
    if status >= 400:
        raise SystemExit(f'could not list payment links: {(body.get("error") or {}).get("message", "")}')
    urls = {}
    for key, price_id in prices.items():
        match = None
        for link in body.get('data') or []:
            # The list payload names the price on the first line item when Stripe includes it; otherwise read the link.
            line = ((link.get('line_items') or {}).get('data') or [{}])[0]
            if (line.get('price') or {}).get('id') == price_id or line.get('price') == price_id:
                match = link
                break
        if match is None:
            for link in body.get('data') or []:
                st, detail = stripe.call('GET', f"/v1/payment_links/{link['id']}/line_items?limit=1")
                row = ((detail.get('data') or [None])[0]) or {}
                price = row.get('price')
                price = price.get('id') if isinstance(price, dict) else price
                if price == price_id:
                    match = link
                    break
        if match is None:
            status, made = stripe.call('POST', '/v1/payment_links', {
                'line_items[0][price]': price_id, 'line_items[0][quantity]': '1', 'allow_promotion_codes': 'true',
            })
            if status >= 400 or not made.get('url'):
                raise SystemExit(f'could not create payment link for {key}: {(made.get("error") or {}).get("message", "")}')
            match = made
        urls[key] = match['url']
    return urls


def form_js(price_id):
    return r"""
const input = $input.first().json || {}
const enc = encodeURIComponent
const pairs = [
  ['mode', 'payment'],
  ['line_items[0][price]', %s],
  ['line_items[0][quantity]', '1'],
  ['allow_promotion_codes', 'true'],
  ['success_url', %s],
  ['cancel_url', %s],
  ['metadata[booking_number]', String(input.booking_number || '')],
  ['metadata[phone]', String(input.phone || '')],
  ['metadata[station_name]', String(input.station_name || '')],
  ['metadata[when_text]', String(input.when_text || '')],
  ['metadata[language]', String(input.language || 'fi')],
]
return [{ json: { form: pairs.map((pair) => enc(pair[0]) + '=' + enc(pair[1])).join('&') } }]
""" % (json.dumps(price_id), json.dumps(SUCCESS_URL), json.dumps(CANCEL_URL))

SHAPE_JS = r"""
const item = $input.first().json || {}
const body = item.body && item.body.url ? item.body : item
if (!body.url) {
  const message = (item.body && item.body.error && item.body.error.message) || item.error || 'Stripe did not return a checkout url'
  return [{ json: { ok: false, error: String(message).slice(0, 300) } }]
}
return [{ json: { ok: true, url: body.url, session_id: body.id, amount_eur: 34, promo_code: 'WASUP100' } }]
"""

PAID_JS = r"""
const raw = $input.first().json || {}
const event = raw.body || raw
const session = (event.data && event.data.object) || event
if (!session || session.object !== 'checkout.session') return [{ json: { skip: true, reason: 'not a checkout session' } }]
const paid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required' || (session.amount_total === 0 && session.status === 'complete')
if (!paid) return [{ json: { skip: true, reason: 'unpaid' } }]
const store = $getWorkflowStaticData('global')
store.paid = store.paid || {}
if (store.paid[session.id]) return [{ json: { skip: true, reason: 'already sent' } }]
store.paid[session.id] = Date.now()
const keys = Object.keys(store.paid)
if (keys.length > 400) delete store.paid[keys[0]]
const meta = session.metadata || {}
return [{ json: {
  skip: false,
  booking_number: String(meta.booking_number || ''),
  phone: String(meta.phone || '').replace(/\D/g, ''),
  station_name: String(meta.station_name || ''),
  when_text: String(meta.when_text || ''),
  language: String(meta.language || 'fi').slice(0, 2),
  session_id: session.id,
} }]
"""

CONFIRM_JS = r"""
const paid = $('Paid').first().json
if (!paid || paid.skip) return [{ json: { skip: true } }]
let rows = []
try {
  const body = $input.first().json
  const list = Array.isArray(body) ? body : (Array.isArray(body.body) ? body.body : (body.data || body))
  rows = Array.isArray(list) ? list : []
} catch (error) { rows = [] }
const row = rows.find((item) => item && String(item.bookingNumber || item.booking_number || item.p_booking_number || '') === paid.booking_number)
const station = paid.station_name || (row && (row.stationName || row.station_name)) || ''
const when = paid.when_text || ''
const number = paid.booking_number || (row && (row.bookingNumber || row.booking_number)) || ''
const text = {
  fi: `Maksu on vastaanotettu. Varaus ${number}${when ? ', ' + when : ''}${station ? ', ' + station : ''}.`,
  sv: `Betalningen är mottagen. Bokning ${number}${when ? ', ' + when : ''}${station ? ', ' + station : ''}.`,
  en: `The payment was received. Booking ${number}${when ? ', ' + when : ''}${station ? ', ' + station : ''}.`,
}[paid.language] || `The payment was received. Booking ${number}${when ? ', ' + when : ''}${station ? ', ' + station : ''}.`
if (!paid.phone) return [{ json: { skip: true, reason: 'no phone' } }]
return [{ json: { skip: false, to: paid.phone, text, instance_id: %s } }]
""" % json.dumps(INSTANCE)


def payment_workflow(price_id, trigger_parameters):
    checkout = {
        'method': 'POST', 'url': 'https://api.stripe.com/v1/checkout/sessions',
        'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'stripeApi',
        'sendBody': True, 'contentType': 'form-urlencoded', 'specifyBody': 'string',
        'body': '={{ $json.form }}',
        'options': {'response': {'response': {'fullResponse': True, 'neverError': True}}},
    }
    nodes = [
        {'id': 'call', 'name': 'When called by the agent', 'type': 'n8n-nodes-base.executeWorkflowTrigger', 'typeVersion': 1.1, 'position': [0, 0],
         'parameters': trigger_parameters},
        {'id': 'form', 'name': 'Checkout form', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [220, 0],
         'parameters': {'mode': 'runOnceForAllItems', 'jsCode': form_js(price_id)}},
        {'id': 'checkout', 'name': 'Checkout', 'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 4.2, 'position': [460, 0], 'credentials': STRIPE, 'parameters': checkout},
        {'id': 'shape', 'name': 'Checkout result', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [700, 0],
         'parameters': {'mode': 'runOnceForAllItems', 'jsCode': SHAPE_JS}},
        {'id': 'stripe', 'name': 'Stripe paid', 'type': 'n8n-nodes-base.stripeTrigger', 'typeVersion': 1, 'position': [0, 280], 'credentials': STRIPE,
         'parameters': {'events': ['checkout.session.completed']}},
        {'id': 'paid', 'name': 'Paid', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [260, 280],
         'parameters': {'mode': 'runOnceForAllItems', 'jsCode': PAID_JS}},
        {'id': 'lookup', 'name': 'Bookings', 'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 4.2, 'position': [520, 280],
         'onError': 'continueRegularOutput', 'alwaysOutputData': True, 'credentials': SUPABASE,
         'parameters': {'method': 'POST', 'url': 'https://wuejgskyjzuffqsgvunp.supabase.co/rest/v1/rpc/list_bookings',
                        'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'supabaseApi', 'sendBody': True, 'specifyBody': 'json',
                        'jsonBody': '={{ { p_tenant_key: "k1_katsastus_demo", p_from: new Date(Date.now() - 86400000).toISOString(), p_to: new Date(Date.now() + 400 * 86400000).toISOString() } }}',
                        'options': {'timeout': 15000}}},
        {'id': 'confirm', 'name': 'Confirmation', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [780, 280],
         'parameters': {'mode': 'runOnceForAllItems', 'jsCode': CONFIRM_JS}},
        {'id': 'sendif', 'name': 'Send?', 'type': 'n8n-nodes-base.if', 'typeVersion': 2.2, 'position': [1000, 280], 'parameters': {
            'conditions': {'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2},
                           'conditions': [{'id': 's', 'leftValue': '={{ $json.skip ? "yes" : "no" }}', 'rightValue': 'no', 'operator': {'type': 'string', 'operation': 'equals'}}],
                           'combinator': 'and'}, 'options': {}}},
        {'id': 'send', 'name': 'Send confirmation', 'type': 'n8n-nodes-wasup.wasup', 'typeVersion': 1, 'position': [1240, 220], 'credentials': WASUP,
         'parameters': {'resource': 'message', 'operation': 'sendText',
                        'instanceId': {'__rl': True, 'value': INSTANCE, 'mode': 'id'},
                        'to': '={{ $json.to }}', 'message': '={{ $json.text }}', 'advancedOptions': {}}},
    ]
    connections = {
        'When called by the agent': {'main': [[{'node': 'Checkout form', 'type': 'main', 'index': 0}]]},
        'Checkout form': {'main': [[{'node': 'Checkout', 'type': 'main', 'index': 0}]]},
        'Checkout': {'main': [[{'node': 'Checkout result', 'type': 'main', 'index': 0}]]},
        'Stripe paid': {'main': [[{'node': 'Paid', 'type': 'main', 'index': 0}]]},
        'Paid': {'main': [[{'node': 'Bookings', 'type': 'main', 'index': 0}]]},
        'Bookings': {'main': [[{'node': 'Confirmation', 'type': 'main', 'index': 0}]]},
        'Confirmation': {'main': [[{'node': 'Send?', 'type': 'main', 'index': 0}]]},
        'Send?': {'main': [[{'node': 'Send confirmation', 'type': 'main', 'index': 0}], []]},
    }
    return nodes, connections


def save_payment(nodes, connections):
    body = {'name': PAYMENT_NAME, 'nodes': nodes, 'connections': connections, 'settings': {'executionOrder': 'v1'}}
    items = []
    cursor = None
    while True:
        page = api('GET', '/workflows?limit=250' + (f'&cursor={cursor}' if cursor else ''))
        items += page['data']
        cursor = page.get('nextCursor')
        if not cursor:
            break
    existing = next((item['id'] for item in items if item['name'] == PAYMENT_NAME), None)
    if existing:
        try:
            api('POST', f'/workflows/{existing}/deactivate')
        except Exception:
            pass
        api('PUT', f'/workflows/{existing}', body)
        wid = existing
    else:
        wid = api('POST', '/workflows', body)['id']
    api('POST', f'/workflows/{wid}/activate')
    return wid


def trigger_parameters():
    booking = api('GET', '/workflows/wAE7EHLyJk6JsMue')
    node = next(n for n in booking['nodes'] if n['name'] == 'When called by the agent')
    return node.get('parameters') or {'inputSource': 'passthrough'}


def smoke(wid):
    suffix = uuid.uuid4().hex[:8]
    path = 'k1-v10-pay-smoke-' + suffix
    nodes = [
        {'id': 'wh', 'name': 'Webhook', 'type': 'n8n-nodes-base.webhook', 'typeVersion': 2, 'position': [0, 0], 'webhookId': str(uuid.uuid4()),
         'parameters': {'httpMethod': 'POST', 'path': path, 'responseMode': 'lastNode', 'options': {}}},
        {'id': 'run', 'name': 'Run', 'type': 'n8n-nodes-base.executeWorkflow', 'typeVersion': 1.2, 'position': [280, 0],
         'parameters': {'workflowId': {'__rl': True, 'value': wid, 'mode': 'id', 'cachedResultName': PAYMENT_NAME},
                        'workflowInputs': {'mappingMode': 'defineBelow', 'value': {
                            'booking_number': 'SMOKE', 'phone': '358000000099', 'station_name': 'Palokka',
                            'when_text': 'Thu 1 Oct at 09:00', 'language': 'en',
                        }, 'matchingColumns': [], 'schema': [], 'attemptToConvertTypes': False, 'convertFieldsToString': True},
                        'options': {}}},
    ]
    connections = {'Webhook': {'main': [[{'node': 'Run', 'type': 'main', 'index': 0}]]}}
    sid = api('POST', '/workflows', {'name': 'tmp K1 payment smoke ' + suffix, 'nodes': nodes, 'connections': connections, 'settings': {'executionOrder': 'v1'}})['id']
    try:
        api('POST', f'/workflows/{sid}/activate')
        url = (os.environ.get('N8N_RAPID_BASE_URL') or gate.DEFAULT_BASE).rstrip('/') + '/webhook/' + path
        for _ in range(12):
            req = urllib.request.Request(url, data=b'{}', method='POST', headers={'Content-Type': 'application/json'})
            try:
                with urllib.request.urlopen(req, timeout=60) as res:
                    data = json.load(res)
                break
            except urllib.error.HTTPError as error:
                if error.code != 404:
                    detail = error.read().decode()[:300]
                    raise SystemExit(f'payment smoke failed {error.code} {detail}')
                time.sleep(2)
        else:
            raise SystemExit('payment smoke webhook did not register')
        data = data[0] if isinstance(data, list) else data
        link = str(data.get('url') or '')
        if not data.get('ok') or not link.startswith('https://'):
            raise SystemExit('payment smoke did not return a checkout url')
        print('checkout smoke ok', link.split('?')[0][:48], 'session', str(data.get('session_id') or '')[:14])
    finally:
        try:
            api('POST', f'/workflows/{sid}/deactivate')
        except Exception:
            pass
        for _ in range(6):
            try:
                api('DELETE', f'/workflows/{sid}')
                break
            except Exception:
                time.sleep(2)


def main():
    with StripeProxy() as stripe:
        status, balance = stripe.call('GET', '/v1/balance')
        if status != 200 or balance.get('livemode') is not False:
            raise SystemExit(f'stripe demo credential is not a test-mode key (status {status})')
        prices = ensure_prices(stripe)
        ensure_coupon(stripe)
        promo = ensure_promo(stripe)
        links = ensure_links(stripe, prices)
    saved = {
        'credential': 'stripe demo', 'livemode': False, 'prices': prices, 'coupon': 'WASUP100', 'promotion_code': promo,
        'payment_links': {'pay_now_34': links[PRICE_NOW], 'at_station_38': links[PRICE_STATION]},
    }
    OUT.write_text(json.dumps(saved, indent=2) + '\n')
    print(json.dumps(public(saved), indent=2))
    nodes, connections = payment_workflow(prices[PRICE_NOW], trigger_parameters())
    try:
        wid = save_payment(nodes, connections)
    except urllib.error.HTTPError as error:
        detail = error.read().decode()[:400]
        raise SystemExit(f'payment workflow was not activated: {error.code} {detail}')
    print('payment workflow', wid, 'active')
    smoke(wid)


if __name__ == '__main__':
    main()
