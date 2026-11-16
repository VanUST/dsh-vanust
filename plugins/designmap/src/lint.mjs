/**
 * Lint: the rule table, one finding per rule, with fixed severities.
 *
 * Rule names come from FR-6 (docs/analysis/designmap-redesign.json); severities are
 * the owner spec §8 table (authoritative):
 *
 *   nodes per view > 15 / > 25    warning / error
 *   edge without label            error
 *   orphan node                   error
 *   dangling from/to              error
 *   duplicate id                  error
 *   label > 40 characters         warning
 *   node overlap after merge      warning
 *   stale against manifest        warning
 *   colour outside type palette   info
 *
 * The scene contract adds non-finite geometry as an error (render refuses NaN).
 * Mapping to rule ids: `view_large` (>15) and `view_too_large` (>25), `orphan_node`,
 * `edge_label_missing`, `dangling_edge`, `dangling_group`, `duplicate_id`,
 * `label_too_long`, `node_overlap`, `stale_node`, `colour_out_of_palette`,
 * `non_finite_geometry`. `error` makes `render` refuse and report the findings;
 * `warning`/`info` render and are reported.
 */
import { labelLength } from './text.mjs'
import { pointInBox, pointOnBoxBoundary } from './layout.mjs'

export const LINT_RULES = Object.freeze({
  duplicate_id: { severity: 'error', message: 'the same semantic id is declared twice' },
  dangling_edge: { severity: 'error', message: 'an edge endpoint is not a node of the model' },
  dangling_group: { severity: 'error', message: 'a node or view references a group that does not exist' },
  non_finite_geometry: { severity: 'error', message: 'geometry contains NaN or Infinity' },
  edge_label_missing: { severity: 'error', message: 'an edge has no label' },
  label_too_long: { severity: 'warning', message: `a label is longer than ${40} characters` },
  orphan_node: { severity: 'error', message: 'a node has no edge on this view' },
  node_overlap: { severity: 'warning', message: 'two node boxes overlap after the overlay merge' },
  stale_node: { severity: 'warning', message: 'a node source changed since the last recorded manifest' },
  colour_out_of_palette: { severity: 'info', message: 'an overlay colour is outside the palette' },
  view_too_large: { severity: 'error', message: 'the view has more than 25 nodes' },
  view_large: { severity: 'warning', message: 'the view has more than 15 nodes' },
  // Defensive rule added with the F1 geometry fix: an anchor inside a node box means
  // label placement was impossible (overlapping boxes) and the regression must be visible.
  label_over_node: { severity: 'warning', message: 'an edge label anchor falls inside a node box' },
})

function finding(rule, fields = {}) {
  const definition = LINT_RULES[rule]
  return { rule, severity: definition.severity, message: definition.message, ...fields }
}

function sortFindings(findings) {
  return findings.sort((left, right) => {
    if (left.rule !== right.rule) return left.rule < right.rule ? -1 : 1
    const leftId = left.id ?? left.ids?.join(',') ?? ''
    const rightId = right.id ?? right.ids?.join(',') ?? ''
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
  })
}

/** Model-level rules: duplicates and references, before any layout work. */
export function lintModel(model, views = { views: [] }) {
  const findings = []
  const seen = new Map()
  const declare = (kind, id) => {
    const key = `${kind}:${id}`
    if (seen.has(key)) findings.push(finding('duplicate_id', { id, kind, message: `duplicate ${kind} id "${id}"` }))
    else seen.set(key, kind)
  }
  for (const node of model.nodes ?? []) declare('node', node.id)
  for (const edge of model.edges ?? []) declare('edge', edge.id)
  for (const group of model.groups ?? []) declare('group', group.id)
  for (const view of views.views ?? []) declare('view', view.id)

  const nodeIds = new Set((model.nodes ?? []).map(node => node.id))
  const groupIds = new Set((model.groups ?? []).map(group => group.id))
  for (const edge of model.edges ?? []) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      findings.push(finding('dangling_edge', {
        id: edge.id,
        from: edge.from,
        to: edge.to,
        missing: [!nodeIds.has(edge.from) ? edge.from : null, !nodeIds.has(edge.to) ? edge.to : null].filter(Boolean),
      }))
    }
  }
  for (const node of model.nodes ?? []) {
    if (node.group !== null && node.group !== undefined && !groupIds.has(node.group)) {
      findings.push(finding('dangling_group', { id: node.id, group: node.group, message: `node "${node.id}" references unknown group "${node.group}"` }))
    }
  }
  for (const view of views.views ?? []) {
    if (view.parent !== null && view.parent !== undefined && !groupIds.has(view.parent)) {
      findings.push(finding('dangling_group', { id: view.id, group: view.parent, message: `view "${view.id}" references unknown parent group "${view.parent}"` }))
    }
  }
  return sortFindings(findings)
}

function boxesOverlap(left, right) {
  return left.x < right.x + right.w
    && right.x < left.x + left.w
    && left.y < right.y + right.h
    && right.y < left.y + left.h
}

/** Scene-level rules: what the renderer would actually draw. */
export function lintScene(scene, { merge = { gc: [] }, staleNodeIds = [] } = {}) {
  const findings = []
  const stale = new Set(staleNodeIds)
  for (const node of scene.nodes) {
    if (labelLength(node.label) > 40) {
      findings.push(finding('label_too_long', { id: node.id, length: labelLength(node.label) }))
    }
    if (stale.has(node.id) || node.stale === true) {
      findings.push(finding('stale_node', { id: node.id }))
    }
    const touched = scene.edges.some(edge => edge.from === node.id || edge.to === node.id)
    if (!touched && scene.nodes.length > 1) findings.push(finding('orphan_node', { id: node.id }))
  }
  for (const edge of scene.edges) {
    if (edge.label === '') findings.push(finding('edge_label_missing', { id: edge.id }))
    // The anchor must be clearly outside: touching a side counts as covered, because the
    // fallback emits the polyline midpoint there when no free span exists.
    const covered = scene.nodes.filter(node => pointInBox(edge.labelAt, node) || pointOnBoxBoundary(edge.labelAt, node))
    if (covered.length > 0) {
      findings.push(finding('label_over_node', { id: edge.id, nodes: covered.map(node => node.id), nodeId: covered[0].id }))
    }
  }
  const nodes = [...scene.nodes].sort((left, right) => (left.id < right.id ? -1 : 1))
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      if (boxesOverlap(nodes[left], nodes[right])) {
        findings.push(finding('node_overlap', { ids: [nodes[left].id, nodes[right].id] }))
      }
    }
  }
  if (scene.nodes.length > 25) findings.push(finding('view_too_large', { count: scene.nodes.length }))
  else if (scene.nodes.length > 15) findings.push(finding('view_large', { count: scene.nodes.length }))
  for (const warning of merge.gc ?? []) {
    if (warning.code === 'colour_out_of_palette') {
      findings.push(finding('colour_out_of_palette', { id: warning.nodeId, colour: warning.colour, value: warning.message }))
    }
  }
  // Defensive: layout refuses non-finite geometry first, but a merge or a future
  // producer must not be able to slip NaN into the scene silently.
  for (const node of scene.nodes) {
    if (![node.x, node.y, node.w, node.h].every(Number.isFinite)) {
      findings.push(finding('non_finite_geometry', { id: node.id }))
    }
  }
  for (const edge of scene.edges) {
    if (!edge.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) {
      findings.push(finding('non_finite_geometry', { id: edge.id }))
    }
  }
  return sortFindings(findings)
}

/** Combine, count and decide whether the scene may be emitted. */
export function summariseLint(findings) {
  const counts = { error: 0, warning: 0, info: 0 }
  for (const entry of findings) counts[entry.severity] += 1
  return {
    ok: counts.error === 0,
    counts,
    findings: sortFindings([...findings]),
    rules: [...new Set(findings.map(entry => entry.rule))].sort(),
  }
}

export function findByRule(findings, rule) {
  return findings.filter(entry => entry.rule === rule)
}

export function severityOf(rule) {
  return LINT_RULES[rule]?.severity ?? null
}
