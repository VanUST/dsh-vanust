/**
 * Semantic diff between two model/views documents.
 *
 * Rows are compared by their canonical JSON, not by object identity, so the diff does
 * not report a change when only key order moved. `apply` uses the same comparison for
 * its idempotency rule: an upsert that changes nothing is `skipped`, not `applied`.
 */
import { canonicalModel, canonicalViews, sortById } from './canonical.mjs'

function rowsFromModel(model) {
  return {
    groups: sortById(model.groups ?? []),
    nodes: sortById(model.nodes ?? []),
    edges: sortById(model.edges ?? []),
  }
}

function compareRows(before, after) {
  const previous = new Map(before.map(row => [row.id, JSON.stringify(row)]))
  const next = new Map(after.map(row => [row.id, JSON.stringify(row)]))
  const added = []
  const removed = []
  const changed = []
  for (const id of [...next.keys()].sort()) {
    if (!previous.has(id)) added.push(id)
    else if (previous.get(id) !== next.get(id)) {
      changed.push({ id, before: JSON.parse(previous.get(id)), after: JSON.parse(next.get(id)) })
    }
  }
  for (const id of [...previous.keys()].sort()) if (!next.has(id)) removed.push(id)
  return { added, removed, changed }
}

/** Diff two canonical models and views documents. */
export function diffDocuments(beforeModel, afterModel, beforeViews = { views: [] }, afterViews = { views: [] }) {
  const left = rowsFromModel(canonicalModel(beforeModel))
  const right = rowsFromModel(canonicalModel(afterModel))
  const views = compareRows(
    canonicalViews(beforeViews).views,
    canonicalViews(afterViews).views,
  )
  const model = {
    groups: compareRows(left.groups, right.groups),
    nodes: compareRows(left.nodes, right.nodes),
    edges: compareRows(left.edges, right.edges),
  }
  const counts = { added: 0, removed: 0, changed: 0 }
  for (const part of [model.groups, model.nodes, model.edges, views]) {
    counts.added += part.added.length
    counts.removed += part.removed.length
    counts.changed += part.changed.length
  }
  return { model, views, counts }
}

/** A one-line log payload: ids only, bounded (FR-9 aggregation). */
export function diffSummary(diff) {
  const ids = part => ({
    added: part.added.slice(0, 20),
    removed: part.removed.slice(0, 20),
    changed: part.changed.map(row => row.id).slice(0, 20),
  })
  return {
    counts: diff.counts,
    nodes: ids(diff.model.nodes),
    edges: ids(diff.model.edges),
    groups: ids(diff.model.groups),
    views: ids(diff.views),
  }
}
