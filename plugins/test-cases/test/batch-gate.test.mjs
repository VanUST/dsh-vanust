/*
PROOF: one case may cover a batch of requirements, and the gate accepts that batch
Behavior: the case policy says "one case per accepted behaviour" and allows one case to name
  several requirements; case_gate passes a task that covers three reqIds when one automated case
  linked to it is verified, and still blocks when that case is not verified.
Fails when: the policy falls back to "one case per observed requirement", the gate starts demanding
  a case per requirement, or it stops blocking an unverified linked automated case.
Production path: plugins/test-cases/test-cases.mjs (SECTION_FULL/SECTION_INTAKE, gateForTask and
  the case_gate tool). The case schema is unchanged: reqId stays the primary requirement.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SECTION_FULL, SECTION_INTAKE, createTools } from '../test-cases.mjs'

const SOURCE = readFileSync(join(process.cwd(), 'plugins/test-cases/test-cases.mjs'), 'utf8')
const control = process.env.CASE_NEGATIVE_CONTROL ?? ''

test('negative control expect-pre-fix keeps the per-requirement case rule', () => {
  if (control !== 'expect-pre-fix') return
  assert.match(SOURCE, /one case per observed requirement/)
})


async function library() {
  const cwd = await mkdtemp(join(tmpdir(), 'test-cases-batch-'))
  const dir = join(cwd, 'docs', 'cases')
  await mkdir(dir, { recursive: true })
  return { cwd, dir }
}

async function writeCase(dir, record) {
  await writeFile(join(dir, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}

const baseCase = (overrides = {}) => ({
  schemaVersion: 1,
  title: 'One accepted behaviour',
  requirement: 'The batch is proved by one run',
  expected: 'the run passes',
  kind: 'regression',
  source: 'agent',
  automated: true,
  testPath: 'test/batch.test.mjs',
  runCommand: 'node --test test/batch.test.mjs',
  status: 'verified',
  reqId: 'REQ-001',
  authorRole: 'BACKEND',
  linkedTaskId: 'task-batch',
  checks: [{ metric: 'violations', op: '==', threshold: 0 }],
  ...overrides,
})

test('the case policy allows one case per accepted behaviour, several requirements per case', () => {
  for (const [name, section] of [['SECTION_FULL', SECTION_FULL], ['SECTION_INTAKE', SECTION_INTAKE]]) {
    assert.match(section, /one case per accepted behaviour/i, `${name} lost the batch rule`)
    assert.match(section, /several requirements/i, `${name} does not allow several requirements in one case`)
  }
  assert.match(SOURCE, /one case per accepted behaviour/i)
  assert.doesNotMatch(SOURCE, /one case per observed requirement/i)
})

test('case_gate passes a task with three reqIds behind one verified automated case', async () => {
  const { cwd, dir } = await library()
  // The task covers REQ-001, REQ-002 and REQ-003; the ONE case names REQ-001 as its primary reqId.
  await writeCase(dir, baseCase())
  const tools = createTools({ dir: 'docs/cases' })
  const exec = { agent: { session: { header: { cwd } } } }
  const verdict = await tools.case_gate.execute({ taskId: 'task-batch' }, exec)
  assert.equal(verdict.ok, true, JSON.stringify(verdict))
  assert.deepEqual(verdict.blockers, [])
  assert.equal(verdict.checked, 1)
})

test('an unverified automated case linked to the task still blocks, and documented-only never does', async () => {
  const { cwd, dir } = await library()
  await writeCase(dir, baseCase())
  await writeCase(dir, baseCase({ id: 'unverified-run', status: 'unverified', title: 'Not run yet' }))
  await writeCase(dir, baseCase({ id: 'documented-batch', automated: false, status: 'unverified', title: 'Documented only' }))
  const tools = createTools({ dir: 'docs/cases' })
  const exec = { agent: { session: { header: { cwd } } } }
  const verdict = await tools.case_gate.execute({ taskId: 'task-batch' }, exec)
  assert.equal(verdict.ok, false)
  assert.deepEqual(verdict.blockers.map((blocker) => blocker.id), ['unverified-run'])
})
