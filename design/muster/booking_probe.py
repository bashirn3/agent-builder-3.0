"""One end-to-end booking on Muster staging (chain 91): hold, customer, reserve, confirm,
look up, reschedule, cancel. Logs every request and response to booking_probe.log."""
import json, urllib.request, urllib.error, datetime

BASE = 'https://staging-booking-api.muster.fi/v3/91'
STATION = 256
PRODUCTS = [2246]
CATEGORY = 'M1'
PLATE = 'WSP-001'
LOG = open('/Users/bashirsani/Desktop/Projects/agent-builder-3.0/design/muster/booking_probe.log', 'w')


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={'Content-Type': 'application/json', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            status, raw = res.status, res.read().decode()
    except urllib.error.HTTPError as error:
        status, raw = error.code, error.read().decode()
    LOG.write(f'\n### {method} {path}\n')
    if body is not None:
        LOG.write('request: ' + json.dumps(body, ensure_ascii=False) + '\n')
    LOG.write(f'status: {status}\nresponse: {raw[:3000]}\n')
    LOG.flush()
    print(method, path, status, raw[:300])
    try:
        return status, json.loads(raw) if raw else None
    except ValueError:
        return status, raw


def free_slots(day_utc_start, days=1):
    start = day_utc_start.strftime('%Y-%m-%dT%H:%M:%S.000Z')
    end = (day_utc_start + datetime.timedelta(days=days)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
    query = f'/Calendar/{STATION}?StartDate={start}&EndDate={end}&VehicleCategory={CATEGORY}' + ''.join(f'&ProductIds={p}' for p in PRODUCTS)
    status, days_ = call('GET', query)
    return [slot for day in days_ for slots in (day.get('hours') or {}).values() for slot in slots if slot['isAvailable']], days_


# Tuesday 6 Oct 2026 in Helsinki (UTC+3) starts at 21:00 UTC the day before.
slots, days = free_slots(datetime.datetime(2026, 10, 5, 21, 0))
first, later = slots[4], slots[12]
price_id = days[0].get('externalPriceId')
print('picked', first['time'], 'then', later['time'], 'externalPriceId', price_id)

status, pending = call('POST', '/PendingReservations', {'time': first['time'].replace('Z', '.000Z'), 'stationId': STATION, 'productIds': PRODUCTS, 'plateNumber': PLATE, 'vehicleCategory': CATEGORY, 'groupId': None})
group, pending_uid = pending['groupId'], pending['reservationUid']

status, customer = call('POST', '/B2CCustomer', {'firstName': 'Wasup', 'lastName': 'Testi', 'receiveSms': False, 'receiveEmail': False, 'language': 'Finnish', 'plateNumber': PLATE, 'stationId': STATION})
customer_uid = customer['uid']

status, reserved = call('POST', '/Reservations', {'groupId': group, 'reservations': [{'pendingReservationUid': pending_uid, 'plateNumber': PLATE, 'vehicleCategory': CATEGORY, 'productIds': PRODUCTS}], 'b2CCustomerUid': customer_uid, 'language': 'Finnish', 'externalPriceId': price_id})

print('--- before confirm: group lookup and validity')
call('GET', f'/Reservations/{group}')
call('GET', f'/Reservations/valid/{group}')

status, _ = call('POST', '/Reservations/confirm', {'groupId': group, 'reservations': [{'pendingReservationUid': pending_uid}], 'sendConfirmation': False})

print('--- after confirm')
status, booking = call('GET', f'/Reservations/{group}')
reservation = booking['reservations'][0]
call('GET', f"/Reservations/search/{reservation['bookingNumber']}?customerLastname=Testi")
call('GET', f'/Reservations/valid/{group}')

print('--- is the booked slot gone from free times?')
slots_after, _ = free_slots(datetime.datetime(2026, 10, 5, 21, 0))
print('booked slot still free:', any(s['time'] == first['time'] for s in slots_after))

print('--- holding the already booked slot again')
call('POST', '/PendingReservations', {'time': first['time'].replace('Z', '.000Z'), 'stationId': STATION, 'productIds': PRODUCTS, 'plateNumber': 'WSP-002', 'vehicleCategory': CATEGORY, 'groupId': None})

print('--- reschedule to', later['time'])
status, moved_pending = call('POST', '/PendingReservations', {'time': later['time'].replace('Z', '.000Z'), 'stationId': STATION, 'productIds': PRODUCTS, 'plateNumber': PLATE, 'vehicleCategory': CATEGORY, 'groupId': group})
call('PUT', f'/B2CCustomer/{customer_uid}', {'firstName': 'Wasup', 'lastName': 'Testi', 'receiveSms': False, 'receiveEmail': False, 'language': 'Finnish', 'plateNumber': PLATE, 'stationId': STATION})
call('POST', '/Reservations', {'groupId': moved_pending['groupId'], 'reservations': [{'pendingReservationUid': moved_pending['reservationUid'], 'originalReservationUid': reservation['uid'], 'plateNumber': PLATE, 'vehicleCategory': CATEGORY, 'productIds': PRODUCTS}], 'b2CCustomerUid': customer_uid, 'language': 'Finnish', 'externalPriceId': price_id})
call('POST', '/Reservations/confirm', {'groupId': moved_pending['groupId'], 'reservations': [{'pendingReservationUid': moved_pending['reservationUid'], 'originalReservationUid': reservation['uid']}], 'sendConfirmation': False})
status, moved = call('GET', f"/Reservations/{moved_pending['groupId']}")

print('--- cancel')
call('DELETE', f"/Reservations/{moved_pending['groupId']}?sendConfirmation=false")
call('GET', f"/Reservations/{moved_pending['groupId']}")
call('GET', f"/Reservations/valid/{moved_pending['groupId']}")
if moved_pending['groupId'] != group:
    call('GET', f'/Reservations/{group}')
    call('DELETE', f'/Reservations/{group}?sendConfirmation=false')
