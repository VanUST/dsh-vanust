/*
PROOF: project-state core contract
Behavior: the core allocates typed IDs under the lock, writes deterministic per-entity files
  with a content-hashed link, refuses a stale expectedRevision without touching the file,
  replays the journal to the same bytes, and reports verify() findings (orphan, broken link,
  REQ without criteria, TASK without REQ unless chore+reason, stale hash, broken frontmatter)
  without rewriting anything.
Fails when: two parallel creates collide on one ID; a link hash does not follow its target; a
  stale CAS still writes; replay bytes differ from disk; verify() silently rewrites a file.
Production path: plugins/project-state/lib/core.mjs (createStateService), used by
  @cc/dsh-project-state consumers (analysis/taskboard/test-cases) through ctx.provide.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createStateService } from '../lib/core.mjs'
import { parse } from '../lib/format.mjs'

const clock = () => '2026-01-01T00:00:00.000Z'
const hash = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), 'project-state-'))
  return { cwd, state: createStateService({ cwd, now: clock }) }
}

test('twenty parallel creates get twenty distinct IDs and twenty files', async () => {
  const { cwd, state } = await workspace()
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => state.create('task', {
    title: `task ${index}`,
    reqId: 'REQ-001',
    body: `body ${index}`,
  })))
  const refused = results.filter((result) => result.ok !== true)
  assert.deepEqual(refused, [], 'no create may be refused under contention')
  const ids = new Set(results.map((result) => result.id))
  assert.equal(ids.size, 20, 'ids are unique')
  const files = await readdir(join(cwd, 'state', 'task'))
  assert.equal(files.length, 20)
})

/*
PROOF: a wrong link can be taken off, and the journal stays the source of truth
Behavior: unlink() removes exactly ONE link under the lock and records an `unlink` event; the file
  on disk matches replay() afterwards, the removed link never comes back through the journal, the
  other links of the same entity stay, a second removal of the same target is refused as
  link_missing, a removal with nothing to remove is refused, and link() still adds a new target.
Fails when: the removed link survives in the file or in replay, replay reports bytes_differ, a
  duplicate removal succeeds, a sibling link disappears, or adding a link stops working.
Production path: plugins/project-state/lib/core.mjs (unlink, replay, link) through
  createStateService.
*/
test('a link can be taken off, and replay rebuilds the file without it', async () => {
  const { cwd, state } = await workspace()
  const accepted = await state.create('req', { title: 'Accepted measurement', analysisRef: { initiative: 'request-cache', requirementId: 'R1' } })
  const rejected = await state.create('req', { title: 'Rejected measurement', status: 'rejected', analysisRef: { initiative: 'request-cache', requirementId: 'R2' } })
  const task = await state.create('task', { title: 'The work that reads the decision', reqId: accepted.id })
  const decision = await state.create('decision', { title: 'Reserve for the answer', status: 'accepted' })
  assert.equal((await state.link(decision.id, rejected.id)).ok, true)
  assert.equal((await state.link(decision.id, task.id)).ok, true)
  // The negative control: the harness sets this to prove the assertion can fail at all.
  if (process.env.CASE_NEGATIVE_CONTROL !== undefined) assert.equal((await state.unlink(decision.id, rejected.id)).ok, false, `negative control "${process.env.CASE_NEGATIVE_CONTROL}": the removal must not succeed`)
  const removed = await state.unlink(decision.id, rejected.id)
  assert.equal(removed.ok, true, JSON.stringify(removed))
  assert.equal(removed.removed.id, rejected.id, 'the result names the removed target')
  const after = await state.get(decision.id)
  assert.deepEqual(after.frontmatter.links.map((link) => link.id), [task.id], 'only the removed link goes: the sibling stays')
  const replay = await state.replay()
  assert.equal(replay.ok, true, 'replay disagrees with the file: ' + JSON.stringify(replay.mismatches) + JSON.stringify(replay.problems))
  const journal = (await readFile(join(cwd, 'state', 'events.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(journal.filter((event) => event.op === 'unlink').length, 1, 'the removal is its own journal event')
  const twice = await state.unlink(decision.id, rejected.id)
  assert.equal(twice.ok, false, 'a link that is already off cannot be removed again')
  assert.equal(twice.code, 'link_missing')
  assert.equal((await state.unlink('DEC-999', accepted.id)).code, 'not_found')
  // A removal must not disable adding: the corrected link goes on after it.
  const relinked = await state.link(decision.id, accepted.id)
  assert.equal(relinked.ok, true)
  assert.deepEqual((await state.get(decision.id)).frontmatter.links.map((link) => link.id).sort(), [accepted.id, task.id].sort())
  assert.equal((await state.replay()).ok, true)
})

test('the same entity with the same clock serializes to the same bytes', async () => {
  const first = await workspace()
  const second = await workspace()
  const input = { title: 'Same title', criteria: ['a', 'b'], body: 'Body line.\nSecond line.' }
  const one = await first.state.create('req', input)
  const two = await second.state.create('req', input)
  assert.equal(one.ok, true)
  assert.equal(two.ok, true)
  const textOne = await readFile(join(first.cwd, one.path), 'utf8')
  const textTwo = await readFile(join(second.cwd, two.path), 'utf8')
  assert.equal(textOne, textTwo)
  const parsed = parse(textOne)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.frontmatter.id, 'REQ-001')
  assert.deepEqual(parsed.frontmatter.criteria, ['a', 'b'])
})

test('a link stores the target hash and goes stale when the target changes', async () => {
  const { cwd, state } = await workspace()
  const req = await state.create('req', { title: 'Requirement', criteria: ['it works'] })
  const task = await state.create('task', { title: 'Implement', reqId: req.id })
  const linked = await state.link(task.id, req.id)
  assert.equal(linked.ok, true)
  const before = await readFile(join(cwd, linked.path), 'utf8')
  assert.match(before, new RegExp(`hash: ${hash(await readFile(join(cwd, req.path), 'utf8'))}`))
  const verdict = await state.verify()
  assert.equal(verdict.ok, true, JSON.stringify(verdict.findings))
  const updated = await state.update(req.id, { expectedRevision: req.revision, title: 'Requirement (changed)' })
  assert.equal(updated.ok, true)
  const after = await state.verify()
  const stale = after.findings.filter((finding) => finding.code === 'link_stale')
  assert.equal(stale.length, 1, JSON.stringify(after.findings))
  assert.equal(stale[0].id, task.id)
})

test('a stale expectedRevision refuses and leaves the file byte-identical', async () => {
  const { cwd, state } = await workspace()
  const task = await state.create('task', { title: 'Work', reqId: 'REQ-001' })
  const path = join(cwd, task.path)
  const before = await readFile(path, 'utf8')
  const first = await state.update(task.id, { expectedRevision: task.revision, status: 'active' })
  assert.equal(first.ok, true)
  const afterFirst = await readFile(path, 'utf8')
  const stale = await state.update(task.id, { expectedRevision: task.revision, status: 'done' })
  assert.equal(stale.ok, false)
  assert.equal(stale.code, 'revision_conflict')
  assert.equal(await readFile(path, 'utf8'), afterFirst, 'the refused call wrote nothing')
  const complete = await state.complete(task.id, { expectedRevision: task.revision })
  assert.equal(complete.ok, false)
  assert.equal(complete.code, 'revision_conflict')
  assert.notEqual(afterFirst, before)
})

test('replay rebuilds the same bytes as the files on disk', async () => {
  const { cwd, state } = await workspace()
  const req = await state.create('req', { title: 'R', criteria: ['c'] })
  const task = await state.create('task', { title: 'T', reqId: req.id, body: 'task body' })
  const linked = await state.link(task.id, req.id)
  assert.equal(linked.ok, true)
  const active = await state.update(task.id, { expectedRevision: linked.revision, status: 'active' })
  assert.equal(active.ok, true)
  const before = await state.snapshot()
  const replay = await state.replay()
  assert.equal(replay.ok, true, JSON.stringify(replay))
  const after = await state.snapshot()
  assert.deepEqual(after, before, 'replay and snapshot are read-only')
  const text = await readFile(join(cwd, 'state', 'task', `${task.id}.md`), 'utf8')
  await writeFile(join(cwd, 'state', 'task', `${task.id}.md`), text.replace('status: active', 'status: review'))
  const broken = await state.replay()
  assert.equal(broken.ok, false)
  assert.deepEqual(broken.mismatches.map((entry) => entry.reason), ['bytes_differ'])
})

test('verify reports each finding and rewrites nothing', async () => {
  const { cwd, state } = await workspace()
  const bareRequirement = await state.create('req', { title: 'No criteria' })
  const bareTask = await state.create('task', { title: 'No requirement' })
  const chore = await state.create('task', { title: 'Chore', chore: true, choreReason: 'housekeeping' })
  const decision = await state.create('decision', { title: 'Alone' })
  assert.equal(bareRequirement.ok, true)
  assert.equal(bareTask.ok, true)
  assert.equal(chore.ok, true)
  assert.equal(decision.ok, true)
  // A hand edit: a broken link and an unparsable frontmatter, exactly what a human can leave.
  const linked = join(cwd, decision.path)
  const linkedText = await readFile(linked, 'utf8')
  await writeFile(linked, linkedText.replace(/\n---\n$/, `\nlinks:\n  - kind: task\n    id: TASK-999\n    hash: deadbeef\n---\n`))
  const brokenPath = join(cwd, 'state', 'test', 'TEST-001.md')
  await mkdir(join(cwd, 'state', 'test'), { recursive: true })
  await writeFile(brokenPath, '---\nid: TEST-001\nkind: test\n  bad: [unclosed\n---\n')
  const before = await state.snapshot()
  const verdict = await state.verify()
  const after = await state.snapshot()
  assert.deepEqual(after, before, 'verify is read-only')
  const codes = verdict.findings.map((finding) => finding.code).sort()
  for (const expected of ['frontmatter_invalid', 'link_broken', 'orphan', 'req_criteria_missing', 'task_req_missing']) {
    assert.ok(codes.includes(expected), `missing ${expected} in ${codes.join(',')}`)
  }
  assert.equal(verdict.findings.some((finding) => finding.id === chore.id && finding.code === 'task_req_missing'), false, 'chore+reason is not task_req_missing')
})

test('a human edit that breaks the frontmatter is a finding, not a rewrite', async () => {
  const { cwd, state } = await workspace()
  const req = await state.create('req', { title: 'R', criteria: ['c'] })
  const path = join(cwd, req.path)
  await writeFile(path, '---\nid REQ-001\n---\n')
  const before = await readFile(path, 'utf8')
  const verdict = await state.verify()
  assert.equal(verdict.ok, false)
  assert.equal(verdict.findings[0].code, 'frontmatter_invalid')
  assert.equal(await readFile(path, 'utf8'), before)
  const get = await state.get(req.id)
  assert.equal(get.ok, false)
  assert.equal(get.code, 'frontmatter_invalid')
})

test('a TASK keeps the concrete task — scope, non-scope, acceptance, owner and sessions', async () => {
  // PROOF: the concrete task is stored field by field and the journal replays it byte for byte.
  // Behavior: create keeps scope/nonScope/acceptance [{text,done}]/role/preset/owner/sessions/
  // resultSummary and resultEvidence on disk; a read gives the same values; an update with an
  // empty list or an empty string CLEARS the field; replay still matches the files.
  // Fails when: the writer drops a field, accepts a bare string as criteria without a done mark,
  // keeps a cleared scope, or the cleared update breaks replay.
  const { cwd, state } = await workspace()
  const req = await state.create('req', { title: 'R', criteria: ['c'] })
  const created = await state.create('task', {
    title: 'Concrete',
    reqId: req.id,
    scope: ['plugins/a', 'plugins/b'],
    nonScope: [':3080'],
    acceptance: [{ text: 'works', done: true }, 'still open'],
    role: 'BACKEND',
    preset: 'backend',
    owner: { kind: 'agent', label: 'BACKEND', sessionId: 'sess-1' },
    sessions: [{ sessionId: 'sess-1', label: 'BACKEND', role: 'BACKEND', status: 'sleeping' }],
    steps: ['one', 'two'],
    stepsDone: 1,
    resultSummary: 'done it',
    resultEvidence: ['make verify'],
    resultArtifacts: ['reports/proof.json'],
    body: 'Objective',
  })
  assert.equal(created.ok, true, JSON.stringify(created))
  const got = await state.get(created.id)
  assert.deepEqual(got.frontmatter.scope, ['plugins/a', 'plugins/b'])
  assert.deepEqual(got.frontmatter.nonScope, [':3080'])
  assert.deepEqual(got.frontmatter.acceptance, [{ text: 'works', done: true }, { text: 'still open', done: false }])
  assert.equal(got.frontmatter.role, 'BACKEND')
  assert.equal(got.frontmatter.preset, 'backend')
  assert.deepEqual(got.frontmatter.owner, { kind: 'agent', label: 'BACKEND', sessionId: 'sess-1' })
  assert.deepEqual(got.frontmatter.sessions, [{ sessionId: 'sess-1', label: 'BACKEND', role: 'BACKEND', status: 'sleeping' }])
  assert.equal(got.frontmatter.resultSummary, 'done it')
  assert.deepEqual(got.frontmatter.resultEvidence, ['make verify'])
  assert.deepEqual(got.frontmatter.resultArtifacts, ['reports/proof.json'])
  assert.equal(got.frontmatter.stepsDone, 1)
  const replayed = await state.replay()
  assert.equal(replayed.ok, true, JSON.stringify(replayed))

  const cleared = await state.update(created.id, {
    expectedRevision: got.frontmatter.revision,
    scope: [],
    nonScope: [],
    acceptance: [],
    sessions: [],
    owner: null,
    steps: [],
    stepsDone: 0,
    resultSummary: '',
  })
  assert.equal(cleared.ok, true, JSON.stringify(cleared))
  const after = await state.get(created.id)
  for (const field of ['scope', 'nonScope', 'acceptance', 'sessions', 'owner', 'steps', 'stepsDone', 'resultSummary']) {
    assert.equal(after.frontmatter[field], undefined, `${field} must be cleared`)
  }
  assert.equal(after.frontmatter.role, 'BACKEND', 'a field the patch did not name is untouched')
  assert.equal((await state.replay()).ok, true)
  assert.equal(after.body.trim(), 'Objective')
  const text = await readFile(join(cwd, 'state', 'task', `${created.id}.md`), 'utf8')
  assert.equal(/^scope:/m.test(text), false)
})

test('an inline list item keeps its comma and its quotes through write, read and replay', async () => {
  // PROOF: the format round-trips a list item that is not a plain word. Behavior: an item with
  // a comma, a JSON fragment with double quotes and an apostrophe reads back verbatim, so the
  // journal replay matches the file. Fails when: the parser splits an inline list on a comma
  // INSIDE a quoted item (the 236-TASK backfill found this: a health-check line became three).
  const { state } = await workspace()
  const evidence = ['GET /health -> 200 {"status": "healthy", "database": "connected"}', "zod: strictObject rejected [nodes] - it's a list, not a map", 'plain item']
  const created = await state.create('task', { title: 'Quoted list', chore: true, choreReason: 'format proof', resultEvidence: evidence, steps: ['one, two', 'three'] })
  assert.equal(created.ok, true, JSON.stringify(created))
  const got = await state.get(created.id)
  assert.deepEqual(got.frontmatter.resultEvidence, evidence)
  assert.deepEqual(got.frontmatter.steps, ['one, two', 'three'])
  assert.equal((await state.replay()).ok, true)
})
