/*
PROOF: a task row edited by hand after the journal saw it is refused, and an old row still closes
Behavior: every create/update/close appends a chained event to .dsh/taskboard-journal.ndjson
  ({ts, kind, id, payloadHash, prevHash, hash}); the close verifies the chain and the row's last
  event, and a row EDITED after its last event is TASK_JOURNAL_MISMATCH. A row with no event at all
  (a board written before the journal, a fixture) is legacy and closes normally. Tamper-EVIDENT,
  not a signature.
Fails when: an edited row still closes, a legacy row is refused, or a second write does not chain.
Production path: plugins/taskboard/lib/journal.mjs (appendRowEvent, checkRow) and taskboard.mjs
  (create/update/close).
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
  const journal = () => {
    try {
      return readFileSync(join(cwd, '.dsh', 'taskboard-journal.ndjson'), 'utf8').trim().split('\n').filter((line) => line !== '').map((line) => JSON.parse(line))
    } catch {
      return []
    }
  }
  const editRow = (id, change) => {
    const boardNow = JSON.parse(readFileSync(boardPath, 'utf8'))
    const row = boardNow.tasks.find((task) => task.id === id)
    Object.assign(row, change)
    writeFileSync(boardPath, JSON.stringify(boardNow, null, 2) + '\n')
  }
  return { cwd, service, journal, editRow }
}

const closeArgs = (cwd, id) => ({ id, chatId: 'chat-1', parentSessionId: 'root', result: { summary: 'done', evidence: ['node x'] } })

test('each write appends one chained event', () => {
  const { cwd, service, journal } = harness()
  const created = service.create(cwd, { title: 'The row', role: 'BACKEND', preset: 'backend', chatId: 'chat-1' })
  assert.equal(typeof created.id, 'string', JSON.stringify(created))
  const events = journal()
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'create')
  assert.equal(events[0].prevHash, 'genesis')
  const second = service.create(cwd, { title: 'The second row', role: 'BACKEND', preset: 'backend', chatId: 'chat-1' })
  assert.equal(typeof second.id, 'string', JSON.stringify(second))
  const after = journal()
  assert.equal(after.length, 2)
  assert.equal(after[1].prevHash, after[0].hash)
  assert.notEqual(after[1].hash, after[0].hash)
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
