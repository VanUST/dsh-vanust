/*
PROOF: a local fix is L0 — no record, no case per requirement, no delegation, done inline
Behavior: ANALYSIS_POLICY names the L0 local edit and its exemptions and keeps L0 away from
  contract/architecture/data changes; the delegation gate still answers L0 without analysisId and
  refuses L1/L2 that name no ready record.
Fails when: the policy loses the L0 local-edit wording, L0 starts demanding a record, or an L1/L2
  delegation without a record is let through.
Production path: plugins/analysis/analysis.mjs (ANALYSIS_POLICY) and plugins/analysis/store.mjs
  (createService().gate), which the orchestrator's delegate_task calls before a child starts.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ANALYSIS_POLICY } from '../analysis.mjs'
import { createService } from '../store.mjs'

const service = () => createService({}, { warn() {}, info() {} })
const control = process.env.CASE_NEGATIVE_CONTROL ?? ''

test('negative control expect-pre-fix keeps the vague L0 sentence', () => {
  if (control !== 'expect-pre-fix') return
  assert.match(ANALYSIS_POLICY, /An L0 question or a local fix needs none/)
})


test('the analysis policy names the L0 local edit and what it skips', () => {
  assert.match(ANALYSIS_POLICY, /L0 local edit/i)
  assert.match(ANALYSIS_POLICY, /inline/i)
  assert.match(ANALYSIS_POLICY, /no Analysis Record/i)
  assert.match(ANALYSIS_POLICY, /no case per requirement/i)
  assert.match(ANALYSIS_POLICY, /no delegation/i)
  assert.match(ANALYSIS_POLICY, /contract, the architecture or the data/i)
  assert.doesNotMatch(ANALYSIS_POLICY, /An L0 question or a local fix needs none/)
})

test('L0 passes without an analysisId; L1 and L2 without a record are refused', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'analysis-l0-'))
  const gate = service().gate
  const l0 = gate(cwd, { changeClass: 'L0' })
  assert.equal(l0.ok, true, JSON.stringify(l0))
  assert.equal(l0.analysisRequired, false)
  const l1 = gate(cwd, { changeClass: 'L1' })
  assert.equal(l1.ok, false)
  assert.equal(l1.code, 'analysis_required')
  const l2 = gate(cwd, { changeClass: 'L2' })
  assert.equal(l2.ok, false)
  assert.equal(l2.code, 'analysis_required')
  const unclassified = gate(cwd, {})
  assert.equal(unclassified.ok, false, 'an unclassified write-capable delegation is gated like L1')
  assert.equal(unclassified.code, 'analysis_required')
  const unknown = gate(cwd, { changeClass: 'L1', initiative: 'no-such-record' })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.code, 'analysis_required')
})
