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
 *   with endpoints; this plugin lays out missing positions and builds the Excalidraw
 *   elements (rectangle + bound text + bound arrow). The human's drags and renames come
 *   back through the same scene, and a read maps them to the same nodes/edges.
 *
 * INPUTS
 *   Config (all optional):
 *     file          scene path relative to the session workspace. Default 'design.excalidraw'.
 *     staleAfterMs  age at which a read reports `stale: true`. Default 86400000 (one day).
 *
 * OUTPUTS
 *   A `design_map` tool (op: read | write | upsert | remove) registered ONLY on the
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
const DEFAULT_STALE_MS = 24 * 60 * 60 * 1000

const NODE_STYLE = {
  stroke: '#1e1e1e',
  background: '#e7f5ff',
  width: 190,
  height: 76,
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
 * Build one node as a rectangle plus its bound label.
 *
 * @param node - {id, label, x, y, width, height, color} from the tool.
 * @param index - placement index when x/y are missing.
 * @returns The rectangle and text elements, with the text bound to the rectangle.
 */
function buildNode(node, index) {
  const id = String(node.id ?? `node-${index + 1}`).slice(0, 100)
  const label = textOf(node)
  const width = Number.isFinite(node.width) ? Math.max(80, Math.min(600, node.width)) : NODE_STYLE.width
  const height = Number.isFinite(node.height) ? Math.max(40, Math.min(400, node.height)) : NODE_STYLE.height
  const x = Number.isFinite(node.x) ? node.x : (index % 3) * 280
  const y = Number.isFinite(node.y) ? node.y : Math.floor(index / 3) * 150
  const labelId = `${id}__label`
  const rectangle = baseElement(id, 'rectangle', x, y, width, height, {
    backgroundColor: typeof node.color === 'string' && node.color !== '' ? node.color : NODE_STYLE.background,
    boundElements: [{ type: 'text', id: labelId }],
    customData: { designMap: { kind: 'node' } },
  })
  const text = baseElement(labelId, 'text', x + 8, y + height / 2 - 12, width - 16, 24, {
    text: label === '' ? id : label,
    originalText: label === '' ? id : label,
    fontSize: 17,
    fontFamily: 2,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: id,
    lineHeight: 1.25,
    baseline: 18,
    autoResize: true,
    customData: { designMap: { kind: 'label', nodeId: id } },
  })
  return [rectangle, text]
}

/** The point where the line from one rectangle centre leaves the rectangle. */
function edgePoint(from, to) {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2)
  const dy = to.y + to.height / 2 - (from.y + from.height / 2)
  if (dx === 0 && dy === 0) return { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  const halfW = from.width / 2
  const halfH = from.height / 2
  const scale = Math.min(
    dx === 0 ? Infinity : halfW / Math.abs(dx),
    dy === 0 ? Infinity : halfH / Math.abs(dy),
  )
  return { x: from.x + from.width / 2 + dx * scale, y: from.y + from.height / 2 + dy * scale }
}

/** Build one edge as a bound arrow between two rectangles. */
function buildEdge(edge, index, nodes) {
  const from = nodes.get(String(edge.from))
  const to = nodes.get(String(edge.to))
  if (from === undefined || to === undefined) return null
  const start = edgePoint(from, to)
  const end = edgePoint(to, from)
  const dx = end.x - start.x
  const dy = end.y - start.y
  const id = String(edge.id ?? `edge:${from.id}->${to.id}`).slice(0, 140)
  return baseElement(id, 'arrow', start.x, start.y, Math.abs(dx), Math.abs(dy), {
    points: [[0, 0], [dx, dy]],
    lastCommittedPoint: null,
    startBinding: { elementId: from.id, focus: 0, gap: 4 },
    endBinding: { elementId: to.id, focus: 0, gap: 4 },
    startArrowhead: null,
    endArrowhead: 'arrow',
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
function describe(scene, path, staleAfterMs) {
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
      if (elements === null) throw new Error('design-map: save needs an elements array')
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
     * Build or merge nodes and edges.
     *
     * @param mode - 'write' replaces every element; 'upsert' keeps unknown elements and
     *   replaces only the ones named, so the human's freehand annotations survive.
     */
    apply(cwd, { mode = 'write', nodes = [], edges = [], title } = {}, by = 'agent') {
      if (!Array.isArray(nodes)) throw new Error('design-map: nodes must be an array')
      if (!Array.isArray(edges)) throw new Error('design-map: edges must be an array')
      if (nodes.length > MAX_NODES) throw new Error(`design-map: at most ${MAX_NODES} nodes`)
      if (edges.length > MAX_EDGES) throw new Error(`design-map: at most ${MAX_EDGES} edges`)
      const path = scenePath(config, cwd)
      const current = readScene(path)
      const existing = mode === 'write' ? [] : current.elements
      const nextNodes = []
      for (const [index, node] of nodes.entries()) {
        const id = String(node?.id ?? `node-${index + 1}`).slice(0, 100)
        const removed = new Set([id, `${id}__label`])
        for (let at = existing.length - 1; at >= 0; at -= 1) if (removed.has(existing[at]?.id)) existing.splice(at, 1)
        nextNodes.push(...buildNode({ ...node, id }, index))
      }
      const merged = [...existing, ...nextNodes]
      // Edges are derived against the merged rectangle set, so a new edge can point at
      // a node this same call did not redraw.
      const rectangles = new Map()
      for (const element of merged) {
        if (element?.type !== 'rectangle' || element.isDeleted === true) continue
        rectangles.set(element.id, element)
      }
      const nextEdges = []
      for (const [index, edge] of edges.entries()) {
        const id = String(edge?.id ?? `edge:${edge?.from}->${edge?.to}`).slice(0, 140)
        const at = merged.findIndex((element) => element?.id === id)
        if (at !== -1) merged.splice(at, 1)
        const arrow = buildEdge({ ...edge, id }, index, rectangles)
        if (arrow === null) continue
        nextEdges.push(arrow)
        // Excalidraw keeps the binding on BOTH ends: the arrow names the shapes, and
        // each shape names the arrow in boundElements. Without the second half a drag
        // of the shape leaves the arrow behind in empty space, which is exactly what
        // the first human move exposed.
        for (const nodeId of [arrow.startBinding.elementId, arrow.endBinding.elementId]) {
          const rectangle = rectangles.get(nodeId)
          if (rectangle === undefined) continue
          const bound = Array.isArray(rectangle.boundElements) ? rectangle.boundElements : []
          rectangle.boundElements = [...bound.filter((entry) => entry?.id !== arrow.id), { type: 'arrow', id: arrow.id }]
        }
      }
      const scene = {
        ...current,
        elements: [...merged, ...nextEdges],
        [META]: { ...current[META], ...(typeof title === 'string' && title !== '' ? { title: title.slice(0, 200) } : {}) },
      }
      const written = writeScene(path, scene, by)
      return describe(written, path, staleAfterMs)
    },
    /** Remove node or edge ids; arrows attached to a removed node go with it. */
    remove(cwd, ids, by = 'agent') {
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new Error('design-map: ids must be a string array')
      const wanted = new Set(ids)
      const path = scenePath(config, cwd)
      const current = readScene(path)
      const elements = current.elements.filter((element) => {
        if (element === null || typeof element !== 'object') return true
        if (wanted.has(element.id)) return false
        if (element.type === 'text' && element.containerId !== undefined && wanted.has(element.containerId)) return false
        if (element.type === 'arrow' && (wanted.has(element.startBinding?.elementId) || wanted.has(element.endBinding?.elementId))) return false
        return true
      })
      if (elements.length === current.elements.length) return describe(current, path, staleAfterMs)
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
    description: 'Read or update the workspace design map in design.excalidraw (project root). The human edits the same file visually in the Dsh client. Nodes are boxes with labels; edges are arrows between them. op "read" returns rev/updatedAt/ageMs/stale plus nodes and edges - check stale before trusting it; op "write" replaces the map, "upsert" adds or updates nodes/edges without dropping other elements, "remove" deletes ids. Positions are optional; missing ones are laid out automatically.',
    parameters: {
      op: { type: 'string', enum: ['read', 'write', 'upsert', 'remove'], required: true, description: 'read | write | upsert | remove' },
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
      ids: { type: 'array', items: { type: 'string' }, description: 'Node or edge ids to remove.' },
      title: { type: 'string', description: 'Optional map title, returned by read.' },
    },
    output: out(),
    execute(args, exec) {
      const cwd = workingDir(exec.agent)
      if (args.op === 'read') return Promise.resolve(service.describe(cwd))
      if (args.op === 'remove') return Promise.resolve(service.remove(cwd, args.ids ?? [], 'agent'))
      const mode = args.op === 'upsert' ? 'upsert' : 'write'
      return Promise.resolve(service.apply(cwd, { mode, nodes: args.nodes ?? [], edges: args.edges ?? [], title: args.title }, 'agent'))
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
        if (op?.op === 'remove') return { kind: 'success', text: JSON.stringify(service.remove(cwd, op.ids ?? [], 'human')) }
        return { kind: 'error', text: 'design-map: unknown op (read | save | remove)' }
      } catch (error) {
        return { kind: 'error', text: `design-map: ${error.message}` }
      }
    },
  })
}

export { createService, readScene, writeScene, deriveMap }
