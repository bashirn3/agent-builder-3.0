// Trigger for the account login bubble. Run before deploying the live agent.
// prepay after a booking replaces the reply; a time offer, a fresh booking
// confirmation, and a clock-time reschedule stay as the model wrote them.
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const dumped = execFileSync('python3', ['-c', `
import importlib.util, json
from pathlib import Path
path = Path('design/k1-fresh/tools/k1-agent-v2-build.py')
spec = importlib.util.spec_from_file_location('build', path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
rule = (Path('design/k1-fresh/prompts/k1-whatsapp-prompt-final.md').read_text())
print(json.dumps({
  'finish': mod.FINISH_FN,
  'cta': mod.CTA_JS,
  'rule': mod.ACCOUNT_PAY_RULE,
  'ruleInFile': mod.ACCOUNT_PAY_RULE in rule,
}))
`], { encoding: 'utf8', cwd: root })

const { finish, cta, rule, ruleInFile } = JSON.parse(dumped)
if (!ruleInFile) {
  console.error('repo prompt is missing the account pay paragraph')
  process.exit(1)
}
if (!rule.includes('https://ajanvaraus.k1katsastus.fi/varaus')) {
  console.error('account pay rule has no login URL')
  process.exit(1)
}

const ACCOUNT = 'https://ajanvaraus.k1katsastus.fi/varaus'
const STATION = 'https://k1-katsastus-ajanvaraus.stage.geniem.io/varaus?stationId=256'
const FI = 'Voit kirjautua varaukseesi ja maksaa ennakkoon. ' + ACCOUNT
const SV = 'Du kan logga in på din bokning och betala i förväg. ' + ACCOUNT
const EN = 'You can log in to your booking and pay beforehand. ' + ACCOUNT

function mockDollar(nodes) {
  return function $(name) {
    const node = nodes[name]
    if (!node) return { isExecuted: false, first: () => ({ json: {} }), all: () => [] }
    const json = node.json === undefined ? node : node.json
    return {
      isExecuted: node.isExecuted !== false,
      first: () => ({ json }),
      all: () => [{ json }],
    }
  }
}

function loadFinish($) {
  const sandbox = { $ }
  vm.createContext(sandbox)
  vm.runInContext(finish, sandbox)
  if (typeof sandbox.finishReply !== 'function') throw new Error('finishReply did not load')
  return sandbox.finishReply
}

function loadDecorate($) {
  const sandbox = { $, URL }
  vm.createContext(sandbox)
  const body = cta.replace(/return \$input\.all\(\)[\s\S]*$/, 'this.decorate = decorate')
  vm.runInContext(body, sandbox)
  if (typeof sandbox.decorate !== 'function') throw new Error('decorate did not load')
  return sandbox.decorate
}

function step(tool, observation) {
  return { action: { tool }, observation: JSON.stringify(observation) }
}

function run(label, { user, messages, staging, steps, expect }) {
  const finishReply = loadFinish(mockDollar({
    'Build Turn': { raw_text: user },
    'Parse Staging': { staging: staging || { found: true, hasBooking: false } },
  }))
  const out = finishReply(messages, { intermediateSteps: steps || [] })
  const text = (out.messages || []).join('\n\n')
  const problems = []
  if (expect.exact !== undefined && text !== expect.exact) problems.push(`exact\n  got: ${text}`)
  if (expect.includes) {
    for (const part of expect.includes) if (!text.includes(part)) problems.push(`missing ${part}`)
  }
  if (expect.excludes) {
    for (const part of expect.excludes) if (text.includes(part)) problems.push(`unexpected ${part}`)
  }
  if (expect.count !== undefined && out.messages.length !== expect.count) problems.push(`bubbles ${out.messages.length}`)
  if (expect.rewrite === true && !(out.rewrites || []).includes('account_pay')) problems.push('missing account_pay rewrite')
  if (expect.rewrite === false && (out.rewrites || []).includes('account_pay')) problems.push('account_pay rewrite fired')
  if (problems.length) {
    console.error('FAIL', label)
    for (const problem of problems) console.error(' ', problem)
    process.exitCode = 1
  } else {
    console.log('ok', label)
  }
  return out
}

const booked = { found: true, hasBooking: true }
const open = { found: true, hasBooking: false }
const slots = [step('get_slots', { official_booking_link: STATION, price: { station_eur: 76, online_payment_eur: 60 } })]
const invite = [step('book_inspection_invite', { success: true, ok: true, booking_number: '48213' })]
const mine = [step('get_my_bookings', { ok: true, count: 1, bookings: [{ booking_number: '48213' }] })]
const none = [step('get_my_bookings', { ok: true, count: 0, bookings: [] })]

const wrong = [
  'Tämä varaus maksetaan asemalla. Ennakkomaksu vaatii uuden verkkovarauksen. ' + STATION,
  'Haluatko, että perun nykyisen varauksen?',
]
run('prepay after booking replaces', {
  user: 'Haluaisin maksaa ennakkoon',
  messages: wrong,
  staging: booked,
  expect: { exact: FI, count: 1, rewrite: true, excludes: ['perun', 'stationId'] },
})
run('different booking plus pay replaces', {
  user: 'Miten teet erilaisen varauksen, jonka voi maksaa ennakkoon?',
  messages: ['Nykyistä varausta ei voi muuttaa ennakkoon maksettavaksi. Se pitää ensin perua.'],
  staging: booked,
  expect: { exact: FI, count: 1, rewrite: true, excludes: ['perua'] },
})
run('get_my_bookings count replaces', {
  user: 'Can I pay in advance?',
  messages: ['This booking is paid at the station. Cancel it and book again.'],
  staging: open,
  steps: mine,
  expect: { exact: EN, count: 1, rewrite: true },
})
run('swedish prepay replaces', {
  user: 'Jag vill betala i förväg',
  messages: ['Den betalas på stationen.'],
  staging: booked,
  expect: { exact: SV, count: 1, rewrite: true },
})
run('change booking replaces', {
  user: 'Haluaisin muuttaa varausta',
  messages: ['Peru nykyinen ensin.'],
  staging: booked,
  expect: { exact: FI, count: 1, rewrite: true },
})

const offer = 'Huomenna ti 3.11. olis 14.15, 15.00 tai 15.45, asemalla 76 €. Tai 60 € jos maksat ennakkoon napista. ' + STATION
run('time offer does not', {
  user: 'Mitä aikoja huomenna?',
  messages: [offer],
  staging: booked,
  steps: slots,
  expect: { includes: ['14.15', STATION], excludes: [ACCOUNT], rewrite: false },
})
const confirmation = 'No niin, varattu. Palokka, to 29.10. klo 12.15, varausnumero 48213. Maksat asemalla 79 €, kortti käy.'
run('fresh booking confirmation does not', {
  user: 'Joku jaskanen',
  messages: [confirmation],
  staging: booked,
  steps: invite,
  expect: { exact: confirmation, rewrite: false, excludes: ['https://'] },
})
run('prepay on the booking turn keeps the confirmation', {
  user: 'Haluaisin maksaa ennakkoon',
  messages: [confirmation],
  staging: booked,
  steps: invite,
  expect: { exact: confirmation, rewrite: false, excludes: [ACCOUNT] },
})
run('clock-time reschedule does not', {
  user: 'siirrä klo 14',
  messages: ['Selvä, siirrän sen klo 14.00.'],
  staging: booked,
  expect: { exact: 'Selvä, siirrän sen klo 14.00.', rewrite: false, excludes: [ACCOUNT] },
})
run('prepay before any booking keeps the station link', {
  user: 'Haluaisin maksaa ennakkoon',
  messages: ['Huomenna 14.15 on vihreä aika, 60 € verkossa. ' + STATION],
  staging: open,
  steps: [...slots, ...none],
  expect: { includes: [STATION, '14.15'], excludes: [ACCOUNT], rewrite: false },
})

const decorate = loadDecorate(mockDollar({}))
function button(text, label, url = ACCOUNT) {
  const out = decorate({ text })
  const problems = []
  if (out.cta_url !== url) problems.push(`url ${out.cta_url}`)
  if (out.cta_label !== label) problems.push(`label ${out.cta_label}`)
  if (String(out.cta_body || '').includes('http')) problems.push(`body still has a url: ${out.cta_body}`)
  if (out.cta_label && out.cta_label.length > 20) problems.push('label longer than 20')
  if (problems.length) {
    console.error('FAIL button', text)
    for (const problem of problems) console.error(' ', problem)
    process.exitCode = 1
  } else {
    console.log('ok button', label)
  }
}
button(FI, 'Maksa ennakkoon')
button(SV, 'Betala i förväg')
button(EN, 'Pay ahead')
button('Huomenna 14.15, 15.00 tai 15.45. ' + STATION, 'Varaa aika', STATION)
button('Book at the station. https://ajanvaraus.k1katsastus.fi/varaus?stationId=256', 'Book a time', 'https://ajanvaraus.k1katsastus.fi/varaus?stationId=256')

if (process.exitCode) process.exit(process.exitCode)
console.log('account pay trigger ok')
