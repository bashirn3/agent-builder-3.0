// Offline checks for the K1 Muster Code node (design/k1-fresh/tools/k1-muster-v2.js).
// Every HTTP call is mocked; nothing here touches Muster, the K1 site or n8n.
import fs from 'node:fs'
import assert from 'node:assert/strict'

const root = new URL('../', import.meta.url)
const source = fs.readFileSync(new URL('design/k1-fresh/tools/k1-muster-v2.js', root), 'utf8')
const directory = fs.readFileSync(new URL('design/k1-fresh/data/k1-directory.json', root), 'utf8')
const code = source.replace('const DIRECTORY = __DIRECTORY__', `const DIRECTORY = ${directory}`)
assert.ok(!code.includes('__DIRECTORY__'), 'directory placeholder was not replaced')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const node = new AsyncFunction('$input', '$getWorkflowStaticData', code)

const NOW = '2026-09-29T08:00:00Z'
const product = (id, productType, en, fi) => ({ id, productType, name: { en, fi: fi || en, sv: en } })
const STAGING_PRODUCTS = [
  product(2246, 'Inspection', 'Periodic inspection, car max. 3500 kg'),
  product(2247, 'Inspection', 'Periodic inspection, EV max. 3500 kg'),
  product(2254, 'Measurement', 'Statutory measuring, max 3500 kg'),
  product(2255, 'Measurement', 'Statutory measuring, over 3500 kg'),
]
const PROD_PRODUCTS = [...STAGING_PRODUCTS, product(38, 'Inspection', 'Periodic inspection, M1, big max. 3500 kg')]

function pageHtml(open = '09:00', close = '17:00') {
  const days = ['29.9.2026', '30.9.2026', '1.10.2026', '2.10.2026', '5.10.2026', '6.10.2026', '7.10.2026']
  const rows = days.map((d) => `<tr class=mb-2><td class=has-text-weight-bold>\n${d}\n</td><td class="">Ti</td><td>${open}-${close}</td></tr>`).join('\n')
  return `<section class=station-opening-hours id=opening-hours><h3>K1 Katsastus</h3><table>${rows}</table></section>
  <div role=dialog id=js-bulmally-modal-prices><section class=section>
   <div class=row><div class=c>Määräaikaiskatsastus (auto max. 3500 kg, nelipyörä): Drive-in (hinnat alk.)</div><div class=c>48 €</div></div>
   <div class=row><div class=c>Lakisääteiset mittaukset (max. 3500 kg)</div><div class=c>24 €</div></div>
   <div class=row><div class=c>Määräaikaiskatsastus (sähköauto tai -nelipyörä max. 3500 kg)</div><div class=c>72 €</div></div>
  </section></div>`
}
const slot = (iso, endIso) => ({ time: iso, bookingEndTime: endIso, isAvailable: true, onlineReservationPrice: 76 })
function calendar() {
  const times = ['2026-09-30T05:00:00Z', '2026-09-30T07:00:00Z', '2026-09-30T09:00:00Z', '2026-09-30T13:00:00Z', '2026-09-30T14:30:00Z']
  const hours = {}
  for (const t of times) {
    const end = new Date(new Date(t).getTime() + 30 * 60000).toISOString()
    ;(hours[t.slice(11, 13)] = hours[t.slice(11, 13)] || []).push(slot(t, end))
  }
  return [{ date: '2026-09-30', hours }]
}

function makeRun(overrides = {}) {
  const calls = []
  const rawRequest = async (options) => {
    calls.push({ method: options.method, url: options.url, body: options.body })
    const { method, url } = options
    if (overrides.handler) {
      const custom = await overrides.handler(options)
      if (custom !== undefined) return custom
    }
    const fail = (status) => Object.assign(new Error(`HTTP ${status}`), { statusCode: status })
    if (url.startsWith('https://www.k1katsastus.fi/asema/')) return pageHtml()
    if (url.endsWith('/v3/91/Stations')) return [{ id: 256, name: 'K1 Katsastus Jyväskylä Palokka' }, { id: 241, name: 'K1 Katsastus Turku Itäharju' }, { id: 5, name: 'A-Katsastus Somewhere' }]
    if (url.includes('/v3/91/Products/') && url.includes('/prices')) return [{ productId: 2246, onlineReservationPrice: 46 }, { productId: 2254, onlineReservationPrice: 30 }]
    if (url.includes('/v3/91/Products/')) return STAGING_PRODUCTS
    if (url.includes('/v3/91/Calendar/')) return calendar()
    if (url.includes('/v3/5/Products/') && url.includes('/prices')) return [{ productId: 22, onlineReservationPrice: 48 }, { productId: 13, onlineReservationPrice: 24 }]
    if (url.includes('/v3/5/Products/')) return PROD_PRODUCTS
    if (url.includes('/v3/5/Calendar/')) return calendar()
    if (url.endsWith('/PendingReservations') && method === 'POST') return { groupId: 'g1', reservationUid: 'r1', reservationEndDateTime: '2026-09-30T07:30:00Z' }
    if (url.endsWith('/B2CCustomer')) return { uid: 'c1' }
    if (url.endsWith('/Reservations') && method === 'POST') return { reservations: [{ uid: 'u1', bookingNumber: 'B-1' }] }
    if (url.endsWith('/Reservations/confirm')) return {}
    throw fail(404)
  }
  const httpRequest = async (options) => {
    if (!options.returnFullResponse) return rawRequest(options)
    try {
      return { statusCode: 200, body: await rawRequest(options) }
    } catch (error) {
      if (options.ignoreHttpStatusErrors && error.statusCode) return { statusCode: error.statusCode, body: error.body }
      throw error
    }
  }
  return async (body) => {
    const input = { first: () => ({ json: { now: NOW, ...body } }) }
    const out = await node.call({ helpers: { httpRequest } }, input, () => ({ k1_cache: {} }))
    return { result: out[0].json, calls }
  }
}

const cases = []
const test = (name, fn) => cases.push([name, fn])
const PALOKKA = 'K1 Katsastus Jyväskylä Palokka'

test('station_info: default is the lead station, hours come from the live page, times sit inside them', async () => {
  const { result } = await makeRun()({ action: 'station_info', lead_station: PALOKKA, lead_product: '004', date: '2026-09-30' })
  assert.equal(result.ok, true)
  assert.equal(result.station.name, PALOKKA)
  assert.equal(result.station.is_lead_station, true)
  assert.equal(result.hours.display, '09:00-17:00')
  assert.equal(result.booking.assistant_can_book, true)
  const day = result.availability[0]
  assert.deepEqual(day.suggestions.map((s) => s.time), ['10:00', '12:00', '16:00'])
  for (const s of day.suggestions) assert.ok(s.time >= '09:00' && s.time < '17:00', `time ${s.time} outside hours`)
  assert.equal(result.price.total_eur, 76)
})

test('station_info: another station on request; lead station is not forced', async () => {
  const { result } = await makeRun()({ action: 'station_info', station: 'Turku Itäharju', lead_station: PALOKKA })
  assert.equal(result.station.name, 'K1 Katsastus Turku Itäharju')
  assert.equal(result.station.is_lead_station, undefined)
})

test('station_info: city with several stations asks, unless the lead station is one of them', async () => {
  const run = makeRun()
  const ambiguous = (await run({ action: 'station_info', station: 'Tampere' })).result
  assert.equal(ambiguous.ambiguous, true)
  assert.ok(ambiguous.candidates.length >= 3)
  const preferred = (await run({ action: 'station_info', station: 'Turku', lead_station: 'K1 Katsastus Turku Itäharju' })).result
  assert.equal(preferred.ok, true)
  assert.equal(preferred.station.name, 'K1 Katsastus Turku Itäharju')
  assert.ok(preferred.also_matches.includes('K1 Katsastus Turku Vätti'))
  assert.ok(!preferred.also_matches.some((n) => /Oriketo/.test(n)), 'heavy-vehicle station must not be offered as an alternative')
})

test('station_info: a station that is not bookable here gives hours and the official link, never a booking', async () => {
  const { result } = await makeRun()({ action: 'station_info', station: 'Tampere Sarankulma', product: '004' })
  assert.equal(result.ok, true)
  assert.equal(result.booking.assistant_can_book, false)
  assert.match(result.booking.official_booking_link, /stationId=1452/)
  assert.equal(result.hours.display, '09:00-17:00')
  assert.equal(result.price.total_eur, 76)
  assert.equal(result.price_estimate_for_this_vehicle, undefined, 'one price per answer')
})

test('station_info: with no bookable time the station page gives an approximate "from" price', async () => {
  const run = makeRun({ handler: (o) => (o.url.includes('/Calendar/') ? [] : undefined) })
  const { result } = await run({ action: 'station_info', station: 'Tampere Sarankulma', product: '004' })
  assert.ok(!result.price)
  assert.equal(result.price_estimate_for_this_vehicle.total_from_eur, 72)
  assert.match(result.price_estimate_for_this_vehicle.note, /from/)
})

test('station_info: closed stations are flagged and suggest open ones in the same city', async () => {
  const { result } = await makeRun()({ action: 'station_info', station: 'Raisio Hauninen' })
  assert.equal(result.station_closed, true)
})

test('station_info: unknown station and missing lead station', async () => {
  const run = makeRun()
  assert.equal((await run({ action: 'station_info', station: 'Atlantis' })).result.not_found, true)
  assert.equal((await run({ action: 'station_info' })).result.unknown_lead_station, true)
})

test('get_slots: drops times outside opening hours and keeps slot ids for bookable stations', async () => {
  const { result } = await makeRun()({ action: 'get_slots', station: PALOKKA, product: '004', date_from: '2026-09-30' })
  assert.equal(result.ok, true)
  const day = result.days[0]
  assert.equal(day.station_hours, '09:00-17:00')
  assert.deepEqual(day.all_times.map((t) => t.time), ['10:00', '12:00', '16:00'])
  assert.equal(day.first, '10:00')
  assert.ok(day.all_times.every((t) => t.slot_id.includes('|256|2246+2254|M1')))
  assert.equal(result.price.total_eur, 76)
  assert.deepEqual(result.vehicle.includes.length, 2)
})

test('get_slots: weekends and holidays not on the page are closed', async () => {
  const { result } = await makeRun()({ action: 'get_slots', station: PALOKKA, product: '004', date_from: '2026-10-03', date_to: '2026-10-03' })
  assert.equal(result.days[0].station_hours, 'closed')
  assert.equal(result.days[0].free_count, 0)
})

test('get_slots: readable-only stations return times without slot ids and the booking link', async () => {
  const { result } = await makeRun()({ action: 'get_slots', station: 'Tampere Sarankulma', product: '004', date_from: '2026-09-30' })
  assert.equal(result.bookable_by_assistant, false)
  assert.ok(result.days[0].all_times.every((t) => t.slot_id === undefined))
  assert.match(result.booking_url, /stationId=1452/)
})

test('products: 004 adds statutory measuring, 004e does not', async () => {
  const run = makeRun()
  const combustion = (await run({ action: 'get_slots', station: PALOKKA, product: '004', date_from: '2026-09-30' })).result
  assert.deepEqual(combustion.days[0].all_times[0].slot_id.split('|')[2], '2246+2254')
  const electric = (await run({ action: 'get_slots', station: PALOKKA, product: '004e', date_from: '2026-09-30' })).result
  assert.equal(electric.days[0].all_times[0].slot_id.split('|')[2], '2247')
  assert.equal(electric.vehicle.includes.length, 1)
})

test('products: 0040 is refused where the station has no such product, and works where it has', async () => {
  const staging = (await makeRun()({ action: 'get_slots', station: PALOKKA, product: '0040', date_from: '2026-09-30' })).result
  assert.equal(staging.unsupported, true)
  assert.match(staging.booking_url, /stationId=1465/)
  const prod = (await makeRun()({ action: 'get_slots', station: 'Tampere Sarankulma', product: '0040', date_from: '2026-09-30' })).result
  assert.equal(prod.ok, true)
  assert.equal(prod.vehicle.includes.length, 2)
})

test('products: unknown vehicle asks one question; free-text product words are understood', async () => {
  const run = makeRun()
  const unknown = (await run({ action: 'get_slots', station: PALOKKA, date_from: '2026-09-30' })).result
  assert.equal(unknown.needs_product, true)
  assert.match(unknown.error, /petrol\/diesel\/hybrid or fully electric/)
  const words = (await run({ action: 'get_slots', station: PALOKKA, product: 'electric car', date_from: '2026-09-30' })).result
  assert.equal(words.vehicle.product, '004e')
})

test('products: the lead product and category are the defaults', async () => {
  const { result } = await makeRun()({ action: 'get_slots', station: PALOKKA, lead_product: '004e', lead_vehicle_category: 'N1', date_from: '2026-09-30' })
  assert.equal(result.vehicle.product, '004e')
  assert.equal(result.vehicle.category, 'N1')
})

test('products: categories the assistant cannot handle are redirected', async () => {
  const { result } = await makeRun()({ action: 'get_slots', station: PALOKKA, product: '004', vehicle_category: 'O2', date_from: '2026-09-30' })
  assert.equal(result.unsupported, true)
})

test('book: sends every product and the vehicle category, and returns a record', async () => {
  const run = makeRun()
  const slots = (await run({ action: 'get_slots', station: PALOKKA, product: '004', vehicle_category: 'N1', date_from: '2026-09-30' })).result
  const id = slots.days[0].all_times[0].slot_id
  const { result, calls } = await run({ action: 'book', start_time: id, phone: '+358401234567', rek: 'abc-123', name: 'Test Person', language: 'fi' })
  assert.equal(result.ok, true)
  const pending = calls.find((c) => c.url.endsWith('/PendingReservations') && c.method === 'POST')
  assert.deepEqual(pending.body.productIds, [2246, 2254])
  assert.equal(pending.body.vehicleCategory, 'N1')
  assert.equal(pending.body.stationId, 256)
  assert.deepEqual(result.record.p_product_ids, [2246, 2254])
  assert.ok(calls.every((c) => c.method === 'GET' || c.url.includes('staging-booking-api')), 'writes must only go to staging')
})

test('book: refuses times outside the opening hours and stations that are not bookable', async () => {
  const run = makeRun()
  const early = await run({ action: 'book', start_time: '2026-09-30T05:00:00Z|256|2246+2254|M1', phone: '1', rek: 'ABC-123', name: 'Test Person' })
  assert.equal(early.result.ok, false)
  assert.match(early.result.error, /outside the station opening hours/)
  const foreign = await run({ action: 'book', start_time: '2026-09-30T07:00:00Z|1452|22+13|M1', phone: '1', rek: 'ABC-123', name: 'Test Person' })
  assert.equal(foreign.result.ok, false)
  assert.equal(foreign.calls.filter((c) => c.method !== 'GET').length, 0)
})

test('book: a slot that was just taken is reported as slot_unavailable and nothing else is written', async () => {
  const taken = (o) => {
    if (o.url.endsWith('/PendingReservations') && o.method === 'POST') throw Object.assign(new Error('HTTP 400'), { statusCode: 400, body: { error: 'No resource for slot (#stationId 256)', type: 'ArgumentException' } })
  }
  const { result, calls } = await makeRun({ handler: taken })({ action: 'book', start_time: '2026-09-30T07:00:00Z|256|2246+2254|M1', phone: '1', rek: 'ABC-123', name: 'Test Person' })
  assert.equal(result.ok, false)
  assert.equal(result.slot_unavailable, true)
  assert.match(result.error, /get_slots again/)
  assert.equal(calls.filter((c) => c.method !== 'GET' && !c.url.endsWith('/PendingReservations')).length, 0)
})

test('hours page unreadable: hours are reported as unverified, nothing is invented', async () => {
  const run = makeRun({ handler: (o) => { if (o.url.startsWith('https://www.k1katsastus.fi')) throw Object.assign(new Error('down'), { statusCode: 503 }) } })
  const { result } = await run({ action: 'station_info', station: PALOKKA, product: '004' })
  assert.equal(result.hours.status, 'unknown')
  assert.match(result.hours.note, /could not be read/)
})

test('book: names and plates are sanitised before they reach Muster; garbage plates are refused', async () => {
  const run = makeRun()
  const id = '2026-09-30T07:00:00Z|256|2246+2254|M1'
  const ok = await run({ action: 'book', start_time: id, phone: '1', rek: "abc-123'; DROP TABLE x;--", name: '<script>alert(1)</script> Bob' })
  const customer = ok.calls.find((c) => c.url.endsWith('/B2CCustomer'))
  const pending = ok.calls.find((c) => c.url.endsWith('/PendingReservations'))
  assert.equal(customer.body.firstName, 'alert')
  assert.ok(!/[<>;'()]/.test(JSON.stringify([customer.body, pending.body])))
  const bad = await makeRun()({ action: 'book', start_time: id, phone: '1', rek: "';--", name: 'Bob' })
  assert.equal(bad.result.ok, false)
  assert.equal(bad.calls.filter((c) => c.method !== 'GET').length, 0)
  const nameless = await run({ action: 'book', start_time: id, phone: '1', rek: 'ABC-123', name: '<>' })
  assert.equal(nameless.result.ok, false)
})

test('station names: Swedish exonyms and Finnish inflections resolve', async () => {
  const run = makeRun()
  for (const [query, name] of [['Åbo Itäharju', 'K1 Katsastus Turku Itäharju'], ['Jyväskylän Palokka', 'K1 Katsastus Jyväskylä Palokka'], ['Turun Itäharju', 'K1 Katsastus Turku Itäharju']]) {
    const { result } = await run({ action: 'station_info', station: query, lead_station: PALOKKA })
    assert.equal(result.station?.name, name, query)
  }
})

test('legacy single-product slot ids still parse', async () => {
  const { result } = await makeRun()({ action: 'book', start_time: '2026-09-30T07:00:00Z|256|2246|M1', phone: '1', rek: 'ABC-123', name: 'Test Person' })
  assert.equal(result.ok, true)
})

let failed = 0
for (const [name, fn] of cases) {
  try { await fn(); console.log(`ok   ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}\n     ${error.message}`) }
}
if (failed) { console.error(`${failed} of ${cases.length} failed`); process.exit(1) }
console.log(`${cases.length} K1 Muster checks passed`)
