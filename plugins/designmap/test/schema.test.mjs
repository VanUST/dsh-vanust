/**
 * PROOF:
 * Behavior: a model or an agent op that carries geometry or colour is refused by the
 *   zod strict schemas with the exact path of the offending key (INV-NO-GEO, FR-2);
 *   a valid document is accepted with its defaults filled in.
 * Fails when: a schema is a plain `z.object` (silently strips x/y/fill instead of
 *   rejecting), an op's `value` is not validated per kind, or unknown keys are only
 *   mentioned in a message instead of a path.
 * Production path: src/schema.mjs parseModel/parseViews/parseOps -> src/apply.mjs
 *   applyOps, and every tool/M3 entry point that validates before writing.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseModel, parseOps, parseViews, DesignmapRefusal, sceneSchema } from '../src/schema.mjs'
import { renderView } from '../src/render.mjs'

const validNode = { id: 'svc.a', type: 'service', label: 'A', group: null, source: null }

test('a model node carrying x/y is refused with paths ["nodes",1,"x"] and ["nodes",1,"y"]', () => {
  try {
    parseModel({
      schemaVersion: 1,
      groups: [],
      nodes: [validNode, { ...validNode, id: 'svc.b', x: 10, y: 20 }],
      edges: [],
    })
    assert.fail('expected a refusal')
  } catch (error) {
    assert.ok(error instanceof DesignmapRefusal)
    assert.equal(error.code, 'invalid_model')
    const paths = error.details.issues.map(issue => issue.path)
    assert.deepEqual(paths, [['nodes', 1, 'x'], ['nodes', 1, 'y']])
  }
})

test('an op whose node value carries x/y/fill is refused with paths under ["ops",0,"value"]', () => {
  try {
    parseOps({ ops: [{ kind: 'node', action: 'upsert', value: { ...validNode, x: 10, y: 20, fill: '#fff' } }] })
    assert.fail('expected a refusal')
  } catch (error) {
    assert.equal(error.code, 'invalid_ops')
    assert.deepEqual(error.details.issues.map(issue => issue.path), [
      ['ops', 0, 'value', 'x'],
      ['ops', 0, 'value', 'y'],
      ['ops', 0, 'value', 'fill'],
    ])
    assert.deepEqual(error.details.issues.map(issue => issue.key), ['x', 'y', 'fill'])
  }
})

test('a views document with an unknown key is refused with its path', () => {
  try {
    parseViews({ schemaVersion: 1, views: [{ id: 'v.a', level: 'context', zoom: 2 }] })
    assert.fail('expected a refusal')
  } catch (error) {
    assert.equal(error.code, 'invalid_views')
    assert.deepEqual(error.details.issues.map(issue => issue.path), [['views', 0, 'zoom']])
  }
})

test('a valid model is accepted and defaults are materialised', () => {
  const model = parseModel({ schemaVersion: 1, nodes: [validNode], edges: [{ id: 'e.a.a', from: 'svc.a', to: 'svc.a', kind: 'sync', label: 'self' }] })
  assert.deepEqual(model.groups, [])
  assert.deepEqual(model.nodes[0], validNode)
  assert.equal(model.edges[0].label, 'self')
})

test('an op remove without id and an op upsert without value are refused at the op', () => {
  try {
    parseOps({ ops: [{ kind: 'node', action: 'remove' }] })
    assert.fail('expected a refusal')
  } catch (error) {
    assert.deepEqual(error.details.issues.map(issue => issue.path), [['ops', 0, 'id']])
  }
  try {
    parseOps({ ops: [{ kind: 'edge', action: 'upsert' }] })
    assert.fail('expected a refusal')
  } catch (error) {
    assert.deepEqual(error.details.issues.map(issue => issue.path), [['ops', 0, 'value']])
  }
})

test('the scene contract refuses an invented colour field', async () => {
  const result = await renderView({
    model: { schemaVersion: 1, groups: [], nodes: [validNode], edges: [] },
    views: { schemaVersion: 1, views: [{ id: 'v.a', title: 'A', level: 'context', direction: 'LR', include: [], parent: null }] },
    overlays: {},
    viewId: 'v.a',
  })
  assert.equal(sceneSchema.safeParse(result.scene).success, true)
  const invented = JSON.parse(JSON.stringify(result.scene))
  invented.nodes[0].fill = '#fff'
  assert.equal(sceneSchema.safeParse(invented).success, false)
})
