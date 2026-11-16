/**
 * PROOF:
 * Behavior: a missing model is a valid empty scene (nodes [], zero canvas) and an
 *   unknown view id is a structured refusal, never an empty scene (INV-EMPTY,
 *   SCENE-CONTRACT "Empty and absent states").
 * Fails when: the workspace treats a missing model.yaml as an error, render needs
 *   ELK for an empty view, or an unknown view id silently renders blank.
 * Production path: src/workspace.mjs readModel (EMPTY_MODEL) -> src/render.mjs
 *   renderView -> src/layout.mjs layoutView empty branch.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createWorkspace } from '../src/workspace.mjs'
import { renderView } from '../src/render.mjs'
import { DesignmapRefusal } from '../src/schema.mjs'

const empty = fileURLToPath(new URL('../fixtures/empty', import.meta.url))

test('a missing model.yaml renders a valid empty scene with nodes []', async () => {
  const workspace = createWorkspace(empty)
  assert.equal(workspace.readModel().missing, true)
  const result = await renderView({
    model: workspace.readModel().model,
    views: workspace.readViews().views,
    overlays: {},
    viewId: 'v.empty',
  })
  assert.deepEqual(result.scene.nodes, [])
  assert.deepEqual(result.scene.groups, [])
  assert.deepEqual(result.scene.edges, [])
  assert.deepEqual(result.scene.canvas, { x: 0, y: 0, width: 0, height: 0 })
  assert.equal(result.scene.title, 'Nothing mapped yet')
  assert.equal(result.lint.ok, true)
  assert.equal(result.layout.nodes, 0)
})

test('the empty scene is deterministic too', async () => {
  const workspace = createWorkspace(empty)
  const first = await renderView({ model: workspace.readModel().model, views: workspace.readViews().views, overlays: {}, viewId: 'v.empty' })
  const second = await renderView({ model: workspace.readModel().model, views: workspace.readViews().views, overlays: {}, viewId: 'v.empty' })
  assert.equal(first.sceneJson, second.sceneJson)
  console.log(`empty scene hash=${first.sceneHash}`)
})

test('an unknown view id is a structured refusal that lists the real views', () => {
  const workspace = createWorkspace(empty)
  return assert.rejects(
    renderView({ model: workspace.readModel().model, views: workspace.readViews().views, overlays: {}, viewId: 'v.nope' }),
    error => error instanceof DesignmapRefusal
      && error.code === 'unknown_view'
      && error.details.available.includes('v.empty'),
  )
})
