/**
 * PURPOSE
 *   One design map per workspace, in the project root, that the agent writes through a
 *   tool and the human edits visually in the Web client. The file is a real Excalidraw
 *   scene (`design.excalidraw`, plain JSON): the human gets the actual MIT editor, and
 *   the agent gets a small nodes/edges view over the same document, so neither side owns
 *   a private copy. Persistence goes through this service and the `/design-map` command,
 *   because a sandboxed Web frame cannot write the workspace itself.
 *
 *   COORDINATES ARE NOT THE AGENT'S JOB. `design_map` takes nodes with labels, a kind
 *   and an optional layer, and edges with endpoints; this plugin sizes a shape from its
 *   label, places it (graph columns when there are no layers, a layers-by-stage grid when
 *   there are), routes the arrows and builds the Excalidraw elements. An ordinary upsert
 *   never moves a node already in the scene; only `layout` does, and it requires the rev
 *   it read. Every agent write is validated before it is persisted.
 *
 *   THE MAP EXPLAINS ITSELF. A node is a shape the kind names - rectangle (service),
 *   ellipse (store), diamond (decision), dashed rectangle (external) - with a bound label
 *   the human edits by double-click. A layer is a titled band the node belongs to. An edge
 *   is a bound arrow whose label is a bound text, so a flow can say "command". The map has
 *   one title at the top. Nothing the tool accepts is invisible on the canvas.
 *
 *   THE AGENT SEES WHAT IT DRAWS. Every result carries `preview` - the real geometry
 *   rendered as a few lines of text - and `health` - the validator's verdict on the scene
 *   as it stands. `health.ok === false` names the boxes that clip, overlap or stand outside
 *   their band, so the agent can run `layout` instead of guessing.
 *
 * INPUTS
 *   Config (all optional):
 *     file          scene path relative to the session workspace. Default 'design.excalidraw'.
 *     staleAfterMs  age at which a read reports `stale: true`. Default 86400000 (one day).
 *
 * OUTPUTS
 *   A `design_map` tool (op: read | write | upsert | layout | remove) registered ONLY on the
 *   `orchestrator` preset, a `/design-map` command used by the panel (which is not a tool,
 *   so it keeps working for the human), and the scene file. `read` returns the revision,
 *   timestamp, author, age, the compact map, the preview and the health verdict.
 *
 *   THE MAP HAS TWO OWNERS, AND A TOOL IS A PERMISSION. The human owns it through the
 *   panel; the orchestrator owns it because keeping the system design current is its job.
 *   A specialist child (backend, ux, reviewer, research, docs) has no business rewriting
 *   the design of the system it was asked to work inside, so it never receives the tool:
 *   `registerForOrchestrator` scopes the registration per agent by `agentPreset`, the same
 *   way the papers tools are scoped to the research role. A session with no recorded
 *   preset gets NO tool - unlike the papers gate, which keeps its tool for an unknown
 *   composition, an ownership boundary fails closed.
 *
 * KEYWORDS
 *   design map, excalidraw, architecture, system design, layers, nodes, edges, stale
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A missing scene is an empty map with rev 0; the first write creates it.
 *   - A malformed file fails loudly; replacing it would destroy the human's drawing.
 *   - Writes are temp-file + rename, so a crash cannot leave half a JSON document.
 *   - The tool refuses a `write` that names no nodes but leaves a non-empty map behind
 *     in `upsert`; `write` is an explicit replacement and `remove` is the explicit delete.
 *   - Unknown elements (freehand strokes, images, plain human boxes) are preserved by
 *     `upsert` and by the panel's save; only `write` replaces the whole element list.
 *   - A panel save carries only elements/appState: revision and author are assigned here,
 *     never trusted from the browser.
 *   - An empty label falls back to the node id so a node never renders invisible.
 *   - A layer is a band, not a group: its members stay individually draggable, so the
 *     human never moves a whole layer by trying to move one box.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import {
  KIND_SPEC,
  LANE,
  TEXT,
  TITLE,
  analyzeElements,
  advanceAt,
  kindOf,
  layoutGraph,
  measureNode,
  placeLanes,
  routeEdge,
  wrapLabel,
} from './layout.js'
import { renderPreview } from './preview.js'

/** Cordis function-plugin name; also the id the profile patch targets. */
export const name = 'design-map'

/** Both registries are required. */
export const inject = ['tools', 'commands']

const SCENE_TYPE = 'excalidraw'
const SCENE_VERSION = 2
const SOURCE = 'https://github.com/cc/dsh-design-map'
/** Metadata lives at the scene root; Excalidraw ignores unknown root keys. */
const META = 'designMap'
const MAX_NODES = 200
const MAX_EDGES = 400
const MAX_LAYERS = 32
/**
 * The whole-scene cap the PANEL save obeys too. A node is a shape plus its bound text and
 * an edge is an arrow plus its label, so a full map is 200 + 200 + 400 + 400 = 1200
 * elements before layers (2 each) and the human's strokes. 1000 was the cap before edge
 * labels doubled the arrows, and it made a legal map unsaveable from the panel.
 */
const MAX_ELEMENTS = 2000
/** Node / layer / edge label metrics that are not the node label's. */
const EDGE_LABEL = { fontSize: 14, lineHeight: 1.25, maxWidth: 150, gap: 8 }
const TITLE_MAX_WIDTH = 900
const TITLE_ELEMENT = 'title'

/**
 * A refusal the caller can quote: an Error carrying a stable code.
 *
 * The tool turns it into `{ok:false, code, message}` and the command into
 * `{kind:'error', text:'design-map: <code>: <detail>'}`, so an agent and the panel see the
 * same word for the same refusal (empty_write, stale, duplicate_node_id, ...).
 *
 * @param code - Stable refusal code.
 * @param detail - One sentence naming the offending input.
 * @returns The Error to throw.
 */
function refusal(code, detail) {
  const error = new Error(`design-map: ${code}: ${detail}`)
  error.code = code
  return error
}
const DEFAULT_STALE_MS = 24 * 60 * 60 * 1000

/** Resolve the session workspace, falling back to the process directory. */
export function workingDir(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd()
}

function now() {
  return new Date().toISOString()
}

function scenePath(config, cwd) {
  const file = typeof config.file === 'string' && config.file !== '' ? config.file : 'design.excalidraw'
  return isAbsolute(file) ? file : resolve(cwd, file)
}

/** A stable 31-bit seed from an id, so a rebuilt element keeps its rough look. */
function seedOf(id) {
  let hash = 2166136261
  for (const char of String(id)) {
    hash ^= char.codePointAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function textOf(node) {
  return String(node.label ?? node.id ?? '').trim().slice(0, 200)
}

/** The fields every Excalidraw element carries; the version fields make it restorable. */
function baseElement(id, type, x, y, width, height, extra) {
  const seed = seedOf(id)
  return {
    id,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: type === 'rectangle' ? { type: 3 } : null,
    seed,
    version: 1,
    versionNonce: seed,
    isDeleted: false,
    boundElements: [],
    updated: Date.now(),
    link: null,
    locked: false,
    ...extra,
  }
}

/** The Excalidraw ids this plugin owns, derived from the semantic ids. */
const labelIdOf = (nodeId) => `${nodeId}__label`
const laneElementId = (layerId) => `layer:${layerId}`
const laneTitleId = (layerId) => `layer:${layerId}__title`

/**
 * Build one node as a shape plus its bound label.
 *
 * The shape follows the kind; the label is sized from the rectangle inscribed in that
 * shape, so an ellipse or a diamond does not paint text over its own outline. The record
 * carries the numbers measureNode() produced, so Excalidraw does not have to grow the box.
 *
 * @param record - {id,label,kind,layer,x,y,width,height,color,lines,textHeight,inscribed,style,textStyle}.
 * @returns The shape and its text element, with the text bound to the shape.
 */
function buildNode(record) {
  const spec = KIND_SPEC[record.kind]
  const labelId = labelIdOf(record.id)
  const label = String(record.label ?? '').trim()
  const inscribed = record.inscribed ?? { x: 1, y: 1 }
  const innerWidth = Math.max(record.width * inscribed.x - TEXT.padding * 2, 20)
  const textHeight = record.textHeight
  const shape = baseElement(record.id, spec.element, record.x, record.y, record.width, record.height, {
    backgroundColor: typeof record.color === 'string' && record.color !== '' ? record.color : KIND_SPEC[record.kind].color,
    strokeStyle: spec.strokeStyle,
    roundness: spec.element === 'rectangle' ? { type: 3 } : null,
    ...(record.style ?? {}),
    boundElements: [{ type: 'text', id: labelId }],
    customData: { designMap: { kind: 'node', nodeKind: record.kind, layer: record.layer ?? null } },
  })
  const text = baseElement(labelId, 'text', record.x + (record.width - innerWidth) / 2, record.y + (record.height - textHeight) / 2, innerWidth, textHeight, {
    ...(record.textStyle ?? {}),
    text: label === '' ? record.id : record.lines.join('\n'),
    originalText: label === '' ? record.id : record.lines.join('\n'),
    fontSize: TEXT.fontSize,
    fontFamily: 2,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: record.id,
    lineHeight: TEXT.lineHeight,
    baseline: Math.round(TEXT.fontSize * 0.8),
    autoResize: true,
    customData: { designMap: { kind: 'label', nodeId: record.id } },
  })
  return [shape, text]
}

/**
 * Build one layer band: a locked, dashed, tinted rectangle and its title.
 *
 * The band is LOCKED and not grouped. Grouping would make a drag on any member move the
 * whole layer - the opposite of what a human editing one box expects - and an unlocked
 * band would steal the click. A locked band is decoration the agent owns: the human drags
 * the boxes inside it, and `layout` redraws the band around them.
 *
 * @param lane - {id,label,color}.
 * @param box - {x,y,width,height} from placeLanes().
 */
function buildLane(lane, box) {
  const rect = baseElement(laneElementId(lane.id), 'rectangle', box.x, box.y, box.width, box.height, {
    backgroundColor: typeof lane.color === 'string' && lane.color !== '' ? lane.color : LANE.fill,
    strokeColor: LANE.stroke,
    strokeStyle: 'dashed',
    strokeWidth: 1,
    roughness: 0,
    locked: true,
    roundness: { type: 3 },
    customData: { designMap: { kind: 'layer', layerId: lane.id } },
  })
  const title = String(lane.label ?? lane.id)
  const width = Math.max(advanceAt(title, LANE.titleSize) + 4, 20)
  const label = baseElement(laneTitleId(lane.id), 'text', box.x + 14, box.y + 11, width, Math.round(LANE.titleSize * 1.25), {
    text: title,
    originalText: title,
    fontSize: LANE.titleSize,
    fontFamily: 2,
    textAlign: 'left',
    verticalAlign: 'top',
    containerId: null,
    lineHeight: 1.25,
    baseline: Math.round(LANE.titleSize * 0.8),
    autoResize: true,
    locked: true,
    boundElements: [],
    customData: { designMap: { kind: 'layerLabel', layerId: lane.id } },
  })
  return [rect, label]
}

/** The map title: one text element above everything, sized from its own lines. */
function buildTitle(text, originX) {
  const lines = wrapLabel(text, TITLE_MAX_WIDTH, TITLE.fontSize)
  const width = Math.ceil(Math.max(...lines.map((line) => advanceAt(line, TITLE.fontSize))) + 4)
  const height = Math.ceil(lines.length * TITLE.fontSize * 1.25)
  return baseElement(TITLE_ELEMENT, 'text', originX, TITLE.top, width, height, {
    text: lines.join('\n'),
    originalText: String(text),
    fontSize: TITLE.fontSize,
    fontFamily: 2,
    textAlign: 'left',
    verticalAlign: 'top',
    containerId: null,
    lineHeight: 1.25,
    baseline: Math.round(TITLE.fontSize * 0.8),
    autoResize: true,
    boundElements: [],
    customData: { designMap: { kind: 'title' } },
  })
}

/** Height of the title block for a given text, 0 when the map has no title. */
function titleHeightOf(text) {
  if (typeof text !== 'string' || text === '') return 0
  const lines = wrapLabel(text, TITLE_MAX_WIDTH, TITLE.fontSize)
  return Math.ceil(lines.length * TITLE.fontSize * 1.25) + TITLE.gapAfter
}

/**
 * Measure an edge label at its own, smaller font.
 *
 * @param label - The flow text.
 * @returns {lines,textWidth,textHeight,width,height}
 */
function measureEdgeLabel(label) {
  const lines = wrapLabel(label, EDGE_LABEL.maxWidth, EDGE_LABEL.fontSize)
  const textWidth = Math.max(...lines.map((line) => advanceAt(line, EDGE_LABEL.fontSize))) * 1.15
  return { lines, textWidth, textHeight: lines.length * EDGE_LABEL.fontSize * EDGE_LABEL.lineHeight, width: Math.ceil(textWidth) + 6 }
}

/**
 * Where an arrow's label goes: above a horizontal run, to the right of a vertical one.
 *
 * The longest segment is the calmest place to read a flow's name. Placing a horizontal
 * label above its line and a vertical label beside its line keeps two flows meeting at
 * one box from stacking their labels on top of each other.
 */
function labelAnchor(absolute) {
  let best = null
  for (let i = 1; i < absolute.length; i += 1) {
    const a = absolute[i - 1]
    const b = absolute[i]
    const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
    if (best === null || length > best.length) best = { a, b, length, horizontal: Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) }
  }
  if (best === null) return { x: absolute[0].x, y: absolute[0].y, horizontal: true }
  return { x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2, horizontal: best.horizontal }
}

/**
 * Build one edge as a bound arrow, plus its bound label when it has text.
 *
 * The path comes from routeEdge(): it starts and ends on a side midpoint, prefers an
 * orthogonal route, and scores obstacle hits, crossings with the arrows already routed and
 * length. `routed` carries the earlier paths so two arrows do not stack on the same line.
 * The label is a text element bound to the arrow (Excalidraw 0.18.1 lists an arrow among
 * the text containers), so double-clicking the arrow edits the flow's name.
 *
 * @param edge - {id,from,to,label,style}.
 * @param nodes - Map of shape id -> rectangle for the whole final scene.
 * @param routed - Absolute point arrays of arrows already routed in this call.
 * @returns {arrow, label} - label is null when the edge has no text.
 */
function buildEdge(edge, nodes, routed) {
  const from = nodes.get(String(edge.from))
  const to = nodes.get(String(edge.to))
  if (from === undefined || to === undefined) return null
  const obstacles = [...nodes.values()].filter((node) => node.id !== from.id && node.id !== to.id)
  const route = routeEdge(from, to, obstacles, routed)
  const absolute = route.points.map((point) => ({ x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 }))
  // Excalidraw normalizes a linear element as "first point at (0,0)"; the rest may
  // be negative. Its LinearElementEditor logs "not normalized" otherwise when the
  // arrow is selected (measured on the dense scene), so keep that invariant.
  const start = absolute[0]
  const maxX = Math.max(...absolute.map((point) => point.x))
  const minX = Math.min(...absolute.map((point) => point.x))
  const maxY = Math.max(...absolute.map((point) => point.y))
  const minY = Math.min(...absolute.map((point) => point.y))
  const id = String(edge.id ?? `edge:${from.id}->${to.id}`).slice(0, 140)
  const text = typeof edge.label === 'string' ? edge.label.trim().slice(0, 200) : ''
  const labelId = labelIdOf(id)
  const arrow = baseElement(id, 'arrow', start.x, start.y, maxX - minX, maxY - minY, {
    points: absolute.map((point) => [point.x - start.x, point.y - start.y]),
    lastCommittedPoint: null,
    startBinding: { elementId: from.id, focus: 0, gap: 4 },
    endBinding: { elementId: to.id, focus: 0, gap: 4 },
    startArrowhead: null,
    endArrowhead: 'arrow',
    ...(edge.style ?? {}),
    elbowed: false,
    boundElements: text === '' ? [] : [{ type: 'text', id: labelId }],
    customData: { designMap: { kind: 'edge', label: text } },
  })
  if (text === '') return { arrow, label: null }
  const measure = measureEdgeLabel(text)
  const anchor = labelAnchor(absolute)
  const labelX = anchor.horizontal ? anchor.x - measure.width / 2 : anchor.x + EDGE_LABEL.gap
  const labelY = anchor.horizontal ? anchor.y - measure.textHeight - EDGE_LABEL.gap : anchor.y - measure.textHeight / 2
  const label = baseElement(labelId, 'text', Math.round(labelX), Math.round(labelY), measure.width, Math.ceil(measure.textHeight), {
    text: measure.lines.join('\n'),
    originalText: text,
    fontSize: EDGE_LABEL.fontSize,
    fontFamily: 2,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: id,
    lineHeight: EDGE_LABEL.lineHeight,
    baseline: Math.round(EDGE_LABEL.fontSize * 0.8),
    autoResize: true,
    boundElements: [],
    customData: { designMap: { kind: 'edgeLabel', edgeId: id } },
  })
  return { arrow, label }
}

/**
 * Validate a whole element array the way the tool validates its nodes and edges.
 *
 * Only the invariants that do not require interpreting the document: every element is an
 * object with a non-empty string id, ids are unique, and the document obeys the same
 * node/edge/total caps the tool has. A human's freehand strokes and images are counted by
 * the total cap and otherwise left alone - the panel is not asked to speak nodes-and-edges.
 *
 * @param elements - The array a caller wants to write.
 * @param label - Where the refusal came from (`save`), for the message.
 */
function validateElements(elements, label = 'save') {
  if (elements.length > MAX_ELEMENTS) throw refusal('too_many_elements', `${label} carries ${elements.length} elements; at most ${MAX_ELEMENTS}`)
  let rectangles = 0
  let arrows = 0
  const seen = new Set()
  for (const [index, element] of elements.entries()) {
    if (element === null || typeof element !== 'object' || Array.isArray(element)) throw refusal('invalid_element', `${label} elements[${index}] is not an object`)
    if (typeof element.id !== 'string' || element.id === '') throw refusal('invalid_element', `${label} elements[${index}] has no string id`)
    if (seen.has(element.id)) throw refusal('duplicate_id', `${label} names the id "${element.id}" twice`)
    seen.add(element.id)
    // A band is a rectangle too, but it is not a node: counting it against the node cap
    // would make a layer-rich but small map unsaveable from the panel.
    if (SHAPE_TYPES.has(element.type)) { if (element.customData?.designMap?.kind !== 'layer') rectangles += 1 }
    else if (element.type === 'arrow') arrows += 1
  }
  if (rectangles > MAX_NODES) throw refusal('too_many_nodes', `${label} carries ${rectangles} nodes; at most ${MAX_NODES}`)
  if (arrows > MAX_EDGES) throw refusal('too_many_edges', `${label} carries ${arrows} edges; at most ${MAX_EDGES}`)
}

/**
 * Compare-and-set for a whole-scene write.
 *
 * A scene somebody has already drawn in is not a blank file: overwriting it without the rev
 * the caller read means the writer is describing a document that may no longer exist, and
 * the human's last drag disappears. An empty scene needs no rev (there is nothing to lose).
 *
 * @param current - The scene on disk.
 * @param rev - The rev the caller claims to have read.
 * @param what - The operation name for the message.
 */
function assertRevision(current, rev, what = 'write') {
  const elements = Array.isArray(current?.elements) ? current.elements : []
  if (elements.length === 0) return
  if (rev === undefined || rev === null) throw refusal('needs_rev', `${what} over a non-empty scene needs the rev it read (current rev ${current?.[META]?.rev ?? 0})`)
  if (!Number.isSafeInteger(rev) || rev !== (current?.[META]?.rev ?? 0)) throw refusal('stale', `${what} read rev ${String(rev)}, the scene is at rev ${current?.[META]?.rev ?? 0}`)
}

/** The element types a node can be drawn as. */
const SHAPE_TYPES = new Set(['rectangle', 'ellipse', 'diamond'])
const isShape = (element) => element !== null && typeof element === 'object' && element.isDeleted !== true && SHAPE_TYPES.has(element.type)

/** The label bound to a shape, from the text element that points at it. */
function labelOf(elements, rectangle) {
  if (!Array.isArray(rectangle.boundElements)) return ''
  const bound = rectangle.boundElements.find((entry) => entry?.type === 'text')
  if (bound === undefined) return ''
  const text = elements.find((entry) => entry?.id === bound.id)
  return typeof text?.text === 'string' ? text.text : ''
}

/** The text element bound to a shape, when there is one. */
function labelElementOf(elements, rectangle) {
  const bound = Array.isArray(rectangle.boundElements) ? rectangle.boundElements.find((entry) => entry?.type === 'text') : undefined
  return bound === undefined ? undefined : elements.find((entry) => entry?.id === bound.id)
}

/** The label bound to an arrow, or the one recorded on it, or ''. */
function edgeLabelOf(elements, arrow) {
  const bound = Array.isArray(arrow.boundElements) ? arrow.boundElements.find((entry) => entry?.type === 'text') : undefined
  const text = bound === undefined ? undefined : elements.find((entry) => entry?.id === bound.id)
  if (typeof text?.text === 'string' && text.text !== '') return text.text
  return typeof arrow.customData?.designMap?.label === 'string' ? arrow.customData.designMap.label : ''
}

/** The kind a shape element was drawn as, for a scene that predates `nodeKind`. */
function kindOfElement(element) {
  const recorded = element.customData?.designMap?.nodeKind
  if (KIND_SPEC[recorded] !== undefined) return recorded
  if (element.type === 'ellipse') return 'store'
  if (element.type === 'diamond') return 'decision'
  if (element.strokeStyle === 'dashed') return 'external'
  return 'service'
}

/**
 * Read the agent's view out of a scene: shapes are nodes, bound arrows are edges, layer
 * bands are layers, and the title text is the title.
 *
 * @param elements - Excalidraw elements from the file.
 * @returns {nodes, edges, layers, title} with the positions the human actually left.
 */
function deriveMap(elements) {
  const live = Array.isArray(elements) ? elements.filter((element) => element !== null && typeof element === 'object' && element.isDeleted !== true) : []
  const lanes = []
  for (const element of live) {
    if (element.type !== 'rectangle' || element.customData?.designMap?.kind !== 'layer') continue
    const layerId = element.customData.designMap.layerId ?? element.id
    const titleElement = live.find((entry) => entry.type === 'text' && entry.customData?.designMap?.kind === 'layerLabel' && entry.customData.designMap.layerId === layerId)
    lanes.push({
      id: layerId,
      label: typeof titleElement?.text === 'string' ? titleElement.text : layerId,
      color: element.backgroundColor,
      x: Math.round(element.x),
      y: Math.round(element.y),
      width: Math.round(element.width),
      height: Math.round(element.height),
      members: [],
    })
  }
  const nodes = live
    .filter((element) => SHAPE_TYPES.has(element.type) && element.customData?.designMap?.kind !== 'layer')
    .map((element) => ({
      id: element.id,
      label: labelOf(live, element),
      kind: kindOfElement(element),
      layer: typeof element.customData?.designMap?.layer === 'string' ? element.customData.designMap.layer : null,
      x: Math.round(element.x),
      y: Math.round(element.y),
      width: Math.round(element.width),
      height: Math.round(element.height),
    }))
  lanes.sort((a, b) => a.y - b.y)
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]))
  for (const node of nodes) {
    const lane = laneById.get(node.layer)
    if (lane !== undefined) lane.members.push(node.id)
  }
  const ids = new Set(nodes.map((node) => node.id))
  const edges = live
    .filter((element) => element.type === 'arrow' && ids.has(element.startBinding?.elementId) && ids.has(element.endBinding?.elementId))
    .map((element) => ({
      id: element.id,
      from: element.startBinding.elementId,
      to: element.endBinding.elementId,
      label: edgeLabelOf(live, element),
    }))
  const titleElement = live.find((element) => element.type === 'text' && element.customData?.designMap?.kind === 'title')
  return { nodes, edges, layers: lanes, title: typeof titleElement?.text === 'string' ? titleElement.text : '' }
}

/** A shape this plugin owns, as opposed to a human's freehand shape. */
function isDesignNode(element) {
  return isShape(element) && element.customData?.designMap?.kind === 'node'
}

/** A layer band this plugin owns. */
function isDesignLayer(element) {
  return element !== null && typeof element === 'object' && element.isDeleted !== true && element.type === 'rectangle' && element.customData?.designMap?.kind === 'layer'
}

/** Human styling a rebuilt shape must not silently reset. */
function styleOf(element) {
  if (element === null || element === undefined) return {}
  const style = {}
  // `strokeStyle` and `roundness` are the KIND's identity (dashed = external, diamond
  // outline), so a kind change must not inherit the old shape's outline. A human's
  // colour, width, angle, grouping, link and lock still survive.
  for (const key of ['angle', 'strokeColor', 'fillStyle', 'strokeWidth', 'roughness', 'opacity', 'groupIds', 'frameId', 'link', 'locked']) {
    if (element[key] !== undefined) style[key] = element[key]
  }
  return style
}

/** Human label styling that survives a rebuild (font size/family stay system-sized). */
function textStyleOf(element) {
  if (element === null || element === undefined) return {}
  const style = {}
  for (const key of ['angle', 'groupIds', 'strokeColor', 'opacity', 'link', 'locked']) {
    if (element[key] !== undefined) style[key] = element[key]
  }
  return style
}

/** Human arrow styling that survives a re-route (geometry and bindings are rebuilt). */
function arrowStyleOf(element) {
  if (element === null || element === undefined) return {}
  const style = {}
  for (const key of ['strokeColor', 'strokeWidth', 'strokeStyle', 'fillStyle', 'roughness', 'opacity', 'groupIds', 'startArrowhead', 'endArrowhead', 'locked', 'link']) {
    if (element[key] !== undefined) style[key] = element[key]
  }
  return style
}

/**
 * The record for a node already in the scene.
 *
 * In an upsert it is a fixed obstacle: its position and size are the human's. In a
 * layout it is repositioned and re-sized from its label, because that is what the
 * explicit layout operation was asked to do.
 */
function recordOfExisting(element, elements, layout) {
  const rawLabel = textOf({ label: labelOf(elements, element) })
  const label = rawLabel === '' ? element.id : rawLabel
  const kind = kindOfElement(element)
  // In an upsert the human box keeps its size and top-left; a label it cannot hold
  // is reported as a warning, not silently reflowed. Layout content-sizes it.
  const size = layout ? measureNode(label, { kind }) : measureNode(label, { width: element.width, height: element.height, kind })
  return {
    id: element.id,
    label,
    kind,
    layer: typeof element.customData?.designMap?.layer === 'string' ? element.customData.designMap.layer : null,
    x: element.x,
    y: element.y,
    width: layout ? size.width : element.width,
    height: layout ? size.height : element.height,
    color: element.backgroundColor,
    lines: size.lines,
    textWidth: size.textWidth,
    textHeight: size.textHeight,
    inscribed: size.inscribed,
    existing: element,
    style: styleOf(element),
    textStyle: textStyleOf(labelElementOf(elements, element)),
    write: layout,
    auto: layout,
  }
}

/**
 * The record for a node in the payload.
 *
 * AN ORDINARY UPSERT NEVER MOVES AN EXISTING NODE: the payload's x/y are ignored
 * for a node already in the scene, while a new node without x/y is auto-placed.
 * A rename or a kind change re-sizes the shape from its content; the same label and
 * kind keep a size the human may have dragged.
 */
function recordOfSupplied(node, id, existing, elements) {
  existing = existing ?? undefined
  const raw = typeof node.label === 'string' ? node.label : existing === undefined ? '' : labelOf(elements, existing)
  const trimmed = textOf({ label: raw })
  const label = trimmed === '' ? id : trimmed
  const existingKind = existing === undefined ? undefined : kindOfElement(existing)
  const kind = kindOf(node.kind ?? existingKind)
  const sameLabel = existing !== undefined && textOf({ label: labelOf(elements, existing) || existing.id }) === label
  const size = existing !== undefined && sameLabel && kind === existingKind
    ? measureNode(label, { width: existing.width, height: existing.height, kind })
    : measureNode(label, { width: node.width, height: node.height, kind })
  const x = existing !== undefined ? existing.x : (Number.isFinite(node.x) ? node.x : undefined)
  const y = existing !== undefined ? existing.y : (Number.isFinite(node.y) ? node.y : undefined)
  const auto = !Number.isFinite(x) || !Number.isFinite(y)
  return {
    id,
    label,
    kind,
    layer: typeof node.layer === 'string' && node.layer !== '' ? node.layer : (existing?.customData?.designMap?.layer ?? null),
    x,
    y,
    width: size.width,
    height: size.height,
    color: typeof node.color === 'string' && node.color !== '' ? node.color : (existing?.backgroundColor ?? KIND_SPEC[kind].color),
    lines: size.lines,
    textWidth: size.textWidth,
    textHeight: size.textHeight,
    inscribed: size.inscribed,
    existing,
    style: styleOf(existing),
    textStyle: textStyleOf(existing === undefined ? undefined : labelElementOf(elements, existing)),
    write: true,
    auto,
  }
}

/** A scene read from disk, or an empty one when the file does not exist. */
function readScene(path) {
  if (!existsSync(path)) {
    return { type: SCENE_TYPE, version: SCENE_VERSION, source: SOURCE, elements: [], appState: {}, files: {}, [META]: { rev: 0, updatedAt: null, updatedBy: null, title: '' } }
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`design-map: ${path} is not valid JSON: ${error.message}`)
  }
  if (parsed === null || typeof parsed !== 'object' || parsed.type !== SCENE_TYPE || !Array.isArray(parsed.elements)) {
    throw new Error(`design-map: ${path} is not an Excalidraw scene (expected type "excalidraw" and an elements array)`)
  }
  const meta = parsed[META] !== null && typeof parsed[META] === 'object' ? parsed[META] : {}
  return {
    ...parsed,
    type: SCENE_TYPE,
    version: Number.isSafeInteger(parsed.version) ? parsed.version : SCENE_VERSION,
    source: typeof parsed.source === 'string' ? parsed.source : SOURCE,
    elements: parsed.elements,
    appState: parsed.appState !== null && typeof parsed.appState === 'object' ? parsed.appState : {},
    files: parsed.files !== null && typeof parsed.files === 'object' ? parsed.files : {},
    [META]: {
      rev: Number.isSafeInteger(meta.rev) ? meta.rev : 0,
      updatedAt: typeof meta.updatedAt === 'string' ? meta.updatedAt : null,
      updatedBy: typeof meta.updatedBy === 'string' ? meta.updatedBy : null,
      title: typeof meta.title === 'string' ? meta.title : '',
    },
  }
}

/** Write a scene atomically, bumping the revision and stamping the author. */
function writeScene(path, scene, by) {
  mkdirSync(dirname(path), { recursive: true })
  const meta = scene[META]
  const next = {
    ...scene,
    type: SCENE_TYPE,
    version: SCENE_VERSION,
    source: SOURCE,
    elements: scene.elements,
    appState: scene.appState,
    files: scene.files ?? {},
    [META]: {
      rev: (Number.isSafeInteger(meta?.rev) ? meta.rev : 0) + 1,
      updatedAt: now(),
      updatedBy: by === 'human' ? 'human' : 'agent',
      title: typeof meta?.title === 'string' ? meta.title : '',
    },
  }
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  renameSync(temp, path)
  return next
}

/** The validator's verdict, capped so a broken map cannot flood the result. */
function healthOf(elements) {
  const issues = analyzeElements(elements, { gap: 2 })
  return {
    ok: issues.length === 0,
    issueCount: issues.length,
    issues: issues.slice(0, 8),
    ...(issues.length === 0 ? {} : { hint: 'run layout to repair' }),
  }
}

/** The agent-facing metadata view: the compact map, the preview and the health verdict. */
function describe(scene, path, staleAfterMs, layout) {
  const map = deriveMap(scene.elements)
  const meta = scene[META]
  const updated = meta.updatedAt === null ? Number.NaN : Date.parse(meta.updatedAt)
  // The drawn title element is the truth: metadata alone is not on the canvas, so a read
  // must not claim a title the human cannot see.
  const title = map.title
  const health = healthOf(scene.elements)
  const preview = renderPreview({
    title,
    rev: meta.rev,
    nodes: map.nodes,
    edges: map.edges,
    lanes: map.layers,
    health,
    elementCount: scene.elements.length,
  })
  return {
    ok: true,
    file: path,
    rev: meta.rev,
    updatedAt: meta.updatedAt,
    updatedBy: meta.updatedBy,
    title,
    ageMs: Number.isNaN(updated) ? null : Date.now() - updated,
    stale: Number.isNaN(updated) ? true : Date.now() - updated > staleAfterMs,
    nodes: map.nodes.map(({ id, label, kind, layer }) => ({ id, label, kind, ...(layer === null ? {} : { layer }) })),
    edges: map.edges,
    layers: map.layers.map(({ id, label, color, members }) => ({ id, label, color, members })),
    health,
    preview,
    elementCount: scene.elements.length,
    ...(layout === undefined ? {} : { layout }),
  }
}

/**
 * The issues that make THIS call invalid.
 *
 * A pre-existing defect on a box the call did not touch is not a reason to refuse an
 * unrelated edit - it is reported as a warning instead, because an ordinary upsert must
 * not move a human's box to fix it. Lane geometry is always rebuilt, so its issues always
 * block.
 */
function issueKey(issue) {
  return [issue.kind, issue.id, issue.a, issue.b, issue.rect].filter((part) => part !== undefined).sort().join('|')
}

function blockingIssues(issues, { mode, previous }) {
  return issues.filter((issue) => {
    if (issue.kind === 'nonfinite' || issue.kind === 'edge_cross' || issue.kind === 'dangling') return true
    // A write and a layout rebuild the map: every defect in the result is the caller's.
    // An upsert moves nothing, so a defect it did not introduce is a warning with a
    // `run layout` hint - not a reason to refuse an unrelated edit.
    if (mode !== 'upsert') return true
    return !previous.has(issueKey(issue))
  })
}

function createService(config, logger) {
  const staleAfterMs = Number.isSafeInteger(config.staleAfterMs) && config.staleAfterMs > 0 ? config.staleAfterMs : DEFAULT_STALE_MS

  const service = {
    path(configPath, cwd) {
      return scenePath(config, cwd)
    },
    read(cwd) {
      const path = scenePath(config, cwd)
      return { scene: readScene(path), path }
    },
    describe(cwd) {
      const path = scenePath(config, cwd)
      return describe(readScene(path), path, staleAfterMs)
    },
    /** The panel's save: elements/appState only; revision and author are host-assigned. */
    save(cwd, payload, by = 'human') {
      const path = scenePath(config, cwd)
      const current = readScene(path)
      const elements = Array.isArray(payload?.elements) ? payload.elements : null
      if (elements === null) throw refusal('needs_elements', 'a save needs an elements array')
      // THE PANEL OBEYS THE SAME LIMITS AS THE TOOL. A browser save used to write 5000
      // elements while the tool capped at 200 nodes / 400 edges; the caps are a property of
      // the document, not of the caller.
      validateElements(elements, 'save')
      assertRevision(current, payload?.rev, 'save')
      const scene = {
        ...current,
        elements,
        appState: payload?.appState !== null && typeof payload.appState === 'object' ? payload.appState : current.appState,
        files: payload?.files !== null && typeof payload.files === 'object' ? payload.files : current.files,
        [META]: current[META],
      }
      const written = writeScene(path, scene, by)
      return describe(written, path, staleAfterMs)
    },
    /**
     * Build, merge or rearrange nodes, layers and edges.
     *
     * WRITE replaces every element. UPSERT keeps unknown elements and, crucially,
     * keeps the position of a node that is already in the scene: the agent may
     * rename, recolour or re-shape it, but only `layout` is allowed to move a human's
     * box. LAYOUT rearranges every design-map node around the graph and requires the
     * rev it read, because it rewrites positions on purpose.
     *
     * @param mode - 'write' | 'upsert' | 'layout'.
     */
    apply(cwd, { mode = 'write', nodes = [], edges = [], layers = [], title, rev, clear = false } = {}, by = 'agent') {
      if (!Array.isArray(nodes)) throw refusal('invalid_nodes', 'nodes must be an array')
      if (!Array.isArray(edges)) throw refusal('invalid_edges', 'edges must be an array')
      if (!Array.isArray(layers)) throw refusal('invalid_layers', 'layers must be an array')
      if (nodes.length > MAX_NODES) throw refusal('too_many_nodes', `at most ${MAX_NODES} nodes, got ${nodes.length}`)
      if (edges.length > MAX_EDGES) throw refusal('too_many_edges', `at most ${MAX_EDGES} edges, got ${edges.length}`)
      if (layers.length > MAX_LAYERS) throw refusal('too_many_layers', `at most ${MAX_LAYERS} layers, got ${layers.length}`)
      if (mode !== 'write' && mode !== 'upsert' && mode !== 'layout') throw refusal('invalid_op', `unknown mode "${String(mode)}"`)
      const path = scenePath(config, cwd)
      const current = readScene(path)
      const currentElements = current.elements.filter((element) => element !== null && typeof element === 'object')
      // A WRITE IS A REPLACEMENT. With nothing to write it is a delete, and that is what
      // silently wiped a five-element map before this check; `clear: true` is the explicit
      // way to say it.
      if (mode === 'write' && nodes.length === 0 && edges.length === 0 && layers.length === 0 && clear !== true) {
        throw refusal('empty_write', 'a write with no nodes, edges or layers would erase the map; pass clear: true to mean it')
      }
      if (mode === 'layout') {
        if (nodes.length > 0 || edges.length > 0) throw refusal('invalid_layout', 'layout rearranges the existing map; nodes/edges belong to write/upsert')
        if (currentElements.filter((element) => isDesignNode(element)).length === 0) throw refusal('empty_layout', 'there are no design-map nodes to lay out')
        assertRevision(current, rev, 'layout')
      } else if (mode === 'write') assertRevision(current, rev, 'write')
      else if (rev !== undefined && rev !== null) assertRevision(current, rev, mode)
      // Ids first: the effective id of every node is decided before anything is spliced, so a
      // duplicate is refused instead of producing two elements with one id.
      const payloadIds = new Set()
      const supplied = []
      for (const [index, node] of nodes.entries()) {
        if (node === null || typeof node !== 'object' || Array.isArray(node)) throw refusal('invalid_node', `nodes[${index}] is not an object`)
        if (node.id !== undefined && (typeof node.id !== 'string' || node.id === '')) throw refusal('invalid_node', `nodes[${index}].id must be a non-empty string`)
        if (node.kind !== undefined && KIND_SPEC[node.kind] === undefined) throw refusal('invalid_kind', `nodes[${index}].kind "${String(node.kind)}" is not one of ${Object.keys(KIND_SPEC).join(', ')}`)
        if (node.layer !== undefined && (typeof node.layer !== 'string' || node.layer === '')) throw refusal('invalid_layer', `nodes[${index}].layer must be a non-empty string`)
        const id = String(node.id ?? `node-${index + 1}`).slice(0, 100)
        if (payloadIds.has(id)) throw refusal('duplicate_node_id', `the node id "${id}" is named twice`)
        payloadIds.add(id)
        supplied.push({ node, id })
      }
      for (const edge of edges) {
        if (edge === null || typeof edge !== 'object' || Array.isArray(edge)) throw refusal('invalid_edge', 'an edge is not an object')
        for (const end of ['from', 'to']) {
          if (typeof edge[end] !== 'string' || edge[end] === '') throw refusal('invalid_edge', `an edge is missing its "${end}" node id`)
        }
      }
      // LAYERS. Membership comes from `node.layer` - one source of truth, so a node cannot
      // belong to two layers. A band the scene already has keeps its label and colour; the
      // payload's order is the band order a write or a layout draws, so declared layers
      // come first in the order given and the undeclared ones follow by their current
      // vertical position. An upsert keeps existing bands in place and appends new ones.
      const existingLanes = new Map()
      if (mode !== 'write') {
        for (const element of currentElements) {
          if (!isDesignLayer(element)) continue
          const layerId = element.customData.designMap.layerId ?? element.id
          const titleElement = currentElements.find((entry) => entry.type === 'text' && entry.customData?.designMap?.kind === 'layerLabel' && entry.customData.designMap.layerId === layerId)
          existingLanes.set(layerId, {
            id: layerId,
            label: typeof titleElement?.text === 'string' && titleElement.text !== '' ? titleElement.text : layerId,
            color: typeof element.backgroundColor === 'string' ? element.backgroundColor : LANE.fill,
            y: element.y,
          })
        }
      }
      const laneMap = new Map()
      for (const [index, layer] of layers.entries()) {
        if (layer === null || typeof layer !== 'object' || Array.isArray(layer)) throw refusal('invalid_layer', `layers[${index}] is not an object`)
        if (typeof layer.id !== 'string' || layer.id === '') throw refusal('invalid_layer', `layers[${index}].id must be a non-empty string`)
        const id = layer.id.slice(0, 100)
        const previous = existingLanes.get(id)
        laneMap.set(id, {
          id,
          label: typeof layer.label === 'string' && layer.label !== '' ? layer.label.slice(0, 120) : (previous?.label ?? id),
          color: typeof layer.color === 'string' && layer.color !== '' ? layer.color : (previous?.color ?? LANE.fill),
        })
      }
      for (const lane of [...existingLanes.values()].sort((a, b) => a.y - b.y)) {
        if (!laneMap.has(lane.id)) laneMap.set(lane.id, { id: lane.id, label: lane.label, color: lane.color })
      }
      const existingRects = new Map(currentElements.filter((element) => isShape(element) && element.customData?.designMap?.kind !== 'layer').map((element) => [element.id, element]))
      // One record per node in the RESULT. A human-positioned node that an upsert did
      // not name still takes part in ranking, but it is not rewritten and it keeps x/y.
      const recordMap = new Map()
      for (const element of currentElements) {
        if (!isDesignNode(element) || mode === 'write') continue
        // In an upsert an unnamed node is a fixed obstacle; in a layout every design
        // node is repositioned and content-sized.
        recordMap.set(element.id, recordOfExisting(element, currentElements, mode === 'layout'))
      }
      for (const { node, id } of supplied) {
        const existing = mode === 'write' ? null : existingRects.get(id)
        recordMap.set(id, recordOfSupplied(node, id, existing, currentElements))
      }
      // A node that ALREADY existed keeps the layer it names even if a human deleted the
      // band by hand: the band is derived decoration, so the next write rebuilds it. Only
      // a node the payload introduces can name a layer nothing declares (a typo).
      for (const record of recordMap.values()) {
        if (record.layer === null || record.layer === undefined || laneMap.has(record.layer)) continue
        if (record.existing === undefined) continue
        laneMap.set(record.layer, { id: record.layer, label: record.layer, color: LANE.fill })
      }
      // Every node belongs to exactly one layer, or the map has no layers at all.
      for (const record of recordMap.values()) {
        if (laneMap.size > 0) {
          if (record.layer === null || record.layer === undefined) throw refusal('layer_required', `node "${record.id}" needs a layer: this map has layers, so every node names one`)
          if (!laneMap.has(record.layer)) throw refusal('unknown_layer', `node "${record.id}" names layer "${record.layer}", which is not declared; declare it in layers[] or fix the id`)
        } else if (record.layer !== null && record.layer !== undefined) {
          throw refusal('unknown_layer', `node "${record.id}" names layer "${record.layer}", but the map has no layers; declare layers[] too`)
        }
      }
      for (const lane of laneMap.values()) {
        if (payloadIds.has(laneElementId(lane.id))) throw refusal('duplicate_node_id', `a node id collides with the layer element id "${laneElementId(lane.id)}"`)
      }
      const finalIds = new Set(recordMap.keys())
      // Edges to rebuild: every existing arrow between two result nodes, overridden by
      // the payload. Rebuilding all of them is what keeps an old arrow attached when
      // its neighbour is renamed or a new node lands beside it.
      const edgeMap = new Map()
      if (mode !== 'write') {
        for (const element of currentElements) {
          if (element.type !== 'arrow' || element.isDeleted === true) continue
          if (!finalIds.has(element.startBinding?.elementId) || !finalIds.has(element.endBinding?.elementId)) continue
          edgeMap.set(element.id, {
            id: element.id,
            from: element.startBinding.elementId,
            to: element.endBinding.elementId,
            label: edgeLabelOf(currentElements, element),
            style: arrowStyleOf(element),
          })
        }
      }
      const edgeIds = new Set()
      for (const edge of edges) {
        const id = String(edge.id ?? `edge:${edge.from}->${edge.to}`).slice(0, 140)
        if (edgeIds.has(id)) throw refusal('duplicate_edge_id', `the edge id "${id}" is named twice`)
        edgeIds.add(id)
        for (const end of ['from', 'to']) {
          if (!finalIds.has(edge[end])) throw refusal('unknown_edge_node', `the edge endpoint "${edge[end]}" is not a node in the map`)
        }
        edgeMap.set(id, { id, from: edge.from, to: edge.to, label: edge.label ?? edgeMap.get(id)?.label ?? '', style: edgeMap.get(id)?.style ?? {} })
      }
      // The title: the payload's, else the one the map already has. A write with nothing
      // to say drops the old title with the rest of the scene.
      const existingTitle = currentElements.find((element) => element.type === 'text' && element.customData?.designMap?.kind === 'title')
      const legacyTitle = typeof current[META]?.title === 'string' ? current[META].title : ''
      let titleText = typeof title === 'string' && title !== ''
        ? title.slice(0, 200)
        : (mode === 'write' ? '' : (typeof existingTitle?.text === 'string' ? existingTitle.text : ''))
      // A map written before titles were drawn carries the title only in the metadata.
      // One explicit layout migrates it onto the canvas; an upsert never resurrects a
      // title the human deleted.
      if (titleText === '' && mode === 'layout' && legacyTitle !== '') titleText = legacyTitle.slice(0, 200)
      const contentTop = 80 + titleHeightOf(titleText)
      // Automatic placement: graph ranks over the real node sizes; explicit and human
      // positions are obstacles, and nothing auto-placed lands within NODE_GAP of them.
      const autoIds = new Set([...recordMap.values()].filter((record) => record.auto).map((record) => record.id))
      const writtenIds = new Set([...recordMap.values()].filter((record) => record.write).map((record) => record.id))
      const sceneRectangles = mode === 'write' ? [] : currentElements.filter((element) => element.type === 'rectangle' && element.isDeleted !== true && !isDesignNode(element) && !isDesignLayer(element))
      const obstacles = sceneRectangles.map((element) => ({ id: element.id, x: element.x, y: element.y, width: element.width, height: element.height }))
      const graphEdges = [...edgeMap.values()].filter((edge) => finalIds.has(edge.from) && finalIds.has(edge.to))
      const records = [...recordMap.values()]
      const placedRects = records.filter((record) => Number.isFinite(record.x) && Number.isFinite(record.y))
      const originX = mode === 'write' || mode === 'layout' ? 80 : Math.min(80, ...placedRects.map((record) => record.x))
      const laneBoxes = new Map()
      if (laneMap.size > 0) {
        // An upsert keeps the bands it finds; only layout redraws them.
        const fixedLanes = new Map()
        if (mode === 'upsert') {
          for (const element of currentElements) {
            if (!isDesignLayer(element)) continue
            const layerId = element.customData.designMap.layerId ?? element.id
            fixedLanes.set(layerId, { id: layerId, x: element.x, y: element.y, width: element.width, height: element.height })
          }
        }
        const { positions, overflow, lanes } = placeLanes({
          nodes: records.map((record) => ({ id: record.id, width: record.width, height: record.height, layer: record.layer, x: record.auto ? undefined : record.x, y: record.auto ? undefined : record.y })),
          edges: graphEdges,
          lanes: [...laneMap.values()],
          obstacles,
          originX,
          originY: contentTop,
          fixed: fixedLanes,
        })
        for (const box of lanes) laneBoxes.set(box.id, box)
        if (overflow.length > 0) throw refusal('layer_full', `layer "${records.find((record) => record.id === overflow[0])?.layer ?? '?'}" has no free cell for "${overflow[0]}"; run layout to rebuild the bands`)
        for (const record of records) {
          if (!record.auto) continue
          const at = positions.get(record.id)
          record.x = Number.isFinite(at?.x) ? at.x : originX
          record.y = Number.isFinite(at?.y) ? at.y : contentTop
        }
      } else {
        const originY = mode === 'write' || mode === 'layout' ? contentTop : Math.min(contentTop, ...placedRects.map((record) => record.y))
        const positions = layoutGraph({
          nodes: records.map((record) => ({ id: record.id, width: record.width, height: record.height, x: record.auto ? undefined : record.x, y: record.auto ? undefined : record.y })),
          edges: graphEdges,
          obstacles,
          originX,
          originY,
        })
        for (const record of records) if (record.auto) {
          const at = positions.get(record.id)
          record.x = Number.isFinite(at?.x) ? at.x : originX
          record.y = Number.isFinite(at?.y) ? at.y : originY
        }
      }
      // Base: every live element the operation keeps. Written nodes, their labels, every
      // rebuilt arrow and its label, every band and the rebuilt title are removed first,
      // so nothing is left stale beside its replacement.
      const removeIds = new Set()
      for (const id of edgeMap.keys()) {
        removeIds.add(id)
        // A human who double-clicked the arrow made a text with its own id; sweep every
        // text bound to the arrow, not only the label this plugin would have named.
        for (const element of currentElements) if (element.type === 'text' && element.containerId === id) removeIds.add(element.id)
      }
      for (const id of writtenIds) {
        removeIds.add(id)
        removeIds.add(labelIdOf(id))
        for (const element of currentElements) if (element.type === 'text' && element.containerId === id) removeIds.add(element.id)
      }
      for (const lane of laneMap.values()) {
        removeIds.add(laneElementId(lane.id))
        removeIds.add(laneTitleId(lane.id))
        for (const element of currentElements) {
          if (element.type === 'text' && element.customData?.designMap?.kind === 'layerLabel' && element.customData.designMap.layerId === lane.id) removeIds.add(element.id)
        }
      }
      const titleElement = titleText === '' ? null : buildTitle(titleText, originX)
      if (titleElement !== null || mode === 'write') removeIds.add(TITLE_ELEMENT)
      const base = mode === 'write' ? [] : currentElements.filter((element) => element.isDeleted !== true && !removeIds.has(element.id))
      const nextNodes = []
      for (const record of records) if (record.write) nextNodes.push(...buildNode(record))
      const laneElements = []
      for (const lane of laneMap.values()) {
        const box = laneBoxes.get(lane.id)
        if (box !== undefined) laneElements.push(...buildLane(lane, box))
      }
      const merged = [...base, ...laneElements, ...nextNodes]
      const rectangles = new Map()
      for (const element of merged) if (isShape(element) && !isDesignLayer(element)) rectangles.set(element.id, element)
      const routed = []
      const nextEdges = []
      const nextEdgeLabels = []
      for (const edge of edgeMap.values()) {
        if (!rectangles.has(edge.from) || !rectangles.has(edge.to)) continue
        const built = buildEdge(edge, rectangles, routed)
        if (built === null) continue
        nextEdges.push(built.arrow)
        if (built.label !== null) nextEdgeLabels.push(built.label)
        routed.push(built.arrow.points.map((point) => ({ x: built.arrow.x + point[0], y: built.arrow.y + point[1] })))
      }
      // Excalidraw keeps the binding on BOTH ends: the arrow names the shapes, and each
      // shape names the arrow. EVERY live arrow counts here, including a human arrow
      // whose other end is a plain rectangle this tool did not rebuild; otherwise an
      // upsert would silently detach that arrow from its box.
      const allArrows = [...merged, ...nextEdges].filter((element) => element.type === 'arrow' && element.isDeleted !== true)
      for (const rectangle of rectangles.values()) {
        const labels = Array.isArray(rectangle.boundElements) ? rectangle.boundElements.filter((entry) => entry?.type === 'text') : []
        const bound = allArrows
          .filter((arrow) => arrow.startBinding?.elementId === rectangle.id || arrow.endBinding?.elementId === rectangle.id)
          .map((arrow) => ({ type: 'arrow', id: arrow.id }))
        rectangle.boundElements = [...labels, ...bound]
      }
      const finalElements = [
        ...(titleElement === null ? [] : [titleElement]),
        ...laneElements,
        ...base,
        ...nextNodes,
        ...nextEdges,
        ...nextEdgeLabels,
      ]
      const seenIds = new Set()
      for (const element of finalElements) {
        if (seenIds.has(element.id)) throw refusal('duplicate_id', `the resulting scene names the id "${element.id}" twice`)
        seenIds.add(element.id)
      }
      // VALIDATE BEFORE WRITE. Clipping, overlap, an arrow through an unrelated
      // rectangle and a node outside its band are refused with the element ids, so the
      // caller can fix the input. A defect on a box this call did not touch is reported
      // in `layout.warnings` instead: an ordinary upsert must not move a human's box.
      const issues = analyzeElements(finalElements, {
        gap: 2,
        nodeIds: mode === 'upsert' ? writtenIds : null,
        arrowIds: new Set(nextEdges.map((arrow) => arrow.id)),
      })
      const previous = new Set(analyzeElements(currentElements, { gap: 2 }).map(issueKey))
      const blocking = blockingIssues(issues, { mode, previous })
      if (blocking.length > 0) {
        const head = blocking.slice(0, 3).map((issue) => issue.detail).join('; ')
        const hint = mode === 'upsert' && blocking.some((issue) => issue.kind.includes('layer')) ? '; run layout to rebuild the bands' : ''
        throw refusal('layout_invalid', `${head}${blocking.length > 3 ? ` (and ${blocking.length - 3} more)` : ''}${hint}`)
      }
      const warnings = issues.filter((issue) => !blocking.includes(issue)).map((issue) => `${issue.detail} (pre-existing; run layout to repair)`)
      const scene = {
        ...current,
        elements: finalElements,
        [META]: { ...current[META], title: titleText },
      }
      const written = writeScene(path, scene, by)
      return describe(written, path, staleAfterMs, {
        mode,
        placed: autoIds.size,
        preserved: records.filter((record) => !record.write).length,
        layers: laneMap.size,
        edges: nextEdges.length,
        warnings,
      })
    },
    /** Remove node or edge ids; arrows attached to a removed node go with it. */
    remove(cwd, ids, { by = 'agent', rev } = {}) {
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || id === '')) throw refusal('invalid_ids', 'ids must be a string array')
      const wanted = new Set(ids)
      const path = scenePath(config, cwd)
      const current = readScene(path)
      if (rev !== undefined && rev !== null) assertRevision(current, rev, 'remove')
      // A label is owned by its node: deleting only the text would leave an unlabeled
      // rectangle whose boundElements names a missing element. Refuse and name the owner.
      const labelOwners = new Map(
        current.elements
          .filter((element) => element !== null && typeof element === 'object' && element.type === 'text' && typeof element.containerId === 'string')
          .map((element) => [element.id, element.containerId]),
      )
      for (const id of ids) {
        const owner = labelOwners.get(id)
        if (owner !== undefined) throw refusal('label_id', `"${id}" is the label of "${owner}"; remove "${owner}" instead`)
        // A band owns no member: deleting it would leave nodes naming a layer with no
        // band, and nothing could rebuild it (layout and upsert both need a declared
        // layer). Remove the members or move them to another layer instead.
        if (current.elements.some((element) => element?.id === id && element.customData?.designMap?.kind === 'layer')) {
          throw refusal('layer_id', `"${id}" is a layer band; remove or move its member nodes instead`)
        }
      }
      // An id that is not in the scene used to be a silent no-op: the caller could not tell
      // "removed" from "never existed". Name the ids that are not there.
      const present = new Set(current.elements.filter((element) => element !== null && typeof element === 'object').map((element) => element.id))
      const missing = ids.filter((id) => !present.has(id) && !present.has(labelIdOf(id)))
      if (missing.length > 0) throw refusal('unknown_id', `not in the map: ${missing.slice(0, 5).join(', ')}`)
      // An arrow that binds to a removed node goes too, and a label is owned by its
      // container: both the node labels and the labels of the arrows leaving with it.
      const removedArrows = new Set(
        current.elements
          .filter((element) => element?.type === 'arrow' && (wanted.has(element.id) || wanted.has(element.startBinding?.elementId) || wanted.has(element.endBinding?.elementId)))
          .map((element) => element.id),
      )
      const elements = current.elements.filter((element) => {
        if (element === null || typeof element !== 'object') return true
        if (wanted.has(element.id)) return false
        if (element.type === 'text' && element.containerId !== undefined && (wanted.has(element.containerId) || removedArrows.has(element.containerId))) return false
        if (removedArrows.has(element.id)) return false
        return true
      })
      if (elements.length === current.elements.length) return describe(current, path, staleAfterMs)
      // A removal must also clean the other end: an edge's endpoints used to keep the
      // deleted arrow in boundElements, and deleting a label id left a dangling entry.
      const liveIds = new Set(elements.filter((element) => element !== null && typeof element === 'object').map((element) => element.id))
      for (const element of elements) {
        if (!isShape(element) || !Array.isArray(element.boundElements)) continue
        element.boundElements = element.boundElements.filter((entry) => entry !== null && typeof entry === 'object' && liveIds.has(entry.id))
      }
      const written = writeScene(path, { ...current, elements }, by)
      return describe(written, path, staleAfterMs)
    },
  }
  return service
}

/**
 * Register one tool only on agents whose session preset is `orchestrator`.
 *
 * A tool an agent never received cannot be argued into existence by a brief, which is
 * what makes this an ownership boundary rather than a request. An unknown or absent
 * preset is refused too: failing closed is the right default for a permission.
 *
 * @param ctx - Cordis context (host).
 * @param tool - The design_map tool definition.
 */
export function registerForOrchestrator(ctx, tool) {
  ctx.on('agent/created', ({ agent }) => {
    if (agent?.session?.header?.agentPreset === 'orchestrator') agent.ctx.tools.register(tool)
  })
}

export function apply(ctx, config = {}) {
  const service = createService(config, ctx.logger)

  const out = () => ({
    schema: { type: 'json' },
    render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }],
  })

  const tool = defineTool({
    name: 'design_map',
    description: 'Read or update the workspace design map in design.excalidraw (project root); the human edits the same scene visually in the Dsh client. A node is a shape named by its kind - rectangle service, ellipse store, diamond decision, dashed rectangle external - with a text label inside, and the human can edit that label by double-click. A layer is a titled band that nodes belong to (vertical order = lane order, left-to-right = flow stages); without layers the map is a left-to-right graph. An edge is an arrow between nodes and its label names the flow. The map has one title. Every result carries `preview` (the real geometry as text - read it to see what the human sees) and `health` (the validator verdict: clipping, overlap, bad layer containment); when health.ok is false, run `layout`. op "read" returns rev/updatedAt/ageMs/stale plus the compact map, preview and health - check stale before trusting it; "write" replaces the map, "upsert" adds or updates nodes/edges/layers without dropping other elements and never moves a node already in the scene, "layout" rearranges every node by graph rank in its layer and can take layers[] to relabel or reorder the bands (needs the rev it read), "remove" deletes ids.',
    parameters: {
      op: { type: 'string', enum: ['read', 'write', 'upsert', 'layout', 'remove'], required: true, description: 'read | write | upsert | layout | remove' },
      nodes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        id: { type: 'string', description: 'Stable node id; reuse it to rename or restyle an existing node.' },
        label: { type: 'string', description: 'Text inside the shape. Keep it short - a noun phrase, one idea - and use newlines only when the label is genuinely two lines.' },
        kind: { type: 'string', enum: Object.keys(KIND_SPEC), description: 'service = rectangle (a running part), store = ellipse (data at rest), decision = diamond (a branch/choice), external = dashed rectangle (outside the system). Default service.' },
        layer: { type: 'string', description: 'The id of the layer band this node belongs to. Required once the map has any layer; declare the layer in layers[] or reuse an id read returned.' },
        color: { type: 'string', description: 'Optional background colour, e.g. #e7f5ff. Defaults to the kind\'s colour.' },
        x: { type: 'number', description: 'Rarely needed: pin the left edge. Auto-placement is the point of the tool.' },
        y: { type: 'number', description: 'Rarely needed: pin the top edge.' },
        width: { type: 'number' }, height: { type: 'number' },
      } }, description: 'Boxes to create or update (write/upsert).' },
      edges: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        id: { type: 'string', description: 'Optional stable id; defaults to edge:<from>-><to>.' },
        from: { type: 'string', description: 'Source node id.' },
        to: { type: 'string', description: 'Target node id.' },
        label: { type: 'string', description: 'What flows, as a short phrase (e.g. "HTTP command", "event"). Drawn on the arrow and editable by double-clicking it.' },
      } }, description: 'Arrows to create or update (write/upsert).' },
      layers: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        id: { type: 'string', description: 'Stable layer id, referenced by node.layer.' },
        label: { type: 'string', description: 'The band title the human reads, e.g. "Client". Defaults to the id.' },
        color: { type: 'string', description: 'Optional band tint; defaults to a neutral grey.' },
      } }, description: 'Layer bands to create or relabel (write/upsert/layout). Order here is the top-to-bottom order a write, or a layout, draws; an upsert keeps the bands it finds in place and appends new ones at the bottom. A node names its layer; a layer does not list its members.' },
      ids: { type: 'array', items: { type: 'string' }, description: 'Node or edge ids to remove. An id that is not in the scene is refused (unknown_id), not silently ignored.' },
      title: { type: 'string', description: 'The map title drawn above everything; also returned by read.' },
      rev: { type: 'number', description: 'The rev the caller read. REQUIRED to overwrite a non-empty scene (write) and checked on save/remove when given: a stale rev is refused (stale), so an old view cannot wipe a newer map.' },
      clear: { type: 'boolean', description: 'Explicit permission to replace the whole scene with nothing (write with no nodes/edges/layers). Without it an empty write is refused (empty_write).' },
    },
    output: out(),
    execute(args, exec) {
      const cwd = workingDir(exec.agent)
      try {
        if (args.op === 'read') return Promise.resolve(service.describe(cwd))
        if (args.op === 'remove') return Promise.resolve(service.remove(cwd, args.ids ?? [], { by: 'agent', rev: args.rev }))
        const mode = args.op === 'upsert' ? 'upsert' : args.op === 'layout' ? 'layout' : 'write'
        return Promise.resolve(service.apply(cwd, {
          mode,
          nodes: args.nodes ?? [],
          edges: args.edges ?? [],
          layers: args.layers ?? [],
          title: args.title,
          rev: args.rev,
          clear: args.clear === true,
        }, 'agent'))
      } catch (error) {
        // A refusal is a value: the model gets the code, the same word the panel shows.
        if (typeof error?.code === 'string') return Promise.resolve({ ok: false, code: error.code, message: error.message })
        throw error
      }
    },
  })

  // Registered per agent, not host-wide: the design map belongs to the orchestrator and
  // the human. The command below is NOT gated - it is the human's panel path.
  registerForOrchestrator(ctx, tool)

  ctx.commands.register({
    name: 'design-map',
    description: 'Read or save the workspace Excalidraw design map (used by the Design map panel).',
    recordInput: false,
    handler: (invocation) => {
      let op
      try {
        op = JSON.parse(invocation.rawInput)
      } catch {
        return { kind: 'error', text: 'design-map: expected a JSON operation' }
      }
      try {
        const cwd = workingDir(invocation.agent)
        if (op?.op === 'read') return { kind: 'success', text: JSON.stringify(service.read(cwd).scene) }
        if (op?.op === 'save') return { kind: 'success', text: JSON.stringify(service.save(cwd, op, 'human')) }
        if (op?.op === 'remove') return { kind: 'success', text: JSON.stringify(service.remove(cwd, op.ids ?? [], { by: 'human', rev: op.rev })) }
        if (op?.op === 'layout') return { kind: 'success', text: JSON.stringify(service.apply(cwd, { mode: 'layout', rev: op.rev, title: op.title, layers: op.layers ?? [] }, 'human')) }
        return { kind: 'error', text: 'design-map: unknown op (read | save | layout | remove)' }
      } catch (error) {
        // A refusal already reads `design-map: <code>: <detail>`; anything else gets the prefix.
        const message = String(error?.message ?? error)
        return { kind: 'error', text: message.startsWith('design-map:') ? message : `design-map: ${message}` }
      }
    },
  })
}

export { createService, readScene, writeScene, deriveMap }
