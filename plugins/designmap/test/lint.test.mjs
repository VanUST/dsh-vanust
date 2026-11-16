/**
 * PROOF:
 * Behavior: every rule in the lint table fires from a seeded fixture at its stated
 *   severity; error rules make render refuse with the findings attached, warning and
 *   info rules still render the scene (FR-6, SCENE-CONTRACT refusal policy).
 * Fails when: a rule is renamed without the table changing, a severity drifts, a
 *   model-level error is swallowed into a successful render, or a warning blocks the
 *   view.
 * Production path: src/lint.mjs lintModel/lintScene/summariseLint -> src/render.mjs
 *   renderView refusal branch; fixtures fixtures/lint-cases.mjs.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderView } from '../src/render.mjs'
import { findByRule, lintScene, summariseLint } from '../src/lint.mjs'
import { DesignmapRefusal } from '../src/schema.mjs'
import { lintCases, nonFiniteScene } from '../fixtures/lint-cases.mjs'

for (const entry of lintCases) {
  test(`${entry.rule} fires at severity ${entry.severity}: ${entry.name}`, async () => {
    const run = renderView({
      model: entry.model,
      views: entry.views,
      overlays: entry.overlays ?? {},
      staleNodeIds: entry.staleNodeIds ?? [],
      viewId: entry.views.views[0].id,
    })
    if (entry.expectsRefusal === true) {
      await assert.rejects(run, error => {
        assert.ok(error instanceof DesignmapRefusal, 'expected a DesignmapRefusal')
        const matching = findByRule(error.details.findings, entry.rule)
        assert.equal(matching.length >= 1, true, `expected a ${entry.rule} finding in the refusal`)
        assert.equal(matching[0].severity, entry.severity)
        return true
      })
      return
    }
    const result = await run
    const matching = findByRule(result.lint.findings, entry.rule)
    assert.equal(matching.length >= 1, true, `expected ${entry.rule} in ${JSON.stringify(result.lint.rules)}`)
    assert.equal(matching[0].severity, entry.severity)
  })
}

test('non_finite_geometry is an error in the defensive scene lint', () => {
  const lint = summariseLint(lintScene(nonFiniteScene))
  const finding = findByRule(lint.findings, 'non_finite_geometry')
  assert.equal(finding.length, 1)
  assert.equal(finding[0].severity, 'error')
  assert.equal(lint.ok, false)
})
