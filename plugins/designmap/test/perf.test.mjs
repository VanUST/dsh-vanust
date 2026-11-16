/**
 * PROOF:
 * Behavior: a seeded 25-node view lays out, merges and lints inside NFR-3's 1500 ms
 *   budget, and the JSONL log carries `layout.done {ms, nodes}` plus `render.done`.
 * Fails when: layout time grows past the budget for a normal view, the logger drops
 *   the layout event or logs a non-numeric ms, or the pipeline does not emit
 *   render.done with the scene hash.
 * Production path: src/render.mjs renderView -> src/layout.mjs layoutView
 *   onLayoutDone -> src/log.mjs createLogger; fixture fixtures/perf.mjs.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderView } from '../src/render.mjs'
import { createLogger } from '../src/log.mjs'
import { perfFixture } from '../fixtures/perf.mjs'

const BUDGET_MS = 1500

test('the seeded 25-node view stays inside the 1500 ms budget with layout.done in the log', async () => {
  const measurements = []
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const logger = createLogger()
    const started = performance.now()
    const result = await renderView({
      model: perfFixture.model,
      views: perfFixture.views,
      overlays: {},
      viewId: 'v.flow',
      logger,
    })
    const totalMs = performance.now() - started
    measurements.push({ layoutMs: result.layout.ms, totalMs: Math.round(totalMs * 100) / 100 })
    assert.equal(result.scene.nodes.length, 25)
    const layoutDone = logger.find('layout.done')
    assert.ok(layoutDone, 'layout.done must be logged')
    assert.equal(layoutDone.nodes, 25)
    assert.equal(typeof layoutDone.ms, 'number')
    assert.ok(Number.isFinite(layoutDone.ms))
    assert.ok(layoutDone.ms <= BUDGET_MS, `layout.done.ms ${layoutDone.ms} over budget`)
    assert.ok(totalMs <= BUDGET_MS, `render total ${totalMs} over budget`)
    assert.ok(logger.find('render.done')?.sceneHash?.startsWith('sha256:'))
    assert.equal(result.lint.ok, true)
  }
  console.log(`perf 25-node runs ${JSON.stringify(measurements)} budget=${BUDGET_MS}ms`)
})
