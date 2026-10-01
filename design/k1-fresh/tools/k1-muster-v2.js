// K1 Katsastus: Muster booking + live station directory.
// n8n Code node body (runOnceForAllItems). Called by the agent tools and the builder webhook.
// The DIRECTORY placeholder below is filled by k1-agent-v2-build.py from design/k1-fresh/data/k1-directory.json.
//
// Two Muster systems, deliberately separated:
//   staging    (chain 91): the only place a booking is ever created, changed or cancelled.
//   production (chain 5):  read-only calendar/products/prices, used to describe stations that are not bookable here yet.
const STAGING = 'https://staging-booking-api.muster.fi/v3/91'
// Staging calls go through a random proxy from this pool (filled in at build time; an empty pool means direct).
// Mode 'fallback' (default): the n8n server IP is whitelisted at Muster, so the first attempt goes direct and a proxy is only used when a retry is needed.
// Mode 'always': every staging call goes through a proxy.
const STAGING_PROXY_MODE = __STAGING_PROXY_MODE__
const STAGING_PROXIES = __STAGING_PROXIES__
let lastProxy = null
const pickProxy = () => {
  const pool = STAGING_PROXIES.length > 1 ? STAGING_PROXIES.filter((proxy) => proxy !== lastProxy) : STAGING_PROXIES
  lastProxy = pool[Math.floor(Math.random() * pool.length)]
  return lastProxy
}
const request = (options, attempt = 0) => this.helpers.httpRequest.call(this, STAGING_PROXIES.length && String(options.url).startsWith(STAGING) && (STAGING_PROXY_MODE === 'always' || attempt > 0) ? { ...options, proxy: pickProxy() } : options)
const PROD = 'https://a-katsastus-booking-api.muster.fi/v3/5'
const BOOKING_SITE = 'https://ajanvaraus.k1katsastus.fi'
const NATIONAL_PHONE = '0306 100 100'
const DIRECTORY = __DIRECTORY__
const input = $input.first().json
const body = input.body && input.body.action ? input.body : input
const action = String(body.action || '')

const HOUR = 3600 * 1000
const store = (() => {
  try {
    const data = $getWorkflowStaticData('global')
    data.k1_cache = data.k1_cache || {}
    for (const [key, hit] of Object.entries(data.k1_cache)) if (!hit || Date.now() - hit.at > 24 * HOUR) delete data.k1_cache[key]
    return data.k1_cache
  } catch (error) { return {} }
})()
async function cached(key, ttl, load) {
  const hit = store[key]
  if (hit && Date.now() - hit.at < ttl) return hit.value
  const value = await load()
  if (value !== null && value !== undefined) store[key] = { at: Date.now(), value }
  else if (hit) return hit.value
  return value
}

const nowDate = () => (body.now ? new Date(body.now) : new Date())
const HEL = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
function helsinki(date) {
  const p = Object.fromEntries(HEL.formatToParts(date).map((part) => [part.type, part.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, weekday: p.weekday }
}
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
const addDays = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const weekdayOf = (day) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${day}T12:00:00Z`).getUTCDay()]
const fiDate = (day) => { const [, m, d] = day.split('-'); return `${Number(d)}.${Number(m)}.` }
const dayLabel = (day) => `${weekdayOf(day)} ${fiDate(day)}`
function helsinkiOffset(day) {
  const year = Number(day.slice(0, 4))
  const lastSunday = (monthIndex) => { const d = new Date(Date.UTC(year, monthIndex + 1, 0)); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d }
  const current = new Date(`${day}T12:00:00Z`)
  return current >= lastSunday(2) && current < lastSunday(9) ? '+03:00' : '+02:00'
}
const minutes = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// 429 means Muster rejected the request unprocessed, so retrying is safe for every method. Gateway errors are only retried for reads.
async function muster(method, path, payload, base = STAGING) {
  if (base !== STAGING && method !== 'GET') return { status: 405, data: 'Production is read-only.' }
  let last = { status: 500, data: null }
  for (let attempt = 0; attempt < 4; attempt++) {
    let retryAfter = 0
    try {
      const response = await request({ method, url: base + path, body: payload, json: true, headers: { Accept: 'application/json' }, timeout: 25000, returnFullResponse: true, ignoreHttpStatusErrors: true }, attempt)
      const code = Number(response.statusCode || response.status || 200)
      if (code >= 200 && code < 300) return { status: 200, data: response.body ?? null }
      last = { status: code, data: response.body ?? null }
      retryAfter = Number((response.headers || {})['retry-after'] || 0)
    } catch (error) {
      last = { status: error.statusCode || error.httpCode || error.status || 500, data: error.response?.body || error.message || String(error) }
      const code = String(error.code || (error.cause && error.cause.code) || '')
      // The proxy could not be reached or refused us, so Muster never saw the request: safe to retry with another proxy for any method.
      if (!error.statusCode && /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN/.test(code)) last.unsent = true
      else if (!error.statusCode && /ETIMEDOUT|ECONNRESET|ECONNABORTED|EPIPE|socket hang up/i.test(code + ' ' + (error.message || ''))) last.transient = true
    }
    const retryable = last.status === 429 || last.unsent || (method === 'GET' && (last.transient || [502, 503, 504].includes(last.status))) || (STAGING_PROXIES.length > 0 && (last.status === 407 || (last.status === 403 && STAGING_PROXY_MODE !== 'always')))
    if (!retryable || attempt === 3) return last
    await sleep(last.unsent || last.status === 407 ? 100 : Math.min(5000, Math.max(retryAfter * 1000, 800 * 2 ** attempt)))
  }
  return last
}
const languageName = (value) => {
  const code = String(value || 'fi').toLowerCase()
  if (code.startsWith('en') || code === 'englanti') return 'English'
  if (code.startsWith('sv') || code === 'ruotsi') return 'Swedish'
  return 'Finnish'
}

// ---------- Station directory ----------
const fold = (text) => String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const bare = (text) => fold(text).replace(/^suljettu /, '').replace(/^k1 katsastus /, '').replace(/^k1 /, '').trim()

async function stagingStations() {
  const list = await cached('staging:stations', HOUR, async () => {
    const response = await muster('GET', '/Stations')
    return response.status === 200 && Array.isArray(response.data) ? response.data : null
  })
  const byName = {}
  for (const station of list || []) if (/^K1\b/i.test(station.name)) byName[bare(station.name)] = station
  return byName
}
async function directory() {
  const known = await stagingStations()
  return DIRECTORY.map((entry) => {
    const match = known[bare(entry.name)]
    return match ? { ...entry, muster_id: match.id, muster_phone: match.phoneNumber || null } : { ...entry, muster_id: null }
  })
}
function sourceOf(entry) {
  if (entry.muster_id) return { base: STAGING, id: entry.muster_id, bookable: true }
  if (entry.k1_id && !entry.closed) return { base: PROD, id: entry.k1_id, bookable: false }
  return null
}
const bookingLink = (entry) => (entry.k1_id ? `${BOOKING_SITE}/?stationId=${entry.k1_id}&serviceId=1` : null)

const EXONYMS = {
  uleaborg: 'oulu', abo: 'turku', tammerfors: 'tampere', helsingfors: 'helsinki', bjorneborg: 'pori', vasa: 'vaasa', villmanstrand: 'lappeenranta', kajana: 'kajaani',
  karleby: 'kokkola', borga: 'porvoo', lahtis: 'lahti', tavastehus: 'hameenlinna', vanda: 'vantaa', esbo: 'espoo', 'sankt michel': 'mikkeli', nystad: 'uusikaupunki',
  tornea: 'tornio', jakobstad: 'pietarsaari', lovisa: 'loviisa', hango: 'hanko', ekenas: 'tammisaari', lojo: 'lohja', jyvaskyla: 'jyvaskyla', 'st michel': 'mikkeli', gamlakarleby: 'kokkola',
}
function candidatesFor(entries, query) {
  let q = bare(query)
  for (const [from, to] of Object.entries(EXONYMS)) q = q.replace(new RegExp(`\\b${from}\\b`, 'g'), to)
  if (!q) return []
  const exact = entries.filter((e) => bare(e.name) === q || (e.aliases || []).some((a) => bare(a) === q) || fold(e.slug) === q)
  if (exact.length) return exact
  const tokens = q.split(' ').filter((t) => t.length >= 2)
  const wordsOf = (e) => `${bare(e.name)} ${fold(e.city)} ${(e.aliases || []).map(bare).join(' ')}`.split(' ')
  const hit = (words, t) => words.some((w) => w === t || (t.length >= 4 && w.startsWith(t)) || (w.length >= 4 && t.length > w.length && t.startsWith(w) && t.length - w.length <= 3))
  const strict = entries.filter((e) => tokens.every((t) => hit(wordsOf(e), t)))
  if (strict.length) return strict
  // An inflected city ("Turun Itäharju") can fail the strict test while another word names exactly one station.
  const distinctive = tokens.filter((t) => t.length >= 5 && entries.filter((e) => hit(wordsOf(e), t)).length === 1)
  if (distinctive.length) return entries.filter((e) => distinctive.every((t) => hit(wordsOf(e), t)))
  return []
}
// query: what the customer asked about ('' = their own station); prefer: the lead's station (name or id).
async function resolveStation(query, prefer) {
  const entries = await directory()
  const text = String(query ?? '').trim()
  const fallback = String(prefer ?? '').trim()
  const asId = (value) => {
    if (!/^\d+$/.test(String(value))) return null
    return entries.find((e) => String(e.muster_id) === String(value)) || entries.find((e) => String(e.k1_id) === String(value)) || null
  }
  const own = () => asId(fallback) || candidatesFor(entries, fallback)[0] || null
  if (!text) {
    const found = own()
    return found ? { entry: found, default_used: true, entries } : { entry: null, unknown: true, entries }
  }
  const byId = asId(text)
  if (byId) return { entry: byId, entries }
  let found = candidatesFor(entries, text)
  if (found.length > 1) {
    const wantsHeavy = /raskas|heavy|tung/i.test(text)
    const narrowed = found.filter((e) => wantsHeavy || !e.heavy)
    if (narrowed.length) found = narrowed
  }
  if (found.length === 1) return { entry: found[0], entries }
  if (found.length > 1) {
    const mine = own()
    const preferred = mine && found.find((e) => e.slug === mine.slug)
    if (preferred) return { entry: preferred, also_matches: found.filter((e) => e.slug !== preferred.slug && !e.closed), entries }
    const open = found.filter((e) => !e.closed)
    if (open.length === 1) return { entry: open[0], entries }
    return { ambiguous: found, entries }
  }
  return { entry: null, not_found: true, entries }
}
const sameCity = (entries, entry) => entries.filter((e) => e.slug !== entry.slug && !e.closed && !e.heavy && fold(e.city) === fold(entry.city)).map((e) => e.name)

// ---------- Live station page: hours and prices ----------
const strip = (fragment) => String(fragment).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&euro;/g, '€').replace(/\s+/g, ' ').trim()
function parsePage(html) {
  const rows = []
  const hoursBlock = html.match(/id=["']?opening-hours["']?>([\s\S]*?)<\/section>/)
  const first = hoursBlock && hoursBlock[1].match(/<h3>[\s\S]*?<\/h3>\s*<table>([\s\S]*?)<\/table>/)
  if (first) {
    for (const match of first[1].matchAll(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g)) {
      const parts = strip(match[1]).split('.')
      if (parts.length < 3) continue
      const day = `${parts[2].slice(0, 4)}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
      const range = strip(match[3]).match(/(\d{1,2})[:.](\d{2})\s*[-–]\s*(\d{1,2})[:.](\d{2})/)
      rows.push({ date: day, open: range ? `${range[1].padStart(2, '0')}:${range[2]}` : null, close: range ? `${range[3].padStart(2, '0')}:${range[4]}` : null, raw: strip(match[3]) })
    }
  }
  const prices = []
  const modal = html.match(/id=["']?js-bulmally-modal-prices["']?[\s\S]*?<\/section>/)
  if (modal) {
    const text = modal[0].replace(/<\/?(div|p|h2|h3|li|tr|td|button|section)[^>]*>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&euro;/g, '€')
    const items = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
    let group = ''
    for (let i = 0; i < items.length; i++) {
      const line = items[i]
      if (/^(Palvelu|Hinta)$/i.test(line)) { if (/^Palvelu$/i.test(line)) group = ''; continue }
      if (/^(Hinnoittelu|Hinnat|Sulje|Prissättning)/i.test(line)) continue
      const price = items[i + 1] && items[i + 1].match(/^(\d+(?:[.,]\d+)?)\s*€/)
      if (price) { prices.push({ service: group ? `${group}: ${line}` : line, eur: Number(price[1].replace(',', '.')) }); i++ } else group = line
    }
  }
  return { rows, prices: prices.slice(0, 24) }
}
async function stationPage(entry) {
  if (!entry.url) return null
  return cached(`page:${entry.slug}`, 10 * 60 * 1000, async () => {
    try {
      const html = await request({ method: 'GET', url: entry.url, json: false, timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; K1-Agent/2.0)', Accept: 'text/html' } })
      const page = parsePage(String(html))
      return page.rows.length || page.prices.length ? page : null
    } catch (error) { return null }
  })
}
// The published table is rolling and lists open days only. Dates past the table are estimated from the same weekday.
function hoursFor(page, day) {
  if (!page || !page.rows.length) return { status: 'unknown', reason: 'The station page has no published hours right now.' }
  const listed = page.rows.find((r) => r.date === day)
  if (listed) return listed.open ? { status: 'open', open: listed.open, close: listed.close, source: 'station page (this date)' } : { status: 'closed', source: 'station page (this date)', raw: listed.raw }
  const first = page.rows[0].date
  const last = page.rows[page.rows.length - 1].date
  if (day >= first && day <= last) return { status: 'closed', source: 'not listed on the station page (weekend or holiday)' }
  if (day < first) return { status: 'unknown', reason: 'That date is in the past.' }
  const same = page.rows.filter((r) => weekdayOf(r.date) === weekdayOf(day) && r.open)
  if (!same.length) return { status: 'closed', estimated: true, source: 'no opening hours on this weekday in the published table' }
  return { status: 'open', estimated: true, open: same[same.length - 1].open, close: same[same.length - 1].close, source: 'estimated from the same weekday in the published table; exact hours not published yet' }
}
const showHours = (h) => (h.status === 'open' ? `${h.open}-${h.close}` : h.status === 'closed' ? 'closed' : 'unknown')

// ---------- Vehicle and products ----------
// K1's booking site does not look the plate up (vehicleSearchEnabled is false for every K1 station). It asks the
// customer for the vehicle type and picks the service from that. Tomi's reminder codes map onto the same choice:
//   004  petrol/diesel/hybrid car or van up to 3500 kg -> periodic inspection + statutory measuring (0020)
//   0040 camper or larger car (M1 big, up to 3500 kg)  -> M1-big inspection + statutory measuring (0020); not at every station
//   004e fully electric                                -> EV inspection only, no measuring
function normalizeProduct(value) {
  const text = String(value || '').trim().toLowerCase()
  if (['004', '0040', '004e'].includes(text)) return text
  if (/electric|sahk|sähk|elbil|\bev\b/.test(text)) return '004e'
  if (/camper|motorhome|matkailu|husbil|large|heavy|iso |suuri|stor/.test(text)) return '0040'
  if (/petrol|diesel|gasoline|bensa|hybrid|combustion|gas|polttomoottori|bensin|normal|regular|standard/.test(text)) return '004'
  return ''
}
const productName = (p) => [p.name && p.name.en, p.name && p.name.fi, p.name && p.name.sv].filter(Boolean).join(' ')
const shortName = (p) => (p.name && (p.name.en || p.name.fi)) || String(p.id)
function normalizeCategory(value) {
  const text = String(value || '').trim().toUpperCase()
  return /^[A-Z]\d?$/.test(text) ? text : 'M1'
}
const ASSISTANT_CATEGORIES = ['M1', 'N1']
async function stationProducts(src, category) {
  return cached(`products:${src.base}:${src.id}:${category}`, HOUR, async () => {
    const response = await muster('GET', `/Products/${src.id}?vehicleCategory=${category}`, undefined, src.base)
    return response.status === 200 && Array.isArray(response.data) ? response.data : null
  })
}
function planProducts(list, code, category, includeMeasuring = true) {
  const wanted = normalizeProduct(code)
  if (!wanted) return { ok: false, needs_product: true }
  if (!ASSISTANT_CATEGORIES.includes(category)) return { ok: false, code: wanted, unsupported: true, reason: `Vehicle category ${category} (for example a trailer, light four-wheeler or heavier vehicle) cannot be booked here. Use the official K1 booking or the national number.` }
  const inspections = list.filter((p) => p.productType === 'Inspection')
  const measuring = list.find((p) => p.productType === 'Measurement' && /statutory|lakis|lagstadg|mittau|measur|mätning/i.test(productName(p)) && !/over 3500|yli 3500|över 3500/i.test(productName(p)))
  const electric = (p) => /\bEV\b|electric|sähkö|elbil|eldriven/i.test(productName(p))
  const big = (p) => /M1, big|M1, isot|big|isot|stora/i.test(productName(p))
  const car = (p) => /car max\.? ?3500 ?kg|auto max\.? ?3500 ?kg|bil max\.? ?3500/i.test(productName(p)) && !electric(p)
  let main = null
  let assumption = null
  if (wanted === '004') main = inspections.find(car)
  else if (wanted === '004e') {
    main = inspections.find(electric)
    if (!main) { main = inspections.find(car); assumption = 'This station has no separate electric-car inspection product; the standard inspection is used and no measuring product is added.' }
  } else main = inspections.find(big)
  if (!main) return { ok: false, code: wanted, unsupported: true, reason: wanted === '0040' ? 'This station has no product for a camper or larger car (0040). It does not fit every station: use the official K1 booking or the national number.' : 'No matching inspection product at this station.' }
  const ids = [main.id]
  const names = [shortName(main)]
  const combustion = wanted !== '004e'
  const withMeasuring = combustion && includeMeasuring
  if (withMeasuring) {
    if (!measuring) return { ok: false, code: wanted, unsupported: true, reason: 'The statutory measuring product (0020) is missing at this station.' }
    ids.push(measuring.id)
    names.push(shortName(measuring))
  }
  return { ok: true, code: wanted, product_ids: ids, names, needs_measuring: combustion, includes_measuring: withMeasuring, assumption }
}
async function musterPrices(src, ids, time) {
  return cached(`prices:${src.base}:${src.id}:${ids.join('+')}`, HOUR, async () => {
    const query = ids.map((id) => `ProductIds=${id}`).join('&')
    const response = await muster('GET', `/Products/${src.id}/prices?${query}&ReservationTime=${encodeURIComponent(time)}`, undefined, src.base)
    return response.status === 200 && Array.isArray(response.data) ? response.data : null
  })
}
function pageEstimate(prices, code, includeMeasuring = true) {
  const find = (re) => prices.find((p) => re.test(p.service))
  const base = find(/drive-in/i) || find(/määräaikaiskatsastus \(auto max/i)
  const measuring = find(/mittaukset|measurements|mätningar/i)
  const electric = find(/sähkö|electric|elbil/i)
  const large = find(/isot|large|stora/i)
  const parts = []
  if (code === '004e') { if (electric) parts.push(electric) } else if (code === '0040') { if (large) parts.push(large); if (measuring && includeMeasuring) parts.push(measuring) } else if (code === '004') { if (base) parts.push(base); if (measuring && includeMeasuring) parts.push(measuring) }
  if (!parts.length) return null
  return { total_from_eur: parts.reduce((sum, p) => sum + p.eur, 0), parts: parts.map((p) => `${p.service}: from ${p.eur} EUR`), note: 'These are "from" prices from the official station page (drive-in), not the price of a booking. Always say "from" / "alk." / "från" with the amount, for the total too. The final price is confirmed at the station.' }
}
const VEHICLE_QUESTION = 'The vehicle type is unknown. Ask ONE short question: is the car petrol/diesel/hybrid or fully electric (assume a normal passenger car unless they say van or camper)? Then call again with product 004 (petrol/diesel/hybrid), 004e (fully electric) or 0040 (camper or larger car), and vehicle_category M1 (car/camper) or N1 (van).'

// ---------- Availability ----------
const slotId = (time, stationId, ids, category) => `${time}|${stationId}|${ids.join('+')}|${category}`
function parseSlot(value) {
  const [time, station, product, category] = String(value || '').split('|')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(time || '')) return null
  const ids = String(product || '2246').split('+').map(Number).filter(Boolean)
  return { time, stationId: Number(station || 256), productIds: ids.length ? ids : [2246], category: normalizeCategory(category) }
}
function spread(list, count) {
  if (list.length <= count) return list
  return Array.from({ length: count }, (_, i) => list[Math.round((i * (list.length - 1)) / (count - 1))])
}
const leadStation = () => body.lead_station_id || body.lead_station || ''

async function pickStation() {
  const chosen = await resolveStation(body.station || body.station_name || '', leadStation())
  let entry = chosen.entry
  const explicit = body.station_id ?? body.stationId
  if (explicit !== undefined && explicit !== null && String(explicit).trim() !== '') {
    const byId = (await resolveStation(String(explicit), '')).entry
    if (byId) entry = byId
  }
  return { entry, chosen }
}
// Free times that fall inside the station's opening hours, per Helsinki day.
async function freeSlots(entry, src, days, plan, category, hoursByDay) {
  const from = days[0]
  const to = days[days.length - 1]
  const start = new Date(`${from}T00:00:00${helsinkiOffset(from)}`)
  const end = new Date(`${to}T00:00:00${helsinkiOffset(to)}`)
  end.setUTCDate(end.getUTCDate() + 1)
  const query = `/Calendar/${src.id}?StartDate=${start.toISOString()}&EndDate=${end.toISOString()}&VehicleCategory=${category}` + plan.product_ids.map((id) => `&ProductIds=${id}`).join('')
  const response = await muster('GET', query, undefined, src.base)
  if (response.status !== 200 || !Array.isArray(response.data)) return { ok: false, step: 'calendar', status: response.status, error: response.data }
  const byDay = {}
  let sample = null
  for (const day of response.data) {
    for (const hour of Object.values(day.hours || {})) {
      for (const slot of hour) {
        if (!slot.isAvailable) continue
        const local = helsinki(new Date(slot.time))
        const hours = hoursByDay[local.date]
        if (!hours || hours.status === 'closed') continue
        if (hours.status === 'open') {
          const endLocal = slot.bookingEndTime ? helsinki(new Date(slot.bookingEndTime)).hm : local.hm
          if (minutes(local.hm) < minutes(hours.open) || minutes(endLocal) > minutes(hours.close)) continue
        }
        if (!sample && slot.onlineReservationPrice != null) sample = { eur: Number(slot.onlineReservationPrice), time: slot.time }
        const item = { time: local.hm, iso: slot.time }
        if (src.bookable) item.slot_id = slotId(slot.time, src.id, plan.product_ids, category)
        ;(byDay[local.date] = byDay[local.date] || []).push(item)
      }
    }
  }
  for (const list of Object.values(byDay)) list.sort((a, b) => a.iso.localeCompare(b.iso))
  return { ok: true, byDay, sample }
}
const view = (item) => (item.slot_id ? { slot_id: item.slot_id, time: item.time } : { time: item.time })
async function priceBlock(src, plan, sample) {
  if (!sample) return null
  const breakdown = await musterPrices(src, plan.product_ids, sample.time)
  return {
    total_eur: sample.eur,
    breakdown: (breakdown || []).map((p, i) => ({ item: plan.names[plan.product_ids.indexOf(p.productId)] || plan.names[i] || String(p.productId), eur: Number(p.onlineReservationPrice) })),
    source: src.bookable ? 'booking price for this visit' : 'live K1 online booking price for this visit',
    note: 'Payment is at the station.',
  }
}
const wantsMeasuring = (body_) => !(body_.include_measuring === false || /^(false|no|0)$/i.test(String(body_.include_measuring ?? '')))
async function planFor(src, body_) {
  const category = normalizeCategory(body_.vehicle_category || body_.lead_vehicle_category)
  const code = body_.product || body_.lead_product
  const list = await stationProducts(src, category)
  if (!list) return { category, plan: { ok: false, load_failed: true } }
  return { category, plan: planProducts(list, code, category, wantsMeasuring(body_)) }
}

async function slots() {
  const { entry, chosen } = await pickStation()
  if (!entry) return { ok: false, error: chosen.ambiguous ? 'Several stations match; ask which one.' : 'No station given and none is known for this customer. Ask which K1 station.', candidates: (chosen.ambiguous || []).map((e) => e.name) }
  const src = sourceOf(entry)
  if (!src) return { ok: false, station: entry.name, closed: entry.closed || undefined, error: 'No availability can be read for this station.', booking_url: bookingLink(entry), national_phone: NATIONAL_PHONE }
  const { category, plan } = await planFor(src, body)
  if (plan.load_failed) return { ok: false, step: 'products', error: 'Could not load the products for this station.' }
  if (plan.needs_product) return { ok: false, needs_product: true, error: VEHICLE_QUESTION }
  if (!plan.ok) return { ...plan, station: entry.name, booking_url: bookingLink(entry), national_phone: NATIONAL_PHONE }
  const today = helsinki(nowDate()).date
  let from = isDay(body.date_from) ? body.date_from : addDays(today, 1)
  let to = isDay(body.date_to) ? body.date_to : from
  if (from < today) from = today
  if (to < from) to = from
  if ((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000 > 13) return { ok: false, error: 'Date range is longer than 14 days. Ask for a week or a day.' }
  const days = []
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day)
  const page = await stationPage(entry)
  const hoursByDay = Object.fromEntries(days.map((day) => [day, hoursFor(page, day)]))
  const found = await freeSlots(entry, src, days, plan, category, hoursByDay)
  if (!found.ok) return found
  const single = days.length === 1
  const summary = days.map((day) => {
    const list = found.byDay[day] || []
    const hours = hoursByDay[day]
    return {
      date: day, weekday: weekdayOf(day), station_hours: showHours(hours), hours_note: hours.estimated ? 'estimated, verify with the station' : undefined,
      free_count: list.length, first: list[0] && list[0].time, last: list[list.length - 1] && list[list.length - 1].time,
      suggestions: spread(list, 3).map(view),
      ...(single ? { all_times: list.map(view) } : {}),
    }
  })
  return {
    ok: true, station: { id: src.id, name: entry.name }, bookable_by_assistant: src.bookable,
    vehicle: { product: plan.code, category, includes: plan.names, measuring_included: plan.includes_measuring, assumption: plan.assumption || undefined },
    total_free: summary.reduce((sum, d) => sum + d.free_count, 0), days: summary, price: await priceBlock(src, plan, found.sample),
    hours_verified: days.every((day) => hoursByDay[day].status !== 'unknown'),
    rule: src.bookable
      ? 'Every listed time is inside the station opening hours. Offer up to three suggestions spread over the day; if the customer names a time, look it up in all_times. Use the exact slot_id.'
      : 'Read-only live availability. This assistant cannot book at this station: describe the times, then give booking_url or the national number. Never claim a booking.',
    booking_url: src.bookable ? undefined : bookingLink(entry),
  }
}

// ---------- Station info ----------
async function stationInfo() {
  const chosen = await resolveStation(body.station || body.station_name || '', leadStation())
  if (chosen.ambiguous) return { ok: false, ambiguous: true, candidates: chosen.ambiguous.map((e) => ({ name: e.name, address: e.address, closed: e.closed })), error: 'Several stations match. Ask the customer which one (name the options).' }
  if (!chosen.entry) return { ok: false, not_found: chosen.not_found || undefined, unknown_lead_station: chosen.unknown || undefined, error: chosen.unknown ? 'No station given and the lead has no known station. Ask which K1 station they mean.' : 'No K1 station matches that. Ask for the city or station name.' }
  const entry = chosen.entry
  const src = sourceOf(entry)
  const today = helsinki(nowDate())
  const day = isDay(body.date) ? body.date : today.date
  const page = await stationPage(entry)
  const requested = hoursFor(page, day)
  const week = page ? page.rows.slice(0, 7).map((r) => ({ date: r.date, label: dayLabel(r.date), hours: r.open ? `${r.open}-${r.close}` : r.raw })) : []
  const result = {
    ok: true,
    station: { name: entry.name, address: entry.address, city: entry.city, closed: entry.closed || undefined, heavy_vehicles_only: entry.heavy || undefined, page: entry.url || undefined, is_lead_station: chosen.default_used || undefined },
    also_matches: chosen.also_matches && chosen.also_matches.length ? chosen.also_matches.map((e) => e.name) : undefined,
    hours: { date: day, label: dayLabel(day), status: requested.status, opens: requested.open, closes: requested.close, display: showHours(requested), estimated: requested.estimated || undefined, source: requested.source || requested.reason, next_days: week.length ? week : undefined },
    today_helsinki: `${today.date} ${today.weekday} ${today.hm}`,
    booking: src && src.bookable
      ? { assistant_can_book: true, station_id: src.id, official_booking_link: bookingLink(entry) }
      : { assistant_can_book: false, official_booking_link: bookingLink(entry) || undefined, national_booking_phone: NATIONAL_PHONE, note: 'This assistant cannot create bookings at this station yet. Give the official booking link or the national number; never claim a booking.' },
    national_phone_note: `The national number ${NATIONAL_PHONE} is a booking phone service (Mon-Fri 07:30-18:00, Sat 09:00-14:00), not this station's opening hours.`,
  }
  if (entry.closed) {
    result.station_closed = true
    result.nearby_open_stations = sameCity(chosen.entries, entry).slice(0, 4)
    result.note = 'This station is permanently closed. Do not offer it. Suggest an open station.'
  }
  if (!page) result.hours.note = 'The live station page could not be read. Say the hours could not be verified right now and point to the official station page.'
  const code = normalizeProduct(body.product || body.lead_product)
  if (src && !entry.closed) {
    const { category, plan } = await planFor(src, body)
    if (plan.ok) {
      const candidates = []
      let probe = requested.status === 'closed' || day < today.date ? today.date : day
      if (probe === today.date && today.hm >= '16:00' && !isDay(body.date)) probe = addDays(probe, 1)
      for (let i = 0; i < 8; i++, probe = addDays(probe, 1)) candidates.push(probe)
      const hoursByDay = Object.fromEntries(candidates.map((d) => [d, hoursFor(page, d)]))
      const openDays = candidates.filter((d) => hoursByDay[d].status !== 'closed').slice(0, 4)
      const found = openDays.length ? await freeSlots(entry, src, openDays, plan, category, hoursByDay) : { ok: true, byDay: {}, sample: null }
      if (found.ok) {
        result.availability = openDays.filter((d) => (found.byDay[d] || []).length).slice(0, 2).map((d) => {
          const list = found.byDay[d]
          return { date: d, label: dayLabel(d), station_hours: showHours(hoursByDay[d]), free_count: list.length, first: list[0].time, last: list[list.length - 1].time, suggestions: spread(list, 3).map(view) }
        })
        result.price = await priceBlock(src, plan, found.sample)
        result.vehicle = { product: plan.code, category, includes: plan.names, measuring_included: plan.includes_measuring }
      } else result.availability_error = 'Live availability could not be loaded right now.'
    } else if (plan.needs_product) result.availability_note = VEHICLE_QUESTION
    else if (plan.load_failed) result.availability_error = 'Live availability could not be loaded right now.'
    else result.availability_note = plan.reason
  }
  if (!result.price && page && page.prices.length && code) {
    const estimate = pageEstimate(page.prices, code, wantsMeasuring(body))
    if (estimate) result.price_estimate_for_this_vehicle = estimate
  }
  if (!result.price && page && page.prices.length) result.prices_on_station_page = page.prices.slice(0, 10).map((p) => `${p.service}: ${p.eur} EUR`)
  return result
}

// ---------- Booking (staging only) ----------
const cleanName = (value) => String(value || '').replace(/<[^>]*>/g, ' ').replace(/[^\p{L}\p{M}' .-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
const cleanPlate = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9ÅÄÖ-]/g, '').slice(0, 10)
function customerBody(fields, stationId) {
  const name = cleanName(fields.name) || 'Wasup Testi'
  const bits = name.split(/\s+/)
  return {
    firstName: bits[0] || 'Wasup', lastName: bits.slice(1).join(' ') || 'Testi', email: fields.email || null, phoneNumber: null,
    receiveSms: false, receiveEmail: false, language: languageName(fields.language), plateNumber: cleanPlate(fields.rek || fields.plate), stationId,
  }
}
const stationNameById = async (id) => {
  const found = (await directory()).find((e) => e.muster_id === Number(id))
  return found ? found.name : ''
}
async function insideHours(slot) {
  const entry = (await directory()).find((e) => e.muster_id === slot.stationId)
  if (!entry) return true
  const local = helsinki(new Date(slot.time))
  const hours = hoursFor(await stationPage(entry), local.date)
  if (hours.status === 'closed') return false
  if (hours.status === 'open') return minutes(local.hm) >= minutes(hours.open) && minutes(local.hm) < minutes(hours.close)
  return true
}
const SLOT_TAKEN = 'That time was just taken or is no longer available. Nothing was booked. Call get_slots again and offer the customer other free times (do not send them to the phone for this).'
function holdFailure(held) {
  const text = typeof held.data === 'string' ? held.data : JSON.stringify(held.data || '')
  if (held.status === 400 && /No resource for slot/i.test(text)) return { ok: false, step: 'hold', status: 400, slot_unavailable: true, error: SLOT_TAKEN }
  if (held.status === 400 && /not sold online/i.test(text)) return { ok: false, step: 'hold', status: 400, error: 'That product cannot be booked online at this station. Ask the customer about the vehicle again or offer another station.' }
  return { ok: false, step: 'hold', status: held.status, error: text.slice(0, 300) }
}
async function book() {
  const slot = parseSlot(body.start_time || body.slot_id)
  if (!slot) return { ok: false, error: 'start_time must be an exact slot_id from get_slots.' }
  if (!(await directory()).some((e) => e.muster_id === slot.stationId)) return { ok: false, error: 'That station cannot be booked through this assistant. Use only slot_id values returned by get_slots.' }
  if (!body.phone) return { ok: false, error: 'phone is required' }
  const plate = cleanPlate(body.rek || body.plate)
  if (plate.replace(/[^A-Z0-9ÅÄÖ]/g, '').length < 2) return { ok: false, error: 'A valid registration number is required. Ask the customer for the plate.' }
  if (!cleanName(body.name)) return { ok: false, error: 'A name is required for the booking. Ask the customer for their name.' }
  if (!(await insideHours(slot))) return { ok: false, error: 'That time is outside the station opening hours. Call get_slots again and offer a listed time.' }
  const time = slot.time.replace('Z', '.000Z')
  const held = await muster('POST', '/PendingReservations', { time, stationId: slot.stationId, productIds: slot.productIds, plateNumber: plate, vehicleCategory: slot.category, groupId: null })
  if (held.status !== 200) return holdFailure(held)
  const customer = await muster('POST', '/B2CCustomer', customerBody(body, slot.stationId))
  if (customer.status !== 200) return { ok: false, step: 'customer', status: customer.status, error: customer.data, groupId: held.data.groupId }
  const reserved = await muster('POST', '/Reservations', {
    groupId: held.data.groupId,
    reservations: [{ pendingReservationUid: held.data.reservationUid, plateNumber: plate, vehicleCategory: slot.category, productIds: slot.productIds }],
    b2CCustomerUid: customer.data.uid, language: languageName(body.language), externalPriceId: null,
  })
  if (reserved.status !== 200) return { ok: false, step: 'reserve', status: reserved.status, error: reserved.data, groupId: held.data.groupId }
  const confirmed = await muster('POST', '/Reservations/confirm', { groupId: held.data.groupId, reservations: [{ pendingReservationUid: held.data.reservationUid }], sendConfirmation: false })
  if (confirmed.status !== 200) {
    await muster('DELETE', `/PendingReservations/${held.data.groupId}`)
    return { ok: false, step: 'confirm', status: confirmed.status, error: confirmed.data }
  }
  const info = reserved.data.reservations[0]
  const stationName = await stationNameById(slot.stationId)
  const local = helsinki(new Date(slot.time))
  return {
    ok: true, success: true, booking_number: info.bookingNumber, event_id: `${held.data.groupId}|${info.uid}|${customer.data.uid}`,
    group_id: held.data.groupId, reservation_uid: info.uid, customer_uid: customer.data.uid, slot_id: body.start_time,
    display_fi: `${weekdayOf(local.date)} ${fiDate(local.date)} ${local.hm}`, station_id: slot.stationId, station_name: stationName, plate,
    vehicle_category: slot.category, product_ids: slot.productIds,
    record: {
      p_tenant_key: 'k1_katsastus_demo', p_phone: String(body.phone), p_plate: plate, p_station_id: slot.stationId, p_station_name: stationName,
      p_product_ids: slot.productIds, p_group_id: held.data.groupId, p_reservation_uid: info.uid, p_booking_number: info.bookingNumber,
      p_customer_uid: customer.data.uid, p_starts_at: slot.time, p_ends_at: held.data.reservationEndDateTime, p_status: 'confirmed', p_language: languageName(body.language),
    },
  }
}
// The agent tool path passes the caller's confirmed bookings (require_owner); staff calls through the gated webhook do not.
function ownershipError(groupId) {
  if (!input.require_owner) return null
  if (input.owner_lookup_failed) return { ok: false, step: 'ownership', error: 'The customer\'s bookings could not be checked right now, so nothing was changed. Do not say anything was cancelled or moved; give the national number 0306 100 100.' }
  if (!(input.owned_bookings || []).includes(groupId)) return { ok: false, step: 'ownership', not_owner: true, error: 'No confirmed booking with this event_id belongs to this customer, so nothing was changed. Ask what booking they mean or give the national number 0306 100 100.' }
  return null
}
async function moveBooking() {
  const slot = parseSlot(body.start_time || body.slot_id)
  const [groupId, reservationUid, customerUid] = String(body.event_id || '').split('|')
  if (!slot || !groupId || !reservationUid || !customerUid) return { ok: false, error: 'reschedule needs a new slot_id and the event_id from the booking' }
  const notOwner = ownershipError(groupId)
  if (notOwner) return notOwner
  if (!(await directory()).some((e) => e.muster_id === slot.stationId)) return { ok: false, error: 'That station cannot be booked through this assistant. Use only slot_id values returned by get_slots.' }
  if (!(await insideHours(slot))) return { ok: false, error: 'That time is outside the station opening hours. Call get_slots again and offer a listed time.' }
  const plate = cleanPlate(body.rek || body.plate)
  const time = slot.time.replace('Z', '.000Z')
  const held = await muster('POST', '/PendingReservations', { time, stationId: slot.stationId, productIds: slot.productIds, plateNumber: plate, vehicleCategory: slot.category, groupId })
  if (held.status !== 200) return holdFailure(held)
  await muster('PUT', `/B2CCustomer/${customerUid}`, customerBody(body, slot.stationId))
  const reserved = await muster('POST', '/Reservations', {
    groupId: held.data.groupId,
    reservations: [{ pendingReservationUid: held.data.reservationUid, originalReservationUid: reservationUid, plateNumber: plate, vehicleCategory: slot.category, productIds: slot.productIds }],
    b2CCustomerUid: customerUid, language: languageName(body.language), externalPriceId: null,
  })
  if (reserved.status !== 200) return { ok: false, step: 'reserve', status: reserved.status, error: reserved.data }
  const confirmed = await muster('POST', '/Reservations/confirm', { groupId: held.data.groupId, reservations: [{ pendingReservationUid: held.data.reservationUid, originalReservationUid: reservationUid }], sendConfirmation: false })
  if (confirmed.status !== 200) return { ok: false, step: 'confirm', status: confirmed.status, error: confirmed.data }
  const info = reserved.data.reservations[0]
  const stationName = await stationNameById(slot.stationId)
  const local = helsinki(new Date(slot.time))
  return {
    ok: true, success: true, booking_number: info.bookingNumber, event_id: `${held.data.groupId}|${info.uid}|${customerUid}`, group_id: held.data.groupId,
    display_fi: `${weekdayOf(local.date)} ${fiDate(local.date)} ${local.hm}`, previous_reservation_uid: reservationUid, station_name: stationName,
    record: {
      p_tenant_key: 'k1_katsastus_demo', p_phone: String(body.phone), p_plate: plate, p_station_id: slot.stationId, p_station_name: stationName,
      p_product_ids: slot.productIds, p_group_id: held.data.groupId, p_reservation_uid: info.uid, p_booking_number: info.bookingNumber,
      p_customer_uid: customerUid, p_starts_at: slot.time, p_ends_at: held.data.reservationEndDateTime, p_status: 'confirmed', p_language: languageName(body.language),
    },
  }
}
function myBookings() {
  if (input.owner_lookup_failed) return { ok: false, error: 'The customer\'s bookings could not be checked right now. Do not guess whether a booking exists; give the national number 0306 100 100.' }
  const now = Date.now()
  const bookings = (input.owned_details || []).filter((row) => new Date(row.startsAt).getTime() > now).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)).map((row) => {
    const local = helsinki(new Date(row.startsAt))
    return { event_id: `${row.groupId}|${row.reservationUid}|${row.customerUid}`, booking_number: row.bookingNumber, station_name: row.stationName, plate: row.plate, date: local.date, time: local.hm, includes_measuring: (row.productIds || []).length > 1, display_fi: `${weekdayOf(local.date)} ${fiDate(local.date)} ${local.hm}` }
  })
  return { ok: true, count: bookings.length, bookings, note: 'Only bookings made through this chat are listed; a booking made elsewhere (for example on the K1 website) is not visible.' }
}
async function cancel() {
  const groupId = String(body.event_id || body.group_id || '').split('|')[0]
  if (!groupId) return { ok: false, error: 'cancel needs the event_id from the booking' }
  const notOwner = ownershipError(groupId)
  if (notOwner) return notOwner
  const response = await muster('DELETE', `/Reservations/${groupId}?sendConfirmation=false`)
  if (response.status !== 200 && response.status !== 204) return { ok: false, step: 'cancel', status: response.status, error: response.data }
  return { ok: true, success: true, already_cancelled: response.status === 204, group_id: groupId, cancelLocal: true }
}

let result
if (action === 'get_slots' || action === 'slots') result = await slots()
else if (action === 'station_info') result = await stationInfo()
else if (action === 'stations') {
  result = { ok: true, stations: (await directory()).map((e) => ({ name: e.name, address: e.address, closed: e.closed, bookable_here: Boolean(e.muster_id), muster_id: e.muster_id || undefined })) }
} else if (action === 'products') {
  const stationId = Number(body.station_id || body.stationId || 256)
  const response = await muster('GET', `/Products/${stationId}?vehicleCategory=${normalizeCategory(body.vehicle_category)}`)
  result = response.status === 200 ? { ok: true, products: response.data.map((product) => ({ id: product.id, type: product.productType, name: product.name })) } : { ok: false, error: response.data }
} else if (action === 'book') result = await book()
else if (action === 'my_bookings') result = myBookings()
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
