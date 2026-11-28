/*
PROOF: test cases require a REQ and an author, and mirror into TEST
Behavior: case_record refuses a case without reqId or authorRole (code TEST_REQ_REQUIRED) before
  any file is written; an accepted case is mirrored into state/test/ with reqId, authorRole,
  testPath, runCommand, frozenHash, evidenceRefs and status, and case_update updates the SAME
  TEST; a case_run adds its run ref to that TEST's evidenceRefs.
Fails when: a case without a requirement is accepted, a second TEST appears on update, or a run
  leaves the evidenceRefs empty.
Production path: plugins/test-cases/test-cases.mjs (case_record/case_update/case_run) with
  mirror.mjs and the ccProjectState service of @cc/dsh-project-state.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStateService } from '../../project-state/lib/core.mjs'
import { createTools } from '../test-cases.mjs'
import { mirrorCase, testPayload } from '../mirror.mjs'
import { deprecateCase, readCase, writeCase } from '../lib/store.mjs'

const clock = () => '2026-01-06T00:00:00.000Z'

async function harness() {
  const cwd = await mkdtemp(join(tmpdir(), 'test-cases-mirror-'))
  const core = createStateService({ cwd, now: clock })
  const tools = createTools({ dir: 'docs/cases' }, {
    mirror: async (_agent, record) => {
      const result = await mirrorCase(core, { cwd, record })
      await core.regenerateViews()
      return result
    },
  })
  // The author comes from the session now, so the harness names the role that writes here.
  return { cwd, core, tools, exec: { agent: { session: { id: 'sess-mirror', header: { cwd, agentPreset: 'orchestrator' } } } } }
}

const baseCase = (overrides = {}) => JSON.parse(JSON.stringify({
  title: 'The gate refuses a closing REQ without evidence',
  requirement: 'A REQ cannot become done without a passed red→green pair',
  expected: 'analysis_upsert returns evidence_required',
  automated: false,
  reason: 'documented for the mirror proof',
  reqId: 'REQ-001',
  authorRole: 'orchestrator',
  ...overrides,
}))


/*
PROOF: a retired case is terminal in the register, and a re-recorded case comes back to live
Behavior: mirrorCase maps a case whose status is deprecated (or superseded) to its TEST row with status
  'deprecated', keeping the same TEST id and its caseId; when the same case is written again as
  unverified, that row is updated back to 'unverified' — no hand edit of the TEST file and no second row.
Fails when: a retired case still mirrors as unverified, the row loses its caseId, a re-record creates a
  duplicate TEST, or a re-recorded case stays terminal.
*/
test('a retired case mirrors to a terminal row and a re-recorded case comes back', async () => {
  const { cwd, core, tools, exec } = await harness()
  const recorded = await tools.case_record.execute(baseCase({ title: 'Retire the map proof' }), exec)
  assert.equal(recorded.ok, true)
  const caseId = recorded.case.id
  const dir = join(cwd, 'docs', 'cases')
  const rowsFor = async () => (await core.list('test')).rows.filter((row) => row.caseId === caseId)
  const [before] = await rowsFor()
  assert.equal(before.status, 'unverified')
  assert.equal(testPayload({ status: 'superseded' }).status, 'deprecated')

  const retired = deprecateCase(dir, caseId, { reason: 'its surface was retired with the design map' })
  const mirrored = await mirrorCase(core, { cwd, record: retired.record })
  assert.equal(mirrored.ok, true)
  assert.equal((await rowsFor()).length, 1, 'the mirror rewrites the same TEST row, never a second')
  const [terminal] = await rowsFor()
  assert.equal(terminal.id, before.id, 'the mirror rewrites the same TEST row')
  assert.equal(terminal.status, 'deprecated')
  const kept = await core.get(terminal.id)
  assert.equal(kept.frontmatter.caseId, caseId)

  // Re-recorded: the case is written again as a live case, and the mirror brings the row back.
  const reRecorded = { ...readCase(dir, caseId).record, status: 'unverified', revision: retired.record.revision + 1 }
  delete reRecorded.deprecateReason
  writeCase(dir, reRecorded)
  const back = await mirrorCase(core, { cwd, record: reRecorded })
  assert.equal(back.ok, true)
  const [live] = await rowsFor()
  assert.equal(live.id, before.id)
  assert.equal(live.status, 'unverified')
  assert.equal((await rowsFor()).length, 1, 'a re-record must not create a second TEST')
})

test('a case without reqId or authorRole is refused before any file is written', async () => {
  const { cwd, tools, exec } = await harness()
  const withoutReq = await tools.case_record.execute(baseCase({ reqId: undefined }), exec)
  assert.equal(withoutReq.ok, false)
  assert.equal(withoutReq.code, 'TEST_REQ_REQUIRED')
  const withoutAuthor = await tools.case_record.execute(baseCase({ authorRole: '' }), exec)
  assert.equal(withoutAuthor.ok, false)
  assert.equal(withoutAuthor.code, 'TEST_REQ_REQUIRED')
  const files = await readdir(join(cwd, 'docs', 'cases')).catch(() => [])
  assert.deepEqual(files, [])
})

test('a case with reqId and authorRole becomes one TEST with a frozen hash', async () => {
  const { cwd, core, tools, exec } = await harness()
  const created = await tools.case_record.execute(baseCase(), exec)
  assert.equal(created.ok, true, JSON.stringify(created))
  assert.equal(created.testMirror.action, 'created')
  const files = await readdir(join(cwd, 'state', 'test'))
  assert.deepEqual(files, ['TEST-001.md'])
  const text = await readFile(join(cwd, 'state', 'test', 'TEST-001.md'), 'utf8')
  assert.match(text, /reqId: REQ-001/)
  assert.match(text, /authorRole: orchestrator/)
  assert.match(text, /frozenHash: [0-9a-f]{64}/)
  const index = JSON.parse(await readFile(join(cwd, 'state', 'views', 'index.json'), 'utf8'))
  assert.deepEqual(index.tests.map((row) => row.id), ['TEST-001'])
  assert.equal(index.tests[0].reqId, 'REQ-001')
  const get = await core.get('TEST-001')
  assert.equal(get.frontmatter.authorRole, 'orchestrator')
})

test('case_update rewrites the same TEST instead of adding one', async () => {
  const { cwd, tools, exec } = await harness()
  const created = await tools.case_record.execute(baseCase(), exec)
  const updated = await tools.case_update.execute({ id: created.case.id, expectedRevision: created.case.revision, expected: 'analysis_upsert returns evidence_required and writes nothing' }, exec)
  assert.equal(updated.ok, true, JSON.stringify(updated))
  const files = await readdir(join(cwd, 'state', 'test'))
  assert.deepEqual(files, ['TEST-001.md'])
  assert.equal(updated.testMirror.action, 'updated')
})

test('a recorded run lands in the TEST evidenceRefs', async () => {
  const { cwd, tools, exec } = await harness()
  await writeFile(join(cwd, 'tiny.mjs'), 'console.log("CASE_SUMMARY " + JSON.stringify({ metrics: {} }))\n')
  const created = await tools.case_record.execute(baseCase({
    automated: true,
    reason: undefined,
    testPath: 'tiny.mjs',
    runCommand: 'node tiny.mjs',
    surfaceFiles: ['tiny.mjs'],
    failsWhen: 'the tiny driver writes no summary',
    trigger: 'running the tiny driver once',
    oracle: 'the case library reads the run it produced',
    realism: 'the mirror proof needs a measured run',
    realismReviewedBy: 'reviewer',
    realismReviewedAt: '2026-01-01T00:00:00.000Z',
  }), exec)
  assert.equal(created.ok, true, JSON.stringify(created))
  const run = await tools.case_run.execute({ id: created.case.id, expectedRevision: created.case.revision ?? 1 }, exec)
  assert.equal(run.ok, true, JSON.stringify(run))
  const text = await readFile(join(cwd, 'state', 'test', 'TEST-001.md'), 'utf8')
  assert.match(text, /:green:pass/)
  const files = await readdir(join(cwd, 'state', 'test'))
  assert.deepEqual(files, ['TEST-001.md'])
})
