/**
 * PURPOSE: Turn a laid-out diagram scene into SVG markup, with no dependency and no
 *          browser: text is measured arithmetically, edges are routed into an explicit
 *          path, and every colour is a CSS class or a `data-color` hook so the
 *          document's theme tokens own the palette.
 * INPUTS:  a scene (see layout.mjs): { width, height, nodes[], edges[], bands[] } where a
 *          node is { id, x, y, w, h, label, note?, shape, color } and an edge is
 *          { path, label?, color, style?, labelAt? }. Plus the single-node helpers that
 *          layout.mjs calls while the geometry is still being decided.
 * OUTPUTS: renderSceneSvg(scene) -> one `<svg>` string. sizeNode(node) returns `node`
 *          with `lines`, `w` and `h` filled in. routeEdge(from, to, options) returns
 *          { d, labelAt } — `d` is never empty and `labelAt` is null only for a
 *          zero-length route. Nothing throws on a missing label, an empty label or an
 *          unknown shape: an unknown shape falls back to `rect`.
 * KEYWORDS: diagrams, svg, renderer, shapes, edge routing, text metrics, dependency-free.
 *
 * BEHAVIOUR ON EDGE CASES
 *   - textWidth('' ) is 0, so an empty label yields a minimum-size node, never NaN.
 *   - wrapLabel respects explicit `\n` and never breaks a word: a single word longer
 *     than the wrap width stays on one line and widens the node.
 *   - A node with no `label` renders its shape with no text element.
 *   - routeEdge with the same source and target draws a self loop; a route of zero
 *     length still returns a usable `M` command.
 */

/** Font size of a node's main label, in px. */
export const LABEL_SIZE = 14
/** Font size of a node's note line and of a start/end caption, in px. */
export const NOTE_SIZE = 11.5
/** Font size of an edge label, in px. */
export const EDGE_SIZE = 12
/** Line advance of a node's main label, in px. */
const LABEL_LINE = 18
/** Line advance of a node's note, in px. */
const NOTE_LINE = 14
/** Horizontal padding between a node's border and its text. */
const PAD_X = 17
/** Vertical padding between a node's border and its text. */
const PAD_Y = 11
/** Smallest node box the renderer will draw. */
const MIN_W = 78
const MIN_H = 40
/** Wrapping width, in characters, for an unbroken label. */
const WRAP_CHARS = 24
/** Full-width (CJK) code points; these occupy roughly one em per character. */
const WIDE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/
/** The colours a node or an edge may declare; `accent` is the default for emphasis. */
export const COLORS = ['accent', 'info', 'ok', 'warn', 'danger', 'violet', 'cyan', 'muted']

/** The edge line styles a spec may declare. */
export const EDGE_STYLES = ['solid', 'dashed', 'dotted', 'thick']

/** The sides an edge may be pinned to. */
export const SIDES = ['top', 'bottom', 'left', 'right']

/** The shape primitives, in the order the documentation lists them. */
export const SHAPE_NAMES = ['rect', 'round', 'pill', 'diamond', 'circle', 'cylinder', 'parallelogram', 'hexagon', 'note', 'start', 'end']

/**
 * Reports whether a shape name is one the renderer knows.
 * The layout uses this to name an unknown shape in its diagnostics instead of quietly
 * drawing a rectangle, which is the difference between a typo the caller fixes and a
 * diagram that is silently not the one they asked for.
 * @param value - The shape name a spec declared.
 * @returns True when `normalizeShape` would keep it.
 */
export function isShapeName(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHAPES, value.toLowerCase())
}

/**
 * Formats a coordinate: one decimal place, no trailing `.0`, and never `-0`.
 * @param value - Any number produced by the layout.
 * @returns The shortest faithful string for an SVG attribute.
 */
export function num(value) {
  const rounded = Math.round(value * 10) / 10
  return String(rounded === 0 ? 0 : rounded)
}

/**
 * Escapes the five XML-significant characters of text that lands in markup.
 * @param value - Text to escape; null and undefined become the empty string.
 * @returns The escaped text.
 */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Estimates the rendered width of one text line.
 * The estimate is arithmetic on purpose: an SVG string is built without a DOM, and a
 * deterministic width is what lets the same spec produce the same file everywhere.
 * @param text - The line to measure.
 * @param size - Font size in px.
 * @returns Width in px; 0 for an empty line.
 */
export function textWidth(text, size) {
  const value = String(text ?? '')
  let width = 0
  for (const char of value) width += WIDE.test(char) ? size : size * 0.545
  return width
}

/**
 * Splits a label into the lines it will be drawn on.
 * @param label - The raw label; `\n` is honoured as a hard break.
 * @param maxChars - Target wrap width in characters.
 * @returns An array of lines; `['']` for an empty label so callers can count lines.
 */
export function wrapLabel(label, maxChars = WRAP_CHARS) {
  const raw = String(label ?? '')
  const out = []
  for (const segment of raw.split('\n')) {
    const words = segment.split(/\s+/).filter((word) => word.length > 0)
    if (words.length === 0) {
      out.push('')
      continue
    }
    let line = words[0]
    for (let i = 1; i < words.length; i += 1) {
      if ((line + ' ' + words[i]).length <= maxChars) line += ' ' + words[i]
      else {
        out.push(line)
        line = words[i]
      }
    }
    out.push(line)
  }
  return out.length > 0 ? out : ['']
}

/** Shape aliases: every name a spec may use, mapped to the primitive that draws it. */
const SHAPES = {
  rect: 'rect', box: 'rect', process: 'rect', step: 'rect', block: 'rect',
  round: 'round', rounded: 'round', state: 'round', actor: 'round',
  participant: 'round', service: 'round', client: 'round', queue: 'round', topic: 'round',
  pill: 'pill', terminal: 'pill', start_end: 'pill',
  diamond: 'diamond', decision: 'diamond', condition: 'diamond', if: 'diamond',
  circle: 'circle', ellipse: 'circle',
  cylinder: 'cylinder', store: 'cylinder', database: 'cylinder', db: 'cylinder', storage: 'cylinder',
  parallelogram: 'parallelogram', data: 'parallelogram', io: 'parallelogram', input: 'parallelogram',
  hexagon: 'hexagon', loop: 'hexagon', prepare: 'hexagon',
  note: 'note', annotation: 'note',
  start: 'start', begin: 'start',
  end: 'end', stop: 'end', final: 'end',
}

/**
 * Canonicalises a shape name.
 * @param shape - The shape a spec asked for, possibly unknown or absent.
 * @param fallback - The primitive to use when the name is not recognised.
 * @returns One of the SHAPES primitives.
 */
export function normalizeShape(shape, fallback = 'rect') {
  if (typeof shape !== 'string') return fallback
  return SHAPES[shape.toLowerCase()] ?? fallback
}

/**
 * Canonicalises a colour name against the palette.
 * @param color - The requested colour.
 * @returns A palette id, or null when the caller should keep its own default.
 */
export function normalizeColor(color) {
  if (typeof color !== 'string') return null
  const value = color.toLowerCase()
  return COLORS.includes(value) ? value : null
}

/**
 * Measures a node and fills in its box.
 * The node is mutated: `lines` (the wrapped label), `noteLines`, `w` and `h` are set.
 * A `start`/`end` marker is a fixed-diameter circle whose label, if any, is drawn
 * underneath — so its box reserves that caption's height.
 * @param node - A node with at least a `label`.
 * @returns The same node, measurable and placeable.
 */
export function sizeNode(node) {
  const shape = normalizeShape(node.shape, node.shapeFallback ?? 'rect')
  node.shape = shape
  const wrap = Number.isFinite(node.wrap) && node.wrap > 4 ? node.wrap : WRAP_CHARS
  node.lines = wrapLabel(node.label, wrap)
  node.noteLines = node.note ? wrapLabel(node.note, wrap + 6) : []
  const labelW = Math.max(0, ...node.lines.map((line) => textWidth(line, LABEL_SIZE)))
  const noteW = Math.max(0, ...node.noteLines.map((line) => textWidth(line, NOTE_SIZE)))

  if (shape === 'start' || shape === 'end') {
    const dial = shape === 'end' ? 40 : 30
    const caption = node.lines.filter((line) => line.length > 0)
    node.lines = caption
    node.w = Math.max(dial, Math.max(0, ...caption.map((line) => textWidth(line, NOTE_SIZE))) + 8)
    node.h = dial + (caption.length > 0 ? caption.length * NOTE_LINE + 6 : 0)
    return node
  }

  const textW = Math.max(labelW, noteW)
  const textH = node.lines.length * LABEL_LINE + node.noteLines.length * NOTE_LINE
  if (shape === 'diamond') {
    node.w = Math.max(96, textW * 1.9 + 40)
    node.h = Math.max(66, textH * 1.7 + 26)
  } else if (shape === 'circle') {
    const dial = Math.max(58, Math.hypot(textW, textH) + 34)
    node.w = dial
    node.h = dial
  } else if (shape === 'cylinder') {
    node.w = Math.max(MIN_W, textW + PAD_X * 2)
    node.h = Math.max(MIN_H, textH + PAD_Y * 2 + 12)
  } else {
    node.w = Math.max(MIN_W, textW + PAD_X * 2)
    node.h = Math.max(MIN_H, textH + PAD_Y * 2)
  }
  return node
}

/**
 * Builds the outline of one node box.
 * @param node - A sized node (see sizeNode).
 * @returns The shape markup, classed `dg-node__shape`; a cylinder also returns its
 *   lid as `dg-node__detail`.
 */
function shapeMarkup(node) {
  const { x, y, w, h, shape } = node
  const cx = x + w / 2
  const cy = y + h / 2
  const cls = 'class="dg-node__shape"'
  switch (shape) {
    case 'round':
      return `<rect ${cls} x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="12"/>`
    case 'pill':
      return `<rect ${cls} x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${num(h / 2)}"/>`
    case 'diamond':
      return `<polygon ${cls} points="${num(cx)},${num(y)} ${num(x + w)},${num(cy)} `
        + `${num(cx)},${num(y + h)} ${num(x)},${num(cy)}"/>`
    case 'circle':
      return `<circle ${cls} cx="${num(cx)}" cy="${num(cy)}" r="${num(Math.min(w, h) / 2)}"/>`
    case 'cylinder': {
      const r = Math.min(11, h / 4)
      return `<path ${cls} d="M ${num(x)} ${num(y + r)} A ${num(w / 2)} ${num(r)} 0 0 1 ${num(x + w)} ${num(y + r)}`
        + ` L ${num(x + w)} ${num(y + h - r)} A ${num(w / 2)} ${num(r)} 0 0 1 ${num(x)} ${num(y + h - r)} Z"/>`
        + `<path class="dg-node__detail" fill="none" d="M ${num(x)} ${num(y + r)} A ${num(w / 2)} ${num(r)} 0 0 1 ${num(x + w)} ${num(y + r)}"/>`
    }
    case 'parallelogram': {
      const skew = Math.min(16, w * 0.2)
      return `<polygon ${cls} points="${num(x + skew)},${num(y)} ${num(x + w)},${num(y)} `
        + `${num(x + w - skew)},${num(y + h)} ${num(x)},${num(y + h)}"/>`
    }
    case 'hexagon': {
      const skew = Math.min(16, w * 0.18)
      return `<polygon ${cls} points="${num(x + skew)},${num(y)} ${num(x + w - skew)},${num(y)} `
        + `${num(x + w)},${num(cy)} ${num(x + w - skew)},${num(y + h)} ${num(x + skew)},${num(y + h)} `
        + `${num(x)},${num(cy)}"/>`
    }
    case 'note': {
      const fold = Math.min(16, h * 0.35)
      return `<path ${cls} d="M ${num(x)} ${num(y)} H ${num(x + w - fold)} L ${num(x + w)} ${num(y + fold)}`
        + ` V ${num(y + h)} H ${num(x)} Z"/>`
        + `<path class="dg-node__detail" fill="none" d="M ${num(x + w - fold)} ${num(y)} V ${num(y + fold)} H ${num(x + w)}"/>`
    }
    case 'start':
      return `<circle ${cls} cx="${num(cx)}" cy="${num(y + 15)}" r="13"/>`
    case 'end':
      return `<circle ${cls} cx="${num(cx)}" cy="${num(y + 20)}" r="19"/>`
        + `<circle class="dg-node__shape dg-node__shape--solid" cx="${num(cx)}" cy="${num(y + 20)}" r="12"/>`
    default:
      return `<rect ${cls} x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="9"/>`
  }
}

/**
 * Builds the text of one node, centred in its box (or captioned under a start/end dial).
 * @param node - A sized node.
 * @returns The `<text>` markup, or an empty string when the node carries no text.
 */
function nodeTextMarkup(node) {
  const cx = node.x + node.w / 2
  const out = []
  if (node.shape === 'start' || node.shape === 'end') {
    node.lines.forEach((line, index) => {
      const y = node.y + (node.shape === 'end' ? 40 : 30) + 14 + index * NOTE_LINE
      out.push(`<text class="dg-node__note" x="${num(cx)}" y="${num(y)}" text-anchor="middle" dominant-baseline="central">${esc(line)}</text>`)
    })
    return out.join('')
  }
  const lines = node.lines.filter((line) => line.length > 0)
  const total = lines.length * LABEL_LINE + node.noteLines.length * NOTE_LINE
  let cursor = node.y + node.h / 2 - total / 2 + LABEL_LINE / 2
  for (const line of lines) {
    out.push(`<text class="dg-node__label" x="${num(cx)}" y="${num(cursor)}" text-anchor="middle" dominant-baseline="central">${esc(line)}</text>`)
    cursor += LABEL_LINE
  }
  cursor -= LABEL_LINE / 2
  cursor += NOTE_LINE / 2
  for (const line of node.noteLines) {
    out.push(`<text class="dg-node__note" x="${num(cx)}" y="${num(cursor)}" text-anchor="middle" dominant-baseline="central">${esc(line)}</text>`)
    cursor += NOTE_LINE
  }
  return out.join('')
}

/**
 * Builds one placed node: its shape and its text, with the colour hook the theme uses.
 * @param node - A sized and positioned node.
 * @returns The `<g class="dg-node">` markup.
 */
export function nodeMarkup(node) {
  const color = node.color ?? 'muted'
  return `<g class="dg-node" data-shape="${esc(node.shape)}" data-color="${esc(color)}">`
    + shapeMarkup(node)
    + nodeTextMarkup(node)
    + '</g>'
}

/** The point on a box's named side where an edge attaches. */
function anchor(node, side) {
  const cx = node.x + node.w / 2
  const cy = node.y + node.h / 2
  if (side === 'top') return { x: cx, y: node.y }
  if (side === 'bottom') return { x: cx, y: node.y + node.h }
  if (side === 'left') return { x: node.x, y: cy }
  return { x: node.x + node.w, y: cy }
}

/**
 * Chooses the two sides an edge leaves and enters.
 * A spec may override either side; otherwise a target below the source is connected
 * bottom-to-top and a target beside it side-to-side, which is what keeps a layered
 * diagram readable without hand-tuned coordinates.
 * @param from - Source box.
 * @param to - Target box.
 * @returns { fromSide, toSide } as `top` | `bottom` | `left` | `right`.
 */
function chooseSides(from, to) {
  const fromCx = from.x + from.w / 2
  const toCx = to.x + to.w / 2
  const overlapX = Math.min(from.x + from.w, to.x + to.w) - Math.max(from.x, to.x)
  if (overlapX > Math.min(from.w, to.w) * 0.34) return { fromSide: 'bottom', toSide: 'top' }
  const overlapY = Math.min(from.y + from.h, to.y + to.h) - Math.max(from.y, to.y)
  if (overlapY > Math.min(from.h, to.h) * 0.5) {
    return toCx >= fromCx
      ? { fromSide: 'right', toSide: 'left' }
      : { fromSide: 'left', toSide: 'right' }
  }
  return { fromSide: 'bottom', toSide: 'top' }
}

/** Straight-line distance between two points. */
function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** The point `length` px from `from` towards `to`. */
function towards(from, to, length) {
  const d = dist(from, to) || 1
  return { x: from.x + (to.x - from.x) / d * length, y: from.y + (to.y - from.y) / d * length }
}

/**
 * Builds a path through waypoints with rounded corners.
 * @param points - Two or more waypoints.
 * @param radius - Corner radius; clamped so two adjacent corners cannot overlap.
 * @returns An SVG path `d` string.
 */
export function roundedPolyline(points, radius) {
  if (points.length === 0) return 'M 0 0'
  if (points.length === 1) return `M ${num(points[0].x)} ${num(points[0].y)}`
  let d = `M ${num(points[0].x)} ${num(points[0].y)}`
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1]
    const corner = points[i]
    const next = points[i + 1]
    const r = Math.min(radius, dist(prev, corner) / 2, dist(corner, next) / 2)
    const a = towards(corner, prev, r)
    const b = towards(corner, next, r)
    d += ` L ${num(a.x)} ${num(a.y)} Q ${num(corner.x)} ${num(corner.y)} ${num(b.x)} ${num(b.y)}`
  }
  const last = points[points.length - 1]
  return `${d} L ${num(last.x)} ${num(last.y)}`
}

/** The point halfway along a cubic curve — where an edge label sits. */
function cubicMidpoint(p0, c1, c2, p1) {
  return {
    x: (p0.x + 3 * c1.x + 3 * c2.x + p1.x) / 8,
    y: (p0.y + 3 * c1.y + 3 * c2.y + p1.y) / 8,
  }
}

/**
 * The box a route occupies, so the caller can grow the canvas to hold a detour.
 * @param points - The route's control or way points, in final coordinates.
 * @returns { left, right, top, bottom }.
 */
function extentOf(points) {
  return {
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    bottom: Math.max(...points.map((point) => point.y)),
  }
}

/** The midpoint of a polyline's longest segment — where an edge label sits. */
function polylineMidpoint(points) {
  let best = { x: points[0].x, y: points[0].y }
  let bestLen = -1
  for (let i = 1; i < points.length; i += 1) {
    const len = dist(points[i - 1], points[i])
    if (len > bestLen) {
      bestLen = len
      best = { x: (points[i - 1].x + points[i].x) / 2, y: (points[i - 1].y + points[i].y) / 2 }
    }
  }
  return best
}

/**
 * Routes one edge between two boxes.
 * The route is computed in a canonical top-to-bottom space and mirrored for a
 * left-to-right diagram, so there is one set of routing rules rather than two.
 * @param from - Source box { x, y, w, h, id }.
 * @param to - Target box.
 * @param options - { direction?, fromSide?, toSide?, channel?, lane?, bounds?, lead?, radius? }.
 *   `channel` asks for a sideways detour around the outside (used for skip and back edges);
 *   it also suppresses the direct curve, because a skip edge's whole purpose is to avoid
 *   the ranks between its ends. `lane` is the index of that detour so two of them do not
 *   overlap, `bounds` is the box the detour is taken around. A caller-supplied
 *   `fromSide`/`toSide` names a side in the diagram as it will be READ, so it is transposed
 *   internally for a left-to-right diagram: `top` then means the left edge of the box.
 * @returns { d, labelAt, extent, sides } — `d` is the path, `labelAt` the label anchor,
 *   `extent` the box the route occupies (which a detour pushes outside the nodes).
 */
export function routeEdge(from, to, options = {}) {
  const flip = options.direction === 'right'
  const V = (box) => (flip ? { ...box, x: box.y, y: box.x, w: box.h, h: box.w } : box)
  const P = (point) => (flip ? { x: point.y, y: point.x } : point)
  const SIDE_ON_FLIP = { top: 'left', bottom: 'right', left: 'top', right: 'bottom' }
  const sideIn = (side) => (flip && side ? SIDE_ON_FLIP[side] : side)
  const a = V(from)
  const b = V(to)
  // `bounds` arrives in final coordinates, so it is transposed alongside the points: a
  // left-to-right diagram swaps the horizontal extent for the vertical one.
  const B = (box) => (flip && box
    ? { left: box.top, right: box.bottom, top: box.left, bottom: box.right }
    : box)
  const radius = Number.isFinite(options.radius) ? options.radius : 12
  const lead = Number.isFinite(options.lead) ? options.lead : 24
  const bounds = B(options.bounds)

  if (from.id !== undefined && from.id === to.id) {
    const cy = a.y + a.h / 2
    const out = a.x + a.w
    const points = [
      { x: out, y: cy - 13 },
      { x: out + 46, y: cy - 13 },
      { x: out + 46, y: cy + 13 },
      { x: out, y: cy + 13 },
    ].map(P)
    return {
      d: roundedPolyline(points, radius),
      labelAt: P({ x: out + 54, y: cy }),
      extent: extentOf(points),
      sides: { fromSide: 'right', toSide: 'right' },
    }
  }

  const chosen = chooseSides(a, b)
  const fromSide = sideIn(options.fromSide) ?? chosen.fromSide
  const toSide = sideIn(options.toSide) ?? chosen.toSide
  const p0 = anchor(a, fromSide)
  const p1 = anchor(b, toSide)
  const vertical = (fromSide === 'bottom' && toSide === 'top') || (fromSide === 'top' && toSide === 'bottom')
  const forward = fromSide === 'bottom' && toSide === 'top' && p1.y > p0.y + 16
  const sideBySide = fromSide === 'right' && toSide === 'left' && p1.x > p0.x + 16

  // A channel is not a hint: an edge that must avoid the ranks between its ends cannot take
  // the direct curve however well the two sides face each other.
  if (options.channel !== true && (forward || sideBySide)) {
    const gap = forward ? (p1.y - p0.y) : (p1.x - p0.x)
    const bend = Math.max(26, gap * 0.42)
    const c1 = forward ? { x: p0.x, y: p0.y + bend } : { x: p0.x + bend, y: p0.y }
    const c2 = forward ? { x: p1.x, y: p1.y - bend } : { x: p1.x - bend, y: p1.y }
    const mid = cubicMidpoint(p0, c1, c2, p1)
    const start = P(p0)
    const end = P(p1)
    const a1 = P(c1)
    const a2 = P(c2)
    return {
      d: `M ${num(start.x)} ${num(start.y)} C ${num(a1.x)} ${num(a1.y)} ${num(a2.x)} ${num(a2.y)} ${num(end.x)} ${num(end.y)}`,
      labelAt: P(mid),
      extent: extentOf([start, a1, a2, end]),
      sides: { fromSide, toSide },
    }
  }

  const points = [p0]
  if (vertical) {
    points.push({ x: p0.x, y: p0.y + (fromSide === 'bottom' ? lead : -lead) })
    if (options.channel && bounds) {
      const lane = Number.isFinite(options.lane) ? options.lane : 0
      const toRight = p1.x >= p0.x
      const channelX = toRight
        ? bounds.right + 26 + lane * 18
        : bounds.left - 26 - lane * 18
      points.push({ x: channelX, y: p0.y + (fromSide === 'bottom' ? lead : -lead) })
      points.push({ x: channelX, y: p1.y - (toSide === 'top' ? lead : -lead) })
      points.push({ x: p1.x, y: p1.y - (toSide === 'top' ? lead : -lead) })
    } else {
      const midY = (p0.y + p1.y) / 2
      points.push({ x: p0.x, y: midY })
      points.push({ x: p1.x, y: midY })
    }
  } else {
    const outSign = fromSide === 'right' ? 1 : -1
    points.push({ x: p0.x + outSign * lead, y: p0.y })
    if (options.channel && bounds) {
      const lane = Number.isFinite(options.lane) ? options.lane : 0
      const channelY = bounds.bottom + 26 + lane * 18
      points.push({ x: p0.x + outSign * lead, y: channelY })
      points.push({ x: p1.x, y: channelY })
    } else {
      const midX = (p0.x + p1.x) / 2
      points.push({ x: midX, y: p0.y })
      points.push({ x: midX, y: p1.y })
    }
  }
  points.push(p1)
  const mapped = points.map(P)
  return {
    d: roundedPolyline(mapped, radius),
    labelAt: P(polylineMidpoint(points)),
    extent: extentOf(mapped),
    sides: { fromSide, toSide },
  }
}

/**
 * Builds one edge: the line, its arrowhead and its label.
 * @param edge - { path, label?, color?, style?, labelAt?, dashed? }.
 * @returns The `<g class="dg-edge">` markup.
 */
export function edgeMarkup(edge) {
  const color = edge.color ?? 'edge'
  const style = EDGE_STYLES.includes(edge.style) ? edge.style : 'solid'
  const dash = style === 'dashed' || style === 'dotted' || edge.dashed === true
  const parts = [`<path class="dg-edge__line" d="${edge.path}" marker-end="url(#dg-ah-${esc(color)})"/>`]
  if (edge.label && edge.labelAt) {
    const width = textWidth(edge.label, EDGE_SIZE) + 12
    const height = 18
    parts.push(`<rect class="dg-edge__labelbg" x="${num(edge.labelAt.x - width / 2)}" `
      + `y="${num(edge.labelAt.y - height / 2)}" width="${num(width)}" height="${num(height)}" rx="5"/>`)
    parts.push(`<text class="dg-edge__label" x="${num(edge.labelAt.x)}" y="${num(edge.labelAt.y)}" `
      + `text-anchor="middle" dominant-baseline="central">${esc(edge.label)}</text>`)
  }
  return `<g class="dg-edge" data-color="${esc(color)}" data-style="${esc(style)}">${parts.join('')}</g>`
}

/**
 * Builds one band (a named region behind the nodes), or a sequence frame.
 * A band is a dashed region with its name in the corner; a frame (`kind: 'frame'`, used by
 * a sequence diagram's alt/opt/loop) is a solid UML frame with a tab-shaped label, so the
 * two read differently even though they share a geometry.
 * @param band - { x, y, w, h, label?, color?, kind? }.
 * @returns The `<g class="dg-band">` markup.
 */
export function bandMarkup(band) {
  const color = band.color ?? 'muted'
  const frame = band.kind === 'frame'
  const rect = `<rect class="dg-band__rect" x="${num(band.x)}" y="${num(band.y)}" width="${num(band.w)}" height="${num(band.h)}" rx="${frame ? 4 : 14}"/>`
  let head = ''
  if (band.label) {
    const width = textWidth(band.label, 11.5) + 20
    if (frame) {
      const tag = Math.max(52, width)
      head = `<path class="dg-frame__tag" d="M ${num(band.x)} ${num(band.y)} H ${num(band.x + tag)}`
        + ` L ${num(band.x + tag - 12)} ${num(band.y + 24)} H ${num(band.x)} Z"/>`
        + `<text class="dg-frame__label" x="${num(band.x + 9)}" y="${num(band.y + 12)}" dominant-baseline="central">${esc(band.label)}</text>`
      return `<g class="dg-band dg-frame" data-color="${esc(color)}">${rect}${head}</g>`
    }
    head = `<text class="dg-band__label" x="${num(band.x + 16)}" y="${num(band.y + 15)}" dominant-baseline="central">${esc(band.label)}</text>`
  }
  return `<g class="dg-band" data-color="${esc(color)}">${rect}${head}</g>`
}

/**
 * Builds the little shape sample a legend entry shows.
 * It reuses the node painter and the node classes, so a swatch is coloured and shaped by
 * exactly the rules the diagram's own nodes obey.
 * @param shape - The shape name from the legend entry.
 * @param color - The palette id from the legend entry.
 * @returns A standalone `<svg>` swatch, 30x18.
 */
export function swatchMarkup(shape, color) {
  const primitive = normalizeShape(shape, 'rect')
  const node = { x: 2, y: 2, w: 26, h: 14, shape: primitive, lines: [], noteLines: [] }
  return `<svg class="dg-swatch dg-node" data-color="${esc(color)}" data-shape="${esc(primitive)}" `
    + `viewBox="0 0 30 18" width="30" height="18" aria-hidden="true" focusable="false">`
    + shapeMarkup(node)
    + '</svg>'
}

/**
 * Builds the arrowhead markers, one per palette colour.
 * A marker cannot inherit its owner's stroke as a CSS token, so each colour gets its
 * own marker and the theme colours it through the same token the line uses.
 * @returns The `<defs>` markup.
 */
function defsMarkup() {
  const markers = [...COLORS, 'edge'].map((color) =>
    `<marker id="dg-ah-${color}" class="dg-marker" data-color="${color}" viewBox="0 0 10 10" `
    + 'refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">'
    + '<path class="dg-marker__path" d="M 0 0 L 10 5 L 0 10 z"/></marker>').join('')
  return `<defs>${markers}</defs>`
}

/**
 * Renders a whole scene as one `<svg>` element.
 * A route may legitimately leave the node bounding box — a back edge takes a channel
 * outside the graph — so the scene carries an `offset` and every element is drawn inside
 * one translated group, which keeps such a route inside the canvas instead of clipped.
 * @param scene - { width, height, nodes[], edges[], bands[], lines[], offset? }.
 * @returns The SVG markup, sized to the scene so the viewer can scale it.
 */
export function renderSceneSvg(scene) {
  const width = Math.max(1, Math.round(scene.width))
  const height = Math.max(1, Math.round(scene.height))
  const offset = scene.offset ?? { x: 0, y: 0 }
  const bands = (scene.bands ?? []).map(bandMarkup).join('')
  const lines = (scene.lines ?? []).map((line) =>
    `<line class="dg-lifeline" data-color="${esc(line.color ?? 'muted')}" x1="${num(line.x1)}" y1="${num(line.y1)}" `
    + `x2="${num(line.x2)}" y2="${num(line.y2)}"/>`).join('')
  const edges = (scene.edges ?? []).map(edgeMarkup).join('')
  const nodes = (scene.nodes ?? []).map(nodeMarkup).join('')
  const content = `<g class="dg-bands">${bands}</g>`
    + `<g class="dg-lines">${lines}</g>`
    + `<g class="dg-edges">${edges}</g>`
    + `<g class="dg-nodes">${nodes}</g>`
  const moved = offset.x !== 0 || offset.y !== 0
    ? `<g transform="translate(${num(offset.x)} ${num(offset.y)})">${content}</g>`
    : content
  return `<svg id="dg-svg" class="dg-svg" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" `
    + `viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(scene.title ?? 'diagram')}">`
    + defsMarkup()
    + moved
    + '</svg>'
}
