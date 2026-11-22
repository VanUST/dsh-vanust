/*
PROOF: every role's brief carries the same task contract, and a proof task renders none of it
Behavior: renderBrief appends a Task contract block with the verification level, what that level
  means, the criteria ids and texts, and the standing constraints; the block is the same for
  backend, tester and reviewer because it comes from the row, not from the role; a row with no
  level and no criteria renders no block (the pre-P2 brief is unchanged).
Fails when: the tester sees criteria the implementer does not, the level is missing from the brief,
  or an old task grows a block it never had.
Production path: plugins/orchestrator/orchestrator.mjs (contractBlock, renderBrief).
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contractBlock, renderBrief } from '../orchestrator.mjs'

const task = (overrides = {}) => ({
  id: 'task-1',
  title: 'The contract',
  role: 'BACKEND',
  objective: 'add the field',
  scope: ['src/a.mjs'],
  nonScope: ['src/b.mjs'],
  acceptance: [{ text: 'the field is returned' }],
  verification: 'independent',
  criteria: [{ id: 'AC-1', text: 'the response carries the field' }, { id: 'AC-2', text: 'the old field is gone' }],
  constraints: ['no new dependency'],
  ...overrides,
})

test('the contract block names the level, its meaning, the criteria and the constraints', () => {
  const block = contractBlock(task())
  assert.match(block, /## Task contract/)
  assert.match(block, /Verification level: independent/)
  assert.match(block, /every criterion/i)
  assert.match(block, /AC-1: the response carries the field/)
  assert.match(block, /AC-2: the old field is gone/)
  assert.match(block, /no new dependency/)
})

test('every role gets the same block, because it comes from the row', () => {
  const backend = renderBrief(task(), { role: 'BACKEND' })
  const tester = renderBrief(task(), { role: 'TESTER' })
  const reviewer = renderBrief(task(), { role: 'REVIEWER' })
  for (const brief of [backend, tester, reviewer]) {
    assert.match(brief, /## Task contract/)
    assert.match(brief, /Verification level: independent/)
    assert.match(brief, /AC-1: the response carries the field/)
  }
})

test('a proof task says its standard and owes no case', () => {
  const block = contractBlock(task({ verification: 'proof', criteria: [] }))
  assert.match(block, /Verification level: proof/)
  assert.match(block, /No case, no tester and no review/)
  assert.match(block, /Acceptance criteria: \(none stated\)/)
})

test('a row with no contract fields renders no block: the pre-P2 brief is unchanged', () => {
  const legacy = task({ verification: undefined, criteria: [], constraints: [] })
  assert.equal(contractBlock(legacy), '')
  assert.doesNotMatch(renderBrief(legacy, { role: 'BACKEND' }), /## Task contract/)
})
