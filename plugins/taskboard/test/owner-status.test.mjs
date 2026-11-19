/*
PROOF: the owner changes a task status from the Project state panel, and the board has no row cap by default
Behavior: the /taskboard command accepts `op: "owner-status"` — the human's own status change: it takes the
  `expectedRevision` it read (compare-and-set), accepts any of the seven board statuses even where
  `transitionRefusal` would refuse the same move for an agent (open -> done, open -> review without a
  result), stops the linked children when the target is done, cancelled or paused, writes a `status`
  timeline entry with `actor: human`, mirrors the row into the TASK register, and records a
  `owner_status_override` waiver event in the state journal with from/to/reason/boardId/taskId. A wrong or
  missing revision writes nothing and names `stale`/`needs_revision`; an unknown status is `status_invalid`.
  Without a `maxRows` setting the board has NO row limit (a create past 1000 rows is accepted); an explicit
  `maxRows: N` still refuses with `board_rows_full`, and `maxRows: 0` means no limit.
Fails when: the owner-status op is missing (unknown_op), the lifecycle gate refuses the human, the CAS is
  skipped, a terminal move leaves a child running, the journal event is not written or loses from/to/reason,
  or the board still refuses a create at 1000 rows without a configured limit.
Production path: plugins/taskboard/taskboard.mjs (applyOp, setStatusOwner, createService, apply) with the
  ccProjectState core for the journal and the TASK mirror.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStateService } from '../../project-state/lib/core.mjs'
import { mirrorTask } from '../mirror.mjs'
import { createService, writeBoard } from '../taskboard.mjs'

const clock = () => '2026-01-05T00:00:00.000Z'
const logger = { warn() {}, info() {}, error() {} }
/** A create returns the task itself; a refusal returns {ok:false, code}. */
const accepted = (result) => result !== undefined && result !== null && result.ok !== false && result.code === undefined

async function board(config = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'taskboard-owner-status-'))
  const core = createStateService({ cwd, now: clock })
  const pending = []
  const interrupts = []
  const service = createService({ file: '.dsh/taskboard.json', ...config }, logger, {
    rootOf: () => 'chat-1',
    mirrorActive: () => true,
    interrupt(childId) {
      interrupts.push(childId)
    },
    mirror(dir, task) {
      const run = (async () => {
        const result = await mirrorTask(core, { cwd: dir, task })
        await core.regenerateViews()
        return result
      })()
      pending.push(run)
      return run
    },
    // The same call the plugin's apply() makes: the state journal is the trail the owner asked for.
    recordOwnerStatus(dir, event) {
      return core.journal({ code: 'owner_status_override', by: 'human', ...event })
    },
  })
  const flush = async () => { await Promise.all(pending.splice(0)) }
  return { cwd, core, service, flush, interrupts }
}

test('a create past 1000 rows is accepted when maxRows is not configured', async () => {
  const { cwd, service } = await board()
  const rows = Array.from({ length: 1000 }, (_, index) => ({
    id: `row-${index + 1}`,
    revision: 1,
    title: `row ${index + 1}`,
    status: 'done',
    createdAt: clock(),
    updatedAt: clock(),
  }))
  writeBoard(join(cwd, '.dsh', 'taskboard.json'), { version: 1, revision: 0, tasks: rows, agents: [] })
  const created = service.create(cwd, { title: 'row 1001', role: 'BACKEND', reqId: 'REQ-001', chatId: 'chat-1' })
  assert.equal(accepted(created), true, JSON.stringify(created))
  const stored = JSON.parse(await readFile(join(cwd, '.dsh', 'taskboard.json'), 'utf8'))
  assert.equal(stored.tasks.length, 1001)
})

test('an explicit maxRows still refuses, and 0 means no limit', async () => {
  const { cwd, service } = await board({ maxRows: 2 })
  assert.equal(accepted(service.create(cwd, { title: 'one', role: 'BACKEND', reqId: 'REQ-001', chatId: 'chat-1' })), true)
  assert.equal(accepted(service.create(cwd, { title: 'two', role: 'BACKEND', reqId: 'REQ-001', chatId: 'chat-1' })), true)
  const refused = service.create(cwd, { title: 'three', role: 'BACKEND', reqId: 'REQ-001', chatId: 'chat-1' })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'board_rows_full')

  // `0` is the explicit spelling of "no limit", and it must hold on a board that is already full.
  const unlimited = await board({ maxRows: 0 })
  writeBoard(join(unlimited.cwd, '.dsh', 'taskboard.json'), {
    version: 1,
    revision: 0,
    tasks: Array.from({ length: 1000 }, (_, index) => ({ id: `row-${index + 1}`, revision: 1, title: `row ${index + 1}`, status: 'done' })),
    agents: [],
  })
  assert.equal(accepted(unlimited.service.create(unlimited.cwd, { title: 'row 1001', role: 'BACKEND', reqId: 'REQ-001', chatId: 'chat-1' })), true)
})

test('the owner sets a status the lifecycle gates refuse the agent, and the trail is written', async () => {
  const { cwd, service, flush } = await board()
  const created = service.create(cwd, { title: 'Owner decides', role: 'BACKEND', reqId: 'REQ-001', chatId: 'chat-1' })
  assert.equal(accepted(created), true, JSON.stringify(created))
  const task = service.get(cwd, created.id)
  // The agent path refuses this exact move: done must come from review (use_close).
  const agentAttempt = service.update(cwd, { id: task.id, expectedRevision: task.revision, status: 'done', chatId: 'chat-1' })
  assert.equal(agentAttempt.ok, false)
  assert.equal(agentAttempt.code, 'use_close')

  const applied = await service.applyOp(cwd, { op: 'owner-status', id: task.id, expectedRevision: task.revision, status: 'done', reason: 'owner closed it' }, 'human', 'session-owner')
  await flush()
  assert.equal(applied.ok, true, JSON.stringify(applied))
  assert.equal(applied.from, 'open')
  assert.equal(applied.to, 'done')
  assert.equal(applied.task.status, 'done')
  const timeline = applied.task.timeline.at(-1)
  assert.equal(timeline.kind, 'status')
  assert.equal(timeline.actor, 'human')
  assert.match(timeline.text, /open/)
  assert.match(timeline.text, /done/)
  assert.match(timeline.text, /owner closed it/)

  // The journal event the owner asked for: code, from, to, reason, who, both ids.
  const journalText = await readFile(join(cwd, 'state', 'events.jsonl'), 'utf8')
  const events = journalText.trim().split('\n').map((line) => JSON.parse(line))
  const waiver = events.find((event) => event.code === 'owner_status_override')
  assert.ok(waiver !== undefined, 'no owner_status_override event in state/events.jsonl')
  assert.equal(waiver.kind, 'waiver')
  assert.equal(waiver.by, 'human')
  assert.equal(waiver.from, 'open')
  assert.equal(waiver.to, 'done')
  assert.equal(waiver.reason, 'owner closed it')
  assert.equal(waiver.boardId, task.id)
  assert.match(String(waiver.taskId ?? ''), /^TASK-\d+$/)

  // The mirror followed: the state TASK now says done.
  const stateTask = await readFile(join(cwd, 'state', 'task', `${waiver.taskId}.md`), 'utf8')
  assert.match(stateTask, /status: done/)
})

test('a terminal status stops the linked children', async () => {
  const { cwd, service, flush, interrupts } = await board()
  const created = service.create(cwd, { title: 'With a child', role: 'BACKEND', reqId: 'REQ-001', chatId: 'chat-1' })
  assert.equal(accepted(created), true, JSON.stringify(created))
  const linked = service.linkChild(cwd, { id: created.id, sessionId: 'sess-live', chatId: 'chat-1' })
  assert.equal(linked.ok, true, JSON.stringify(linked))
  const applied = await service.applyOp(cwd, { op: 'owner-status', id: created.id, expectedRevision: linked.task.revision, status: 'cancelled', reason: 'not needed' }, 'human', 'session-owner')
  await flush()
  assert.equal(applied.ok, true, JSON.stringify(applied))
  assert.deepEqual(interrupts, ['sess-live'])
})

test('a missing or stale revision writes nothing and names the refusal', async () => {
  const { cwd, service } = await board()
  const created = service.create(cwd, { title: 'CAS', role: 'BACKEND', reqId: 'REQ-001', chatId: 'chat-1' })
  assert.equal(accepted(created), true, JSON.stringify(created))
  const task = service.get(cwd, created.id)
  const before = await readFile(join(cwd, '.dsh', 'taskboard.json'), 'utf8')

  const missing = await service.applyOp(cwd, { op: 'owner-status', id: task.id, status: 'blocked' }, 'human', 'session-owner')
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'needs_revision')

  const stale = await service.applyOp(cwd, { op: 'owner-status', id: task.id, expectedRevision: task.revision + 7, status: 'blocked' }, 'human', 'session-owner')
  assert.equal(stale.ok, false)
  assert.equal(stale.code, 'stale')

  const invalid = await service.applyOp(cwd, { op: 'owner-status', id: task.id, expectedRevision: task.revision, status: 'finished' }, 'human', 'session-owner')
  assert.equal(invalid.ok, false)
  assert.equal(invalid.code, 'status_invalid')

  assert.equal(await readFile(join(cwd, '.dsh', 'taskboard.json'), 'utf8'), before)
  const journal = await readFile(join(cwd, 'state', 'events.jsonl'), 'utf8').catch(() => '')
  assert.equal(journal.includes('owner_status_override'), false)
})

test('the same status is a no-op, not a new revision', async () => {
  const { cwd, service } = await board()
  const created = service.create(cwd, { title: 'No-op', role: 'BACKEND', reqId: 'REQ-001', chatId: 'chat-1' })
  assert.equal(accepted(created), true, JSON.stringify(created))
  const task = service.get(cwd, created.id)
  const applied = await service.applyOp(cwd, { op: 'owner-status', id: task.id, expectedRevision: task.revision, status: 'open' }, 'human', 'session-owner')
  assert.equal(applied.ok, true)
  assert.equal(applied.unchanged, true)
  assert.equal(applied.task.revision, task.revision)
  const journal = await readFile(join(cwd, 'state', 'events.jsonl'), 'utf8').catch(() => '')
  assert.equal(journal.includes('owner_status_override'), false)
})
