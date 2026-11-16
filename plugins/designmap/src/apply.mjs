/**
 * The semantic apply engine (FR-2, INV-ID, INV-NO-GEO).
 *
 * One rule decides every case: the WHOLE next document is validated first, then
 * written. An op batch that would introduce a dangling reference is refused as a
 * whole, so the files on disk stay byte-identical (NFR-2). Re-applying the same batch
 * is `applied: 0, skipped: N` and writes nothing (INV-IDEMPOTENT for apply).
 *
 * Ops carry semantics only: `x`/`y`/`fill` anywhere in a value is a schema refusal
 * with its exact path, produced by the strict zod schemas in schema.mjs.
 */
import { canonicalModel, canonicalViews, clone } from './canonical.mjs'
import { diffDocuments, diffSummary } from './diff.mjs'
import { DesignmapRefusal, REFUSALS, parseModel, parseOps, parseViews } from './schema.mjs'

const COLLECTIONS = Object.freeze({
  node: 'nodes',
  edge: 'edges',
  group: 'groups',
  view: 'views',
})

/** Throw when a reference in the document points at something that does not exist. */
export function assertReferences(model, views) {
  const nodeIds = new Set(model.nodes.map(node => node.id))
  const groupIds = new Set(model.groups.map(group => group.id))
  const broken = []
  for (const edge of model.edges) {
    if (!nodeIds.has(edge.from)) broken.push({ kind: 'edge', id: edge.id, field: 'from', missing: edge.from })
    if (!nodeIds.has(edge.to)) broken.push({ kind: 'edge', id: edge.id, field: 'to', missing: edge.to })
  }
  for (const node of model.nodes) {
    if (node.group !== null && node.group !== undefined && !groupIds.has(node.group)) {
      broken.push({ kind: 'node', id: node.id, field: 'group', missing: node.group })
    }
  }
  for (const view of views.views) {
    if (view.parent !== null && view.parent !== undefined && !groupIds.has(view.parent)) {
      broken.push({ kind: 'view', id: view.id, field: 'parent', missing: view.parent })
    }
  }
  if (broken.length > 0) {
    throw new DesignmapRefusal(REFUSALS.danglingReference, 'the result would contain dangling references', { references: broken })
  }
}

function upsertRow(rows, row) {
  const index = rows.findIndex(candidate => candidate.id === row.id)
  if (index >= 0) {
    if (JSON.stringify(rows[index]) === JSON.stringify(row)) return false
    rows[index] = row
    return true
  }
  rows.push(row)
  return true
}

function removeRow(rows, id) {
  const index = rows.findIndex(candidate => candidate.id === id)
  if (index < 0) return false
  rows.splice(index, 1)
  return true
}

/**
 * Apply a semantic op batch to an in-memory model/views pair.
 * @returns `{model, views, diff, applied, skipped, ops}` — never writes files.
 */
export function applyOps({ model, views, ops, logger }) {
  // The inputs are validated too: a caller that skipped the workspace reader must not be
  // able to launder an unknown key (x/y/fill) through canonicalisation.
  parseModel(model)
  parseViews(views)
  const parsedOps = parseOps({ ops })
  const nextModel = clone(canonicalModel(model))
  const nextViews = clone(canonicalViews(views))

  let applied = 0
  let skipped = 0
  for (const op of parsedOps) {
    const collection = COLLECTIONS[op.kind]
    const target = collection === 'views' ? nextViews.views : nextModel[collection]
    if (op.action === 'upsert') {
      if (upsertRow(target, op.value)) applied += 1
      else skipped += 1
    } else {
      if (removeRow(target, op.id)) applied += 1
      else skipped += 1
    }
  }

  // Whole-document validation before anything can be persisted. parseModel/parseViews
  // throw `invalid_model`/`invalid_views` with zod paths.
  const validatedModel = parseModel(nextModel)
  const validatedViews = parseViews(nextViews)
  assertReferences(validatedModel, validatedViews)

  const canonical = canonicalModel(validatedModel)
  const canonicalV = canonicalViews(validatedViews)
  const diff = diffDocuments(model, canonical, views, canonicalV)
  logger?.log('model.diff', diffSummary(diff))
  return { model: canonical, views: canonicalV, diff, applied, skipped, ops: parsedOps.length }
}

/**
 * Apply a batch to a workspace directory. The files are written only after the whole
 * next document validated, and only when its bytes actually change.
 */
export function applyToWorkspace(workspace, ops, { logger } = {}) {
  const beforeModel = workspace.readModel()
  const beforeViews = workspace.readViews()
  const before = {
    model: beforeModel.hash,
    views: beforeViews.hash,
  }
  const result = applyOps({ model: beforeModel.model, views: beforeViews.views, ops, logger })

  let modelHash = before.model
  let viewsHash = before.views
  if (JSON.stringify(result.model) !== JSON.stringify(canonicalModel(beforeModel.model))) {
    modelHash = workspace.writeModel(result.model).hash
  }
  if (JSON.stringify(result.views) !== JSON.stringify(canonicalViews(beforeViews.views))) {
    viewsHash = workspace.writeViews(result.views).hash
  }
  return {
    ...result,
    before,
    after: { model: modelHash, views: viewsHash },
    written: { model: modelHash !== before.model, views: viewsHash !== before.views },
  }
}
