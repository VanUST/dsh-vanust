/**
 * PROOF:
 * Behavior: the scene's edge geometry satisfies CT-SCENE — the first point lies on the
 *   source node boundary and the last on the target boundary (<= 0.01 px, within the
 *   rectangle side), and no edge label anchor falls inside a node box on its view; an
 *   overlay-moved node re-anchors its incident edges and re-places their labels. When
 *   placement is impossible (overlapping boxes) the anchor is still emitted and the
 *   `label_over_node` warning makes the regression visible.
 * Fails when: ELK port offsets leak into the scene (8 px outside / 14 px short), a label
 *   anchor sits inside a node box, a moved node keeps stale edge endpoints or labels, or
 *   the fallback is silent.
 * Production path: src/layout.mjs snapEdgeToBoxes/placeLabelOutside -> src/render.mjs
 *   (labels recomputed after overlay merge) -> src/lint.mjs label_over_node.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createWorkspace } from '../src/workspace.mjs'
import { renderView } from '../src/render.mjs'
import { findByRule } from '../src/lint.mjs'
import { perfFixture } from '../fixtures/perf.mjs'
import { lintCases } from '../fixtures/lint-cases.mjs'

const EPS = 0.011
const demo = fileURLToPath(new URL('../fixtures/demo', import.meta.url))

/** A point is on the boundary when it lies on one side and within that side's span. */
function onBoundary(point, box) {
  const onVertical = (Math.abs(point.x - box.x) <= EPS || Math.abs(point.x - (box.x + box.w)) <= EPS)
    && point.y >= box.y - EPS && point.y <= box.y + box.h + EPS
  const onHorizontal = (Math.abs(point.y - box.y) <= EPS || Math.abs(point.y - (box.y + box.h)) <= EPS)
    && point.x >= box.x - EPS && point.x <= box.x + box.w + EPS
  return onVertical || onHorizontal
}

function assertEdgeBoundaries(label, scene) {
  const boxes = new Map(scene.nodes.map(node => [node.id, node]))
  assert.ok(scene.edges.length > 0, `${label}: no edges to check`)
  for (const edge of scene.edges) {
    const source = boxes.get(edge.from)
    const target = boxes.get(edge.to)
    assert.ok(source && target, `${label}/${edge.id}: endpoints missing from the scene`)
    const first = edge.points[0]
    const last = edge.points.at(-1)
    assert.ok(onBoundary(first, source), `${label}/${edge.id}: first point (${first.x},${first.y}) is not on source ${edge.from} box ${JSON.stringify(source)}`)
    assert.ok(onBoundary(last, target), `${label}/${edge.id}: last point (${last.x},${last.y}) is not on target ${edge.to} box ${JSON.stringify(target)}`)
  }
}

function onBoxBoundary(point, box) {
  const onVertical = (Math.abs(point.x - box.x) <= EPS || Math.abs(point.x - (box.x + box.w)) <= EPS)
    && point.y >= box.y - EPS && point.y <= box.y + box.h + EPS
  const onHorizontal = (Math.abs(point.y - box.y) <= EPS || Math.abs(point.y - (box.y + box.h)) <= EPS)
    && point.x >= box.x - EPS && point.x <= box.x + box.w + EPS
  return onVertical || onHorizontal
}

function labelBoxes(scene) {
  const hits = []
  for (const edge of scene.edges) {
    for (const node of scene.nodes) {
      if (edge.labelAt.x > node.x && edge.labelAt.x < node.x + node.w
        && edge.labelAt.y > node.y && edge.labelAt.y < node.y + node.h) {
        hits.push({ edgeId: edge.id, nodeId: node.id, labelAt: edge.labelAt })
      }
    }
  }
  return hits
}

async function renderDemo(overlays) {
  const workspace = createWorkspace(demo)
  return renderView({
    model: workspace.readModel().model,
    views: workspace.readViews().views,
    overlays: overlays ?? workspace.readOverlays().overlays,
    viewId: 'v.context',
  })
}

test('every edge endpoint lands on its node boundary in fixtures/demo', async () => {
  const { scene } = await renderDemo()
  assertEdgeBoundaries('demo', scene)
  console.log(`demo edges checked: ${scene.edges.map(edge => edge.id).join(', ')}`)
})

test('every edge endpoint lands on its node boundary in the 25-node fixture', async () => {
  const { scene } = await renderView({ ...perfFixture, overlays: {}, viewId: 'v.flow' })
  assertEdgeBoundaries('perf25', scene)
  console.log(`perf25 edges checked: ${scene.edges.length}`)
})

test('no edge label anchor falls inside a node box (demo and 25-node fixture)', async () => {
  const demoScene = (await renderDemo()).scene
  const perfScene = (await renderView({ ...perfFixture, overlays: {}, viewId: 'v.flow' })).scene
  assert.deepEqual(labelBoxes(demoScene), [])
  assert.deepEqual(labelBoxes(perfScene), [])
})

test('an overlay-moved node re-anchors incident edges and re-places their labels', async () => {
  const moved = await renderDemo({ $version: 1, 'svc.checkout.api': { x: 600, y: 300 } })
  assertEdgeBoundaries('demo+moved', moved.scene)
  assert.deepEqual(labelBoxes(moved.scene), [])
  const api = moved.scene.nodes.find(node => node.id === 'svc.checkout.api')
  assert.deepEqual({ x: api.x, y: api.y }, { x: 600, y: 300 })
  const incident = moved.scene.edges.filter(edge => edge.from === 'svc.checkout.api' || edge.to === 'svc.checkout.api')
  assert.equal(incident.length, 2)
  for (const edge of incident) {
    const endpoint = edge.from === 'svc.checkout.api' ? edge.points[0] : edge.points.at(-1)
    assert.ok(onBoundary(endpoint, api), `${edge.id}: moved endpoint not on the new box`)
  }
})

test('a label that cannot leave the boxes is emitted and reported as label_over_node', async () => {
  const entry = lintCases.find(item => item.rule === 'label_over_node')
  assert.ok(entry, 'fixture missing the label_over_node case')
  const result = await renderView({
    model: entry.model,
    views: entry.views,
    overlays: entry.overlays,
    viewId: entry.views.views[0].id,
  })
  const finding = findByRule(result.lint.findings, 'label_over_node')
  assert.equal(finding.length >= 1, true)
  assert.equal(finding[0].severity, 'warning')
  // The anchor is still emitted at the fallback midpoint (the renderer draws it) and it
  // touches a box; the warning is what makes the regression visible.
  const anchor = result.scene.edges[0].labelAt
  assert.equal(Number.isFinite(anchor.x), true)
  assert.equal(result.scene.nodes.some(node => onBoxBoundary(anchor, node)), true)
})

test('two runs remain byte-identical and match the new golden hash', async () => {
  const first = await renderDemo()
  const second = await renderDemo()
  assert.equal(first.sceneJson, second.sceneJson)
  assert.equal(first.sceneHash, second.sceneHash)
  assert.equal(first.sceneHash, 'sha256:1adea6ca8275ee7c1dfe8be5e6e81446ae010d8594bd8d6fa6250a66e0a5d83a')
  console.log(`golden demo hash=${first.sceneHash} bytes=${first.bytes}`)
})
