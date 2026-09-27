// One Chrome DevTools Protocol session to the dev renderer. A single session is
// needed because Emulation overrides only live as long as the session does.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const OUT_DIR = path.join(os.tmpdir(), 'ssc-ui-audit')
fs.mkdirSync(OUT_DIR, { recursive: true })

export const ROUTES = [
  '/',
  '/cleaner',
  '/registry',
  '/context-menu',
  '/startup',
  '/storage-history',
  '/disk',
  '/duplicates',
  '/large-files',
  '/empty-folders',
  '/file-shredder',
  '/disk-repair',
  '/disk-maintenance',
  '/network',
  '/malware',
  '/game-mode',
  '/performance-diagnostics',
  '/performance',
  '/uninstaller',
  '/history',
  '/recovery',
  '/settings',
  '/about',
  '/ai',
  '/privacy',
  '/services',
  '/firewall',
  '/debloater',
  '/updates',
  '/schedules',
  '/drivers'
]

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Parse `--key=value` flags; a bare `--flag` becomes true. */
export function parseArgs(argv) {
  const args = {}
  for (const raw of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(raw)
    if (m) args[m[1]] = m[2] ?? true
  }
  return args
}

export async function connect(port = process.env.CDP_PORT || 9333) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const page = targets.find(
    (t) =>
      t.type === 'page' && t.url.startsWith('http://localhost:') && !t.url.includes('desktop-notch')
  )
  if (!page) throw new Error('Dev renderer not found on the debug port: start the dev app (Task 0)')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const i = ++id
      pending.set(i, resolve)
      ws.send(JSON.stringify({ id: i, method, params }))
    })
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (res.result?.exceptionDetails) {
      throw new Error(res.result.exceptionDetails.exception?.description ?? 'evaluation failed')
    }
    return res.result?.result?.value
  }
  const screenshot = async (name) => {
    const res = await send('Page.captureScreenshot', { format: 'png' })
    const file = path.join(OUT_DIR, `${name}.png`)
    fs.writeFileSync(file, Buffer.from(res.result.data, 'base64'))
    return file
  }
  const setViewport = (width, height) =>
    send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    })
  const clearViewport = () => send('Emulation.clearDeviceMetricsOverride')
  const currentLanguage = () => evaluate('window.kudu.settingsGet().then((s) => s.language)')
  /**
   * Switch the isolated profile's UI language and wait for the reload. No-op
   * when it is already active, so loaded page data (e.g. an update scan) survives.
   */
  const setLanguage = async (language) => {
    if ((await currentLanguage()) === language) return
    await evaluate(
      `window.kudu.settingsSet({ language: ${JSON.stringify(language)} }).then(() => { location.reload(); return true })`
    )
    await sleep(2500)
  }
  /** Poll until `selector` matches (true) or `timeoutMs` passes (false). */
  const waitForSelector = async (selector, timeoutMs = 60000) => {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      if (await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return true
      await sleep(500)
    }
    return false
  }
  const navigate = (route) => evaluate(`location.hash = ${JSON.stringify('#' + route)}`)
  return {
    send,
    evaluate,
    screenshot,
    setViewport,
    clearViewport,
    setLanguage,
    currentLanguage,
    waitForSelector,
    navigate,
    close: () => ws.close()
  }
}
