/**
 * The readability check of one page: measured findings, each with the repair op that fixes it.
 *
 * WHY IT EXISTS. The page always opens - that is the v2 rule - so the only way an agent learns
 * that its drawing is unreadable is by being told. Three hints (overlap, off-canvas, unlabelled
 * arrow) were not enough: an edge label lying on a node, an arrow crossing a third box, a
 * label that does not fit its shape and a page that grew into one vertical column all rendered
 * "fine" and were invisible to the reader.
 *
 * IT NEVER REFUSES. `analyzeScene` is a pure read of the elements: no write, no throw for a bad
 * drawing. Every finding names the elements it measured, the measured value and a `repair` the
 * caller can send to `map_edit` unchanged when the repair is an op it knows.
 *
 * THE MEASUREMENTS ARE EXCALIDRAW'S OWN. A bound text fits an INSCRIBED area, not the outer
 * box: a rectangle offers `width - 10`, an ellipse `round(width/2*sqrt2) - 10`, a diamond
 * `round(width/2) - 10` (v0.18.1 `textElement.ts` `getBoundTextMaxWidth`), and the editor
 * grows the shape on load when the text does not fit. A check measured against the outer box
 * passed a page Excalidraw then widened into its neighbour, so `innerTextWidth` from
 * elements.mjs is the one owner of that formula.
 */
import { NODE_LINE_HEIGHT, innerTextHeight, innerTextWidth, labelOf, nodeSize, wrapLabel } from './elements.mjs'
import { SHAPES } from './pages.mjs'

const NODE_FONT = 13
const LINE_NODE = NODE_FONT * NODE_LINE_HEIGHT
const CLEARANCE = 24
const OVERLAP_EPSILON = 0.5

/** Severity order for a stable report: the page-breaking findings come first. */
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 }
const PENALTY = { high: 18, medium: 8, low: 3 }

export const SEVERITIES = Object.keys(SEVERITY_RANK)

const finite = (value) => typeof value === 'number' && Number.isFinite(value)

export function isShape(element) {
  return element !== null && typeof element === 'object' && element.isDeleted !== true && SHAPES.has(element.type)
}

export function isArrow(element) {
  return element !== null && typeof element === 'object' && element.isDeleted !== true && element.type === 'arrow'
}

export function isBoundText(element) {
  return element !== null && typeof element === 'object' && element.isDeleted !== true && element.type === 'text' && typeof element.containerId === 'string'
}

export function isFreeText(element) {
  return element !== null && typeof element === 'object' && element.isDeleted !== true && element.type === 'text' && typeof element.containerId !== 'string'
}

/** Shapes, arrows and free text that are actually drawn. */
export function drawn(elements) {
  return (Array.isArray(elements) ? elements : []).filter((element) => element !== null && typeof element === 'object' && element.isDeleted !== true)
}

/** A box, or null when the element carries no usable geometry. */
export function boxOf(element) {
  if (element === null || typeof element !== 'object') return null
  if (element.type === 'arrow') {
    const points = Array.isArray(element.points) ? element.points : []
    if (!finite(element.x) || !finite(element.y) || points.length === 0) return null
    const xs = points.map((point) => element.x + (finite(point?.[0]) ? point[0] : 0))
    const ys = points.map((point) => element.y + (finite(point?.[1]) ? point[1] : 0))
    const left = Math.min(...xs)
    const top = Math.min(...ys)
    return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top }
  }
  if (![element.x, element.y, element.width, element.height].every(finite)) return null
  return { x: element.x, y: element.y, width: element.width, height: element.height }
}

/** The clockwise box corners, for a segment/box test. */
export function rectSegments(rect) {
  const { x, y, width: w, height: h } = rect
  return [
    [[x, y], [x + w, y]],
    [[x + w, y], [x + w, y + h]],
    [[x + w, y + h], [x, y + h]],
    [[x, y + h], [x, y]],
  ]
}

function pointInRect(point, rect) {
  return point[0] >= rect.x && point[0] <= rect.x + rect.width && point[1] >= rect.y && point[1] <= rect.y + rect.height
}

/** Do two segments cross? Collinear touching counts only when the touch is on both segments. */
export function segmentsCross(a, b) {
  const [[ax, ay], [ax2, ay2]] = a
  const [[bx, by], [bx2, by2]] = b
  const orient = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px)
  const o1 = orient(ax, ay, ax2, ay2, bx, by)
  const o2 = orient(ax, ay, ax2, ay2, bx2, by2)
  const o3 = orient(bx, by, bx2, by2, ax, ay)
  const o4 = orient(bx, by, bx2, by2, ax2, ay2)
  const eps = 0.01
  const opposite = (left, right) => (left > eps && right < -eps) || (left < -eps && right > eps)
  if (opposite(o1, o2) && opposite(o3, o4)) return true
  const onSegment = (px, py, qx, qy, rx, ry) => Math.abs(orient(px, py, qx, qy, rx, ry)) <= eps
    && rx >= Math.min(px, qx) - eps && rx <= Math.max(px, qx) + eps
    && ry >= Math.min(py, qy) - eps && ry <= Math.max(py, qy) + eps
  if (Math.abs(o1) <= eps && onSegment(ax, ay, ax2, ay2, bx, by)) return true
  if (Math.abs(o2) <= eps && onSegment(ax, ay, ax2, ay2, bx2, by2)) return true
  if (Math.abs(o3) <= eps && onSegment(bx, by, bx2, by2, ax, ay)) return true
  return Math.abs(o4) <= eps && onSegment(bx, by, bx2, by2, ax2, ay2)
}

/** Does a segment pass through a box (an endpoint inside, or a crossing with one edge)? */
export function segmentHitsRect(segment, rect) {
  if (pointInRect(segment[0], rect) || pointInRect(segment[1], rect)) return true
  return rectSegments(rect).some((edge) => segmentsCross(segment, edge))
}

function overlaps(a, b) {
  if (a === null || b === null) return null
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width > OVERLAP_EPSILON && height > OVERLAP_EPSILON ? { width, height, area: width * height } : null
}

/** The segments of an arrow in page coordinates. */
export function arrowSegments(arrow) {
  if (arrow === null || arrow.type !== 'arrow' || !finite(arrow.x) || !finite(arrow.y)) return []
  const points = Array.isArray(arrow.points) ? arrow.points : []
  const absolute = points.map((point) => [arrow.x + (finite(point?.[0]) ? point[0] : 0), arrow.y + (finite(point?.[1]) ? point[1] : 0)])
  const segments = []
  for (let index = 1; index < absolute.length; index += 1) segments.push([absolute[index - 1], absolute[index]])
  return segments
}

/** The drawn label box of a shape, arrow or free text; null when it has no text. */
export function labelBox(elements, element) {
  const bound = elements.find((entry) => entry?.containerId === element?.id && entry?.type === 'text' && entry.isDeleted !== true)
  return bound === undefined ? null : boxOf(bound)
}

/**
 * A free grid cell for a box of this size, so a repair can name coordinates.
 *
 * Deterministic: the same page returns the same cell. It ignores the target itself, so the
 * suggestion is "put it here", not "put it where it already is".
 */
export function freeSpotFor(shape, shapes) {
  const width = Math.max(40, shape.width ?? 140)
  const height = Math.max(32, shape.height ?? 56)
  const others = shapes.filter((entry) => entry.id !== shape.id)
  for (let row = 0; row < 40; row += 1) {
    for (let column = 0; column < 12; column += 1) {
      const candidate = { x: 40 + column * 240, y: 40 + row * 128, width, height }
      if (!others.some((other) => overlaps(boxOf(other), candidate) !== null)) return { x: candidate.x, y: candidate.y }
    }
  }
  return { x: 40, y: 40 }
}

/** Page bounds of everything drawn; `{x,y,width,height,empty}`. */
export function layoutBounds(elements) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const element of drawn(elements)) {
    const box = boxOf(element)
    if (box === null) continue
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.width)
    maxY = Math.max(maxY, box.y + box.height)
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0, empty: true }
  return { x: Math.floor(minX), y: Math.floor(minY), width: Math.ceil(maxX - minX), height: Math.ceil(maxY - minY), empty: false }
}

function finding(code, severity, elements, measure, message, repair = null) {
  return { code, severity, elements: elements.filter((value) => typeof value === 'string' && value !== ''), measure, message, repair }
}

/** How the bound text of a shape measures against the area Excalidraw gives it. */
function shapeLabelFit(element, label, box) {
  const maxWidth = innerTextWidth(element.type, box.width)
  const maxHeight = innerTextHeight(element.type, box.height)
  const longestWord = label.split(/\s+/).reduce((longest, word) => (word.length > longest.length ? word : longest), '')
  const widestLine = Math.ceil(longestWord.length * 6.9)
  const maxChars = Math.max(4, Math.floor(maxWidth / 6.9))
  const lines = wrapLabel(label, maxChars)
  const neededHeight = Math.ceil(lines.length * LINE_NODE)
  return { maxWidth, maxHeight, widestLine, neededHeight, tooWide: widestLine > maxWidth + 1, tooTall: neededHeight > maxHeight + 1 }
}

/**
 * Every finding about one page.
 *
 * @returns finding objects `{code, severity, elements, measure, message, repair}` in severity
 *   order, then code order - a stable list a test can assert and a caller can act on.
 */
export function findingsOf(elements) {
  const list = drawn(elements)
  const shapes = list.filter(isShape)
  const arrows = list.filter(isArrow)
  const shapeById = new Map(shapes.map((shape) => [shape.id, shape]))
  const out = []

  for (const shape of shapes) {
    const box = boxOf(shape)
    const label = labelOf(list, shape.id)
    if (label === '') {
      out.push(finding('node_without_label', 'low', [shape.id], { nodes: shapes.length },
        `${shape.id} has no label: a reader cannot tell what this box is.`,
        { op: 'node.label', id: shape.id, label: '<name>' }))
    } else if (box !== null) {
      const fit = shapeLabelFit(shape, label, box)
      const wanted = nodeSize(label, shape.type)
      if (fit.tooWide) {
        out.push(finding('label_overflow', 'high', [shape.id], { axis: 'width', box: Math.round(box.width), needed: wanted.width },
          `${shape.id} is too narrow for its label: the longest word needs about ${fit.widestLine} px, the shape gives ${Math.round(fit.maxWidth)} px.`,
          { op: 'node.resize', id: shape.id, width: wanted.width }))
      }
      if (fit.tooTall) {
        out.push(finding('label_overflow', 'high', [shape.id], { axis: 'height', box: Math.round(box.height), needed: wanted.height },
          `${shape.id} is too short for its wrapped label: it needs about ${fit.neededHeight} px of text height, the shape gives ${Math.round(fit.maxHeight)} px.`,
          { op: 'node.resize', id: shape.id, height: wanted.height }))
      }
    }
    if (box !== null && (box.x < 0 || box.y < 0)) {
      out.push(finding('off_canvas', 'low', [shape.id], { x: Math.round(box.x), y: Math.round(box.y) },
        `${shape.id} starts at a negative coordinate (${Math.round(box.x)}, ${Math.round(box.y)}); the picture begins off the page origin.`,
        { op: 'node.move', id: shape.id, x: 40, y: 40 }))
    }
  }

  for (let left = 0; left < shapes.length; left += 1) {
    for (let right = left + 1; right < shapes.length; right += 1) {
      const a = shapes[left]
      const b = shapes[right]
      const boxA = boxOf(a)
      const boxB = boxOf(b)
      if (boxA === null || boxB === null) continue
      const overlap = overlaps(boxA, boxB)
      if (overlap !== null) {
        const spot = freeSpotFor(boxB, shapes)
        out.push(finding('node_overlap', 'high', [a.id, b.id], { overlapWidth: Math.round(overlap.width), overlapHeight: Math.round(overlap.height), area: Math.round(overlap.area) },
          `${a.id} and ${b.id} overlap by ${Math.round(overlap.width)}x${Math.round(overlap.height)} px.`,
          { op: 'node.move', id: b.id, x: spot.x, y: spot.y }))
      } else {
        const gapX = Math.max(boxA.x, boxB.x) - Math.min(boxA.x + boxA.width, boxB.x + boxB.width)
        const gapY = Math.max(boxA.y, boxB.y) - Math.min(boxA.y + boxA.height, boxB.y + boxB.height)
        if (gapX >= 0 && gapY >= 0 && gapX < CLEARANCE && gapY < CLEARANCE) {
          out.push(finding('node_too_close', 'medium', [a.id, b.id], { gapX: Math.round(gapX), gapY: Math.round(gapY), clearance: CLEARANCE },
            `${a.id} and ${b.id} are only ${Math.round(Math.min(gapX, gapY))} px apart; ${CLEARANCE} px keeps the boxes readable.`,
            { op: 'layout', direction: 'LR' }))
        }
      }
    }
  }

  const duplicateGroups = new Map()
  for (const shape of shapes) {
    const label = labelOf(list, shape.id)
    if (label === '') continue
    if (!duplicateGroups.has(label)) duplicateGroups.set(label, [])
    duplicateGroups.get(label).push(shape.id)
  }
  for (const [label, ids] of duplicateGroups) {
    if (ids.length < 2) continue
    out.push(finding('duplicate_label', 'low', ids, { label, count: ids.length },
      `${ids.length} boxes carry the label "${label}"; a reader cannot tell them apart.`,
      { op: 'node.label', id: ids[0], label: `${label} (${ids[0]})` }))
  }

  if (shapes.length > 1) {
    const connected = new Set()
    for (const arrow of arrows) {
      if (shapeById.has(arrow.startBinding?.elementId)) connected.add(arrow.startBinding.elementId)
      if (shapeById.has(arrow.endBinding?.elementId)) connected.add(arrow.endBinding.elementId)
    }
    for (const shape of shapes) {
      if (connected.has(shape.id)) continue
      out.push(finding('isolated_node', 'low', [shape.id], { nodes: shapes.length },
        `${shape.id} has no arrow: it is drawn but not connected to the scheme.`,
        { op: 'edge.add', from: shape.id, to: '<node>', label: '<verb>' }))
    }
  }

  for (const arrow of arrows) {
    const start = arrow.startBinding?.elementId
    const end = arrow.endBinding?.elementId
    if (typeof start !== 'string' || typeof end !== 'string' || !shapeById.has(start) || !shapeById.has(end)) {
      out.push(finding('edge_unbound', 'high', [arrow.id], { start: start ?? null, end: end ?? null },
        `${arrow.id} is not attached to two boxes, so it will not follow them when they move.`,
        { op: 'edge.add', from: start ?? '<node>', to: end ?? '<node>', label: labelOf(list, arrow.id) }))
    } else if (start === end) {
      out.push(finding('edge_self', 'low', [arrow.id], { node: start },
        `${arrow.id} points from ${start} back to itself.`,
        { op: 'element.delete', id: arrow.id }))
    }
    if (labelOf(list, arrow.id) === '') {
      out.push(finding('edge_without_label', 'low', [arrow.id], {},
        `${arrow.id} has no label: the reader cannot tell what flows along it.`,
        { op: 'edge.label', id: arrow.id, label: '<verb>' }))
    }
    const segments = arrowSegments(arrow)
    for (const segment of segments) {
      for (const shape of shapes) {
        if (shape.id === start || shape.id === end) continue
        const box = boxOf(shape)
        if (box !== null && segmentHitsRect(segment, box)) {
          out.push(finding('edge_crosses_node', 'medium', [arrow.id, shape.id], { at: { x: Math.round(segment[0][0]), y: Math.round(segment[0][1]) } },
            `${arrow.id} passes through the box ${shape.id}.`,
            { op: 'layout', direction: 'LR' }))
        }
      }
    }
    const arrowLabel = labelBox(list, arrow)
    if (arrowLabel !== null) {
      for (const shape of shapes) {
        const box = boxOf(shape)
        if (box !== null && overlaps(arrowLabel, box) !== null) {
          out.push(finding('edge_label_on_node', 'high', [arrow.id, shape.id], { overlap: true },
            `The label of ${arrow.id} sits on the box ${shape.id}.`,
            { op: 'layout', direction: 'LR' }))
        }
      }
    }
  }

  for (let left = 0; left < arrows.length; left += 1) {
    for (let right = left + 1; right < arrows.length; right += 1) {
      const a = arrows[left]
      const b = arrows[right]
      const endpointsOf = (arrow) => [arrow.startBinding?.elementId, arrow.endBinding?.elementId].filter((id) => typeof id === 'string')
      const shared = endpointsOf(a).filter((id) => endpointsOf(b).includes(id))
      if (shared.length > 0) continue
      const crossed = arrowSegments(a).some((one) => arrowSegments(b).some((two) => segmentsCross(one, two)))
      if (crossed) {
        out.push(finding('edge_crossing', 'medium', [a.id, b.id], { pair: [a.id, b.id] },
          `${a.id} and ${b.id} cross each other.`,
          { op: 'layout', direction: 'LR' }))
      }
    }
  }

  const bounds = layoutBounds(elements)
  if (!bounds.empty && bounds.height > bounds.width * 2.5 && shapes.length > 2) {
    out.push(finding('page_too_tall', 'medium', [], { width: bounds.width, height: bounds.height, ratio: Math.round((bounds.height / bounds.width) * 10) / 10 },
      `The page is ${bounds.width}x${bounds.height} px - a vertical column. A left-to-right flow reads better.`,
      { op: 'layout', direction: 'LR' }))
  }

  return out.slice().sort((left, right) => {
    const bySeverity = (SEVERITY_RANK[left.severity] ?? 9) - (SEVERITY_RANK[right.severity] ?? 9)
    if (bySeverity !== 0) return bySeverity
    if (left.code !== right.code) return left.code < right.code ? -1 : 1
    return left.elements.join(',').localeCompare(right.elements.join(','))
  })
}

/**
 * The page's readability verdict: a score, a word for it, the findings and the counts.
 *
 * The score is a report, not a gate: 100 is clean, below 60 is "broken", and no caller is
 * refused a write for a low score.
 */
export function analyzeScene(scene) {
  const elements = Array.isArray(scene?.elements) ? scene.elements : []
  const findings = findingsOf(elements)
  const counts = { high: 0, medium: 0, low: 0 }
  for (const entry of findings) counts[entry.severity] = (counts[entry.severity] ?? 0) + 1
  const score = Math.max(0, 100 - findings.reduce((total, entry) => total + (PENALTY[entry.severity] ?? 0), 0))
  const shapes = elements.filter(isShape).length
  const arrows = elements.filter(isArrow).length
  const verdict = findings.length === 0 ? (shapes === 0 ? 'empty' : 'clean') : score >= 85 ? 'readable' : score >= 60 ? 'crowded' : 'broken'
  return { score, verdict, findings, counts: { ...counts, total: findings.length }, nodes: shapes, edges: arrows, bounds: layoutBounds(elements) }
}
