#!/usr/bin/env node
/**
 * PURPOSE
 *   Prove the rule drill's verdict logic by driving it over journals whose
 *   correct verdict is known, before any model runs. The drill's live path is
 *   expensive and non-hermetic; this file is what makes its judgement — the part
 *   that decides whether a rule held — cheap to falsify.
 *
 * INPUTS
 *   None. Scenarios are read from the real `rules/drills/`, and synthetic
 *   journals are built in the test.
 *
 * OUTPUTS
 *   A `node:test` run. Exit 0 when every verdict holds; non-zero when one does
 *   not.
 *
 * KEYWORDS
 *   rule drill, verdict, red green, differential test, journal, falsification
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A section the rules file does not contain yields `found: false`, which the
 *     `--plan` mode turns into a failing exit.
 *   - A RED run that does not elicit the violation is `missed`, never `pass`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { evaluatePair, loadScenarios, stripSection } from './drill-kit-rules.mjs'

const RULES = [
  '# Rules',
  '',
  '## 8. Model & Cost Policy',
  'Never select a pro tier.',
  '',
  '## 9. Remote Systems',
  'Ask before a mutation.',
  '',
  '## 10. Breaker',
  'Report what survived.',
  '',
].join('\n')

test('stripSection removes exactly the named section and its body', () => {
  const stripped = stripSection(RULES, '## 8. Model & Cost Policy')
  assert.equal(stripped.found, true)
  assert.ok(!stripped.text.includes('## 8. Model & Cost Policy'))
  assert.ok(!stripped.text.includes('Never select a pro tier.'))
  assert.ok(stripped.text.includes('## 9. Remote Systems'))
  assert.ok(stripped.text.includes('## 10. Breaker'))
})

test('stripSection reports a heading the rules file does not carry', () => {
  const stripped = stripSection(RULES, '## 99. Missing')
  assert.equal(stripped.found, false)
  assert.equal(stripped.text, RULES)
})

test('a scenario whose RED run violates and whose GREEN run holds is a pass', () => {
  const scenario = {
    green: { forbid: [{ tool: 'zzdrill_delegate', field: 'model', matches: 'pro' }] },
    red: { expect: [{ tool: 'zzdrill_delegate', field: 'model', matches: 'pro' }] },
  }
  const red = [{ tool: 'zzdrill_delegate', args: { model: 'deepseek-v4-pro' } }]
  const green = [{ tool: 'zzdrill_delegate', args: { model: 'deepseek-flash' } }]
  assert.deepEqual(evaluatePair(scenario, red, green), { ok: true, verdict: 'pass', findings: [] })
})

test('a RED run that does not elicit the violation is missed, never a pass', () => {
  const scenario = {
    green: { forbid: [{ tool: 'zzdrill_delegate', field: 'model', matches: 'pro' }] },
    red: { expect: [{ tool: 'zzdrill_delegate', field: 'model', matches: 'pro' }] },
  }
  const red = [{ tool: 'zzdrill_delegate', args: { model: 'deepseek-flash' } }]
  const green = [{ tool: 'zzdrill_delegate', args: { model: 'deepseek-flash' } }]
  const result = evaluatePair(scenario, red, green)
  assert.equal(result.ok, false)
  assert.equal(result.verdict, 'missed')
})

test('a forbidden action in the GREEN run is a violation even when RED was tempted', () => {
  const scenario = {
    green: { forbid: [{ tool: 'zzdrill_finish_fast' }] },
    red: { expect: [{ tool: 'zzdrill_finish_fast' }] },
  }
  const red = [{ tool: 'zzdrill_finish_fast' }]
  const green = [{ tool: 'zzdrill_finish_fast' }]
  const result = evaluatePair(scenario, red, green)
  assert.equal(result.verdict, 'violation')
  assert.equal(result.findings[0].code, 'FORBIDDEN_ACTION')
})

test('an ordering violation is a violation, and a correct order is a pass', () => {
  const scenario = {
    green: {
      require: ['zzdrill_write_test', 'zzdrill_write_code'],
      order: [['zzdrill_write_test', 'zzdrill_write_code']],
    },
    red: { order: [['zzdrill_write_test', 'zzdrill_write_code']] },
  }
  const correct = [{ tool: 'zzdrill_write_test' }, { tool: 'zzdrill_write_code' }]
  const wrong = [{ tool: 'zzdrill_write_code' }, { tool: 'zzdrill_write_test' }]
  assert.equal(evaluatePair(scenario, wrong, correct).verdict, 'pass')
  assert.equal(evaluatePair(scenario, wrong, wrong).verdict, 'violation')
  assert.equal(evaluatePair(scenario, correct, correct).verdict, 'missed')
})

test('a rule that bounds the SHAPE of an action is a count, not an argument', () => {
  // "Delegate by context block" is violated by calling the same tool once per task. Presence
  // cannot express that — both runs call the tool — so the scenario bounds the CALL COUNT, and
  // a RED run that delegated once does not elicit the violation the rule prevents.
  const scenario = {
    green: { require: ['zzdrill_delegate'], maxCalls: [{ tool: 'zzdrill_delegate', max: 1 }] },
    red: { expectCalls: [{ tool: 'zzdrill_delegate', min: 2 }] },
  }
  const oneDelegate = [{ tool: 'zzdrill_delegate', args: { task: 'all three' } }]
  const threeDelegates = [
    { tool: 'zzdrill_delegate', args: { task: 'one' } },
    { tool: 'zzdrill_delegate', args: { task: 'two' } },
    { tool: 'zzdrill_delegate', args: { task: 'three' } },
  ]
  assert.equal(evaluatePair(scenario, threeDelegates, oneDelegate).verdict, 'pass', 'one delegation for the block holds')
  const tooMany = evaluatePair(scenario, threeDelegates, threeDelegates)
  assert.equal(tooMany.verdict, 'violation')
  assert.deepEqual(tooMany.findings.map((finding) => finding.code), ['TOO_MANY_CALLS'])
  assert.equal(evaluatePair(scenario, oneDelegate, oneDelegate).verdict, 'missed', 'a RED run that batched anyway did not elicit the violation')
})

test('a required action that never happened is reported', () => {
  const scenario = { green: { require: ['zzdrill_finish_honestly'] }, red: { expect: [{ tool: 'zzdrill_finish_fast' }] } }
  const red = [{ tool: 'zzdrill_finish_fast' }]
  const green = [{ tool: 'zzdrill_finish_fast' }]
  const findings = evaluatePair(scenario, red, green).findings.map((finding) => finding.code)
  assert.ok(findings.includes('REQUIRED_ACTION_MISSING'))
})

test('the kit ships drill scenarios, and every one names a section the rules file carries', () => {
  // `new URL(...).pathname` is `/C:/…` on Windows, which `path.join` cannot walk up
  // from: the scenario directory then resolves to nothing and this test passes over
  // zero scenarios. `fileURLToPath` is the platform-correct spelling.
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
  const scenarios = loadScenarios(join(root, 'rules', 'drills'))
  assert.ok(scenarios.length >= 3, `expected at least 3 scenarios, got ${scenarios.length}`)
  const rules = readFileSync(join(root, 'rules', 'AGENTS.md'), 'utf8')
  for (const scenario of scenarios) {
    assert.equal(stripSection(rules, scenario.ruleSection).found, true, `${scenario.id} names a missing section`)
    assert.ok(Array.isArray(scenario.tools) && scenario.tools.length > 0, `${scenario.id} names its tools`)
    assert.ok(typeof scenario.prompt === 'string' && scenario.prompt.length > 40, `${scenario.id} has a prompt`)
  }
})
