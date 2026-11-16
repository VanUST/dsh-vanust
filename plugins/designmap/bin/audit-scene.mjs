#!/usr/bin/env node
/**
 * Readability audit: the command that answers "would this map look broken?".
 *
 * It renders a designmap workspace through the same core the host uses and measures the
 * scene a human would see: label plates against node boxes, plates against each other,
 * edge bodies through nodes, plates outside the canvas, and how much of the canvas the
 * map actually uses. Exit code 1 means the map has a visual collision — the same
 * invariant `renderView` refuses on before a write.
 *
 * Usage:
 *   node bin/audit-scene.mjs <designmapDir>            # every view of a workspace
 *   node bin/audit-scene.mjs --scene <scene.json>      # one scene file (negative control)
 *   node bin/audit-scene.mjs <designmapDir> --write-set <dir>
 *                                                     # also emit a harness scene set
 *   --json                                             # machine-readable report only
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWorkspace } from '../src/workspace.mjs'
import { renderView } from '../src/render.mjs'
import { renderAll } from '../src/index-file.mjs'
import { labelBoxOf, placementIssues } from '../src/layout.mjs'
import { DesignmapRefusal } from '../src/schema.mjs'


/**
 * Smallest clearance between any plate and any node, and between two plates.
 * Chebyshev distance: 0 means touching or overlapping, a positive number is the free
 * gap on the closer axis. It is the same number a human would call "space".
 */
function clearance(scene) {
  const gap = (left, right) => {
    const dx = Math.max(0, Math.max(left.x - (right.x + right.w), right.x - (left.x + left.w)))
    const dy = Math.max(0, Math.max(left.y - (right.y + right.h), right.y - (left.y + left.h)))
    return Math.max(dx, dy)
  }
  let toNode = Infinity
  let toLabel = Infinity
  const plates = scene.edges.filter(edge => edge.label !== '').map(edge => labelBoxOf(edge))
  for (const plate of plates) for (const node of scene.nodes) toNode = Math.min(toNode, gap(plate, node))
  for (let left = 0; left < plates.length; left += 1) {
    for (let right = left + 1; right < plates.length; right += 1) toLabel = Math.min(toLabel, gap(plates[left], plates[right]))
  }
  return {
    labelToNode: Number.isFinite(toNode) ? Math.round(toNode * 10) / 10 : null,
    labelToLabel: Number.isFinite(toLabel) ? Math.round(toLabel * 10) / 10 : null,
  }
}

/** Audit one scene; returns the report row and whether it is clean. */
export function auditScene(scene) {
  const issues = placementIssues({ nodes: scene.nodes, edges: scene.edges })
  const plates = scene.edges.filter(edge => edge.label !== '').map(edge => labelBoxOf(edge))
  const outside = plates.filter(plate => (
    plate.x < scene.canvas.x
    || plate.y < scene.canvas.y
    || plate.x + plate.w > scene.canvas.x + scene.canvas.width
    || plate.y + plate.h > scene.canvas.y + scene.canvas.height
  ))
  const nodeInk = scene.nodes.reduce((sum, node) => sum + node.w * node.h, 0)
  const canvasArea = scene.canvas.width * scene.canvas.height
  const counts = {}
  for (const issue of issues) counts[issue.rule] = (counts[issue.rule] ?? 0) + 1
  return {
    viewId: scene.viewId,
    canvas: `${Math.round(scene.canvas.width)}x${Math.round(scene.canvas.height)}`,
    aspect: Number((scene.canvas.width / (scene.canvas.height || 1)).toFixed(2)),
    nodes: scene.nodes.length,
    edges: scene.edges.length,
    labels: plates.length,
    collisions: {
      label_over_node: counts.label_over_node ?? 0,
      label_label_overlap: counts.label_label_overlap ?? 0,
      edge_through_node: counts.edge_through_node ?? 0,
    },
    outsideCanvas: outside.length,
    clearance: clearance(scene),
    density: Number((nodeInk / (canvasArea || 1)).toFixed(3)),
    clean: issues.length === 0 && outside.length === 0,
  }
}

function print(report, asJson) {
  if (asJson) {
    console.log(JSON.stringify(report, null, 1))
    return
  }
  const rows = report.views
  console.log(`readability audit — ${report.source}`)
  console.log('view         canvas      aspect nodes edges labels  over-node over-label through-node outside  clear(node/label) density')
  for (const row of rows) {
    console.log([
      row.viewId.padEnd(12),
      row.canvas.padEnd(11),
      String(row.aspect).padStart(6),
      String(row.nodes).padStart(5),
      String(row.edges).padStart(5),
      String(row.labels).padStart(6),
      String(row.collisions.label_over_node).padStart(10),
      String(row.collisions.label_label_overlap).padStart(10),
      String(row.collisions.edge_through_node).padStart(12),
      String(row.outsideCanvas).padStart(7),
      `${row.clearance.labelToNode ?? '—'}/${row.clearance.labelToLabel ?? '—'}`.padStart(17),
      String(row.density).padStart(7),
    ].join(' '))
  }
  console.log(report.ok ? 'OK: no visual collision in any view' : `FAILED: ${report.dirty.length} view(s) with a visual collision`)
  for (const [viewId, issues] of Object.entries(report.details ?? {})) {
    console.log(`  ${viewId}: ${issues.map(issue => `${issue.rule}${issue.fields.id === undefined ? '' : `(${issue.fields.id})`}${issue.fields.nodeId === undefined ? '' : `→${issue.fields.nodeId}`}`).join(', ')}`)
  }
}

async function main({ first, rest, scenePath, writeSet, asJson }) {
  if (first === undefined) {
    console.error('usage: node bin/audit-scene.mjs <designmapDir>|--scene <scene.json> [--write-set <dir>] [--json]')
    return 2
  }
  if (scenePath !== null) {
    const scene = JSON.parse(readFileSync(resolve(scenePath), 'utf8'))
    const row = auditScene(scene)
    const report = { source: scenePath, ok: row.clean, dirty: row.clean ? [] : [row.viewId], views: [row], details: row.clean ? {} : { [row.viewId]: placementIssues({ nodes: scene.nodes, edges: scene.edges }) } }
    print(report, asJson)
    return report.ok ? 0 : 1
  }

  const workspaceRoot = resolve(first)
  const workspace = createWorkspace(workspaceRoot)
  const views = workspace.readViews().views
  if (views.views.length === 0) {
    console.error(`no views to audit in ${workspaceRoot} (missing or empty views.yaml)`)
    return 1
  }
  const report = { source: workspaceRoot, ok: true, dirty: [], views: [], details: {} }

  if (writeSet !== null) {
    // A harness scene set: the browser proof needs the same bytes the audit judged.
    const directory = resolve(writeSet)
    mkdirSync(join(directory), { recursive: true })
    const result = await renderAll({ workspace })
    const index = { root: views[0]?.id ?? null, views: [] }
    for (const entry of result.rendered) {
      const scene = entry.scene
      writeFileSync(join(directory, `${scene.viewId}.scene.json`), JSON.stringify(scene))
      index.views.push({
        viewId: scene.viewId,
        file: `${scene.viewId}.scene.json`,
        parentGroupId: scene.parent ?? null,
        title: scene.title,
        level: scene.level,
        meta: {
          generatedAt: new Date().toISOString(),
          commit: null,
          stale: { stale: false, commitBehind: 0, staleNodes: [] },
        },
      })
    }
    writeFileSync(join(directory, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
    rmSync(join(workspaceRoot, 'out'), { recursive: true, force: true })
    report.wroteSet = directory
  }

  for (const view of views.views) {
    try {
      const result = await renderView({
        model: workspace.readModel().model,
        views,
        overlays: workspace.readOverlays().overlays,
        viewId: view.id,
      })
      const row = auditScene(result.scene)
      row.layoutMs = result.layout.ms
      report.views.push(row)
      if (!row.clean) {
        report.ok = false
        report.dirty.push(view.id)
        report.details[view.id] = placementIssues({ nodes: result.scene.nodes, edges: result.scene.edges })
      }
    } catch (error) {
      report.ok = false
      report.dirty.push(view.id)
      report.details[view.id] = [{
        rule: error instanceof DesignmapRefusal ? error.code : 'internal_error',
        fields: error instanceof DesignmapRefusal ? { id: view.id } : {},
      }]
      if (!(error instanceof DesignmapRefusal)) throw error
    }
  }
  print(report, asJson)
  return report.ok ? 0 : 1
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const valueOf = (flag) => {
    const index = argv.indexOf(flag)
    return index === -1 || argv[index + 1] === undefined ? null : argv[index + 1]
  }
  const positional = argv.filter((argument, index) => !argument.startsWith('--')
    && (index === 0 || argv[index - 1] === undefined || !argv[index - 1].startsWith('--')))
  const code = await main({
    first: positional[0] ?? null,
    rest: argv,
    scenePath: valueOf('--scene'),
    writeSet: valueOf('--write-set'),
    asJson: argv.includes('--json'),
  })
  process.exit(code)
}
