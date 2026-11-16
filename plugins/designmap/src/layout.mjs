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
import { nodeSize } from './text.mjs'

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

/** Build the ELK graph: groups become ELK children containing their members. */
export function buildElkGraph({ nodes, groups, edges, direction }) {
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction === 'TB' ? 'DOWN' : 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': '32',
      'elk.spacing.edgeNode': '16',
      'elk.spacing.edgeEdge': '8',
      'elk.layered.spacing.nodeNodeBetweenLayers': '48',
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
        'elk.spacing.nodeNode': '24',
        'elk.layered.spacing.nodeNodeBetweenLayers': '40',
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
    graph.edges.push({
      id: edge.id,
      sources: [sourcePort],
      targets: [targetPort],
    })
  }
  return graph
}

/**
 * Lay out one view and return scene-ready geometry.
 * @returns {{nodes: Map<string, {x,y,w,h}>, groups: Map<string, {x,y,w,h}>,
 *            edges: Map<string, {points, labelAt}>, ms: number, nodeCount: number}}
 */
export async function layoutView({ nodes, groups, edges, direction, onLayoutDone }) {
  const started = performance.now()
  if (nodes.length === 0) {
    const ms = performance.now() - started
    onLayoutDone?.({ ms: round2(ms), nodes: 0 })
    return { nodes: new Map(), groups: new Map(), edges: new Map(), ms, nodeCount: 0 }
  }

  const graph = buildElkGraph({ nodes, groups, edges, direction })
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
    const { labelAt } = placeLabelOutside(snapped, [...nodeBoxes.values()], edge.label)
    edgeGeometry.set(edge.id, { points: snapped, labelAt })
  }

  for (const box of [...nodeBoxes.values(), ...groupBoxes.values()]) {
    for (const value of [box.x, box.y, box.w, box.h]) {
      if (!Number.isFinite(value)) {
        throw new DesignmapRefusal(REFUSALS.nonFiniteGeometry, 'layout produced non-finite geometry', { box })
      }
    }
  }
  for (const [id, geometry] of edgeGeometry) {
    for (const point of [...geometry.points, geometry.labelAt]) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw new DesignmapRefusal(REFUSALS.nonFiniteGeometry, 'layout produced non-finite edge geometry', { id, point })
      }
    }
  }

  return { nodes: nodeBoxes, groups: groupBoxes, edges: edgeGeometry, ms, nodeCount: nodes.length }
}
