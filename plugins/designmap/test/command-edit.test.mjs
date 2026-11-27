/*
PROOF: the panel's Check and Fix reach the same store as the agent, through named command ops
Behavior: the /designmap command's `lint` op returns the readability report for one page; its
  `edit` op applies ONE repair operation and writes the page; an operation outside the repair
  set (page.delete, page.create) and an operation without a map op name are refused with
  invalid_operation and the page file is untouched; `tidy-page` and agent map_edit read the
  same file the panel saved.
Fails when: the panel grows a second write path with different semantics, a repair can delete
  a page, or lint reports one page while the panel shows another.
Production path: plugins/designmap/src/command.mjs (lint/edit) -> src/outline.mjs lintOutline
  and src/ops.mjs applyOp; called by client/host.js from the page editor.
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCommandHandler } from '../src/command.mjs'
import { emptyScene, readPage, writePage } from '../src/pages.mjs'
import { buildNode } from '../src/elements.mjs'

function harness(dir) {
  const handler = createCommandHandler({ hostFor: () => ({ service: {}, logger: null, designmapDir: dir }) })
  return async (op) => {
    const outcome = await handler({ agent: null, rawInput: JSON.stringify(op) })
    return { kind: outcome.kind, value: outcome.kind === 'success' ? JSON.parse(outcome.text) : outcome.text }
  }
}

function crowdedPage(dir) {
  const a = buildNode({ id: 'a', label: 'Checkout API', x: 40, y: 40 })
  const b = buildNode({ id: 'b', label: 'Orders DB', x: 60, y: 50 })
  const scene = emptyScene()
  scene.elements = [a.shape, a.text, b.shape, b.text]
  writePage(dir, 'checkout', scene)
}

test('lint finds the overlap and edit applies the repair it proposed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'designmap-command-edit-'))
  crowdedPage(dir)
  const call = harness(dir)

  const lint = await call({ op: 'lint', page: 'checkout' })
  assert.equal(lint.kind, 'success')
  assert.equal(lint.value.ok, true)
  const overlap = lint.value.findings.find((entry) => entry.code === 'node_overlap')
  assert.ok(overlap !== undefined)
  const repair = overlap.repair

  const fixed = await call({ op: 'edit', operation: { ...repair, page: 'checkout' } })
  assert.equal(fixed.kind, 'success')
  assert.equal(fixed.value.ok, true)
  assert.equal(fixed.value.action, 'node.move')
  const after = await call({ op: 'lint', page: 'checkout' })
  assert.equal(after.value.findings.some((entry) => entry.code === 'node_overlap'), false, 'the repair did not move the box')
})

test('a repair cannot leave the repair op set', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'designmap-command-edit-'))
  crowdedPage(dir)
  const call = harness(dir)

  const refused = await call({ op: 'edit', operation: { op: 'page.delete', page: 'checkout' } })
  assert.equal(refused.kind, 'error')
  assert.match(String(refused.value), /invalid_operation/)
  assert.equal(existsSync(join(dir, 'pages', 'checkout.excalidraw')), true, 'a refused repair deleted the page')

  const nameless = await call({ op: 'edit', operation: { page: 'checkout' } })
  assert.equal(nameless.kind, 'error')
  assert.match(String(nameless.value), /invalid_operation/)
})

test('the panel tidy and the agent layout read the same file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'designmap-command-edit-'))
  crowdedPage(dir)
  const call = harness(dir)
  const tidied = await call({ op: 'tidy-page', page: 'checkout' })
  assert.equal(tidied.kind, 'success')
  const after = readPage(dir, 'checkout').elements
  const left = after.find((entry) => entry.id === 'a')
  const right = after.find((entry) => entry.id === 'b')
  // Two unconnected boxes have the same rank, so the layout stacks them in one column; what
  // matters is that they no longer overlap and every element survived.
  const overlapX = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)
  const overlapY = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)
  assert.equal(overlapX > 0 && overlapY > 0, false, 'the two boxes still overlap')
  assert.equal(after.length, 4, 'tidy lost an element')
})
