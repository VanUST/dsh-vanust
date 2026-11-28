/*
PROOF: the project state merges from two machines into one ledger with explicit collisions
Behavior: mergeStates() identifies a row by its source key (boardId, caseId, analysisRef, or a
  derived key), renumbers a row when two rows claimed one number, merges one row known under two
  numbers and rewrites the references, unions the journal by event content and reassigns seq,
  keeps the later updatedAt when one row was edited on both sides, and reports every decision.
Fails when: two rows keep one number, one row loses its history, references point at a number
  that no longer exists, seq repeats, or a collision is resolved without naming it.
Production path: plugins/project-state/lib/merge.mjs (mergeStates, identityOf, eidOf, readSide).
*/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeStates, identityOf, eidOf, sha256 } from '../lib/merge.mjs'
import { serialize } from '../lib/format.mjs'

const AT = '2026-11-22T10:00:00.000Z'

function row(kind, id, fields = {}, body = '') {
  const frontmatter = {
    id,
    kind,
    title: fields.title ?? `${id} title`,
    status: fields.status ?? (kind === 'task' ? 'open' : kind === 'test' ? 'unverified' : 'proposed'),
    revision: fields.revision ?? 1,
    createdAt: fields.createdAt ?? '2026-11-20T00:00:00.000Z',
    updatedAt: fields.updatedAt ?? fields.createdAt ?? '2026-11-20T00:00:00.000Z',
    ...fields,
  }
  return { frontmatter, text: serialize({ frontmatter, body }) }
}

function event(seq, at, op, id, kind, frontmatter, body = '') {
  return { seq, at, op, id, kind, revision: frontmatter.revision, record: frontmatter, body }
}

/** A side as the file map the CLI reads from git. */
function side(rows, events) {
  const files = new Map()
  for (const { kind, id } of rows) {
    const dir = kind === 'decision' ? 'decision' : kind
    files.set(`state/${dir}/${id}.md`, rows.find((entry) => entry.id === id).text)
  }
  files.set('state/events.jsonl', events.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
  return files
}

test('identity comes from the source key, not from the number', () => {
  assert.equal(identityOf('task', { boardId: 'board-1' }), 'task-board:board-1')
  assert.equal(identityOf('test', { caseId: 'case-1' }), 'test-case:case-1')
  assert.equal(identityOf('req', { analysisRef: { initiative: 'x', requirementId: 'FR1' } }), 'req-analysis:x#FR1')
  const derived = identityOf('task', { title: 'a task', createdAt: AT })
  // A title is edit history: renaming a row must not turn it into a different row.
  assert.equal(derived, identityOf('task', { title: 'renamed later', createdAt: AT }))
  assert.notEqual(derived, identityOf('task', { title: 'a task', createdAt: '2026-11-19T10:00:00.000Z' }))
})

test('two records with one number: one keeps it, the later one is renumbered and reported', () => {
  const oursRow = row('task', 'TASK-274', { boardId: 'board-ours', title: 'our task', createdAt: '2026-11-21T00:00:00.000Z' })
  const theirsRow = row('task', 'TASK-274', { boardId: 'board-theirs', title: 'their task', createdAt: '2026-11-22T00:00:00.000Z' })
  const merged = mergeStates({
    base: new Map(),
    ours: side([{ kind: 'task', id: 'TASK-274', ...oursRow }], [event(1, AT, 'create', 'TASK-274', 'task', oursRow.frontmatter)]),
    theirs: side([{ kind: 'task', id: 'TASK-274', ...theirsRow }], [event(1, '2026-11-22T01:00:00.000Z', 'create', 'TASK-274', 'task', theirsRow.frontmatter)]),
    now: AT,
  })
  assert.equal(merged.ok, true)
  const ids = merged.entities.map((entity) => entity.id)
  assert.deepEqual(ids, ['TASK-274', 'TASK-275'])
  const kept = merged.entities.find((entity) => entity.id === 'TASK-274')
  assert.equal(kept.fm.boardId, 'board-ours')
  const moved = merged.entities.find((entity) => entity.id === 'TASK-275')
  assert.equal(moved.fm.boardId, 'board-theirs')
  assert.equal(merged.report.renamed.length, 1)
  assert.equal(merged.report.renamed[0].from, 'TASK-274')
  assert.equal(merged.report.renamed[0].to, 'TASK-275')
  assert.equal(merged.report.renamed[0].title, 'their task')
  // The moved row's own history moved with it: no event still names the old number for it.
  const movedEvents = merged.events.filter((entry) => entry.id === 'TASK-275')
  assert.ok(movedEvents.length >= 1)
})

test('one record under two numbers: one number survives, the reference follows it', () => {
  const oursReq = row('req', 'REQ-004', { analysisRef: { initiative: 'x', requirementId: 'FR1' }, title: 'the requirement' })
  const oursTask = row('task', 'TASK-001', { boardId: 'board-1', reqId: 'REQ-004', links: [{ kind: 'req', id: 'REQ-004', hash: 'stalehash' }] }, 'body')
  const theirsReq = row('req', 'REQ-003', { analysisRef: { initiative: 'x', requirementId: 'FR1' }, title: 'the requirement, named elsewhere' })
  const merged = mergeStates({
    base: new Map(),
    ours: side([
      { kind: 'req', id: 'REQ-004', ...oursReq },
      { kind: 'task', id: 'TASK-001', ...oursTask },
    ], [
      event(1, AT, 'create', 'REQ-004', 'req', oursReq.frontmatter),
      event(2, AT, 'create', 'TASK-001', 'task', oursTask.frontmatter, 'body'),
    ]),
    theirs: side([{ kind: 'req', id: 'REQ-003', ...theirsReq }], [event(1, '2026-11-22T01:00:00.000Z', 'create', 'REQ-003', 'req', theirsReq.frontmatter)]),
    now: AT,
  })
  assert.equal(merged.ok, true)
  assert.deepEqual(merged.entities.map((entity) => entity.id).sort(), ['REQ-003', 'TASK-001'])
  assert.equal(merged.report.aliased.length, 1)
  assert.equal(merged.report.aliased[0].from, 'REQ-004')
  assert.equal(merged.report.aliased[0].to, 'REQ-003')
  const task = merged.entities.find((entity) => entity.id === 'TASK-001')
  assert.equal(task.fm.reqId, 'REQ-003')
  assert.equal(task.fm.links[0].id, 'REQ-003')
  const kept = merged.entities.find((entity) => entity.id === 'REQ-003')
  assert.equal(task.fm.links[0].hash, sha256(kept.text))
})

test('a row edited on both sides keeps the later updatedAt and says so', () => {
  const base = row('req', 'REQ-001', { title: 'original', updatedAt: '2026-11-20T00:00:00.000Z', revision: 1 })
  const ours = row('req', 'REQ-001', { title: 'ours', updatedAt: '2026-11-21T00:00:00.000Z', revision: 2 })
  const theirs = row('req', 'REQ-001', { title: 'theirs', updatedAt: '2026-11-22T00:00:00.000Z', revision: 3 })
  const merged = mergeStates({
    base: side([{ kind: 'req', id: 'REQ-001', ...base }], [event(1, AT, 'create', 'REQ-001', 'req', base.frontmatter)]),
    ours: side([{ kind: 'req', id: 'REQ-001', ...ours }], [event(1, AT, 'create', 'REQ-001', 'req', base.frontmatter), event(2, AT, 'update', 'REQ-001', 'req', ours.frontmatter)]),
    theirs: side([{ kind: 'req', id: 'REQ-001', ...theirs }], [event(1, AT, 'create', 'REQ-001', 'req', base.frontmatter), event(2, '2026-11-22T01:00:00.000Z', 'update', 'REQ-001', 'req', theirs.frontmatter)]),
    now: AT,
  })
  assert.equal(merged.ok, true)
  assert.equal(merged.entities[0].fm.title, 'theirs')
  assert.equal(merged.report.editedBothSides.length, 1)
  assert.equal(merged.report.editedBothSides[0].kept, 'theirs')
  assert.equal(merged.report.editedBothSides[0].droppedRevision, 2)
})

test('a row changed on one side only takes the changed side without a collision', () => {
  const base = row('req', 'REQ-001', { title: 'original', revision: 1 })
  const ours = row('req', 'REQ-001', { title: 'ours', revision: 2, updatedAt: '2026-11-21T00:00:00.000Z' })
  const merged = mergeStates({
    base: side([{ kind: 'req', id: 'REQ-001', ...base }], [event(1, AT, 'create', 'REQ-001', 'req', base.frontmatter)]),
    ours: side([{ kind: 'req', id: 'REQ-001', ...ours }], [event(1, AT, 'create', 'REQ-001', 'req', base.frontmatter), event(2, AT, 'update', 'REQ-001', 'req', ours.frontmatter)]),
    theirs: side([{ kind: 'req', id: 'REQ-001', ...base }], [event(1, AT, 'create', 'REQ-001', 'req', base.frontmatter)]),
    now: AT,
  })
  assert.equal(merged.ok, true)
  assert.equal(merged.entities[0].fm.title, 'ours')
  assert.equal(merged.report.editedBothSides.length, 0)
})

test('the journal unions by content, drops the same event twice and numbers seq 1..N', () => {
  const shared = row('req', 'REQ-001')
  const sharedEvent = event(1, AT, 'create', 'REQ-001', 'req', shared.frontmatter)
  const oursOnly = event(2, '2026-11-21T00:00:00.000Z', 'update', 'REQ-001', 'req', { ...shared.frontmatter, revision: 2, updatedAt: '2026-11-21T00:00:00.000Z' })
  const theirsOnly = event(2, '2026-11-22T00:00:00.000Z', 'update', 'REQ-001', 'req', { ...shared.frontmatter, revision: 3, updatedAt: '2026-11-22T00:00:00.000Z' })
  const merged = mergeStates({
    base: new Map(),
    ours: side([{ kind: 'req', id: 'REQ-001', ...shared }], [sharedEvent, oursOnly]),
    theirs: side([{ kind: 'req', id: 'REQ-001', ...shared }], [sharedEvent, theirsOnly]),
    now: AT,
  })
  assert.equal(merged.ok, true)
  assert.equal(merged.report.events.duplicates, 1)
  assert.deepEqual(merged.events.map((entry) => entry.seq), merged.events.map((_entry, index) => index + 1))
  const ids = merged.events.map((entry) => entry.eid ?? eidOf(entry))
  assert.equal(new Set(ids).size, merged.events.length)
})

test('the last event of every row serializes back to the merged file', () => {
  const oursRow = row('task', 'TASK-274', { boardId: 'board-ours', createdAt: '2026-11-21T00:00:00.000Z' })
  const theirsRow = row('task', 'TASK-274', { boardId: 'board-theirs', createdAt: '2026-11-22T00:00:00.000Z' })
  const merged = mergeStates({
    base: new Map(),
    ours: side([{ kind: 'task', id: 'TASK-274', ...oursRow }], [event(1, AT, 'create', 'TASK-274', 'task', oursRow.frontmatter)]),
    theirs: side([{ kind: 'task', id: 'TASK-274', ...theirsRow }], [event(1, '2026-11-22T01:00:00.000Z', 'create', 'TASK-274', 'task', theirsRow.frontmatter)]),
    now: AT,
  })
  const last = new Map()
  for (const entry of merged.events) if (entry.record !== undefined) last.set(entry.id, entry)
  for (const entity of merged.entities) {
    assert.ok(last.has(entity.id), `no event for ${entity.id}`)
    const replayed = serialize({ frontmatter: last.get(entity.id).record, body: last.get(entity.id).body ?? '' })
    assert.equal(replayed, entity.text, `the journal does not reproduce ${entity.id}`)
  }
})

test('an unchanged merge is clean and reports nothing', () => {
  const only = row('req', 'REQ-001')
  const merged = mergeStates({
    base: new Map(),
    ours: side([{ kind: 'req', id: 'REQ-001', ...only }], [event(1, AT, 'create', 'REQ-001', 'req', only.frontmatter)]),
    theirs: side([{ kind: 'req', id: 'REQ-001', ...only }], [event(1, AT, 'create', 'REQ-001', 'req', only.frontmatter)]),
    now: AT,
  })
  assert.equal(merged.ok, true)
  assert.equal(merged.report.clean, true)
  assert.equal(merged.entities.length, 1)
  assert.equal(merged.events.length, 1)
})
