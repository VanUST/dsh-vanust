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

/** Stroke style per type: dashed external, dotted queue, solid everything else. */
const STROKE_STYLE = {
  external: 'dashed',
  queue: 'dotted',
}

/**
 * The panel theme, read from the host CSS aliases. The canvas is a separate document, so
 * every colour it needs is passed in explicitly; the defaults keep the harness usable.
 */
export const DEFAULT_LOOK = Object.freeze({
  surface: '#ffffff',
  surface2: '#f8fafc',
  ink: '#0f172a',
  muted: '#475569',
  line: '#e2e8f0',
})

/** Fallback palette, mirrored from client/scene.js so the adapter stands alone. */
const NODE_LOOK = {
  frontend: { fill: '#bfdbfe', stroke: '#1d4ed8' },
  service: { fill: '#c7d2fe', stroke: '#4338ca' },
  worker: { fill: '#bbf7d0', stroke: '#15803d' },
  datastore: { fill: '#fde68a', stroke: '#b45309' },
  queue: { fill: '#fbcfe8', stroke: '#be185d' },
  external: { fill: '#e2e8f0', stroke: '#475569' },
}

export const NODE_PREFIX = 'dm:node:'
export const EDGE_PREFIX = 'dm:edge:'
export const GROUP_PREFIX = 'dm:group:'
export const LABEL_PREFIX = 'dm:label:'
export const CHIP_PREFIX = 'dm:chip:'

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

/** Element types the human annotation layer may contain (mirrors the host whitelist). */
export const ANNOTATION_TYPES = new Set(['rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'text', 'freedraw'])

const NODE_FONT_SIZE = 13
const NODE_LINE_HEIGHT = 1.25
const EDGE_FONT_SIZE = 11
const EDGE_LINE_HEIGHT = 1.25
const GROUP_FONT_SIZE = 12
/** Node ink is deliberately theme-independent: the type palette fills are light. */
const NODE_INK = '#1f2937'

/**
 * The plate of an edge label. The scene owns the rectangle; a pre-labelBox scene (an old
 * harness fixture) still renders via the same local metric core used before the contract
 * change, and this is the ONLY place the client estimates a width.
 */
export function labelPlate(edge) {
  const box = edge.labelBox
  if (box !== undefined && box !== null && [box.x, box.y, box.w, box.h].every(Number.isFinite)) return box
  const lines = Array.isArray(edge.labelLines) && edge.labelLines.length > 0 ? edge.labelLines : [String(edge.label ?? '')]
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0)
  const at = edge.labelAt ?? { x: 0, y: 0 }
  return { x: at.x, y: at.y, w: Math.max(28, Math.ceil(longest * 6.82) + 18), h: lines.length * 15 + 10 }
}

/**
 * The human annotation layer as Excalidraw elements: free drawings and notes, drawn
 * ABOVE the scene (array order is z-order). They carry no `customData.designmap` — that
 * absence is exactly what marks an element as the human's layer in both directions.
 */
export function annotationElements(annotations, { editMode = false } = {}) {
  const list = []
  for (const raw of Array.isArray(annotations) ? annotations : []) {
    if (raw === null || typeof raw !== 'object' || !ANNOTATION_TYPES.has(raw.type)) continue
    const id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : `annotation-${nextSeed()}`
    const safe = { ...raw }
    delete safe.customData
    list.push(element(raw.type, id, {
      ...safe,
      id,
      isDeleted: false,
      locked: !editMode,
      boundElements: Array.isArray(raw.boundElements) ? raw.boundElements : [],
    }))
  }
  return list
}

/**
 * The elements of the canvas that belong to the human's layer: everything without
 * `customData.designmap` (that marker is how scene elements are recognised), not deleted,
 * with the mode-dependent and host-stripped fields removed so a write is reviewable.
 */
export function freeElements(elements) {
  const list = []
  for (const entry of Array.isArray(elements) ? elements : []) {
    if (entry === null || typeof entry !== 'object' || entry.isDeleted === true) continue
    if (entry.customData?.designmap !== undefined) continue
    if (!ANNOTATION_TYPES.has(entry.type)) continue
    if (![entry.x, entry.y, entry.width, entry.height].every(Number.isFinite)) continue
    const copy = { ...entry }
    delete copy.locked
    delete copy.customData
    delete copy.link
    if (typeof copy.containerId === 'string' && copy.containerId.startsWith('dm:')) delete copy.containerId
    list.push(copy)
  }
  return list
}

/**
 * Elements for one scene, with overlay rows applied and `editMode` deciding locking.
 * The plate (chip) of an edge label carries a bound text, so Excalidraw keeps the text
 * inside the rectangle the validator approved instead of letting it grow past it.
 */
export function sceneToElements(scene, { overlays = {}, editMode = false, look = DEFAULT_LOOK, annotations = [] } = {}) {
  const elements = []
  const theme = { ...DEFAULT_LOOK, ...look }

  for (const group of scene.groups ?? []) {
    elements.push(
      element('rectangle', `${GROUP_PREFIX}${group.id}`, {
        x: group.x,
        y: group.y,
        width: group.w,
        height: group.h,
        strokeStyle: 'dashed',
        strokeColor: theme.line,
        backgroundColor: theme.surface2,
        strokeWidth: 1,
        roundness: { type: 3 },
        locked: true,
        customData: { designmap: { kind: 'group', groupId: group.id } },
      }),
    )
    if (String(group.label ?? '') !== '') {
      const titleId = `${GROUP_PREFIX}${group.id}:title`
      elements.push(
        element('text', titleId, {
          x: group.x + 12,
          y: group.y + 9,
          width: Math.max(40, group.w - 24),
          height: 18,
          text: group.label,
          originalText: group.label,
          fontSize: GROUP_FONT_SIZE,
          fontFamily: 2,
          textAlign: 'left',
          verticalAlign: 'top',
          lineHeight: 1.25,
          strokeColor: theme.muted,
          locked: true,
          customData: { designmap: { kind: 'group-label', groupId: group.id } },
        }),
      )
    }
  }

  for (const node of scene.nodes) {
    const row = overlays[node.id] ?? {}
    const look2 = NODE_LOOK[node.type] ?? NODE_LOOK.service
    const x = typeof row.x === 'number' ? row.x : node.x
    const y = typeof row.y === 'number' ? row.y : node.y
    const fill = typeof row.fill === 'string' ? row.fill : look2.fill
    const stroke = typeof row.stroke === 'string' ? row.stroke : look2.stroke
    const lines = String(node.label).split('\n')
    const textHeight = Math.max(node.h - 12, lines.length * NODE_FONT_SIZE * NODE_LINE_HEIGHT)
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
        strokeStyle: STROKE_STYLE[node.type] ?? 'solid',
        strokeWidth: 1.6,
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
        fontSize: NODE_FONT_SIZE,
        fontFamily: 2,
        textAlign: 'center',
        verticalAlign: 'middle',
        containerId: nodeId,
        lineHeight: NODE_LINE_HEIGHT,
        strokeColor: NODE_INK,
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
    elements.push(
      element('arrow', arrowId, {
        x: first.x,
        y: first.y,
        width: last.x - first.x,
        height: last.y - first.y,
        points,
        strokeColor: theme.muted,
        strokeStyle: edge.kind === 'async' ? 'dashed' : edge.kind === 'data' ? 'dotted' : 'solid',
        strokeWidth: 1.4,
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
      const plate = labelPlate(edge)
      const chipId = `${CHIP_PREFIX}${edge.id}`
      const textId = `${LABEL_PREFIX}${edge.id}`
      const lines = Array.isArray(edge.labelLines) && edge.labelLines.length > 0 ? edge.labelLines : [edge.label]
      elements.push(
        element('rectangle', chipId, {
          x: plate.x,
          y: plate.y,
          width: plate.w,
          height: plate.h,
          strokeColor: theme.line,
          backgroundColor: theme.surface2,
          strokeWidth: 1,
          roundness: { type: 3 },
          locked: true,
          boundElements: [{ type: 'text', id: textId }],
          customData: { designmap: { kind: 'edge-label-chip', edgeId: edge.id } },
        }),
      )
      elements.push(
        element('text', textId, {
          x: plate.x + 5,
          y: plate.y + 5,
          width: Math.max(24, plate.w - 10),
          height: Math.max(14, plate.h - 10),
          text: lines.join('\n'),
          originalText: lines.join('\n'),
          fontSize: EDGE_FONT_SIZE,
          fontFamily: 2,
          textAlign: 'center',
          verticalAlign: 'middle',
          containerId: chipId,
          lineHeight: EDGE_LINE_HEIGHT,
          strokeColor: theme.ink,
          locked: true,
          customData: { designmap: { kind: 'edge-label', edgeId: edge.id } },
        }),
      )
    }
  }

  // The human's layer is drawn last: above the scene, and locked outside edit mode.
  elements.push(...annotationElements(annotations, { editMode }))
  return elements
}

/** Parse a CSS colour (`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(...)`) into 0..255 channels. */
export function parseColour(colour) {
  const value = String(colour ?? '').trim()
  const hex = /^#([0-9a-f]{3,8})$/iu.exec(value)
  if (hex !== null) {
    const digits = hex[1]
    const expand = digits.length <= 4
      ? digits.slice(0, 3).split('').map(digit => parseInt(`${digit}${digit}`, 16))
      : [0, 2, 4].map(offset => parseInt(digits.slice(offset, offset + 2), 16))
    return expand.every(Number.isFinite) ? expand : null
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/iu.exec(value)
  if (rgb !== null) return [rgb[1], rgb[2], rgb[3]].map(part => Math.round(Number(part)))
  return null
}

/** Relative luminance below 0.35 means a dark colour that needs a light on-colour. */
export function isDarkSurface(colour) {
  const channels = parseColour(colour)
  if (channels === null) return false
  const [r, g, b] = channels.map(channel => {
    const unit = channel / 255
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.35
}

/**
 * The appState a scene wants: the host surface painted as the canvas background.
 *
 * `theme` stays LIGHT on purpose. Excalidraw's dark theme inverts the whole canvas with
 * a CSS filter, which turns our explicit palette (chosen to be readable on the host
 * surface) into its negative; painting the host surface as the background and keeping
 * the editor's theme neutral is what makes the panel look native in both themes.
 */
export function sceneToAppState(look = DEFAULT_LOOK) {
  return {
    viewBackgroundColor: look.surface,
    theme: 'light',
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
