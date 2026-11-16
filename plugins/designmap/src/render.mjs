/**
 * The render pipeline: validate -> select view -> layout -> merge overlays -> lint ->
 * scene JSON. This is the only place a scene is produced.
 *
 * Refusal policy (SCENE-CONTRACT): a dangling edge or a non-finite coordinate makes
 * render REFUSE with the lint findings attached; a warning (empty edge label, long
 * label, overlap, stale, palette) renders and is reported. An unknown view id is a
 * structured refusal, never an empty scene.
 */
import { DesignmapRefusal, REFUSALS, sceneSchema } from './schema.mjs'
import { round2, sha256, sortById, toJson } from './canonical.mjs'
import { layoutView, placeEdgeLabel, SPACING_SCALES } from './layout.mjs'
import { lintModel, lintScene, summariseLint } from './lint.mjs'
import { mergeOverlays, recomputeCanvas, reattachEdges } from './overlays.mjs'
import { edgeLabelSize, nodeSize, sceneLabel } from './text.mjs'

const REFUSAL_BY_RULE = Object.freeze({
  duplicate_id: REFUSALS.duplicateId,
  dangling_edge: REFUSALS.danglingEdge,
  dangling_group: REFUSALS.danglingReference,
  non_finite_geometry: REFUSALS.nonFiniteGeometry,
  edge_label_missing: REFUSALS.missingEdgeLabel,
  orphan_node: REFUSALS.orphanNode,
  view_too_large: REFUSALS.viewTooLarge,
  label_collision: REFUSALS.labelCollision,
  edge_through_node: REFUSALS.edgeThroughNode,
})

/** Match one view `include` pattern: `*` is the only wildcard. */
export function matchesPattern(pattern, id) {
  if (pattern === '*') return true
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replaceAll('*', '.*')
  return new RegExp(`^${escaped}$`, 'u').test(id)
}

/**
 * Select the model subset one view draws.
 * `include` globs filter node ids; `parent` scopes the view to one group (drill-down).
 * Edges survive only when both endpoints are on the view — an edge that leaves the
 * view is not a dangling edge, it is simply not drawn here.
 */
export function selectView(model, view) {
  let nodes = model.nodes
  if (view.parent !== null && view.parent !== undefined) {
    nodes = nodes.filter(node => node.group === view.parent)
  }
  if (view.include.length > 0) {
    nodes = nodes.filter(node => view.include.some(pattern => matchesPattern(pattern, node.id)))
  }
  const nodeIds = new Set(nodes.map(node => node.id))
  const edges = model.edges.filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to))
  const groupIds = new Set(nodes.map(node => node.group).filter(group => group !== null && group !== undefined))
  const groups = model.groups.filter(group => groupIds.has(group.id))
  return { nodes: sortById(nodes), edges: sortById(edges), groups: sortById(groups) }
}

/**
 * Render one view.
 * @param root0.model - validated model (see schema.parseModel).
 * @param root0.views - validated views document.
 * @param root0.overlays - parsed overlays.json value (tolerated, GC'd).
 * @param root0.viewId - view to render.
 * @param root0.staleNodeIds - ids M3's manifest reported stale; M0 defaults to none.
 * @param root0.logger - optional createLogger() instance.
 * @returns `{scene, sceneJson, sceneHash, lint, merge, layout, viewId, bytes}`
 */
export async function renderView({ model, views, overlays = {}, viewId, staleNodeIds = [], logger }) {
  const started = performance.now()
  const view = views.views.find(candidate => candidate.id === viewId)
  if (view === undefined) {
    throw new DesignmapRefusal(REFUSALS.unknownView, `unknown view "${viewId}"`, {
      viewId,
      available: views.views.map(candidate => candidate.id),
    })
  }

  const modelFindings = lintModel(model, views)
  const blocking = modelFindings.find(entry => entry.severity === 'error')
  if (blocking !== undefined) {
    logger?.log('lint.result', { ok: false, phase: 'model', counts: countBySeverity(modelFindings), rules: [...new Set(modelFindings.map(entry => entry.rule))].sort() })
    throw new DesignmapRefusal(REFUSAL_BY_RULE[blocking.rule] ?? REFUSALS.invalidModel, `model lint failed: ${blocking.message}`, {
      findings: modelFindings,
      viewId,
    })
  }

  const selected = selectView(model, view)
  // One size per edge, computed once from the text metric: the layout, the validator and
  // the renderer all use this number, so a plate can never be drawn bigger than reserved.
  const labelSizes = new Map(selected.edges.map(edge => [edge.id, edgeLabelSize(edge.label)]))
  let layout = null
  for (const spacingScale of SPACING_SCALES) {
    layout = await layoutView({
      nodes: selected.nodes.map(node => ({ id: node.id, label: node.label, group: node.group ?? null, type: node.type })),
      groups: selected.groups.map(group => ({ id: group.id, label: group.label })),
      edges: selected.edges.map(edge => ({ id: edge.id, from: edge.from, to: edge.to, kind: edge.kind, label: edge.label })),
      direction: view.direction,
      labelSizes,
      spacingScale,
      onLayoutDone: ({ ms, nodes }) => logger?.log('layout.done', { ms, nodes, viewId, spacingScale }),
    })
    if (layout.issues.length === 0) break
    logger?.log('layout.retry', {
      viewId,
      spacingScale,
      issues: layout.issues.length,
      rules: [...new Set(layout.issues.map(entry => entry.rule))].sort(),
    })
  }
  if (layout.issues.length > 0) {
    // A layout that cannot place its labels without covering a box is a defect, not a
    // warning: refuse to write the scene and name the edges the retries could not place.
    // The refusal code must name the defect that actually blocked the layout: a view
    // whose only problem is a routed-through body is not a label collision, and callers
    // branch on this code.
    const blocking = layout.issues[0]
    throw new DesignmapRefusal(
      REFUSAL_BY_RULE[blocking.rule] ?? REFUSALS.labelCollision,
      blocking.rule === 'edge_through_node'
        ? 'layout could not route an edge without crossing a node'
        : 'layout could not place every edge label without a collision',
      { viewId, issues: layout.issues, spacingScale: SPACING_SCALES.at(-1) },
    )
  }

  const stale = new Set(staleNodeIds)
  const sceneNodes = sortById(selected.nodes.map(node => {
    const box = layout.nodes.get(node.id) ?? { x: 0, y: 0, ...nodeSize(node.label) }
    return {
      id: node.id,
      type: node.type,
      label: sceneLabel(node.label),
      group: node.group ?? null,
      x: round2(box.x),
      y: round2(box.y),
      w: round2(box.w),
      h: round2(box.h),
      stale: stale.has(node.id),
      source: node.source ?? null,
    }
  }))
  const sceneGroups = sortById(selected.groups.map(group => {
    const box = layout.groups.get(group.id) ?? { x: 0, y: 0, w: 0, h: 0 }
    return { id: group.id, label: group.label ?? '', x: round2(box.x), y: round2(box.y), w: round2(box.w), h: round2(box.h) }
  }))
  const sceneEdges = sortById(selected.edges.map(edge => {
    const geometry = layout.edges.get(edge.id) ?? { points: [], labelBox: { x: 0, y: 0, w: 0, h: 0 } }
    const labelBox = geometry.labelBox ?? { x: 0, y: 0, w: 0, h: 0 }
    return {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      label: edge.label ?? '',
      labelLines: (labelSizes.get(edge.id) ?? edgeLabelSize(edge.label ?? '')).lines,
      points: geometry.points,
      labelBox,
      // Compatibility anchor: the plate's top-left corner. New consumers use labelBox.
      labelAt: { x: labelBox.x, y: labelBox.y },
    }
  }))

  const merge = mergeOverlays(sceneNodes, overlays)
  const mergedNodes = sortById(merge.nodes)
  // A moved node must keep its edge endpoints on its boundary (SCENE-CONTRACT,
  // edges[].points); nodes without an overlay row keep their layout geometry.
  const reattachedEdges = reattachEdges(mergedNodes, sceneEdges, new Set(merge.rows.keys()))
  // Labels are placed last, against the FINAL boxes: an overlay-moved node changes both
  // the free spans of its incident edges and the boxes the plate must avoid. The layout's
  // plate position stays the preferred anchor, so an unmoved map keeps the reserved
  // geometry byte-for-byte.
  const mergedEdges = []
  const labelObstacles = [...mergedNodes]
  for (const edge of reattachedEdges) {
    const size = labelSizes.get(edge.id) ?? edgeLabelSize(edge.label)
    const placed = placeEdgeLabel({ points: edge.points, preferred: edge.labelBox, size, obstacles: labelObstacles })
    const labelBox = placed ?? { ...edge.labelBox, w: size.w, h: size.h }
    // A plate the search could not move carries no free space; the scene lint reports it
    // as a warning instead of refusing, because the overlap came from a human overlay and
    // the map must stay openable.
    if (placed !== null) labelObstacles.push(placed)
    mergedEdges.push({ ...edge, labelBox, labelAt: { x: labelBox.x, y: labelBox.y } })
  }
  const canvas = recomputeCanvas(mergedNodes, sceneGroups, mergedEdges)
  const scene = {
    schemaVersion: 1,
    viewId: view.id,
    title: view.title ?? '',
    level: view.level,
    direction: view.direction ?? 'LR',
    canvas,
    nodes: mergedNodes,
    groups: sceneGroups,
    edges: mergedEdges,
  }

  const findings = [...modelFindings, ...lintScene(scene, { merge, staleNodeIds })]
  const lint = summariseLint(findings)
  logger?.log('merge.applied', { applied: merge.applied, nodes: mergedNodes.length, colours: merge.colours.size })
  logger?.log('merge.gc', { warnings: merge.gc.length, codes: [...new Set(merge.gc.map(entry => entry.code))].sort() })
  logger?.log('lint.result', { ok: lint.ok, phase: 'scene', counts: lint.counts, rules: lint.rules })

  if (!lint.ok) {
    throw new DesignmapRefusal(REFUSAL_BY_RULE[findings.find(entry => entry.severity === 'error')?.rule] ?? REFUSALS.invalidModel, 'scene lint failed', {
      findings: lint.findings,
      counts: lint.counts,
      viewId,
    })
  }

  const parsedScene = sceneSchema.safeParse(scene)
  if (!parsedScene.success) {
    throw new Error(`designmap-core produced a scene that violates SCENE-CONTRACT: ${JSON.stringify(parsedScene.error.issues)}`)
  }

  const sceneJson = toJson(scene)
  const sceneHash = sha256(sceneJson)
  logger?.log('render.done', {
    viewId: view.id,
    nodes: scene.nodes.length,
    edges: scene.edges.length,
    groups: scene.groups.length,
    bytes: Buffer.byteLength(sceneJson),
    sceneHash,
    ms: round2(performance.now() - started),
  })
  return {
    viewId: view.id,
    scene,
    sceneJson,
    sceneHash,
    lint,
    merge: { applied: merge.applied, gc: merge.gc, colours: merge.colours, rows: merge.rows },
    layout: { ms: layout.ms, nodes: layout.nodeCount },
    bytes: Buffer.byteLength(sceneJson),
  }
}

function countBySeverity(findings) {
  const counts = { error: 0, warning: 0, info: 0 }
  for (const entry of findings) counts[entry.severity] += 1
  return counts
}
