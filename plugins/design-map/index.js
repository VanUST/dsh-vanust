/**
 * PURPOSE
 *   One design map per workspace, in the project root, that the agent writes through a
 *   tool and the human edits visually in the Web client. The file is a real Excalidraw
 *   scene (`design.excalidraw`, plain JSON): the human gets the actual MIT editor, and
 *   the agent gets a small nodes/edges view over the same document, so neither side owns
 *   a private copy. Persistence goes through this service and the `/design-map` command,
 *   because a sandboxed Web frame cannot write the workspace itself.
 *
 *   COORDINATES ARE NOT THE AGENT'S JOB. `design_map` takes nodes with labels and edges
 *   with endpoints; this plugin sizes a box from its label, places missing positions by
 *   graph rank (real sizes, existing rectangles, a fixed gap) and builds the Excalidraw
 *   elements (rectangle + wrapped bound text + boundary-to-boundary orthogonal arrow).
 *   An ordinary upsert never moves a node already in the scene; only `layout` does, and
 *   it requires the rev it read. Every agent write is validated before it is persisted.
 *   The human's drags and renames come back through the same scene, and a read maps them
 *   to the same nodes/edges.
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
 *   timestamp author and age so the orchestrator can see that the map is stale and refresh it.
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
 *   design map, excalidraw, architecture, system design, nodes, edges, stale
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A missing scene is an empty map with rev 0; the first write creates it.
 *   - A malformed file fails loudly; replacing it would destroy the human's drawing.
 *   - Writes are temp-file + rename, so a crash cannot leave half a JSON document.
 *   - The tool refuses a `write` that names no nodes but leaves a non-empty map behind
 *     in `upsert`; `write` is an explicit replacement and `remove` is the explicit delete.
 *   - Unknown elements (freehand strokes, images) are preserved by `upsert` and by the
 *     panel's save; only `write` replaces the whole element list.
 *   - A panel save carries only elements/appState: revision and author are assigned here,
 *     never trusted from the browser.
 *   - An empty label falls back to the node id so a node never renders invisible.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { NODE_GAP, TEXT, analyzeElements, layoutGraph, measureNode, routeEdge } from './layout.js'

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
/**
 * The whole-scene cap the PANEL save obeys too. A node is a rectangle plus its bound text,
 * so 200 boxes + 200 labels + 400 arrows is 800 elements; 1000 leaves room for the human's
 * freehand strokes without letting one save write an unbounded document.
 */
const MAX_ELEMENTS = 1000

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

const NODE_STYLE = {
  stroke: '#1e1e1e',
  background: '#e7f5ff',
}

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
    strokeColor: NODE_STYLE.stroke,
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

/**
 * Build one node as a rectangle plus its bound multiline label.
 *
 * The record carries the numbers measureNode() produced, so the text height and
 * the container height obey the frame's own formula (fontSize * lineHeight *
 * lines + BOUND_TEXT_PADDING * 2) and Excalidraw does not have to grow the box.
 *
 * @param record - {id,label,x,y,width,height,color,lines,textHeight}.
 * @returns The rectangle and text elements, with the text bound to the rectangle.
 */
function buildNode(record) {
  const { id, x, y, width, height, lines, textHeight } = record
  const label = String(record.label ?? '').trim()
  const color = typeof record.color === 'string' && record.color !== '' ? record.color : NODE_STYLE.background
  const labelId = `${id}__label`
  const rectangle = baseElement(id, 'rectangle', x, y, width, height, {
    backgroundColor: color,
    ...(record.style ?? {}),
    boundElements: [{ type: 'text', id: labelId }],
    customData: { designMap: { kind: 'node', position: record.position } },
  })
  const text = baseElement(labelId, 'text', x + TEXT.padding, y + (height - textHeight) / 2, width - TEXT.padding * 2, textHeight, {
    ...(record.textStyle ?? {}),
    text: label === '' ? id : lines.join('\n'),
    originalText: label === '' ? id : lines.join('\n'),
    fontSize: TEXT.fontSize,
    fontFamily: 2,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: id,
    lineHeight: TEXT.lineHeight,
    baseline: Math.round(TEXT.fontSize * 0.8),
    autoResize: true,
    customData: { designMap: { kind: 'label', nodeId: id } },
  })
  return [rectangle, text]
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
    if (element.type === 'rectangle') rectangles += 1
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

/**
 * Build one edge as a bound arrow with a boundary-to-boundary path.
 *
 * The path comes from routeEdge(): it starts and ends on a side midpoint, prefers
 * an orthogonal route, and scores obstacle hits, crossings with the arrows already
 * routed and length. `routed` carries the earlier paths so two arrows do not
 * stack on the same line.
 *
 * @param edge - {id, from, to, label}.
 * @param nodes - Map of rectangle id -> rectangle for the whole final scene.
 * @param routed - Absolute point arrays of arrows already routed in this call.
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
  return baseElement(id, 'arrow', start.x, start.y, maxX - minX, maxY - minY, {
    points: absolute.map((point) => [point.x - start.x, point.y - start.y]),
    lastCommittedPoint: null,
    startBinding: { elementId: from.id, focus: 0, gap: 4 },
    endBinding: { elementId: to.id, focus: 0, gap: 4 },
    startArrowhead: null,
    endArrowhead: 'arrow',
    ...(edge.style ?? {}),
    elbowed: false,
    customData: { designMap: { kind: 'edge', label: typeof edge.label === 'string' ? edge.label.slice(0, 200) : '' } },
  })
}

/** Rectangle id -> rectangle for every live node. */
function nodeIndex(elements) {
  const map = new Map()
  for (const element of elements) {
    if (element !== null && typeof element === 'object' && element.isDeleted !== true && element.type === 'rectangle') map.set(element.id, element)
  }
  return map
}

/** The label bound to a rectangle, from the text element that points at it. */
function labelOf(elements, rectangle) {
  if (!Array.isArray(rectangle.boundElements)) return ''
  const bound = rectangle.boundElements.find((entry) => entry?.type === 'text')
  if (bound === undefined) return ''
  const text = elements.find((entry) => entry?.id === bound.id)
  return typeof text?.text === 'string' ? text.text : ''
}

/** The text element bound to a rectangle, when there is one. */
function labelElementOf(elements, rectangle) {
  const bound = Array.isArray(rectangle.boundElements) ? rectangle.boundElements.find((entry) => entry?.type === 'text') : undefined
  return bound === undefined ? undefined : elements.find((entry) => entry?.id === bound.id)
}

/**
 * Read the agent's view out of a scene: boxes are nodes, bound arrows are edges.
 *
 * @param elements - Excalidraw elements from the file.
 * @returns {nodes, edges} with the positions the human actually left them at.
 */
function deriveMap(elements) {
  const live = Array.isArray(elements) ? elements.filter((element) => element !== null && typeof element === 'object' && element.isDeleted !== true) : []
  const nodes = live
    .filter((element) => element.type === 'rectangle')
    .map((element) => ({
      id: element.id,
      label: labelOf(live, element),
      x: Math.round(element.x),
      y: Math.round(element.y),
      width: Math.round(element.width),
      height: Math.round(element.height),
    }))
  const ids = new Set(nodes.map((node) => node.id))
  const edges = live
    .filter((element) => element.type === 'arrow' && ids.has(element.startBinding?.elementId) && ids.has(element.endBinding?.elementId))
    .map((element) => ({
      id: element.id,
      from: element.startBinding.elementId,
      to: element.endBinding.elementId,
      label: typeof element.customData?.designMap?.label === 'string' ? element.customData.designMap.label : '',
    }))
  return { nodes, edges }
}

/** A rectangle this plugin owns, as opposed to a human's freehand shape. */
function isDesignNode(element) {
  return element !== null && typeof element === 'object' && element.isDeleted !== true && element.type === 'rectangle' && element.customData?.designMap?.kind === 'node'
}

/** Human styling a rebuilt rectangle must not silently reset. */
function styleOf(element) {
  if (element === null || element === undefined) return {}
  const style = {}
  for (const key of ['angle', 'strokeColor', 'fillStyle', 'strokeWidth', 'strokeStyle', 'roughness', 'opacity', 'groupIds', 'frameId', 'roundness', 'link', 'locked']) {
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
  // In an upsert the human box keeps its size and top-left; a label it cannot hold
  // is reported as a warning, not silently reflowed. Layout content-sizes it.
  const size = layout ? measureNode(label, {}) : measureNode(label, { width: element.width, height: element.height })
  return {
    id: element.id,
    label,
    x: element.x,
    y: element.y,
    width: layout ? size.width : element.width,
    height: layout ? size.height : element.height,
    color: element.backgroundColor,
    lines: size.lines,
    textHeight: size.textHeight,
    existing: element,
    style: styleOf(element),
    textStyle: textStyleOf(labelElementOf(elements, element)),
    write: layout,
    auto: layout,
    position: layout ? 'auto' : 'human',
  }
}

/**
 * The record for a node in the payload.
 *
 * AN ORDINARY UPSERT NEVER MOVES AN EXISTING NODE: the payload's x/y are ignored
 * for a node already in the scene, while a new node without x/y is auto-placed.
 * A rename re-sizes the box from its content; the same label keeps a size the
 * human may have dragged.
 */
function recordOfSupplied(node, id, existing, elements) {
  existing = existing ?? undefined
  const raw = typeof node.label === 'string' ? node.label : existing === undefined ? '' : labelOf(elements, existing)
  const trimmed = textOf({ label: raw })
  const label = trimmed === '' ? id : trimmed
  const sameLabel = existing !== undefined && textOf({ label: labelOf(elements, existing) || existing.id }) === label
  const size = existing !== undefined && sameLabel
    ? measureNode(label, { width: existing.width, height: existing.height })
    : measureNode(label, { width: node.width, height: node.height })
  const x = existing !== undefined ? existing.x : (Number.isFinite(node.x) ? node.x : undefined)
  const y = existing !== undefined ? existing.y : (Number.isFinite(node.y) ? node.y : undefined)
  const auto = !Number.isFinite(x) || !Number.isFinite(y)
  return {
    id,
    label,
    x,
    y,
    width: size.width,
    height: size.height,
    color: typeof node.color === 'string' && node.color !== '' ? node.color : (existing?.backgroundColor ?? NODE_STYLE.background),
    lines: size.lines,
    textHeight: size.textHeight,
    existing,
    style: styleOf(existing),
    textStyle: textStyleOf(existing === undefined ? undefined : labelElementOf(elements, existing)),
    write: true,
    auto,
    position: existing !== undefined ? 'human' : auto ? 'auto' : 'fixed',
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

/** The agent-facing metadata view; the elements stay in the file. */
function describe(scene, path, staleAfterMs, layout) {
  const { nodes, edges } = deriveMap(scene.elements)
  const meta = scene[META]
  const updated = meta.updatedAt === null ? Number.NaN : Date.parse(meta.updatedAt)
  return {
    ok: true,
    file: path,
    rev: meta.rev,
    updatedAt: meta.updatedAt,
    updatedBy: meta.updatedBy,
    title: meta.title,
    ageMs: Number.isNaN(updated) ? null : Date.now() - updated,
    stale: Number.isNaN(updated) ? true : Date.now() - updated > staleAfterMs,
    nodes,
    edges,
    elementCount: scene.elements.length,
    ...(layout === undefined ? {} : { layout }),
  }
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
     * Build, merge or rearrange nodes and edges.
     *
     * WRITE replaces every element. UPSERT keeps unknown elements and, crucially,
     * keeps the position of a node that is already in the scene: the agent may
     * rename or resize it, but only `layout` is allowed to move a human's box.
     * LAYOUT rearranges every design-map node around the graph and requires the
     * rev it read, because it rewrites positions on purpose.
     *
     * @param mode - 'write' | 'upsert' | 'layout'.
     */
    apply(cwd, { mode = 'write', nodes = [], edges = [], title, rev, clear = false } = {}, by = 'agent') {
      if (!Array.isArray(nodes)) throw refusal('invalid_nodes', 'nodes must be an array')
      if (!Array.isArray(edges)) throw refusal('invalid_edges', 'edges must be an array')
      if (nodes.length > MAX_NODES) throw refusal('too_many_nodes', `at most ${MAX_NODES} nodes, got ${nodes.length}`)
      if (edges.length > MAX_EDGES) throw refusal('too_many_edges', `at most ${MAX_EDGES} edges, got ${edges.length}`)
      if (mode !== 'write' && mode !== 'upsert' && mode !== 'layout') throw refusal('invalid_op', `unknown mode "${String(mode)}"`)
      const path = scenePath(config, cwd)
      const current = readScene(path)
      const currentElements = current.elements.filter((element) => element !== null && typeof element === 'object')
      // A WRITE IS A REPLACEMENT. With nothing to write it is a delete, and that is what
      // silently wiped a five-element map before this check; `clear: true` is the explicit
      // way to say it.
      if (mode === 'write' && nodes.length === 0 && edges.length === 0 && clear !== true) {
        throw refusal('empty_write', 'a write with no nodes and no edges would erase the map; pass clear: true to mean it')
      }
      if (mode === 'layout') {
        if (nodes.length > 0 || edges.length > 0) throw refusal('invalid_layout', 'layout rearranges the existing map; nodes/edges belong to write/upsert')
        if (currentElements.filter((element) => isDesignNode(element)).length === 0) throw refusal('empty_layout', 'there are no design-map nodes to lay out')
        assertRevision(current, rev, 'layout')
      } else if (mode === 'write') assertRevision(current, rev, 'write')
      else if (rev !== undefined && rev !== null) assertRevision(current, rev, mode)
      // Ids first: the effective id of every node is decided before anything is spliced, so a
      // duplicate is refused instead of producing two elements with one id (which the earlier
      // `nodes:[{id:"dup"},{id:"dup"}]` probe did).
      const payloadIds = new Set()
      const supplied = []
      for (const [index, node] of nodes.entries()) {
        if (node === null || typeof node !== 'object' || Array.isArray(node)) throw refusal('invalid_node', `nodes[${index}] is not an object`)
        if (node.id !== undefined && (typeof node.id !== 'string' || node.id === '')) throw refusal('invalid_node', `nodes[${index}].id must be a non-empty string`)
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
      const existingRects = new Map(currentElements.filter((element) => element.type === 'rectangle' && element.isDeleted !== true).map((element) => [element.id, element]))
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
      const finalIds = new Set(recordMap.keys())
      // Edges to rebuild: every existing arrow between two result nodes, overridden by
      // the payload. Rebuilding all of them is what keeps an old arrow attached when
      // its neighbour is renamed or a new node lands beside it.
      const edgeMap = new Map()
      if (mode !== 'write') {
        for (const element of currentElements) {
          if (element.type !== 'arrow' || element.isDeleted === true) continue
          if (!finalIds.has(element.startBinding?.elementId) || !finalIds.has(element.endBinding?.elementId)) continue
          edgeMap.set(element.id, { id: element.id, from: element.startBinding.elementId, to: element.endBinding.elementId, label: typeof element.customData?.designMap?.label === 'string' ? element.customData.designMap.label : '', style: arrowStyleOf(element) })
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
      // Automatic placement: graph ranks over the real node sizes; explicit and human
      // positions are obstacles, and nothing auto-placed lands within NODE_GAP of them.
      const autoIds = new Set([...recordMap.values()].filter((record) => record.auto).map((record) => record.id))
      const writtenIds = new Set([...recordMap.values()].filter((record) => record.write).map((record) => record.id))
      const sceneRectangles = mode === 'write' ? [] : currentElements.filter((element) => element.type === 'rectangle' && element.isDeleted !== true)
      const obstacles = sceneRectangles.filter((element) => !finalIds.has(element.id)).map((element) => ({ id: element.id, x: element.x, y: element.y, width: element.width, height: element.height }))
      const graphEdges = [...edgeMap.values()].filter((edge) => finalIds.has(edge.from) && finalIds.has(edge.to))
      const records = [...recordMap.values()]
      const placedRects = records.filter((record) => Number.isFinite(record.x) && Number.isFinite(record.y))
      const originX = mode === 'write' || mode === 'layout' ? 80 : Math.min(80, ...placedRects.map((record) => record.x))
      const originY = mode === 'write' || mode === 'layout' ? 80 : Math.min(80, ...placedRects.map((record) => record.y))
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
      // Base: every live element the operation keeps. Written nodes, their labels and all
      // arrows being rebuilt are removed first, so nothing is left stale beside its replacement.
      const removeIds = new Set([...edgeMap.keys()])
      for (const id of writtenIds) {
        removeIds.add(id)
        removeIds.add(`${id}__label`)
        for (const element of currentElements) if (element.type === 'text' && element.containerId === id) removeIds.add(element.id)
      }
      const base = mode === 'write' ? [] : currentElements.filter((element) => element.isDeleted !== true && !removeIds.has(element.id))
      const nextNodes = []
      for (const record of records) if (record.write) nextNodes.push(...buildNode(record))
      const merged = [...base, ...nextNodes]
      const rectangles = new Map()
      for (const element of merged) if (element.type === 'rectangle' && element.isDeleted !== true) rectangles.set(element.id, element)
      const routed = []
      const nextEdges = []
      for (const edge of edgeMap.values()) {
        if (!rectangles.has(edge.from) || !rectangles.has(edge.to)) continue
        const arrow = buildEdge(edge, rectangles, routed)
        if (arrow === null) continue
        nextEdges.push(arrow)
        routed.push(arrow.points.map((point) => ({ x: arrow.x + point[0], y: arrow.y + point[1] })))
      }
      // Excalidraw keeps the binding on BOTH ends: the arrow names the shapes, and each
      // shape names the arrow. EVERY live arrow counts here, including a human arrow
      // whose other end is a plain rectangle this tool did not rebuild; otherwise an
      // upsert would silently detach that arrow from its box.
      const allArrows = [...merged, ...nextEdges].filter((element) => element.type === 'arrow' && element.isDeleted !== true)
      for (const rectangle of rectangles.values()) {
        if (rectangle.customData?.designMap?.kind !== 'node') continue
        const labels = Array.isArray(rectangle.boundElements) ? rectangle.boundElements.filter((entry) => entry?.type === 'text') : []
        const bound = allArrows
          .filter((arrow) => arrow.startBinding?.elementId === rectangle.id || arrow.endBinding?.elementId === rectangle.id)
          .map((arrow) => ({ type: 'arrow', id: arrow.id }))
        rectangle.boundElements = [...labels, ...bound]
      }
      const finalElements = [...merged, ...nextEdges]
      // VALIDATE BEFORE WRITE. Clipping, overlap and an arrow through an unrelated
      // rectangle are refused with the element ids, so the caller can fix the input.
      // Overlaps between two rectangles this call did not touch are outside it and are
      // not reported. Placement keeps NODE_GAP; validation refuses a real touch (2px).
      const issues = analyzeElements(finalElements, {
        gap: 2,
        nodeIds: mode === 'upsert' ? writtenIds : null,
        arrowIds: new Set(nextEdges.map((arrow) => arrow.id)),
      })
      const blocking = issues.filter((issue) => {
        if (issue.kind === 'nonfinite' || issue.kind === 'clip' || issue.kind === 'edge_cross') return true
        if (issue.kind === 'overlap') return mode !== 'upsert' || writtenIds.has(issue.a) || writtenIds.has(issue.b)
        return false
      })
      if (blocking.length > 0) {
        const head = blocking.slice(0, 3).map((issue) => issue.detail).join('; ')
        throw refusal('layout_invalid', `${head}${blocking.length > 3 ? ` (and ${blocking.length - 3} more)` : ''}`)
      }
      // A human box that was already clipped stays exactly where it is (ordinary
      // upsert must not move it); layout is the explicit repair. Say so instead of
      // silently claiming the whole scene is clean.
      const inherited = mode === 'upsert'
        ? analyzeElements(finalElements, { gap: 2, nodeIds: new Set(records.filter((record) => !record.write).map((record) => record.id)), arrowIds: new Set() }).filter((issue) => issue.kind === 'clip')
        : []
      const scene = {
        ...current,
        elements: finalElements,
        [META]: { ...current[META], ...(typeof title === 'string' && title !== '' ? { title: title.slice(0, 200) } : {}) },
      }
      const written = writeScene(path, scene, by)
      return describe(written, path, staleAfterMs, {
        mode,
        placed: autoIds.size,
        preserved: records.filter((record) => !record.write).length,
        edges: nextEdges.length,
        warnings: [...issues.map((issue) => issue.detail), ...inherited.map((issue) => `${issue.detail} (pre-existing; run layout to repair)`)],
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
        if (owner !== undefined) throw refusal('label_id', `"${id}" is the label of node "${owner}"; remove the node id "${owner}" instead`)
      }
      // An id that is not in the scene used to be a silent no-op: the caller could not tell
      // "removed" from "never existed". Name the ids that are not there.
      const present = new Set(current.elements.filter((element) => element !== null && typeof element === 'object').map((element) => element.id))
      const missing = ids.filter((id) => !present.has(id) && !present.has(`${id}__label`))
      if (missing.length > 0) throw refusal('unknown_id', `not in the map: ${missing.slice(0, 5).join(', ')}`)
      const elements = current.elements.filter((element) => {
        if (element === null || typeof element !== 'object') return true
        if (wanted.has(element.id)) return false
        if (element.type === 'text' && element.containerId !== undefined && wanted.has(element.containerId)) return false
        if (element.type === 'arrow' && (wanted.has(element.startBinding?.elementId) || wanted.has(element.endBinding?.elementId))) return false
        return true
      })
      if (elements.length === current.elements.length) return describe(current, path, staleAfterMs)
      // A removal must also clean the other end: an edge's endpoints used to keep the
      // deleted arrow in boundElements, and deleting a label id left a dangling entry.
      const liveIds = new Set(elements.filter((element) => element !== null && typeof element === 'object').map((element) => element.id))
      for (const element of elements) {
        if (element?.type !== 'rectangle' || !Array.isArray(element.boundElements)) continue
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
    description: 'Read or update the workspace design map in design.excalidraw (project root). The human edits the same file visually in the Dsh client. Nodes are boxes with wrapped, content-sized labels; edges are arrows between them. op "read" returns rev/updatedAt/ageMs/stale plus nodes and edges - check stale before trusting it; op "write" replaces the map, "upsert" adds or updates nodes/edges without dropping other elements and never moves a node already in the scene, "layout" rearranges every node by graph rank (needs the rev it read), "remove" deletes ids. Missing positions are placed by graph rank around real node sizes and existing rectangles.',
    parameters: {
      op: { type: 'string', enum: ['read', 'write', 'upsert', 'layout', 'remove'], required: true, description: 'read | write | upsert | layout | remove' },
      nodes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        id: { type: 'string', description: 'Stable node id; reuse it to move or rename an existing node.' },
        label: { type: 'string', description: 'Text shown inside the box.' },
        x: { type: 'number' }, y: { type: 'number' },
        width: { type: 'number' }, height: { type: 'number' },
        color: { type: 'string', description: 'Optional background colour, e.g. #e7f5ff.' },
      } }, description: 'Boxes to create or update (write/upsert).' },
      edges: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        id: { type: 'string' },
        from: { type: 'string', description: 'Source node id.' },
        to: { type: 'string', description: 'Target node id.' },
        label: { type: 'string' },
      } }, description: 'Arrows to create or update (write/upsert).' },
      ids: { type: 'array', items: { type: 'string' }, description: 'Node or edge ids to remove. An id that is not in the scene is refused (unknown_id), not silently ignored.' },
      title: { type: 'string', description: 'Optional map title, returned by read.' },
      rev: { type: 'number', description: 'The rev the caller read. REQUIRED to overwrite a non-empty scene (write) and checked on save/remove when given: a stale rev is refused (stale), so an old view cannot wipe a newer map.' },
      clear: { type: 'boolean', description: 'Explicit permission to replace the whole scene with nothing (write with no nodes/edges). Without it an empty write is refused (empty_write).' },
    },
    output: out(),
    execute(args, exec) {
      const cwd = workingDir(exec.agent)
      try {
        if (args.op === 'read') return Promise.resolve(service.describe(cwd))
        if (args.op === 'remove') return Promise.resolve(service.remove(cwd, args.ids ?? [], { by: 'agent', rev: args.rev }))
        const mode = args.op === 'upsert' ? 'upsert' : args.op === 'layout' ? 'layout' : 'write'
        return Promise.resolve(service.apply(cwd, { mode, nodes: args.nodes ?? [], edges: args.edges ?? [], title: args.title, rev: args.rev, clear: args.clear === true }, 'agent'))
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
        if (op?.op === 'layout') return { kind: 'success', text: JSON.stringify(service.apply(cwd, { mode: 'layout', rev: op.rev, title: op.title }, 'human')) }
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
