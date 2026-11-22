/*
PROOF: the verification level decides whether a case is owed, and only independent counts criteria
Behavior: a task created at level proof or case closes with no acceptance case and never asks the
  case gate; a task at level independent asks it and its refusal (CRITERIA_UNCOVERED or
  CRITERIA_REQUIRED) refuses the close with the same code and its coverage; the row's verification
  and criteria are what the gate receives; a row with no level keeps the pre-P2 behaviour; criteria
  get stable ids (a bare string becomes AC-n) and duplicates are dropped.
Fails when: a proof task is blocked for a missing case, an independent close passes an uncovered
  criterion, the coverage refusal is reported as a case problem, or an old row starts asking for a
  level it never had.
Production path: plugins/taskboard/taskboard.mjs (VERIFICATION_LEVELS, criteriaOf, beforeClose) and
  the cases service's gateForTask (coverage lives there).
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../taskboard.mjs'

const now = '2026-01-05T00:00:00.000Z'

function boardOf(task) {
  return { version: 1, revision: 3, tasks: [{ id: 'task-1', revision: 1, title: 'work', status: 'review', priority: 'normal', chatId: 'chat-1', createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z', ...task }] }
}

function harness(task, answer = () => ({ ok: true, blockers: [] })) {
  const dir = mkdtempSync(join(tmpdir(), 'taskboard-contract-'))
  mkdirSync(join(dir, '.dsh'), { recursive: true })
  const boardPath = join(dir, 'taskboard.json')
  writeFileSync(boardPath, JSON.stringify(boardOf(task), null, 2) + '\n')
  const asked = []
  const cases = {
    gateForTask(cwd, taskId, context) {
      asked.push({ taskId, context })
      return answer(context)
    },
  }
  const registry = new Map()
  const ctx = {
    logger: { warn() {}, info() {} },
    provide(name, service) { registry.set(name, service); return service },
    effect(fn) { fn(); return () => {} },
    on() {},
    get(name) { return name === 'cases' ? cases : undefined },
    tools: { register() { return () => {} } },
    commands: { register() { return () => {} } },
  }
  apply(ctx, { file: boardPath, linksFile: join(dir, 'links.json'), lockWaitMs: 1000 })
  return { dir, asked, service: registry.get('taskboard') }
}

const closeArgs = (dir) => ({ id: 'task-1', chatId: 'chat-1', parentSessionId: 'root', result: { summary: 'accepted', evidence: ['node sum.mjs 1 2 3'] } })

test('a proof task closes with no case, and the case gate is never asked', () => {
  const { dir, asked, service } = harness({ role: 'BACKEND', preset: 'backend', verification: 'proof' })
  const closed = service.close(dir, closeArgs(dir))
  assert.equal(asked.length, 0, 'a proof task asked for a case')
  assert.equal(closed.ok, true, JSON.stringify(closed))
  assert.equal(closed.task.status, 'done')
})

test('a case-level task closes without a case too', () => {
  const { dir, asked, service } = harness({ role: 'BACKEND', preset: 'backend', verification: 'case' })
  const closed = service.close(dir, closeArgs(dir))
  assert.equal(asked.length, 0)
  assert.equal(closed.ok, true, JSON.stringify(closed))
})

test('an independent task hands the gate its level and its criteria', () => {
  const criteria = [{ id: 'AC-1', text: 'the sum is six' }]
  const { dir, asked, service } = harness({ role: 'BACKEND', preset: 'backend', verification: 'independent', criteria })
  service.close(dir, closeArgs(dir))
  assert.equal(asked.length, 1)
  assert.equal(asked[0].context.verification, 'independent')
  assert.deepEqual(asked[0].context.criteria, criteria)
  assert.equal(asked[0].context.implementerPreset, 'backend')
})

test('an uncovered criterion refuses the close by its own code, with the coverage', () => {
  const coverage = [{ id: 'AC-1', text: 'the sum is six', covered: true, caseId: 'sum-case' }, { id: 'AC-2', text: 'zero is accepted', covered: false, caseId: null }]
  const { dir, service } = harness({ role: 'BACKEND', preset: 'backend', verification: 'independent', criteria: [{ id: 'AC-1', text: 'x' }, { id: 'AC-2', text: 'y' }] }, () => ({
    ok: false,
    code: 'CRITERIA_UNCOVERED',
    message: 'not every acceptance criterion is covered by an acceptable case: AC-2',
    coverage,
  }))
  const closed = service.close(dir, closeArgs(dir))
  assert.equal(closed.ok, false)
  assert.equal(closed.code, 'CRITERIA_UNCOVERED', JSON.stringify(closed))
  assert.deepEqual(closed.coverage, coverage, 'the refusal dropped the coverage')
  assert.match(closed.message, /AC-2/)
})

test('an independent task with no criteria is refused as a contract problem', () => {
  const { dir, service } = harness({ role: 'BACKEND', preset: 'backend', verification: 'independent', criteria: [] }, () => ({ ok: false, code: 'CRITERIA_REQUIRED', message: 'no criteria', coverage: [] }))
  const closed = service.close(dir, closeArgs(dir))
  assert.equal(closed.ok, false)
  assert.equal(closed.code, 'CRITERIA_REQUIRED', JSON.stringify(closed))
})

test('a row with no level keeps the pre-P2 answer and passes no level to the gate', () => {
  const { dir, asked, service } = harness({ role: 'BACKEND', preset: 'backend' })
  service.close(dir, closeArgs(dir))
  assert.equal(asked.length, 1, 'a legacy row stopped asking the case gate')
  assert.equal(asked[0].context.verification, undefined)
  assert.equal(asked[0].context.criteria, undefined)
})

test('criteria ids are stable and de-duplicated', () => {
  const { service, dir } = harness({ role: 'BACKEND', preset: 'backend' })
  const created = service.create(dir, {
    title: 'Contract',
    role: 'BACKEND',
    preset: 'backend',
    chatId: 'chat-1',
    verification: 'independent',
    criteria: ['the first claim', { id: 'REQ-9-C01', text: 'the second claim' }, { id: 'REQ-9-C01', text: 'a duplicate id' }, '   '],
    constraints: ['no new dependency'],
  })
  assert.equal(typeof created.id, 'string', JSON.stringify(created))
  const row = service.get(dir, created.id)
  assert.equal(row.verification, 'independent')
  assert.deepEqual(row.criteria, [{ id: 'AC-1', text: 'the first claim' }, { id: 'REQ-9-C01', text: 'the second claim' }])
  assert.deepEqual(row.constraints, ['no new dependency'])
})

test('the close refuses a row whose shell changed the product', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'taskboard-shell-violation-'))
  mkdirSync(join(cwd, '.dsh'), { recursive: true })
  const boardPath = join(cwd, 'taskboard.json')
  writeFileSync(boardPath, JSON.stringify({ version: 1, revision: 3, tasks: [{ id: 'task-shell', revision: 1, title: 'shell', status: 'review', priority: 'normal', chatId: 'chat-1', role: 'BACKEND', preset: 'backend', caseIds: [], childSessionIds: ['child-shell'], createdAt: now, updatedAt: now }] }, null, 2) + '\n')
  writeFileSync(join(cwd, '.dsh', 'proof-guard-violations.json'), JSON.stringify([{ at: now, sessionId: 'child-shell', preset: 'tester', tool: 'pwsh', files: ['src/app.mjs'] }], null, 2) + '\n')
  const registry = new Map()
  const ctx = {
    logger: { warn() {}, info() {} },
    provide(name, service) { registry.set(name, service); return service },
    effect(fn) { fn(); return () => {} },
    on() {},
    get() { return undefined },
    tools: { register() { return () => {} } },
    commands: { register() { return () => {} } },
  }
  apply(ctx, { file: boardPath, linksFile: join(cwd, 'links.json'), lockWaitMs: 1000 })
  const service = registry.get('taskboard')
  const closed = service.close(cwd, { id: 'task-shell', chatId: 'chat-1', parentSessionId: 'child-shell', result: { summary: 'done', evidence: ['node x'] } })
  assert.equal(closed.ok, false, 'a row whose shell edited the product was closed')
  assert.equal(closed.code, 'product_shell_violation', JSON.stringify(closed))
  assert.deepEqual(closed.files, ['src/app.mjs'])
})

test('a violation recorded for the row\'s child refuses a close made by the orchestrator', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'taskboard-shell-child-'))
  mkdirSync(join(cwd, '.dsh'), { recursive: true })
  const boardPath = join(cwd, 'taskboard.json')
  writeFileSync(boardPath, JSON.stringify({ version: 1, revision: 3, tasks: [{ id: 'task-child', revision: 1, title: 'child row', status: 'review', priority: 'normal', chatId: 'chat-1', role: 'BACKEND', preset: 'backend', caseIds: [], childSessionIds: ['sess-tester'], createdAt: now, updatedAt: now }] }, null, 2) + '\n')
  writeFileSync(join(cwd, '.dsh', 'proof-guard-violations.json'), JSON.stringify([{ at: now, sessionId: 'sess-tester', preset: 'tester', tool: 'pwsh', files: ['src/app.mjs'] }], null, 2) + '\n')
  const registry = new Map()
  const ctx = {
    logger: { warn() {}, info() {} },
    provide(name, service) { registry.set(name, service); return service },
    effect(fn) { fn(); return () => {} },
    on() {},
    get() { return undefined },
    tools: { register() { return () => {} } },
    commands: { register() { return () => {} } },
  }
  apply(ctx, { file: boardPath, linksFile: join(cwd, 'links.json'), lockWaitMs: 1000 })
  // The orchestrator closes; the tester child is the one whose shell changed the product.
  const closed = registry.get('taskboard').close(cwd, { id: 'task-child', chatId: 'chat-1', parentSessionId: 'root', result: { summary: 'accepted', evidence: ['node x'] } })
  assert.equal(closed.ok, false, 'a row whose CHILD shell changed the product was closed')
  assert.equal(closed.code, 'product_shell_violation', JSON.stringify(closed))
  assert.match(closed.message, /sess-tester/)
})
