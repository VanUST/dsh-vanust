/**
 * PURPOSE
 *   Geometry for the design map: how big a label needs to be, where a box with no
 *   coordinates belongs, and how an arrow reaches a box without crossing another one.
 *   Nothing here knows Excalidraw; index.js turns these numbers into elements.
 *
 *   The numbers come from the frame's own rules (Excalidraw 0.18.1):
 *   - a bound label is wrapped at `container.width - BOUND_TEXT_PADDING * 2` (5),
 *     with Canvas advance widths of the font string; the container is auto-grown to
 *     `text height + BOUND_TEXT_PADDING * 2`;
 *   - text height is exactly `fontSize * lineHeight * lineCount`, so a box that is
 *     sized from that formula is not re-grown on load.
 *   Font family 2 is Helvetica, whose advance widths are the Arial widths below
 *   (per 1000 em). We wrap at width/SAFETY and size the box at estimate*SAFETY, so
 *   a fallback font a few percent wider cannot add a line that clips the label.
 *
 * INPUTS
 *   Plain records: nodes {id,label,width,height,x?,y?}, edges {id,from,to},
 *   rectangles {id,x,y,width,height}.
 *
 * OUTPUTS
 *   Pure functions, no mutation of the caller's records beyond the returned values.
 */

export const TEXT = {
  fontSize: 17,
  lineHeight: 1.25,
  padding: 5,
  maxTextWidth: 320,
  minNodeWidth: 96,
  maxNodeWidth: 600,
  minNodeHeight: 44,
  maxNodeHeight: 420,
}
export const NODE_GAP = 56
const COLUMN_GAP = 120
const ROW_GAP = NODE_GAP
const SAFETY = 1.2

/** Arial/Helvetica advance widths per 1000 em for printable ASCII. */
const ARIAL = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  0: 556, 1: 556, 2: 556, 3: 556, 4: 556, 5: 556, 6: 556, 7: 556, 8: 556, 9: 556,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
}

/** Advance width of one line in px, at TEXT.fontSize. */
export function advance(line) {
  let units = 0
  for (const char of String(line)) {
    const known = ARIAL[char]
    units += known !== undefined ? known : (char.codePointAt(0) > 0x2e80 ? 1000 : 600)
  }
  return (units / 1000) * TEXT.fontSize
}

/** Greedy word wrap; long words are split by character. Empty input is one line. */
export function wrapLabel(raw, maxWidth) {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').trim()
  if (text === '') return ['']
  const out = []
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') { out.push(''); continue }
    let line = ''
    for (const word of paragraph.split(/(\s+)/)) {
      if (word === '' || /^\s+$/.test(word)) continue
      const next = line === '' ? word : `${line} ${word}`
      if (advance(next) <= maxWidth) { line = next; continue }
      if (line !== '') { out.push(line); line = '' }
      if (advance(word) <= maxWidth) { line = word; continue }
      let chunk = ''
      for (const char of word) {
        if (chunk !== '' && advance(chunk + char) > maxWidth) { out.push(chunk); chunk = char }
        else chunk += char
      }
      line = chunk
    }
    out.push(line)
  }
  return out.length > 0 ? out : ['']
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value))
}

/** The line width Excalidraw will measure, with the safety margin. */
export function lineWidth(line) {
  return advance(line) * SAFETY
}

/**
 * Content-sized node. An explicit width/height is a floor, not a cap: a box can
 * never be smaller than its label. Returns the exact text height and the wrapped
 * text Excalidraw will keep (explicit newlines survive its own wrapping).
 */
export function measureNode(label, { width, height } = {}) {
  const maxContent = (TEXT.maxNodeWidth - TEXT.padding * 2)
  let lines = wrapLabel(label, Math.min(TEXT.maxTextWidth, maxContent) / SAFETY)
  let textWidth = Math.max(...lines.map((line) => advance(line)))
  let requested = Number.isFinite(width) ? width : textWidth * SAFETY + TEXT.padding * 2
  let nodeWidth = clamp(Math.ceil(requested), TEXT.minNodeWidth, TEXT.maxNodeWidth)
  lines = wrapLabel(label, (nodeWidth - TEXT.padding * 2) / SAFETY)
  textWidth = Math.max(...lines.map((line) => advance(line)))
  nodeWidth = clamp(Math.ceil(Math.max(nodeWidth, textWidth * SAFETY + TEXT.padding * 2)), TEXT.minNodeWidth, TEXT.maxNodeWidth)
  const textHeight = lines.length * TEXT.fontSize * TEXT.lineHeight
  const needed = Math.ceil(textHeight + TEXT.padding * 2)
  let nodeHeight = clamp(Math.max(needed, Number.isFinite(height) ? height : 0), TEXT.minNodeHeight, TEXT.maxNodeHeight)
  return {
    text: lines.join('\n'),
    lines,
    textWidth: Math.ceil(textWidth),
    textHeight,
    width: nodeWidth,
    height: nodeHeight,
  }
}

/** True when two rectangles are closer than `gap` on both axes. */
export function tooClose(a, b, gap = NODE_GAP) {
  return a.x < b.x + b.width + gap && b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap && b.y < a.y + a.height + gap
}

function center(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

/** Two-pole side selection: horizontal for a wide delta, vertical for a tall one. */
function preferredSides(from, to) {
  const a = center(from)
  const b = center(to)
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dx) >= Math.abs(dy)) return { start: dx >= 0 ? 'right' : 'left', end: dx >= 0 ? 'left' : 'right' }
  return { start: dy >= 0 ? 'bottom' : 'top', end: dy >= 0 ? 'top' : 'bottom' }
}

const OUTWARD = 16
function port(rect, side) {
  const c = center(rect)
  if (side === 'right') return { x: rect.x + rect.width, y: c.y, dir: [1, 0] }
  if (side === 'left') return { x: rect.x, y: c.y, dir: [-1, 0] }
  if (side === 'top') return { x: c.x, y: rect.y, dir: [0, -1] }
  return { x: c.x, y: rect.y + rect.height, dir: [0, 1] }
}
function outside(point, stub = OUTWARD) {
  return { x: point.x + point.dir[0] * stub, y: point.y + point.dir[1] * stub }
}
function horizontal(side) {
  return side === 'left' || side === 'right'
}

/** A line segment vs an inflated axis-aligned rectangle (Liang-Barsky). */
export function segmentHitsRect(a, b, rect, margin = 3) {
  const minX = rect.x - margin
  const maxX = rect.x + rect.width + margin
  const minY = rect.y - margin
  const maxY = rect.y + rect.height + margin
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dy = b.y - a.y
  const clip = (p, q) => {
    if (p === 0) return q >= 0
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
    return true
  }
  return clip(-dx, a.x - minX) && clip(dx, maxX - a.x) && clip(-dy, a.y - minY) && clip(dy, maxY - a.y)
}

function segmentsCross(a, b, c, d) {
  const orient = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const o1 = orient(a, b, c)
  const o2 = orient(a, b, d)
  const o3 = orient(c, d, a)
  const o4 = orient(c, d, b)
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)
}

function pathLength(points) {
  let length = 0
  for (let i = 1; i < points.length; i += 1) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  return length
}

/** Obstacle + already-routed-edge cost; lower is a more readable arrow. */
function scorePath(points, obstacles, routed) {
  let obstaclesHit = 0
  let crossings = 0
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    for (const rect of obstacles) if (segmentHitsRect(a, b, rect, 3)) obstaclesHit += 1
    for (const other of routed) {
      if (!Array.isArray(other) || other.length < 2) continue
      for (let j = 1; j < other.length; j += 1) if (segmentsCross(a, b, other[j - 1], other[j])) crossings += 1
    }
  }
  return obstaclesHit * 10000 + crossings * 60 + pathLength(points) * 0.02 + (points.length - 2) * 3
}

function dedupe(points) {
  return points.filter((point, index) => index === 0 || Math.abs(point.x - points[index - 1].x) > 0.25 || Math.abs(point.y - points[index - 1].y) > 0.25)
}

/**
 * A boundary-to-boundary arrow path that avoids every rectangle but its own ends.
 * It tries a direct line, orthogonal H/V/H and V/H/V routes, a mixed route and
 * detours above/below the local and global content, then takes the cheapest.
 */
/** Min-heap for the orthogonal grid search. */
class MinHeap {
  constructor() { this.items = [] }
  get size() { return this.items.length }
  push(value, priority) {
    this.items.push({ value, priority })
    let at = this.items.length - 1
    while (at > 0) {
      const parent = (at - 1) >> 1
      if (this.items[parent].priority <= this.items[at].priority) break
      const swap = this.items[parent]
      this.items[parent] = this.items[at]
      this.items[at] = swap
      at = parent
    }
  }
  pop() {
    const top = this.items[0]
    const last = this.items.pop()
    if (this.items.length > 0) {
      this.items[0] = last
      let at = 0
      for (;;) {
        const left = at * 2 + 1
        const right = left + 1
        let best = at
        if (left < this.items.length && this.items[left].priority < this.items[best].priority) best = left
        if (right < this.items.length && this.items[right].priority < this.items[best].priority) best = right
        if (best === at) break
        const swap = this.items[best]
        this.items[best] = this.items[at]
        this.items[at] = swap
        at = best
      }
    }
    return top
  }
}

const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const TURN_COST = 18
const LANE_COST = 8

/**
 * Orthogonal grid search (Dijkstra with a direction state).
 *
 * The grid is the set of x/y lines just outside every obstacle plus the two
 * port stubs. Because the cost is distance + turns, an arrow takes the shortest
 * corridor between boxes instead of drawing a rectangle around the whole graph.
 * A small per-lane cost spreads parallel arrows into neighbouring lanes instead
 * of stacking them on one line.
 */
function gridRoute(startPort, endPort, from, to, obstacles, routed) {
  const margin = 6
  const stub = 18
  const s = outside(startPort, stub)
  const e = outside(endPort, stub)
  const blocks = [...obstacles, from, to]
  const xs = [...new Set([s.x, e.x, ...blocks.flatMap((rect) => [rect.x - margin - 8, rect.x + rect.width + margin + 8])])].sort((a, b) => a - b)
  const ys = [...new Set([s.y, e.y, ...blocks.flatMap((rect) => [rect.y - margin - 8, rect.y + rect.height + margin + 8])])].sort((a, b) => a - b)
  const xi = new Map(xs.map((x, index) => [x, index]))
  const yi = new Map(ys.map((y, index) => [y, index]))
  const sx = xi.get(s.x)
  const sy = yi.get(s.y)
  const ex = xi.get(e.x)
  const ey = yi.get(e.y)
  if (sx === undefined || sy === undefined || ex === undefined || ey === undefined) return null
  const hLanes = new Map()
  const vLanes = new Map()
  for (const path of routed) {
    for (let i = 1; i < path.length; i += 1) {
      const a = path[i - 1]
      const b = path[i]
      if (Math.abs(a.y - b.y) < 0.5) hLanes.set(a.y, (hLanes.get(a.y) ?? 0) + 1)
      else if (Math.abs(a.x - b.x) < 0.5) vLanes.set(a.x, (vLanes.get(a.x) ?? 0) + 1)
    }
  }
  const key = (x, y, dir) => `${x},${y},${dir}`
  const dist = new Map()
  const prev = new Map()
  const heap = new MinHeap()
  const startDir = startPort.dir[0] === 1 ? 0 : startPort.dir[0] === -1 ? 1 : startPort.dir[1] === 1 ? 2 : 3
  dist.set(key(sx, sy, startDir), 0)
  heap.push({ x: sx, y: sy, dir: startDir }, 0)
  const blocked = (a, b) => blocks.some((rect) => segmentHitsRect(a, b, rect, margin))
  let best = null
  let bestCost = Infinity
  while (heap.size > 0) {
    const { value, priority } = heap.pop()
    const stateKey = key(value.x, value.y, value.dir)
    const realCost = dist.get(stateKey)
    if (realCost === undefined || realCost > priority) continue
    if (value.x === ex && value.y === ey) {
      const incoming = DIRECTIONS[value.dir]
      const exit = [-endPort.dir[0], -endPort.dir[1]]
      const turn = incoming[0] === exit[0] && incoming[1] === exit[1] ? 0 : TURN_COST
      const total = realCost + stub + turn
      if (total < bestCost) {
        bestCost = total
        best = { ...value, cost: total }
      }
    }
    for (let dir = 0; dir < 4; dir += 1) {
      const nx = value.x + DIRECTIONS[dir][0]
      const ny = value.y + DIRECTIONS[dir][1]
      if (nx < 0 || ny < 0 || nx >= xs.length || ny >= ys.length) continue
      const a = { x: xs[value.x], y: ys[value.y] }
      const b = { x: xs[nx], y: ys[ny] }
      if (blocked(a, b)) continue
      const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
      const lane = dir === 0 || dir === 1 ? (hLanes.get(a.y) ?? 0) : (vLanes.get(a.x) ?? 0)
      const cost = realCost + length + (dir !== value.dir ? TURN_COST : 0) + lane * LANE_COST
      const nextKey = key(nx, ny, dir)
      if (cost < (dist.get(nextKey) ?? Infinity)) {
        dist.set(nextKey, cost)
        prev.set(nextKey, { state: value, point: a })
        // A* with the Manhattan lower bound keeps a 200-node scene fast; the
        // distance recorded stays the real path cost.
        heap.push({ x: nx, y: ny, dir }, cost + Math.abs(b.x - e.x) + Math.abs(b.y - e.y))
      }
    }
  }
  if (best === null) return null
  const points = []
  let cursor = { x: best.x, y: best.y, dir: best.dir }
  let stateKey = key(cursor.x, cursor.y, cursor.dir)
  while (stateKey !== key(sx, sy, startDir)) {
    points.push({ x: xs[cursor.x], y: ys[cursor.y] })
    const previous = prev.get(stateKey)
    if (previous === undefined) break
    cursor = previous.state
    stateKey = key(cursor.x, cursor.y, cursor.dir)
  }
  points.push({ x: xs[sx], y: ys[sy] })
  points.reverse()
  return { points: [startPort, ...points, e, endPort], cost: bestCost }
}

/**
 * A boundary-to-boundary arrow path that avoids every rectangle but its own ends.
 *
 * Four side pairings are tried (the preferred one first); each is routed on the
 * orthogonal grid. The cheapest path wins, with obstacle hits and crossings with
 * already-routed arrows as the tie-breakers. The result starts and ends on a side
 * midpoint, so the arrow visually attaches to the box boundary.
 */
export function routeEdge(from, to, obstacles = [], routed = []) {
  if (from.id === to.id) {
    const right = { x: from.x + from.width, y: from.y + from.height / 3, dir: [1, 0] }
    const top = { x: from.x + from.width / 2, y: from.y, dir: [0, -1] }
    const points = [right, { x: right.x + 36, y: right.y }, { x: right.x + 36, y: top.y - 36 }, { x: top.x, y: top.y - 36 }, top]
    return { start: points[0], points: dedupe(points), end: points[points.length - 1] }
  }
  const preferred = preferredSides(from, to)
  const alternate = (side) => {
    if (side === 'left' || side === 'right') return center(to).y >= center(from).y ? 'bottom' : 'top'
    return center(to).x >= center(from).x ? 'right' : 'left'
  }
  const pairs = [
    [preferred.start, preferred.end],
    [alternate(preferred.start), preferred.end],
    [preferred.start, alternate(preferred.end)],
    [alternate(preferred.start), alternate(preferred.end)],
  ]
  let best = null
  let bestScore = Infinity
  for (const [startSide, endSide] of pairs) {
    const result = gridRoute(port(from, startSide), port(to, endSide), from, to, obstacles, routed)
    if (result === null) continue
    const score = scorePath(result.points, obstacles, routed) + result.cost * 0.05
    if (score < bestScore) { best = result.points; bestScore = score }
  }
  if (best === null) best = [port(from, preferred.start), port(to, preferred.end)]
  return { start: best[0], points: dedupe(best), end: best[best.length - 1] }
}

/**
 * Rank every node by longest path over the edges that remain after DFS removes the
 * back edges. A cycle therefore reads left to right instead of collapsing into one
 * column; the remaining backward edge is exactly the one routeEdge must detour.
 */
function rankNodes(ids, outgoing, edges) {
  const color = new Map(ids.map((id) => [id, 0]))
  const back = new Set()
  const visit = (id) => {
    color.set(id, 1)
    for (const to of outgoing.get(id) ?? []) {
      if (color.get(to) === 0) visit(to)
      else if (color.get(to) === 1) back.add(`${id}\u0000${to}`)
    }
    color.set(id, 2)
  }
  for (const id of ids) if (color.get(id) === 0) visit(id)
  const forward = new Map(ids.map((id) => [id, []]))
  const pending = new Map(ids.map((id) => [id, 0]))
  for (const edge of edges) {
    if (!forward.has(edge.from) || !forward.has(edge.to) || edge.from === edge.to) continue
    if (back.has(`${edge.from}\u0000${edge.to}`)) continue
    forward.get(edge.from).push(edge.to)
    pending.set(edge.to, pending.get(edge.to) + 1)
  }
  const rank = new Map(ids.map((id) => [id, 0]))
  const queue = ids.filter((id) => pending.get(id) === 0)
  while (queue.length > 0) {
    const id = queue.shift()
    for (const to of forward.get(id)) {
      rank.set(to, Math.max(rank.get(to), rank.get(id) + 1))
      pending.set(to, pending.get(to) - 1)
      if (pending.get(to) === 0) queue.push(to)
    }
  }
  return rank
}

/**
 * Graph-aware, collision-free placement.
 *
 * Ranks come from the graph with back edges removed, so even a cyclic scene reads
 * left to right; within a rank, nodes are ordered by the mean position of their
 * predecessors. A node with an explicit position is an obstacle and keeps it. Auto
 * nodes take the first free row in their column, `NODE_GAP` away from every
 * occupied rectangle.
 */
export function layoutGraph({ nodes, edges, obstacles = [], originX = 80, originY = 80, gap = NODE_GAP }) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const outgoing = new Map(nodes.map((node) => [node.id, []]))
  const incoming = new Map(nodes.map((node) => [node.id, []]))
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to) || edge.from === edge.to) continue
    outgoing.get(edge.from).push(edge.to)
    incoming.get(edge.to).push(edge.from)
  }
  const rank = rankNodes([...byId.keys()], outgoing, edges)
  let order = nodes.map((node) => node.id)
  for (let pass = 0; pass < 3; pass += 1) {
    const position = new Map(order.map((id, index) => [id, index]))
    const buckets = new Map()
    for (const node of nodes) {
      const r = rank.get(node.id)
      if (!buckets.has(r)) buckets.set(r, [])
      buckets.get(r).push(node.id)
    }
    const next = []
    for (const r of [...buckets.keys()].sort((a, b) => a - b)) {
      const ids = buckets.get(r)
      const barycenter = (id) => {
        const preds = [...new Set(incoming.get(id) ?? [])].map((p) => position.get(p)).filter((n) => n !== undefined)
        return preds.length === 0 ? position.get(id) : preds.reduce((sum, n) => sum + n, 0) / preds.length
      }
      ids.sort((a, b) => barycenter(a) - barycenter(b) || position.get(a) - position.get(b))
      next.push(...ids)
    }
    order = next
  }
  const rankOf = new Map(order.map((id) => [id, rank.get(id)]))
  const ranks = [...new Set(order.map((id) => rankOf.get(id)))].sort((a, b) => a - b)
  const columnWidth = new Map(ranks.map((r) => [r, Math.max(...order.filter((id) => rankOf.get(id) === r).map((id) => byId.get(id).width))]))
  const columnX = new Map()
  let x = originX
  for (const r of ranks) { columnX.set(r, x); x += columnWidth.get(r) + COLUMN_GAP }
  const placed = new Map()
  const occupied = obstacles.map((rect) => ({ ...rect }))
  for (const node of nodes) if (Number.isFinite(node.x) && Number.isFinite(node.y)) occupied.push({ id: node.id, x: node.x, y: node.y, width: node.width, height: node.height })
  for (const r of ranks) {
    let y = originY
    for (const id of order.filter((entry) => rankOf.get(entry) === r)) {
      const node = byId.get(id)
      if (Number.isFinite(node.x) && Number.isFinite(node.y)) { placed.set(id, { x: node.x, y: node.y }); continue }
      const rect = { id, x: columnX.get(r), y, width: node.width, height: node.height }
      let guard = 0
      while (occupied.some((other) => tooClose(rect, other, gap)) && guard < 400) {
        y = Math.max(...occupied.filter((other) => tooClose(rect, other, gap)).map((other) => other.y + other.height + gap), y + 8)
        rect.y = y
        guard += 1
      }
      placed.set(id, { x: rect.x, y: rect.y })
      occupied.push(rect)
      y += node.height + ROW_GAP
    }
  }
  return placed
}

/** Non-finite geometry anywhere is never renderable; the check is cheap and last. */
export function finiteIssues(elements) {
  const issues = []
  for (const element of elements) {
    if (element === null || typeof element !== 'object') continue
    for (const key of ['x', 'y', 'width', 'height']) {
      if (!Number.isFinite(element[key])) issues.push({ kind: 'nonfinite', id: element.id, detail: `${element.id}.${key} is not finite` })
    }
    if (Array.isArray(element.points)) {
      for (const point of element.points) if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) issues.push({ kind: 'nonfinite', id: element.id, detail: `${element.id} has a non-finite point` })
    }
  }
  return issues
}

/**
 * Label clipping, rectangle overlap and arrow-through-rectangle.
 *
 * Clipping is checked on design-map nodes named by `nodeIds` (an upsert must not
 * police a human box it did not touch). Overlap and arrow crossings consider EVERY
 * live rectangle, including plain human shapes - the layout treats those as
 * obstacles, so validation must too. An arrow only skips its own two endpoints.
 */
export function analyzeElements(elements, { gap = NODE_GAP, nodeIds = null, arrowIds = null } = {}) {
  const issues = finiteIssues(elements)
  const live = elements.filter((element) => element !== null && typeof element === 'object' && element.isDeleted !== true)
  const texts = new Map(live.filter((element) => element.type === 'text').map((element) => [element.id, element]))
  const nodes = live.filter((element) => element.type === 'rectangle' && element.customData?.designMap?.kind === 'node')
  const allRects = live.filter((element) => element.type === 'rectangle')
  for (const node of nodes) {
    if (nodeIds !== null && !nodeIds.has(node.id)) continue
    const text = (node.boundElements ?? []).map((entry) => texts.get(entry.id)).find((entry) => entry !== undefined)
    if (text === undefined) continue
    const lines = wrapLabel(text.originalText ?? text.text ?? '', (node.width - TEXT.padding * 2) / SAFETY)
    const neededHeight = lines.length * TEXT.fontSize * TEXT.lineHeight + TEXT.padding * 2
    const neededWidth = Math.max(...lines.map((line) => advance(line))) * SAFETY + TEXT.padding * 2
    if (node.height + 0.5 < neededHeight) issues.push({ kind: 'clip', id: node.id, detail: `${node.id} is ${Math.round(node.height)}px tall; its label needs ${Math.ceil(neededHeight)}px` })
    if (node.width + 0.5 < neededWidth) issues.push({ kind: 'clip', id: node.id, detail: `${node.id} is ${Math.round(node.width)}px wide; its longest line needs ${Math.ceil(neededWidth)}px` })
  }
  for (let i = 0; i < allRects.length; i += 1) {
    for (let j = i + 1; j < allRects.length; j += 1) {
      if (nodeIds !== null && !nodeIds.has(allRects[i].id) && !nodeIds.has(allRects[j].id)) continue
      if (tooClose(allRects[i], allRects[j], gap)) issues.push({ kind: 'overlap', a: allRects[i].id, b: allRects[j].id, detail: `${allRects[i].id} and ${allRects[j].id} overlap or sit closer than ${gap}px` })
    }
  }
  // A boundElements entry that names no live element (or an arrow that no longer
  // binds back to this rectangle) is dangling and will break the next drag.
  const liveIds = new Set(live.map((element) => element.id))
  const arrowMap = new Map(live.filter((element) => element.type === 'arrow').map((element) => [element.id, element]))
  for (const rectangle of allRects) {
    for (const entry of rectangle.boundElements ?? []) {
      if (entry?.id === undefined || !liveIds.has(entry.id)) {
        issues.push({ kind: 'dangling', id: rectangle.id, detail: `${rectangle.id}.boundElements names missing ${String(entry?.id)}` })
      } else if (entry.type === 'arrow') {
        const arrow = arrowMap.get(entry.id)
        if (arrow === undefined || (arrow.startBinding?.elementId !== rectangle.id && arrow.endBinding?.elementId !== rectangle.id)) {
          issues.push({ kind: 'dangling', id: rectangle.id, detail: `${rectangle.id}.boundElements names unbound arrow ${entry.id}` })
        }
      }
    }
  }
  for (const arrow of live.filter((element) => element.type === 'arrow' && (arrowIds === null || arrowIds.has(element.id)))) {
    const skip = new Set([arrow.startBinding?.elementId, arrow.endBinding?.elementId])
    const points = (arrow.points ?? []).map((point) => ({ x: arrow.x + point[0], y: arrow.y + point[1] }))
    for (let i = 1; i < points.length; i += 1) {
      for (const rect of allRects) {
        if (skip.has(rect.id)) continue
        if (segmentHitsRect(points[i - 1], points[i], rect, 2)) issues.push({ kind: 'edge_cross', id: arrow.id, rect: rect.id, detail: `${arrow.id} crosses unrelated rectangle ${rect.id}` })
      }
    }
  }
  return issues
}
