/**
 * PROOF:
 * Behavior: a rendered scene converts to Excalidraw elements without losing geometry —
 *   edges keep the core polyline as UNBOUND arrows (so the editor cannot re-route them),
 *   labels are bound to their container, every element carries its semantic id, and a
 *   human drag/recolour maps back to the overlay delta the host command already accepts.
 * Fails when: an edge becomes a bound arrow, an element loses its designmap customData,
 *   locking is inverted (read-only must lock node bodies), or the diff reports a node the
 *   human did not touch.
 * Production path: client/excalidraw.js sceneToElements/overlayDelta, fed by the scene
 *   contract (docs/designmap/SCENE-CONTRACT.md) and writing overlays through
 *   /designmap op:'overlay'.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { sceneToElements, overlayDelta, NODE_PREFIX, EDGE_PREFIX } from '../client/excalidraw.js'
import { createWorkspace } from '../src/workspace.mjs'
import { renderView } from '../src/render.mjs'

const workspace = createWorkspace(join(import.meta.dirname, '..', 'fixtures', 'demo'))
const rendered = await renderView({
  model: workspace.readModel().model,
  views: workspace.readViews().views,
  overlays: workspace.readOverlays().overlays,
  viewId: 'v.context',
})
const scene = rendered.scene

test('every scene node becomes a shape, a bound label and a semantic id', () => {
  const elements = sceneToElements(scene)
  for (const node of scene.nodes) {
    const shape = elements.find((entry) => entry.customData?.designmap?.nodeId === node.id && entry.type !== 'text')
    assert.ok(shape, `missing shape for ${node.id}`)
    assert.equal(shape.id, `${NODE_PREFIX}${node.id}`)
    assert.equal(shape.x, node.x)
    assert.equal(shape.y, node.y)
    assert.equal(shape.width, node.w)
    assert.equal(shape.height, node.h)
    const label = elements.find((entry) => entry.id === shape.boundElements[0].id)
    assert.equal(label.type, 'text')
    assert.equal(label.text, node.label)
    assert.equal(label.containerId, shape.id)
  }
})

test('edges keep the core polyline and stay unbound, so the editor cannot re-route them', () => {
  const elements = sceneToElements(scene)
  for (const edge of scene.edges) {
    const arrow = elements.find((entry) => entry.id === `${EDGE_PREFIX}${edge.id}`)
    assert.equal(arrow.type, 'arrow')
    assert.equal(arrow.startBinding, null)
    assert.equal(arrow.endBinding, null)
    assert.equal(arrow.points.length, edge.points.length)
    const first = edge.points[0]
    assert.equal(arrow.x, first.x)
    assert.equal(arrow.y, first.y)
    edge.points.forEach((point, index) => {
      assert.equal(Math.round((arrow.x + arrow.points[index].x) * 100) / 100, point.x)
      assert.equal(Math.round((arrow.y + arrow.points[index].y) * 100) / 100, point.y)
    })
  }
})

test('read-only locks the structure; edit mode unlocks only node bodies', () => {
  const readOnly = sceneToElements(scene)
  assert.equal(readOnly.filter((entry) => entry.customData?.designmap?.kind === 'node' && entry.locked === false).length, 0)
  const editing = sceneToElements(scene, { editMode: true })
  assert.equal(editing.filter((entry) => entry.customData?.designmap?.kind === 'node' && entry.locked === false).length, scene.nodes.length)
  for (const entry of editing) {
    if (entry.customData?.designmap?.kind !== 'node') assert.equal(entry.locked, true, `${entry.id} must stay locked`)
  }
})

test('a drag and a recolour map back to exactly the overlay rows the human touched', () => {
  const baseline = sceneToElements(scene)
  const moved = structuredClone(baseline)
  const [node] = scene.nodes
  const target = moved.find((entry) => entry.id === `${NODE_PREFIX}${node.id}`)
  target.x = 321.5
  target.y = 123
  const other = moved.find((entry) => entry.id === `${NODE_PREFIX}${scene.nodes[1].id}`)
  other.backgroundColor = '#123456'
  other.strokeColor = '#654321'

  const delta = overlayDelta(baseline, moved)
  assert.deepEqual(Object.keys(delta).sort(), [node.id, scene.nodes[1].id].sort())
  assert.deepEqual(delta[node.id], { x: 321.5, y: 123 })
  assert.deepEqual(delta[scene.nodes[1].id], { fill: '#123456', stroke: '#654321' })
})

test('an unchanged canvas produces no delta, and a deleted or foreign element is ignored', () => {
  const baseline = sceneToElements(scene)
  assert.deepEqual(overlayDelta(baseline, structuredClone(baseline)), {})

  const edited = structuredClone(baseline)
  edited.push({ id: 'human-stroke', type: 'freedraw', customData: null })
  edited.find((entry) => entry.id === `${NODE_PREFIX}${scene.nodes[0].id}`).isDeleted = true
  assert.deepEqual(overlayDelta(baseline, edited), {})
})

test('an overlay row moves the drawn shape without touching the scene', () => {
  const elements = sceneToElements(scene, { overlays: { [scene.nodes[0].id]: { x: 10, y: 20, fill: '#000000' } } })
  const shape = elements.find((entry) => entry.id === `${NODE_PREFIX}${scene.nodes[0].id}`)
  assert.equal(shape.x, 10)
  assert.equal(shape.y, 20)
  assert.equal(shape.backgroundColor, '#000000')
  assert.equal(shape.strokeColor !== undefined, true)
})
