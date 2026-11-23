/*
PROOF: one reviewer's brief carries every reviewed task's own contract, and the verdict is per task
Behavior: reviewTargetBlock renders one task's contract (id, title, objective, scope, non-scope,
  acceptance, verification level, criteria, the implementer's result and evidence) so a batch of
  tasks lands in one brief without a merged story; two tasks render two blocks with their own ids;
  a task with no result says nothing it did not claim.
Fails when: the block drops the criteria or the result, or two tasks collapse into one block.
Production path: plugins/orchestrator/orchestrator.mjs (reviewTargetBlock, used by delegate_review).
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reviewTargetBlock } from '../orchestrator.mjs'

const target = (overrides = {}) => ({
  id: 'task-1',
  title: 'Sum the numbers',
  objective: 'the CLI adds every argument',
  scope: ['src/sum.mjs'],
  nonScope: ['src/format.mjs'],
  acceptance: [{ text: 'the sum of 1 2 3 is 6' }],
  verification: 'independent',
  criteria: [{ id: 'AC-1', text: 'no argument is dropped' }],
  result: { summary: 'fixed the slice', evidence: ['node sum.mjs 1 2 3 -> 6'] },
  ...overrides,
})

test('one block carries the task contract, the claim and its evidence', () => {
  const block = reviewTargetBlock(target())
  assert.match(block, /### task-1: Sum the numbers/)
  assert.match(block, /Objective: the CLI adds every argument/)
  assert.match(block, /Scope:\n  - src\/sum\.mjs/)
  assert.match(block, /Non-scope:\n  - src\/format\.mjs/)
  assert.match(block, /Acceptance:\n  - the sum of 1 2 3 is 6/)
  assert.match(block, /Verification level: independent/)
  assert.match(block, /Criteria:\n  - AC-1: no argument is dropped/)
  assert.match(block, /Result \(the implementer's claim\): fixed the slice/)
  assert.match(block, /Evidence \(the implementer's\):\n  - node sum\.mjs 1 2 3 -> 6/)
})

test('two tasks render two blocks, each with its own id and criteria', () => {
  const second = target({ id: 'task-2', title: 'Format the sum', criteria: [{ id: 'AC-9', text: 'two decimals' }], verification: 'proof' })
  const text = [target(), second].map(reviewTargetBlock).join('\n\n')
  assert.match(text, /### task-1:/)
  assert.match(text, /### task-2: Format the sum/)
  assert.match(text, /AC-1: no argument is dropped/)
  assert.match(text, /AC-9: two decimals/)
  assert.match(text, /Verification level: proof/)
})

test('a task with no result claims nothing beyond its contract', () => {
  const block = reviewTargetBlock(target({ result: undefined }))
  assert.doesNotMatch(block, /Result \(the implementer's claim\)/)
  assert.doesNotMatch(block, /Evidence \(the implementer's\)/)
})
