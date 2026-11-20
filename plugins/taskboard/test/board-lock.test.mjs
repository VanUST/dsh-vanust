/*
PROOF: two processes writing one board both land their tasks, because the read and the write are one locked step
Behavior: two REAL node processes (spawned, not threads) create tasks through the plugin's own
  createService against one .dsh/taskboard.json at the same time. Every task both processes were
  told to create is in the file afterwards, with no duplicate id, and no .lock directory is left
  behind. A lock directory left by a process that died (its mtime is older than lockStaleMs) is
  taken over instead of blocking the board forever; a lock held inside the wait window makes the
  second writer WAIT and then write, never overwrite.
Fails when: the read-modify-write is not under the cross-process lock - the later rename replaces
  a board read before the earlier writer's rows, so one process's tasks disappear from the file.
Production path: plugins/taskboard/taskboard.mjs (withBoardLock, mutate, writeBoardNow,
  writeBoard, createService).
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync, existsSync } from 'node:fs'
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
const WRITER = join(KIT, 'plugins', 'taskboard', 'test', 'fixtures', 'board-writer.mjs')

const workspace = () => mkdtempSync(join(tmpdir(), 'taskboard-lock-'))
const boardPath = (dir) => join(dir, '.dsh', 'taskboard.json')
const rowsOf = (dir) => {
  const raw = readFileSync(boardPath(dir), 'utf8')
  return JSON.parse(raw).tasks
}
const runWriter = (dir, prefix, count) => new Promise((done, fail) => {
  const child = spawn(process.execPath, [
    WRITER, '--module', MODULE, '--dir', dir, '--links', join(dir, `links-${prefix}.json`), '--prefix', prefix, '--count', String(count),
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  let err = ''
  child.stdout.on('data', (chunk) => { out += chunk })
  child.stderr.on('data', (chunk) => { err += chunk })
  child.on('error', fail)
  child.on('close', (code) => done({ code, out, err }))
})

test('two processes create into one board and every task is there', async () => {
  const dir = workspace()
  mkdirSync(join(dir, '.dsh'), { recursive: true })
  writeFileSync(boardPath(dir), JSON.stringify({ version: 1, revision: 0, tasks: [], agents: [] }, null, 2))
  const each = 25
  const [left, right] = await Promise.all([runWriter(dir, 'left', each), runWriter(dir, 'right', each)])
  assert.equal(left.code, 0, `left writer failed: ${left.err}`)
  assert.equal(right.code, 0, `right writer failed: ${right.err}`)
  const rows = rowsOf(dir)
  const titles = rows.map((row) => row.title)
  const lost = [...Array(each).keys()].flatMap((index) => [`left-${index}`, `right-${index}`]).filter((title) => !titles.includes(title))
  assert.deepEqual(lost, [], `${lost.length} task(s) were lost by the two-process write; the board kept ${rows.length} of ${each * 2}`)
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, 'duplicate task id in the board')
  assert.equal(existsSync(`${boardPath(dir)}.lock`), false, 'the board lock was not released')
  rmSync(dir, { recursive: true, force: true })
})

test('a lock left by a dead process is taken over once it is stale', async () => {
  const dir = workspace()
  mkdirSync(join(dir, '.dsh'), { recursive: true })
  writeFileSync(boardPath(dir), JSON.stringify({ version: 1, revision: 0, tasks: [], agents: [] }, null, 2))
  const lock = `${boardPath(dir)}.lock`
  mkdirSync(lock)
  const old = new Date(Date.now() - 10 * 60 * 1000)
  utimesSync(lock, old, old)
  const written = await runWriter(dir, 'after-stale', 3)
  assert.equal(written.code, 0, `the writer refused after a stale lock: ${written.err}`)
  assert.equal(rowsOf(dir).length, 3)
  assert.equal(existsSync(lock), false, 'the stale lock was not released after the write')
  rmSync(dir, { recursive: true, force: true })
})

test('a writer waits for a lock that is still inside its wait window and then writes', async () => {
  const dir = workspace()
  mkdirSync(join(dir, '.dsh'), { recursive: true })
  writeFileSync(boardPath(dir), JSON.stringify({ version: 1, revision: 0, tasks: [], agents: [] }, null, 2))
  const lock = `${boardPath(dir)}.lock`
  mkdirSync(lock)
  // A lock this young belongs to a living writer: the second writer must wait for it, not
  // rewrite the board underneath it.
  const started = Date.now()
  const writer = runWriter(dir, 'waited', 1)
  await new Promise((done) => setTimeout(done, 400))
  assert.equal(existsSync(lock), true, 'the waiting writer released a lock it did not hold')
  assert.equal(existsSync(boardPath(dir)) && rowsOf(dir).length, 0, 'the waiting writer wrote the board while the lock was held')
  rmSync(lock, { recursive: true, force: true })
  const written = await writer
  assert.equal(written.code, 0, `the waiting writer failed: ${written.err}`)
  assert.ok(Date.now() - started >= 400, 'the writer did not wait for the held lock')
  assert.equal(rowsOf(dir).length, 1)
  rmSync(dir, { recursive: true, force: true })
})

test('the exported writeBoard takes the lock too', async () => {
  const dir = workspace()
  mkdirSync(join(dir, '.dsh'), { recursive: true })
  const { writeBoard } = await import(pathToFileURL(MODULE).href)
  writeBoard(boardPath(dir), { version: 1, revision: 1, tasks: [{ id: 'task-a', revision: 1, title: 'a', status: 'open' }], agents: [] })
  assert.equal(rowsOf(dir).length, 1)
  assert.equal(existsSync(`${boardPath(dir)}.lock`), false, 'writeBoard left its lock behind')
  assert.ok(statSync(boardPath(dir)).size > 0)
  rmSync(dir, { recursive: true, force: true })
})
