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
const MIN_NODE_HEIGHT = 56
const MAX_NODE_WIDTH = 300
const NODE_PADDING_X = 16
const NODE_PADDING_Y = 14
const LINE_HEIGHT_PX = NODE_FONT_SIZE * NODE_LINE_HEIGHT
export const NODE_GAP = 48
export const LAYER_GAP = 96
/**
 * Excalidraw's own bound-text padding (v0.18.1 constant.ts `BOUND_TEXT_PADDING`).
 *
 * THE SHAPE GROWS ON LOAD when the text does not fit the INSCRIBED area, not the outer box:
 * a rectangle offers `width - 2*5`, an ellipse `round(width/2*sqrt2) - 10`, a diamond
 * `round(width/2) - 10` (packages/excalidraw/element/textElement.ts,
 * `getBoundTextMaxWidth`/`redrawTextBoundingBox`). A label measured against the outer box
 * therefore produced a box Excalidraw silently widened, and two neighbours that were apart
 * in the file overlapped on screen. The builders size every shape for its inscribed area.
 */
export const BOUND_TEXT_PADDING = 5
export const ELLIPSE_INSCRIBED = Math.SQRT2
export const INK = '#1e1e1e'
export const NODE_FILL = '#a5d8ff'
export const EDGE_INK = '#495057'

/** Named fills, so a scheme can separate domains without hand-writing a colour. */
export const NODE_COLORS = {
  blue: '#a5d8ff',
  green: '#b2f2bb',
  red: '#ffc9c9',
  yellow: '#ffec99',
  violet: '#d0bfff',
  grey: '#e9ecef',
  white: '#ffffff',
  none: 'transparent',
}

export function colorOf(name, fallback = NODE_FILL) {
  if (typeof name !== 'string' || name === '') return fallback
  return NODE_COLORS[name.toLowerCase()] ?? fallback
}

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
    index: null,
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

/** The width Excalidraw lets a bound text use inside a shape, by the shape's inscribed area. */
export function innerTextWidth(type, width) {
  if (type === 'ellipse') return Math.max(8, Math.round((width / 2) * ELLIPSE_INSCRIBED) - BOUND_TEXT_PADDING * 2)
  if (type === 'diamond') return Math.max(8, Math.round(width / 2) - BOUND_TEXT_PADDING * 2)
  return Math.max(8, Math.round(width) - BOUND_TEXT_PADDING * 2)
}

/** The height Excalidraw lets a bound text use inside a shape. */
export function innerTextHeight(type, height) {
  if (type === 'ellipse') return Math.max(8, Math.round((height / 2) * ELLIPSE_INSCRIBED) - BOUND_TEXT_PADDING * 2)
  if (type === 'diamond') return Math.max(8, Math.round(height / 2) - BOUND_TEXT_PADDING * 2)
  return Math.max(8, Math.round(height) - BOUND_TEXT_PADDING * 2)
}

/** The smallest shape that holds this text INSIDE its inscribed area (Excalidraw 0.18.1). */
function sizedToText(textWanted, textHeightWanted, type) {
  const wanted = Math.ceil(textWanted + BOUND_TEXT_PADDING * 2)
  const wantedHeight = Math.ceil(textHeightWanted + BOUND_TEXT_PADDING * 2)
  if (type === 'ellipse') {
    return { width: Math.ceil(wanted * ELLIPSE_INSCRIBED), height: Math.ceil(wantedHeight * ELLIPSE_INSCRIBED) }
  }
  if (type === 'diamond') return { width: wanted * 2, height: wantedHeight * 2 }
  return { width: wanted, height: wantedHeight }
}

/**
 * The box a label needs: wide enough for two words, tall enough for every line, and large
 * enough that Excalidraw does not have to grow it on load.
 */
export function nodeSize(label, type = 'rectangle') {
  const maxChars = Math.floor((MAX_NODE_WIDTH - NODE_PADDING_X * 2) / CHAR_WIDTH)
  const lines = wrapLabel(label, maxChars)
  const widest = lines.reduce((max, line) => Math.max(max, line.length), 0)
  const textWanted = Math.max(widest * CHAR_WIDTH, MIN_NODE_WIDTH - NODE_PADDING_X * 2)
  const textHeightWanted = lines.length * LINE_HEIGHT_PX
  const box = sizedToText(textWanted, textHeightWanted, type)
  return {
    width: Math.max(type === 'rectangle' ? MIN_NODE_WIDTH : MIN_NODE_WIDTH + 20, box.width),
    height: Math.max(type === 'rectangle' ? MIN_NODE_HEIGHT : MIN_NODE_HEIGHT + 12, box.height),
    lines,
  }
}

/**
 * One node: the shape and its bound text.
 *
 * A missing label is not a refusal - a box with no text is a valid drawing - so the text
 * element is skipped and the shape stays unbound.
 */
export function buildNode({ id, type = 'rectangle', label = '', x = 0, y = 0, width, height, color }) {
  if (!SHAPE_TYPES.has(type)) type = 'rectangle'
  const size = nodeSize(label, type)
  const w = Number.isFinite(width) && width > 0 ? width : size.width
  const h = Number.isFinite(height) && height > 0 ? height : size.height
  const textId = `${id}:label`
  const text = String(label ?? '')
  const shape = element(type, id, {
    x,
    y,
    width: w,
    height: h,
    backgroundColor: colorOf(color),
    roundness: type === 'rectangle' ? { type: 3 } : null,
    boundElements: text === '' ? [] : [{ type: 'text', id: textId }],
  })
  if (text === '') return { shape, text: null }
  const maxWidth = innerTextWidth(type, w)
  const lines = wrapLabel(text, Math.max(8, Math.floor(maxWidth / CHAR_WIDTH)))
  const textHeight = Math.ceil(lines.length * LINE_HEIGHT_PX)
  const textBoxWidth = Math.max(24, Math.min(maxWidth, Math.ceil(Math.max(...lines.map((line) => line.length)) * CHAR_WIDTH)))
  const bound = element('text', textId, {
    x: x + Math.round((w - textBoxWidth) / 2),
    y: y + Math.round((h - textHeight) / 2),
    width: textBoxWidth,
    height: textHeight,
    text: lines.join('\n'),
    originalText: text,
    fontSize: NODE_FONT_SIZE,
    fontFamily: 2,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: id,
    autoResize: false,
    lineHeight: NODE_LINE_HEIGHT,
    strokeColor: INK,
  })
  return { shape, text: bound }
}

/** A free note on the page: text with no container, for a title or an explanation. */
export function buildNote({ id, text = '', x = 0, y = 0, fontSize = 16, color }) {
  const value = String(text ?? '')
  const lines = value.split('\n')
  const width = Math.max(24, textWidth(lines.reduce((longest, line) => (line.length > longest.length ? line : longest), '')))
  const height = Math.max(20, Math.ceil(lines.length * fontSize * 1.25))
  return element('text', id, {
    x,
    y,
    width,
    height,
    text: value,
    originalText: value,
    fontSize,
    fontFamily: 2,
    textAlign: 'left',
    verticalAlign: 'top',
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
    strokeColor: colorOf(color, INK),
  })
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
 *
 * THE LABEL WRAPS AT EXCALIDRAW'S OWN BUDGET. A bound arrow label's max width is
 * `max(0.7 * arrow.width, 11 * fontSize)` (textElement.ts `getBoundTextMaxWidth`), and the
 * editor recomputes the label position as its middle-segment midpoint on load - the stored
 * x/y is not honoured. The builder therefore wraps the label to that budget itself, so the
 * picture the tool lays out is the picture the editor draws.
 */
export function buildEdge({ id, label = '', from, to, strokeStyle = 'solid', startArrowhead = null, endArrowhead = 'arrow' }) {
  const { start, end } = anchors(from, to)
  const textId = `${id}:label`
  const text = String(label ?? '')
  const points = [[0, 0], [Math.round(end.x - start.x), Math.round(end.y - start.y)]]
  const labelMaxWidth = Math.max(Math.round(0.7 * Math.abs(end.x - start.x)), EDGE_FONT_SIZE * 11)
  const lines = wrapLabel(text, Math.max(8, Math.floor(labelMaxWidth / CHAR_WIDTH)))
  const rendered = lines.join('\n')
  const arrow = element('arrow', id, {
    x: start.x,
    y: start.y,
    width: end.x - start.x,
    height: end.y - start.y,
    points,
    lastCommittedPoint: null,
    elbowed: false,
    strokeColor: EDGE_INK,
    strokeWidth: 1.4,
    strokeStyle,
    startArrowhead,
    endArrowhead,
    startBinding: { elementId: from.id, focus: 0, gap: 1 },
    endBinding: { elementId: to.id, focus: 0, gap: 1 },
    boundElements: text === '' ? [] : [{ type: 'text', id: textId }],
  })
  if (text === '') return { arrow, text: null, labelMaxWidth }
  const widest = lines.reduce((max, line) => Math.max(max, line.length), 0)
  const width = Math.max(24, Math.min(labelMaxWidth, Math.ceil(widest * CHAR_WIDTH) + 4))
  const height = Math.ceil(lines.length * EDGE_FONT_SIZE * EDGE_LINE_HEIGHT)
  const bound = element('text', textId, {
    x: Math.round((start.x + end.x) / 2 - width / 2),
    y: Math.round((start.y + end.y) / 2 - height / 2),
    width,
    height,
    text: rendered,
    originalText: text,
    fontSize: EDGE_FONT_SIZE,
    fontFamily: 2,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: id,
    autoResize: false,
    lineHeight: EDGE_LINE_HEIGHT,
    strokeColor: EDGE_INK,
  })
  return { arrow, text: bound, labelMaxWidth }
}

/** The label text currently shown for an element, from its bound text element. */
export function labelOf(elements, id) {
  const bound = elements.find((entry) => entry?.containerId === id && entry?.type === 'text')
  return bound === undefined ? '' : String(bound.originalText ?? bound.text ?? '')
}
