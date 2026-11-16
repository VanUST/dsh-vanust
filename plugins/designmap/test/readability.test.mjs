/**
 * PROOF:
 * Behavior: every fixture view (the pinned demo plus the dense / cyclic / multiline
 *   readability scenes) renders with NO visual collision — no label plate over a node, no
 *   two plates over each other, no edge body through a node — and the audit that says so
 *   can fail: the same check reports a plate moved inside a node.
 * Fails when: a layout change puts a label back on top of a box, a plate touches another
 *   plate, an edge is routed through a node, or the audit silently always returns clean.
 * Production path: src/layout.mjs placeEdgeLabel/placementIssues -> src/render.mjs
 *   (retry, then refuse label_collision) -> bin/audit-scene.mjs auditScene.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createWorkspace } from '../src/workspace.mjs'
import { renderView } from '../src/render.mjs'
import { auditScene } from '../bin/audit-scene.mjs'

const fixture = name => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))

async function renderAllViews(name) {
  const workspace = createWorkspace(fixture(name))
  const model = workspace.readModel().model
  const views = workspace.readViews().views
  const overlays = workspace.readOverlays().overlays
  const rendered = []
  for (const view of views.views) {
    rendered.push({ view, result: await renderView({ model, views, overlays, viewId: view.id }) })
  }
  return rendered
}

for (const name of ['demo', 'readability']) {
  test(`no visual collision in any ${name} fixture view`, async () => {
    const rendered = await renderAllViews(name)
    assert.ok(rendered.length > 0, `${name}: no views`)
    for (const { view, result } of rendered) {
      const row = auditScene(result.scene)
      assert.deepEqual(row.collisions, { label_over_node: 0, label_label_overlap: 0, edge_through_node: 0 }, `${view.id}: collision`)
      assert.equal(row.outsideCanvas, 0, `${view.id}: a plate is outside the canvas`)
      assert.equal(row.clean, true, `${view.id}: audit says the scene is not clean`)
      // Every plate is a real rectangle with room for its text.
      for (const edge of result.scene.edges) {
        assert.ok(edge.labelBox.w >= 28 && edge.labelBox.h >= 20, `${view.id}/${edge.id}: implausible plate`)
        assert.ok(Array.isArray(edge.labelLines) && edge.labelLines.length >= 1, `${view.id}/${edge.id}: no wrapped lines`)
      }
    }
  })
}

test('the audit catches a plate moved inside a node (negative control)', async () => {
  const rendered = await renderAllViews('demo')
  const clean = rendered[0].result.scene
  assert.equal(auditScene(clean).clean, true)

  const broken = structuredClone(clean)
  const victim = broken.nodes[0]
  broken.edges[0].labelBox = {
    x: victim.x + 4,
    y: victim.y + 4,
    w: broken.edges[0].labelBox.w,
    h: broken.edges[0].labelBox.h,
  }
  const row = auditScene(broken)
  assert.equal(row.clean, false)
  assert.equal(row.collisions.label_over_node >= 1, true)
})
