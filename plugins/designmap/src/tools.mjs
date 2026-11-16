/**
 * The seven agent-facing designmap tools (M3, owner spec §5).
 *
 * Built as plain definitions with an injected `defineTool`, so the same module is used
 * by the Cordis plugin (`index.js`, real `@deepseek-ai/dsh-tools`) and by plugin-local
 * tests (a stub `defineTool`, plus the installed dsh-tools validator when available).
 *
 * Every tool's parameter schema is closed (`additionalProperties: false`, and a strict
 * `oneOf` for ops), so a coordinate or colour field is refused by the tool schema
 * itself with a named INVALID_ARGS error — the prompt is not the enforcement.
 * `designmap_apply` is the only writer; `scan`, `lint`, `status` and `open` are
 * read-only; `render` writes scenes + `out/index.json`; `export` writes an SVG.
 */
import { NODE_TYPES, EDGE_KINDS, VIEW_LEVELS, DIRECTIONS } from './schema.mjs'
import { DesignmapRefusal } from './schema.mjs'

const string = description => ({ type: 'string', description })
const nullableString = description => ({ oneOf: [{ type: 'string' }, { type: 'null' }], description })

// One closed value object for every op kind. The union of semantic fields is
// deliberate: `additionalProperties: false` on ONE object gives a named refusal per
// field ("ops[0].value.x is not a declared property"), while a oneOf would collapse the
// same failure into "must match exactly one branch" and lose the field name. The
// per-kind shape (node vs edge vs view, required fields) is enforced by the core zod
// schemas in execute, which return the same named paths.
const VALUE_PROPERTIES = {
  id: { type: 'string', description: 'Immutable semantic id.' },
  type: { type: 'string', enum: NODE_TYPES, description: 'Node type (node ops).' },
  label: { type: 'string', description: 'Node label or edge label.' },
  group: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Node group id or null (node ops).' },
  source: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Repo-relative source path or null (node ops).' },
  from: { type: 'string', description: 'Edge source node id (edge ops).' },
  to: { type: 'string', description: 'Edge target node id (edge ops).' },
  kind: { type: 'string', enum: EDGE_KINDS, description: 'Edge kind (edge ops).' },
  title: { type: 'string', description: 'View title (view ops).' },
  level: { type: 'string', enum: VIEW_LEVELS, description: 'View level (view ops).' },
  direction: { type: 'string', enum: DIRECTIONS, description: 'View direction (view ops).' },
  include: { type: 'array', items: { type: 'string' }, description: 'View include globs (view ops).' },
  parent: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'View parent group id or null (view ops).' },
}

const OPS_PARAM = {
  type: 'array',
  required: true,
  description: 'Semantic ops; applied atomically and idempotently. Coordinates and colours are refused by this schema (no x/y/fill property).',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: ['node', 'edge', 'group', 'view'], required: true, description: 'Which collection the op addresses.' },
      action: { type: 'string', enum: ['upsert', 'remove'], required: true, description: 'Upsert a value, or remove by id.' },
      id: { type: 'string', description: 'Id for a remove op.' },
      value: { type: 'object', additionalProperties: false, properties: VALUE_PROPERTIES, description: 'Semantic row for an upsert op.' },
    },
  },
}

const jsonOutput = {
  schema: { type: 'json' },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
}

/** Tool descriptors: schema plus the host-service method each one calls. */
export const TOOL_SPECS = [
  {
    name: 'designmap_apply',
    method: 'apply',
    description: 'Apply semantic designmap ops (upsert/remove node, edge, group, view) and update the manifest. Fields are semantic only: id/type/label/group/source and edge from/to/kind/label. Coordinates and colours are refused by the schema. The whole batch is validated before writing; a dangling reference refuses the batch and leaves the files unchanged. Re-applying the same batch returns applied=0/skipped=N and writes nothing.',
    parameters: { ops: OPS_PARAM },
    call: (service, args) => service.apply(args.ops),
  },
  {
    name: 'designmap_render',
    method: 'render',
    description: 'Render views to designmap/out/<viewId>.scene.json and designmap/out/index.json. Every scene carries the stale flags from the manifest vs HEAD check, the lint report and the scene hash. Omit viewId to render all views (the result then carries the index and one envelope per view).',
    parameters: { viewId: string('Render only this view id; omit to render every view.') },
    call: (service, args) => service.render({ viewId: args.viewId }),
  },
  {
    name: 'designmap_lint',
    method: 'lint',
    description: 'Lint one view or all views without writing anything: view size, missing edge labels, orphan nodes, dangling references, duplicate ids, long labels, overlaps after the overlay merge, stale nodes, colours outside the palette. Error findings mean render would refuse.',
    parameters: { viewId: string('Lint only this view id; omit to lint every view.') },
    call: (service, args) => service.lint({ viewId: args.viewId }),
  },
  {
    name: 'designmap_status',
    method: 'status',
    description: 'Compare designmap/manifest.json with HEAD and the files on disk. Returns stale, commit, head, commitBehind, staleNodes (with the reason per node) and warnings. A missing manifest is stale=true with a warning; it is not an error.',
    parameters: {},
    call: service => service.status(),
  },
  {
    name: 'designmap_scan',
    method: 'scan',
    description: 'Read git changes since the manifest commit and propose semantic ops for the model: new watched source files become upsert-node proposals, deleted files with an edge-free node become remove-node proposals, modified files are listed as affected nodes (their meaning is a human/agent decision). Never writes the model.',
    parameters: {
      roots: { type: 'array', items: { type: 'string' }, description: 'Source roots to watch for new files. Default ["src"].' },
      extensions: { type: 'array', items: { type: 'string' }, description: 'File extensions to propose nodes for. Default [".ts",".tsx",".js",".mjs",".py",".go",".sql"].' },
    },
    call: (service, args) => service.scan({ roots: args.roots, extensions: args.extensions }),
  },
  {
    name: 'designmap_open',
    method: 'open',
    description: 'Resolve the source file of one semantic node (repo-relative and absolute) so the caller can open it. A node without source or a missing file is a structured refusal value, not a crash.',
    parameters: { nodeId: { type: 'string', required: true, description: 'Semantic node id to open.' } },
    call: (service, args) => service.open({ nodeId: args.nodeId }),
  },
  {
    name: 'designmap_export',
    method: 'export',
    description: 'Export the current state of a view, including the overlay positions and colours already merged into the scene. format "svg" (default) writes designmap/out/<viewId>.svg; format "png" writes the same scene as PNG when rsvg-convert, ImageMagick convert or magick is available, and refuses with png_converter_missing otherwise (no rasteriser dependency is shipped). Returns the path(s), hash, size, labels and which nodes carry overlay colours.',
    parameters: {
      viewId: string('View to export; omit for the first view.'),
      format: { type: 'string', enum: ['svg', 'png'], description: 'Export format. Default svg; png is optional and needs an external converter.' },
    },
    call: (service, args) => service.exportView({ viewId: args.viewId, format: args.format ?? 'svg' }),
  },
]

/**
 * Build ToolDefinitions.
 * @param root0.defineTool - real `defineTool` from @deepseek-ai/dsh-tools, or a stub.
 * @param root0.hostFor - `(exec) => {service, logger, logPath}` resolving the caller's cwd.
 */
export function createHostTools({ defineTool, hostFor }) {
  return TOOL_SPECS.map(spec => defineTool({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: jsonOutput,
    async execute(args, exec) {
      const { service, logger } = hostFor(exec)
      logger?.log('tool.enter', { tool: spec.name, arguments: args })
      const started = performance.now()
      try {
        const value = await spec.call(service, args ?? {})
        logger?.log('tool.exit', {
          tool: spec.name,
          ok: value?.ok !== false,
          code: value?.ok === false ? value.code ?? null : null,
          ms: Math.round((performance.now() - started) * 100) / 100,
        })
        return value
      } catch (error) {
        const payload = error instanceof DesignmapRefusal
          ? { ok: false, code: error.code, message: error.message, details: error.details }
          : { ok: false, code: error?.code ?? 'internal_error', message: String(error?.message ?? error) }
        logger?.log('tool.exit', {
          tool: spec.name,
          ok: false,
          code: payload.code,
          ms: Math.round((performance.now() - started) * 100) / 100,
        })
        return payload
      }
    },
  }))
}

/** Resolve the session workspace an agent call runs against. */
export function agentCwd(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd()
}
