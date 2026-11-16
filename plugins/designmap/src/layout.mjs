/**
 * Deterministic ELK layered layout for one view.
 *
 * Verified API facts this module obeys (docs/designmap/API-TESTS-CORE.md §1):
 *  - option ids are `elk.layered.layering.strategy` / `…crossingMinimization.strategy`;
 *    the spec's camel-case spellings are silently dropped by elkjs 0.12.1;
 *  - the raw ELK result carries a nondeterministic GWT `$H` field, so only documented
 *    geometry is projected out of it;
 *  - child coordinates are parent-relative and ports are node-relative, so the scene
 *    is built by explicit offsetting;
 *  - `elk.algorithm=layered` accepts only simple edges (one source, one target).
 *
 * No `org.eclipse.elk.position` here: it is a fixed-layout option and is inert for
 * layered layout (API spike §1.3). Interactive layout, when v1.1 needs it, feeds the
 * previous render's node x/y back as INPUT node coordinates.
 */
import ELK from 'elkjs'
import { round2 } from './canonical.mjs'
import { REFUSALS, DesignmapRefusal } from './schema.mjs'
import { edgeLabelSize, nodeSize } from './text.mjs'

const elk = new ELK()

const PORT_SIZE = 8

function portIds(edge, direction) {
  return direction === 'TB'
    ? { outSide: 'SOUTH', inSide: 'NORTH' }
    : { outSide: 'EAST', inSide: 'WEST' }
}

function elkNode(node, direction) {
  const size = nodeSize(node.label, node.type)
  return {
    id: node.id,
    width: size.w,
    height: size.h,
    layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' },
    ports: [],
  }
}

function attachPorts(nodeEntry, edge, role, direction) {
  const { outSide, inSide } = portIds(edge, direction)
  nodeEntry.ports.push({
    id: `${edge.id}.${role}`,
    width: PORT_SIZE,
    height: PORT_SIZE,
    layoutOptions: { 'elk.port.side': role === 'src' ? outSide : inSide },
  })
  return `${edge.id}.${role}`
}

/** Straight-line fallback used for a self-loop and for an edge ELK returned no section for. */
function fallbackPoints(fromBox, toBox) {
  if (fromBox.id === toBox.id) {
    const { x, y, w, h } = fromBox
    return [
      { x: round2(x + w), y: round2(y + h * 0.25) },
      { x: round2(x + w + 32), y: round2(y + h * 0.25) },
      { x: round2(x + w + 32), y: round2(y + h * 0.75) },
      { x: round2(x + w), y: round2(y + h * 0.75) },
    ]
  }
  return [
    { x: round2(fromBox.x + fromBox.w), y: round2(fromBox.y + fromBox.h / 2) },
    { x: round2(toBox.x), y: round2(toBox.y + toBox.h / 2) },
  ]
}

/** Whether a point lies on a rectangle side (within `eps`), including its span. */
export function pointOnBoxBoundary(point, box, eps = 0.01) {
  const onVertical = (Math.abs(point.x - box.x) <= eps || Math.abs(point.x - (box.x + box.w)) <= eps)
    && point.y >= box.y - eps && point.y <= box.y + box.h + eps
  const onHorizontal = (Math.abs(point.y - box.y) <= eps || Math.abs(point.y - (box.y + box.h)) <= eps)
    && point.x >= box.x - eps && point.x <= box.x + box.w + eps
  return onVertical || onHorizontal
}

/** Whether a point is strictly inside a rectangle (margin inflates it). */
export function pointInBox(point, box, margin = 0) {
  return point.x > box.x - margin && point.x < box.x + box.w + margin
    && point.y > box.y - margin && point.y < box.y + box.h + margin
}

/* ------------------------------------------------------------------ */
/* Rectangle geometry: the one place a visual collision is decided.    */
/* ------------------------------------------------------------------ */

/** Minimum clearance kept around a label plate, in scene units. */
export const LABEL_GAP = 2

/**
 * Whether two rectangles come closer than `gap` (touching counts as colliding).
 * The scene needs its own predicate rather than point-in-box checks: a label is drawn
 * as a plate with width and height, so a point test missed every real overlap.
 */
export function boxesOverlap(left, right, gap = 0) {
  return left.x < right.x + right.w + gap
    && right.x < left.x + left.w + gap
    && left.y < right.y + right.h + gap
    && right.y < left.y + left.h + gap
}

/**
 * Whether a segment passes through the INTERIOR of a box (a segment that only touches
 * the boundary, as an arrow endpoint does, is not a crossing). The box is shrunk by
 * `shrink` and the segment is clipped against it (Liang-Barsky); a non-empty interval
 * means the line really crosses the body.
 */
export function segmentHitsBox(start, end, box, shrink = 0.5) {
  const left = box.x + shrink
  const top = box.y + shrink
  const right = box.x + box.w - shrink
  const bottom = box.y + box.h - shrink
  if (right <= left || bottom <= top) return false
  const dx = end.x - start.x
  const dy = end.y - start.y
  let low = 0
  let high = 1
  const clip = (direction, distance) => {
    if (direction === 0) return distance >= 0
    const ratio = distance / direction
    if (direction < 0) {
      if (ratio > high) return false
      if (ratio > low) low = ratio
    } else {
      if (ratio < low) return false
      if (ratio < high) high = ratio
    }
    return true
  }
  if (!clip(-dx, start.x - left)) return false
  if (!clip(dx, right - start.x)) return false
  if (!clip(-dy, start.y - top)) return false
  if (!clip(dy, bottom - start.y)) return false
  return high > low
}

/**
 * The label box an edge is drawn with. Core always emits `labelBox`; an older scene (or
 * a harness fixture) only carries `labelAt`, so the size is derived from the same metric
 * here instead of in the renderer.
 */
export function labelBoxOf(edge) {
  const box = edge.labelBox
  if (box !== undefined && box !== null && [box.x, box.y, box.w, box.h].every(Number.isFinite)) return box
  const size = edgeLabelSize(edge.label ?? '')
  const at = edge.labelAt ?? { x: 0, y: 0 }
  return { x: at.x, y: at.y, w: size.w, h: size.h }
}

/**
 * Every visual collision a scene would show, as lint-shaped issues.
 * Labels are checked against nodes and against each other, never against a group band:
 * a label inside its own band is correct. Edges are checked against node bodies only.
 */
export function placementIssues({ nodes, edges }) {
  const issues = []
  const labelled = edges.filter(edge => String(edge.label ?? '') !== '')
  const boxes = labelled.map(edge => ({ id: edge.id, box: labelBoxOf(edge) }))
  for (const entry of boxes) {
    for (const node of nodes) {
      if (boxesOverlap(entry.box, node, LABEL_GAP)) {
        issues.push({ rule: 'label_over_node', fields: { id: entry.id, nodeId: node.id, nodes: [node.id] } })
      }
    }
  }
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      if (boxesOverlap(boxes[left].box, boxes[right].box, LABEL_GAP)) {
        issues.push({ rule: 'label_label_overlap', fields: { ids: [boxes[left].id, boxes[right].id] } })
      }
    }
  }
  for (const edge of edges) {
    const points = edge.points ?? []
    for (let index = 1; index < points.length; index += 1) {
      for (const node of nodes) {
        if (segmentHitsBox(points[index - 1], points[index], node)) {
          issues.push({ rule: 'edge_through_node', fields: { id: edge.id, nodeId: node.id } })
        }
      }
    }
  }
  return issues
}

/** Points every `step` scene units along a polyline, both ends included. */
export function samplePolyline(points, step = 6) {
  if (points.length === 0) return []
  const samples = []
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]
    const to = points[index]
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    const count = Math.max(2, Math.ceil(length / step))
    for (let offset = 0; offset < count; offset += 1) {
      const ratio = offset / count
      samples.push({ x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio })
    }
  }
  samples.push({ ...points[points.length - 1] })
  return samples
}

/**
 * Place one label plate without a visual collision.
 *
 * The preferred anchor is the box the layout reserved (ELK's edge label). The search
 * then walks the polyline outwards and tries the plate above and below each sample;
 * the first box that clears every obstacle wins. `null` means the scene has no room for
 * this label — the caller decides whether that refuses the render (layout) or only warns
 * (a human's overlay created the overlap).
 */
export function placeEdgeLabel({ points = [], preferred = null, size, obstacles }) {
  const width = size.w
  const height = size.h
  const candidates = []
  const offer = (x, y) => candidates.push({ x: round2(x), y: round2(y) })
  if (preferred !== null) {
    offer(preferred.x, preferred.y)
    offer(preferred.x, preferred.y - (height + 6))
    offer(preferred.x, preferred.y + (height + 6))
  }
  const anchor = preferred === null
    ? polylineMidpoint(points)
    : { x: preferred.x + width / 2, y: preferred.y + height / 2 }
  const samples = samplePolyline(points).sort((left, right) => (
    Math.hypot(left.x - anchor.x, left.y - anchor.y) - Math.hypot(right.x - anchor.x, right.y - anchor.y)
  ))
  for (const sample of samples) {
    offer(sample.x - width / 2, sample.y - height - 3)
    offer(sample.x - width / 2, sample.y + 3)
  }
  if (candidates.length === 0) candidates.push({ x: anchor.x, y: anchor.y })
  for (const candidate of candidates) {
    const box = { x: round2(candidate.x), y: round2(candidate.y), w: width, h: height }
    if (obstacles.every(obstacle => !boxesOverlap(box, obstacle, LABEL_GAP))) return box
  }
  return null
}

/**
 * The point where the ray from the box centre towards `toward` leaves the box.
 *
 * This is what makes an edge endpoint land on the node boundary: ELK returns a start
 * point at the port centre (8 px outside a FIXED_SIDE east port) and an end point one
 * port-width short of the target. Projecting from the box centre along the edge keeps
 * the attachment on the side the edge actually leaves/enters, and the result is exactly
 * on the rectangle perimeter (rounded to the scene's 2 decimals).
 */
export function snapPointToBox(box, point, toward) {
  const centreX = box.x + box.w / 2
  const centreY = box.y + box.h / 2
  let dx = toward.x - centreX
  let dy = toward.y - centreY
  if (dx === 0 && dy === 0) {
    dx = point.x - centreX
    dy = point.y - centreY
  }
  if (dx === 0 && dy === 0) return { x: round2(centreX), y: round2(centreY) }
  const tx = dx === 0 ? Infinity : (box.w / 2) / Math.abs(dx)
  const ty = dy === 0 ? Infinity : (box.h / 2) / Math.abs(dy)
  const t = Math.min(tx, ty)
  return { x: round2(centreX + dx * t), y: round2(centreY + dy * t) }
}

/** Snap the first point to the source box and the last to the target box. */
export function snapEdgeToBoxes(points, sourceBox, targetBox) {
  if (points.length < 2) return points
  const snapped = points.map(point => ({ ...point }))
  snapped[0] = snapPointToBox(sourceBox, snapped[0], snapped[1])
  snapped[snapped.length - 1] = snapPointToBox(targetBox, snapped[snapped.length - 1], snapped[snapped.length - 2])
  return snapped
}

/** Arc-length midpoint of a polyline (the pre-fix anchor, still the fallback). */
function polylineMidpoint(points) {
  let total = 0
  const lengths = []
  for (let index = 1; index < points.length; index += 1) {
    const length = Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y)
    lengths.push(length)
    total += length
  }
  let remaining = total / 2
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining <= lengths[index] || index === lengths.length - 1) {
      const ratio = lengths[index] === 0 ? 0 : Math.min(1, remaining / lengths[index])
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * ratio,
        y: points[index].y + (points[index + 1].y - points[index].y) * ratio,
      }
    }
    remaining -= lengths[index]
  }
  return points[0]
}

/**
 * Place an edge label's top-left anchor on the freest span of the edge.
 *
 * The renderer draws at `labelAt` and must not move it, so core guarantees the anchor
 * is outside every node box whenever that is geometrically possible: the polyline is
 * sampled, a 4 px inflated box set is subtracted, and the midpoint of the longest
 * remaining run wins. When every sample is inside a box (overlapping nodes after an
 * overlay merge), the polyline midpoint is still emitted and `lint` reports
 * `label_over_node` — a visible regression, never a silent one.
 *
 * @returns `{labelAt, outside}` where `outside` says whether the anchor cleared the boxes.
 */
export function placeLabelOutside(points, boxes, label) {
  if (points.length === 0) return { labelAt: { x: 0, y: 0 }, outside: true }
  const width = Math.min(String(label ?? '').length, 40) * 7.4
  const inflated = boxes.map(box => ({ x: box.x - 4, y: box.y - 4, w: box.w + 8, h: box.h + 8 }))
  const outside = point => !inflated.some(box => pointInBox(point, box))
  const anchorOutside = point => !boxes.some(box => pointInBox(point, box))

  // Sample the polyline at ~2 px steps; consecutive outside samples form a free span.
  const samples = []
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]
    const to = points[index]
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    const steps = Math.max(2, Math.ceil(length / 2))
    for (let step = 0; step < steps; step += 1) {
      const ratio = step / steps
      samples.push({ x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio })
    }
  }
  samples.push({ ...points[points.length - 1] })

  let best = null
  let run = []
  for (const sample of samples) {
    if (outside(sample)) {
      run.push(sample)
      if (best === null || run.length > best.length) best = [...run]
    } else {
      run = []
    }
  }

  if (best !== null && best.length > 0) {
    const middle = best[Math.floor(best.length / 2)]
    // Prefer the label above the edge; fall back to the sample itself if the offset
    // would put the anchor back inside a box.
    const candidates = [
      { x: middle.x - width / 2, y: middle.y - 16 },
      { x: middle.x - width / 2, y: middle.y + 4 },
      { x: middle.x, y: middle.y },
    ]
    const chosen = candidates.find(candidate => anchorOutside(candidate)) ?? middle
    return { labelAt: { x: round2(chosen.x), y: round2(chosen.y) }, outside: anchorOutside(chosen) }
  }

  // No free span at all: emit the free-span midpoint itself (the contract's fallback)
  // and let `label_over_node` report it.
  const middle = polylineMidpoint(points)
  return { labelAt: { x: round2(middle.x), y: round2(middle.y) }, outside: false }
}

/** Backwards-compatible anchor used by the overlay reattachment path. */
export function edgeLabelAnchor(points, label) {
  return placeLabelOutside(points, [], label).labelAt
}

/** Default gaps. `scaledSpacing` grows them on a retry when a view stays crowded. */
export const DEFAULT_SPACING = Object.freeze({
  nodeNode: 24,
  edgeNode: 8,
  edgeEdge: 4,
  betweenLayers: 12,
  groupNodeNode: 16,
  groupBetweenLayers: 20,
})

/** The spacing scales layoutView tries, in order, before it gives up. */
export const SPACING_SCALES = Object.freeze([1, 1.45, 2])

/** One spacing table scaled for a retry (rounded so the scene stays deterministic). */
export function scaledSpacing(scale) {
  const scaled = {}
  for (const [key, value] of Object.entries(DEFAULT_SPACING)) scaled[key] = round2(value * scale)
  return scaled
}

/** Build the ELK graph: groups become ELK children containing their members. */
export function buildElkGraph({ nodes, groups, edges, direction, labelSizes = new Map(), spacing = DEFAULT_SPACING }) {
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction === 'TB' ? 'DOWN' : 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': String(spacing.nodeNode),
      'elk.spacing.edgeNode': String(spacing.edgeNode),
      'elk.spacing.edgeEdge': String(spacing.edgeEdge),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(spacing.betweenLayers),
      // Label space is reserved by ELK itself: the edge carries a label of the plate's
      // real size, and layered layout widens the corridor between layers to fit it.
      'elk.spacing.labelNode': '8',
      'elk.spacing.labelEdge': '4',
      'elk.spacing.labelLabel': '4',
      'elk.padding': '[top=8,left=8,bottom=8,right=8]',
    },
    children: [],
    edges: [],
  }
  const groupIds = new Set(groups.map(group => group.id))
  const members = new Map(groups.map(group => [group.id, []]))
  const ungrouped = []
  for (const node of [...nodes].sort((left, right) => (left.id < right.id ? -1 : 1))) {
    if (node.group !== null && node.group !== undefined && groupIds.has(node.group)) members.get(node.group).push(node)
    else ungrouped.push(node)
  }
  const entries = new Map()
  for (const node of nodes) entries.set(node.id, elkNode(node, direction))

  for (const group of [...groups].sort((left, right) => (left.id < right.id ? -1 : 1))) {
    graph.children.push({
      id: group.id,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': direction === 'TB' ? 'DOWN' : 'RIGHT',
        // The band reserves room for its label: the renderer draws it at the top-left
        // of the box, so the padding is a contract of the geometry, not a style value.
        'elk.padding': '[top=34,left=16,bottom=16,right=16]',
        'elk.spacing.nodeNode': String(spacing.groupNodeNode),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(spacing.groupBetweenLayers),
      },
      children: members.get(group.id).map(node => entries.get(node.id)),
    })
  }
  for (const node of ungrouped) graph.children.push(entries.get(node.id))

  for (const edge of [...edges].sort((left, right) => (left.id < right.id ? -1 : 1))) {
    const source = entries.get(edge.from)
    const target = entries.get(edge.to)
    if (source === undefined || target === undefined) continue
    if (edge.from === edge.to) continue // ELK layered rejects self-loops; drawn locally.
    const sourcePort = attachPorts(source, edge, 'src', direction)
    const targetPort = attachPorts(target, edge, 'tgt', direction)
    const size = labelSizes.get(edge.id)
    graph.edges.push({
      id: edge.id,
      sources: [sourcePort],
      targets: [targetPort],
      // The plate's REAL size goes to ELK. This is what makes the layout reserve room:
      // without it the label is placed afterwards into a corridor it cannot fit.
      // `text` is load-bearing: elkjs 0.12.1 reserves space for a label without text but
      // returns (0,0) as its position, which would drop every plate at the canvas origin.
      ...(size === undefined ? {} : { labels: [{ id: `${edge.id}:label`, text: edge.label, width: size.w, height: size.h }] }),
    })
  }
  return graph
}

/**
 * Lay out one view and return scene-ready geometry.
 *
 * Labels are part of the search, not an afterthought: `labelSizes` carries the plate size
 * of every edge, ELK reserves room for it and returns the box it reserved; the remaining
 * placement pass only moves a plate when the reserved box is still crowded (for example
 * after a group band squeezed the corridor).
 *
 * @returns {{nodes: Map, groups: Map, edges: Map, issues: Array, ms: number, nodeCount: number}}
 *   `issues` are visual collisions the caller must either fix (retry with a larger
 *   spacing scale) or refuse to write.
 */
export async function layoutView({ nodes, groups, edges, direction, labelSizes = new Map(), spacingScale = 1, onLayoutDone }) {
  const started = performance.now()
  if (nodes.length === 0) {
    const ms = performance.now() - started
    onLayoutDone?.({ ms: round2(ms), nodes: 0 })
    return { nodes: new Map(), groups: new Map(), edges: new Map(), issues: [], ms, nodeCount: 0 }
  }

  const graph = buildElkGraph({ nodes, groups, edges, direction, labelSizes, spacing: scaledSpacing(spacingScale) })
  const result = await elk.layout(graph)
  const ms = performance.now() - started
  onLayoutDone?.({ ms: round2(ms), nodes: nodes.length })

  const groupIds = new Set(groups.map(group => group.id))
  const nodeBoxes = new Map()
  const groupBoxes = new Map()
  const rootX = Number.isFinite(result.x) ? result.x : 0
  const rootY = Number.isFinite(result.y) ? result.y : 0
  const seenGroups = new Set()

  for (const child of result.children ?? []) {
    if (groupIds.has(child.id)) {
      const groupBox = {
        x: round2(rootX + (child.x ?? 0)),
        y: round2(rootY + (child.y ?? 0)),
        w: round2(child.width ?? 0),
        h: round2(child.height ?? 0),
      }
      groupBoxes.set(child.id, groupBox)
      seenGroups.add(child.id)
      for (const member of child.children ?? []) {
        nodeBoxes.set(member.id, {
          x: round2(groupBox.x + (member.x ?? 0)),
          y: round2(groupBox.y + (member.y ?? 0)),
          w: round2(member.width ?? 0),
          h: round2(member.height ?? 0),
        })
      }
    } else {
      nodeBoxes.set(child.id, {
        x: round2(rootX + (child.x ?? 0)),
        y: round2(rootY + (child.y ?? 0)),
        w: round2(child.width ?? 0),
        h: round2(child.height ?? 0),
      })
    }
  }
  for (const node of nodes) {
    if (!nodeBoxes.has(node.id)) {
      const size = nodeSize(node.label, node.type)
      nodeBoxes.set(node.id, { x: 0, y: 0, w: size.w, h: size.h })
    }
  }

  const elkEdges = new Map((result.edges ?? []).map(edge => [edge.id, edge]))
  const edgeGeometry = new Map()
  for (const edge of edges) {
    const sourceBox = nodeBoxes.get(edge.from)
    const targetBox = nodeBoxes.get(edge.to)
    if (sourceBox === undefined || targetBox === undefined) continue
    let points = []
    const elkEdge = elkEdges.get(edge.id)
    for (const section of elkEdge?.sections ?? []) {
      if (points.length === 0 && section.startPoint) points.push(section.startPoint)
      for (const bend of section.bendPoints ?? []) points.push(bend)
      if (section.endPoint) points.push(section.endPoint)
    }
    if (points.length < 2) {
      points = fallbackPoints(
        { ...sourceBox, id: edge.from },
        { ...targetBox, id: edge.to },
      )
    }
    const rounded = points.map(point => ({ x: round2(point.x), y: round2(point.y) }))
    const snapped = snapEdgeToBoxes(rounded, sourceBox, targetBox)
    // ELK RESERVES the room for the label but its reported label position is not the
    // drawn one: with fixed-side ports on a layered graph it lands in a label band far
    // from the edge (measured, elkjs 0.12.1). The reservation is what this layout needs,
    // so the plate is placed here, on the edge, inside that reserved space.
    edgeGeometry.set(edge.id, { points: snapped })
  }

  // One deterministic pass over the edges (sorted by id): every plate is tested against
  // the node boxes and the plates already placed, so the result does not depend on the
  // order ELK returned its labels in.
  const issues = []
  const nodeList = [...nodeBoxes.entries()].map(([id, box]) => ({ id, ...box }))
  const obstacles = [...nodeBoxes.values()]
  for (const edge of [...edges].sort((left, right) => (left.id < right.id ? -1 : 1))) {
    const geometry = edgeGeometry.get(edge.id)
    if (geometry === undefined) continue
    const size = labelSizes.get(edge.id) ?? edgeLabelSize(edge.label ?? '')
    const box = placeEdgeLabel({ points: geometry.points, preferred: geometry.preferred, size, obstacles })
    if (box === null) {
      // Keep the plate at the reserved position (or at the line's midpoint) so the
      // refusal can name the edge, and let the caller retry or refuse.
      const fallback = geometry.preferred ?? {
        x: round2(polylineMidpoint(geometry.points).x - size.w / 2),
        y: round2(polylineMidpoint(geometry.points).y - size.h / 2),
        w: size.w,
        h: size.h,
      }
      geometry.labelBox = { x: round2(fallback.x), y: round2(fallback.y), w: size.w, h: size.h }
      issues.push({ rule: 'label_collision', fields: { id: edge.id, edgeId: edge.id, box: geometry.labelBox } })
    } else {
      geometry.labelBox = box
      obstacles.push(box)
    }
  }
  const provisionalEdges = [...edgeGeometry.entries()].map(([id, geometry]) => ({
    id,
    label: edges.find(edge => edge.id === id)?.label ?? '',
    points: geometry.points,
    labelBox: geometry.labelBox,
  }))
  // Edge bodies crossing a node are a routing defect, not a label problem; they are
  // reported by the same pass so one retry can fix both.
  for (const issue of placementIssues({ nodes: nodeList, edges: provisionalEdges })) {
    if (issue.rule === 'edge_through_node') issues.push(issue)
  }

  for (const box of [...nodeBoxes.values(), ...groupBoxes.values()]) {
    for (const value of [box.x, box.y, box.w, box.h]) {
      if (!Number.isFinite(value)) {
        throw new DesignmapRefusal(REFUSALS.nonFiniteGeometry, 'layout produced non-finite geometry', { box })
      }
    }
  }
  for (const [id, geometry] of edgeGeometry) {
    for (const point of [...geometry.points, geometry.labelBox]) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw new DesignmapRefusal(REFUSALS.nonFiniteGeometry, 'layout produced non-finite edge geometry', { id, point })
      }
    }
  }

  return { nodes: nodeBoxes, groups: groupBoxes, edges: edgeGeometry, issues, ms, nodeCount: nodes.length }
}
