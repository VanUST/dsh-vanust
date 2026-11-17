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
