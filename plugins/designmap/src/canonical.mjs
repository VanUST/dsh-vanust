/**
 * Canonical ordering, rounding and hashing for designmap.
 *
 * INV-IDEMPOTENT depends on two rules that are easy to break and hard to see:
 * every collection is sorted by semantic id before it reaches the scene, and every
 * number is rounded to 2 decimals before serialization (SCENE-CONTRACT "Coordinate
 * system"). Both live here so a new serializer cannot forget them.
 */
import { createHash } from 'node:crypto'

/** Round a coordinate/measure to the precision the scene contract allows. */
export function round2(value) {
  if (!Number.isFinite(value)) return value
  return Math.round(value * 100) / 100
}

/** Sort a copy of an array of `{id}` rows by id, using code-point order. */
export function sortById(rows) {
  return [...rows].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
}

/** Deep-clone JSON-safe data (model/views/overlays are JSON by construction). */
export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

/**
 * Stable JSON: keys in insertion order of the object as constructed, two-space
 * indentation, one trailing newline. Callers build objects in the documented order;
 * this function never reorders object keys, so the contract's field order is the
 * writer's responsibility and is asserted by the scene schema tests.
 */
export function toJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** SHA-256 of a UTF-8 string, as `sha256:<hex>`; the scene/envelope hash form. */
export function sha256(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`
}

/** Canonical model/views document: sorted collections in the documented key order. */
export function canonicalModel(model) {
  return {
    schemaVersion: 1,
    groups: sortById(model.groups ?? []).map(group => ({ id: group.id, label: group.label ?? '' })),
    nodes: sortById(model.nodes ?? []).map(node => ({
      id: node.id,
      type: node.type,
      label: node.label,
      group: node.group ?? null,
      source: node.source ?? null,
    })),
    edges: sortById(model.edges ?? []).map(edge => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      label: edge.label ?? '',
    })),
  }
}

export function canonicalViews(views) {
  return {
    schemaVersion: 1,
    views: sortById(views.views ?? []).map(view => ({
      id: view.id,
      title: view.title ?? '',
      level: view.level,
      direction: view.direction ?? 'LR',
      include: [...(view.include ?? [])],
      parent: view.parent ?? null,
    })),
  }
}
