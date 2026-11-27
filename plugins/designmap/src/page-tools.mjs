/**
 * The five map tools of the page document (design-map v2): map_list, map_read, map_lint,
 * map_edit and map_render.
 *
 * They are the whole agent surface of the plugin. Each one is a thin wrapper over
 * src/pages.mjs, src/outline.mjs, src/lint.mjs and src/ops.mjs so a plugin-local test can call
 * the same code without a harness, and the schema is deliberately loose: an op is a name plus a
 * few fields, and an unknown field is ignored rather than refused.
 *
 * THE DESCRIPTIONS ARE PART OF THE INSTRUMENT. An agent that only reads a schema draws boxes
 * blind; each description names the next call to make (diagram -> map_lint -> map_render) and
 * carries a worked example, because a model plans from the tool text it is given.
 */
import { listPages, readPage } from './pages.mjs'
import { hintsOf, lintOutline, readOutline } from './outline.mjs'
import { applyOp, renderPage, OPS } from './ops.mjs'

const string = (description, required = false) => ({ type: 'string', description, ...(required ? { required: true } : {}) })
const number = (description) => ({ type: 'number', description })
const boolean = (description) => ({ type: 'boolean', description })
const enums = (values, description, required = false) => ({ type: 'string', enum: values, description, ...(required ? { required: true } : {}) })
const objects = (properties, description) => ({ type: 'array', description, items: { type: 'object', properties, additionalProperties: false } })
const SHAPE_KINDS = ['rectangle', 'ellipse', 'diamond']
const ALIGN_MODES = ['left', 'right', 'top', 'center-x', 'center-y', 'distribute-x', 'distribute-y']
const jsonOutput = {
  schema: { type: 'json' },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
}

export const PAGE_TOOL_SPECS = [
  {
    name: 'map_list',
    description: 'List the design-map pages: one Excalidraw file per page under designmap/pages/, with node and edge counts and the last-modified time. Read-only.',
    parameters: {},
    call: ({ designmapDir }) => ({ ok: true, pages: listPages(designmapDir) }),
  },
  {
    name: 'map_read',
    description: 'Read one page before changing it. The default outline lists every node (`- [box] Checkout API  n1`), every edge (`- CLI -> API: asks  e1`), a compact geometry table (id x,y w x h), the page bounds and the readability verdict (`62/100 crowded`). `format:"json"` returns the exact scene. Read-only; never refuses a crowded page.',
    parameters: {
      page: string('Page name (the file name without .excalidraw).', true),
      format: enums(['outline', 'json'], 'outline (default) or json for exact positions.'),
    },
    call: ({ designmapDir }, args) => {
      const scene = readPage(designmapDir, args.page)
      const read = readOutline(scene, args.page)
      if (args.format === 'json') {
        return { ...read, format: 'json', elements: scene.elements, appState: scene.appState ?? {}, hints: hintsOf(scene) }
      }
      return read
    },
  },
  {
    name: 'map_lint',
    description: 'Check how readable one page is, before and after drawing it. Returns a score (100 clean; below 60 broken), a verdict, and every finding with the ids it measured, the measured value and a `repair` you can send to map_edit unchanged: node_overlap, label_overflow (the text does not fit the shape\'s inscribed area), edge_label_on_node, edge_crosses_node, edge_crossing, node_too_close, edge_unbound, edge_without_label, node_without_label, isolated_node, duplicate_label, page_too_tall, off_canvas. A low score is a report, never a refusal: a crowded page still opens and still saves.',
    parameters: {
      page: string('Page name to check.', true),
      severity: enums(['high', 'medium', 'low'], 'Only findings of this severity or worse.'),
    },
    call: ({ designmapDir }, args) => {
      const report = lintOutline(readPage(designmapDir, args.page), args.page)
      if (args.severity === undefined || args.severity === '') return report
      const rank = { high: 0, medium: 1, low: 2 }
      const limit = rank[args.severity] ?? 2
      return { ...report, findings: report.findings.filter((entry) => (rank[entry.severity] ?? 3) <= limit) }
    },
  },
  {
    name: 'map_edit',
    description: 'Draw or repair one page with ONE op. Draw a whole scheme with op "diagram" in one call: nodes [{id?, label, kind?, color?}] and edges [{from, to, label?, style?}] - "from"/"to" accept a node id or its label; then it lays the page out (direction "LR" default, "TB" for top-down) with the edge labels in the gaps. Example: {"op":"diagram","page":"system","nodes":[{"label":"CLI"},{"label":"Orchestrator"},{"label":"Taskboard"}],"edges":[{"from":"CLI","to":"Orchestrator","label":"asks"},{"from":"Orchestrator","to":"Taskboard","label":"writes"}]}. Repair with op "layout" (direction), "tidy" (left-to-right), "align" (mode), or single ops: node.add (label/kind/color; x/y omitted = a free spot in the flow; from = beside that node), node.move, node.resize, node.label, node.style, edge.add (from/to ids), edge.label, note.add (text), element.delete (id or ids), page.create, page.rename, page.delete. You pass labels and places, never seeds, versions or bindings. Only unknown_page, unknown_node and a bad diagram reference are refused.',
    parameters: {
      page: string('Page name; for page.create the page to create, for page.rename the current name.', true),
      op: { type: 'string', enum: [...OPS], required: true, description: 'The op to apply.' },
      id: string('Element id returned by map_read (node ops, edge.label, element.delete). Omitted on node.add/edge.add/note.add: a new id is returned.'),
      ids: { type: 'array', items: { type: 'string' }, description: 'Several element ids (element.delete) or the shapes to align (align).' },
      label: string('Node or edge label (node.add, node.label, edge.add, edge.label).'),
      text: string('Note text (note.add).'),
      x: number('Page x for node.add, node.move, note.add, layout/diagram origin.'),
      y: number('Page y for node.add, node.move, note.add, layout/diagram origin.'),
      width: number('Node width (node.resize).'),
      height: number('Node height (node.resize).'),
      from: string('Source node id (edge.add), or the node to place the new one beside (node.add). In diagram edges, a node id or label.'),
      to: string('Target node id (edge.add) or the new page name (page.rename). In diagram edges, a node id or label.'),
      kind: enums(SHAPE_KINDS, 'Shape of a new node (node.add, diagram nodes). Default rectangle.'),
      color: string('Fill colour: a name (blue, green, red, yellow, violet, grey, white, none) or #rrggbb (node.add, node.style, diagram nodes).'),
      fontSize: number('Note font size (note.add), default 16.'),
      style: enums(['solid', 'dashed'], 'Arrow line style (edge.add, diagram edges). Default solid.'),
      mode: enums(ALIGN_MODES, 'How to align the selected boxes (align).'),
      direction: enums(['LR', 'TB'], 'Layout direction for diagram/LR by default; TB stacks the layers top to bottom.'),
      nodeGap: number('Gap between boxes inside a layer (layout, diagram). Default 48.'),
      layerGap: number('Gap between layers (layout, diagram). Default 96, raised to fit the widest edge label.'),
      below: boolean('Place a new node UNDER the node named by from instead of to its right (node.add).'),
      replace: boolean('diagram only: clear the page before drawing the new scheme.'),
      nodes: objects({
        id: string('Optional node id.'),
        label: string('Node label.'),
        kind: enums(SHAPE_KINDS, 'Shape.'),
        color: string('Fill colour: a name (blue, green, red, yellow, violet, grey, white, none) or #rrggbb.'),
      }, 'diagram only: the nodes of the scheme, in reading order.'),
      edges: objects({
        id: string('Optional edge id.'),
        from: string('Source node id or label.'),
        to: string('Target node id or label.'),
        label: string('Edge label.'),
        style: enums(['solid', 'dashed'], 'Line style.'),
      }, 'diagram only: the arrows of the scheme.'),
    },
    call: ({ designmapDir }, args) => applyOp(designmapDir, { ...args, newPage: args.to_page ?? args.newPage }),
  },
  {
    name: 'map_render',
    description: 'Render one page to a picture with Excalidraw itself in a headless browser: designmap/out/<page>.png (read it with read_image) and designmap/out/<page>.svg (Excalidraw\'s own export), framed to the page bounds with the editor toolbar and menu hidden - the picture shows the drawing only. Use it after map_lint to see what the human will see. Refuses renderer_unavailable when no browser is present.',
    parameters: { page: string('Page name to render.', true) },
    call: ({ designmapDir }, args) => renderPage(designmapDir, args.page),
  },
]

/** Build the five ToolDefinitions from an injected defineTool and a dir resolver. */
export function createPageTools({ defineTool, pageHostFor }) {
  return PAGE_TOOL_SPECS.map((spec) => defineTool({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: jsonOutput,
    async execute(args, exec) {
      const host = pageHostFor(exec)
      try {
        return await spec.call(host, args ?? {})
      } catch (error) {
        if (error?.name === 'MapRefusal' || typeof error?.code === 'string') {
          return { ok: false, code: error.code ?? 'internal_error', message: String(error?.message ?? error) }
        }
        return { ok: false, code: 'internal_error', message: String(error?.message ?? error) }
      }
    },
  }))
}
