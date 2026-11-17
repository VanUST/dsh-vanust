/*
PROOF: analysis requirements mirrored into the project state
Behavior: analysis_upsert with project-state mounted writes one REQ per requirement with
  analysisRef {initiative, requirementId} and acceptance criteria, updates the SAME REQ on a
  repeat upsert (no duplicate), refuses a requirement without acceptance before writing the
  record (req_criteria_required), refuses a new requirement that looks like an existing REQ with
  req_duplicate_candidates until allowDuplicate+duplicateReview, regenerates the projections so
  digest.md is non-empty and index.json carries the link, and behaves exactly as before when
  the core is absent.
Fails when: a repeat upsert creates a second REQ, a criteria-less requirement gets a REQ, a
  duplicate is accepted silently, or the old no-core path changes.
Production path: plugins/analysis/analysis.mjs (analysis_upsert) with plugins/analysis/mirror.mjs
  and the ccProjectState service of @cc/dsh-project-state.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStateService } from '../../project-state/lib/core.mjs'
import { apply } from '../analysis.mjs'

const clock = () => '2026-01-04T00:00:00.000Z'

async function hostWithCore() {
  const cwd = await mkdtemp(join(tmpdir(), 'analysis-mirror-'))
  const core = createStateService({ cwd, now: clock })
  const tools = new Map()
  const handlers = []
  const ctx = {
    logger: { warn() {}, info() {} },
    effect(fn) { fn(); return () => {} },
    provide() { return () => {} },
    get(name) {
      if (name === 'ccProjectState') return core
      return undefined
    },
    on(event, handler) { if (event === 'agent/created') handlers.push(handler) },
  }
  ctx.root = ctx
  apply(ctx)
  const agent = {
    session: { id: 'session-1', header: { cwd, delegationDepth: 0 } },
    ctx: { tools: { register: (tool) => tools.set(tool.name, tool), guard() {} }, systemPrompt: { section() {} } },
  }
  for (const handler of handlers) handler({ agent })
  return { cwd, core, tool: tools.get('analysis_upsert') }
}

const requirement = (overrides = {}) => ({
  id: 'FR-1',
  kind: 'FR',
  text: 'The context budget gate fails above 1.5x the declared allowance',
  acceptance: ['a budget above 1.5x exits 1', 'a budget above the table warns with exit 0'],
  status: 'planned',
  ...overrides,
})

async function upsert(tool, cwd, args) {
  return tool.execute(args, { agent: { session: { header: { cwd } } } })
}

test('a requirement becomes one REQ with analysisRef and criteria, and views are regenerated', async () => {
  const { cwd, tool } = await hostWithCore()
  const result = await upsert(tool, cwd, { initiative: 'budget-gate', patch: { requirements: [requirement()] } })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.reqMirror.ok, true, JSON.stringify(result.reqMirror))
  const mirrored = result.reqMirror.reqs.find((row) => row.requirementId === 'FR-1')
  assert.equal(mirrored.reqId, 'REQ-001')
  assert.equal(mirrored.action, 'created')
  const req = await readFile(join(cwd, 'state', 'req', 'REQ-001.md'), 'utf8')
  assert.match(req, /analysisRef:\n  initiative: budget-gate\n  requirementId: FR-1/)
  assert.match(req, /criteria: \[/)
  assert.match(req, /exits 1/)
  assert.match(req, /warns with exit 0/)
  assert.match(req, /status: proposed/)
  assert.match(req, /criteriaHash: [0-9a-f]{64}/)
  const digest = await readFile(join(cwd, 'state', 'views', 'digest.md'), 'utf8')
  assert.match(digest, /REQ-001/)
  assert.match(digest, /REQ 1 · TASK 0/)
  const index = JSON.parse(await readFile(join(cwd, 'state', 'views', 'index.json'), 'utf8'))
  assert.deepEqual(index.reqs.map((row) => row.id), ['REQ-001'])
})

test('a repeat upsert updates the same REQ and never creates a second one', async () => {
  const { cwd, tool } = await hostWithCore()
  const first = await upsert(tool, cwd, { initiative: 'budget-gate', patch: { requirements: [requirement()] } })
  assert.equal(first.ok, true)
  const second = await upsert(tool, cwd, {
    initiative: 'budget-gate',
    expectedRev: first.rev,
    patch: { requirements: [requirement({ text: 'Context budget gate (v2) fails above 1.5x', status: 'proven' })] },
  })
  assert.equal(second.ok, true, JSON.stringify(second))
  const reqs = await readdir(join(cwd, 'state', 'req'))
  assert.deepEqual(reqs, ['REQ-001.md'])
  const req = await readFile(join(cwd, 'state', 'req', 'REQ-001.md'), 'utf8')
  assert.match(req, /status: done/)
  assert.match(req, /revision: 2/)
  assert.equal(second.reqMirror.reqs[0].action, 'updated')
})

test('a requirement without acceptance is refused before the record is written', async () => {
  const { cwd, tool } = await hostWithCore()
  const result = await upsert(tool, cwd, { initiative: 'no-criteria', patch: { requirements: [requirement({ acceptance: [] })] } })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'req_criteria_required')
  const files = await readdir(join(cwd, 'docs', 'analysis')).catch(() => [])
  assert.deepEqual(files, [], 'no record and no REQ')
  const reqs = await readdir(join(cwd, 'state', 'req')).catch(() => [])
  assert.deepEqual(reqs, [])
})

test('a new requirement that looks like an existing REQ needs an explicit duplicate review', async () => {
  const { cwd, tool } = await hostWithCore()
  const first = await upsert(tool, cwd, { initiative: 'budget-gate', patch: { requirements: [requirement()] } })
  assert.equal(first.ok, true)
  const duplicate = await upsert(tool, cwd, {
    initiative: 'other-initiative',
    patch: { requirements: [requirement({ id: 'FR-9', text: 'The context budget gate must fail above 1.5x the declared allowance' })] },
  })
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.code, 'req_duplicate_candidates')
  assert.equal(duplicate.candidates[0].id, 'REQ-001')
  const reviewed = await upsert(tool, cwd, {
    initiative: 'other-initiative',
    allowDuplicate: true,
    duplicateReview: 'a separate initiative owns its own gate; the REQ belongs to this record',
    patch: { requirements: [requirement({ id: 'FR-9', text: 'The context budget gate must fail above 1.5x the declared allowance' })] },
  })
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed))
  assert.equal(reviewed.reqMirror.reqs[0].reqId, 'REQ-002')
})

test('without the project-state core the old analysis behaviour is unchanged', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'analysis-no-core-'))
  const tools = new Map()
  const handlers = []
  const ctx = {
    logger: { warn() {}, info() {} },
    effect(fn) { fn(); return () => {} },
    provide() { return () => {} },
    get() { return undefined },
    on(event, handler) { if (event === 'agent/created') handlers.push(handler) },
  }
  ctx.root = ctx
  apply(ctx)
  const agent = {
    session: { id: 'session-2', header: { cwd, delegationDepth: 0 } },
    ctx: { tools: { register: (tool) => tools.set(tool.name, tool), guard() {} }, systemPrompt: { section() {} } },
  }
  for (const handler of handlers) handler({ agent })
  const result = await tools.get('analysis_upsert').execute({ initiative: 'no-core', patch: { requirements: [requirement({ acceptance: [] })] } }, { agent: { session: { header: { cwd } } } })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.reqMirror, undefined)
})
