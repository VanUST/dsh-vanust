/*
PROOF: delegate_task carries the basis of the task it creates, and a refusal names the board's reason.
Behavior: the tool declares reqIds/reqId/chore/choreReason; a create call passes them to
  taskboard.create; an attach by taskId needs neither; a refusal returned by the board reaches
  the root with the board's own message, and the advice to free a row appears only for
  `board_full` (a `req_required` refusal used to blame the row cap).
Fails when: a basis argument stops being declared or forwarded (the model cannot state its
  case, or the board refuses every delegation), a refusal loses the board's message, or a
  non-cap refusal starts advising the root to free a row.
Production path: plugins/orchestrator/orchestrator.mjs — the delegate_task `parameters`,
  the `taskboard.create` call in its execute body, and the refusal branch after it.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { apply } from '../orchestrator.mjs'

const SOURCE = readFileSync(join(process.cwd(), 'plugins/orchestrator/orchestrator.mjs'), 'utf8')
const control = process.env.CASE_NEGATIVE_CONTROL ?? ''

test('negative control expect-pre-fix keeps the pre-fix delegation shape', () => {
  if (control !== 'expect-pre-fix') return
  // The pre-fix shape this change removes: the tool forwards no basis, and the refusal advice
  // is unconditional. Both assertions must fail on the fixed source - that is the red.
  assert.doesNotMatch(SOURCE, /reqIds: Array\.isArray\(args\.reqIds\)/)
  assert.match(SOURCE, /no child was started\. Free a row \(task_remove \/ task_close\)/)
})

/**
 * A fake harness: the tool under test, a taskboard that RECORDS the create input (and answers
 * with whatever this case needs), and a subagent provider that records the activation instead
 * of spawning. The real taskboard rule is exercised end to end by
 * `scripts/delegation-basis-proof.mjs`; this file pins what the orchestrator passes.
 */
function harness(boardReply) {
  const calls = { create: [], startActivation: [] }
  const taskboard = {
    create: (cwd, input) => {
      calls.create.push(input)
      // The brief renderer reads the row's acceptance/scope lists: a row without them is not a
      // row the tool can delegate, so the fake returns what `taskboard.create` returns.
      return boardReply === undefined
        ? { id: `task-proof-${calls.create.length}`, revision: 1, title: input.title, role: input.role, status: 'open', scope: [], nonScope: [], acceptance: [] }
        : boardReply
    },
    agents: () => [],
    list: () => [],
    // The attach path reads the row and claims it before a child exists.
    get: (cwd, id) => ({ id, revision: 1, title: 'attached row', role: 'REVIEWER', status: 'open', scope: [], nonScope: [], acceptance: [] }),
    update: (cwd, input) => ({ ok: true, task: { id: input.id, revision: 2, title: 'attached row', role: 'REVIEWER', status: 'active', scope: [], nonScope: [], acceptance: [] } }),
    note: () => ({ ok: true }),
    registerAgent: () => ({ ok: true }),
    linkChild: (cwd, input) => ({ ok: true, task: { id: input.id } }),
  }
  const services = new Map([['taskboard', taskboard]])
  const created = []
  const ctx = {
    logger: { warn() {}, info() {} },
    provide() {},
    effect(fn) {
      fn()
      return () => {}
    },
    on(event, handler) {
      if (event === 'agent/created') created.push(handler)
    },
    get(name) {
      return services.get(name)
    },
    systemPrompt: { getSectionOrder: () => undefined, section() {} },
    tools: { register() {}, guard() {} },
    subagents: {
      getProvider: () => ({ capabilities: { agentPreset: true, agentOptions: true } }),
      async startActivation() {
        const childId = `proof-child-${calls.startActivation.length}`
        calls.startActivation.push(childId)
        return { childId }
      },
      async sendMessage() {},
      interrupt() {},
    },
  }
  apply(ctx, {})
  const tools = new Map()
  const agent = {
    id: 'root-proof',
    session: { header: { id: 'root-proof', cwd: process.cwd(), agentPreset: 'orchestrator', delegationDepth: 0 } },
    ctx: {
      on() {},
      systemPrompt: { getSectionOrder: () => 100, section() {} },
      tools: { register: (definition) => tools.set(definition.name, definition), guard() {} },
    },
  }
  for (const handler of created) handler({ agent })
  const delegate = (args) => tools.get('delegate_task').execute({ ...args, cwd: process.cwd() }, { agent, signal: new AbortController().signal })
  return { calls, delegate, tools }
}

const base = (overrides = {}) => ({ title: 'proof task', role: 'REVIEWER', objective: 'prove the basis reaches the board', ...overrides })

test('delegate_task declares reqIds, reqId, chore and choreReason', () => {
  const { tools } = harness()
  const properties = tools.get('delegate_task').parameters.properties
  for (const key of ['reqIds', 'reqId', 'chore', 'choreReason']) {
    assert.ok(properties[key] !== undefined, `delegate_task no longer declares "${key}"`)
  }
})

test('a created task carries reqIds', async () => {
  const { calls, delegate } = harness()
  const result = await delegate(base({ reqIds: ['REQ-148', 'REQ-150'] }))
  assert.notEqual(result?.ok, false)
  assert.deepEqual(calls.create[0].reqIds, ['REQ-148', 'REQ-150'])
  assert.equal(calls.create[0].chore, false)
})

test('a created task carries chore and choreReason', async () => {
  const { calls, delegate } = harness()
  const result = await delegate(base({ chore: true, choreReason: 'a review of existing code implements no requirement' }))
  assert.notEqual(result?.ok, false)
  assert.equal(calls.create[0].chore, true)
  assert.equal(calls.create[0].choreReason, 'a review of existing code implements no requirement')
  assert.deepEqual(calls.create[0].reqIds, [])
})

test('an attach by taskId passes no basis and starts one child', async () => {
  const { calls, delegate } = harness()
  const result = await delegate(base({ taskId: 'task-existing' }))
  assert.equal(result?.taskId, 'task-existing')
  assert.equal(calls.create.length, 0, 'an attach must not create a second row')
  assert.equal(calls.startActivation.length, 1)
})

test('a req_required refusal carries the board reason and does not blame the cap', async () => {
  const { delegate } = harness({
    ok: false,
    code: 'req_required',
    message: 'a task needs reqIds (the REQs it covers) or reqId (one REQ), or chore:true with a non-empty choreReason',
  })
  const result = await delegate(base())
  assert.equal(result?.ok, false)
  assert.equal(result?.code, 'req_required')
  assert.match(String(result.message), /chore:true with a non-empty choreReason/)
  assert.doesNotMatch(String(result.message), /Free a row/)
})

test('a board_full refusal keeps the advice to free a row', async () => {
  const { delegate } = harness({ ok: false, code: 'board_full', message: '1 of 1 tasks can still be acted on; close or cancel what is finished, or raise maxTasks' })
  const result = await delegate(base({ reqIds: ['REQ-148'] }))
  assert.equal(result?.code, 'board_full')
  assert.match(String(result.message), /Free a row/)
})

test('the root policy asks for the basis of every created task', () => {
  assert.match(SOURCE, /A created task must carry its basis/)
  assert.match(SOURCE, /req_required/)
})
