// Route-switch cost and time-to-first-value in the dev app at 1440 px.
import fs from 'node:fs'
import path from 'node:path'
import { connect, parseArgs, sleep, OUT_DIR, ROUTES } from './cdp.mjs'

/** Accept routes with or without the leading slash, and `home` for `/` (Git Bash rewrites a bare `/updates` token into a Windows path). */
const normalizeRoute = (r) => {
  const t = r.trim()
  if (t === '' || t === 'home' || t === '/') return '/'
  return t.startsWith('/') ? t : `/${t}`
}
const args = parseArgs(process.argv.slice(2))
const rounds = Number(args.rounds ?? 2)
const routes = args.routes ? String(args.routes).split(',').map(normalizeRoute) : ROUTES
const s = await connect()
await s.setViewport(1440, 900)
await s.evaluate(`(() => {
  if (window.__uiperf) return true
  const P = (window.__uiperf = { loaf: [], ls: [] })
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      const style = e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0
      P.loaf.push({ t: e.startTime, d: e.duration, style })
    }
  }).observe({ type: 'long-animation-frame' })
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (!e.hadRecentInput) P.ls.push({ t: e.startTime, v: e.value })
  }).observe({ type: 'layout-shift' })
  return true
})()`)
const measure = (route) => `(async () => {
  const P = window.__uiperf
  const route = ${JSON.stringify(route)}
  const t0 = performance.now()
  location.hash = '#' + route
  await new Promise((resolve) => {
    const check = () => (document.querySelector('.app-content')?.dataset.route === route ? resolve() : requestAnimationFrame(check))
    check()
  })
  const commit = performance.now() - t0
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
  const frame = performance.now() - t0
  await new Promise((r) => setTimeout(r, 2500))
  const loaf = P.loaf.filter((e) => e.t >= t0 - 5)
  const cls = P.ls.filter((e) => e.t >= t0 - 5).reduce((a, e) => a + e.v, 0)
  P.loaf.length = 0
  P.ls.length = 0
  return JSON.stringify({
    route,
    commitMs: Math.round(commit),
    frameMs: Math.round(frame),
    loafMax: Math.round(Math.max(0, ...loaf.map((e) => e.d))),
    styleLayoutMax: Math.round(Math.max(0, ...loaf.map((e) => e.style))),
    cls: +cls.toFixed(4),
    nodes: document.getElementsByTagName('*').length
  })
})()`
/** ms from navigation until `probe()` is true, polled every frame, capped at 15 s (-1). */
const timeToValue = (route, probe) => `(async () => {
  const probe = ${probe}
  const t0 = performance.now()
  location.hash = ${JSON.stringify('#' + route)}
  while (performance.now() - t0 < 15000) {
    if (probe()) return Math.round(performance.now() - t0)
    await new Promise((r) => requestAnimationFrame(r))
  }
  return -1
})()`
const out = { routes: [], firstValue: {} }
for (let round = 0; round < rounds; round++) {
  for (const route of routes) {
    const res = JSON.parse(await s.evaluate(measure(route)))
    out.routes.push({ round, ...res })
    console.log(
      round,
      route.padEnd(24),
      `commit ${res.commitMs}`,
      `frame ${res.frameMs}`,
      `LoAF ${res.loafMax}`,
      `style ${res.styleLayoutMax}`,
      `CLS ${res.cls}`,
      `nodes ${res.nodes}`
    )
  }
}
const hasValue = (selector) =>
  `() => { const v = document.querySelector(${JSON.stringify(selector)})?.textContent?.trim(); return !!v && v !== '\\u2014' }`
await s.navigate('/about')
await sleep(1000)
out.firstValue.homeStorageMs = await s.evaluate(
  timeToValue('/', hasValue('.pulse-home-storage .pulse-big-value'))
)
await s.navigate('/about')
await sleep(1000)
out.firstValue.performanceMs = await s.evaluate(
  timeToValue('/performance', hasValue('.performance-page [data-gauge-value]'))
)
console.log('time to first value', out.firstValue)
await s.clearViewport()
s.close()
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const file = path.join(OUT_DIR, `perf-${stamp}.json`)
fs.writeFileSync(file, JSON.stringify(out, null, 1))
console.log(`Report: ${file}`)
process.exit(0)
