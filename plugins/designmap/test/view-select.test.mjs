/**
 * PROOF:
 * Behavior: a view draws exactly its selected nodes — `include` globs filter node ids,
 *   `parent` scopes a drill-down to one group, and an edge crossing the view boundary is
 *   dropped rather than reported as dangling (SCENE-CONTRACT "Empty and absent states",
 *   FR-1 views).
 * Fails when: an include pattern leaks a node outside the view, a parent view draws the
 *   whole model, or a boundary-crossing edge makes render refuse.
 * Production path: src/render.mjs selectView/matchesPattern -> renderView.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderView, selectView, matchesPattern } from '../src/render.mjs'

const model = {
  schemaVersion: 1,
  groups: [{ id: 'grp.checkout', label: 'Checkout' }],
  nodes: [
    { id: 'svc.checkout.api', type: 'service', label: 'API', group: 'grp.checkout', source: null },
    { id: 'svc.checkout.worker', type: 'worker', label: 'Worker', group: 'grp.checkout', source: null },
    { id: 'db.orders', type: 'datastore', label: 'Orders', group: null, source: null },
    { id: 'ext.stripe', type: 'external', label: 'Stripe', group: null, source: null },
  ],
  edges: [
    { id: 'e.api.worker', from: 'svc.checkout.api', to: 'svc.checkout.worker', kind: 'async', label: 'reserve' },
    { id: 'e.api.db', from: 'svc.checkout.api', to: 'db.orders', kind: 'data', label: 'reads' },
    { id: 'e.db.stripe', from: 'db.orders', to: 'ext.stripe', kind: 'sync', label: 'charge' },
  ],
}

const contexts = [
  { id: 'v.all', level: 'context', direction: 'LR', include: [], parent: null },
  { id: 'v.svc', level: 'component', direction: 'LR', include: ['svc.*'], parent: null },
  { id: 'v.group', level: 'component', direction: 'TB', include: [], parent: 'grp.checkout' },
  { id: 'v.none', level: 'flow', direction: 'LR', include: ['nomatch.*'], parent: null },
]

test('wildcards are the only pattern syntax', () => {
  assert.equal(matchesPattern('svc.*', 'svc.checkout.api'), true)
  assert.equal(matchesPattern('svc.*', 'db.orders'), false)
  assert.equal(matchesPattern('*', 'anything.at.all'), true)
  assert.equal(matchesPattern('svc.checkout.api', 'svc.checkout.api'), true)
  assert.equal(matchesPattern('svc.*', 'svcXcheckout.api'), false)
})

test('include and parent select the view subset and drop boundary-crossing edges', () => {
  const all = selectView(model, contexts[0])
  assert.equal(all.nodes.length, 4)
  assert.equal(all.edges.length, 3)

  const svc = selectView(model, contexts[1])
  assert.deepEqual(svc.nodes.map(node => node.id), ['svc.checkout.api', 'svc.checkout.worker'])
  assert.deepEqual(svc.edges.map(edge => edge.id), ['e.api.worker'])
  assert.deepEqual(svc.groups.map(group => group.id), ['grp.checkout'])

  const grouped = selectView(model, contexts[2])
  assert.deepEqual(grouped.nodes.map(node => node.id), ['svc.checkout.api', 'svc.checkout.worker'])
  assert.deepEqual(grouped.edges.map(edge => edge.id), ['e.api.worker'])
})

test('a view with no matching nodes renders an empty scene, not a refusal', async () => {
  const views = { schemaVersion: 1, views: contexts }
  const result = await renderView({ model, views, overlays: {}, viewId: 'v.none' })
  assert.deepEqual(result.scene.nodes, [])
  assert.deepEqual(result.scene.edges, [])
  assert.equal(result.scene.viewId, 'v.none')
})

test('the all-nodes view renders every edge that stays inside it', async () => {
  const views = { schemaVersion: 1, views: contexts }
  const result = await renderView({ model, views, overlays: {}, viewId: 'v.all' })
  assert.equal(result.scene.nodes.length, 4)
  assert.equal(result.scene.edges.length, 3)
})
