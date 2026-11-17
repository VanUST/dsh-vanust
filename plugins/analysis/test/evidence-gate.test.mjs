/*
PROOF: a REQ cannot close without a red→green TEST
Behavior: analysis_upsert with a requirement marked proven refuses with evidence_required when
  the REQ has no TEST whose evidenceRefs contain both a red failure and a green pass (the record
  is not written and the REQ keeps its status); a TEST with the pair lets the upsert through and
  the REQ becomes done. With the gate switched off (the old bytes, `enforce: false`) the same
  input writes the record — the red-first control.
Fails when: a proven requirement closes without evidence, a green-only test satisfies the gate,
  or the gate writes the record on refusal.
Production path: plugins/analysis/analysis.mjs (analysis_upsert) and plugins/analysis/mirror.mjs
  (precheckEvidence), with the ccProjectState register and the test-cases TEST rows.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStateService } from '../../project-state/lib/core.mjs'
import { apply } from '../analysis.mjs'
import { precheckEvidence } from '../mirror.mjs'

const clock = () => '2026-01-07T00:00:00.000Z'

const requirement = (overrides = {}) => ({
  id: 'FR-1',
  kind: 'FR',
  text: 'A REQ closes only on a red-green pair',
  acceptance: ['a green-only test does not close it'],
  status: 'proven',
  ...overrides,
})

async function harness() {
  const cwd = await mkdtemp(join(tmpdir(), 'analysis-evidence-'))
  const core = createStateService({ cwd, now: clock })
  const tools = new Map()
  const handlers = []
  const ctx = {
    logger: { warn() {}, info() {} },
    effect(fn) { fn(); return () => {} },
    provide() { return () => {} },
    get(name) { return name === 'ccProjectState' ? core : undefined },
    on(event, handler) { if (event === 'agent/created') handlers.push(handler) },
  }
  ctx.root = ctx
  apply(ctx)
  const agent = {
    session: { id: 'session-1', header: { cwd, delegationDepth: 0 } },
    ctx: { tools: { register: (tool) => tools.set(tool.name, tool), guard() {} }, systemPrompt: { section() {} } },
  }
  for (const handler of handlers) handler({ agent })
  return { cwd, core, tool: tools.get('analysis_upsert'), exec: { agent } }
}

test('red-first control: with the gate off, the same proven requirement closes', async () => {
  const { cwd, core } = await harness()
  const verdict = await precheckEvidence(core, { cwd, initiative: 'evidence', requirements: [requirement()], enforce: false })
  assert.equal(verdict.ok, true)
  assert.equal(verdict.skipped, 'not-enforced')
})

test('a proven requirement without a TEST is refused and nothing is written', async () => {
  const { cwd, tool, exec } = await harness()
  const result = await tool.execute({ initiative: 'evidence', patch: { requirements: [requirement()] } }, exec)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'evidence_required')
  const files = await readdir(join(cwd, 'docs', 'analysis')).catch(() => [])
  assert.deepEqual(files, [])
})

test('a green-only TEST does not satisfy the gate', async () => {
  const { cwd, core, tool, exec } = await harness()
  const req = await core.create('req', { title: requirement().text, criteria: ['c'], analysisRef: { initiative: 'evidence', requirementId: 'FR-1' } })
  await core.create('test', { title: 'green only', reqId: req.id, authorRole: 'orchestrator', evidenceRefs: ['run-1:green:pass'] })
  const result = await tool.execute({ initiative: 'evidence', patch: { requirements: [requirement()] } }, exec)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'evidence_required')
})

test('a TEST with a red failure and a green pass closes the REQ', async () => {
  const { cwd, core, tool, exec } = await harness()
  const req = await core.create('req', { title: requirement().text, criteria: ['c'], analysisRef: { initiative: 'evidence', requirementId: 'FR-1' } })
  await core.create('test', { title: 'red then green', reqId: req.id, authorRole: 'orchestrator', evidenceRefs: ['run-1:red:fail', 'run-2:green:pass'] })
  const result = await tool.execute({ initiative: 'evidence', patch: { requirements: [requirement()] } }, exec)
  assert.equal(result.ok, true, JSON.stringify(result))
  const after = await core.get(req.id)
  assert.equal(after.frontmatter.status, 'done')
  const tests = await core.list('test')
  assert.equal(tests.rows.length, 1, 'the TEST is not duplicated by the mirror')
})
