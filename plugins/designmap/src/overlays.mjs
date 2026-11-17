/**
 * Overlay merge: the human's visual edits, applied AFTER layout by semantic id.
 *
 * SCENE-CONTRACT, "Overlays": unknown node ids, negative or non-finite coordinates and
 * colours outside the palette are reported in `merge.gc` and then IGNORED — overlays
 * can never make render fail (FR-4). The merger never moves a node without an overlay
 * row, and recomputing the canvas is the caller's job because the whole scene exists
 * only there.
 *
 * A scene node has no colour fields (the contract deliberately keeps colour in the
 * renderer), so `fill`/`stroke` are validated here and returned in `colours` for the
 * tool envelope; they never enter the scene bytes.
 */
import { inPalette, isHexColour } from './palette.mjs'
import { round2 } from './canonical.mjs'

const ALLOWED_KEYS = ['x', 'y', 'fill', 'stroke']

/**
 * Validate and apply overlay rows.
 * @param sceneNodes - scene nodes after layout (`{id,x,y,w,h,...}`), not mutated.
 * @param raw - parsed `overlays.json` value.
 * @returns `{nodes, rows, colours, applied, gc}` — `nodes` is a fresh array with
 *          overlaid coordinates, `rows` the surviving rows, `gc` the warnings.
 */
export function mergeOverlays(sceneNodes, raw) {
  const gc = []
  const known = new Set(sceneNodes.map(node => node.id))
  const keptRows = new Map()
  const colours = new Map()

  if (raw !== null && raw !== undefined) {
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      gc.push({ code: 'overlays_not_an_object', severity: 'warning', message: 'overlays.json must be a JSON object; ignored' })
    } else {
      if (raw.$version !== undefined && raw.$version !== 1) {
        gc.push({ code: 'unknown_version', severity: 'warning', message: `overlays $version ${JSON.stringify(raw.$version)} is not 1; reading it as 1` })
      }
      for (const [nodeId, row] of Object.entries(raw)) {
        if (nodeId === '$version') continue
        if (!known.has(nodeId)) {
          gc.push({ code: 'unknown_node', severity: 'warning', nodeId, message: `overlay for unknown node "${nodeId}" dropped (GC)` })
          continue
        }
        if (row === null || typeof row !== 'object' || Array.isArray(row)) {
          gc.push({ code: 'invalid_row', severity: 'warning', nodeId, message: `overlay row for "${nodeId}" is not an object; dropped` })
          continue
        }
        const kept = {}
        for (const key of Object.keys(row)) {
          if (!ALLOWED_KEYS.includes(key)) {
            gc.push({ code: 'unknown_key', severity: 'warning', nodeId, key, message: `overlay key "${key}" is not x/y/fill/stroke; ignored` })
          }
        }
        for (const axis of ['x', 'y']) {
          const value = row[axis]
          if (value === undefined) continue
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            gc.push({ code: 'non_finite_coordinate', severity: 'warning', nodeId, axis, message: `overlay ${axis} for "${nodeId}" is not a finite number; ignored` })
            continue
          }
          if (value < 0) {
            gc.push({ code: 'negative_coordinate', severity: 'warning', nodeId, axis, message: `overlay ${axis} for "${nodeId}" is negative (${value}); ignored` })
            continue
          }
          kept[axis] = round2(value)
        }
        for (const colour of ['fill', 'stroke']) {
          const value = row[colour]
          if (value === undefined) continue
          if (!isHexColour(value)) {
            gc.push({ code: 'invalid_colour', severity: 'warning', nodeId, colour, message: `overlay ${colour} "${String(value)}" for "${nodeId}" is not a hex colour; ignored` })
            continue
          }
          // The human picks colours from the drawing tools, so any hex is legitimate.
          // Outside the type palette it is still applied; the palette is a default, not
          // a gate, and the finding is informational.
          if (!inPalette(value)) {
            gc.push({ code: 'colour_out_of_palette', severity: 'info', nodeId, colour, message: `overlay ${colour} "${String(value)}" for "${nodeId}" is outside the type palette; used anyway` })
          }
          kept[colour] = value
        }
        if (Object.keys(kept).length === 0) continue
        keptRows.set(nodeId, kept)
        const { x, y, ...colourKeys } = kept
        if (Object.keys(colourKeys).length > 0) colours.set(nodeId, colourKeys)
      }
    }
  }

  const nodes = sceneNodes.map(node => {
    const kept = keptRows.get(node.id)
    if (kept === undefined || (kept.x === undefined && kept.y === undefined)) return { ...node }
    return { ...node, x: kept.x ?? node.x, y: kept.y ?? node.y }
  })
  return { nodes, rows: keptRows, colours, applied: keptRows.size, gc }
}

/**
 * Re-anchor an edge whose endpoint node an overlay moved.
 *
 * SCENE-CONTRACT's `edges[].points` rule says the first point is the source boundary
 * and the last is the target boundary. Layout drew them against the layout box; after
 * an overlay moves a node that boundary is stale, so the incident endpoints are
 * projected onto the moved box (the bends stay where layout put them). Edge label
 * anchors are recomputed from the new polyline. Nodes without an overlay row are not
 * touched, so an unrelated edge keeps its layout geometry byte for byte.
 */
function boundaryPoint(box, toward) {
  if (box === undefined) return toward
  const centreX = box.x + box.w / 2
  const centreY = box.y + box.h / 2
  const dx = toward.x - centreX
  const dy = toward.y - centreY
  if (dx === 0 && dy === 0) return { x: round2(centreX), y: round2(centreY) }
  const tx = dx === 0 ? Infinity : (box.w / 2) / Math.abs(dx)
  const ty = dy === 0 ? Infinity : (box.h / 2) / Math.abs(dy)
  const t = Math.min(tx, ty)
  return { x: round2(centreX + dx * t), y: round2(centreY + dy * t) }
}

export function reattachEdges(nodes, edges, overlaidIds) {
  if (overlaidIds.size === 0) return edges
  const byId = new Map(nodes.map(node => [node.id, node]))
  return edges.map(edge => {
    const sourceMoved = overlaidIds.has(edge.from)
    const targetMoved = overlaidIds.has(edge.to)
    if ((!sourceMoved && !targetMoved) || edge.points.length < 2) return edge
    const points = edge.points.map(point => ({ ...point }))
    if (sourceMoved) points[0] = boundaryPoint(byId.get(edge.from), points[1])
    if (targetMoved) points[points.length - 1] = boundaryPoint(byId.get(edge.to), points[points.length - 2])
    // The plate is placed by render against the FINAL node boxes; this path only has to
    // keep the edge endpoints on the moved boundary.
    return { ...edge, points }
  })
}

/**
 * Do two boxes come closer than `gap`? The panel's drag must not merely avoid an exact
 * intersection: two boxes touching at an edge would draw as one glued block, so the
 * auto-placement treats anything closer than the gap as occupied.
 */
export function boxesWithinGap(left, right, gap = 0) {
  return left.x < right.x + right.w + gap
    && right.x < left.x + left.w + gap
    && left.y < right.y + right.h + gap
    && right.y < left.y + left.h + gap
}

/**
 * Nearest position for `box` that keeps at least `gap` from every obstacle.
 *
 * Search is a square ring walk on a `step` grid around the requested position, so the
 * answer is close to where the human dropped the node (the first free cell on the
 * nearest ring, ordered by distance inside the ring). `x`/`y` stay non-negative
 * because the overlay schema refuses negative coordinates — a candidate outside the
 * canvas would be written only to be ignored by merge, which would look like a lost
 * drop. Returns `null` when no free cell exists inside the bounded search.
 */
export function findFreeSpot({ box, obstacles, gap = 8, step = 16, maxRings = 128 }) {
  if (box === undefined || box === null || ![box.x, box.y, box.w, box.h].every(Number.isFinite)) return null
  const list = Array.isArray(obstacles) ? obstacles : []
  for (let ring = 0; ring <= maxRings; ring += 1) {
    const offsets = []
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
        offsets.push([dx, dy])
      }
    }
    offsets.sort((left, right) => (left[0] * left[0] + left[1] * left[1]) - (right[0] * right[0] + right[1] * right[1]))
    for (const [dx, dy] of offsets) {
      const x = round2(box.x + dx * step)
      const y = round2(box.y + dy * step)
      if (x < 0 || y < 0) continue
      const candidate = { ...box, x, y }
      if (!list.some(obstacle => boxesWithinGap(candidate, obstacle, gap))) return { x, y }
    }
  }
  return null
}

/** Bounding box of node boxes, group boxes and edge points, with the contract's 40 px margin. */
export function recomputeCanvas(nodes, groups, edges) {
  const boxes = [...nodes, ...groups]
  // An edge contributes its polyline AND its label plate: the plate is drawn, so a plate
  // near the outer boundary must widen the canvas or the fit would clip it.
  const points = []
  for (const edge of edges) {
    points.push(...edge.points)
    if (edge.labelBox !== undefined) {
      points.push(
        { x: edge.labelBox.x, y: edge.labelBox.y },
        { x: edge.labelBox.x + edge.labelBox.w, y: edge.labelBox.y + edge.labelBox.h },
      )
    } else if (edge.labelAt !== undefined) {
      points.push(edge.labelAt)
    }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const box of boxes) {
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.w)
    maxY = Math.max(maxY, box.y + box.h)
  }
  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 }
  return {
    x: round2(minX - 40),
    y: round2(minY - 40),
    width: round2(maxX - minX + 80),
    height: round2(maxY - minY + 80),
  }
}
