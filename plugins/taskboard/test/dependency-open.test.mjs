/*
PROOF: a task whose dependency is not done cannot start, and the refusal names the task it waits for
Behavior: task_update to active on a task with dependsOn pointing at a task that is not done is
  refused with dependency_open, the refusal carries waitingOn and a message naming that task, and the
  row stays open; the same move passes once the dependency is done; linkChild - the door
  delegate_task uses to start a task - refuses the same way and leaves the row open; delegate_task
  returns that code and message instead of a generic block; a task without dependsOn starts as before;
  the chain is expressible by a caller: task_create and task_update declare dependsOn and the
  update writes it (the tool parameter and TASK_UPDATE_FIELDS agree).
Fails when: an open dependency no longer blocks a start, the refusal loses the dependency id, the
  linked child starts anyway, or delegate_task swallows the board's reason.
Production path: plugins/taskboard/taskboard.mjs (openDependencies, dependencyRefusal,
  transitionRefusal, update, linkChild) and plugins/orchestrator/orchestrator.mjs (the attach and
  link refusals of delegate_task).
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply as applyTaskboard } from '../taskboard.mjs'
import { apply as applyOrchestrator } from '../../orchestrator/orchestrator.mjs'

const now = '2026-01-05T00:00:00.000Z'
const row = (id, overrides = {}) => ({ id, revision: 1, title: id, status: 'open', priority: 'normal', chatId: 'chat-1', createdAt: now, updatedAt: now, caseIds: [], childSessionIds: [], ...overrides })

function board(tasks) {
  const dir = mkdtempSync(join(tmpdir(), 'taskboard-dependency-open-'))
  mkdirSync(join(dir, '.dsh'), { recursive: true })
  const boardPath = join(dir, 'taskboard.json')
  writeFileSync(boardPath, JSON.stringify({ version: 1, revision: 5, tasks }, null, 2) + '\n')
  const registry = new Map()
  const tools = new Map()
  const ctx = {
    logger: { warn() {}, info() {} },
    provide(name, service) { registry.set(name, service); return service },
    effect(fn) { fn(); return () => {} },
    on() {},
    get() { return undefined },
    tools: { register(tool) { if (typeof tool?.name === 'string') tools.set(tool.name, tool); return () => {} } },
    commands: { register() { return () => {} } },
  }
  applyTaskboard(ctx, { file: boardPath, linksFile: join(dir, 'links.json'), lockWaitMs: 1000 })
  const call = (name, args) => tools.get(name).execute(args, { agent: { id: 'root-1', session: { header: { cwd: dir } } } })
  return { dir, service: registry.get('taskboard'), tools, call }
}

const start = (service, dir, id, revision = 1) => service.update(dir, {
  id,
  expectedRevision: revision,
  chatId: 'chat-1',
  patch: { status: 'active', role: 'BACKEND', owner: { kind: 'agent', label: 'BACKEND' } },
})

test('an open dependency refuses the move to active and names the task it waits for', () => {
  const { dir, service } = board([
    row('task-late', { dependsOn: ['task-deploy'], role: 'BACKEND' }),
    row('task-deploy', { status: 'active', role: 'DEVOPS' }),
  ])
  const refused = start(service, dir, 'task-late')
  assert.equal(refused.ok, false, 'an open dependency must refuse the start: ' + JSON.stringify(refused))
  assert.equal(refused.code, 'dependency_open')
  assert.deepEqual(refused.waitingOn, ['task-deploy'])
  assert.match(String(refused.message), /task-deploy/)
  assert.equal(service.get(dir, 'task-late').status, 'open', 'a refused start leaves the row where it was')
})

test('the same move passes once the dependency is done', () => {
  const { dir, service } = board([
    row('task-late', { dependsOn: ['task-deploy'], role: 'BACKEND' }),
    row('task-deploy', { status: 'done', role: 'DEVOPS' }),
  ])
  const started = start(service, dir, 'task-late')
  assert.equal(started.ok, true, 'a finished dependency no longer blocks: ' + JSON.stringify(started))
  assert.equal(started.task.status, 'active')
})

test('linkChild refuses to start a task whose dependency is open', () => {
  const { dir, service } = board([
    row('task-late', { dependsOn: ['task-deploy'], role: 'BACKEND' }),
    row('task-deploy', { status: 'open', role: 'DEVOPS' }),
  ])
  const linked = service.linkChild(dir, { id: 'task-late', sessionId: 'child-1', chatId: 'chat-1' })
  assert.equal(linked.ok, false, 'a linked child must not start work that waits: ' + JSON.stringify(linked))
  assert.equal(linked.code, 'dependency_open')
  assert.match(String(linked.message), /task-deploy/)
  const current = service.get(dir, 'task-late')
  assert.equal(current.status, 'open', 'the refused link leaves the row open')
  assert.deepEqual(current.childSessionIds ?? [], [], 'the refused link records no child')
})

test('a task with no dependsOn starts exactly as before', () => {
  const { dir, service } = board([row('task-free', { role: 'BACKEND' })])
  const started = start(service, dir, 'task-free')
  assert.equal(started.ok, true, JSON.stringify(started))
  const { dir: dir2, service: service2 } = board([row('task-free-2', { role: 'BACKEND' })])
  const linked = service2.linkChild(dir2, { id: 'task-free-2', sessionId: 'child-2', chatId: 'chat-1' })
  assert.equal(linked.ok, true, JSON.stringify(linked))
  assert.equal(linked.task.status, 'active')
})

test('the tools carry dependsOn: created and patched through task_create and task_update', async () => {
  const { dir, service, tools, call } = board([])
  assert.ok(Object.keys(tools.get('task_create').parameters.properties ?? {}).includes('dependsOn'), 'task_create must declare dependsOn, or no caller can express an order')
  assert.ok(Object.keys(tools.get('task_update').parameters.properties ?? {}).includes('dependsOn'), 'task_update must declare dependsOn, or a chain cannot be repaired')

  const deploy = await call('task_create', { title: 'deploy the build', role: 'DEVOPS', reqIds: ['REQ-1'] })
  assert.equal(typeof deploy.id, 'string', 'task_create returns the row: ' + JSON.stringify(deploy).slice(0, 300))
  const late = await call('task_create', { title: 'measure the deployed build', role: 'BACKEND', reqIds: ['REQ-1'], dependsOn: [deploy.id] })
  assert.equal(typeof late.id, 'string', 'task_create returns the row: ' + JSON.stringify(late).slice(0, 300))
  assert.deepEqual(late.dependsOn, [deploy.id], 'task_create stores the dependency it was given: ' + JSON.stringify(late))

  const patched = await call('task_update', { id: late.id, expectedRevision: late.revision, dependsOn: [deploy.id] })
  assert.equal(patched.ok, true, JSON.stringify(patched))
  assert.deepEqual(patched.task.dependsOn, [deploy.id], 'task_update writes the dependency instead of returning ok with nothing written: ' + JSON.stringify(patched))

  const start = await call('task_update', { id: late.id, expectedRevision: patched.task.revision, status: 'active' })
  assert.equal(start.ok, false, 'a chain set through the tools must block the start: ' + JSON.stringify(start))
  assert.equal(start.code, 'dependency_open')
  assert.match(String(start.message), new RegExp(deploy.id))
  assert.equal(service.get(dir, late.id).status, 'open')
  assert.equal(service.get(dir, deploy.id).status, 'open', 'the dependency row is untouched')
})
/** The orchestrator with a taskboard stub: the refusal shape is the board's, the wiring is real. */
function orchestrator(taskboard) {
  const calls = { startActivation: [] }
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
        calls.startActivation.push(spec)
        return { childId: 'proof-child-' + calls.startActivation.length }
      },
      async sendMessage() {},
      interrupt() {},
    },
  }
  applyOrchestrator(ctx, {})
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

const refusal = { ok: false, code: 'dependency_open', waitingOn: ['task-deploy'], message: 'dependency_open: "task-late" waits for "task-deploy" (still open)' }

test('delegate_task propagates dependency_open and the task it waits for (attach path)', async () => {
  const task = row('task-late', { dependsOn: ['task-deploy'], role: 'BACKEND', scope: [], nonScope: [], acceptance: [], chatId: 'root-proof' })
  const taskboard = {
    get: () => task,
    list: () => [],
    findAgent: () => undefined,
    create: () => { throw new Error('attach must not create a row') },
    update: () => refusal,
    linkChild: () => ({ ok: true, task }),
    note: () => ({ ok: true }),
    agents: () => [],
  }
  const { calls, delegate } = orchestrator(taskboard)
  const result = await delegate({ title: 'measure the deployed build', role: 'BACKEND', objective: 'prove it', scope: [], nonScope: [], acceptance: [], taskId: 'task-late' })
  assert.notEqual(result?.ok, true, 'the delegation must be refused: ' + JSON.stringify(result))
  assert.equal(result.code, 'dependency_open')
  assert.match(String(result.message), /task-deploy/, 'the delegation names the task it waits for: ' + result.message)
  assert.equal(calls.startActivation.length, 0, 'no child was started')
})

test('delegate_task propagates dependency_open from the link that starts a new task', async () => {
  const taskboard = {
    get: () => undefined,
    list: () => [],
    findAgent: () => undefined,
    create: () => ({ id: 'task-new', revision: 1, title: 'measure the deployed build', role: 'BACKEND', status: 'open', scope: [], nonScope: [], acceptance: [], criteria: [], caseIds: [] }),
    update: () => ({ ok: true, task: { id: 'task-new', revision: 2, status: 'active' } }),
    linkChild: () => ({ ok: false, code: 'dependency_open', waitingOn: ['task-deploy'], message: 'dependency_open: "task-new" waits for "task-deploy" (still open)' }),
    registerAgent: () => ({ ok: true }),
    touchAgent: () => ({ ok: true }),
    note: () => ({ ok: true }),
    agents: () => [],
  }
  const { calls, delegate } = orchestrator(taskboard)
  const result = await delegate({ title: 'measure the deployed build', role: 'BACKEND', objective: 'prove it', scope: [], nonScope: [], acceptance: [], reqIds: ['REQ-1'] })
  assert.notEqual(result?.ok, true, 'the delegation must be refused: ' + JSON.stringify(result))
  assert.equal(result.code, 'dependency_open')
  assert.match(String(result.message), /task-deploy/, 'the delegation names the task it waits for: ' + result.message)
  assert.equal(calls.startActivation.length, 1)
})
