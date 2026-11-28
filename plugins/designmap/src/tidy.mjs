/**
 * Deterministic layered placement: rank by edge direction, size a box to its text, place the
 * ranks as columns (left to right) or rows (top to bottom), with the gaps the edge labels need.
 *
 * WHY OUR OWN LAYOUT. v1 ran ELK and then refused a scene whose boxes were too close. The
 * owner's rule is that a crowded page still opens: layout is a convenience, so a plain
 * longest-path ranking is enough, and being deterministic matters more than being optimal -
 * the same page must produce the same coordinates on every run, so a diff means a change.
 *
 * THE GAP IS MEASURED, NOT GUESSED. Excalidraw draws a bound arrow label at the middle of the
 * arrow, and the label's max width is `max(0.7 * arrow.width, 11 * fontSize)` (v0.18.1
 * `textElement.ts`). A fixed 96 px gap therefore put a longer label ("reads model") on top of
 * its two boxes - the defect the owner saw. Each layer boundary now gets at least the widest
 * label that crosses it plus 24 px.
 *
 * IT MOVES, IT DOES NOT REBUILD. Every element the page has must still be there afterwards,
 * with the same id: shapes are resized to their text and moved, their bound text follows them,
 * an arrow is re-anchored between the new box positions and its own bound text moves with it.
 *
 * A cycle has no rank; nodes inside it are placed after the ranks they did reach, and the
 * caller's hint list still reports whatever overlaps remain. Tidy never refuses a page.
 */
import { LAYER_GAP, NODE_GAP, buildEdge, buildNode, labelOf, textWidth } from './elements.mjs'
import { arrowsOf, shapesOf } from './outline.mjs'

const ORIGIN_X = 40
const ORIGIN_Y = 40
const LABEL_MARGIN = 24

/** Longest-path ranks over the shape ids, cycle-safe by construction. */
export function ranksOf(elements) {
  const shapes = shapesOf(elements)
  const ids = new Set(shapes.map((shape) => shape.id))
  const edges = []
  for (const arrow of arrowsOf(elements)) {
    const from = arrow.startBinding?.elementId
    const to = arrow.endBinding?.elementId
    if (ids.has(from) && ids.has(to) && from !== to) edges.push([from, to])
  }
  const rank = new Map([...ids].map((id) => [id, 0]))
  // Relaxation bounded by the node count: a cycle stops improving instead of looping.
  for (let pass = 0; pass < ids.size; pass += 1) {
    let changed = false
    for (const [from, to] of edges) {
      const next = Math.min(rank.get(from) + 1, ids.size - 1)
      if (rank.get(to) < next) { rank.set(to, next); changed = true }
    }
    if (!changed) break
  }
  return rank
}

function overlapPairs(shapes) {
  let pairs = 0
  for (let left = 0; left < shapes.length; left += 1) {
    for (let right = left + 1; right < shapes.length; right += 1) {
      const a = shapes[left]
      const b = shapes[right]
      const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      if (w > 0 && h > 0) pairs += 1
    }
  }
  return pairs
}

/**
 * The layer order: rank first, then a barycentre pass over the neighbours to reduce crossings.
 *
 * A tie keeps the scene order, so the same page always produces the same picture.
 */
function layeredOrder(elements, rank) {
  const shapes = shapesOf(elements)
  const order = new Map(shapes.map((shape, index) => [shape.id, index]))
  const layers = new Map()
  for (const shape of shapes) {
    const level = rank.get(shape.id) ?? 0
    if (!layers.has(level)) layers.set(level, [])
    layers.get(level).push(shape)
  }
  const preds = new Map()
  const succs = new Map()
  for (const arrow of arrowsOf(elements)) {
    const from = arrow.startBinding?.elementId
    const to = arrow.endBinding?.elementId
    if (!order.has(from) || !order.has(to) || from === to) continue
    if (!preds.has(to)) preds.set(to, [])
    if (!succs.has(from)) succs.set(from, [])
    preds.get(to).push(from)
    succs.get(from).push(to)
  }
  const levels = [...layers.keys()].sort((left, right) => left - right)
  const position = new Map()
  for (const level of levels) {
    layers.get(level).forEach((shape, index) => position.set(shape.id, index))
  }
  const barycentre = (shape, neighbours) => {
    const ids = neighbours.get(shape.id) ?? []
    const known = ids.filter((id) => position.has(id))
    if (known.length === 0) return null
    return known.reduce((total, id) => total + position.get(id), 0) / known.length
  }
  const sortLayer = (layer, neighbours) => {
    layer.sort((left, right) => {
      const a = barycentre(left, neighbours)
      const b = barycentre(right, neighbours)
      if (a === null && b === null) return order.get(left.id) - order.get(right.id)
      if (a === null) return 1
      if (b === null) return -1
      return a - b || order.get(left.id) - order.get(right.id)
    })
    layer.forEach((shape, index) => position.set(shape.id, index))
  }
  for (let pass = 0; pass < 4; pass += 1) {
    for (let index = 1; index < levels.length; index += 1) sortLayer(layers.get(levels[index]), preds)
    for (let index = levels.length - 2; index >= 0; index -= 1) sortLayer(layers.get(levels[index]), succs)
  }
  return { levels, layers }
}

/** The widest edge label crossing each layer boundary (by source level). */
function labelWidthByLevel(elements, rank) {
  const widths = new Map()
  for (const arrow of arrowsOf(elements)) {
    const from = arrow.startBinding?.elementId
    const to = arrow.endBinding?.elementId
    if (!rank.has(from) || !rank.has(to)) continue
    const level = rank.get(from)
    const width = textWidth(labelOf(elements, arrow.id))
    widths.set(level, Math.max(widths.get(level) ?? 0, width))
  }
  return widths
}

/**
 * Lay a page out as layers.
 *
 * @param elements - the page's elements.
 * @param options - `{direction: 'LR'|'TB', nodeGap, layerGap, originX, originY}`.
 * @returns `{ elements, moved, overlapsBefore, overlapsAfter, direction, layers }`: the page's
 *   elements in their original order, how many shapes changed place, and the overlap count
 *   before and after.
 */
export function layoutElements(elements, options = {}) {
  const list = Array.isArray(elements) ? elements : []
  const direction = options.direction === 'TB' ? 'TB' : 'LR'
  const nodeGap = Number.isFinite(options.nodeGap) && options.nodeGap > 0 ? Math.round(options.nodeGap) : NODE_GAP
  const baseLayerGap = Number.isFinite(options.layerGap) && options.layerGap > 0 ? Math.round(options.layerGap) : LAYER_GAP
  const originX = Number.isFinite(options.originX) ? Math.round(options.originX) : ORIGIN_X
  const originY = Number.isFinite(options.originY) ? Math.round(options.originY) : ORIGIN_Y
  const shapes = shapesOf(list)
  const rank = ranksOf(list)
  const { levels, layers } = layeredOrder(list, rank)
  const labelWidths = labelWidthByLevel(list, rank)

  /** Where each shape goes: its new top-left and the text-sized box the builder measured. */
  const placed = new Map()
  let moved = 0
  if (direction === 'LR') {
    let cursorX = originX
    for (const level of levels) {
      const column = layers.get(level)
      const boxes = column.map((shape) => ({ shape, box: buildNode({ id: shape.id, type: shape.type, label: labelOf(list, shape.id) }).shape }))
      const columnWidth = boxes.reduce((max, entry) => Math.max(max, entry.box.width), 0)
      let cursorY = originY
      for (const entry of boxes) {
        const x = Math.round(cursorX + (columnWidth - entry.box.width) / 2)
        const y = Math.round(cursorY)
        if (Math.round(entry.shape.x) !== x || Math.round(entry.shape.y) !== y) moved += 1
        placed.set(entry.shape.id, { id: entry.shape.id, x, y, width: entry.box.width, height: entry.box.height })
        cursorY += entry.box.height + nodeGap
      }
      cursorX += columnWidth + Math.max(baseLayerGap, (labelWidths.get(level) ?? 0) + LABEL_MARGIN)
    }
  } else {
    let cursorY = originY
    for (const level of levels) {
      const row = layers.get(level)
      const boxes = row.map((shape) => ({ shape, box: buildNode({ id: shape.id, type: shape.type, label: labelOf(list, shape.id) }).shape }))
      const rowHeight = boxes.reduce((max, entry) => Math.max(max, entry.box.height), 0)
      let cursorX = originX
      for (const entry of boxes) {
        const x = Math.round(cursorX)
        const y = Math.round(cursorY + (rowHeight - entry.box.height) / 2)
        if (Math.round(entry.shape.x) !== x || Math.round(entry.shape.y) !== y) moved += 1
        placed.set(entry.shape.id, { id: entry.shape.id, x, y, width: entry.box.width, height: entry.box.height })
        cursorX += entry.box.width + nodeGap
      }
      cursorY += rowHeight + Math.max(baseLayerGap, (labelWidths.get(level) ?? 0) + LABEL_MARGIN)
    }
  }

  // Move, never re-emit: each element keeps its id, type and every field; shapes get the place
  // and size of their text, their bound text follows them, and an arrow is re-anchored.
  const relocated = list.map((element) => {
    if (element === null || typeof element !== 'object') return element
    const own = placed.get(element.id)
    if (own !== undefined) return { ...element, x: own.x, y: own.y, width: own.width, height: own.height }
    if (typeof element.containerId === 'string' && element.type === 'text') {
      const container = placed.get(element.containerId)
      if (container !== undefined) {
        const width = Number.isFinite(element.width) ? element.width : container.width
        const height = Number.isFinite(element.height) ? element.height : 20
        return { ...element, x: Math.round(container.x + (container.width - width) / 2), y: Math.round(container.y + (container.height - height) / 2) }
      }
    }
    return element
  })

  // Arrows follow their boxes: the same arrow object, re-anchored between the new positions,
  // with its label text moved to the new middle. A bound arrow label's own position is
  // recomputed by the editor from the arrow's middle segment, so this is for the file only.
  const byId = new Map(relocated.map((element) => [element?.id, element]))
  const arrows = relocated.map((element) => {
    if (element?.type !== 'arrow') return element
    const from = element.startBinding?.elementId
    const to = element.endBinding?.elementId
    const source = byId.get(from)
    const target = byId.get(to)
    if (source === undefined || target === undefined || !placed.has(from) || !placed.has(to)) return element
    const edge = buildEdge({ id: element.id, label: labelOf(list, element.id), from: source, to: target, strokeStyle: element.strokeStyle })
    return { ...element, x: edge.arrow.x, y: edge.arrow.y, points: edge.arrow.points, width: edge.arrow.width, height: edge.arrow.height }
  })
  const arrowText = new Map()
  for (const element of arrows) {
    if (element?.type !== 'arrow') continue
    const from = byId.get(element.startBinding?.elementId)
    const to = byId.get(element.endBinding?.elementId)
    if (from === undefined || to === undefined || !placed.has(from.id) || !placed.has(to.id)) continue
    const label = labelOf(list, element.id)
    if (label === '') continue
    const edge = buildEdge({ id: element.id, label, from, to, strokeStyle: element.strokeStyle })
    if (edge.text !== null) arrowText.set(edge.text.id, edge.text)
  }
  const settled = arrows.map((element) => {
    const replacement = element?.type === 'text' && typeof element.containerId === 'string' ? arrowText.get(element.id) : undefined
    if (replacement === undefined) return element
    return { ...element, x: replacement.x, y: replacement.y, width: replacement.width, height: replacement.height, text: replacement.text, originalText: replacement.originalText }
  })

  return {
    elements: settled,
    moved,
    overlapsBefore: overlapPairs(shapes),
    overlapsAfter: overlapPairs(shapesOf(settled)),
    direction,
    layers: levels.length,
  }
}

/**
 * The `tidy` op: one left-to-right pass. Kept as its own name because the panel's button, the
 * command and the agent's `tidy` op all call it.
 */
export function tidyElements(elements, { originX = ORIGIN_X, originY = ORIGIN_Y } = {}) {
  const result = layoutElements(elements, { direction: 'LR', originX, originY })
  return {
    elements: result.elements,
    moved: result.moved,
    overlapsBefore: result.overlapsBefore,
    overlapsAfter: result.overlapsAfter,
  }
}
