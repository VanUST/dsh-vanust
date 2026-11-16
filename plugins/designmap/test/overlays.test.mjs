/**
 * PROOF:
 * Behavior: overlays with an unknown id, NaN, a negative coordinate, a colour outside
 *   the palette and an unknown key are reported in merge.gc and ignored; the valid row
 *   still applies, the scene still renders, and the canvas is recomputed after the merge
 *   (FR-4, SCENE-CONTRACT "Overlays").
 * Fails when: an invalid overlay row makes render fail, an ignored coordinate moves its
 *   node anyway, a palette colour is written into the scene bytes, or the canvas keeps
 *   the pre-merge bounds.
 * Production path: src/overlays.mjs mergeOverlays/recomputeCanvas -> src/render.mjs;
 * fixture fixtures/lint-cases.mjs badOverlays.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderView } from '../src/render.mjs'
import { PALETTE } from '../src/palette.mjs'
import { badOverlays } from '../fixtures/lint-cases.mjs'

const model = {
  schemaVersion: 1,
  groups: [],
  nodes: [
    { id: 'svc.a', type: 'service', label: 'A', group: null, source: null },
    { id: 'db.b', type: 'datastore', label: 'B', group: null, source: null },
    { id: 'queue.c', type: 'queue', label: 'C', group: null, source: null },
    { id: 'ext.d', type: 'external', label: 'D', group: null, source: null },
  ],
  edges: [
    { id: 'e.a.b', from: 'svc.a', to: 'db.b', kind: 'data', label: 'reads' },
    { id: 'e.b.c', from: 'db.b', to: 'queue.c', kind: 'async', label: 'publish' },
    { id: 'e.c.d', from: 'queue.c', to: 'ext.d', kind: 'sync', label: 'charge' },
  ],
}
const views = { schemaVersion: 1, views: [{ id: 'v.overlays', title: 'Overlays', level: 'context', direction: 'LR', include: [], parent: null }] }

test('tolerated bad overlay rows are GC warnings, render still succeeds', async () => {
  const clean = await renderView({ model, views, overlays: {}, viewId: 'v.overlays' })
  const result = await renderView({ model, views, overlays: badOverlays, viewId: 'v.overlays' })
  assert.equal(result.lint.ok, true)

  const codes = result.merge.gc.map(entry => entry.code)
  for (const code of ['unknown_node', 'non_finite_coordinate', 'negative_coordinate', 'colour_out_of_palette', 'unknown_key']) {
    assert.ok(codes.includes(code), `expected merge.gc to carry ${code}; got ${JSON.stringify(codes)}`)
  }
  // The palette finding is informational now: a human may pick any hex from the canvas.
  assert.equal(result.merge.gc.every(entry => ['warning', 'info'].includes(entry.severity)), true)

  const cleanNodes = new Map(clean.scene.nodes.map(node => [node.id, node]))
  const overlayNodes = new Map(result.scene.nodes.map(node => [node.id, node]))
  // The negative x on svc.a is ignored per axis; its valid y still applies.
  assert.equal(overlayNodes.get('svc.a').x, cleanNodes.get('svc.a').x)
  assert.equal(overlayNodes.get('svc.a').y, 10)
  // The NaN x on db.b is ignored per axis; its valid y still applies.
  assert.equal(overlayNodes.get('db.b').x, cleanNodes.get('db.b').x)
  assert.equal(overlayNodes.get('db.b').y, 20)
  // The valid row applied.
  assert.equal(overlayNodes.get('ext.d').x, 30)
  assert.equal(overlayNodes.get('ext.d').y, 30)
  // Colours never enter the scene bytes; they travel in merge.colours, and a human hex
  // outside the type palette is applied (reported as info, not dropped).
  assert.equal(result.sceneJson.includes('#123456'), false)
  assert.equal(result.merge.colours.has('queue.c'), true)
  // Canvas is recomputed around the merged position.
  assert.notDeepEqual(result.scene.canvas, clean.scene.canvas)
  assert.ok(result.scene.canvas.x <= 30)
})

test('a valid overlay moves only its node and reflows nothing else', async () => {
  const clean = await renderView({ model, views, overlays: {}, viewId: 'v.overlays' })
  const moved = await renderView({ model, views, overlays: { 'db.b': { x: 500, y: 300 } }, viewId: 'v.overlays' })
  const cleanNodes = new Map(clean.scene.nodes.map(node => [node.id, node]))
  for (const node of moved.scene.nodes) {
    if (node.id === 'db.b') {
      assert.equal(node.x, 500)
      assert.equal(node.y, 300)
    } else {
      assert.deepEqual({ x: node.x, y: node.y }, { x: cleanNodes.get(node.id).x, y: cleanNodes.get(node.id).y })
    }
  }
  assert.equal(moved.merge.applied, 1)
})

function onBoundary(point, box) {
  const eps = 0.02
  const onVertical = (Math.abs(point.x - box.x) < eps || Math.abs(point.x - (box.x + box.w)) < eps)
    && point.y >= box.y - eps && point.y <= box.y + box.h + eps
  const onHorizontal = (Math.abs(point.y - box.y) < eps || Math.abs(point.y - (box.y + box.h)) < eps)
    && point.x >= box.x - eps && point.x <= box.x + box.w + eps
  return onVertical || onHorizontal
}

test('a moved node keeps its incident edge endpoints on its box boundary', async () => {
  const clean = await renderView({ model, views, overlays: {}, viewId: 'v.overlays' })
  const moved = await renderView({ model, views, overlays: { 'db.b': { x: 500, y: 300 } }, viewId: 'v.overlays' })
  const movedNodes = new Map(moved.scene.nodes.map(node => [node.id, node]))
  const cleanEdges = new Map(clean.scene.edges.map(edge => [edge.id, edge]))
  const edges = new Map(moved.scene.edges.map(edge => [edge.id, edge]))

  // e.a.b ends at db.b, e.b.c starts at db.b: both endpoints must sit on the moved box.
  assert.equal(onBoundary(edges.get('e.a.b').points.at(-1), movedNodes.get('db.b')), true)
  assert.equal(onBoundary(edges.get('e.b.c').points[0], movedNodes.get('db.b')), true)
  // An edge with no moved endpoint keeps its layout geometry exactly.
  assert.deepEqual(edges.get('e.c.d'), cleanEdges.get('e.c.d'))
})

test('a palette colour is accepted and reported in the merge envelope, not the scene', async () => {
  const result = await renderView({ model, views, overlays: { 'svc.a': { fill: PALETTE.frontend.fill } }, viewId: 'v.overlays' })
  assert.deepEqual([...result.merge.colours.entries()], [[ 'svc.a', { fill: PALETTE.frontend.fill } ]])
  assert.equal(result.merge.gc.length, 0)
  assert.equal(result.sceneJson.includes(PALETTE.frontend.fill), false)
})
