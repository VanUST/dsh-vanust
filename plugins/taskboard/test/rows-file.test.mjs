/**
 * PROOF: the plugin keeps a small projection of the rows the panel draws, at most once per 2 s.
 * Behavior: after an operation .dsh/taskboard.rows.json holds every task id with only the
 *   fields a card draws, the board document is not rewritten, and a burst of operations costs
 *   at most one more write when the window closes.
 * Fails when: the projection misses a row, carries the timeline again (the 13 MB problem), is
 *   written per operation, or the board file changes instead.
 * Production path: taskboard.mjs scheduleRows()/writeRowsNow() called from mutate(), and
 *   client.js readBoard() reading the projection first.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply as register } from '../taskboard.mjs'

const apply = (dir, file, logger = { warn() {}, info() {} }) => {
  const registry = new Map()
  const ctx = {
    logger,
    provide(name, service) { registry.set(name, service); return service },
    effect(fn) { fn(); return () => {} },
    on() {},
    get() { return undefined },
    tools: { register() { return () => {} } },
    commands: { register() { return () => {} } },
  }
  register(ctx, { file, linksFile: join(dir, 'links.json'), lockWaitMs: 2000, maxRows: 0 })
  return registry.get('taskboard')
}

const workspace = (board) => {
  const dir = mkdtempSync(join(tmpdir(), 'taskboard-rows-'))
  mkdirSync(join(dir, '.dsh'), { recursive: true })
  const file = join(dir, '.dsh', 'taskboard.json')
  if (board !== undefined) writeFileSync(file, `${JSON.stringify(board, null, 2)}\n`)
  const service = apply(dir, file)
  return { dir, file, service, rows: join(dir, '.dsh', 'taskboard.rows.json') }
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms))

test('an operation writes the projection with the fields a card draws, not the timeline', async () => {
  const { dir, service, rows } = workspace()
  const created = service.create(dir, { title: 'Row one', role: 'BACKEND', preset: 'backend', chatId: 'chat-1' })
  assert.equal(typeof created.id, 'string', JSON.stringify(created))
  await wait(200)
  assert.ok(existsSync(rows), 'the projection was not written')
  const parsed = JSON.parse(readFileSync(rows, 'utf8'))
  assert.equal(parsed.tasks.length, 1)
  const row = parsed.tasks[0]
  assert.equal(row.id, created.id)
  assert.equal(row.title, 'Row one')
  assert.equal(row.status, 'open')
  assert.equal(row.timeline, undefined, 'the projection carries the timeline the panel does not draw')
  assert.equal(row.objective, undefined)
})

test('a burst of operations does not rewrite the projection for every operation', async () => {
  const { dir, service, rows } = workspace()
  service.create(dir, { title: 'First', role: 'BACKEND', preset: 'backend', chatId: 'chat-1' })
  await wait(150)
  const firstText = readFileSync(rows, 'utf8')
  const firstAt = statSync(rows).mtimeMs
  service.create(dir, { title: 'Second', role: 'BACKEND', preset: 'backend', chatId: 'chat-1' })
  await wait(300)
  assert.equal(readFileSync(rows, 'utf8'), firstText, 'the second operation rewrote the projection inside the window')
  assert.equal(statSync(rows).mtimeMs, firstAt)
  await wait(2100)
  const later = JSON.parse(readFileSync(rows, 'utf8'))
  assert.deepEqual(later.tasks.map((task) => task.title), ['First', 'Second'], 'the window never closed on the second row')
})

test('the projection is far smaller than the board it summarises', async () => {
  const timeline = Array.from({ length: 20 }, (_, at) => ({ at: '2026-01-01T00:00:00.000Z', kind: 'note', actor: 'human', text: 'entry ' + at + ' '.repeat(120) }))
  const tasks = Array.from({ length: 50 }, (_, at) => ({ id: `task-${at}`, title: `Title ${at}`, status: 'open', revision: 1, timeline, acceptance: [{ text: 'x'.repeat(400), done: false }] }))
  const { dir, rows, file } = workspace({ version: 1, revision: 1, tasks, agents: [] })
  const service = apply(dir, file)
  service.create(dir, { title: 'After', role: 'BACKEND', preset: 'backend', chatId: 'chat-1' })
  await wait(200)
  const boardBytes = statSync(file).size
  const rowBytes = statSync(rows).size
  assert.ok(rowBytes * 3 < boardBytes, `projection ${rowBytes} B is not far under the board ${boardBytes} B`)
})
