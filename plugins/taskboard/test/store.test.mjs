/**
 * PROOF: the board read as snapshot + journal tail equals the old export byte for byte, and a
 * damaged snapshot is rebuilt from the journal instead of losing rows.
 * Behavior: createStore().load() folds snapshot + tail into the same bytes the old write path
 *   wrote to taskboard.json; migrate() builds the snapshot and the genesis event without
 *   rewriting the export; a truncated snapshot or a journal without its genesis falls back and
 *   names the error in the log.
 * Fails when: the fold reorders or drops tasks, migration rewrites the export, a damaged
 *   snapshot is read as an empty or partial board, or a fallback silently returns nothing.
 * Production path: plugins/taskboard/lib/store.mjs, which taskboard.mjs is to read and write the
 *   board through.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createStore, exportText, SNAPSHOT_EVERY } from '../lib/store.mjs'

const row = (id, title, revision = 1) => ({
  id,
  title,
  objective: '',
  status: 'open',
  priority: 'normal',
  revision,
  timeline: [{ at: '2026-01-01T00:00:00.000Z', kind: 'created', actor: 'human', text: 'opened' }],
})

const withBoard = (board, run) => {
  const dir = mkdtempSync(join(tmpdir(), 'store-test-'))
  try {
    mkdirSync(join(dir, '.dsh'), { recursive: true })
    const path = join(dir, '.dsh', 'taskboard.json')
    writeFileSync(path, `${JSON.stringify(board, null, 2)}\n`)
    return run({ dir, path, store: (logger) => createStore({ boardPath: path, logger: logger ?? { warn() {} } }) })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const board = { version: 1, revision: 3, tasks: [row('task-a', 'first'), row('task-b', 'second')], agents: [{ role: 'BACKEND', sessionId: 'session-1' }] }

test('a workspace with only the export migrates, and the export is not rewritten', () => {
  withBoard(board, ({ path, store }) => {
    const before = readFileSync(path)
    const result = store().migrate()
    assert.equal(result.migrated, true)
    assert.equal(result.genesis, true)
    assert.equal(result.exportUnchanged, true)
    assert.ok(before.equals(readFileSync(path)), 'the derived export changed during migration')
    assert.equal(exportText(store().load().board), before.toString('utf8'))
  })
})

test('an event appended after the snapshot folds into the export the old write path would have written', () => {
  withBoard(board, ({ path, store }) => {
    const one = store()
    one.migrate()
    const changed = { ...board.tasks[0], title: 'renamed', revision: 2 }
    one.append({ at: '2026-01-02T00:00:00.000Z', op: 'update', revision: 4, rows: [changed], removed: [] })
    const expected = { ...board, revision: 4, tasks: [changed, board.tasks[1]] }
    assert.equal(exportText(one.load().board), `${JSON.stringify(expected, null, 2)}\n`)
    assert.equal(one.load().board.tasks.length, 2)
    assert.equal(readFileSync(path, 'utf8'), `${JSON.stringify(board, null, 2)}\n`, 'reading and folding wrote the export')
  })
})

test('a removed id and a new id keep the export order and the removed row leaves', () => {
  withBoard(board, ({ store }) => {
    const one = store()
    one.migrate()
    one.append({ at: '2026-01-02T00:00:00.000Z', op: 'remove', revision: 4, rows: [], removed: ['task-a'] })
    one.append({ at: '2026-01-03T00:00:00.000Z', op: 'create', revision: 5, rows: [row('task-c', 'third')], removed: [] })
    const folded = one.load().board
    assert.deepEqual(folded.tasks.map((task) => task.id), ['task-b', 'task-c'])
    assert.equal(folded.revision, 5)
  })
})

test('a truncated snapshot rebuilds the board from the journal and names the error', () => {
  withBoard(board, ({ path, store }) => {
    const one = store()
    one.migrate()
    const warnings = []
    const text = readFileSync(one.paths.snapshot, 'utf8')
    writeFileSync(one.paths.snapshot, text.slice(0, Math.floor(text.length / 2)))
    const loaded = createStore({ boardPath: path, logger: { warn: (message) => warnings.push(message) } }).load()
    assert.equal(loaded.source, 'recovered')
    assert.match(warnings[0] ?? '', /snapshot .* is unreadable .*rebuilding the board from the journal/)
    assert.equal(exportText(loaded.board), readFileSync(path, 'utf8'))
  })
})

test('a journal without its genesis falls back to the export and says why', () => {
  withBoard(board, ({ path, store }) => {
    const one = store()
    one.migrate()
    writeFileSync(one.paths.events, `${JSON.stringify({ at: '2026-01-02T00:00:00.000Z', op: 'update', revision: 4, rows: [row('task-a', 'renamed')], removed: [] })}\n`)
    // The snapshot is the only other witness; break it so the journal has to answer alone.
    writeFileSync(one.paths.snapshot, '{ "version": 1, "board": {')
    const warnings = []
    const loaded = createStore({ boardPath: path, logger: { warn: (message) => warnings.push(message) } }).load()
    assert.equal(loaded.source, 'export')
    assert.match(warnings.join(' '), /no genesis event/)
    assert.equal(exportText(loaded.board), readFileSync(path, 'utf8'))
  })
})

test('a workspace with neither snapshot nor journal reads the export', () => {
  withBoard(board, ({ path, store }) => {
    const loaded = store().load()
    assert.equal(loaded.source, 'export')
    assert.equal(exportText(loaded.board), readFileSync(path, 'utf8'))
  })
})

test('the tail is counted so the snapshot is written past its threshold', () => {
  withBoard(board, ({ store }) => {
    const one = store()
    one.migrate()
    for (let index = 0; index < SNAPSHOT_EVERY; index += 1) one.append({ at: '2026-01-02T00:00:00.000Z', op: 'note', revision: 4 + index, rows: [], removed: [] })
    assert.equal(one.tailLength(), SNAPSHOT_EVERY)
    one.writeSnapshot(one.load().board)
    assert.equal(one.tailLength(), 0)
  })
})
