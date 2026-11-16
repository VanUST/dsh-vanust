/**
 * Scene → Excalidraw elements, and the edit delta back to overlays.
 *
 * The map has two halves and this module is the seam for the second one: the Excalidraw
 * canvas becomes the DRAWING AND EDITING surface, while the model, the layout and the
 * overlay merge stay exactly as they are. Nothing here decides geometry: the scene
 * already carries x/y/w/h, the edge polylines and the label anchors, and this module
 * copies them into elements, then turns a human's drag or recolour back into the same
 * overlay delta the React Flow view writes.
 *
 * Two Excalidraw details make that faithful:
 *   - edges are UNBOUND arrows carrying our points. A bound arrow is re-routed by
 *     Excalidraw when a shape moves, which would silently replace the core layout;
 *     an unbound arrow keeps its points.
 *   - every element we create carries `customData.designmap`, so a canvas change maps
 *     back to a semantic id instead of to a positional guess.
 *
 * Locking is the edit policy: node bodies are unlocked only in edit mode, labels,
 * arrows and group bands stay locked, so the only edits the canvas can produce are the
 * ones the overlay contract allows (move a node, recolour it).
 */

/** Node type → Excalidraw shape. The type is still shown by colour and label. */
const SHAPE = {
  frontend: 'rectangle',
  service: 'rectangle',
  worker: 'rectangle',
  queue: 'rectangle',
  external: 'rectangle',
  datastore: 'ellipse',
  decision: 'diamond',
}

/** Fallback palette, mirrored from client/scene.js so the adapter stands alone. */
const DEFAULT_LOOK = {
  frontend: { fill: '#dbeafe', stroke: '#2563eb' },
  service: { fill: '#e0e7ff', stroke: '#4338ca' },
  worker: { fill: '#dcfce7', stroke: '#15803d' },
  datastore: { fill: '#fef3c7', stroke: '#b45309' },
  queue: { fill: '#fce7f3', stroke: '#be185d' },
  external: { fill: '#f1f5f9', stroke: '#475569' },
}

export const NODE_PREFIX = 'dm:node:'
export const EDGE_PREFIX = 'dm:edge:'
export const GROUP_PREFIX = 'dm:group:'
export const LABEL_PREFIX = 'dm:label:'

let seed = 1
const nextSeed = () => (seed = (seed * 16807) % 2147483647)

/** One Excalidraw element skeleton: every field the editor expects on load. */
function element(type, id, fields) {
  return {
    id,
    type,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: nextSeed(),
    version: 1,
    versionNonce: nextSeed(),
    isDeleted: false,
    boundElements: [],
    updated: 1,
    link: null,
    locked: false,
    ...fields,
  }
}

const LINE_HEIGHT = 1.25
const FONT_SIZE = 13

/** Elements for one scene, with overlay rows applied and `editMode` deciding locking. */
export function sceneToElements(scene, { overlays = {}, editMode = false } = {}) {
  const elements = []

  for (const group of scene.groups ?? []) {
    elements.push(
      element('rectangle', `${GROUP_PREFIX}${group.id}`, {
        x: group.x,
        y: group.y,
        width: group.w,
        height: group.h,
        strokeStyle: 'dashed',
        strokeColor: '#7c8aa5',
        backgroundColor: 'transparent',
        strokeWidth: 1,
        locked: true,
        customData: { designmap: { kind: 'group', groupId: group.id } },
      }),
    )
  }

  for (const node of scene.nodes) {
    const row = overlays[node.id] ?? {}
    const look = DEFAULT_LOOK[node.type] ?? DEFAULT_LOOK.service
    const x = typeof row.x === 'number' ? row.x : node.x
    const y = typeof row.y === 'number' ? row.y : node.y
    const fill = typeof row.fill === 'string' ? row.fill : look.fill
    const stroke = typeof row.stroke === 'string' ? row.stroke : look.stroke
    const lines = String(node.label).split('\n')
    const textHeight = Math.max(node.h - 12, lines.length * FONT_SIZE * LINE_HEIGHT)
    const shape = SHAPE[node.type] ?? 'rectangle'
    const nodeId = `${NODE_PREFIX}${node.id}`
    const textId = `${LABEL_PREFIX}${node.id}`
    elements.push(
      element(shape, nodeId, {
        x,
        y,
        width: node.w,
        height: node.h,
        strokeColor: stroke,
        backgroundColor: fill,
        strokeStyle: node.type === 'external' ? 'dashed' : 'solid',
        roundness: shape === 'rectangle' ? { type: 3 } : null,
        locked: !editMode,
        boundElements: [{ type: 'text', id: textId }],
        customData: { designmap: { kind: 'node', nodeId: node.id } },
      }),
    )
    elements.push(
      element('text', textId, {
        x: x + 8,
        y: y + (node.h - textHeight) / 2,
        width: Math.max(24, node.w - 16),
        height: textHeight,
        text: node.label,
        originalText: node.label,
        fontSize: FONT_SIZE,
        fontFamily: 2,
        textAlign: 'center',
        verticalAlign: 'middle',
        containerId: nodeId,
        lineHeight: LINE_HEIGHT,
        locked: true,
        customData: { designmap: { kind: 'node-label', nodeId: node.id } },
      }),
    )
  }

  for (const edge of scene.edges) {
    const first = edge.points[0]
    const last = edge.points[edge.points.length - 1]
    // Excalidraw points are [x, y] TUPLES, not objects; an object here crashes its
    // bounding-box maths on the first render.
    const points = edge.points.map((point) => [point.x - first.x, point.y - first.y])
    const arrowId = `${EDGE_PREFIX}${edge.id}`
    const labelId = `${LABEL_PREFIX}${edge.id}`
    elements.push(
      element('arrow', arrowId, {
        x: first.x,
        y: first.y,
        width: last.x - first.x,
        height: last.y - first.y,
        points,
        strokeColor: '#64748b',
        strokeStyle: edge.kind === 'async' ? 'dashed' : edge.kind === 'data' ? 'dotted' : 'solid',
        strokeWidth: 1.6,
        startArrowhead: null,
        endArrowhead: 'arrow',
        // Unbound on purpose: a bound arrow would be re-routed by the editor.
        startBinding: null,
        endBinding: null,
        locked: true,
        customData: { designmap: { kind: 'edge', edgeId: edge.id } },
      }),
    )
    if (typeof edge.label === 'string' && edge.label !== '') {
      elements.push(
        element('text', labelId, {
          x: edge.labelAt.x,
          y: edge.labelAt.y,
          width: Math.max(24, edge.label.length * 6.2),
          height: 14,
          text: edge.label,
          originalText: edge.label,
          fontSize: 10,
          fontFamily: 2,
          textAlign: 'center',
          verticalAlign: 'middle',
          lineHeight: LINE_HEIGHT,
          locked: true,
          customData: { designmap: { kind: 'edge-label', edgeId: edge.id } },
        }),
      )
    }
  }

  return elements
}

/** The appState a scene wants: a light canvas with a grid the human can see. */
export function sceneToAppState() {
  return {
    viewBackgroundColor: '#ffffff',
    currentItemStrokeColor: '#4338ca',
    currentItemBackgroundColor: '#e0e7ff',
    currentItemFontFamily: 2,
    gridSize: 20,
  }
}

const round2 = (value) => Math.round(value * 100) / 100

/**
 * Diff the canvas against what we last drew, and return only overlay deltas —
 * `{ [nodeId]: { x?, y?, fill?, stroke? } }` for nodes the human moved or recoloured.
 * `baseline` is the element list produced by `sceneToElements`; anything absent from it
 * (a drawing the human added, a deleted element) is ignored: the canvas may not change
 * the structure.
 */
export function overlayDelta(baseline, elements) {
  const drawn = new Map()
  for (const entry of baseline) {
    const meta = entry?.customData?.designmap
    if (meta?.kind === 'node') drawn.set(meta.nodeId, entry)
  }
  const delta = {}
  for (const entry of elements ?? []) {
    const meta = entry?.customData?.designmap
    if (meta?.kind !== 'node') continue
    if (entry.isDeleted === true) continue
    const base = drawn.get(meta.nodeId)
    if (base === undefined) continue
    const row = {}
    if (Math.abs(entry.x - base.x) > 0.5) row.x = round2(entry.x)
    if (Math.abs(entry.y - base.y) > 0.5) row.y = round2(entry.y)
    if (entry.backgroundColor !== base.backgroundColor) row.fill = entry.backgroundColor
    if (entry.strokeColor !== base.strokeColor) row.stroke = entry.strokeColor
    if (Object.keys(row).length > 0) delta[meta.nodeId] = row
  }
  return delta
}
