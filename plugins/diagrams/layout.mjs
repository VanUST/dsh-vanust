/**
 * PURPOSE: Decide every coordinate in a diagram before anything is drawn. A spec
 *          describes nodes and relationships; this module turns that into placed boxes,
 *          routed edges and named regions, so an agent never has to hand-place geometry
 *          and the same spec always produces the same picture.
 * INPUTS:  buildScene(spec, diagnostics) where spec is the parsed diagram spec and
 *          diagnostics is { errors: string[], warnings: string[] } — the caller owns
 *          those arrays and this module appends to them.
 *          spec.kind is 'flow' | 'arch' | 'sequence' | 'state'. flow and state take
 *          nodes/edges/groups; arch takes layers/links; sequence takes actors/messages.
 *          Node names may be `id` or `name`; edge endpoints may be `from`/`to` or
 *          `source`/`target`, because a model writes either.
 * OUTPUTS: a scene { kind, direction, title, width, height, nodes[], edges[], bands[],
 *          lines[] }. Every node has absolute x/y/w/h; every edge has a `path` and an
 *          optional `labelAt`; bands are named regions; lines are the sequence lifelines.
 *          An unknown `kind`, an edge naming a missing node or a duplicated node id is
 *          appended to `diagnostics.errors` and the rest still lays out: a bad reference
 *          never yields an empty scene when a drawable one exists.
 * KEYWORDS: diagrams, layout, layered, dag, sugiyama, swimlane, sequence, architecture.
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A graph with cycles lays out: back edges are detected and routed around the
 *     outside instead of being fed to the ranking, which would not terminate usefully.
 *   - An isolated node keeps rank 0 and is drawn.
 *   - An empty `nodes` array yields a scene of minimum size with an error, not a crash.
 *   - `arch` with no `layers` but with `nodes` falls back to the layered engine and says so.
 */

import { COLORS, EDGE_STYLES, SIDES, SHAPE_NAMES, isShapeName, normalizeColor, normalizeShape, roundedPolyline, routeEdge, sizeNode, textWidth } from './svg.mjs'

/** The diagram kinds this plugin draws. */
export const KINDS = ['flow', 'arch', 'sequence', 'state']

/** Colour rotation used when a layer or an actor declares no colour of its own. */
const ROTATION = ['info', 'ok', 'violet', 'accent', 'cyan', 'danger']

/** Outer margin around a scene, in px. */
const MARGIN = 34
/** Gap between two ranks (the direction the flow advances). */
const GAP_RANK = 88
/** Gap between two neighbours inside one rank. */
const GAP_SIBLING = 44

/** Inclusive-exclusive integer range. */
function range(from, to) {
  const out = []
  if (to >= from) for (let i = from; i < to; i += 1) out.push(i)
  else for (let i = from; i > to; i -= 1) out.push(i)
  return out
}

/** The endpoint name of an edge, accepting both spellings a model uses. */
function endpoint(edge, key) {
  if (key === 'from') return edge.from ?? edge.source
  return edge.to ?? edge.target
}

/** True when two axis-aligned rectangles share area. */
function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/**
 * Nudges edge labels off each other and off the nodes.
 * Two labels can legitimately be computed onto the same spot when their edges cross; the
 * greedy pass below tries a small set of offsets around each label's own anchor and keeps
 * the first that collides with nothing already placed, preferring one that also misses
 * every node. A label that has nowhere clean to go stays at its anchor, because a
 * displaced label is worse than a crowded one.
 * @param edges - Scene edges, each optionally carrying `label` and `labelAt`; mutated.
 * @param nodes - Placed nodes, as obstacle boxes.
 * @returns Nothing.
 */
function declutterLabels(edges, nodes) {
  const placed = []
  const offsets = [0, 18, -18, 36, -36, 54, -54, 72, -72]
  for (const edge of edges) {
    if (!edge.label || !edge.labelAt) continue
    const width = textWidth(edge.label, 12) + 12
    const anchor = { x: edge.labelAt.x, y: edge.labelAt.y }
    const rectAt = (dy) => ({ x: anchor.x - width / 2, y: anchor.y + dy - 9, w: width, h: 18 })
    let chosen = null
    for (const pass of [0, 1]) {
      for (const dy of offsets) {
        const rect = rectAt(dy)
        if (placed.some((other) => intersects(other, rect))) continue
        if (pass === 0 && nodes.some((node) => intersects(node, rect))) continue
        edge.labelAt = { x: anchor.x, y: anchor.y + dy }
        chosen = rect
        break
      }
      if (chosen) break
    }
    placed.push(chosen ?? rectAt(0))
  }
}

/** The identifier of a node, accepting both spellings a model uses. */
function nodeId(entry) {
  return entry.id ?? entry.name
}

/**
 * Normalises a node entry from a spec into the shape the renderer sizes.
 * @param entry - { id|name, label?, shape?, note?, color?, rank?, wrap? } or a string id.
 * @param fallback - The default shape primitive for this diagram kind.
 * @param defaultColor - The colour to use when the entry declares none.
 * @returns A node, or null when the entry has no usable identifier.
 */
function makeNode(entry, fallback, defaultColor, diagnostics, where) {
  if (typeof entry === 'string') {
    return { id: entry, label: entry, shape: fallback, color: defaultColor, shapeFallback: fallback }
  }
  const id = nodeId(entry ?? {})
  if (typeof id !== 'string' || id.length === 0) return null
  const spot = `${where} "${id}"`
  if (entry.shape !== undefined && !isShapeName(entry.shape)) {
    diagnostics.errors.push(`${spot}: shape "${entry.shape}" is unknown; drew "${normalizeShape(entry.shape, fallback)}" (allowed: ${SHAPE_NAMES.join(', ')})`)
  }
  const color = normalizeColor(entry.color)
  if (entry.color !== undefined && color === null) {
    diagnostics.errors.push(`${spot}: colour "${entry.color}" is unknown; used "${defaultColor}" (allowed: ${COLORS.join(', ')})`)
  }
  return {
    id,
    label: entry.label ?? id,
    shape: normalizeShape(entry.shape, fallback),
    shapeFallback: fallback,
    note: entry.note,
    color: color ?? defaultColor,
    rank: Number.isFinite(entry.rank) ? entry.rank : undefined,
    wrap: entry.wrap,
  }
}

/**
 * Normalises one edge.
 * @param edge - { from|source, to|target, label?, style?, color?, fromSide?, toSide? }.
 * @param fallbackColor - The colour to use when the edge declares none.
 * @param diagnostics - Error sink; a null sink reports nothing.
 * @param where - The noun this edge is called in the diagnostic, 'edge' or 'link'.
 * @returns An edge with canonical endpoint keys, or null when an endpoint is missing (the
 *   caller's own validation reports that case, with the position it knows).
 */
function makeEdge(edge, fallbackColor = 'edge', diagnostics = null, where = 'edge') {
  if (edge === null || typeof edge !== 'object') return null
  const from = endpoint(edge, 'from')
  const to = endpoint(edge, 'to')
  if (typeof from !== 'string' || typeof to !== 'string') return null
  const spot = `${where} ${from} → ${to}`
  if (edge.style !== undefined && !EDGE_STYLES.includes(edge.style)) {
    diagnostics?.errors.push(`${spot}: style "${edge.style}" is unknown; drew "solid" (allowed: ${EDGE_STYLES.join(', ')})`)
  }
  const color = normalizeColor(edge.color)
  if (edge.color !== undefined && color === null) {
    diagnostics?.errors.push(`${spot}: colour "${edge.color}" is unknown; used "${fallbackColor}" (allowed: ${COLORS.join(', ')})`)
  }
  for (const side of ['fromSide', 'toSide']) {
    if (edge[side] !== undefined && !SIDES.includes(edge[side])) {
      diagnostics?.errors.push(`${spot}: ${side} "${edge[side]}" is unknown; chose a side automatically (allowed: ${SIDES.join(', ')})`)
    }
  }
  return {
    from,
    to,
    label: edge.label,
    style: EDGE_STYLES.includes(edge.style) ? edge.style : 'solid',
    color: color ?? fallbackColor,
    fromSide: SIDES.includes(edge.fromSide) ? edge.fromSide : undefined,
    toSide: SIDES.includes(edge.toSide) ? edge.toSide : undefined,
  }
}

/**
 * Keeps the first node of each id and reports the rest.
 * @param nodes - Candidate nodes, in spec order.
 * @param diagnostics - Error sink.
 * @returns The deduplicated list.
 */
function dedupe(nodes, diagnostics) {
  const seen = new Set()
  const out = []
  for (const node of nodes) {
    if (seen.has(node.id)) {
      diagnostics.errors.push(`node "${node.id}": declared more than once; kept the first`)
      continue
    }
    seen.add(node.id)
    out.push(node)
  }
  return out
}

/**
 * Drops edges whose endpoints are unknown, keeping the rest.
 * @param edges - Candidate edges.
 * @param ids - The set of known node ids.
 * @param diagnostics - Error sink.
 * @returns The drawable edges.
 */
function validateEdges(edges, ids, diagnostics) {
  return edges.filter((edge) => {
    if (edge === null) {
      diagnostics.errors.push('edge: expected an object with `from` and `to`')
      return false
    }
    const bad = [edge.from, edge.to].filter((id) => !ids.has(id))
    if (bad.length > 0) {
      diagnostics.errors.push(`edge ${edge.from} → ${edge.to}: unknown node ${bad.map((id) => `"${id}"`).join(', ')}; edge skipped`)
      return false
    }
    return true
  })
}

/**
 * Assigns each node a rank and marks the edges that close a cycle.
 * Ranks come from the longest path over the acyclic remainder: a back edge must be
 * removed before ranking, or a cycle has no longest path and the layout degenerates.
 * @param nodes - Deduplicated nodes, in spec order.
 * @param edges - Validated edges.
 * @returns { rank: Map<id, number>, back: Set<edge index> }.
 */
function assignRanks(nodes, edges) {
  const adjacency = new Map(nodes.map((node) => [node.id, []]))
  edges.forEach((edge, index) => adjacency.get(edge.from)?.push(index))

  const colour = new Map(nodes.map((node) => [node.id, 0]))
  const back = new Set()
  for (const root of nodes) {
    if (colour.get(root.id) !== 0) continue
    colour.set(root.id, 1)
    const stack = [{ id: root.id, next: 0 }]
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const list = adjacency.get(frame.id) ?? []
      if (frame.next < list.length) {
        const index = list[frame.next]
        frame.next += 1
        const target = edges[index].to
        const state = colour.get(target)
        if (state === 1) back.add(index)
        else if (state === 0) {
          colour.set(target, 1)
          stack.push({ id: target, next: 0 })
        }
      } else {
        colour.set(frame.id, 2)
        stack.pop()
      }
    }
  }

  const indegree = new Map(nodes.map((node) => [node.id, 0]))
  edges.forEach((edge, index) => {
    if (!back.has(index)) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
  })
  const rank = new Map()
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id)
  for (const id of queue) rank.set(id, 0)
  while (queue.length > 0) {
    const id = queue.shift()
    for (const index of adjacency.get(id) ?? []) {
      if (back.has(index)) continue
      const edge = edges[index]
      const candidate = (rank.get(id) ?? 0) + 1
      if (candidate > (rank.get(edge.to) ?? 0)) rank.set(edge.to, candidate)
      indegree.set(edge.to, indegree.get(edge.to) - 1)
      if (indegree.get(edge.to) === 0) queue.push(edge.to)
    }
  }
  for (const node of nodes) if (!rank.has(node.id)) rank.set(node.id, 0)
  for (const node of nodes) if (Number.isFinite(node.rank)) rank.set(node.id, node.rank)
  return { rank, back }
}

/**
 * Reduces edge crossings by ordering each rank against its already-ordered neighbour.
 * The barycentre heuristic, swept alternately downwards and upwards: a node moves to the
 * average position of the neighbours it connects to in the layer being held fixed.
 * @param layers - Nodes grouped by rank, mutated in place.
 * @param edges - Drawable edges.
 * @returns Nothing.
 */
function orderLayers(layers, edges) {
  const position = new Map()
  layers.forEach((layer, index) => layer.forEach((node, slot) => position.set(node.id, { layer: index, slot })))
  const neighbours = new Map()
  for (const layer of layers) for (const node of layer) neighbours.set(node.id, [])
  for (const edge of edges) {
    neighbours.get(edge.from)?.push(edge.to)
    neighbours.get(edge.to)?.push(edge.from)
  }
  const sweeps = 8
  for (let sweep = 0; sweep < sweeps; sweep += 1) {
    const down = sweep % 2 === 0
    const order = down ? range(1, layers.length) : range(layers.length - 2, -1)
    for (const index of order) {
      if (index < 0 || index >= layers.length) continue
      const layer = layers[index]
      const fixed = down ? index - 1 : index + 1
      if (fixed < 0 || fixed >= layers.length) continue
      const key = new Map()
      layer.forEach((node, slot) => {
        const adjacent = (neighbours.get(node.id) ?? []).filter((id) => position.get(id)?.layer === fixed)
        key.set(node.id, adjacent.length === 0
          ? slot
          : adjacent.reduce((sum, id) => sum + position.get(id).slot, 0) / adjacent.length)
      })
      layer.sort((a, b) => (key.get(a.id) - key.get(b.id)) || (position.get(a.id).slot - position.get(b.id).slot))
      layer.forEach((node, slot) => position.set(node.id, { layer: index, slot }))
    }
  }
}

/**
 * Slides whole ranks along the cross axis to line each node up with its neighbours.
 * A rank moves as one rigid body, so this can neither reorder a rank nor overlap two of
 * its nodes — it only removes the sideways offset between a node and the nodes it connects
 * to, which is what turns a chain into a straight run instead of a staircase. Sweeping
 * downwards and upwards alternately lets one rank's shift settle the next in turn.
 * @param layers - Nodes grouped by rank, mutated in place.
 * @param edges - Drawable edges.
 * @param centreOf - (node) => the node's position on the cross axis.
 * @param move - (node, delta) => translate the node along that axis.
 * @returns Nothing.
 */
function relaxRanks(layers, edges, centreOf, move) {
  const layerOf = new Map()
  const centre = new Map()
  layers.forEach((layer, index) => layer.forEach((node) => {
    layerOf.set(node.id, index)
    centre.set(node.id, centreOf(node))
  }))
  const neighbours = new Map(layers.flat().map((node) => [node.id, []]))
  for (const edge of edges) {
    if (edge.from === edge.to) continue
    neighbours.get(edge.from)?.push(edge.to)
    neighbours.get(edge.to)?.push(edge.from)
  }
  for (let pass = 0; pass < 8; pass += 1) {
    const down = pass % 2 === 0
    const order = down ? range(1, layers.length) : range(layers.length - 2, -1)
    for (const index of order) {
      if (index < 0 || index >= layers.length) continue
      const fixed = down ? index - 1 : index + 1
      if (fixed < 0 || fixed >= layers.length) continue
      const deltas = []
      for (const node of layers[index]) {
        const adjacent = (neighbours.get(node.id) ?? []).filter((id) => layerOf.get(id) === fixed)
        if (adjacent.length === 0) continue
        const mean = adjacent.reduce((sum, id) => sum + centre.get(id), 0) / adjacent.length
        deltas.push(mean - centre.get(node.id))
      }
      if (deltas.length === 0) continue
      const delta = deltas.reduce((sum, value) => sum + value, 0) / deltas.length
      if (Math.abs(delta) < 0.5) continue
      for (const node of layers[index]) {
        move(node, delta)
        centre.set(node.id, centre.get(node.id) + delta)
      }
    }
  }
}

/**
 * Lays out a top-down (or left-right) layered diagram: flow, state machine, or an
 * architecture written as plain nodes and edges.
 * @param spec - The diagram spec.
 * @param kind - The resolved kind, used for defaults and the scene record.
 * @param diagnostics - Error and warning sink.
 * @returns The scene.
 */
function layeredScene(spec, kind, diagnostics) {
  const nodeFallback = kind === 'state' ? 'round' : 'rect'
  const rawNodes = Array.isArray(spec.nodes) ? spec.nodes : []
  const nodes = dedupe(rawNodes.map((entry, index) => {
    const node = makeNode(entry, nodeFallback, 'muted', diagnostics, 'node')
    if (node === null) diagnostics.errors.push(`node ${index + 1}: no "id"; skipped`)
    return node
  }).filter(Boolean), diagnostics)
  if (nodes.length === 0) {
    diagnostics.errors.push('nodes: expected at least one node with an `id`')
    return { kind, direction: 'down', title: spec.title, width: 200, height: 120, nodes: [], edges: [], bands: [], lines: [] }
  }
  const ids = new Set(nodes.map((node) => node.id))
  const rawEdges = (Array.isArray(spec.edges) ? spec.edges : []).map((edge) => makeEdge(edge, 'edge', diagnostics, 'edge'))
  const edges = validateEdges(rawEdges, ids, diagnostics)
  const direction = spec.direction === 'right' ? 'right' : 'down'
  for (const node of nodes) sizeNode(node)

  const { rank, back } = assignRanks(nodes, edges)
  const maxRank = Math.max(0, ...nodes.map((node) => rank.get(node.id)))
  const layers = []
  for (let index = 0; index <= maxRank; index += 1) layers.push([])
  for (const node of nodes) layers[rank.get(node.id)].push(node)
  orderLayers(layers, edges)

  const down = direction === 'down'
  const sizeA = (node) => (down ? node.h : node.w)
  const sizeB = (node) => (down ? node.w : node.h)
  // A self loop is drawn beside its node on the cross axis, so that node's slot is wider
  // by the loop's own width; without this the loop and its label land on the neighbour.
  const selfLoops = new Set(edges.filter((edge) => edge.from === edge.to).map((edge) => edge.from))
  const loopRoom = (node) => (selfLoops.has(node.id) ? 36 : 0)
  const layersB = layers.map((layer) => layer.reduce((sum, node) => sum + sizeB(node) + loopRoom(node), 0)
    + GAP_SIBLING * Math.max(0, layer.length - 1))
  const widest = Math.max(0, ...layersB)
  let cursorA = MARGIN
  layers.forEach((layer, index) => {
    const extentA = Math.max(0, ...layer.map(sizeA))
    const startB = MARGIN + (widest - layersB[index]) / 2
    let cursorB = startB
    layer.forEach((node) => {
      if (down) {
        node.x = cursorB
        node.y = cursorA + (extentA - node.h) / 2
      } else {
        node.y = cursorB
        node.x = cursorA + (extentA - node.w) / 2
      }
      cursorB += sizeB(node) + GAP_SIBLING + loopRoom(node)
    })
    cursorA += extentA + GAP_RANK
  })

  relaxRanks(layers, edges,
    (node) => (down ? node.x + node.w / 2 : node.y + node.h / 2),
    (node, delta) => {
      if (down) node.x += delta
      else node.y += delta
    })

  const boxes = new Map(nodes.map((node) => [node.id, node]))
  const bounds = {
    left: Math.min(...nodes.map((node) => node.x)),
    right: Math.max(...nodes.map((node) => node.x + node.w)),
    top: Math.min(...nodes.map((node) => node.y)),
    bottom: Math.max(...nodes.map((node) => node.y + node.h)),
  }

  const lanes = { right: 0, left: 0 }
  const routed = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity }
  const sceneEdges = []
  edges.forEach((edge, index) => {
    const from = boxes.get(edge.from)
    const to = boxes.get(edge.to)
    const span = Math.abs((rank.get(edge.to) ?? 0) - (rank.get(edge.from) ?? 0))
    // A same-rank edge is short by construction and takes the direct curve; only a real
    // skip, or a back edge, has ranks between its ends to avoid.
    const channel = back.has(index) || span > 1
    const toRight = to.x + to.w / 2 >= from.x + from.w / 2
    const lane = channel ? lanes[toRight ? 'right' : 'left']++ : 0
    const route = routeEdge(from, to, {
      direction,
      fromSide: edge.fromSide,
      toSide: edge.toSide,
      channel,
      lane,
      bounds,
    })
    routed.left = Math.min(routed.left, route.extent.left)
    routed.right = Math.max(routed.right, route.extent.right)
    routed.top = Math.min(routed.top, route.extent.top)
    routed.bottom = Math.max(routed.bottom, route.extent.bottom)
    sceneEdges.push({
      path: route.d,
      label: edge.label,
      labelAt: edge.label ? route.labelAt : null,
      color: edge.color,
      style: edge.style,
    })
  })

  const bands = []
  const rawGroups = Array.isArray(spec.groups) ? spec.groups : []
  for (const group of rawGroups) {
    if (group === null || typeof group !== 'object') continue
    const members = (Array.isArray(group.nodes) ? group.nodes : []).map((id) => boxes.get(id)).filter(Boolean)
    const missing = (Array.isArray(group.nodes) ? group.nodes : []).filter((id) => !boxes.has(id))
    if (members.length === 0) {
      diagnostics.warnings.push(`group "${group.label ?? group.id ?? '?'}": no known member nodes; region skipped`)
      continue
    }
    if (missing.length > 0) diagnostics.warnings.push(`group "${group.label ?? group.id ?? '?'}": unknown node(s) ${missing.join(', ')}`)
    const pad = 20
    const head = group.label ? 26 : 10
    const x = Math.min(...members.map((node) => node.x)) - pad
    const y = Math.min(...members.map((node) => node.y)) - pad - head
    const w = Math.max(...members.map((node) => node.x + node.w + pad)) - x
    const h = Math.max(...members.map((node) => node.y + node.h + pad)) - y
    bands.push({ x, y, w, h, label: group.label, color: normalizeColor(group.color) ?? 'muted' })
  }

  declutterLabels(sceneEdges, nodes)
  for (const edge of sceneEdges) {
    if (!edge.labelAt) continue
    const half = (textWidth(edge.label, 12) + 12) / 2
    routed.left = Math.min(routed.left, edge.labelAt.x - half)
    routed.right = Math.max(routed.right, edge.labelAt.x + half)
    routed.top = Math.min(routed.top, edge.labelAt.y - 9)
    routed.bottom = Math.max(routed.bottom, edge.labelAt.y + 9)
  }

  const right = Math.max(bounds.right, ...bands.map((band) => band.x + band.w), routed.right)
  const bottom = Math.max(bounds.bottom, ...bands.map((band) => band.y + band.h), routed.bottom)
  const left = Math.min(bounds.left, ...bands.map((band) => band.x), routed.left)
  const top = Math.min(bounds.top, ...bands.map((band) => band.y), routed.top)
  return {
    kind,
    direction,
    title: spec.title,
    width: (right - left) + MARGIN * 2,
    height: (bottom - top) + MARGIN * 2,
    offset: { x: MARGIN - left, y: MARGIN - top },
    nodes,
    edges: sceneEdges,
    bands,
    lines: [],
  }
}
/**
 * Lays out a layered architecture: named bands, each holding a row of boxes, joined by
 * links between the boxes.
 * @param spec - The diagram spec with `layers` and optional `links`.
 * @param diagnostics - Error and warning sink.
 * @returns The scene.
 */
function archScene(spec, diagnostics) {
  if (spec.direction === 'right') {
    diagnostics.warnings.push('arch: `direction: "right"` is not supported; drew the bands top-down')
  }
  const rawLayers = Array.isArray(spec.layers) ? spec.layers : []
  if (rawLayers.length === 0) {
    if (Array.isArray(spec.nodes) && spec.nodes.length > 0) {
      diagnostics.warnings.push('arch: no `layers` given; drew the `nodes` with the flow layout')
      return layeredScene(spec, 'arch', diagnostics)
    }
    diagnostics.errors.push('layers: expected at least one layer with `items`')
    return { kind: 'arch', direction: 'down', title: spec.title, width: 240, height: 120, nodes: [], edges: [], bands: [], lines: [] }
  }

  const columns = Math.max(1, Math.min(6, Number.isFinite(spec.columns) ? spec.columns : 4))
  const boxPad = 24
  const bandGap = 30
  const rowGap = 18

  const layers = rawLayers.map((raw, index) => {
    const layer = raw === null || typeof raw !== 'object' ? {} : raw
    const color = normalizeColor(layer.color) ?? ROTATION[index % ROTATION.length]
    const items = (Array.isArray(layer.items) ? layer.items : [])
      .map((item, itemIndex) => {
        const node = makeNode(item, 'rect', color, diagnostics, `layer "${layer.label ?? index + 1}" item`)
        if (node === null) diagnostics.errors.push(`layer "${layer.label ?? index + 1}": item ${itemIndex + 1} has no "id"; skipped`)
        return node
      })
      .filter(Boolean)
    return {
      id: layer.id ?? `layer-${index + 1}`,
      label: layer.label ?? layer.id ?? '',
      color,
      items,
    }
  })

  const allNodes = []
  const seen = new Set()
  for (const layer of layers) {
    layer.nodes = []
    for (const item of layer.items) {
      if (seen.has(item.id)) {
        diagnostics.errors.push(`layer "${layer.label}": node "${item.id}" is already in another layer; kept the first`)
        continue
      }
      seen.add(item.id)
      sizeNode(item)
      layer.nodes.push(item)
      allNodes.push(item)
    }
  }
  if (allNodes.length === 0) {
    diagnostics.errors.push('layers: every layer is empty; expected at least one item with an `id`')
    return { kind: 'arch', direction: 'down', title: spec.title, width: 240, height: 120, nodes: [], edges: [], bands: [], lines: [] }
  }

  for (const layer of layers) {
    const count = layer.nodes.length
    if (count === 0) continue
    layer.cols = Math.max(1, Math.min(columns, count))
    layer.rows = Math.ceil(count / layer.cols)
    const rows = []
    for (let row = 0; row < layer.rows; row += 1) {
      const slice = layer.nodes.slice(row * layer.cols, (row + 1) * layer.cols)
      rows.push(slice)
    }
    layer.rowsOf = rows
    layer.rowHeights = rows.map((slice) => Math.max(0, ...slice.map((node) => node.h)))
    layer.rowWidths = rows.map((slice) => slice.reduce((sum, node) => sum + node.w, 0) + GAP_SIBLING * Math.max(0, slice.length - 1))
    layer.contentW = Math.max(0, ...layer.rowWidths)
    layer.contentH = layer.rowHeights.reduce((sum, value) => sum + value, 0) + rowGap * Math.max(0, rows.length - 1)
  }

  const widest = Math.max(0, ...layers.map((layer) => (layer.contentW ?? 0) + boxPad * 2))
  let cursorY = MARGIN
  const bands = []
  for (const layer of layers) {
    const head = layer.label ? 30 : 12
    const bandW = widest
    const bandH = (layer.contentH ?? 0) + head + boxPad
    const bandX = MARGIN
    const bandY = cursorY
    if (layer.nodes.length > 0) {
      let rowY = bandY + head + boxPad / 2
      layer.rowsOf.forEach((slice, rowIndex) => {
        let cursorX = bandX + (bandW - layer.rowWidths[rowIndex]) / 2
        for (const node of slice) {
          node.x = cursorX
          node.y = rowY + (layer.rowHeights[rowIndex] - node.h) / 2
          cursorX += node.w + GAP_SIBLING
        }
        rowY += layer.rowHeights[rowIndex] + rowGap
      })
    }
    bands.push({ x: bandX, y: bandY, w: bandW, h: bandH, label: layer.label, color: layer.color })
    cursorY += bandH + bandGap
  }

  const boxes = new Map(allNodes.map((node) => [node.id, node]))
  const ids = new Set(boxes.keys())
  const rawLinks = (Array.isArray(spec.links) ? spec.links : Array.isArray(spec.edges) ? spec.edges : [])
    .map((link) => makeEdge(link, 'muted', diagnostics, 'link'))
  const links = validateEdges(rawLinks, ids, diagnostics)
  const bounds = {
    left: Math.min(...allNodes.map((node) => node.x)),
    right: Math.max(...allNodes.map((node) => node.x + node.w)),
    top: Math.min(...allNodes.map((node) => node.y)),
    bottom: Math.max(...allNodes.map((node) => node.y + node.h)),
  }
  // A link that skips a band would otherwise be drawn straight through it, crossing boxes
  // and labels it has nothing to do with. It takes a detour outside the bands instead, and
  // the detour lanes are placed against the BAND box, not the node box, so a lane does not
  // land inside the band it is meant to route around.
  const bandOf = new Map()
  layers.forEach((layer, index) => layer.nodes.forEach((node) => bandOf.set(node.id, index)))
  const bandBounds = {
    left: Math.min(...bands.map((band) => band.x)),
    right: Math.max(...bands.map((band) => band.x + band.w)),
    top: Math.min(...bands.map((band) => band.y)),
    bottom: Math.max(...bands.map((band) => band.y + band.h)),
  }
  const lanes = { right: 0, left: 0 }
  const routed = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity }
  const sceneEdges = links.map((link) => {
    const from = boxes.get(link.from)
    const to = boxes.get(link.to)
    const toRight = to.x + to.w / 2 >= from.x + from.w / 2
    const skips = Math.abs((bandOf.get(link.to) ?? 0) - (bandOf.get(link.from) ?? 0)) > 1
    const route = routeEdge(from, to, {
      direction: 'down',
      fromSide: link.fromSide,
      toSide: link.toSide,
      channel: skips,
      lane: skips ? lanes[toRight ? 'right' : 'left']++ : 0,
      bounds: skips ? bandBounds : bounds,
    })
    routed.left = Math.min(routed.left, route.extent.left)
    routed.right = Math.max(routed.right, route.extent.right)
    routed.top = Math.min(routed.top, route.extent.top)
    routed.bottom = Math.max(routed.bottom, route.extent.bottom)
    return {
      path: route.d,
      label: link.label,
      labelAt: link.label ? route.labelAt : null,
      color: link.color,
      style: link.style,
    }
  })

  declutterLabels(sceneEdges, allNodes)
  for (const edge of sceneEdges) {
    if (!edge.labelAt) continue
    const half = (textWidth(edge.label, 12) + 12) / 2
    routed.left = Math.min(routed.left, edge.labelAt.x - half)
    routed.right = Math.max(routed.right, edge.labelAt.x + half)
    routed.top = Math.min(routed.top, edge.labelAt.y - 9)
    routed.bottom = Math.max(routed.bottom, edge.labelAt.y + 9)
  }

  const left = Math.min(bounds.left, ...bands.map((band) => band.x), routed.left)
  const top = Math.min(bounds.top, ...bands.map((band) => band.y), routed.top)
  const right = Math.max(bounds.right, ...bands.map((band) => band.x + band.w), routed.right)
  const bottom = Math.max(bounds.bottom, ...bands.map((band) => band.y + band.h), routed.bottom)
  return {
    kind: 'arch',
    direction: 'down',
    title: spec.title,
    width: (right - left) + MARGIN * 2,
    height: (bottom - top) + MARGIN * 2,
    offset: { x: MARGIN - left, y: MARGIN - top },
    nodes: allNodes,
    edges: sceneEdges,
    bands,
    lines: [],
  }
}

/**
 * Lays out a sequence diagram: actors across the top, one message per row.
 * @param spec - The diagram spec with `actors` and `messages`.
 * @param diagnostics - Error and warning sink.
 * @returns The scene.
 */
function sequenceScene(spec, diagnostics) {
  const rawActors = Array.isArray(spec.actors) ? spec.actors : []
  const actors = dedupe(rawActors.map((entry, index) => {
    const actor = makeNode(entry, 'round', ROTATION[index % ROTATION.length], diagnostics, 'actor')
    if (actor === null) diagnostics.errors.push(`actor ${index + 1}: no "id"; skipped`)
    return actor
  }).filter(Boolean), diagnostics)
  if (actors.length === 0) {
    diagnostics.errors.push('actors: expected at least one actor with an `id`')
    return { kind: 'sequence', direction: 'down', title: spec.title, width: 240, height: 120, nodes: [], edges: [], bands: [], lines: [] }
  }
  const ids = new Set(actors.map((actor) => actor.id))
  for (const actor of actors) {
    sizeNode(actor)
    actor.w = Math.max(132, actor.w)
    actor.h = Math.max(46, actor.h)
    actor.shape = 'round'
  }

  const actorGap = 60
  let cursorX = MARGIN
  for (const actor of actors) {
    actor.x = cursorX
    actor.y = MARGIN
    actor.cx = actor.x + actor.w / 2
    cursorX += actor.w + actorGap
  }
  const right = Math.max(...actors.map((actor) => actor.x + actor.w))

  const boxes = new Map(actors.map((actor) => [actor.id, actor]))
  const rawMessages = Array.isArray(spec.messages) ? spec.messages : []
  const messages = rawMessages.map((entry) => {
    if (entry === null || typeof entry !== 'object') return null
    const from = endpoint(entry, 'from')
    const to = endpoint(entry, 'to')
    if (typeof from !== 'string' || typeof to !== 'string') return null
    if (!ids.has(from) || !ids.has(to)) {
      const bad = [from, to].filter((id) => !ids.has(id))
      diagnostics.errors.push(`message ${from} → ${to}: unknown actor ${bad.map((id) => `"${id}"`).join(', ')}; message skipped`)
      return null
    }
    if (entry.style !== undefined && !EDGE_STYLES.includes(entry.style)) {
      diagnostics.errors.push(`message ${from} → ${to}: style "${entry.style}" is unknown; drew `
        + `"${entry.kind === 'return' ? 'dashed' : 'solid'}" (allowed: ${EDGE_STYLES.join(', ')})`)
    }
    if (entry.color !== undefined && normalizeColor(entry.color) === null) {
      diagnostics.errors.push(`message ${from} → ${to}: colour "${entry.color}" is unknown; used "edge" (allowed: ${COLORS.join(', ')})`)
    }
    return {
      from,
      to,
      label: entry.label,
      style: EDGE_STYLES.includes(entry.style)
        ? entry.style
        : (entry.kind === 'return' ? 'dashed' : 'solid'),
      color: normalizeColor(entry.color) ?? 'edge',
      note: entry.note,
    }
  }).filter(Boolean)

  const step = 50

  // Control-flow frames (`blocks`) are planned BEFORE the rows are placed, because a frame
  // needs vertical room for its label tab above the first message it encloses. Reserving
  // that lead in the row spacing is what keeps the tab off the message label it would
  // otherwise sit on — and off the frame above it, when two frames are adjacent.
  const FRAME_LEAD = 30
  const framePlan = []
  const rawBlocks = Array.isArray(spec.blocks) ? spec.blocks : []
  rawBlocks.forEach((block, index) => {
    if (block === null || typeof block !== 'object') {
      diagnostics.errors.push(`block ${index + 1}: expected an object with "label" and "from"/"to"`)
      return
    }
    const name = typeof block.label === 'string' && block.label.length > 0 ? block.label : `block ${index + 1}`
    const first = Number.isInteger(block.from) ? block.from : null
    const last = Number.isInteger(block.to) ? block.to : null
    if (first === null || last === null || first < 1 || last > messages.length || first > last) {
      diagnostics.errors.push(`block "${name}": from/to must be message numbers within 1..${messages.length}; frame skipped`)
      return
    }
    const type = ['alt', 'opt', 'loop', 'par', 'break'].includes(block.type) ? block.type : 'alt'
    framePlan.push({ first, last, title: block.label ? `${type} ${block.label}` : type })
  })
  const frameStarts = new Set(framePlan.map((frame) => frame.first))
  const frameEnds = new Set(framePlan.map((frame) => frame.last))

  const headGap = 44 + (frameStarts.has(1) ? FRAME_LEAD : 0)
  let y = MARGIN + 46 + headGap
  const edges = []
  const messageRows = []
  const nodes = [...actors]
  let farRight = right
  const number = spec.numbering === true
  messages.forEach((message, index) => {
    const a = boxes.get(message.from)
    const b = boxes.get(message.to)
    const arrowY = y
    const selfMessage = a.id === b.id
    messageRows.push({ top: arrowY, bottom: arrowY + (selfMessage ? 26 : 0) })
    const label = number ? `${index + 1}. ${message.label ?? ''}`.trim() : message.label
    let advance = step
    if (selfMessage) {
      const x = a.cx
      const path = roundedPolyline([
        { x, y: arrowY },
        { x: x + 52, y: arrowY },
        { x: x + 52, y: arrowY + 26 },
        { x, y: arrowY + 26 },
      ], 8)
      edges.push({
        path,
        label,
        // Above the loop, like every other message label: beside it the label and a note
        // would share the same space to the right of the lifeline.
        labelAt: label ? { x: x + 26, y: arrowY - 12 } : null,
        color: message.color,
        style: message.style,
      })
      farRight = Math.max(farRight, x + 52, x + 26 + (label ? textWidth(label, 12) / 2 : 0))
      advance = step + 26
    } else {
      edges.push({
        path: `M ${Math.round(a.cx * 10) / 10} ${Math.round(arrowY * 10) / 10} L ${Math.round(b.cx * 10) / 10} ${Math.round(arrowY * 10) / 10}`,
        label,
        labelAt: label ? { x: (a.cx + b.cx) / 2, y: arrowY - 12 } : null,
        color: message.color,
        style: message.style,
      })
    }
    if (message.note) {
      // The note is measured before the row is advanced, so the next message cannot land
      // on top of it however many lines the note wraps to. A self message's note sits
      // below the loop rather than beside it.
      const note = {
        id: `${message.from}-${message.to}-note-${index}`,
        label: message.note,
        shape: 'note',
        shapeFallback: 'note',
        color: 'muted',
        wrap: 30,
      }
      sizeNode(note)
      note.x = b.cx + 26
      note.y = arrowY + (selfMessage ? 36 : 10)
      nodes.push(note)
      farRight = Math.max(farRight, note.x + note.w)
      advance = Math.max(advance, (note.y - arrowY) + note.h + 34)
    }
    if (frameStarts.has(index + 2)) advance += FRAME_LEAD
    if (frameEnds.has(index + 1)) advance += frameStarts.has(index + 2) ? 26 : 14
    y += advance
  })

  const lines = actors.map((actor) => ({
    x1: actor.cx,
    y1: actor.y + actor.h,
    x2: actor.cx,
    y2: Math.max(actor.y + actor.h + 30, y + 6),
    color: actor.color,
  }))

  // The frames themselves: an alt/opt/loop around a run of messages, drawn as a band so
  // they sit behind the messages, with the tab's room already reserved above.
  const frameLeft = Math.min(...actors.map((actor) => actor.cx)) - 26
  const frameRight = Math.max(...actors.map((actor) => actor.cx)) + 26
  farRight = Math.max(farRight, frameRight)
  const frames = framePlan.map((frame) => {
    const top = messageRows[frame.first - 1].top - 52
    const bottom = messageRows[frame.last - 1].bottom + 26
    return {
      x: frameLeft,
      y: top,
      w: frameRight - frameLeft,
      h: bottom - top,
      label: frame.title,
      kind: 'frame',
      color: 'muted',
    }
  })

  const height = Math.max(...lines.map((line) => line.y2), ...frames.map((frame) => frame.y + frame.h)) + MARGIN
  return {
    kind: 'sequence',
    direction: 'down',
    title: spec.title,
    width: farRight + MARGIN,
    height,
    offset: { x: 0, y: 0 },
    nodes,
    edges,
    bands: frames,
    lines,
  }
}

/**
 * Builds the scene for a parsed spec.
 * @param spec - The parsed diagram spec.
 * @param diagnostics - { errors: string[], warnings: string[] } owned by the caller.
 * @returns The scene described in the file contract.
 */
export function buildScene(spec, diagnostics) {
  const kind = KINDS.includes(spec.kind) ? spec.kind : 'flow'
  if (spec.kind !== undefined && !KINDS.includes(spec.kind)) {
    diagnostics.errors.push(`kind "${spec.kind}" is unknown; drew a "${kind}" (allowed: ${KINDS.join(', ')})`)
  }
  if (kind === 'sequence') return sequenceScene(spec, diagnostics)
  if (kind === 'arch') return archScene(spec, diagnostics)
  return layeredScene(spec, kind, diagnostics)
}
