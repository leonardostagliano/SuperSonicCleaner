// Sweep routes × widths × languages, optionally inject extreme values, and
// fail when the detector reports a blocking layout defect.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect, parseArgs, sleep, OUT_DIR, ROUTES } from './cdp.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const detect = fs.readFileSync(path.join(here, 'detect.js'), 'utf8')
const args = parseArgs(process.argv.slice(2))
const widths = String(args.widths ?? '900,1100,1251,1440')
  .split(',')
  .map(Number)
const langs = String(args.langs ?? 'it,de,ar').split(',')
const routes = args.routes ? String(args.routes).split(',') : ROUTES
const height = Number(args.height ?? 900)
const inject = !args['no-inject']
const shots = Boolean(args.shots)
/** Optional selector that must exist before detecting (e.g. rows that need a scan). */
const waitFor = typeof args['wait-for'] === 'string' ? args['wait-for'] : null

const NBSP = ' '
/** Extreme values per route; targets that are not on the page are skipped. */
const INJECTIONS = {
  '/': [
    ['.pulse-home-storage .pulse-big-value', `1023,99${NBSP}GB`],
    ['.pulse-memory .pulse-big-value', `1023,99${NBSP}GB`],
    ['.pulse-cpu .pulse-big-value', '100']
  ],
  '/updates': [
    ['[data-audit="version-current"]', 'N-124279-g0f6ba39122-20260430'],
    ['[data-audit="version-available"]', 'N-125875-g5d4d3bdc61-20260731'],
    [
      '[data-audit="app-name"]',
      'Microsoft Visual C++ 2015-2022 Redistributable (x64) - 14.44.35211'
    ]
  ]
}
const injectScript = (pairs) => `(() => {
  const pairs = ${JSON.stringify(pairs)}
  let hits = 0
  for (const [selector, value] of pairs) {
    for (const el of document.querySelectorAll(selector)) {
      const node = [...el.childNodes].find((c) => c.nodeType === 3 && c.textContent.trim())
      if (node) { node.textContent = value; hits++ }
    }
  }
  return hits
})()`

const BLOCKING = ['hOverflow', 'clippedText', 'outside', 'overlaps']
const s = await connect()
const originalLanguage = await s.currentLanguage()
const results = []
let failures = 0
try {
  for (const lang of langs) {
    await s.setLanguage(lang)
    for (const width of widths) {
      await s.setViewport(width, height)
      for (const route of routes) {
        await s.navigate(route)
        await sleep(1500)
        if (waitFor && !(await s.waitForSelector(waitFor))) {
          console.log(`       note: ${waitFor} did not appear within 60 s on ${route}`)
        }
        const pairs = inject ? INJECTIONS[route] : undefined
        const injected = pairs ? await s.evaluate(injectScript(pairs)) : 0
        if (injected) await sleep(100)
        const res = JSON.parse(await s.evaluate(detect))
        const blocking =
          BLOCKING.reduce((n, k) => n + res[k].length, 0) + (res.docOverflowX > 0 ? 1 : 0)
        failures += blocking
        results.push({ lang, width, injected, blocking, ...res })
        const status = blocking ? 'FAIL' : 'ok  '
        const note = injected ? ` injected=${injected}` : ''
        console.log(
          `${status} ${lang} ${width} ${route.padEnd(24)} blocking=${blocking} ellipsis=${res.ellipsis.length}${note}`
        )
        if (res.docOverflowX > 0) console.log(`       docOverflowX: ${res.docOverflowX}`)
        for (const k of BLOCKING)
          for (const f of res[k]) console.log(`       ${k}: ${JSON.stringify(f)}`)
        if (shots) await s.screenshot(`${lang}-${width}-${route === '/' ? 'home' : route.slice(1)}`)
      }
    }
  }
} finally {
  await s.clearViewport()
  if (originalLanguage) await s.setLanguage(originalLanguage)
  s.close()
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const file = path.join(OUT_DIR, `audit-${stamp}.json`)
fs.writeFileSync(file, JSON.stringify(results, null, 1))
console.log(`\n${failures ? 'FAILED' : 'PASSED'}: ${failures} blocking finding(s). Report: ${file}`)
process.exit(failures ? 1 : 0)
