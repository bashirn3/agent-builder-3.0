// Headless Chromium (Brave) driver for reproducible reference-matched captures.
// Usage: node shoot.mjs plan.json
// A plan is { base, outDir, width, height, scale, reducedMotion, steps: [...] } where each step is one of
//   { go: '#/route' } | { wait: ms } | { eval: 'js' } | { click: 'selector' } | { type: ['selector', 'text'] }
//   { key: 'Enter' | 'Escape' | 'Tab' | ... , shift?: true } | { shot: 'name' } | { viewport: [w, h, scale, mobile] }
//   { expect: 'js returning truthy', label: 'what it proves' }
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const BROWSER = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
const plan = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const outDir = resolve(plan.outDir)
mkdirSync(outDir, { recursive: true })
const port = 9400 + Math.floor(Math.random() * 400)

const proc = spawn(BROWSER, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/k1-shoot-${port}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--disable-gpu', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target
for (let i = 0; i < 60 && !target; i += 1) {
  await sleep(250)
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    target = list.find((item) => item.type === 'page')
  } catch {}
}
if (!target) { proc.kill(); throw new Error('browser did not start') }

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
})
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })) })
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (res.result?.exceptionDetails) throw new Error(`eval failed: ${expression}\n${JSON.stringify(res.result.exceptionDetails)}`)
  return res.result?.result?.value
}

const viewport = async (w, h, scale, mobile = false) => {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile })
}
await send('Page.enable')
await send('Runtime.enable')
await viewport(plan.width ?? 1440, plan.height ?? 900, plan.scale ?? 4 / 3)
if (plan.reducedMotion) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })

const log = []
const keyInfo = { Enter: ['Enter', 13, '\r'], Escape: ['Escape', 27], Tab: ['Tab', 9], ArrowDown: ['ArrowDown', 40], ArrowUp: ['ArrowUp', 38], ArrowRight: ['ArrowRight', 39], ArrowLeft: ['ArrowLeft', 37], ' ': [' ', 32, ' '] }
try {
  for (const step of plan.steps) {
    if (step.go) {
      await send('Page.navigate', { url: `${plan.base}${step.go}` })
      await sleep(step.settle ?? 900)
    } else if (step.waitFor) {
      const started = Date.now()
      while (!(await evaluate(`!!(${step.waitFor})`))) {
        if (Date.now() - started > (step.timeout ?? 30000)) throw new Error(`timed out waiting for ${step.waitFor}`)
        await sleep(150)
      }
      log.push(`ready ${step.waitFor} (${Date.now() - started} ms)`)
    } else if (step.wait) await sleep(step.wait)
    else if (step.eval) await evaluate(step.eval)
    else if (step.viewport) await viewport(...step.viewport)
    else if (step.click) {
      const ok = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(step.click)}); if (!el) return false; el.scrollIntoView({block:'nearest'}); const r = el.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2] })()`)
      if (!ok) throw new Error(`click target missing: ${step.click}`)
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: ok[0], y: ok[1], button: 'left', clickCount: 1 })
      await sleep(step.settle ?? 350)
    } else if (step.type) {
      await evaluate(`document.querySelector(${JSON.stringify(step.type[0])}).focus()`)
      await send('Input.insertText', { text: step.type[1] })
      await sleep(step.settle ?? 200)
    } else if (step.key) {
      const [key, code, text] = keyInfo[step.key] ?? [step.key, 0]
      const modifiers = step.shift ? 8 : 0
      await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code: key, windowsVirtualKeyCode: code, text, modifiers })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, modifiers })
      await sleep(step.settle ?? 250)
    } else if (step.shot) {
      const res = await send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(outDir, `${step.shot}.png`), Buffer.from(res.result.data, 'base64'))
      log.push(`shot ${step.shot}`)
    } else if (step.expect) {
      const value = await evaluate(step.expect)
      log.push(`${value ? 'PASS' : 'FAIL'} ${step.label ?? step.expect}${value && value !== true ? ` → ${JSON.stringify(value)}` : ''}`)
    }
  }
} finally {
  console.log(log.join('\n'))
  ws.close()
  proc.kill()
}
