/**
 * PROOF:
 * Behavior: two renders of the same model/views/overlays produce byte-identical scene
 *   JSON in the documented key order with no volatile fields (INV-IDEMPOTENT, FR-3).
 * Fails when: layout output is serialized raw (the GWT `$H` field differs per run),
 *   a timestamp or absolute path enters the scene, collections are not sorted by id,
 *   or overlay merge is not applied identically on both runs.
 * Production path: src/render.mjs renderView -> src/layout.mjs layoutView ->
 *   src/overlays.mjs mergeOverlays -> src/canonical.mjs toJson.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createWorkspace } from '../src/workspace.mjs'
import { renderView } from '../src/render.mjs'
import { sha256 } from '../src/canonical.mjs'

const demo = fileURLToPath(new URL('../fixtures/demo', import.meta.url))

function inputs() {
  const workspace = createWorkspace(demo)
  return {
    model: workspace.readModel().model,
    views: workspace.readViews().views,
    overlays: workspace.readOverlays().overlays,
  }
}

test('two renders of the same fixture are byte-identical (INV-IDEMPOTENT)', async () => {
  const first = await renderView({ ...inputs(), viewId: 'v.context' })
  const second = await renderView({ ...inputs(), viewId: 'v.context' })
  assert.equal(first.sceneJson, second.sceneJson)
  assert.equal(first.sceneHash, second.sceneHash)
  assert.equal(first.sceneHash, sha256(first.sceneJson))
  assert.match(first.sceneHash, /^sha256:[0-9a-f]{64}$/u)
  console.log(`determinism v.context hash=${first.sceneHash} bytes=${first.bytes}`)
})

test('the scene carries the documented key order and no volatile fields', async () => {
  const { scene, sceneJson } = await renderView({ ...inputs(), viewId: 'v.context' })
  assert.deepEqual(Object.keys(scene), ['schemaVersion', 'viewId', 'title', 'level', 'direction', 'canvas', 'nodes', 'groups', 'edges'])
  assert.deepEqual(Object.keys(scene.nodes[0]), ['id', 'type', 'label', 'group', 'x', 'y', 'w', 'h', 'stale', 'source'])
  assert.deepEqual(Object.keys(scene.edges[0]), ['id', 'from', 'to', 'kind', 'label', 'labelLines', 'points', 'labelBox', 'labelAt'])
  assert.equal(/"generatedAt"|"commit"|"updatedAt"/u.test(sceneJson), false)
  assert.equal(sceneJson.includes('$H'), false)
  assert.equal(sceneJson.includes(demo), false)
  const ids = scene.nodes.map(node => node.id)
  assert.deepEqual(ids, [...ids].sort())
  const edgeIds = scene.edges.map(edge => edge.id)
  assert.deepEqual(edgeIds, [...edgeIds].sort())
})

test('a freshly parsed workspace reproduces the same scene bytes', async () => {
  const result = await renderView({ ...inputs(), viewId: 'v.context' })
  const again = createWorkspace(demo)
  const second = await renderView({
    model: again.readModel().model,
    views: again.readViews().views,
    overlays: again.readOverlays().overlays,
    viewId: 'v.context',
  })
  assert.equal(second.sceneHash, result.sceneHash)
  assert.equal(second.sceneJson, result.sceneJson)
})

test('the drill-down view renders only its group (TB direction)', async () => {
  const { scene } = await renderView({ ...inputs(), viewId: 'v.checkout' })
  assert.deepEqual(scene.nodes.map(node => node.id), ['svc.checkout.api', 'svc.checkout.worker'])
  assert.deepEqual(scene.groups.map(group => group.id), ['grp.checkout'])
  assert.deepEqual(scene.edges.map(edge => edge.id), ['e.api.worker'])
  assert.equal(scene.direction, 'TB')
})
