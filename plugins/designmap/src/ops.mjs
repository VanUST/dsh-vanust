/**
 * The map_edit op interpreter: one loose union of eleven ops over a page.
 *
 * WHY A UNION AND NOT A SCHEMA. v1 refused an operation whose field it did not know, with a
 * path into a nested object; the owner's complaint was that the map refused to be drawn. Here
 * an unknown field is ignored with a note, and the only refusals are the two a caller cannot
 * proceed from: `unknown_page` and `unknown_node`. Everything else - a crowded page, an
 * unlabeled arrow, a missing coordinate - is placed sensibly and reported as a hint.
 *
 * The caller never supplies a seed, a version, a binding or a point: an op names a label and a
 * place, and the builders in elements.mjs emit the element.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MapRefusal, SHAPES, createPage, deletePage, readPage, renamePage, writePage } from './pages.mjs'
import { buildEdge, buildNode, labelOf } from './elements.mjs'
import { hintsOf } from './outline.mjs'
import { renderWithExcalidraw } from './excalidraw-render.mjs'
import { tidyElements } from './tidy.mjs'

export const OPS = new Set([
  'node.add', 'node.move', 'node.resize', 'node.label',
  'edge.add', 'edge.label', 'element.delete',
  'page.create', 'page.rename', 'page.delete', 'tidy',
])

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

/** Remove one element and the text bound to it; a deleted shape takes its arrows with it. */
function removeElement(elements, id) {
  const kept = elements.filter((entry) => entry?.id !== id && entry?.containerId !== id)
  return kept.filter((entry) => entry?.type !== 'arrow' || (entry.startBinding?.elementId !== id && entry.endBinding?.elementId !== id))
}

/** The free spot below the page: where a node without a place lands. */
function nextSpot(elements) {
  let bottom = 0
  for (const entry of elements) {
    if (!SHAPES.has(entry?.type)) continue
    bottom = Math.max(bottom, (entry.y ?? 0) + (entry.height ?? 0))
  }
  return { x: 40, y: bottom + 48 }
}

function replaceLabel(elements, id, label, { width, height, x, y } = {}) {
  const kept = elements.filter((entry) => !(entry?.type === 'text' && entry.containerId === id))
  const anchor = kept.find((entry) => entry.id === id)
  const built = buildNode({
    id,
    type: anchor?.type ?? 'rectangle',
    label,
    x: x ?? anchor?.x ?? 0,
    y: y ?? anchor?.y ?? 0,
    width: width ?? anchor?.width,
    height: height ?? anchor?.height,
  })
  const index = kept.findIndex((entry) => entry.id === id)
  kept[index] = built.shape
  if (built.text !== null) kept.push(built.text)
  return kept
}

/**
 * Apply one op and write the page back.
 *
 * @returns `{ ok, page, action, id, nodes, edges, hints }` - the same shape map_read uses,
 *   so a caller can chain an edit and read without a second call.
 */
export function applyOp(designmapDir, op) {
  const kind = typeof op?.op === 'string' ? op.op : ''
  if (!OPS.has(kind)) {
    throw new MapRefusal('unknown_op', `"${kind}" is not one of ${[...OPS].join(', ')}`)
  }
  if (kind === 'page.create') {
    createPage(designmapDir, op.page)
    return { ok: true, page: op.page, action: kind, nodes: 0, edges: 0, hints: [] }
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

  if (kind === 'node.add') {
    id = id ?? nextId(elements, 'n')
    const spot = Number.isFinite(op.x) && Number.isFinite(op.y) ? { x: op.x, y: op.y } : nextSpot(elements)
    const node = buildNode({ id, type: op.kind ?? op.shape ?? 'rectangle', label: op.label ?? '', x: spot.x, y: spot.y })
    elements.push(node.shape)
    if (node.text !== null) elements.push(node.text)
  } else if (kind === 'node.move') {
    const shape = shapeOf(elements, id)
    const x = Number.isFinite(op.x) ? op.x : shape.x
    const y = Number.isFinite(op.y) ? op.y : shape.y
    const dx = x - shape.x
    const dy = y - shape.y
    elements = elements.map((entry) => (entry.id === id || entry.containerId === id ? { ...entry, x: entry.x + dx, y: entry.y + dy } : entry))
    for (const arrow of elements.filter((entry) => entry.type === 'arrow' && (entry.startBinding?.elementId === id || entry.endBinding?.elementId === id))) {
      const index = elements.findIndex((entry) => entry.id === arrow.id)
      elements[index] = { ...arrow, x: arrow.x + dx * 0.5, y: arrow.y + dy * 0.5 }
    }
  } else if (kind === 'node.resize') {
    const shape = shapeOf(elements, id)
    const width = Number.isFinite(op.width) && op.width > 0 ? op.width : shape.width
    const height = Number.isFinite(op.height) && op.height > 0 ? op.height : shape.height
    elements = replaceLabel(elements, id, labelOf(elements, id), { width, height })
  } else if (kind === 'node.label') {
    shapeOf(elements, id)
    elements = replaceLabel(elements, id, String(op.label ?? ''))
  } else if (kind === 'edge.add') {
    id = id ?? nextId(elements, 'e')
    const from = shapeOf(elements, op.from)
    const to = shapeOf(elements, op.to)
    const edge = buildEdge({ id, label: op.label ?? '', from, to })
    elements.push(edge.arrow)
    if (edge.text !== null) elements.push(edge.text)
  } else if (kind === 'edge.label') {
    const arrow = arrowOf(elements, id)
    elements = elements.filter((entry) => !(entry?.type === 'text' && entry.containerId === arrow.id))
    const from = elements.find((entry) => entry.id === arrow.startBinding?.elementId)
    const to = elements.find((entry) => entry.id === arrow.endBinding?.elementId)
    const index = elements.findIndex((entry) => entry.id === arrow.id)
    if (from === undefined || to === undefined) {
      notes.push('edge label skipped: the arrow has no bound endpoint')
      elements[index] = { ...arrow, boundElements: [] }
    } else {
      const edge = buildEdge({ id: arrow.id, label: String(op.label ?? ''), from, to, strokeStyle: arrow.strokeStyle })
      elements[index] = edge.arrow
      if (edge.text !== null) elements.push(edge.text)
    }
  } else if (kind === 'element.delete') {
    elements.length = 0
    elements.push(...removeElement(Array.isArray(scene.elements) ? scene.elements : [], id))
  } else if (kind === 'tidy') {
    const result = tidyElements(Array.isArray(scene.elements) ? scene.elements : [])
    elements = result.elements
    notes = notes.concat([`overlaps ${result.overlapsBefore} -> ${result.overlapsAfter}`, `${result.moved} shape(s) moved`])
  }

  scene.elements = elements
  writePage(designmapDir, op.page, scene)
  const shapes = elements.filter((entry) => SHAPES.has(entry?.type)).length
  const arrows = elements.filter((entry) => entry?.type === 'arrow').length
  return { ok: true, page: op.page, action: kind, id, nodes: shapes, edges: arrows, hints: hintsOf(scene), notes }
}

/**
 * Render one page with Excalidraw itself (headless Chromium): out/<page>.png and, when the
 * editor's own export yields one, out/<page>.svg.
 *
 * There is no writer of ours in this path any more: the PNG is a capture of Excalidraw's
 * canvas and the SVG is Excalidraw's export. A missing browser refuses `renderer_unavailable`
 * and the page file is never touched by a render.
 */
export async function renderPage(designmapDir, page) {
  const scene = readPage(designmapDir, page)
  const outDir = join(designmapDir, 'out')
  const rendered = await renderWithExcalidraw(Array.isArray(scene.elements) ? scene.elements : [], outDir, page)
  // The renderer's whole answer, including the page bounds: a caller can then tell a fitted
  // picture (image covers bounds) from a cropped one.
  return { ok: true, page, ...rendered }
}
