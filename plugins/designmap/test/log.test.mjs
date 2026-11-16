/**
 * PROOF:
 * Behavior: the JSONL logger emits the documented designmap events, including
 *   `layout.done {ms, nodes}` and `render.done {sceneHash, bytes}`, and never breaks
 *   serialization on NaN, undefined or a circular object (FR-9, NFR-1).
 * Fails when: an event is renamed, layout.done lacks the timing the acceptance reads,
 *   or a log payload with NaN/undefined throws instead of serializing to null.
 * Production path: src/log.mjs createLogger/sanitize, called from src/render.mjs and
 *   src/apply.mjs (model.diff).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderView } from '../src/render.mjs'
import { applyOps } from '../src/apply.mjs'
import { createLogger, sanitize, EVENTS } from '../src/log.mjs'

const model = {
  schemaVersion: 1,
  groups: [],
  nodes: [
    { id: 'svc.a', type: 'service', label: 'A', group: null, source: null },
    { id: 'db.b', type: 'datastore', label: 'B', group: null, source: null },
  ],
  edges: [{ id: 'e.a.b', from: 'svc.a', to: 'db.b', kind: 'data', label: 'reads' }],
}
const views = { schemaVersion: 1, views: [{ id: 'v.log', title: 'Log', level: 'context', direction: 'LR', include: [], parent: null }] }

test('render logs layout.done, merge and lint and render.done as parseable JSONL', async () => {
  const lines = []
  const logger = createLogger(line => lines.push(line))
  const result = await renderView({ model, views, overlays: { ghost: { x: 1 } }, viewId: 'v.log', logger })

  const names = logger.events.map(event => event.event)
  for (const event of ['layout.done', 'merge.applied', 'merge.gc', 'lint.result', 'render.done']) {
    assert.ok(names.includes(event), `missing ${event}; got ${names.join(',')}`)
  }
  assert.deepEqual(EVENTS.includes('layout.done'), true)
  const layoutDone = logger.find('layout.done')
  assert.equal(layoutDone.nodes, 2)
  assert.equal(typeof layoutDone.ms, 'number')
  const renderDone = logger.find('render.done')
  assert.equal(renderDone.sceneHash, result.sceneHash)
  assert.equal(renderDone.bytes, result.bytes)
  for (const line of lines) {
    assert.doesNotThrow(() => JSON.parse(line))
  }
})

test('apply logs model.diff with aggregated counts', () => {
  const logger = createLogger()
  applyOps({
    model,
    views,
    ops: [{ kind: 'node', action: 'upsert', value: { id: 'queue.c', type: 'queue', label: 'C', group: null, source: null } }],
    logger,
  })
  const diff = logger.find('model.diff')
  assert.equal(diff.counts.added, 1)
  assert.equal(diff.counts.removed, 0)
})

test('the sanitizer turns NaN, undefined and cycles into JSON-safe values', () => {
  const circular = { name: 'loop' }
  circular.self = circular
  const safe = sanitize({ nan: Number.NaN, missing: undefined, infinite: Infinity, circular })
  assert.equal(safe.nan, null)
  assert.equal(safe.missing, null)
  assert.equal(safe.infinite, null)
  assert.equal(safe.circular.self, '[circular]')
  assert.doesNotThrow(() => JSON.stringify(safe))
})

test('a throwing log sink cannot fail the render', async () => {
  const logger = createLogger(() => {
    throw new Error('disk full')
  })
  const result = await renderView({ model, views, overlays: {}, viewId: 'v.log', logger })
  assert.equal(result.scene.nodes.length, 2)
})
