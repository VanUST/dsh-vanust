/**
 * Deterministic layered placement: rank by edge direction, size a box to its text, place the
 * ranks left to right with a fixed gap.
 *
 * WHY OUR OWN LAYOUT. v1 ran ELK and then refused a scene whose boxes were too close. The
 * owner's rule is that a crowded page still opens: layout is a convenience, so a plain
 * longest-path ranking is enough, and being deterministic matters more than being optimal -
 * the same page must produce the same coordinates on every run, so a diff means a change.
 *
 * A cycle has no rank; nodes inside it are placed after the ranks they did reach, and the
 * caller's hint list still reports whatever overlaps remain. Tidy never refuses a page.
 */
import { NODE_GAP, LAYER_GAP, buildEdge, buildNode, labelOf } from './elements.mjs'
import { arrowsOf, shapesOf } from './outline.mjs'
import { SHAPES } from './pages.mjs'

const ORIGIN_X = 40
const ORIGIN_Y = 40

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
 * One tidy pass over a page's elements.
 *
 * IT MOVES, IT DOES NOT REBUILD. The first version re-emitted every shape through the builder
 * and every arrow through buildEdge, and skipped bound texts because their container would
 * emit them - so a labelled arrow whose endpoints were not both placed lost its label text
 * (measured on the imported system page: 46 elements in, 45 out, e.orch.designmap:label gone).
 * A tidy is a repositioning: every element the page has must still be there afterwards, with
 * the same id and the same fields, only some x/y changed.
 *
 * @returns `{ elements, moved, overlapsBefore, overlapsAfter }`: the page's elements in their
 *   original order, how many shapes changed place, and the overlap count before and after.
 */
export function tidyElements(elements, { originX = ORIGIN_X, originY = ORIGIN_Y } = {}) {
  const list = Array.isArray(elements) ? elements : []
  const shapes = shapesOf(list)
  const rank = ranksOf(list)
  const layers = new Map()
  for (const shape of shapes) {
    const level = rank.get(shape.id) ?? 0
    if (!layers.has(level)) layers.set(level, [])
    layers.get(level).push(shape)
  }
  /** Where each shape goes: its new top-left and the text-sized box tidy measured for it. */
  const placed = new Map()
  let cursorX = originX
  let moved = 0
  for (const level of [...layers.keys()].sort((left, right) => left - right)) {
    const column = layers.get(level).slice().sort((left, right) => {
      const a = labelOf(list, left.id) || left.id
      const b = labelOf(list, right.id) || right.id
      return a.localeCompare(b) || left.id.localeCompare(right.id)
    })
    const boxes = column.map((shape) => buildNode({ id: shape.id, type: shape.type, label: labelOf(list, shape.id) }).shape)
    const columnWidth = boxes.reduce((max, box) => Math.max(max, box.width), 0)
    let cursorY = originY
    for (let index = 0; index < column.length; index += 1) {
      const box = boxes[index]
      const x = Math.round(cursorX + (columnWidth - box.width) / 2)
      const y = Math.round(cursorY)
      if (Math.round(column[index].x) !== x || Math.round(column[index].y) !== y) moved += 1
      placed.set(column[index].id, { id: column[index].id, x, y, width: box.width, height: box.height })
      cursorY += box.height + NODE_GAP
    }
    cursorX += columnWidth + LAYER_GAP
  }

  // Move, never re-emit: each element keeps its id, type and every field, and only the position
  // fields of the elements tidy relocated change.
  const moved_ = list.map((element) => {
    if (element === null || typeof element !== 'object') return element
    const own = placed.get(element.id)
    if (own !== undefined) return { ...element, x: own.x, y: own.y }
    if (typeof element.containerId === 'string') {
      const container = placed.get(element.containerId)
      const original = list.find((entry) => entry?.id === element.containerId)
      if (container !== undefined && original !== undefined) {
        return { ...element, x: Math.round(container.x + (element.x - original.x)), y: Math.round(container.y + (element.y - original.y)) }
      }
    }
    return element
  })

  // Arrows follow their boxes: the same arrow object, re-anchored between the new positions.
  const byId = new Map(moved_.map((element) => [element?.id, element]))
  const arrows = moved_.map((element) => {
    if (element?.type !== 'arrow') return element
    const from = element.startBinding?.elementId
    const to = element.endBinding?.elementId
    const source = byId.get(from)
    const target = byId.get(to)
    if (source === undefined || target === undefined || !placed.has(from) || !placed.has(to)) return element
    const edge = buildEdge({ id: element.id, label: labelOf(list, element.id), from: source, to: target, strokeStyle: element.strokeStyle })
    return { ...element, x: edge.arrow.x, y: edge.arrow.y, points: edge.arrow.points, width: edge.arrow.width, height: edge.arrow.height }
  })

  return {
    elements: arrows,
    moved,
    overlapsBefore: overlapPairs(shapes),
    overlapsAfter: overlapPairs(shapesOf(arrows)),
  }
}
