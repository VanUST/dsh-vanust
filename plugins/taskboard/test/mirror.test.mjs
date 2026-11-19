/*
PROOF: taskboard requires a requirement and mirrors TASK into the state core
Behavior: with a project-state core mounted, task_create refuses a task that has neither a
  reqId nor chore:true with a non-empty choreReason (code req_required, nothing written);
  an accepted task is mirrored into state/task/ with its status, reqId (or chore+reason) and
  boardId, and a later update updates the SAME TASK file; the projections are regenerated so
  board.md lists the task and index.json carries it with its reqId. Without the core the old
  taskboard behaviour is unchanged.
Fails when: a requirement-less task is accepted, a repeat update creates a second TASK, the
  mirror loses the status/reqId, or the no-core composition starts refusing tasks.
Production path: plugins/taskboard/taskboard.mjs (create/update) with mirror.mjs and the
  ccProjectState service of @cc/dsh-project-state.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStateService } from '../../project-state/lib/core.mjs'
import { mirrorTask } from '../mirror.mjs'
import { createService } from '../taskboard.mjs'

const clock = () => '2026-01-05T00:00:00.000Z'
const logger = { warn() {}, info() {}, error() {} }

async function board() {
  const cwd = await mkdtemp(join(tmpdir(), 'taskboard-mirror-'))
  const core = createStateService({ cwd, now: clock })
  const pending = []
  const service = createService({ file: '.dsh/taskboard.json' }, logger, {
    rootOf: () => 'chat-1',
    mirrorActive: () => true,
    // The runtime view the plugin passes in production; the test names one live child.
    liveSession: (id) => (id === 'sess-live' ? true : id === 'sess-idle' ? false : undefined),
    // The harness has no subagent runtime; a cancel that must stop children is a no-op here.
    interrupt: () => {},
    mirror: (dir, task) => {
      const run = (async () => {
        const result = await mirrorTask(core, { cwd: dir, task })
        await core.regenerateViews()
        return result
      })()
      pending.push(run)
      return run
    },
  })
  const flush = async () => { await Promise.all(pending.splice(0)) }
  return { cwd, core, service, flush }
}

test('a task without reqId and without chore+reason is refused before anything is written', async () => {
  const { cwd, service, flush } = await board()
  const refused = service.create(cwd, { title: 'No requirement', role: 'BACKEND', chatId: 'chat-1' })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'req_required')
  const tasks = await readdir(join(cwd, 'state', 'task')).catch(() => [])
  assert.deepEqual(tasks, [])
})

test('a task with reqId becomes one TASK and the board projection lists it', async () => {
  const { cwd, service, flush } = await board()
  const created = service.create(cwd, { title: 'Mirror me', role: 'BACKEND', reqId: 'REQ-007', chatId: 'chat-1' })
  await flush()
  assert.equal(created.ok, undefined)
  assert.equal(created.reqId, 'REQ-007')
  const files = await readdir(join(cwd, 'state', 'task'))
  assert.deepEqual(files, ['TASK-001.md'])
  const text = await readFile(join(cwd, 'state', 'task', 'TASK-001.md'), 'utf8')
  assert.match(text, new RegExp(`boardId: ${created.id}`))
  assert.match(text, /reqId: REQ-007/)
  assert.match(text, /status: open/)
  const boardFile = await readFile(join(cwd, 'state', 'views', 'board.md'), 'utf8')
  assert.match(boardFile, /TASK-001/)
  assert.match(boardFile, /Mirror me/)
  const index = JSON.parse(await readFile(join(cwd, 'state', 'views', 'index.json'), 'utf8'))
  assert.deepEqual(index.tasks.map((row) => row.id), ['TASK-001'])
  assert.equal(index.tasks[0].reqId, 'REQ-007')
})

test('a chore needs a non-empty reason, and then becomes a TASK without reqId', async () => {
  const { cwd, service, flush } = await board()
  const refused = service.create(cwd, { title: 'Chore', role: 'BACKEND', chore: true, chatId: 'chat-1' })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'req_required')
  const created = service.create(cwd, { title: 'Chore', role: 'BACKEND', chore: true, choreReason: 'doc rot', chatId: 'chat-1' })
  await flush()
  assert.equal(created.chore, true)
  const text = await readFile(join(cwd, 'state', 'task', 'TASK-001.md'), 'utf8')
  assert.match(text, /chore: true/)
  assert.match(text, /choreReason: "?doc rot"?/)
  assert.equal(text.includes('reqId:'), false)
})

test('an update of the board task updates the SAME TASK file', async () => {
  const { cwd, service, flush } = await board()
  const created = service.create(cwd, { title: 'Move me', role: 'BACKEND', reqId: 'REQ-007', chatId: 'chat-1' })
  await flush()
  const updated = service.update(cwd, { id: created.id, expectedRevision: 1, patch: { status: 'active' }, chatId: 'chat-1' })
  await flush()
  assert.equal(updated.ok, true, JSON.stringify(updated))
  const files = await readdir(join(cwd, 'state', 'task'))
  assert.deepEqual(files, ['TASK-001.md'], 'no second TASK')
  const text = await readFile(join(cwd, 'state', 'task', 'TASK-001.md'), 'utf8')
  assert.match(text, /status: active/)
  assert.match(text, /revision: 2/)
  const index = JSON.parse(await readFile(join(cwd, 'state', 'views', 'index.json'), 'utf8'))
  assert.equal(index.tasks[0].status, 'active')
})

test('without the core the old taskboard behaviour is unchanged', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'taskboard-no-core-'))
  const service = createService({ file: '.dsh/taskboard.json' }, logger, { rootOf: () => 'chat-1' })
  const created = service.create(cwd, { title: 'Old behaviour', role: 'BACKEND', chatId: 'chat-1' })
  assert.equal(created.ok, undefined)
  assert.equal(typeof created.id, 'string')
  const tasks = await readdir(join(cwd, 'state', 'task')).catch(() => [])
  assert.deepEqual(tasks, [])
})

test('one task covers a batch of requirements and steps, and a micro-edit stays in it', async () => {
  // PROOF: a TASK is the unit of acceptance, not a micro-step. Behavior: task_create accepts a
  // non-empty reqIds plus steps, stores the batch, and task_update moves the progress without
  // creating a second task or asking for another reqId; the board projection shows done/total.
  // Fails when: the gate still insists on a single reqId, a step update needs a new task, or the
  // board has no progress column.
  const { cwd, service, flush } = await board()
  const created = service.create(cwd, { title: 'Batch two requirements', role: 'BACKEND', reqIds: ['REQ-007', 'REQ-008'], steps: ['edit', 'test', 'scan', 'report'], chatId: 'chat-1' })
  await flush()
  assert.equal(created.ok, undefined, JSON.stringify(created))
  assert.deepEqual(created.reqIds, ['REQ-007', 'REQ-008'])
  assert.equal(created.steps.length, 4)
  const moved = service.update(cwd, { id: created.id, expectedRevision: 1, patch: { stepsDone: 4 }, chatId: 'chat-1' })
  await flush()
  assert.equal(moved.ok, true, JSON.stringify(moved))
  const tasks = (await readdir(join(cwd, 'state', 'task')))
  assert.deepEqual(tasks, ['TASK-001.md'], 'no second task for a step update')
  const body = await readFile(join(cwd, 'state', 'task', 'TASK-001.md'), 'utf8')
  assert.match(body, /reqIds:/)
  assert.match(body, /stepsDone: 4/)
  const boardFile = await readFile(join(cwd, 'state', 'views', 'board.md'), 'utf8')
  assert.match(boardFile, /4\/4/)
})

test('the concrete task and the linked child session reach the TASK, and clearing follows', async () => {
  // PROOF: the board's task is the source of the register's concrete task and of the session
  // link the State panel opens. Behavior: task_create writes scope/nonScope/acceptance/role and
  // board assignee to the TASK; linkChild mirrors the child session into `sessions` and moves
  // the task active; an update that empties a scope clears it in the SAME TASK file.
  // Fails when: the mirror drops a field, the link is not mirrored (so Open has no id), or a
  // cleared line survives in the register.
  const { cwd, service, flush } = await board()
  const created = service.create(cwd, {
    title: 'Concrete mirror',
    role: 'BACKEND',
    reqId: 'REQ-007',
    chatId: 'chat-1',
    objective: 'Do the thing',
    scope: ['plugins/a', 'plugins/b'],
    nonScope: [':3080'],
    acceptance: [{ text: 'works', done: false }, { text: 'tested', done: true }],
  })
  assert.equal(typeof created.id, 'string')
  await flush()
  const before = await readFile(join(cwd, 'state', 'task', 'TASK-001.md'), 'utf8')
  assert.match(before, /scope:/)
  assert.match(before, /plugins\/a/)
  assert.match(before, /nonScope:/)
  assert.match(before, /acceptance:/)
  assert.match(before, /- text: works/)
  assert.match(before, /role: BACKEND/)

  const linked = service.linkChild(cwd, { id: created.id, sessionId: 'sess-1', label: 'BACKEND', role: 'BACKEND', chatId: 'chat-1' })
  assert.equal(linked.ok, true, JSON.stringify(linked))
  await flush()
  const withChild = await readFile(join(cwd, 'state', 'task', 'TASK-001.md'), 'utf8')
  assert.match(withChild, /status: active/)
  assert.match(withChild, /sessions:/)
  assert.match(withChild, /- sessionId: sess-1/)
  assert.match(withChild, /owner:/)
  assert.match(withChild, /sessionId: sess-1/)

  const updated = service.update(cwd, { id: created.id, expectedRevision: linked.task.revision, patch: { scope: [] }, chatId: 'chat-1' })
  assert.equal(updated.ok, true, JSON.stringify(updated))
  await flush()
  const after = await readFile(join(cwd, 'state', 'task', 'TASK-001.md'), 'utf8')
  assert.equal(/^scope:/m.test(after), false, 'an emptied scope is cleared')
  assert.ok(after.includes('plugins/b') === false)
})


test('the task list says which subagents are running NOW, not just the task status', async () => {
  // PROOF: a task stays `active` until it is accepted, so the status cannot tell a working
  // child from an idle one. Behavior: every linked child carries `running` from the runtime
  // and the row carries `runningChildSessionIds`; the same annotation is on task_get.
  // Fails when: the list keeps only the ledger's stale `active` child status, or reports an
  // idle child as running just because the task is active.
  const { cwd, service, flush } = await board()
  const created = service.create(cwd, { title: 'Delegated', role: 'BACKEND', reqId: 'REQ-007', chatId: 'chat-1' })
  await flush()
  const first = service.linkChild(cwd, { id: created.id, sessionId: 'sess-live', label: 'BACKEND', role: 'BACKEND', chatId: 'chat-1' })
  assert.equal(first.ok, true, JSON.stringify(first))
  const second = service.linkChild(cwd, { id: created.id, sessionId: 'sess-idle', label: 'CRITIC', role: 'CRITIC', chatId: 'chat-1' })
  assert.equal(second.ok, true, JSON.stringify(second))
  await flush()
  const row = service.list(cwd, { chatId: 'chat-1' }).find((task) => task.id === created.id)
  assert.equal(row.status, 'active')
  assert.deepEqual(row.runningChildSessionIds, ['sess-live'])
  assert.equal(row.children.find((child) => child.sessionId === 'sess-live').running, true)
  assert.equal(row.children.find((child) => child.sessionId === 'sess-idle').running, false)
  const got = service.get(cwd, created.id)
  assert.deepEqual(got.runningChildSessionIds, ['sess-live'])
  // A CLOSED TASK NEVER REPORTS A RUNNING CHILD, even when the reused session is live.
  const cancelled = service.cancel(cwd, { id: created.id, chatId: 'chat-1', actor: 'orchestrator' })
  assert.equal(cancelled.ok, true, JSON.stringify(cancelled))
  await flush()
  const closedRow = service.list(cwd, { chatId: 'chat-1' }).find((task) => task.id === created.id)
  assert.equal(closedRow.children.every((child) => child.running === false), true)
  assert.deepEqual(closedRow.runningChildSessionIds, [])
})

test('a lifecycle write mirrors: cancel and close reach the SAME TASK', async () => {
  // PROOF: the mirror used to run on create/update/linkChild only, so a task closed or
  // cancelled in the ledger read `review`/`active` in the register until a manual reconcile.
  // Behavior: cancel writes status cancelled to the TASK; close writes status done and the
  // result; no second TASK is created.
  const { cwd, service, flush } = await board()
  const cancelledTask = service.create(cwd, { title: 'Cancel me', role: 'BACKEND', reqId: 'REQ-007', chatId: 'chat-1' })
  await flush()
  const cancelled = service.cancel(cwd, { id: cancelledTask.id, chatId: 'chat-1', actor: 'orchestrator' })
  assert.equal(cancelled.ok, true, JSON.stringify(cancelled))
  await flush()
  const cancelledText = await readFile(join(cwd, 'state', 'task', 'TASK-001.md'), 'utf8')
  assert.match(cancelledText, /status: cancelled/)

  const closedTask = service.create(cwd, { title: 'Close me', role: 'BACKEND', reqId: 'REQ-008', chatId: 'chat-1' })
  await flush()
  const reviewed = service.update(cwd, {
    id: closedTask.id, expectedRevision: 1, chatId: 'chat-1',
    patch: { status: 'review', result: { summary: 'done', evidence: ['make verify'] } },
  })
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed))
  await flush()
  const closed = service.close(cwd, { id: closedTask.id, chatId: 'chat-1', actor: 'orchestrator' })
  assert.equal(closed.ok, true, JSON.stringify(closed))
  await flush()
  const closedText = await readFile(join(cwd, 'state', 'task', 'TASK-002.md'), 'utf8')
  assert.match(closedText, /status: done/)
  assert.match(closedText, /resultSummary: done/)
})

test('a lease transfer clears the session from the donor TASK', async () => {
  // PROOF: the donor kept the moved child's session in its mirror, so the panel offered Open
  // on a session another task owned. Behavior: after moving sess-1 from A to B, A's TASK has
  // no sessions and no owner.sessionId, B's TASK names it.
  const { cwd, service, flush } = await board()
  const a = service.create(cwd, { title: 'Task A', role: 'BACKEND', reqId: 'REQ-007', chatId: 'chat-1' })
  await flush()
  const b = service.create(cwd, { title: 'Task B', role: 'CRITIC', reqId: 'REQ-008', chatId: 'chat-1' })
  await flush()
  service.linkChild(cwd, { id: a.id, sessionId: 'sess-1', label: 'BACKEND', role: 'BACKEND', chatId: 'chat-1' })
  await flush()
  const moved = service.linkChild(cwd, { id: b.id, sessionId: 'sess-1', label: 'CRITIC', role: 'CRITIC', chatId: 'chat-1' })
  assert.equal(moved.ok, true, JSON.stringify(moved))
  await flush()
  const donor = await readFile(join(cwd, 'state', 'task', 'TASK-001.md'), 'utf8')
  const receiver = await readFile(join(cwd, 'state', 'task', 'TASK-002.md'), 'utf8')
  assert.equal(donor.includes('sess-1'), false, 'the donor no longer names the moved session')
  assert.ok(receiver.includes('sess-1'))
})
