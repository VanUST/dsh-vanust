/*
PROOF: the owner's own edit of a state entity is written, and survives the next mirror write.
Behavior: `update(id, {origin:'human', ...})` applies any field of the kind's editable schema
  (title, status, body, criteria/source for a REQ, reqIds/scope/acceptance/steps for a TASK,
  testPath/command/evidenceRefs for a TEST), bumps the revision, records `manualFields` on the
  entity and `origin: human` in the journal. A later AUTOMATIC write (a mirror, no origin) puts
  the stored value back for every field in that mask, and a write that would change nothing
  else does not write at all - the revision stays. `release` hands a field back to its source.
  A protected field (analysisRef/boardId/caseId/revision/derived hashes), an invalid status, an
  empty title and a stale revision are refused whole: the file keeps its bytes.
Fails when: a hand edit is dropped, a mirror overwrites a hand-edited field, a masked-only write
  still bumps the revision (churn), a release does not take effect, or a refusal still writes.
Production path: plugins/project-state/lib/core.mjs (`HUMAN_EDITABLE`, `update`), reached by
  the panel through the `/state` command in plugins/project-state/index.mjs.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStateService } from '../lib/core.mjs'
import { parse } from '../lib/format.mjs'

const clock = () => '2026-01-01T00:00:00.000Z'

async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), 'state-edit-'))
  return { cwd, state: createStateService({ cwd, now: clock }) }
}

const source = (cwd, path) => readFile(join(cwd, path), 'utf8')

test('a hand edit writes every content field, the body and the mask', async () => {
  const { cwd, state } = await workspace()
  const created = await state.create('req', { title: 'Draft title', criteria: ['old'], body: 'old text' })
  const edited = await state.update(created.id, {
    origin: 'human',
    expectedRevision: 1,
    title: 'Owner title',
    criteria: ['first', 'second'],
    source: 'human',
    reason: 'typo in the draft',
    body: 'The owner wrote this.',
  })
  assert.equal(edited.ok, true, JSON.stringify(edited))
  assert.equal(edited.revision, 2)
  const file = parse(await source(cwd, edited.path ?? `state/req/${created.id}.md`))
  assert.equal(file.frontmatter.title, 'Owner title')
  assert.deepEqual(file.frontmatter.criteria, ['first', 'second'])
  assert.equal(file.frontmatter.source, 'human')
  assert.equal(file.frontmatter.reason, 'typo in the draft')
  assert.deepEqual(file.frontmatter.manualFields, ['body', 'criteria', 'reason', 'source', 'title'])
  assert.equal(file.frontmatter.manualAt, clock())
  assert.equal(file.body.trim(), 'The owner wrote this.')
})

test('a later automatic write leaves the hand-edited fields alone and still applies the rest', async () => {
  const { cwd, state } = await workspace()
  const created = await state.create('req', { title: 'Draft', criteria: ['old'], body: 'old' })
  await state.update(created.id, { origin: 'human', expectedRevision: 1, title: 'Owner title', body: 'owner text' })
  const mirrored = await state.update(created.id, {
    expectedRevision: 2,
    title: 'Mirror title',
    body: 'mirror text',
    criteria: ['from the analysis record'],
    status: 'done',
  })
  assert.equal(mirrored.ok, true, JSON.stringify(mirrored))
  const file = parse(await source(cwd, `state/req/${created.id}.md`))
  assert.equal(file.frontmatter.title, 'Owner title', 'the masked title is not overwritten')
  assert.equal(file.body.trim(), 'owner text', 'the masked body is not overwritten')
  assert.deepEqual(file.frontmatter.criteria, ['from the analysis record'], 'an unmasked field still follows its source')
  assert.equal(file.frontmatter.status, 'done')
  assert.equal(file.frontmatter.revision, 3)
})

test('an automatic write that only touches masked fields does not bump the revision', async () => {
  const { cwd, state } = await workspace()
  const created = await state.create('req', { title: 'Draft', criteria: ['old'], body: 'old' })
  await state.update(created.id, { origin: 'human', expectedRevision: 1, title: 'Owner title' })
  const before = await source(cwd, `state/req/${created.id}.md`)
  const attempted = await state.update(created.id, { expectedRevision: 2, title: 'Mirror title', criteria: ['old'] })
  assert.equal(attempted.ok, true, JSON.stringify(attempted))
  assert.equal(attempted.skipped, 'manual')
  assert.equal(attempted.revision, 2)
  assert.deepEqual(attempted.manualFields, ['title'])
  assert.equal(await source(cwd, `state/req/${created.id}.md`), before, 'the file is byte-identical')
})

test('release hands a field back to its source', async () => {
  const { cwd, state } = await workspace()
  const created = await state.create('req', { title: 'Draft', criteria: ['old'], body: 'old' })
  await state.update(created.id, { origin: 'human', expectedRevision: 1, title: 'Owner title' })
  const released = await state.update(created.id, { origin: 'human', expectedRevision: 2, release: ['title'] })
  assert.equal(released.ok, true, JSON.stringify(released))
  assert.deepEqual(released.manualFields, undefined)
  const mirrored = await state.update(created.id, { expectedRevision: 3, title: 'Mirror title' })
  assert.equal(mirrored.ok, true, JSON.stringify(mirrored))
  const file = parse(await source(cwd, `state/req/${created.id}.md`))
  assert.equal(file.frontmatter.title, 'Mirror title', 'after the release the source owns the title')
})

test('a protected field is refused whole and the file keeps its bytes', async () => {
  const { cwd, state } = await workspace()
  const created = await state.create('req', { title: 'Draft', criteria: ['old'], analysisRef: { initiative: 'x', requirementId: 'FR1' } })
  const before = await source(cwd, `state/req/${created.id}.md`)
  for (const field of ['analysisRef', 'boardId', 'revision', 'criteriaHash', 'links']) {
    const refused = await state.update(created.id, { origin: 'human', expectedRevision: 1, [field]: 'anything', title: 'changed' })
    assert.equal(refused.ok, false, `${field} must be refused`)
    assert.equal(refused.code, 'field_not_editable', `${field}: ${refused.code}`)
  }
  assert.equal(await source(cwd, `state/req/${created.id}.md`), before)
})

test('an invalid status, an empty title and a stale revision are refused without writing', async () => {
  const { cwd, state } = await workspace()
  const created = await state.create('req', { title: 'Draft' })
  const before = await source(cwd, `state/req/${created.id}.md`)
  const badStatus = await state.update(created.id, { origin: 'human', expectedRevision: 1, status: 'proven' })
  assert.deepEqual([badStatus.ok, badStatus.code], [false, 'status_invalid'])
  const emptyTitle = await state.update(created.id, { origin: 'human', expectedRevision: 1, title: '   ' })
  assert.deepEqual([emptyTitle.ok, emptyTitle.code], [false, 'title_required'])
  const stale = await state.update(created.id, { origin: 'human', expectedRevision: 99, title: 'Too late' })
  assert.deepEqual([stale.ok, stale.code], [false, 'revision_conflict'])
  assert.equal(await source(cwd, `state/req/${created.id}.md`), before)
})

test('a TASK hand edit carries the plan, and steps with stepsDone freeze together', async () => {
  const { cwd, state } = await workspace()
  const created = await state.create('task', { title: 'Task', reqId: 'REQ-001', steps: ['one', 'two'], stepsDone: 1 })
  const edited = await state.update(created.id, {
    origin: 'human',
    expectedRevision: 1,
    steps: ['one', 'two', 'three'],
    stepsDone: 2,
    scope: ['a file'],
    acceptance: [{ text: 'it works', done: false }],
  })
  assert.equal(edited.ok, true, JSON.stringify(edited))
  const mirrored = await state.update(created.id, { expectedRevision: 2, steps: ['mirror'], stepsDone: 0 })
  assert.equal(mirrored.ok, true, JSON.stringify(mirrored))
  const file = parse(await source(cwd, `state/task/${created.id}.md`))
  assert.deepEqual(file.frontmatter.steps, ['one', 'two', 'three'])
  assert.equal(file.frontmatter.stepsDone, 2, 'the progress cannot move while the plan is frozen')
  assert.deepEqual(file.frontmatter.scope, ['a file'])
})

test('a TEST hand edit carries testPath, command and evidence', async () => {
  const { cwd, state } = await workspace()
  const created = await state.create('test', { title: 'Test', reqId: 'REQ-001', authorRole: 'orchestrator' })
  const edited = await state.update(created.id, {
    origin: 'human',
    expectedRevision: 1,
    testPath: 'scripts/test/example.test.mjs',
    command: 'node --test scripts/test/example.test.mjs',
    evidenceRefs: ['scripts/test/example.test.mjs:red:fail', 'scripts/test/example.test.mjs:green:pass'],
    status: 'verified',
  })
  assert.equal(edited.ok, true, JSON.stringify(edited))
  const file = parse(await source(cwd, `state/test/${created.id}.md`))
  assert.equal(file.frontmatter.testPath, 'scripts/test/example.test.mjs')
  assert.equal(file.frontmatter.command, 'node --test scripts/test/example.test.mjs')
  assert.deepEqual(file.frontmatter.evidenceRefs, ['scripts/test/example.test.mjs:red:fail', 'scripts/test/example.test.mjs:green:pass'])
  assert.equal(file.frontmatter.status, 'verified')
})
