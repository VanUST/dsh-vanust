/**
 * Element builders: the ONE place that knows how an Excalidraw element is shaped.
 *
 * WHY IT EXISTS. An Excalidraw scene is not JSON a caller can hand-write: a shape needs a
 * bound text element AND a `boundElements` entry, an arrow needs `startBinding`/`endBinding`
 * to the ids it points at, and every element needs a seed, a version and a versionNonce or the
 * editor re-seeds it on load. The op layer therefore passes LABELS and PLACES, and this module
 * emits elements the editor accepts. Seeds are derived from the element id, so two builds of
 * the same page are byte-identical (a fixture, a diff and a test all need that).
 *
 * The skeleton is the one the shipped adapter already writes
 * (client/excalidraw.js:75-104) so a page file opens in the same frame, plus the bound-text and
 * binding fields Excalidraw 0.18 expects.
 */

export const SHAPE_TYPES = new Set(['rectangle', 'ellipse', 'diamond'])
export const NODE_FONT_SIZE = 13
export const NODE_LINE_HEIGHT = 1.25
export const EDGE_FONT_SIZE = 11
export const EDGE_LINE_HEIGHT = 1.25
const CHAR_WIDTH = 6.9
const MIN_NODE_WIDTH = 140
const MAX_NODE_WIDTH = 300
const NODE_PADDING_X = 16
const NODE_PADDING_Y = 14
const LINE_HEIGHT_PX = NODE_FONT_SIZE * NODE_LINE_HEIGHT
export const NODE_GAP = 48
export const LAYER_GAP = 96
const INK = '#1e1e1e'
const NODE_FILL = '#a5d8ff'
const EDGE_INK = '#495057'

/** FNV-1a over the id: a deterministic 32-bit seed the editor accepts as a number. */
export function seedOf(text) {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % 2147483647
}

/** The Excalidraw element skeleton every builder starts from. */
export function element(type, id, fields) {
  return {
    id,
    type,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: INK,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: seedOf(id),
    version: 1,
    versionNonce: seedOf(`nonce:${id}`),
    isDeleted: false,
    boundElements: [],
    updated: 1,
    link: null,
    locked: false,
    ...fields,
  }
}

/** Width of one line in the editor's default font: the only estimate this module makes. */
export function textWidth(text) {
  return Math.ceil(String(text ?? '').length * CHAR_WIDTH)
}

/** Greedy wrap at a character budget; a word longer than the budget stays on its own line. */
export function wrapLabel(label, maxChars) {
  const words = String(label ?? '').split(/\s+/).filter((word) => word !== '')
  if (words.length === 0) return ['']
  const lines = []
  let line = ''
  for (const word of words) {
    const next = line === '' ? word : `${line} ${word}`
    if (next.length <= maxChars || line === '') line = next
    else { lines.push(line); line = word }
  }
  lines.push(line)
  return lines
}

/** The box a label needs: wide enough for two words, tall enough for every line. */
export function nodeSize(label) {
  const maxChars = Math.floor((MAX_NODE_WIDTH - NODE_PADDING_X * 2) / CHAR_WIDTH)
  const lines = wrapLabel(label, maxChars)
  const widest = lines.reduce((max, line) => Math.max(max, line.length), 0)
  const width = Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, Math.ceil(widest * CHAR_WIDTH) + NODE_PADDING_X * 2))
  const height = Math.max(56, Math.ceil(lines.length * LINE_HEIGHT_PX) + NODE_PADDING_Y * 2)
  return { width, height, lines }
}

/**
 * One node: the shape and its bound text.
 *
 * A missing label is not a refusal - a box with no text is a valid drawing - so the text
 * element is skipped and the shape stays unbound.
 */
export function buildNode({ id, type = 'rectangle', label = '', x = 0, y = 0, width, height }) {
  if (!SHAPE_TYPES.has(type)) type = 'rectangle'
  const size = nodeSize(label)
  const w = Number.isFinite(width) && width > 0 ? width : size.width
  const h = Number.isFinite(height) && height > 0 ? height : size.height
  const textId = `${id}:label`
  const text = String(label ?? '')
  const shape = element(type, id, {
    x,
    y,
    width: w,
    height: h,
    backgroundColor: NODE_FILL,
    roundness: type === 'rectangle' ? { type: 3 } : null,
    boundElements: text === '' ? [] : [{ type: 'text', id: textId }],
  })
  if (text === '') return { shape, text: null }
  const lines = wrapLabel(text, Math.max(8, Math.floor((w - NODE_PADDING_X * 2) / CHAR_WIDTH)))
  const textHeight = Math.ceil(lines.length * LINE_HEIGHT_PX)
  const bound = element('text', textId, {
    x: x + NODE_PADDING_X,
    y: y + Math.max(4, (h - textHeight) / 2),
    width: Math.max(24, w - NODE_PADDING_X * 2),
    height: textHeight,
    text: lines.join('\n'),
    originalText: text,
    fontSize: NODE_FONT_SIZE,
    fontFamily: 2,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: id,
    lineHeight: NODE_LINE_HEIGHT,
    strokeColor: INK,
  })
  return { shape, text: bound }
}

/** The centre of a box. */
function centre(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * The two anchor points an arrow uses.
 *
 * The side is chosen by the dominant axis so the arrow leaves the box it starts from towards
 * the box it points at, and the endpoints sit on the boundary the binding will slide along.
 */
export function anchors(from, to) {
  const a = centre(from)
  const b = centre(to)
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sx = dx >= 0 ? from.x + from.width : from.x
    const tx = dx >= 0 ? to.x : to.x + to.width
    return { start: { x: sx, y: a.y }, end: { x: tx, y: b.y } }
  }
  const sy = dy >= 0 ? from.y + from.height : from.y
  const ty = dy >= 0 ? to.y : to.y + to.height
  return { start: { x: a.x, y: sy }, end: { x: b.x, y: ty } }
}

/**
 * One edge: a bound arrow, and its label as a text bound to the arrow.
 *
 * `startBinding`/`endBinding` are what keeps the arrow attached when either box moves; the
 * shapes' `boundElements` entries are added by the caller, because a builder that mutated the
 * shape it was given would make every op order-sensitive.
 */
export function buildEdge({ id, label = '', from, to, strokeStyle = 'solid' }) {
  const { start, end } = anchors(from, to)
  const textId = `${id}:label`
  const text = String(label ?? '')
  const points = [[0, 0], [Math.round(end.x - start.x), Math.round(end.y - start.y)]]
  const arrow = element('arrow', id, {
    x: start.x,
    y: start.y,
    width: end.x - start.x,
    height: end.y - start.y,
    points,
    strokeColor: EDGE_INK,
    strokeWidth: 1.4,
    strokeStyle,
    startArrowhead: null,
    endArrowhead: 'arrow',
    startBinding: { elementId: from.id, focus: 0, gap: 1 },
    endBinding: { elementId: to.id, focus: 0, gap: 1 },
    boundElements: text === '' ? [] : [{ type: 'text', id: textId }],
  })
  if (text === '') return { arrow, text: null }
  const width = Math.max(28, textWidth(text) + 12)
  const bound = element('text', textId, {
    x: Math.round((start.x + end.x) / 2 - width / 2),
    y: Math.round((start.y + end.y) / 2 - 10),
    width,
    height: Math.ceil(EDGE_FONT_SIZE * EDGE_LINE_HEIGHT),
    text,
    originalText: text,
    fontSize: EDGE_FONT_SIZE,
    fontFamily: 2,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: id,
    lineHeight: EDGE_LINE_HEIGHT,
    strokeColor: EDGE_INK,
  })
  return { arrow, text: bound }
}

/** The label text currently shown for an element, from its bound text element. */
export function labelOf(elements, id) {
  const bound = elements.find((entry) => entry?.containerId === id && entry?.type === 'text')
  return bound === undefined ? '' : String(bound.originalText ?? bound.text ?? '')
}
