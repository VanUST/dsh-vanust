/**
 * The four map tools of the page document (design-map v2, P1): map_list, map_read, map_edit,
 * map_render.
 *
 * They are the whole agent surface of the plugin. Each one is a thin wrapper over
 * src/pages.mjs, src/outline.mjs and src/ops.mjs so a plugin-local test can call the same
 * code without a harness, and the schema is deliberately loose: an op is a name plus a few
 * fields, and an unknown field is ignored rather than refused.
 */
import { listPages } from './pages.mjs'
import { readOutline } from './outline.mjs'
import { applyOp, renderPage, OPS } from './ops.mjs'
import { hintsOf } from './outline.mjs'
import { readPage } from './pages.mjs'

const string = (description, required = false) => ({ type: 'string', description, ...(required ? { required: true } : {}) })
const number = (description) => ({ type: 'number', description })
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
    description: 'Read one page. Default format is a compact outline ("- [box] Checkout API", "- Checkout API -> Orders DB: reads"); pass format "json" for the exact scene. Always returns hints (node_overlap, off_canvas, edge_without_label) and never refuses a crowded page.',
    parameters: {
      page: string('Page name (the file name without .excalidraw).', true),
      format: { type: 'string', enum: ['outline', 'json'], description: 'outline (default) or json for exact positions.' },
    },
    call: ({ designmapDir }, args) => {
      const read = readOutline(readPage(designmapDir, args.page), args.page)
      if (args.format === 'json') {
        const scene = readPage(designmapDir, args.page)
        return { ...read, format: 'json', elements: scene.elements, appState: scene.appState ?? {}, hints: hintsOf(scene) }
      }
      return read
    },
  },
  {
    name: 'map_edit',
    description: 'Change one page with a single op: node.add, node.move, node.resize, node.label, edge.add, edge.label, element.delete, page.create, page.rename, page.delete, tidy. You pass a label and a place, never a seed, a version, a binding or a point: the tool builds a shape with its bound text and an arrow with real bindings. An unknown page or node is refused by name; a crowded page is not.',
    parameters: {
      page: string('Page name; for page.create the page to create, for page.rename the current name.', true),
      op: { type: 'string', enum: [...OPS], required: true, description: 'The op to apply.' },
      id: string('Element id returned by map_read (node ops, edge.label, element.delete). Omitted on node.add/edge.add: a new id is returned.'),
      label: string('Node or edge label.'),
      x: number('Node x in page coordinates (node.add, node.move).'),
      y: number('Node y in page coordinates (node.add, node.move).'),
      width: number('Node width (node.resize).'),
      height: number('Node height (node.resize).'),
      from: string('Source node id (edge.add).'),
      to: string('Target node id (edge.add), or the new page name (page.rename).'),
      kind: { type: 'string', enum: ['rectangle', 'ellipse', 'diamond'], description: 'Shape of a new node (node.add). Default rectangle.' },
    },
    call: ({ designmapDir }, args) => applyOp(designmapDir, { ...args, newPage: args.to_page ?? args.newPage }),
  },
  {
    name: 'map_render',
    description: 'Render one page with Excalidraw itself in a headless browser: designmap/out/<page>.png (readable with read_image) and designmap/out/<page>.svg (Excalidraw\'s own export), for a deck, a document or the state panel. Returns both paths, their byte sizes and the element count; refuses renderer_unavailable when no browser is present.',
    parameters: { page: string('Page name to render.', true) },
    call: ({ designmapDir }, args) => renderPage(designmapDir, args.page),
  },
]

/** Build the four ToolDefinitions from an injected defineTool and a dir resolver. */
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
