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
import { mirrorCase } from '../mirror.mjs'

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
  return { cwd, core, tools, exec: { agent: { session: { header: { cwd } } } } }
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
  }), exec)
  assert.equal(created.ok, true, JSON.stringify(created))
  const run = await tools.case_run.execute({ id: created.case.id, expectedRevision: created.case.revision ?? 1 }, exec)
  assert.equal(run.ok, true, JSON.stringify(run))
  const text = await readFile(join(cwd, 'state', 'test', 'TEST-001.md'), 'utf8')
  assert.match(text, /:green:pass/)
  const files = await readdir(join(cwd, 'state', 'test'))
  assert.deepEqual(files, ['TEST-001.md'])
})
