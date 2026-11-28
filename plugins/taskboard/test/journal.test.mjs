/*
PROOF: a task row edited by hand after the journal saw it is refused, an old row still closes, and
no second row journal is written for new changes.
Behavior: every change writes ONE event to the change journal beside the board
  (taskboard.events.ndjson): {at, op, revision, rows, removed, check:{prev, hash, rows}} where
  check.rows maps each written row to its sha256, check.hash covers the event and check.prev chains
  it to the previous event. The close verifies the row against that record (and against the legacy
  .dsh/taskboard-journal.ndjson for a row it never wrote). A row EDITED after its last event is
  TASK_JOURNAL_MISMATCH. A row with no event at all (a board written before both journals, a
  fixture) is legacy and closes normally. The legacy journal receives no new events: the change and
  its verification data are one record, not two that can fall out of step.
Fails when: an edited row still closes, a legacy row is refused, a write does not chain, or a new
  change is appended to the legacy row journal again.
Production path: plugins/taskboard/lib/store.mjs (the event and its check), lib/journal.mjs (the
  legacy reader) and taskboard.mjs (close, readBoard).
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../taskboard.mjs'

const now = '2026-01-05T00:00:00.000Z'

function harness(board) {
  const cwd = mkdtempSync(join(tmpdir(), 'taskboard-journal-'))
  mkdirSync(join(cwd, '.dsh'), { recursive: true })
  const boardPath = join(cwd, 'taskboard.json')
  if (board !== undefined) writeFileSync(boardPath, JSON.stringify(board, null, 2) + '\n')
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
  const editRow = (id, change) => {
    const boardNow = JSON.parse(readFileSync(boardPath, 'utf8'))
    const row = boardNow.tasks.find((task) => task.id === id)
    Object.assign(row, change)
    writeFileSync(boardPath, JSON.stringify(boardNow, null, 2) + '\n')
  }
  return { cwd, service, editRow }
}

/** The change journal beside the configured board file (lib/store.mjs pathsFor). */
const journal = (cwd) => {
  const path = join(cwd, 'taskboard.events.ndjson')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').trim().split('\n').filter((line) => line !== '').map((line) => JSON.parse(line))
}

const closeArgs = (cwd, id) => ({ id, chatId: 'chat-1', parentSessionId: 'root', result: { summary: 'done', evidence: ['node x'] } })

test('each write appends one chained event to the change journal', () => {
  const { cwd, service } = harness()
  const created = service.create(cwd, { title: 'The row', role: 'BACKEND', preset: 'backend', chatId: 'chat-1' })
  assert.equal(typeof created.id, 'string', JSON.stringify(created))
  const events = journal(cwd)
  assert.equal(events.length, 1)
  assert.equal(events[0].op, 'genesis')
  assert.equal(events[0].check.prev, 'genesis')
  assert.equal(typeof events[0].check.rows[created.id], 'string')
  const second = service.create(cwd, { title: 'The second row', role: 'BACKEND', preset: 'backend', chatId: 'chat-1' })
  assert.equal(typeof second.id, 'string', JSON.stringify(second))
  const after = journal(cwd)
  assert.equal(after.length, 2)
  assert.equal(after[1].check.prev, after[0].check.hash)
  assert.notEqual(after[1].check.hash, after[0].check.hash)
  // One record carries the change and its verification; the legacy row journal gets no new event.
  assert.equal(existsSync(join(cwd, '.dsh', 'taskboard-journal.ndjson')), false)
})

test('a row edited after its last event is refused by the close', () => {
  const { cwd, service, editRow } = harness()
  const created = service.create(cwd, { title: 'The row', role: 'BACKEND', preset: 'backend', chatId: 'chat-1' })
  editRow(created.id, { title: 'The row, quietly edited' })
  const refused = service.close(cwd, closeArgs(cwd, created.id))
  assert.equal(refused.ok, false, 'an edited row was closed')
  assert.equal(refused.code, 'TASK_JOURNAL_MISMATCH', JSON.stringify(refused))
  assert.match(refused.message, /journal/)
})

test('a row the journal never saw is legacy and closes normally', () => {
  const { cwd, service } = harness({ version: 1, revision: 1, tasks: [{ id: 'task-old', revision: 1, title: 'old', status: 'review', priority: 'normal', chatId: 'chat-1', caseIds: [], childSessionIds: [], createdAt: now, updatedAt: now }], agents: [] })
  const closed = service.close(cwd, closeArgs(cwd, 'task-old'))
  assert.equal(closed.ok, true, JSON.stringify(closed))
})
