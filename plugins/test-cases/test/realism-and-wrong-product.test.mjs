/*
PROOF: an acceptance case states a realistic claim and proves it against a wrong product
Behavior: case_record refuses an automated acceptance case without failsWhen, trigger, oracle and
  realism (one refusal each), while an implementation case may omit them; case_update that changes
  any of them drops the verification (stale, evidence cleared); a green run backed only by the
  driver's negative-control red leaves the case `verified` but NOT acceptable
  (NOT_WRONG_PRODUCT_RED); a red against a copy of the previous version (redSource
  "wrong-product", no control hooks) is what the gate accepts.
Fails when: a case can be recorded without saying what it catches, a rewritten trigger keeps the
  old verification, or a driver self-check counts as the red that closes a task.
Production path: plugins/test-cases/test-cases.mjs (case_record, case_update, case_run),
  lib/runner.mjs (redSource), lib/acceptance.mjs (NOT_WRONG_PRODUCT_RED, REALISM_MISSING).
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_ROLE_TOOLS, createTools } from '../test-cases.mjs'

const RUN_PROBE = `import { existsSync } from 'node:fs'
await import('./probe.mjs')
if (typeof process.env.CASE_SUMMARY === 'string' && process.env.CASE_SUMMARY !== '' && !existsSync(process.env.CASE_SUMMARY)) process.exit(1)
console.log('probe ok')
`

/**
 * A REAL wrong-product tree (W1): OUTSIDE the workspace, with the SAME test bytes, the product
 * present and a commit of its own. What differs is the product - which is the only thing a red may
 * differ in.
 */
function makeWrongTree(cwd, driver = 'process.exit(1)\n') {
  const wrong = mkdtempSync(join(tmpdir(), 'wrong-version-'))
  // The SAME bytes as the workspace: a copy of the tree keeps its test and swaps the product.
  writeFileSync(join(wrong, 'run-probe.mjs'), readFileSync(join(cwd, 'run-probe.mjs')))
  writeFileSync(join(wrong, 'probe.mjs'), driver, 'utf8')
  execFileSync('git', ['init', '-q'], { cwd: wrong })
  execFileSync('git', ['add', '-A'], { cwd: wrong })
  execFileSync('git', ['-c', 'user.email=probe@example.com', '-c', 'user.name=Probe', 'commit', '--allow-empty', '-qm', 'the previous version'], { cwd: wrong })
  return wrong
}

const DRIVER = `import { writeFileSync } from 'node:fs'
if (process.env.CASE_SUMMARY) writeFileSync(process.env.CASE_SUMMARY, JSON.stringify({ metrics: {} }))
if (process.env.CASE_NEGATIVE_CONTROL === 'break') process.exit(1)
console.log('probe ok')
`

function workspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'test-cases-realism-'))
  mkdirSync(join(cwd, 'docs', 'cases'), { recursive: true })
  writeFileSync(join(cwd, 'probe.mjs'), DRIVER, 'utf8')
  writeFileSync(join(cwd, 'run-probe.mjs'), RUN_PROBE, 'utf8')
  writeFileSync(join(cwd, 'surface.txt'), 'v1\n', 'utf8')
  return cwd
}

const exec = (cwd, preset) => ({ agent: { session: { id: `sess-${preset}`, header: { cwd, agentPreset: preset } } } })
const toolsFor = () => createTools({ dir: 'docs/cases' }, { taskPresetFor: () => 'backend' })

function caseRecord(overrides = {}) {
  return {
    title: 'The probe passes',
    requirement: 'The probe reports the expected outcome',
    expected: 'the probe exits 0',
    automated: true,
    testPath: 'run-probe.mjs',
    runCommand: 'node run-probe.mjs',
    reqId: 'REQ-903',
    authorRole: 'tester',
    surfaceFiles: ['probe.mjs'],
    failsWhen: 'the probe reports success without writing its summary',
    trigger: 'a plain run of the probe with no arguments',
    oracle: 'the requirement: the probe exits 0 AND its summary exists',
    realism: 'the bug report that a silent success shipped once',
    realismReviewedBy: 'reviewer',
    realismReviewedAt: '2026-01-01T00:00:00.000Z',
    negativeControl: 'break',
    ...overrides,
  }
}

async function record(tools, cwd, preset, overrides = {}) {
  const created = await tools.case_record.execute(caseRecord(overrides), exec(cwd, preset))
  assert.equal(created.ok, true, JSON.stringify(created))
  return JSON.parse(readFileSync(join(cwd, 'docs', 'cases', `${created.case.id}.json`), 'utf8'))
}

test('an automated acceptance case states failsWhen, trigger, oracle and realism', async () => {
  const cwd = workspace()
  const tools = toolsFor()
  for (const [field, code] of [['failsWhen', 'FAILS_WHEN_REQUIRED'], ['trigger', 'TRIGGER_REQUIRED'], ['oracle', 'ORACLE_REQUIRED'], ['realism', 'REALISM_REQUIRED']]) {
    const refused = await tools.case_record.execute(caseRecord({ title: `No ${field}`, [field]: '' }), exec(cwd, 'tester'))
    assert.equal(refused.ok, false, `a case without ${field} was accepted`)
    assert.equal(refused.code, code, JSON.stringify(refused))
  }
  // The implementer's own case is not acceptance evidence, so it may say less.
  const own = await tools.case_record.execute(caseRecord({ title: 'Own test', purpose: 'implementation', authorRole: 'backend', failsWhen: '', trigger: '', oracle: '', realism: '', surfaceFiles: [] }), exec(cwd, 'backend'))
  assert.equal(own.ok, true, JSON.stringify(own))
  const stored = JSON.parse(readFileSync(join(cwd, 'docs', 'cases', `${own.case.id}.json`), 'utf8'))
  assert.equal(stored.failsWhen, undefined)
})

test('a rewritten trigger or oracle drops the verification', async () => {
  const cwd = workspace()
  const tools = toolsFor()
  const stored = await record(tools, cwd, 'tester', { title: 'Rewrite the claim', linkedTaskId: 'task-claim' })
  const wrong = makeWrongTree(cwd)
  const first = await tools.case_get.execute({ id: stored.id }, exec(cwd, 'tester'))
  const red = await tools.case_run.execute({ id: stored.id, expectedRevision: first.case.revision, mode: 'red', redSource: 'wrong-product', cwd: wrong }, exec(cwd, 'tester'))
  assert.equal(red.ok, true, JSON.stringify(red))
  const second = await tools.case_get.execute({ id: stored.id }, exec(cwd, 'tester'))
  const green = await tools.case_run.execute({ id: stored.id, expectedRevision: second.case.revision }, exec(cwd, 'tester'))
  assert.equal(green.case.status, 'verified', JSON.stringify(green.verdict))
  const edited = await tools.case_update.execute({ id: stored.id, expectedRevision: green.case.revision, trigger: 'a completely different input' }, exec(cwd, 'tester'))
  assert.equal(edited.ok, true, JSON.stringify(edited))
  assert.equal(edited.case.status, 'stale', 'a rewritten trigger kept the verification')
  const after = JSON.parse(readFileSync(join(cwd, 'docs', 'cases', `${stored.id}.json`), 'utf8'))
  assert.deepEqual(after.evidence, {})
})

test('a driver self-check is not the red that closes a task; a wrong-product red is', async () => {
  const cwd = workspace()
  const tools = toolsFor()
  const stored = await record(tools, cwd, 'tester', { title: 'Only a self-check', linkedTaskId: 'task-selfcheck' })
  const first = await tools.case_get.execute({ id: stored.id }, exec(cwd, 'tester'))
  const selfCheck = await tools.case_run.execute({ id: stored.id, expectedRevision: first.case.revision, mode: 'red', control: 'break' }, exec(cwd, 'tester'))
  assert.equal(selfCheck.ok, true, JSON.stringify(selfCheck))
  const second = await tools.case_get.execute({ id: stored.id }, exec(cwd, 'tester'))
  const green = await tools.case_run.execute({ id: stored.id, expectedRevision: second.case.revision }, exec(cwd, 'tester'))
  assert.equal(green.case.status, 'verified', 'the negative-control red still produces a measured verification')
  const storedRecord = JSON.parse(readFileSync(join(cwd, 'docs', 'cases', `${stored.id}.json`), 'utf8'))
  assert.equal(storedRecord.redFirst.source, 'negative-control')
  const gate = await tools.case_gate.execute({ taskId: 'task-selfcheck' }, exec(cwd, 'orchestrator'))
  assert.equal(gate.ok, false, 'a driver self-check closed the task')
  assert.ok(gate.blockers[0].reasons.includes('NOT_WRONG_PRODUCT_RED'), JSON.stringify(gate.blockers[0].reasons))

  // The same case, now with the red that counts: the test failed against the previous version.
  const current = await tools.case_get.execute({ id: stored.id }, exec(cwd, 'tester'))
  const wrong = makeWrongTree(cwd)
  const red = await tools.case_run.execute({ id: stored.id, expectedRevision: current.case.revision, mode: 'red', redSource: 'wrong-product', cwd: wrong }, exec(cwd, 'tester'))
  assert.equal(red.ok, true, JSON.stringify(red))
  const afterRed = JSON.parse(readFileSync(join(cwd, 'docs', 'cases', `${stored.id}.json`), 'utf8'))
  assert.equal(afterRed.redFirst.source, 'wrong-product')
  assert.equal(afterRed.redFirst.cwd, wrong, 'the wrong-product red did not record the tree it failed in')
  const after = await tools.case_get.execute({ id: stored.id }, exec(cwd, 'tester'))
  const again = await tools.case_run.execute({ id: stored.id, expectedRevision: after.case.revision }, exec(cwd, 'tester'))
  assert.equal(again.case.status, 'verified')
  const accepted = await tools.case_gate.execute({ taskId: 'task-selfcheck' }, exec(cwd, 'orchestrator'))
  assert.equal(accepted.ok, true, JSON.stringify(accepted.blockers))

  // W1: a "red" that would fail for the wrong reason is refused by name, before it runs.
  const empty = join(cwd, 'empty-tree')
  mkdirSync(empty, { recursive: true })
  const storedCase = await tools.case_get.execute({ id: stored.id }, exec(cwd, 'tester'))
  for (const [label, room] of [['empty directory', empty], ['session workspace', cwd], ['no cwd at all', undefined]]) {
    const refused = await tools.case_run.execute({ id: stored.id, expectedRevision: storedCase.case.revision, mode: 'red', redSource: 'wrong-product', ...(room === undefined ? {} : { cwd: room }) }, exec(cwd, 'tester'))
    assert.equal(refused.ok, false, `a wrong-product red in the ${label} was accepted`)
    assert.equal(refused.code, 'WRONG_PRODUCT_TREE_INVALID', `${label}: ${JSON.stringify(refused)}`)
  }

  // W1: a stub INSIDE the workspace is refused (it would borrow this tree and its HEAD), and a
  // tree without the product cannot show what the test does against another implementation.
  const stub = join(cwd, 'docs', 'cases', 'wrong')
  mkdirSync(join(stub, 'docs', 'cases', 'drivers'), { recursive: true })
  writeFileSync(join(stub, 'docs', 'cases', 'drivers', 'probe.mjs'), 'process.exit(1)\n', 'utf8')
  const inside = await tools.case_run.execute({ id: stored.id, expectedRevision: storedCase.case.revision, mode: 'red', redSource: 'wrong-product', cwd: stub }, exec(cwd, 'tester'))
  assert.equal(inside.ok, false, 'a stub under docs/cases was accepted as another version')
  assert.equal(inside.code, 'WRONG_PRODUCT_TREE_INVALID', JSON.stringify(inside))

  const testOnly = mkdtempSync(join(tmpdir(), 'test-only-'))
  writeFileSync(join(testOnly, 'run-probe.mjs'), readFileSync(join(cwd, 'run-probe.mjs')))
  const noProduct = await tools.case_run.execute({ id: stored.id, expectedRevision: storedCase.case.revision, mode: 'red', redSource: 'wrong-product', cwd: testOnly }, exec(cwd, 'tester'))
  assert.equal(noProduct.ok, false, 'a tree with only the test was accepted')
  assert.equal(noProduct.code, 'WRONG_PRODUCT_TREE_INVALID', JSON.stringify(noProduct))

  // The same test bytes under a different name are refused by name, not run.
  const renamed = makeWrongTree(cwd)
  writeFileSync(join(renamed, 'run-probe.mjs'), 'process.exit(1)\n', 'utf8')
  const mismatch = await tools.case_run.execute({ id: stored.id, expectedRevision: storedCase.case.revision, mode: 'red', redSource: 'wrong-product', cwd: renamed }, exec(cwd, 'tester'))
  assert.equal(mismatch.ok, false)
  assert.equal(mismatch.code, 'WRONG_PRODUCT_TEST_MISMATCH', JSON.stringify(mismatch))

  // D1+D2: a real clone with core.autocrlf=true (CRLF test bytes) of THIS checkout's commit is
  // not a previous version - it is refused for the HEAD, which also proves the bytes matched.
  execFileSync('git', ['init', '-q'], { cwd })
  execFileSync('git', ['add', '-A'], { cwd })
  execFileSync('git', ['-c', 'user.email=probe@example.com', '-c', 'user.name=Probe', 'commit', '--allow-empty', '-qm', 'the change'], { cwd })
  const clone = mkdtempSync(join(tmpdir(), 'same-head-'))
  execFileSync('git', ['clone', '-q', '-c', 'core.autocrlf=true', cwd, clone])
  writeFileSync(join(clone, 'probe.mjs'), 'process.exit(1)\n', 'utf8')
  const sameHead = await tools.case_run.execute({ id: stored.id, expectedRevision: storedCase.case.revision, mode: 'red', redSource: 'wrong-product', cwd: clone }, exec(cwd, 'tester'))
  assert.equal(sameHead.ok, false, 'a clone at the same commit was accepted as a previous version')
  assert.equal(sameHead.code, 'WRONG_PRODUCT_HEAD_NOT_PREVIOUS', JSON.stringify(sameHead))
  // The same clone with an EDIT to its test is still refused, by the test mismatch.
  writeFileSync(join(clone, 'run-probe.mjs'), `${RUN_PROBE}// edited in the clone\n`, 'utf8')
  const cloneEdited = await tools.case_run.execute({ id: stored.id, expectedRevision: storedCase.case.revision, mode: 'red', redSource: 'wrong-product', cwd: clone }, exec(cwd, 'tester'))
  assert.equal(cloneEdited.ok, false, 'an edited test in the clone was accepted')
  assert.equal(cloneEdited.code, 'WRONG_PRODUCT_TEST_MISMATCH', JSON.stringify(cloneEdited))

  // A "wrong product" that PASSES is refused by name: that tree is not wrong.
  const bad = makeWrongTree(cwd, DRIVER)
  const latest = await tools.case_get.execute({ id: stored.id }, exec(cwd, 'tester'))
  const passed = await tools.case_run.execute({ id: stored.id, expectedRevision: latest.case.revision, mode: 'red', redSource: 'wrong-product', cwd: bad }, exec(cwd, 'tester'))
  assert.equal(passed.ok, false)
  assert.equal(passed.code, 'WRONG_PRODUCT_DID_NOT_FAIL', JSON.stringify(passed))
  // The tester is a real preset row with the whole case surface.
  assert.ok(DEFAULT_ROLE_TOOLS.tester.includes('case_run'))
})

test('an automated acceptance case needs a realism sign-off, and it cannot be its own author', async () => {
  const cwd = workspace()
  const tools = toolsFor()
  const unsigned = await tools.case_record.execute(caseRecord({ title: 'Unsigned', realismReviewedBy: '', realismReviewedAt: '' }), exec(cwd, 'tester'))
  assert.equal(unsigned.ok, false, 'an unsigned acceptance case was recorded')
  assert.equal(unsigned.code, 'REALISM_SIGNOFF_REQUIRED', JSON.stringify(unsigned))
  const selfSigned = await tools.case_record.execute(caseRecord({ title: 'Self signed', realismReviewedBy: 'tester' }), exec(cwd, 'tester'))
  assert.equal(selfSigned.ok, false, 'the author confirmed its own scenario as real')
  assert.equal(selfSigned.code, 'REALISM_SIGNOFF_SELF', JSON.stringify(selfSigned))
  const badTime = await tools.case_record.execute(caseRecord({ title: 'Bad time', realismReviewedAt: 'yesterday-ish' }), exec(cwd, 'tester'))
  assert.equal(badTime.code, 'REALISM_SIGNOFF_INVALID', JSON.stringify(badTime))
  const signed = await tools.case_record.execute(caseRecord({ title: 'Signed by a reviewer' }), exec(cwd, 'tester'))
  assert.equal(signed.ok, true, JSON.stringify(signed))
  const stored = JSON.parse(readFileSync(join(cwd, 'docs', 'cases', `${signed.case.id}.json`), 'utf8'))
  assert.equal(stored.realismReviewedBy, 'reviewer')
  assert.equal(stored.realismReviewedAt, '2026-01-01T00:00:00.000Z')
})

test('case_update refuses a field it does not write, and names status', async () => {
  const cwd = workspace()
  const tools = toolsFor()
  const stored = await record(tools, cwd, 'tester')
  const status = await tools.case_update.execute({ id: stored.id, expectedRevision: stored.revision, status: 'verified' }, exec(cwd, 'tester'))
  assert.equal(status.ok, false, 'a typed-in status was accepted')
  assert.equal(status.code, 'CASE_FIELD_UNKNOWN', JSON.stringify(status))
  assert.match(status.message, /status/)
  const unknown = await tools.case_update.execute({ id: stored.id, expectedRevision: stored.revision, verdict: 'pass' }, exec(cwd, 'tester'))
  assert.equal(unknown.code, 'CASE_FIELD_UNKNOWN', JSON.stringify(unknown))
  assert.match(unknown.message, /verdict/)
  const after = JSON.parse(readFileSync(join(cwd, 'docs', 'cases', `${stored.id}.json`), 'utf8'))
  assert.equal(after.status, 'unverified', 'a refused edit changed the record')
  const real = await tools.case_update.execute({ id: stored.id, expectedRevision: stored.revision, title: 'Renamed' }, exec(cwd, 'tester'))
  assert.equal(real.ok, true, JSON.stringify(real))
})
