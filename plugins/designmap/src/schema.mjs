/**
 * Zod schemas for the designmap semantic model, views document and agent ops.
 *
 * Every object that an agent or a human can write is a `z.strictObject`: an op that
 * carries `x`/`y`/`fill` must be REFUSED with the offending path, not silently
 * stripped (INV-NO-GEO / FR-2). Verified API fact: plain `z.object` strips unknown
 * keys and would let coordinates through — see docs/designmap/API-TESTS-CORE.md §2.
 *
 * The model/views document shape follows docs/designmap/SCENE-CONTRACT.md and
 * docs/analysis/designmap-redesign.json (FR-1, D-MODEL).
 */
import * as z from 'zod'

/** Semantic ids are immutable, dotted, human-readable and never start with `$`. */
export const ID = z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/, 'semantic id')

export const NODE_TYPES = ['frontend', 'service', 'worker', 'datastore', 'queue', 'external']
export const EDGE_KINDS = ['sync', 'async', 'data']
export const VIEW_LEVELS = ['context', 'container', 'component', 'flow']
export const DIRECTIONS = ['LR', 'TB']

export const nodeSchema = z.strictObject({
  id: ID,
  type: z.enum(NODE_TYPES),
  label: z.string().min(1),
  group: ID.nullable().default(null),
  source: z.string().min(1).nullable().default(null),
})

export const groupSchema = z.strictObject({
  id: ID,
  label: z.string().default(''),
})

export const edgeSchema = z.strictObject({
  id: ID,
  from: ID,
  to: ID,
  kind: z.enum(EDGE_KINDS),
  label: z.string().default(''),
})

export const modelSchema = z.strictObject({
  schemaVersion: z.literal(1),
  groups: z.array(groupSchema).default([]),
  nodes: z.array(nodeSchema).default([]),
  edges: z.array(edgeSchema).default([]),
})

export const viewSchema = z.strictObject({
  id: ID,
  title: z.string().default(''),
  level: z.enum(VIEW_LEVELS),
  direction: z.enum(DIRECTIONS).default('LR'),
  include: z.array(z.string()).default([]),
  parent: ID.nullable().default(null),
})

export const viewsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  views: z.array(viewSchema).default([]),
})

/** One overlay row; unknown keys are reported by the merger, never applied. */
export const overlayRowSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  fill: z.string().optional(),
  stroke: z.string().optional(),
})

/* ------------------------------------------------------------------ */
/* Agent ops (FR-2): semantic only, no geometry, no colour.            */
/* ------------------------------------------------------------------ */

const VALUE_SCHEMAS = Object.freeze({
  node: nodeSchema,
  edge: edgeSchema,
  group: groupSchema,
  view: viewSchema,
})

/**
 * One semantic op. `kind`/`action` name the collection and the verb; `value` is the
 * row for an upsert and `id` the key for a remove. `value` is declared `unknown` so the
 * per-kind strict schema can be applied in `superRefine`, which keeps the refusal path
 * exact (`["value","x"]`) instead of collapsing into a union error.
 */
export const opSchema = z.strictObject({
  kind: z.enum(['node', 'edge', 'group', 'view']),
  action: z.enum(['upsert', 'remove']),
  id: ID.optional(),
  value: z.unknown().optional(),
}).superRefine((op, ctx) => {
  if (op.action === 'upsert') {
    if (op.value === undefined) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'upsert requires a value' })
      return
    }
    if (op.id !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['id'], message: 'upsert takes value, not id' })
      return
    }
    const parsed = VALUE_SCHEMAS[op.kind].safeParse(op.value)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: ['value', ...issue.path] })
    }
    return
  }
  if (op.id === undefined) ctx.addIssue({ code: 'custom', path: ['id'], message: 'remove requires an id' })
  if (op.value !== undefined) ctx.addIssue({ code: 'custom', path: ['value'], message: 'remove takes id, not value' })
})

export const opBatchSchema = z.strictObject({
  ops: z.array(opSchema),
})

/* ------------------------------------------------------------------ */
/* Scene (the output contract; core asserts what it emits).            */
/* ------------------------------------------------------------------ */

const pointSchema = z.strictObject({ x: z.number(), y: z.number() })

export const sceneSchema = z.strictObject({
  schemaVersion: z.literal(1),
  viewId: ID,
  title: z.string(),
  level: z.enum(VIEW_LEVELS),
  direction: z.enum(DIRECTIONS),
  canvas: z.strictObject({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  nodes: z.array(z.strictObject({
    id: ID,
    type: z.enum(NODE_TYPES),
    label: z.string(),
    group: ID.nullable(),
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
    stale: z.boolean(),
    source: z.string().nullable(),
  })),
  groups: z.array(z.strictObject({
    id: ID,
    label: z.string(),
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
  })),
  edges: z.array(z.strictObject({
    id: ID,
    from: ID,
    to: ID,
    kind: z.enum(EDGE_KINDS),
    label: z.string(),
    points: z.array(pointSchema),
    labelAt: pointSchema,
  })),
})

/** Structured refusal codes shared by render and apply. */
export const REFUSALS = Object.freeze({
  invalidModel: 'invalid_model',
  invalidViews: 'invalid_views',
  invalidOps: 'invalid_ops',
  unknownView: 'unknown_view',
  danglingReference: 'dangling_reference',
  danglingEdge: 'dangling_edge',
  nonFiniteGeometry: 'non_finite_geometry',
  duplicateId: 'duplicate_id',
  missingEdgeLabel: 'missing_edge_label',
  orphanNode: 'orphan_node',
  viewTooLarge: 'view_too_large',
})

/** An Error carrying a stable code and the zod issues that caused it. */
export class DesignmapRefusal extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'DesignmapRefusal'
    this.code = code
    this.details = details
  }
}

/**
 * Expand one `unrecognized_keys` issue into one issue per key, so a refusal names the
 * key in its path (`["nodes",1,"x"]`) instead of only in `keys`. The path is what an
 * agent can act on; the keys array stays for tooling that expects zod's own shape.
 */
function expandUnrecognizedIssues(issues) {
  return issues.flatMap(issue => (issue.code === 'unrecognized_keys' && Array.isArray(issue.keys)
    ? issue.keys.map(key => ({
      ...issue,
      key,
      keys: [key],
      path: [...issue.path, key],
      message: `Unrecognized key: "${key}"`,
    }))
    : [issue]))
}

/** Validate a model and throw a path-qualified refusal when it is not valid. */
export function parseModel(value) {
  const parsed = modelSchema.safeParse(value)
  if (!parsed.success) {
    throw new DesignmapRefusal(REFUSALS.invalidModel, 'model does not match the designmap schema', {
      issues: expandUnrecognizedIssues(parsed.error.issues),
    })
  }
  return parsed.data
}

/** Validate a views document and throw a path-qualified refusal when it is not valid. */
export function parseViews(value) {
  const parsed = viewsSchema.safeParse(value)
  if (!parsed.success) {
    throw new DesignmapRefusal(REFUSALS.invalidViews, 'views do not match the designmap schema', {
      issues: expandUnrecognizedIssues(parsed.error.issues),
    })
  }
  return parsed.data
}

/** Validate an op batch (the agent-facing entry point). */
export function parseOps(value) {
  const parsed = opBatchSchema.safeParse(value)
  if (!parsed.success) {
    throw new DesignmapRefusal(REFUSALS.invalidOps, 'ops do not match the designmap semantic schema', {
      issues: expandUnrecognizedIssues(parsed.error.issues),
    })
  }
  // The refinement proved each value against its per-kind schema; materialise the
  // defaults (group: null, source: null, label: '') so apply compares canonical rows.
  return parsed.data.ops.map(op => (op.action === 'upsert'
    ? { kind: op.kind, action: op.action, value: VALUE_SCHEMAS[op.kind].parse(op.value) }
    : { kind: op.kind, action: op.action, id: op.id }))
}
