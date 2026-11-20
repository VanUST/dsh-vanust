/*
PROOF: a task closes when its linked child disappeared with its process, and the board load settles it
Behavior: the runtime, not the arrival of subagent/end, decides whether a linked child is alive.
  A task whose child the runtime no longer holds closes through the ordinary acceptance path:
  status done, result recorded, the child row marked settled, the role row freed, and the
  disappearance named in the result and the timeline - no force flag and no lost acceptance.
  The first read of a board in a process settles active rows whose linked children have
  disappeared (status review with a reconciled timeline entry), while an active row whose child
  the runtime still runs is left exactly as it is.
Fails when: the close asks the runtime to interrupt a child it no longer holds (measured:
  "Cannot read properties of undefined (reading 'id')"), which turns every such close into
  interrupt_failed; or the load path never reconciles; or the load path settles a row whose
  child is running.
Production path: plugins/taskboard/taskboard.mjs (interruptChildren, closeOne, reconcileTasks,
  the load-time sweep, and the childLiveness hook in apply).
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
/** The pre-fix module the case library's negative control runs, copied from git HEAD. */
const RED_FIRST = join(KIT, '.dsh', 'red-first', 'taskboard.mjs')
/** The module under test; TASKBOARD_MODULE points the same test at a previous revision. */
const MODULE = process.env.TASKBOARD_MODULE !== undefined && process.env.TASKBOARD_MODULE !== ''
  ? resolve(process.env.TASKBOARD_MODULE)
  : process.env.CASE_NEGATIVE_CONTROL === 'expect-pre-fix'
    ? RED_FIRST
    : join(KIT, 'plugins', 'taskboard', 'taskboard.mjs')
// A missing pre-fix module must FAIL the control, never silently run the fixed module: a
// control that tests the fix would report the regression as caught while proving nothing.
if (process.env.CASE_NEGATIVE_CONTROL === 'expect-pre-fix' && !existsSync(MODULE)) {
  throw new Error(`CASE_NEGATIVE_CONTROL=expect-pre-fix needs the pre-fix module at ${MODULE}; copy it with: git show HEAD:plugins/taskboard/taskboard.mjs > .dsh/red-first/taskboard.mjs`)
}
const { apply } = await import(pathToFileURL(MODULE).href)

const AT = '2026-01-05T00:00:00.000Z'

/** A board row in review whose one linked child is dead unless the roster says otherwise. */
function reviewBoard(childId = 'child-gone') {
  return {
    version: 1,
    revision: 7,
    tasks: [{
      id: 'task-dead',
      revision: 2,
      title: 'work whose child died',
      status: 'review',
      priority: 'normal',
      role: 'BACKEND',
      preset: 'backend',
      chatId: 'chat-1',
      parentSessionId: 'root',
      childSessionIds: [childId],
      children: [{ sessionId: childId, label: 'BACKEND', role: 'BACKEND', status: 'active', startedAt: AT }],
      createdAt: AT,
      updatedAt: AT,
    }],
    agents: [{
      role: 'BACKEND',
      label: 'BACKEND',
      sessionId: childId,
      status: 'active',
      currentTaskId: 'task-dead',
      taskCount: 1,
      preset: 'backend',
      chatId: 'chat-1',
      createdAt: AT,
      updatedAt: AT,
    }],
  }
}

/** An active row whose linked child never wrote its own settle. */
function activeBoard(childId = 'child-gone') {
  const board = reviewBoard(childId)
  board.tasks[0].status = 'active'
  delete board.tasks[0].result
  return board
}

/**
 * The plugin applied to a fake Host: `agents` is a registry with BOTH `get` and `list` (the
 * roster is what proves a child absent), and `subagents.interrupt` reproduces the runtime's
 * behaviour on a target it does not hold - it throws while reading the absent session.
 */
function harness(board, roster) {
  const dir = mkdtempSync(join(tmpdir(), 'taskboard-dead-child-'))
  const boardPath = join(dir, 'taskboard.json')
  mkdirSync(join(dir, '.dsh'), { recursive: true })
  writeFileSync(boardPath, JSON.stringify(board, null, 2) + '\n')
  const root = { id: 'root', session: { header: { cwd: dir } } }
  const live = new Map(roster.map((entry) => [entry.id, entry]))
  live.set(root.id, { ...root, status: 'running' })
  const interrupts = []
  const agents = {
    get(id) { return live.get(id) },
    list() { return [...live.values()] },
  }
  const subagents = {
    interrupt(target) {
      interrupts.push(target)
      if (!live.has(target)) throw new TypeError("Cannot read properties of undefined (reading 'id')")
      const entry = live.get(target)
      if (entry.refuse === true) throw new Error('UNAUTHORIZED: target is not a live descendant')
    },
  }
  const registry = new Map()
  const ctx = {
    logger: { warn() {}, info() {} },
    provide(name, service) { registry.set(name, service); return service },
    effect(fn) { fn(); return () => {} },
    on() {},
    get(name) {
      if (name === 'agents') return agents
      if (name === 'subagents') return subagents
      return undefined
    },
    tools: { register() { return () => {} } },
    commands: { register() { return () => {} } },
  }
  apply(ctx, { file: boardPath, linksFile: join(dir, 'links.json'), lockWaitMs: 5000 })
  const stored = () => JSON.parse(readFileSync(boardPath, 'utf8'))
  return { dir, service: registry.get('taskboard'), interrupts, stored }
}

test('a review task closes when its child disappeared, keeping the acceptance', () => {
  const { dir, service, interrupts, stored } = harness(reviewBoard(), [])
  const closed = service.close(dir, {
    id: 'task-dead',
    chatId: 'chat-1',
    parentSessionId: 'root',
    result: { summary: 'The work is accepted; the child had died with its process.', evidence: ['node --test plugins/taskboard/test/dead-child-close.test.mjs'] },
  })
  assert.equal(closed.ok, true, JSON.stringify(closed))
  assert.equal(closed.task.status, 'done', JSON.stringify(closed))
  assert.equal(closed.task.result.summary, 'The work is accepted; the child had died with its process.')
  assert.deepEqual(interrupts, [], 'the runtime was asked to interrupt a child it does not hold')
  assert.equal(JSON.stringify(closed.gone), JSON.stringify([{ childId: 'child-gone', state: 'gone' }]), JSON.stringify(closed.gone))
  const saved = stored()
  const row = saved.tasks.find((entry) => entry.id === 'task-dead')
  assert.equal(row.status, 'done')
  assert.equal(row.children[0].status, 'sleeping', 'the dead child row was not marked settled')
  const role = saved.agents.find((entry) => entry.sessionId === 'child-gone')
  assert.equal(role.currentTaskId, null, 'the role stayed leased to the closed task')
  assert.equal(role.status, 'sleeping')
  assert.ok(row.timeline.some((entry) => entry.kind === 'closed' && entry.text.includes('had disappeared')), JSON.stringify(row.timeline))
})

test('a running child is still interrupted before the task closes', () => {
  const { dir, service, interrupts } = harness(reviewBoard('child-live'), [{ id: 'child-live', status: 'running' }])
  const closed = service.close(dir, {
    id: 'task-dead',
    chatId: 'chat-1',
    parentSessionId: 'root',
    result: { summary: 'Accepted with the child stopped.', evidence: ['node --test plugins/taskboard/test/dead-child-close.test.mjs'] },
  })
  assert.equal(closed.ok, true, JSON.stringify(closed))
  assert.deepEqual(interrupts, ['child-live'], 'a live child was settled instead of stopped')
})

test('a child the runtime holds but will not stop still fails the close', () => {
  const { dir, service, stored } = harness(reviewBoard('child-bad'), [{ id: 'child-bad', status: 'running', refuse: true }])
  const closed = service.close(dir, {
    id: 'task-dead',
    chatId: 'chat-1',
    parentSessionId: 'root',
    result: { summary: 'Should not be accepted.', evidence: ['proof'] },
  })
  assert.equal(closed.ok, false, JSON.stringify(closed))
  assert.equal(closed.code, 'interrupt_failed', JSON.stringify(closed))
  assert.equal(stored().tasks.find((entry) => entry.id === 'task-dead').status, 'review')
})

test('loading the board settles an active task whose child disappeared', () => {
  const { dir, service, stored } = harness(activeBoard(), [])
  const listed = service.list(dir, { chatId: 'chat-1' })
  assert.equal(listed.length, 1)
  const row = stored().tasks.find((entry) => entry.id === 'task-dead')
  assert.equal(row.status, 'review', `the load-time sweep left the row ${row.status}`)
  assert.ok(row.timeline.some((entry) => entry.kind === 'reconciled' && entry.text.includes('disappeared')), JSON.stringify(row.timeline))
  assert.equal(service.get(dir, 'task-dead').status, 'review')
})

test('a load never settles a row whose child the runtime still runs', () => {
  const { dir, service, stored } = harness(activeBoard('child-live'), [{ id: 'child-live', status: 'running' }])
  service.list(dir, { chatId: 'chat-1' })
  const row = stored().tasks.find((entry) => entry.id === 'task-dead')
  assert.equal(row.status, 'active', 'a running child was settled by a read')
  assert.equal((row.timeline ?? []).some((entry) => entry.kind === 'reconciled'), false)
})
