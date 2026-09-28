export interface TreemapItem {
  name: string
  size: number
}

/** A tile in percent of the map (0..100 on both axes). */
export interface TreemapRect extends TreemapItem {
  x: number
  y: number
  w: number
  h: number
  /** The tile that groups the items too small to draw on their own. */
  other?: boolean
}

type Sized = TreemapItem & { other?: boolean }

function squarify(items: Sized[], x: number, y: number, w: number, h: number, out: TreemapRect[]) {
  if (!items.length || w <= 0 || h <= 0) return
  if (items.length === 1) {
    out.push({ ...items[0], x, y, w, h })
    return
  }
  const total = items.reduce((s, i) => s + i.size, 0)
  const horizontal = w >= h
  const side = horizontal ? h : w
  // Add items to the row while the worst aspect ratio in it keeps improving.
  let rowSum = 0
  let bestIdx = 0
  let bestWorst = Infinity
  for (let i = 0; i < items.length; i++) {
    rowSum += items[i].size
    const rowLen = (horizontal ? w : h) * (rowSum / total)
    let worst = 0
    for (let j = 0; j <= i; j++) {
      const itemLen = side * (items[j].size / rowSum)
      const aspect = rowLen > itemLen ? rowLen / itemLen : itemLen / rowLen
      if (aspect > worst) worst = aspect
    }
    if (worst <= bestWorst) {
      bestWorst = worst
      bestIdx = i
    } else break
  }
  const row = items.slice(0, bestIdx + 1)
  const rest = items.slice(bestIdx + 1)
  const rowTotal = row.reduce((s, i) => s + i.size, 0)
  const rowFrac = rowTotal / total
  if (horizontal) {
    const rowW = w * rowFrac
    let cy = y
    for (const item of row) {
      const itemH = h * (item.size / rowTotal)
      out.push({ ...item, x, y: cy, w: rowW, h: itemH })
      cy += itemH
    }
    squarify(rest, x + rowW, y, w - rowW, h, out)
  } else {
    const rowH = h * rowFrac
    let cx = x
    for (const item of row) {
      const itemW = w * (item.size / rowTotal)
      out.push({ ...item, x: cx, y, w: itemW, h: rowH })
      cx += itemW
    }
    squarify(rest, x, y + rowH, w, h - rowH, out)
  }
}

/**
 * Squarified treemap in percent units. Items under 1.5 % of the total are grouped
 * into one "other" tile named by `otherLabel(count)`, drawn last-sized like the rest.
 */
export function layoutTreemap(
  items: TreemapItem[],
  otherLabel: (count: number) => string
): TreemapRect[] {
  const positive = items.filter((i) => i.size > 0)
  const total = positive.reduce((s, i) => s + i.size, 0)
  if (total <= 0) return []
  const threshold = total * 0.015
  const grouped: Sized[] = positive.filter((i) => i.size >= threshold)
  const small = positive.filter((i) => i.size < threshold)
  if (small.length > 0) {
    grouped.push({
      name: otherLabel(small.length),
      size: small.reduce((s, i) => s + i.size, 0),
      other: true
    })
  }
  grouped.sort((a, b) => b.size - a.size)
  const rects: TreemapRect[] = []
  squarify(grouped, 0, 0, 100, 100, rects)
  return rects
}
