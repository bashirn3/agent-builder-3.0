"""Tools for the Parlant shadow agent. Each one is a thin call to the existing n8n booking workflow (the Muster engine in
k1-muster-v2.js), so no booking logic is rewritten here.

The booking workflow URL and its eval key are not configured on the server: k1-v2-eval.py registers them per session
together with the lead (POST /k1/lead), because every eval run creates its own booking copy with its own key. Every call
is recorded per session in the same shape as the n8n playground's `steps`, so the eval checks run unchanged.
"""
import asyncio
import json
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

import parlant.sdk as p

SESSIONS: dict[str, dict] = {}
LOCK = threading.Lock()
LANG_NAMES = {'fi': 'Finnish', 'sv': 'Swedish', 'en': 'English'}


def register(session_id, lead, booking_url, secret, lead_context=''):
    with LOCK:
        SESSIONS[session_id] = {'lead': lead, 'booking_url': booking_url, 'secret': secret, 'lead_context': lead_context,
                                'steps': [], 'booked': [], 'opted_out': False, 'escalations': []}


def steps_since(session_id, offset):
    with LOCK:
        return list(SESSIONS.get(session_id, {}).get('steps', [])[offset:])


def session(context):
    found = SESSIONS.get(context.session_id)
    if not found:
        raise RuntimeError('session not registered: POST /k1/lead first')
    return found


def record(context, tool, payload, output):
    text = output if isinstance(output, str) else json.dumps(output, ensure_ascii=False)
    with LOCK:
        session(context)['steps'].append({'tool': tool, 'input': payload, 'output': text[:6000]})
    return text


def call_booking(state, payload, timeout=90):
    body = json.dumps(payload).encode()
    for attempt in range(4):
        req = urllib.request.Request(state['booking_url'], data=body, method='POST',
                                     headers={'Content-Type': 'application/json', 'x-k1-eval-key': state['secret']})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                data = json.load(res)
                return data[0] if isinstance(data, list) and data else data
        except urllib.error.HTTPError as error:
            if error.code != 503 or attempt == 3:
                return {'success': False, 'error': f'booking workflow HTTP {error.code}'}
        except Exception as error:
            if attempt == 3:
                return {'success': False, 'error': f'booking workflow unreachable: {type(error).__name__}'}
        time.sleep(3 + attempt * 3)


async def booking(context, tool, payload):
    state = session(context)
    lead = state['lead']
    full = {'phone': lead.get('phone', ''), 'lead_station': lead.get('station', ''), 'lead_station_id': lead.get('sid') or '',
            'lead_product': lead.get('product', ''), 'lead_vehicle_category': lead.get('cat', ''), **payload}
    output = await asyncio.to_thread(call_booking, state, full)
    return output, record(context, tool, payload, output)


def result(data):
    return p.ToolResult(data=data)


@p.tool
async def get_lead_context(context: p.ToolContext) -> p.ToolResult:
    """The lead this reminder was sent for: language, station, product, plate, phone and the current Helsinki date."""
    state = session(context)
    now = datetime.now(ZoneInfo('Europe/Helsinki'))
    return result(f"{state['lead_context']}\n- Today in Helsinki: {now.strftime('%A %Y-%m-%d %H:%M')}")


@p.tool
async def get_station_info(context: p.ToolContext, station: str = '', date: str = '', product: str = '', vehicle_category: str = '', include_measuring: str = '') -> p.ToolResult:
    """Live facts for ONE K1 station: opening hours for a date (default today) and the next days, address, whether the
    assistant can book there, prices for the vehicle, and a short preview of free times. Leave station empty for the
    customer's own station; name another station or city only when the customer asks about it."""
    data, _ = await booking(context, 'get_station_info', {'action': 'station_info', 'station': station, 'date': date, 'product': product,
                                                          'vehicle_category': vehicle_category, 'include_measuring': include_measuring})
    return result(data)


@p.tool
async def get_slots(context: p.ToolContext, date_from: str, date_to: str, station: str = '', product: str = '', vehicle_category: str = '', include_measuring: str = '') -> p.ToolResult:
    """Live free appointment times for one station, the ONLY source of times and slot_id values. date_from and date_to are
    YYYY-MM-DD (Europe/Helsinki), at most 14 days apart. Leave station empty for the customer's own station. include_measuring
    'false' only when the customer does not want the statutory measuring."""
    data, _ = await booking(context, 'get_slots', {'action': 'get_slots', 'date_from': date_from, 'date_to': date_to, 'station': station,
                                                   'product': product, 'vehicle_category': vehicle_category, 'include_measuring': include_measuring})
    return result(data)


@p.tool
async def book_inspection_invite(context: p.ToolContext, start_time: str, time: str, name: str, rek: str = '', email: str = '', language: str = '') -> p.ToolResult:
    """Book a NEW inspection. start_time is the exact slot_id from get_slots for the chosen time, and time is that clock
    time (e.g. 16:30). rek defaults to the plate on the reminder. success true includes booking_number and event_id."""
    lead = session(context)['lead']
    data, _ = await booking(context, 'book_inspection_invite', {'action': 'book', 'start_time': start_time, 'time': time, 'name': name,
                                                                'rek': rek or lead.get('plate', ''), 'email': email, 'language': language or lead.get('lang', '')})
    if isinstance(data, dict) and data.get('event_id'):
        with LOCK:
            session(context)['booked'].append(str(data['event_id']))
    return result(data)


@p.tool
async def get_my_bookings(context: p.ToolContext) -> p.ToolResult:
    """The customer's own upcoming bookings made through this chat, found from their phone: count and a list with
    event_id, booking_number, station_name, plate, date, time and includes_measuring."""
    data, _ = await booking(context, 'get_my_bookings', {'action': 'my_bookings'})
    return result(data)


async def owned(context, event_id):
    state = session(context)
    if not event_id:
        return False
    if any(event_id == e or event_id.split('|')[0] == e.split('|')[0] for e in state['booked']):
        return True
    mine = await asyncio.to_thread(call_booking, state, {'action': 'my_bookings', 'phone': state['lead'].get('phone', '')})
    ids = {str(b.get('event_id', '')) for b in (mine or {}).get('bookings', [])} if isinstance(mine, dict) else set()
    return event_id in ids


@p.tool
async def cancel_booking(context: p.ToolContext, event_id: str, start_time: str = '') -> p.ToolResult:
    """Cancel one of the customer's own bookings. event_id comes from get_my_bookings or from a booking made in this
    conversation. If already_cancelled is true, it was already gone."""
    if not await owned(context, event_id):
        data = {'success': False, 'error': 'Not one of this customer\'s bookings. Use an event_id from get_my_bookings.'}
        record(context, 'cancel_booking', {'event_id': event_id}, data)
        return result(data)
    data, _ = await booking(context, 'cancel_booking', {'action': 'cancel', 'event_id': event_id, 'start_time': start_time})
    return result(data)


@p.tool
async def reschedule_booking(context: p.ToolContext, event_id: str, start_time: str, time: str) -> p.ToolResult:
    """Move one of the customer's own bookings. start_time is the NEW slot_id from get_slots and time its clock time;
    event_id comes from get_my_bookings or from a booking made in this conversation. The booking number stays the same."""
    if not await owned(context, event_id):
        data = {'success': False, 'error': 'Not one of this customer\'s bookings. Use an event_id from get_my_bookings.'}
        record(context, 'reschedule_booking', {'event_id': event_id, 'start_time': start_time}, data)
        return result(data)
    lead = session(context)['lead']
    data, _ = await booking(context, 'reschedule_booking', {'action': 'reschedule', 'event_id': event_id, 'start_time': start_time, 'time': time,
                                                            'rek': lead.get('plate', ''), 'language': lead.get('lang', '')})
    return result(data)


@p.tool
async def faq_lookup(context: p.ToolContext, query: str) -> p.ToolResult:
    """Look up the official A-Katsastus FAQ with 2 to 6 English keywords (post-inspection, receipts, leasing, registering,
    decommissioning, change of ownership, plates, insurance, Autotohtori, Muistakatsastus, emission tests, licences).
    Returns up to three entries; answer only from the best one. Not for opening hours or prices."""
    data, _ = await booking(context, 'faq_lookup', {'action': 'faq', 'query': query})
    return result(data)


@p.tool
async def opt_out(context: p.ToolContext) -> p.ToolResult:
    """Stop reminders for this number. Only when the customer asks to stop messages or not be contacted, refuses
    reminders, or says the car is already inspected. Never for a sold car, a new plate or another vehicle."""
    state = session(context)
    already = state['opted_out']
    with LOCK:
        state['opted_out'] = True
    data = {'success': True, 'opted_out': True, 'already_opted_out': already, 'puhelin': state['lead'].get('phone', '')}
    record(context, 'opt_out', {'puhelin': state['lead'].get('phone', '')}, data)
    return result(data)


@p.tool
async def escalate_to_human(context: p.ToolContext, reason: str) -> p.ToolResult:
    """Flag the conversation for staff (an internal flag, nobody is notified). Only when the customer asks for a person,
    demands compensation, refuses to continue, or reports a legal, safety or accident matter."""
    state = session(context)
    with LOCK:
        state['escalations'].append(reason)
    data = {'success': True, 'escalated': True}
    record(context, 'escalate_to_human', {'syy': reason}, data)
    return result(data)


ALL = {t.tool.name: t for t in (get_station_info, get_slots, book_inspection_invite, get_my_bookings, cancel_booking,
                                reschedule_booking, faq_lookup, opt_out, escalate_to_human)}
