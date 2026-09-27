// Layout defects on the current route: horizontal overflow, clipped text,
// text outside the content box, and text overlapping graphics or other text.
;(() => {
  const root = document.querySelector('.app-content') || document.body
  const utility =
    /^(h-|w-|p[xytrbl]?-|m[xytrbl]?-|text-|flex|items-|gap-|shrink|grow|min-|max-|rounded|border|bg-|font-|leading-|tracking-|space-|overflow|truncate|inline|block|grid|col-|row-|justify-|self-|relative|absolute|opacity|transition|duration|hover|focus|disabled|cursor|select|z-|@)/
  const sel = (el) => {
    const parts = []
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 4; i++, n = n.parentElement) {
      let s = n.tagName.toLowerCase()
      const cls = [...n.classList].filter((c) => !utility.test(c)).slice(0, 2)
      if (cls.length) s += '.' + cls.join('.')
      parts.unshift(s)
      const boundary =
        n.classList.contains('pulse-card') ||
        n.classList.contains('feature-card') ||
        n.tagName === 'SECTION'
      if (boundary) break
    }
    return parts.join('>')
  }
  const text = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)
  const visible = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false
    // Visually hidden text (sr-only) is read by screen readers and never shown
    if (cs.clipPath === 'inset(50%)' || cs.clip === 'rect(0px, 0px, 0px, 0px)') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const ownText = (el) => [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())
  const out = {
    route: location.hash,
    vw: innerWidth,
    docOverflowX: document.documentElement.scrollWidth - innerWidth,
    hOverflow: [],
    clippedText: [],
    ellipsis: [],
    outside: [],
    overlaps: [],
    hScrollbars: []
  }
  const all = [...document.querySelectorAll('body *')].filter(
    (el) => !el.closest('[data-sonner-toaster], svg *')
  )
  for (const el of all) {
    if (!visible(el)) continue
    const cs = getComputedStyle(el)
    const dx = el.scrollWidth - el.clientWidth
    const leafText = el.children.length === 0 || ownText(el)
    if (dx > 1 && el.clientWidth > 0) {
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') {
        out.hScrollbars.push({ el: sel(el), dx })
      } else if (cs.textOverflow === 'ellipsis') {
        out.ellipsis.push({ el: sel(el), text: text(el) })
      } else if (
        (cs.overflowX === 'hidden' || cs.overflowX === 'clip') &&
        leafText &&
        !el.classList.contains('skip-nav')
      ) {
        out.clippedText.push({ el: sel(el), text: text(el), dx })
      } else if (cs.overflowX === 'visible' && leafText) {
        out.hOverflow.push({ el: sel(el), text: text(el), dx })
      }
    }
    const dy = el.scrollHeight - el.clientHeight
    const clipsY = cs.overflowY === 'hidden' || cs.overflowY === 'clip'
    if (dy > 2 && clipsY && cs.webkitLineClamp === 'none' && el.clientHeight > 8 && ownText(el)) {
      out.clippedText.push({ el: sel(el), text: text(el), dy, axis: 'y' })
    }
  }
  const clipToAncestors = (r, p) => {
    let L = r.left
    let R = r.right
    let T = r.top
    let B = r.bottom
    for (let a = p; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a)
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
      const ar = a.getBoundingClientRect()
      if (cs.overflowX !== 'visible') {
        L = Math.max(L, ar.left)
        R = Math.min(R, ar.right)
      }
      if (cs.overflowY !== 'visible') {
        T = Math.max(T, ar.top)
        B = Math.min(B, ar.bottom)
      }
    }
    return { left: L, right: R, top: T, bottom: B }
  }
  const rootRect = root.getBoundingClientRect()
  const texts = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue
    const p = n.parentElement
    const ignored = p?.closest(
      'svg, [data-sonner-toaster], .recharts-wrapper, .pulse-chart-waiting, .skip-nav'
    )
    if (!p || ignored || !visible(p)) continue
    const range = document.createRange()
    range.selectNodeContents(n)
    const raw = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1)
    for (const r of raw) texts.push({ el: p, node: n, r: clipToAncestors(r, p) })
    const escapes = raw.find((r) => r.right > rootRect.right + 1 || r.left < rootRect.left - 1)
    if (escapes) {
      let inScroller = false
      for (let s = p; s && s !== root; s = s.parentElement) {
        if (getComputedStyle(s).overflowX !== 'visible') {
          inScroller = true
          break
        }
      }
      if (!inScroller) {
        out.outside.push({
          el: sel(p),
          text: n.textContent.trim().slice(0, 40),
          right: Math.round(escapes.right),
          limit: Math.round(rootRect.right)
        })
      }
    }
  }
  const graphicClass = /(^|-)(meter|sparkline|spark|bar|progress|gauge|ring)(-|$)/
  const isGraphic = (g) =>
    g.tagName === 'svg' ||
    g.tagName === 'CANVAS' ||
    g.tagName === 'PROGRESS' ||
    g.getAttribute('role') === 'meter' ||
    g.getAttribute('role') === 'progressbar' ||
    [...g.classList].some(
      (c) => graphicClass.test(c) && !/^(tracking|sidebar|toolbar|scrollbar)/.test(c)
    )
  const graphics = [
    ...root.querySelectorAll('svg, canvas, progress, [role=meter], [role=progressbar], [class]')
  ]
    .filter(isGraphic)
    .filter((g) => {
      if (!visible(g) || g.closest('button') || g.parentElement.closest('svg')) return false
      const r = g.getBoundingClientRect()
      return !(g.tagName === 'svg' && r.width <= 24 && r.height <= 24)
    })
  const area = (a, b) => {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
    return w > 1 && h > 1 ? Math.round(w * h) : 0
  }
  const ids = new WeakMap()
  let nextId = 0
  const idOf = (el) => {
    if (!ids.has(el)) ids.set(el, ++nextId)
    return ids.get(el)
  }
  const contains = (r, g) =>
    r.left >= g.left - 1 && r.right <= g.right + 1 && r.top >= g.top - 1 && r.bottom <= g.bottom + 1
  const seen = new Set()
  for (const t of texts) {
    for (const g of graphics) {
      if (g.contains(t.el) || t.el.contains(g)) continue
      const gr = g.getBoundingClientRect()
      if (contains(t.r, gr)) continue
      const a = area(t.r, gr)
      const key = idOf(t.el) + '|' + idOf(g)
      if (a > 6 && !seen.has(key)) {
        seen.add(key)
        out.overlaps.push({
          kind: 'text-graphic',
          text: t.node.textContent.trim().slice(0, 40),
          textEl: sel(t.el),
          graphic: sel(g),
          area: a
        })
      }
    }
  }
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const A = texts[i]
      const B = texts[j]
      if (A.el === B.el || A.el.contains(B.el) || B.el.contains(A.el)) continue
      const a = area(A.r, B.r)
      const key = idOf(A.el) + '|' + idOf(B.el)
      if (a > 6 && !seen.has(key)) {
        seen.add(key)
        out.overlaps.push({
          kind: 'text-text',
          a: A.node.textContent.trim().slice(0, 30),
          b: B.node.textContent.trim().slice(0, 30),
          area: a
        })
      }
    }
  }
  return JSON.stringify(out)
})()
