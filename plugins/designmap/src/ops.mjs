/**
 * The map_edit op interpreter: one loose union of operations over a page.
 *
 * WHY A UNION AND NOT A SCHEMA. v1 refused an operation whose field it did not know, with a
 * path into a nested object; the owner's complaint was that the map refused to be drawn. Here
 * an unknown field is ignored with a note, and the only refusals are the ones a caller cannot
 * proceed from: `unknown_page`, `unknown_node` and an edge that names an unknown node. A
 * crowded page, an unlabeled arrow and a missing coordinate are placed sensibly and reported.
 *
 * THE INSTRUMENTS, AND WHY THEY ARE BATCHED. A scheme is not one shape: it is the shape and
 * the diagram around it. Drawn one node per call, the agent cannot see the whole, and the old
 * default put every coordinate-less node BELOW the page - the vertical column the owner was
 * shown. `diagram` takes the whole scheme in one call and lays it out; `layout` repairs a page
 * in place; `node.add` without coordinates takes a free cell in the flow instead of the
 * bottom; `note.add` writes the title the diagram needs.
 *
 * The caller never supplies a seed, a version, a binding or a point: an op names a label and a
 * place, and the builders in elements.mjs emit the element.
 */
import { join } from 'node:path'
import { MapRefusal, SHAPES, createPage, deletePage, readPage, renamePage, writePage } from './pages.mjs'
import { buildEdge, buildNote, buildNode, colorOf, labelOf, nodeSize } from './elements.mjs'
import { hintsOf } from './outline.mjs'
import { analyzeScene } from './lint.mjs'
import { layoutElements, tidyElements } from './tidy.mjs'
import { renderWithExcalidraw } from './excalidraw-render.mjs'

export const OPS = new Set([
  'node.add', 'node.move', 'node.resize', 'node.label', 'node.style',
  'edge.add', 'edge.label', 'element.delete',
  'page.create', 'page.rename', 'page.delete',
  'tidy', 'layout', 'diagram', 'note.add', 'align',
])

const GAP = 48
const CELL_WIDTH = 340
const CELL_HEIGHT = 160

function nextId(elements, prefix) {
  let index = 1
  while (elements.some((entry) => entry.id === `${prefix}${index}`)) index += 1
  return `${prefix}${index}`
}

/** A shape by id; every op that addresses an element fails the same way. */
export function shapeOf(elements, id) {
  const shape = elements.find((entry) => entry?.id === id && SHAPES.has(entry?.type) && entry.isDeleted !== true)
  if (shape === undefined) throw new MapRefusal('unknown_node', `no node "${id}" on this page`)
  return shape
}

function arrowOf(elements, id) {
  const arrow = elements.find((entry) => entry?.id === id && entry.type === 'arrow' && entry.isDeleted !== true)
  if (arrow === undefined) throw new MapRefusal('unknown_node', `no edge "${id}" on this page`)
  return arrow
}

function overlapsRect(a, b, margin = 0) {
  return a.x < b.x + b.width + margin && b.x < a.x + a.width + margin && a.y < b.y + b.height + margin && b.y < a.y + a.height + margin
}

function shapesOn(elements) {
  return elements.filter((entry) => entry?.isDeleted !== true && SHAPES.has(entry?.type))
}

/** The first free cell in a readable grid, instead of the space under the page. */
export function freeCell(elements, size) {
  const width = Math.max(80, size?.width ?? 140)
  const height = Math.max(40, size?.height ?? 56)
  const shapes = shapesOn(elements)
  for (let row = 0; row < 40; row += 1) {
    for (let column = 0; column < 10; column += 1) {
      const candidate = { x: 40 + column * CELL_WIDTH, y: 40 + row * CELL_HEIGHT, width, height }
      if (!shapes.some((shape) => overlapsRect(shape, candidate, 16))) return { x: candidate.x, y: candidate.y }
    }
  }
  return { x: 40, y: 40 }
}

/** Beside an existing node: right of it (or under it), nudged down until the cell is free. */
function spotBeside(elements, anchor, size, below = false) {
  const shapes = shapesOn(elements)
  if (below) {
    let y = anchor.y + anchor.height + GAP
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const candidate = { x: anchor.x, y, width: size.width, height: size.height }
      if (!shapes.some((shape) => overlapsRect(shape, candidate, 16))) return { x: candidate.x, y: candidate.y }
      y += Math.round(size.height + GAP)
    }
    return { x: anchor.x, y: anchor.y + anchor.height + GAP }
  }
  // Step right in small increments so the new box lands near the one it was attached to,
  // not a full box-width away; a row that grows past a readable width drops to the next row.
  let x = anchor.x + anchor.width + GAP
  for (let attempt = 0; attempt < 120 && x < 2400; attempt += 1) {
    const candidate = { x, y: anchor.y, width: size.width, height: size.height }
    if (!shapes.some((shape) => overlapsRect(shape, candidate, 16))) return { x: candidate.x, y: candidate.y }
    x += 32
  }
  return { x: anchor.x, y: anchor.y + anchor.height + GAP }
}

/** The page's shapes as an id map, for arrow re-anchoring. */
function byId(elements) {
  return new Map(elements.filter((entry) => entry !== null && typeof entry === 'object').map((entry) => [entry.id, entry]))
}

/**
 * Re-anchor every arrow whose endpoints both exist: the same arrow object with the points of
 * the current box positions.
 */
function reanchorArrows(elements) {
  const map = byId(elements)
  return elements.map((element) => {
    if (element?.type !== 'arrow') return element
    const from = map.get(element.startBinding?.elementId)
    const to = map.get(element.endBinding?.elementId)
    if (from === undefined || to === undefined || !SHAPES.has(from.type) || !SHAPES.has(to.type)) return element
    const built = buildEdge({ id: element.id, label: labelOf(elements, element.id), from, to, strokeStyle: element.strokeStyle })
    return {
      ...element,
      x: built.arrow.x,
      y: built.arrow.y,
      width: built.arrow.width,
      height: built.arrow.height,
      points: built.arrow.points,
      boundElements: built.arrow.boundElements,
    }
  })
}

/** Translate the shapes in `moves` and their bound texts; then re-anchor every arrow once. */
function moveShapes(elements, moves) {
  const map = byId(elements)
  const moved = elements.map((element) => {
    const target = moves.get(element?.id)
    if (target !== undefined) return { ...element, x: target.x, y: target.y }
    if (element?.type === 'text' && typeof element.containerId === 'string') {
      const source = map.get(element.containerId)
      const destination = moves.get(element.containerId)
      if (source !== undefined && destination !== undefined) {
        return { ...element, x: Math.round(element.x + destination.x - source.x), y: Math.round(element.y + destination.y - source.y) }
      }
    }
    return element
  })
  return reanchorArrows(moved)
}

/**
 * Replace a shape and its bound text with a freshly built pair, keeping the shape's colour.
 *
 * `growOnly` is for a relabel: a human's box size survives unless the new text does not fit,
 * and then the builder's text-sized box takes over. A resize passes explicit width/height and
 * is honoured exactly.
 */
function replaceShape(elements, shape, { label, width, height, type, growOnly = false }) {
  const text = label ?? labelOf(elements, shape.id)
  const wanted = nodeSize(text, type ?? shape.type)
  const built = buildNode({
    id: shape.id,
    type: type ?? shape.type,
    label: text,
    x: shape.x,
    y: shape.y,
    width: growOnly ? Math.max(shape.width, wanted.width) : width,
    height: growOnly ? Math.max(shape.height, wanted.height) : height,
  })
  const nextShape = { ...built.shape, backgroundColor: shape.backgroundColor, strokeColor: shape.strokeColor, strokeStyle: shape.strokeStyle }
  const kept = elements.filter((entry) => entry.id !== shape.id && entry?.containerId !== shape.id)
  kept.push(nextShape)
  if (built.text !== null) kept.push(built.text)
  return reanchorArrows(kept)
}

/** Keep both sides of the binding: the arrow names the shapes, the shapes name the arrow. */
function bindArrow(elements, arrow, fromId, toId) {
  return elements.map((element) => {
    if (element?.id !== fromId && element?.id !== toId) return element
    const bound = Array.isArray(element.boundElements) ? element.boundElements.filter((entry) => entry?.id !== arrow.id) : []
    return { ...element, boundElements: [...bound, { type: 'arrow', id: arrow.id }] }
  })
}

/** Remove one element, its bound text and any arrow attached to it, from both sides. */
function removeElement(elements, id) {
  const attached = new Set([id])
  // An arrow detached from the box keeps pointing at nothing, and its own label would be an
  // orphaned text element; both go with the box.
  for (const element of elements) {
    if (element?.type === 'arrow' && (element.startBinding?.elementId === id || element.endBinding?.elementId === id)) attached.add(element.id)
    if (element?.type === 'text' && attached.has(element.containerId)) attached.add(element.id)
  }
  return elements
    .filter((entry) => !attached.has(entry?.id))
    .map((entry) => (Array.isArray(entry?.boundElements) ? { ...entry, boundElements: entry.boundElements.filter((bind) => !attached.has(bind?.id)) } : entry))
}

function applyLayout(elements, options, notes) {
  const result = layoutElements(elements, options)
  notes.push(`${result.direction} layout: ${result.moved} shape(s) moved, overlaps ${result.overlapsBefore} -> ${result.overlapsAfter}, ${result.layers} layer(s)`)
  return result.elements
}

function countsOf(elements) {
  return { nodes: shapesOn(elements).length, edges: elements.filter((entry) => entry?.type === 'arrow' && entry.isDeleted !== true).length }
}

function verdictOf(scene) {
  const analysis = analyzeScene(scene)
  return { score: analysis.score, verdict: analysis.verdict, counts: analysis.counts }
}

/** Every edge of a `diagram` spec, resolved by id or label. */
function resolveRef(refs, value, what) {
  if (typeof value !== 'string' || value.trim() === '') throw new MapRefusal('unknown_node', `${what} names no node`)
  const exact = refs.get(value)
  if (exact !== undefined) return exact
  const folded = refs.get(value.trim().toLowerCase())
  if (folded !== undefined) return folded
  throw new MapRefusal('unknown_node', `${what} "${value}" is not one of the diagram's nodes`)
}

/**
 * Apply one op and write the page back.
 *
 * @returns `{ ok, page, action, id, nodes, edges, hints, readability }` - the same shape for
 *   every op, so a caller can chain an edit and read the result without a second call.
 */
export function applyOp(designmapDir, op) {
  const kind = typeof op?.op === 'string' ? op.op : ''
  if (!OPS.has(kind)) {
    throw new MapRefusal('unknown_op', `"${kind}" is not one of ${[...OPS].join(', ')}`)
  }
  if (kind === 'page.create') {
    createPage(designmapDir, op.page)
    return { ok: true, page: op.page, action: kind, nodes: 0, edges: 0, hints: [], readability: { score: 100, verdict: 'empty', counts: { high: 0, medium: 0, low: 0, total: 0 } } }
  }
  if (kind === 'page.rename') {
    renamePage(designmapDir, op.page, op.to)
    return { ok: true, page: op.to, action: kind, from: op.page, nodes: 0, edges: 0, hints: [] }
  }
  if (kind === 'page.delete') {
    deletePage(designmapDir, op.page)
    return { ok: true, page: op.page, action: kind, deleted: true, nodes: 0, edges: 0, hints: [] }
  }

  const scene = readPage(designmapDir, op.page)
  let elements = Array.isArray(scene.elements) ? scene.elements.slice() : []
  let id = typeof op.id === 'string' ? op.id : undefined
  let notes = []
  let created = null

  if (kind === 'node.add') {
    id = id ?? nextId(elements, 'n')
    const label = String(op.label ?? '')
    const type = op.kind ?? op.shape ?? 'rectangle'
    const size = nodeSize(label, ['ellipse', 'diamond'].includes(type) ? type : 'rectangle')
    let spot
    if (Number.isFinite(op.x) && Number.isFinite(op.y)) spot = { x: op.x, y: op.y }
    else if (typeof op.from === 'string') spot = spotBeside(elements, shapeOf(elements, op.from), size, op.below === true)
    else spot = freeCell(elements, size)
    const node = buildNode({ id, type, label, x: spot.x, y: spot.y, color: op.color })
    elements.push(node.shape)
    if (node.text !== null) elements.push(node.text)
  } else if (kind === 'node.move') {
    const shape = shapeOf(elements, id)
    const x = Number.isFinite(op.x) ? op.x : shape.x
    const y = Number.isFinite(op.y) ? op.y : shape.y
    elements = moveShapes(elements, new Map([[id, { x, y }]]))
  } else if (kind === 'node.resize') {
    const shape = shapeOf(elements, id)
    const width = Number.isFinite(op.width) && op.width > 0 ? op.width : shape.width
    const height = Number.isFinite(op.height) && op.height > 0 ? op.height : shape.height
    elements = replaceShape(elements, shape, { width, height })
  } else if (kind === 'node.label') {
    elements = replaceShape(elements, shapeOf(elements, id), { label: String(op.label ?? ''), growOnly: true })
  } else if (kind === 'node.style') {
    const shape = shapeOf(elements, id)
    const backgroundColor = typeof op.color === 'string' && op.color.startsWith('#') ? op.color : colorOf(op.color, shape.backgroundColor)
    elements = elements.map((entry) => (entry.id === id ? { ...entry, backgroundColor } : entry))
  } else if (kind === 'edge.add') {
    id = id ?? nextId(elements, 'e')
    const from = shapeOf(elements, op.from)
    const to = shapeOf(elements, op.to)
    const edge = buildEdge({ id, label: op.label ?? '', from, to, strokeStyle: op.style === 'dashed' ? 'dashed' : 'solid' })
    elements = bindArrow(elements, edge.arrow, from.id, to.id)
    elements.push(edge.arrow)
    if (edge.text !== null) elements.push(edge.text)
  } else if (kind === 'edge.label') {
    const arrow = arrowOf(elements, id)
    const from = elements.find((entry) => entry.id === arrow.startBinding?.elementId)
    const to = elements.find((entry) => entry.id === arrow.endBinding?.elementId)
    // Remove the old bound text FIRST, then rebuild the arrow at its new index: deleting the
    // text before the arrow shifted every index after it and rewrote the wrong element.
    elements = elements.filter((entry) => !(entry?.type === 'text' && entry.containerId === arrow.id))
    const index = elements.findIndex((entry) => entry.id === arrow.id)
    if (from === undefined || to === undefined) {
      notes.push('edge label skipped: the arrow has no bound endpoint')
      if (index >= 0) elements[index] = { ...arrow, boundElements: [] }
    } else {
      const edge = buildEdge({ id: arrow.id, label: String(op.label ?? ''), from, to, strokeStyle: arrow.strokeStyle })
      if (index >= 0) elements[index] = edge.arrow
      if (edge.text !== null) elements.push(edge.text)
    }
  } else if (kind === 'element.delete') {
    const ids = Array.isArray(op.ids) ? op.ids : [id]
    for (const target of ids) {
      if (typeof target !== 'string' || target === '') continue
      elements = removeElement(elements, target)
    }
  } else if (kind === 'note.add') {
    id = id ?? nextId(elements, 't')
    const text = String(op.text ?? op.label ?? '')
    const note = buildNote({ id, text, x: Number.isFinite(op.x) ? op.x : 40, y: Number.isFinite(op.y) ? op.y : 40, fontSize: op.fontSize, color: op.color })
    if (!Number.isFinite(op.x) && !Number.isFinite(op.y)) {
      const spot = freeCell(elements, note)
      note.x = spot.x
      note.y = spot.y
    }
    elements.push(note)
  } else if (kind === 'tidy') {
    const result = tidyElements(elements)
    elements = result.elements
    notes = notes.concat([`overlaps ${result.overlapsBefore} -> ${result.overlapsAfter}`, `${result.moved} shape(s) moved`])
  } else if (kind === 'layout') {
    elements = applyLayout(elements, {
      direction: op.direction === 'TB' ? 'TB' : 'LR',
      nodeGap: op.nodeGap,
      layerGap: op.layerGap,
      originX: op.x,
      originY: op.y,
    }, notes)
  } else if (kind === 'diagram') {
    if (op.replace === true) elements = []
    const specs = Array.isArray(op.nodes) ? op.nodes : []
    if (specs.length === 0) throw new MapRefusal('invalid_diagram', 'diagram needs at least one node')
    const refs = new Map()
    const nodeIds = []
    for (const spec of specs) {
      const nodeId = typeof spec?.id === 'string' && spec.id !== '' ? spec.id : nextId(elements, 'n')
      if (elements.some((entry) => entry?.id === nodeId)) throw new MapRefusal('duplicate_id', `node id "${nodeId}" already exists on this page`)
      const node = buildNode({ id: nodeId, type: spec?.kind ?? 'rectangle', label: spec?.label ?? '', x: 0, y: 0, color: spec?.color })
      elements.push(node.shape)
      if (node.text !== null) elements.push(node.text)
      refs.set(nodeId, nodeId)
      const label = String(spec?.label ?? '').trim()
      if (label !== '') refs.set(label.toLowerCase(), nodeId)
      nodeIds.push(nodeId)
    }
    const edgeIds = []
    for (const spec of Array.isArray(op.edges) ? op.edges : []) {
      const fromId = resolveRef(refs, spec?.from, 'edge.from')
      const toId = resolveRef(refs, spec?.to, 'edge.to')
      const edgeId = typeof spec?.id === 'string' && spec.id !== '' ? spec.id : nextId(elements, 'e')
      const from = shapeOf(elements, fromId)
      const to = shapeOf(elements, toId)
      const edge = buildEdge({ id: edgeId, label: spec?.label ?? '', from, to, strokeStyle: spec?.style === 'dashed' ? 'dashed' : 'solid' })
      elements = bindArrow(elements, edge.arrow, fromId, toId)
      elements.push(edge.arrow)
      if (edge.text !== null) elements.push(edge.text)
      edgeIds.push(edgeId)
    }
    elements = applyLayout(elements, {
      direction: op.direction === 'TB' ? 'TB' : 'LR',
      nodeGap: op.nodeGap,
      layerGap: op.layerGap,
      originX: Number.isFinite(op.x) ? op.x : undefined,
      originY: Number.isFinite(op.y) ? op.y : undefined,
    }, notes)
    created = { nodes: nodeIds, edges: edgeIds }
    id = undefined
  } else if (kind === 'align') {
    const mode = typeof op.mode === 'string' ? op.mode : 'left'
    const shapes = Array.isArray(op.ids) && op.ids.length > 0
      ? op.ids.map((target) => shapeOf(elements, target))
      : shapesOn(elements)
    if (shapes.length < 2) throw new MapRefusal('too_few_nodes', 'align needs at least two boxes')
    const moves = new Map()
    if (mode === 'left') {
      const x = Math.min(...shapes.map((shape) => shape.x))
      for (const shape of shapes) moves.set(shape.id, { x, y: shape.y })
    } else if (mode === 'right') {
      const edge = Math.max(...shapes.map((shape) => shape.x + shape.width))
      for (const shape of shapes) moves.set(shape.id, { x: edge - shape.width, y: shape.y })
    } else if (mode === 'top') {
      const y = Math.min(...shapes.map((shape) => shape.y))
      for (const shape of shapes) moves.set(shape.id, { x: shape.x, y })
    } else if (mode === 'center-x') {
      const center = shapes.reduce((total, shape) => total + shape.x + shape.width / 2, 0) / shapes.length
      for (const shape of shapes) moves.set(shape.id, { x: Math.round(center - shape.width / 2), y: shape.y })
    } else if (mode === 'center-y') {
      const center = shapes.reduce((total, shape) => total + shape.y + shape.height / 2, 0) / shapes.length
      for (const shape of shapes) moves.set(shape.id, { x: shape.x, y: Math.round(center - shape.height / 2) })
    } else if (mode === 'distribute-x' || mode === 'distribute-y') {
      const horizontal = mode === 'distribute-x'
      const sorted = shapes.slice().sort((left, right) => (horizontal ? left.x - right.x : left.y - right.y))
      const first = horizontal ? sorted[0].x : sorted[0].y
      const last = horizontal ? sorted[sorted.length - 1].x : sorted[sorted.length - 1].y
      const step = (last - first) / (sorted.length - 1)
      sorted.forEach((shape, index) => moves.set(shape.id, horizontal ? { x: Math.round(first + step * index), y: shape.y } : { x: shape.x, y: Math.round(first + step * index) }))
    } else {
      throw new MapRefusal('unknown_mode', `align mode "${mode}" is not one of left, right, top, center-x, center-y, distribute-x, distribute-y`)
    }
    elements = moveShapes(elements, moves)
  }

  scene.elements = elements
  writePage(designmapDir, op.page, scene)
  const counts = countsOf(elements)
  return {
    ok: true,
    page: op.page,
    action: kind,
    ...(id === undefined ? {} : { id }),
    ...counts,
    ...(created === null ? {} : { created }),
    hints: hintsOf(scene),
    readability: verdictOf(scene),
    notes,
  }
}

/**
 * Render one page with Excalidraw itself (headless Chromium): out/<page>.png and, when the
 * editor's own export yields one, out/<page>.svg.
 *
 * There is no writer of ours in this path: the PNG is a capture of Excalidraw's canvas with the
 * editor chrome hidden, and the SVG is Excalidraw's own export. A missing browser refuses
 * `renderer_unavailable` and the page file is never touched by a render.
 */
export async function renderPage(designmapDir, page) {
  const scene = readPage(designmapDir, page)
  const outDir = join(designmapDir, 'out')
  const rendered = await renderWithExcalidraw(Array.isArray(scene.elements) ? scene.elements : [], outDir, page)
  // The renderer's whole answer, including the page bounds: a caller can then tell a fitted
  // picture (image covers bounds) from a cropped one.
  return { ok: true, page, ...rendered, readability: verdictOf(scene) }
}
