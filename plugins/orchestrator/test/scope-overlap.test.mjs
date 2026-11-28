/*
PROOF: delegate_task refuses two live tasks that claim the same file
Behavior: scope entries are claimed as paths (a leading token with a slash or a dot; trailing
  slash dropped, "./" and ".." resolved, prose after the path ignored). A devops-style delegation
  is refused with scope_overlap when another ACTIVE task in this chat claims the same file or a
  directory that contains it, and the refusal happens before a task row or a child exists. An
  attach to that active task, a disjoint file, a prose-only scope and a task in review are all
  allowed.
Fails when: two children can be started on one file, the path normalizer treats two spellings of
  one file differently, a prose scope blocks, or an attach to the holding task is refused.
Production path: plugins/orchestrator/orchestrator.mjs — scopeClaim/claimsOverlap/scopeConflict
  and the refuseScopeCollision calls in delegate_task's create and attach branches.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, claimsOverlap, scopeClaim, scopeConflict } from '../orchestrator.mjs'

function harness(rows = []) {
  const calls = { create: [], startActivation: [], list: [] }
  const byId = new Map(rows.map((row) => [row.id, row]))
  const taskboard = {
    create: (cwd, input) => {
      calls.create.push(input)
      return { id: 'task-new-' + calls.create.length, revision: 1, title: input.title, role: input.role, status: 'open', scope: input.scope ?? [], nonScope: [], acceptance: [] }
    },
    agents: () => [],
    findAgent: () => undefined,
    list: (cwd, options) => {
      calls.list.push(options)
      return rows.map((row) => ({ ...row, children: [], runningChildSessionIds: [] }))
    },
    get: (cwd, id) => byId.get(id),
    update: (cwd, input) => {
      const row = byId.get(input.id)
      if (row === undefined) return { ok: false, code: 'not_found' }
      return { ok: true, task: { ...row, ...input.patch, revision: (row.revision ?? 1) + 1 } }
    },
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
        calls.startActivation.push(spec)
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

const base = (overrides = {}) => ({ title: 'prove the scope guard', role: 'BACKEND', objective: 'change one file and prove it with the product', ...overrides })
const activeRow = {
  id: 'task-holder',
  revision: 3,
  title: 'change the same file',
  role: 'BACKEND',
  preset: 'backend',
  status: 'active',
  scope: ['plugins/orchestrator/orchestrator.mjs'],
  nonScope: [],
  acceptance: [],
}

test('scopeClaim normalizes the spellings of one path', () => {
  assert.equal(scopeClaim('plugins/orchestrator/orchestrator.mjs: the guard'), 'plugins/orchestrator/orchestrator.mjs')
  assert.equal(scopeClaim('./plugins/orchestrator/'), 'plugins/orchestrator')
  assert.equal(scopeClaim('plugins\\orchestrator\\orchestrator.mjs'), '', 'a backslash path is not a separator assumption this kit makes')
  assert.equal(scopeClaim('docs/../plugins/x.mjs'), 'plugins/x.mjs')
  assert.equal(scopeClaim('read the product modules'), '')
  assert.equal(scopeClaim('docs/cases/ (one JSON case + its driver under tests/)'), 'docs/cases')
})

test('claimsOverlap only when one path contains the other', () => {
  assert.equal(claimsOverlap('a/b.mjs', 'a/b.mjs'), true)
  assert.equal(claimsOverlap('a', 'a/b.mjs'), true)
  assert.equal(claimsOverlap('a/b.mjs', 'a'), true)
  assert.equal(claimsOverlap('a/b.mjs', 'a/c.mjs'), false)
  assert.equal(claimsOverlap('a', 'ab'), false)
})

test('scopeConflict names the holder and the claimed path', () => {
  const clash = scopeConflict(['plugins/orchestrator/orchestrator.mjs'], [activeRow], process.cwd())
  assert.equal(clash?.task.id, 'task-holder')
  assert.equal(clash?.claim, 'plugins/orchestrator/orchestrator.mjs')
  assert.equal(scopeConflict(['plugins/test-cases/README.md'], [activeRow], process.cwd()), undefined)
})

test('a second delegation on the same file is refused before a row or a child exists', async () => {
  const { calls, delegate } = harness([activeRow])
  await assert.rejects(
    () => delegate(base({ scope: ['plugins/orchestrator/orchestrator.mjs: the new guard'] })),
    (error) => {
      assert.match(String(error.message), /scope_overlap/)
      assert.match(String(error.message), /task-holder/)
      return true
    },
  )
  assert.equal(calls.create.length, 0)
  assert.equal(calls.startActivation.length, 0)
})

test('a directory scope collides with a file inside it', async () => {
  const { delegate } = harness([{ ...activeRow, scope: ['plugins/orchestrator'] }])
  await assert.rejects(() => delegate(base({ scope: ['plugins/orchestrator/orchestrator.mjs'] })), /scope_overlap/)
})

test('different files in the same directory run together', async () => {
  const { calls, delegate } = harness([activeRow])
  const result = await delegate(base({ scope: ['plugins/orchestrator/README.md'] }))
  assert.notEqual(result?.ok, false)
  assert.equal(calls.startActivation.length, 1)
})

test('prose scope claims nothing and does not block', async () => {
  const { calls, delegate } = harness([activeRow])
  const result = await delegate(base({ scope: ['read the orchestrator module and report'] }))
  assert.notEqual(result?.ok, false)
  assert.equal(calls.startActivation.length, 1)
})

test('a task in review does not hold a file', async () => {
  const { calls, delegate } = harness([{ ...activeRow, status: 'review' }])
  const result = await delegate(base({ scope: ['plugins/orchestrator/orchestrator.mjs'] }))
  assert.notEqual(result?.ok, false)
  assert.equal(calls.startActivation.length, 1)
})

test('attaching to the task that holds the file is allowed', async () => {
  const holder = { ...activeRow, status: 'open', role: 'BACKEND' }
  const { calls, delegate } = harness([holder])
  const result = await delegate(base({ taskId: holder.id, scope: ['plugins/orchestrator/orchestrator.mjs'] }))
  assert.notEqual(result?.ok, false, String(result?.message ?? ''))
  assert.equal(calls.create.length, 0)
  assert.equal(calls.startActivation.length, 1)
})
