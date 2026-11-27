/*
PROOF: a board over the work-in-flight limit delegates only checkers
Behavior: delegate_task reads this chat's board (the same taskboard.list({ chatId }) read the
  devops lane uses). While more than BOARD_WIP_LIMIT (10) tasks are unclosed — open, active,
  paused, review or blocked, never done or cancelled — it refuses a delegation to any role but
  TESTER and CRITIC with board_limit, and the refusal names the count, the limit and those two
  roles, while an attach to an already open task (taskId) is allowed: the ceiling is on NEW
  work, not on finishing what is open. At or below the limit, delegation is unchanged.
Fails when: an executor is started onto an already-overfull board (work piles up faster than it
  closes), a checker is refused while the board is over the limit (nothing could then be
  accepted), done/cancelled rows still count, or the policy text repeats the number instead of
  interpolating the constant.
Production path: plugins/orchestrator/orchestrator.mjs — the board_limit gate in delegate_task's
  execute body, BOARD_WIP_LIMIT, and ROOT_POLICY. Nothing here spawns a child.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { apply, presetForRole, ROOT_POLICY } from '../orchestrator.mjs'

const SOURCE = readFileSync(join(process.cwd(), 'plugins/orchestrator/orchestrator.mjs'), 'utf8')

function harness(rows = []) {
  const calls = { create: [], startActivation: [], activation: [], list: [] }
  const taskboard = {
    create: (cwd, input) => {
      calls.create.push(input)
      return { id: 'task-new-' + calls.create.length, revision: 1, title: input.title, role: input.role, status: 'open', scope: [], nonScope: [], acceptance: [] }
    },
    agents: () => [],
    findAgent: () => undefined,
    list: (cwd, options) => {
      calls.list.push(options)
      return rows
    },
    get: (cwd, id) => ({ id, revision: 1, title: 'attached row', role: 'BACKEND', preset: 'backend', status: 'open', scope: [], nonScope: [], acceptance: [] }),
    update: (cwd, input) => ({ ok: true, task: { id: input.id, revision: 2, title: 'attached row', role: 'BACKEND', preset: 'backend', status: 'active', scope: [], nonScope: [], acceptance: [] } }),
    note: () => ({ ok: true }),
    registerAgent: () => ({ ok: true }),
    linkChild: (cwd, input) => ({ ok: true, task: { id: input.id } }),
  }
  const services = new Map([['taskboard', taskboard]])
  const created = []
  const ctx = {
    logger: { warn() {}, info() {} },
    provide() {},
    effect(fn) { fn(); return () => {} },
    on(event, handler) { if (event === 'agent/created') created.push(handler) },
    get(name) { return services.get(name) },
    systemPrompt: { getSectionOrder: () => undefined, section() {} },
    tools: { register() {}, guard() {} },
    subagents: {
      getProvider: () => ({ capabilities: { agentPreset: true, agentOptions: true } }),
      async startActivation(spec) {
        const childId = 'proof-child-' + calls.startActivation.length
        calls.startActivation.push(childId)
        calls.activation.push(spec)
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
  return { calls, delegate }
}

const base = (overrides = {}) => ({ title: 'change the client timeout', role: 'BACKEND', objective: 'change the client timeout and prove it with the product', ...overrides })
const openRows = (count, extra = []) => [
  ...Array.from({ length: count }, (_, index) => ({ id: 'task-open-' + index, revision: 1, title: 'open work ' + index, role: 'BACKEND', preset: 'backend', status: 'open' })),
  ...extra,
]

test('an executor is refused with board_limit when more than the limit is unclosed', async () => {
  const { calls, delegate } = harness(openRows(11))
  await assert.rejects(
    () => delegate(base()),
    (error) => {
      assert.match(String(error.message), /board_limit/)
      assert.match(String(error.message), /11 unclosed/)
      assert.match(String(error.message), /10/)
      assert.match(String(error.message), /TESTER/)
      assert.match(String(error.message), /CRITIC/)
      return true
    },
  )
  assert.equal(calls.create.length, 0, 'a refused delegation creates no task row')
  assert.equal(calls.startActivation.length, 0, 'a refused delegation starts no child')
})

test('every executor role is refused, not just BACKEND', async () => {
  for (const role of ['BACKEND', 'DEVOPS', 'DOCS', 'UX/UI', 'PRESENTER', 'RESEARCH', 'GATHERER', 'ARCHITECT']) {
    const { calls, delegate } = harness(openRows(11))
    await assert.rejects(() => delegate(base({ role })), /board_limit/, role + ' must be refused above the limit')
    assert.equal(calls.startActivation.length, 0, role + ' must start no child')
  }
})

test('TESTER and CRITIC are allowed while the board is over the limit', async () => {
  for (const role of ['TESTER', 'CRITIC']) {
    const { calls, delegate } = harness(openRows(11))
    const result = await delegate({ title: 'accept the change', role, objective: 'measure the change the board is carrying and record the case' })
    assert.notEqual(result?.ok, false, role + ' must be allowed above the limit')
    assert.equal(calls.startActivation.length, 1, role + ' starts its child')
  }
})

test('at the limit an executor is still allowed; done and cancelled rows do not count', async () => {
  const atLimit = await harness(openRows(10))
  assert.notEqual((await atLimit.delegate(base()))?.ok, false, '10 unclosed is not MORE than the limit')
  const mixed = await harness(openRows(9, [
    { id: 'task-done', revision: 1, title: 'closed work', role: 'BACKEND', preset: 'backend', status: 'done' },
    { id: 'task-cancelled', revision: 1, title: 'cancelled work', role: 'BACKEND', preset: 'backend', status: 'cancelled' },
    { id: 'task-review', revision: 1, title: 'settled work awaiting acceptance', role: 'BACKEND', preset: 'backend', status: 'review' },
  ]))
  assert.notEqual((await mixed.delegate(base({ title: 'next change' })))?.ok, false, 'review counts as unclosed, done and cancelled do not')
})

test('an attach to an already open task is allowed above the limit', async () => {
  const { calls, delegate } = harness(openRows(11))
  const result = await delegate(base({ taskId: 'task-open-0', title: 'finish the open change' }))
  assert.notEqual(result?.ok, false, 'an attach adds no unclosed work, so the ceiling does not refuse it')
  assert.equal(calls.create.length, 0, 'an attach creates no task row')
  assert.equal(calls.startActivation.length, 1, 'the child continues the open task')
})

test('the refusal names the reason: verification debt and minimal viable change', async () => {
  // 8 open + 3 waiting for acceptance = 11 unclosed, 3 of them review.
  const rows = openRows(8, Array.from({ length: 3 }, (_, index) => ({ id: 'task-review-' + index, revision: 1, title: 'awaiting acceptance ' + index, role: 'BACKEND', preset: 'backend', status: 'review' })))
  const { delegate } = harness(rows)
  await assert.rejects(
    () => delegate(base()),
    (error) => {
      const message = String(error.message)
      assert.match(message, /verification debt/i, 'the refusal names the debt the limit protects against')
      assert.match(message, /minimal viable change/i, 'the refusal names the principle, not a reproach')
      assert.match(message, /3 of them are waiting for acceptance/, 'the refusal names how many rows wait for acceptance')
      assert.match(message, /11 unclosed/, 'the refusal names the total unclosed count')
      assert.match(message, /limit of 10/, 'the refusal names the limit')
      assert.match(message, /TESTER/, 'the refusal names the allowed roles')
      return true
    },
  )
})

test('the limit is one constant and the policy text interpolates it', () => {
  assert.match(SOURCE, /export const BOARD_WIP_LIMIT = 10/)
  assert.match(SOURCE, /more than \$\{BOARD_WIP_LIMIT\} unclosed/)
  assert.match(ROOT_POLICY, /more than 10 unclosed/)
  assert.match(ROOT_POLICY, /board_limit/)
  assert.match(ROOT_POLICY, /TESTER and CRITIC|tester and critic/i)
  assert.match(ROOT_POLICY, /verification debt/i, 'the policy names the reason')
  assert.match(ROOT_POLICY, /minimal viable change/i, 'the policy names the principle')
  assert.match(ROOT_POLICY, /waiting for acceptance/i, 'the policy says the count is shown separately')
})
