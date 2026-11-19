/*
PROOF: delegation brief rendered from the register
Behavior: delegation_brief renders a PLANNED REQ (the status the register actually produces,
  `proposed`) verbatim (criteria with stable ids, related decisions, mandatory tests with
  commands, non-scope and the return format) and returns a briefHash; two renders on unchanged
  state are byte-identical; missing core/state refuses cold_start_required, an unknown,
  finished (`done`) or rejected REQ refuses feature_required and a REQ without criteria
  refuses criteria_missing; delegation_return maps a valid return and refuses
  brief_stale, return_unmapped and return_invalid; a worker session gets neither tool.
Fails when: the brief paraphrases a criterion, two renders differ, a refusal comes back ok, a
  stale/unmapped return is accepted, or a worker receives the tools.
Production path: plugins/delegation-brief/index.mjs (apply) with lib/brief.mjs, reading
  ccProjectState of @cc/dsh-project-state.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStateService } from '../../project-state/lib/core.mjs'
import { apply } from '../index.mjs'

const clock = () => '2026-01-08T00:00:00.000Z'

function host(core, preset = 'orchestrator') {
  const handlers = []
  const ctx = {
    logger: { warn() {}, info() {} },
    get(name) {
      if (name === 'ccProjectState') return core
      if (name === 'toolFamilies') return { presetFor: () => preset }
      return undefined
    },
    on(event, handler) { if (event === 'agent/created') handlers.push(handler) },
    root: null,
  }
  ctx.root = ctx
  return { ctx, handlers }
}

async function harness({ status = 'proposed', withCriteria = true } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'delegation-brief-'))
  const core = createStateService({ cwd, now: clock })
  const req = await core.create('req', {
    title: 'The context budget gate fails above 1.5x the declared allowance',
    criteria: withCriteria ? ['a budget above 1.5x exits 1', 'a budget above the table warns with exit 0'] : [],
    status,
  })
  const decision = await core.create('decision', { title: 'Count both numbers', body: 'Count tools and bytes', status: 'accepted' })
  await core.link(decision.id, req.id)
  const test = await core.create('test', { title: 'Gate is red', reqId: req.id, authorRole: 'orchestrator', command: 'node --test plugins/x', testPath: 'plugins/x/test.mjs', status: 'verified', evidenceRefs: ['run-1:red:fail', 'run-2:green:pass'] })
  await core.regenerateViews()
  const env = host(core)
  apply(env.ctx)
  const tools = new Map()
  const sections = []
  const agent = {
    session: { id: 'root-1', header: { cwd, delegationDepth: 0, agentPreset: 'orchestrator' } },
    ctx: { tools: { register: (tool) => tools.set(tool.name, tool) }, systemPrompt: { section: (value) => sections.push(value) } },
  }
  for (const handler of env.handlers) handler({ agent })
  return { cwd, core, req, decision, test, tools, sections, agent, env }
}

test('the brief renders the criteria verbatim with stable ids and every section', async () => {
  const { tools, req, decision, test, sections } = await harness()
  const result = await tools.get('delegation_brief').execute({ reqId: req.id, role: 'BACKEND', nonScope: ['tests/acceptance/'] }, { agent: { session: { header: { cwd: (await harness()).cwd } } } })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.match(result.text, new RegExp(`${req.id}-C01: a budget above 1\\.5x exits 1`))
  assert.match(result.text, new RegExp(`${req.id}-C02: a budget above the table warns with exit 0`))
  assert.match(result.text, new RegExp(`Requirement \\(verbatim from ${req.id}\\)`))
  assert.match(result.text, new RegExp(`- ${decision.id} \\[accepted\\]`))
  assert.match(result.text, new RegExp(`- ${test.id} \\[verified\\]`))
  assert.match(result.text, /command: node --test plugins\/x/)
  assert.match(result.text, /## Non-scope/)
  assert.match(result.text, /tests\/acceptance\//)
  assert.match(result.text, /## Return format/)
  assert.match(result.text, /return_unmapped/)
  assert.match(result.briefHash, /^[0-9a-f]{64}$/)
  assert.equal(sections.length, 1, 'one static section')
  assert.match(sections[0].text, /briefs are RENDERED/i)
})

test('two renders of the same state are byte-identical', async () => {
  const ctx = await harness()
  const first = await ctx.tools.get('delegation_brief').execute({ reqId: ctx.req.id, role: 'BACKEND', nonScope: ['a'] }, { agent: ctx.agent })
  const second = await ctx.tools.get('delegation_brief').execute({ reqId: ctx.req.id, role: 'BACKEND', nonScope: ['a'] }, { agent: ctx.agent })
  assert.equal(first.text, second.text)
  assert.equal(first.briefHash, second.briefHash)
})

test('missing core or state refuses cold_start_required', async () => {
  const noCore = host(undefined)
  apply(noCore.ctx)
  const tools = new Map()
  const agent = { session: { id: 'r', header: { cwd: '/tmp', agentPreset: 'orchestrator' } }, ctx: { tools: { register: (tool) => tools.set(tool.name, tool) }, systemPrompt: { section() {} } } }
  for (const handler of noCore.handlers) handler({ agent })
  const refused = await tools.get('delegation_brief').execute({ reqId: 'REQ-001' }, { agent })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'cold_start_required')
  const { cwd } = await harness()
  const empty = host(createStateService({ cwd: await mkdtemp(join(tmpdir(), 'no-state-')), now: clock }))
  apply(empty.ctx)
  const emptyTools = new Map()
  const emptyAgent = { session: { id: 'r2', header: { cwd: await mkdtemp(join(tmpdir(), 'no-state-')), agentPreset: 'orchestrator' } }, ctx: { tools: { register: (tool) => emptyTools.set(tool.name, tool) }, systemPrompt: { section() {} } } }
  for (const handler of empty.handlers) handler({ agent: emptyAgent })
  const noState = await emptyTools.get('delegation_brief').execute({ reqId: 'REQ-001' }, { agent: emptyAgent })
  assert.equal(noState.code, 'cold_start_required')
})

test('a planned REQ renders; unknown, finished and rejected REQs refuse feature_required; no criteria refuses criteria_missing', async () => {
  // PROOF: the gate names a status the register can hold. `analysis_upsert` writes `proposed`
  // for a planned requirement, never `accepted`; requiring `accepted` made the brief dead.
  const unknown = await harness()
  const missing = await unknown.tools.get('delegation_brief').execute({ reqId: 'REQ-404' }, { agent: unknown.agent })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'feature_required')
  const finished = await harness({ status: 'done' })
  const done = await finished.tools.get('delegation_brief').execute({ reqId: finished.req.id }, { agent: finished.agent })
  assert.equal(done.ok, false)
  assert.equal(done.code, 'feature_required')
  const rejectedEnv = await harness({ status: 'rejected' })
  const rejected = await rejectedEnv.tools.get('delegation_brief').execute({ reqId: rejectedEnv.req.id }, { agent: rejectedEnv.agent })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.code, 'feature_required')
  const bare = await harness({ withCriteria: false })
  const noCriteria = await bare.tools.get('delegation_brief').execute({ reqId: bare.req.id }, { agent: bare.agent })
  assert.equal(noCriteria.ok, false)
  assert.equal(noCriteria.code, 'criteria_missing')
})

test('delegation_return maps a valid return and refuses stale, unmapped and invalid ones', async () => {
  const ctx = await harness()
  const brief = await ctx.tools.get('delegation_brief').execute({ reqId: ctx.req.id }, { agent: ctx.agent })
  const ids = brief.criteria.map((criterion) => criterion.id)
  const returned = {
    status: 'done',
    criteria: [
      { id: ids[0], pass: true, evidence: 'node --test: 5 passed' },
      { id: ids[1], pass: true, evidence: 'make verify: warning only' },
    ],
    questions: ['none'],
  }
  const tool = ctx.tools.get('delegation_return')
  const ok = await tool.execute({ reqId: ctx.req.id, briefHash: brief.briefHash, returned }, { agent: ctx.agent })
  assert.equal(ok.ok, true, JSON.stringify(ok))
  assert.equal(ok.status, 'done')
  assert.deepEqual(ok.criteria.map((criterion) => criterion.id), ids)
  const stale = await tool.execute({ reqId: ctx.req.id, briefHash: 'deadbeef', returned }, { agent: ctx.agent })
  assert.equal(stale.ok, false)
  assert.equal(stale.code, 'brief_stale')
  const unmapped = await tool.execute({ reqId: ctx.req.id, briefHash: brief.briefHash, returned: { status: 'done', criteria: [{ id: 'REQ-001-C99', pass: true, evidence: 'x' }], questions: [] } }, { agent: ctx.agent })
  assert.equal(unmapped.ok, false)
  assert.equal(unmapped.code, 'return_unmapped')
  const missingOne = await tool.execute({ reqId: ctx.req.id, briefHash: brief.briefHash, returned: { status: 'done', criteria: [{ id: ids[0], pass: true, evidence: 'x' }], questions: [] } }, { agent: ctx.agent })
  assert.equal(missingOne.ok, false)
  assert.equal(missingOne.code, 'return_unmapped')
  const noEvidence = await tool.execute({ reqId: ctx.req.id, briefHash: brief.briefHash, returned: { status: 'done', criteria: [{ id: ids[0], pass: true, evidence: '' }, { id: ids[1], pass: false, evidence: '' }], questions: [] } }, { agent: ctx.agent })
  assert.equal(noEvidence.ok, false)
  assert.equal(noEvidence.code, 'return_invalid')
})

test('a session without a named preset gets neither tool nor section', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'delegation-nopreset-'))
  const core = createStateService({ cwd, now: clock })
  await core.regenerateViews()
  const handlers = []
  const ctx = {
    logger: { warn() {}, info() {} },
    get: (name) => (name === 'ccProjectState' ? core : undefined),
    on(event, handler) { if (event === 'agent/created') handlers.push(handler) },
    root: null,
  }
  ctx.root = ctx
  apply(ctx)
  const tools = new Map()
  const sections = []
  const agent = { session: { id: 'n', header: { cwd } }, ctx: { tools: { register: (tool) => tools.set(tool.name, tool) }, systemPrompt: { section: (value) => sections.push(value) } } }
  for (const handler of handlers) handler({ agent })
  assert.equal(tools.size, 0, 'an unnamed preset is not the orchestrator')
  assert.equal(sections.length, 0)
})

test('a worker preset gets neither tool nor section', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'delegation-worker-'))
  const core = createStateService({ cwd, now: clock })
  await core.regenerateViews()
  const env = host(core, 'backend')
  apply(env.ctx)
  const tools = new Map()
  const sections = []
  const agent = { session: { id: 'w', header: { cwd, delegationDepth: 1, agentPreset: 'backend' } }, ctx: { tools: { register: (tool) => tools.set(tool.name, tool) }, systemPrompt: { section: (value) => sections.push(value) } } }
  for (const handler of env.handlers) handler({ agent })
  assert.equal(tools.size, 0)
  assert.equal(sections.length, 0)
})
