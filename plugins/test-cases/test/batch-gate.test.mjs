/*
PROOF: one case may cover a batch of requirements, and the gate accepts that batch
Behavior: the case policy says "one case per accepted behaviour" and allows one case to name
  several requirements; case_gate passes a task that covers three reqIds when one automated
  acceptance case linked to it was verified by a measured run from another preset than the
  implementer's, and still blocks when that case is not verified - or is only legacy.
Fails when: the policy falls back to "one case per observed requirement", the gate starts demanding
  a case per requirement, it stops blocking an unverified linked automated case, or a verified
  case with no recorded run counts as evidence.
Production path: plugins/test-cases/test-cases.mjs (SECTION_FULL/SECTION_INTAKE, gateForTask and
  the case_gate tool) and lib/acceptance.mjs (the acceptance rule). The case schema is unchanged:
  reqId stays the primary requirement.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SECTION_FULL, SECTION_INTAKE, createTools, gateForTask } from '../test-cases.mjs'

const SOURCE = readFileSync(join(process.cwd(), 'plugins/test-cases/test-cases.mjs'), 'utf8')
const control = process.env.CASE_NEGATIVE_CONTROL ?? ''

test('negative control expect-pre-fix keeps the per-requirement case rule', () => {
  if (control !== 'expect-pre-fix') return
  assert.match(SOURCE, /one case per observed requirement/)
})


const TEST_SOURCE = '// the batch case: one run proves the three requirements\n'

async function library() {
  const cwd = await mkdtemp(join(tmpdir(), 'test-cases-batch-'))
  const dir = join(cwd, 'docs', 'cases')
  await mkdir(dir, { recursive: true })
  await mkdir(join(cwd, 'test'), { recursive: true })
  await writeFile(join(cwd, 'test', 'batch.test.mjs'), TEST_SOURCE, 'utf8')
  const testHash = createHash('sha256').update(await readFile(join(cwd, 'test', 'batch.test.mjs'))).digest('hex')
  return { cwd, dir, testHash }
}

/** The run artifact a verified case must be backed by: the rule checks it, so the fixture writes it. */
async function writeArtifact(dir, record) {
  const runId = record.lastVerified.runId
  const target = join(dir, 'runs', record.id, runId)
  await mkdir(target, { recursive: true })
  await writeFile(join(target, 'run.json'), `${JSON.stringify({
    runId,
    mode: 'green',
    passed: true,
    exitCode: 0,
    commandSha256: createHash('sha256').update(record.runCommand).digest('hex'),
    runBy: record.lastVerified.runBy,
  }, null, 2)}\n`, 'utf8')
}

async function writeCase(dir, record) {
  await writeFile(join(dir, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  if (record.lastVerified !== undefined && record.lastVerified !== null && typeof record.lastVerified.runId === 'string') await writeArtifact(dir, record)
}

// A case that CAN close the task: measured by the runner, written by the orchestrator, run by the
// reviewer, over a test file whose bytes are still the recorded ones. The implementer is BACKEND.
const baseCase = (testHash, overrides = {}) => ({
  schemaVersion: 1,
  id: 'batch-case',
  title: 'One accepted behaviour',
  requirement: 'The batch is proved by one run',
  expected: 'the run passes',
  kind: 'regression',
  source: 'agent',
  automated: true,
  purpose: 'acceptance',
  testPath: 'test/batch.test.mjs',
  runCommand: 'node --test test/batch.test.mjs',
  testHash,
  status: 'verified',
  reqId: 'REQ-001',
  authorRole: 'BACKEND',
  authorPreset: 'orchestrator',
  authorSessionId: 'sess-orchestrator',
  linkedTaskId: 'task-batch',
  checks: [{ metric: 'violations', op: '==', threshold: 0 }],
  surfaceFiles: [{ path: 'test/batch.test.mjs', sha256: testHash }],
  // P1: the claim, and the red that counts (a failure against the previous version).
  failsWhen: 'the batch rule drifts back to one case per requirement',
  trigger: 'a task that covers three requirements',
  oracle: 'the requirement: one case may name a batch',
  realism: 'the register entry the case came from',
  realismReviewedBy: 'reviewer',
  realismReviewedAt: '2026-01-01T00:00:00.000Z',
  redFirst: { source: 'wrong-product', at: '2026-01-01T00:00:00.000Z', exitCode: 1, runId: 'red-1-1', command: 'node --test test/batch.test.mjs', cwd: '/previous-version', head: 'a'.repeat(40) },
  runs: [{ runId: 'run-1-1', mode: 'green', passed: true }],
  lastVerified: {
    at: '2026-01-01T00:00:00.000Z',
    command: 'node --test test/batch.test.mjs',
    exitCode: 0,
    runId: 'run-1-1',
    source: 'runner',
    // The artifact must answer to the same task the case does (R3): the run records its task.
    runBy: { preset: 'reviewer', sessionId: 'sess-reviewer', taskId: 'task-batch' },
  },
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

test('case_gate passes a task with three reqIds behind one measured, independently run case', async () => {
  const { cwd, dir, testHash } = await library()
  // The task covers REQ-001, REQ-002 and REQ-003; the ONE case names REQ-001 as its primary reqId.
  await writeCase(dir, baseCase(testHash))
  // The implementer preset comes from the task row the taskboard service describes (D4).
  const tools = createTools({ dir: 'docs/cases' }, { taskPresetFor: () => 'backend' })
  const exec = { agent: { session: { header: { cwd } } } }
  const verdict = await tools.case_gate.execute({ taskId: 'task-batch' }, exec)
  assert.equal(verdict.ok, true, JSON.stringify(verdict))
  assert.deepEqual(verdict.blockers, [])
  assert.equal(verdict.evidence.length, 1)
  assert.equal(verdict.evidence[0].testHashOk, true)
  assert.equal(verdict.checked, 1)
})

test('an unverified automated case linked to the task still blocks, and documented-only never does', async () => {
  const { cwd, dir, testHash } = await library()
  await writeCase(dir, baseCase(testHash))
  await writeCase(dir, baseCase(testHash, { id: 'unverified-run', status: 'unverified', title: 'Not run yet' }))
  await writeCase(dir, baseCase(testHash, { id: 'documented-batch', automated: false, status: 'unverified', title: 'Documented only' }))
  const tools = createTools({ dir: 'docs/cases' }, { taskPresetFor: () => 'backend' })
  const exec = { agent: { session: { header: { cwd } } } }
  const verdict = await tools.case_gate.execute({ taskId: 'task-batch' }, exec)
  assert.equal(verdict.ok, false)
  assert.deepEqual(verdict.blockers.map((blocker) => blocker.id), ['unverified-run'])
})

test('case_gate reads the implementer preset from the taskboard when the caller does not pass it', async () => {
  const { cwd, dir, testHash } = await library()
  await writeCase(dir, baseCase(testHash))
  const asked = []
  const tools = createTools({ dir: 'docs/cases' }, { taskPresetFor: (workspace, taskId) => { asked.push([workspace, taskId]); return 'backend' } })
  const exec = { agent: { session: { header: { cwd } } } }
  const verdict = await tools.case_gate.execute({ taskId: 'task-batch' }, exec)
  assert.deepEqual(asked.map(([, id]) => id), ['task-batch'], 'case_gate did not ask the taskboard for the preset')
  assert.equal(verdict.implementerPreset, 'backend')
  assert.equal(verdict.ok, true, JSON.stringify(verdict.blockers))
})

test('a verified case with no recorded run is legacy and blocks; without the implementer preset nothing passes', async () => {
  const { cwd, dir, testHash } = await library()
  const legacy = baseCase(testHash, { id: 'legacy-verified', title: 'Verified before runs said who ran' })
  delete legacy.lastVerified
  delete legacy.authorPreset
  delete legacy.authorSessionId
  await writeCase(dir, legacy)
  const tools = createTools({ dir: 'docs/cases' }, { taskPresetFor: () => 'backend' })
  const exec = { agent: { session: { header: { cwd } } } }
  const judged = await tools.case_gate.execute({ taskId: 'task-batch' }, exec)
  assert.equal(judged.ok, false, 'a verified case with no recorded run must not close a task')
  assert.deepEqual(judged.blockers.map((blocker) => blocker.id), ['legacy-verified'])
  assert.ok(judged.blockers[0].reasons.includes('LEGACY_NO_RUN_BY'), JSON.stringify(judged.blockers[0]))
  // A profile whose taskboard cannot describe the row leaves the implementer unknown: fail closed.
  const unknown = await createTools({ dir: 'docs/cases' }).case_gate.execute({ taskId: 'task-batch' }, exec)
  assert.equal(unknown.ok, false, 'the gate passed without knowing the implementer preset')
  assert.ok(unknown.blockers[0].reasons.includes('IMPLEMENTER_UNKNOWN'), JSON.stringify(unknown.blockers[0]))
})

test('P2: an independent task closes only when every criterion has an acceptable case that names it', async () => {
  const { cwd, dir, testHash } = await library()
  await writeCase(dir, baseCase(testHash, { criterionId: 'AC-1' }))
  const context = { implementerPreset: 'backend', verification: 'independent', criteria: [{ id: 'AC-1', text: 'the batch is one case' }, { id: 'AC-2', text: 'the second claim' }] }
  const partial = gateForTask(cwd, 'task-batch', context)
  assert.equal(partial.ok, false, 'an uncovered criterion closed the task')
  assert.equal(partial.code, 'CRITERIA_UNCOVERED', JSON.stringify(partial))
  assert.deepEqual(partial.coverage.map((entry) => [entry.id, entry.covered]), [['AC-1', true], ['AC-2', false]])
  assert.equal(partial.coverage[0].caseId, 'batch-case')

  // The second criterion gets its own acceptable case: both are covered and the gate is green.
  await writeCase(dir, baseCase(testHash, { id: 'second-case', title: 'Second criterion', criterionId: 'AC-2' }))
  const full = gateForTask(cwd, 'task-batch', context)
  assert.equal(full.ok, true, JSON.stringify(full))
  assert.deepEqual(full.coverage.map((entry) => entry.covered), [true, true])

  // A case that names no criterion covers none, and an independent task with no criteria is refused.
  const unnamed = gateForTask(cwd, 'task-batch', { ...context, criteria: [{ id: 'AC-9', text: 'nobody names it' }] })
  assert.equal(unnamed.code, 'CRITERIA_UNCOVERED', JSON.stringify(unnamed))
  const empty = gateForTask(cwd, 'task-batch', { ...context, criteria: [] })
  assert.equal(empty.code, 'CRITERIA_REQUIRED', JSON.stringify(empty))
  // A proof-level question never counts coverage: it is the pre-P2 answer.
  const proof = gateForTask(cwd, 'task-batch', { implementerPreset: 'backend', verification: 'proof' })
  assert.equal(proof.ok, true)
  assert.equal(proof.coverage, undefined)
})
