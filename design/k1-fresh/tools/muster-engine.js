// Muster staging, chain 91. Category is always M1. No vehicle lookup.
// Called by the booking webhook and by the agent tools.
const request = (options) => this.helpers.httpRequest.call(this, options)
const CHAIN = 'https://staging-booking-api.muster.fi/v3/91'
const STATIONS = { 256: 'K1 Katsastus Jyväskylä Palokka', 241: 'K1 Katsastus Turku Itäharju' }
const input = $input.first().json
const body = input.body && input.body.action ? input.body : input
const action = String(body.action || '')

function helsinkiOffset(day) {
  const year = Number(String(day).slice(0, 4))
  const lastSunday = (monthIndex) => {
    const date = new Date(Date.UTC(year, monthIndex + 1, 0))
    date.setUTCDate(date.getUTCDate() - date.getUTCDay())
    return date
  }
  const current = new Date(`${day}T12:00:00Z`)
  const summer = current >= lastSunday(2) && current < lastSunday(9)
  return summer ? '+03:00' : '+02:00'
}

function showHelsinki(iso) {
  const date = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Helsinki', weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type) => parts.find((part) => part.type === type).value
  return `${get('weekday')} ${get('day')}.${get('month')} ${get('hour')}:${get('minute')}`
}

async function muster(method, path, payload) {
  try {
    const data = await request({
      method,
      url: CHAIN + path,
      body: payload,
      json: true,
      headers: { Accept: 'application/json' },
    })
    return { status: 200, data: data ?? null }
  } catch (error) {
    return { status: error.statusCode || error.httpCode || 500, data: error.response?.body || error.message || String(error) }
  }
}

function languageName(value) {
  const code = String(value || 'fi').toLowerCase()
  if (code.startsWith('en') || code === 'englanti') return 'English'
  if (code.startsWith('sv') || code === 'ruotsi') return 'Swedish'
  return 'Finnish'
}

function customerBody(fields, stationId) {
  const name = String(fields.name || 'Wasup Testi').trim()
  const bits = name.split(/\s+/)
  return {
    firstName: bits[0] || 'Wasup',
    lastName: bits.slice(1).join(' ') || 'Testi',
    email: fields.email || null,
    phoneNumber: null,
    receiveSms: false,
    receiveEmail: false,
    language: languageName(fields.language),
    plateNumber: String(fields.rek || fields.plate || '').toUpperCase(),
    stationId,
  }
}

function parseSlot(value) {
  const [time, station, product] = String(value || '').split('|')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(time || '')) return null
  return { time, stationId: Number(station || 256), productIds: [Number(product || 2246)] }
}

async function slots() {
  const from = body.date_from || new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const to = body.date_to || from
  const stationId = Number(body.station_id || body.stationId || 256)
  const products = Array.isArray(body.productIds) && body.productIds.length ? body.productIds.map(Number) : [2246]
  const start = new Date(`${from}T00:00:00${helsinkiOffset(from)}`)
  const end = new Date(`${to}T00:00:00${helsinkiOffset(to)}`)
  end.setUTCDate(end.getUTCDate() + 1)
  if ((end - start) / 86400000 > 60) return { ok: false, error: 'Date range is longer than 60 days.' }
  const query = `/Calendar/${stationId}?StartDate=${start.toISOString()}&EndDate=${end.toISOString()}&VehicleCategory=M1` + products.map((id) => `&ProductIds=${id}`).join('')
  const response = await muster('GET', query)
  if (response.status !== 200 || !Array.isArray(response.data)) return { ok: false, step: 'calendar', status: response.status, error: response.data }
  const available = []
  for (const day of response.data) {
    for (const hour of Object.values(day.hours || {})) {
      for (const slot of hour) {
        if (!slot.isAvailable) continue
        available.push({
          slot_id: `${slot.time}|${stationId}|${products[0]}`,
          time: slot.time,
          display_fi: showHelsinki(slot.time),
          station_id: stationId,
          station_name: STATIONS[stationId] || String(stationId),
          price: slot.onlineReservationPrice,
          end: slot.bookingEndTime,
        })
      }
    }
  }
  return { ok: true, station_id: stationId, slots: available.slice(0, body.full ? 400 : 24), total: available.length }
}

async function book() {
  const slot = parseSlot(body.start_time || body.slot_id)
  if (!slot) return { ok: false, error: 'start_time must be an exact slot_id from get_slots.' }
  if (!body.phone) return { ok: false, error: 'phone is required' }
  const plate = String(body.rek || body.plate || '').trim().toUpperCase()
  if (!plate) return { ok: false, error: 'plate is required' }
  const time = slot.time.replace('Z', '.000Z')
  const held = await muster('POST', '/PendingReservations', {
    time, stationId: slot.stationId, productIds: slot.productIds, plateNumber: plate, vehicleCategory: 'M1', groupId: null,
  })
  if (held.status !== 200) return { ok: false, step: 'hold', status: held.status, error: held.data }
  const customer = await muster('POST', '/B2CCustomer', customerBody(body, slot.stationId))
  if (customer.status !== 200) return { ok: false, step: 'customer', status: customer.status, error: customer.data, groupId: held.data.groupId }
  const reserved = await muster('POST', '/Reservations', {
    groupId: held.data.groupId,
    reservations: [{ pendingReservationUid: held.data.reservationUid, plateNumber: plate, vehicleCategory: 'M1', productIds: slot.productIds }],
    b2CCustomerUid: customer.data.uid,
    language: languageName(body.language),
    externalPriceId: null,
  })
  if (reserved.status !== 200) return { ok: false, step: 'reserve', status: reserved.status, error: reserved.data, groupId: held.data.groupId }
  const confirmed = await muster('POST', '/Reservations/confirm', {
    groupId: held.data.groupId,
    reservations: [{ pendingReservationUid: held.data.reservationUid }],
    sendConfirmation: false,
  })
  if (confirmed.status !== 200) {
    await muster('DELETE', `/PendingReservations/${held.data.groupId}`)
    return { ok: false, step: 'confirm', status: confirmed.status, error: confirmed.data }
  }
  const info = reserved.data.reservations[0]
  return {
    ok: true,
    success: true,
    booking_number: info.bookingNumber,
    event_id: `${held.data.groupId}|${info.uid}|${customer.data.uid}`,
    group_id: held.data.groupId,
    reservation_uid: info.uid,
    customer_uid: customer.data.uid,
    slot_id: body.start_time,
    display_fi: showHelsinki(slot.time),
    station_id: slot.stationId,
    station_name: STATIONS[slot.stationId] || String(slot.stationId),
    plate,
    record: {
      p_tenant_key: 'k1_katsastus_demo',
      p_phone: String(body.phone),
      p_plate: plate,
      p_station_id: slot.stationId,
      p_station_name: STATIONS[slot.stationId] || '',
      p_product_ids: slot.productIds,
      p_group_id: held.data.groupId,
      p_reservation_uid: info.uid,
      p_booking_number: info.bookingNumber,
      p_customer_uid: customer.data.uid,
      p_starts_at: slot.time,
      p_ends_at: held.data.reservationEndDateTime,
      p_status: 'confirmed',
      p_language: languageName(body.language),
    },
  }
}

async function moveBooking() {
  const slot = parseSlot(body.start_time || body.slot_id)
  const [groupId, reservationUid, customerUid] = String(body.event_id || '').split('|')
  if (!slot || !groupId || !reservationUid || !customerUid) return { ok: false, error: 'reschedule needs a new slot_id and the event_id from the booking' }
  const plate = String(body.rek || body.plate || '').trim().toUpperCase()
  const time = slot.time.replace('Z', '.000Z')
  const held = await muster('POST', '/PendingReservations', {
    time, stationId: slot.stationId, productIds: slot.productIds, plateNumber: plate, vehicleCategory: 'M1', groupId,
  })
  if (held.status !== 200) return { ok: false, step: 'hold', status: held.status, error: held.data }
  await muster('PUT', `/B2CCustomer/${customerUid}`, customerBody(body, slot.stationId))
  const reserved = await muster('POST', '/Reservations', {
    groupId: held.data.groupId,
    reservations: [{
      pendingReservationUid: held.data.reservationUid,
      originalReservationUid: reservationUid,
      plateNumber: plate,
      vehicleCategory: 'M1',
      productIds: slot.productIds,
    }],
    b2CCustomerUid: customerUid,
    language: languageName(body.language),
    externalPriceId: null,
  })
  if (reserved.status !== 200) return { ok: false, step: 'reserve', status: reserved.status, error: reserved.data }
  const confirmed = await muster('POST', '/Reservations/confirm', {
    groupId: held.data.groupId,
    reservations: [{ pendingReservationUid: held.data.reservationUid, originalReservationUid: reservationUid }],
    sendConfirmation: false,
  })
  if (confirmed.status !== 200) return { ok: false, step: 'confirm', status: confirmed.status, error: confirmed.data }
  const info = reserved.data.reservations[0]
  return {
    ok: true,
    success: true,
    booking_number: info.bookingNumber,
    event_id: `${held.data.groupId}|${info.uid}|${customerUid}`,
    group_id: held.data.groupId,
    display_fi: showHelsinki(slot.time),
    previous_reservation_uid: reservationUid,
    record: {
      p_tenant_key: 'k1_katsastus_demo',
      p_phone: String(body.phone),
      p_plate: plate,
      p_station_id: slot.stationId,
      p_station_name: STATIONS[slot.stationId] || '',
      p_product_ids: slot.productIds,
      p_group_id: held.data.groupId,
      p_reservation_uid: info.uid,
      p_booking_number: info.bookingNumber,
      p_customer_uid: customerUid,
      p_starts_at: slot.time,
      p_ends_at: held.data.reservationEndDateTime,
      p_status: 'confirmed',
      p_language: languageName(body.language),
    },
  }
}

async function cancel() {
  const groupId = String(body.event_id || body.group_id || '').split('|')[0]
  if (!groupId) return { ok: false, error: 'cancel needs the event_id from the booking' }
  const response = await muster('DELETE', `/Reservations/${groupId}?sendConfirmation=false`)
  if (response.status !== 200 && response.status !== 204) return { ok: false, step: 'cancel', status: response.status, error: response.data }
  return { ok: true, success: true, already_cancelled: response.status === 204, group_id: groupId, cancelLocal: true }
}

let result
if (action === 'get_slots' || action === 'slots') result = await slots()
else if (action === 'stations') {
  const response = await muster('GET', '/Stations')
  result = response.status === 200 ? { ok: true, stations: response.data.map((station) => ({ id: station.id, name: station.name, address: station.streetAddress, city: station.city })) } : { ok: false, error: response.data }
} else if (action === 'products') {
  const stationId = Number(body.station_id || body.stationId || 256)
  const response = await muster('GET', `/Products/${stationId}?vehicleCategory=M1`)
  result = response.status === 200 ? { ok: true, products: response.data.map((product) => ({ id: product.id, type: product.productType, name: product.name })) } : { ok: false, error: response.data }
} else if (action === 'book') result = await book()
else if (action === 'reschedule') result = await moveBooking()
else if (action === 'cancel') result = await cancel()
else if (action === 'find') {
  const path = body.group_id ? `/Reservations/${body.group_id}` : `/Reservations/search/${encodeURIComponent(body.booking_number)}?customerLastname=${encodeURIComponent(body.last_name || '')}`
  const response = await muster('GET', path)
  result = { ok: response.status === 200, status: response.status, booking: response.data }
} else result = { ok: false, error: `unknown action ${action}` }

if (!result.ok && result.groupId && result.step && result.step !== 'confirm') {
  await muster('DELETE', `/PendingReservations/${result.groupId}`)
}

return [{ json: { ...result, source: body.source || 'tool' } }]
