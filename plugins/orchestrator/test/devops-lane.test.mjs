/*
PROOF: one live deployment task per chat, refused by delegate_task
Behavior: a delegation that resolves to the devops preset is refused with devops_lane_busy while
  this chat's board holds a devops task in open/active/blocked/paused; the refusal names the open
  task; an attach to that task and a delegation to another preset are unchanged. Every child is
  started with agentOptions.reasoningEffort high, so a working preset never inherits another
  budget from its parent (owner, 2026-11-27).
Fails when: a second deployment starts beside the first (its restart then ends the first task's
  running child and replaces the version it was measuring), the attach path is refused, or the
  guard leaks onto other roles.
Production path: plugins/orchestrator/orchestrator.mjs — the `preset === 'devops'` lane block in
  delegate_task's execute body and its taskboard.list read. The read-only proof of the same rule
  is the source assertion at the bottom; nothing here spawns a child.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { apply, presetForRole } from '../orchestrator.mjs'

const SOURCE = readFileSync(join(process.cwd(), 'plugins/orchestrator/orchestrator.mjs'), 'utf8')

/**
 * A fake harness: the tool under test, a taskboard whose list() returns the rows a case needs,
 * and a subagent provider that records the activation instead of spawning. The real taskboard
 * rule is exercised by scripts/orchestrator-policy-proof.mjs; this file pins the lane decision.
 */
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
    get: (cwd, id) => ({ id, revision: 1, title: 'attached deployment row', role: 'DEVOPS', preset: 'devops', status: 'open', scope: [], nonScope: [], acceptance: [] }),
    update: (cwd, input) => ({ ok: true, task: { id: input.id, revision: 2, title: 'attached deployment row', role: 'DEVOPS', preset: 'devops', status: 'active', scope: [], nonScope: [], acceptance: [] } }),
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
  return { calls, delegate, tools }
}

const base = (overrides = {}) => ({ title: 'deploy 1.2.3 to the stand', role: 'DEVOPS', objective: 'replace the running deployment with 1.2.3 and prove the version from outside', ...overrides })
const liveRow = { id: 'task-live', revision: 3, title: 'deploy 1.2.2 to the stand', role: 'DEVOPS', preset: 'devops', status: 'active' }

test('every spelling a person writes for the deployment role resolves to devops', () => {
  for (const name of ['DEVOPS', 'OPS', 'OPERATIONS', 'DEPLOYMENT', 'DEPLOY', 'RUNTIME', 'RELEASE', 'ROLLOUT', 'SRE']) {
    assert.equal(presetForRole(name), 'devops', name + ' must denote the runtime lane')
  }
})

test('the first deployment task starts when the lane is free', async () => {
  const { calls, delegate } = harness([])
  const result = await delegate(base())
  assert.notEqual(result?.ok, false)
  assert.equal(calls.create.length, 1, 'the lane created its task')
  assert.equal(calls.startActivation.length, 1, 'the lane started exactly one child')
})

test('a second deployment task is refused while the first is live', async () => {
  const { calls, delegate } = harness([liveRow])
  await assert.rejects(
    () => delegate(base({ role: 'DEPLOY', title: 'roll 1.2.2 back', objective: 'return the stand to the previous version' })),
    (error) => {
      assert.match(String(error.message), /devops_lane_busy/)
      assert.match(String(error.message), /task-live/)
      assert.match(String(error.message), /active/)
      return true
    },
  )
  assert.equal(calls.create.length, 0, 'a refused delegation creates no task row')
  assert.equal(calls.startActivation.length, 0, 'a refused delegation starts no child')
})

test('attaching to the live deployment task is allowed', async () => {
  const { calls, delegate } = harness([liveRow])
  const result = await delegate(base({ taskId: 'task-live', title: 'finish the deployment', objective: 'verify the version the live stand reports' }))
  assert.notEqual(result?.ok, false, 'an attach is not a second deployment')
  assert.equal(result?.taskId, 'task-live')
  assert.equal(calls.create.length, 0, 'an attach creates no row')
  assert.equal(calls.startActivation.length, 1)
})

test('a delegation to another preset is unchanged by the lane', async () => {
  const { calls, delegate } = harness([liveRow])
  const result = await delegate({ title: 'fix the deployment timeout', role: 'BACKEND', objective: 'change the client timeout and prove it with the product' })
  assert.notEqual(result?.ok, false)
  assert.equal(calls.create.length, 1)
  assert.equal(calls.startActivation.length, 1)
})

test('review does not hold the lane: settled work awaits acceptance', async () => {
  const { delegate } = harness([{ ...liveRow, status: 'review' }])
  const result = await delegate(base({ title: 'deploy 1.2.4', objective: 'replace the reviewed deployment' }))
  assert.notEqual(result?.ok, false)
})

test('a delegated child is started at High reasoning effort', async () => {
  const { calls, delegate } = harness([])
  const result = await delegate(base())
  assert.notEqual(result?.ok, false)
  const spec = calls.activation[0]
  assert.equal(spec?.agentOptions?.provider, 'deepseek-official')
  assert.equal(spec?.agentOptions?.model, 'deepseek-flash')
  assert.equal(spec?.agentOptions?.reasoningEffort, 'high', 'the owner\'s 2026-11-27 rule: working presets default High')
  assert.equal(spec?.request?.agentOptions?.reasoningEffort, 'high', 'the legacy request block carries the same route')
})

test('the refusal names the lane rule in the source and the tool contract', () => {
  assert.match(SOURCE, /devops_lane_busy/)
  assert.match(SOURCE, /ONE live deployment task per chat/)
  const { tools } = harness([])
  const description = String(tools.get('delegate_task').description)
  assert.match(description, /DEVOPS owns the running deployment/)
  assert.match(description, /devops_lane_busy/)
})
