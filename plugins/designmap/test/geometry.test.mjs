/**
 * PROOF:
 * Behavior: the scene's edge geometry satisfies CT-SCENE — the first point lies on the
 *   source node boundary and the last on the target boundary (<= 0.01 px, within the
 *   rectangle side), and NO edge-label plate (its full rectangle, not its anchor) meets a
 *   node box, another plate, or lets an edge body cross a node; an overlay-moved node
 *   re-anchors its incident edges and re-places their labels.
 * Fails when: ELK port offsets leak into the scene (8 px outside / 14 px short), a plate
 *   touches a node, two plates overlap, an edge body crosses a node, a moved node keeps
 *   stale edge endpoints or labels, or the placement search silently gives up.
 * Production path: src/layout.mjs placeEdgeLabel/placementIssues -> src/render.mjs
 *   (retry with a larger spacing, then refuse label_collision) -> src/lint.mjs.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createWorkspace } from '../src/workspace.mjs'
import { renderView } from '../src/render.mjs'
import { findByRule, lintScene, summariseLint } from '../src/lint.mjs'
import { boxesOverlap, placeEdgeLabel, segmentHitsBox } from '../src/layout.mjs'
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

/**
 * Every visual collision the scene would show: plate-node, plate-plate, edge-node.
 * `bodies` is false for an overlay-moved scene: a human may drag a node so that an edge
 * body now crosses a box, and that is reported as a warning (the map stays openable),
 * not handled by the placement pass.
 */
function visualCollisions(scene, { bodies = true } = {}) {
  const hits = []
  for (const edge of scene.edges) {
    for (const node of scene.nodes) {
      if (boxesOverlap(edge.labelBox, node)) hits.push({ kind: 'label_over_node', edgeId: edge.id, nodeId: node.id })
    }
    if (!bodies) continue
    for (let index = 1; index < edge.points.length; index += 1) {
      for (const node of scene.nodes) {
        if (segmentHitsBox(edge.points[index - 1], edge.points[index], node)) {
          hits.push({ kind: 'edge_through_node', edgeId: edge.id, nodeId: node.id })
        }
      }
    }
  }
  for (let left = 0; left < scene.edges.length; left += 1) {
    for (let right = left + 1; right < scene.edges.length; right += 1) {
      if (boxesOverlap(scene.edges[left].labelBox, scene.edges[right].labelBox)) {
        hits.push({ kind: 'label_label_overlap', edgeIds: [scene.edges[left].id, scene.edges[right].id] })
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

test('no label plate, plate pair or edge body collides (demo and 25-node fixture)', async () => {
  const demoScene = (await renderDemo()).scene
  const perfScene = (await renderView({ ...perfFixture, overlays: {}, viewId: 'v.flow' })).scene
  assert.deepEqual(visualCollisions(demoScene), [])
  assert.deepEqual(visualCollisions(perfScene), [])
  console.log(`collision check: demo ${demoScene.edges.length} labels, perf25 ${perfScene.edges.length} labels`)
})

test('every scene edge carries a labelBox that matches the core metric', async () => {
  const { scene } = await renderDemo()
  for (const edge of scene.edges) {
    assert.ok(edge.labelBox, `${edge.id}: no labelBox`)
    assert.ok(edge.labelBox.w >= 28 && edge.labelBox.h >= 20, `${edge.id}: implausible plate ${JSON.stringify(edge.labelBox)}`)
    assert.equal(edge.labelAt.x, edge.labelBox.x)
    assert.equal(edge.labelAt.y, edge.labelBox.y)
  }
})

test('an overlay-moved node re-anchors incident edges and re-places their labels', async () => {
  const moved = await renderDemo({ $version: 1, 'svc.checkout.api': { x: 600, y: 300 } })
  assertEdgeBoundaries('demo+moved', moved.scene)
  // Plates are placed against the FINAL boxes; an edge body may now cross a box because
  // the human moved an endpoint, and that case is a scene warning, not a placement bug.
  assert.deepEqual(visualCollisions(moved.scene, { bodies: false }), [])
  const through = moved.lint.findings.filter(entry => entry.rule === 'edge_through_node')
  console.log(`moved scene: ${through.length} edge-through-node warning(s), ${moved.lint.counts.warning} warning(s) total`)
  const api = moved.scene.nodes.find(node => node.id === 'svc.checkout.api')
  assert.deepEqual({ x: api.x, y: api.y }, { x: 600, y: 300 })
  const incident = moved.scene.edges.filter(edge => edge.from === 'svc.checkout.api' || edge.to === 'svc.checkout.api')
  assert.equal(incident.length, 2)
  for (const edge of incident) {
    const endpoint = edge.from === 'svc.checkout.api' ? edge.points[0] : edge.points.at(-1)
    assert.ok(onBoundary(endpoint, api), `${edge.id}: moved endpoint not on the new box`)
  }
})

test('a layout that cannot place a self-loop label refuses with label_collision', async () => {
  // A self-loop is not routed by ELK (layered rejects it), so its plate is placed on the
  // locally drawn loop; a long label cannot leave the source box and the gate must refuse
  // instead of writing the overlapping scene. This is the reachable red for the branch.
  const model = {
    schemaVersion: 1,
    groups: [],
    nodes: [
      { id: 'svc.a', type: 'service', label: 'A', group: null, source: null },
      { id: 'svc.b', type: 'service', label: 'B', group: null, source: null },
    ],
    edges: [
      { id: 'e.a.b', from: 'svc.a', to: 'svc.b', kind: 'sync', label: 'calls' },
      { id: 'e.a.a', from: 'svc.a', to: 'svc.a', kind: 'async', label: 'retries every failed row forever' },
    ],
  }
  const views = { schemaVersion: 1, views: [{ id: 'v.loop', title: 'Loop', level: 'context', direction: 'LR', include: [], parent: null }] }
  await assert.rejects(
    renderView({ model, views, overlays: {}, viewId: 'v.loop' }),
    (error) => {
      assert.equal(error.code, 'label_collision')
      assert.equal(error.details.issues.some(issue => issue.rule === 'label_collision'), true)
      assert.equal(error.details.spacingScale, 2)
      return true
    },
  )
})

test('the placement search reports no free spot when every candidate is covered', () => {
  const points = [{ x: 0, y: 50 }, { x: 200, y: 50 }]
  const size = { w: 100, h: 25 }
  assert.notEqual(placeEdgeLabel({ points, preferred: null, size, obstacles: [] }), null)
  // One obstacle covering the whole neighbourhood leaves nowhere for the plate.
  assert.equal(placeEdgeLabel({ points, preferred: null, size, obstacles: [{ x: -1000, y: -1000, w: 4000, h: 4000 }] }), null)
})

test('two runs remain byte-identical and match the new golden hash', async () => {
  const first = await renderDemo()
  const second = await renderDemo()
  assert.equal(first.sceneJson, second.sceneJson)
  assert.equal(first.sceneHash, second.sceneHash)
  assert.equal(first.sceneHash, 'sha256:8b32911c7c898ef2f594669534545797ec9deb3ce2dcf6463c0bc0a7efd14262')
  console.log(`golden demo hash=${first.sceneHash} bytes=${first.bytes}`)
})
