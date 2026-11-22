/*
PROOF: the origin of a case's evidence is recorded, and a task closes only on independent, measured evidence
Behavior: case_record takes the author (preset + session) from the CALLING SESSION, records the
  purpose and the sha256 of the test file; an agent that names another author is refused
  (AUTHOR_IMMUTABLE) while a human may name one. case_verify on an automated case records a MANUAL
  observation and leaves the case unverified - a manual failure still sets failing. case_update is
  the author's or a human's (AUTHOR_ONLY), re-attribution is refused, a changed oracle
  (expected/steps/checks/surface) drops the verification, automation cannot be switched off nor an
  acceptance case downgraded by an agent (AUTOMATED_IMMUTABLE / PURPOSE_IMMUTABLE), and a changed
  test path re-pins the hash. case_run and case_suite record runBy and refuse to execute a test
  file whose bytes are not the recorded ones (TEST_HASH_MISSING / TEST_CHANGED). gateForTask
  refuses a self-authored, self-run, manually-reported, legacy or test-changed case and passes one
  an independent preset measured, returning the evidence of every case it judged.
Fails when: a manual pass verifies an automated case, an agent records or edits a case under
  another author, an oracle edit keeps the verification, a run stops recording who ran it, a run
  executes bytes the case never named, or the gate accepts a case whose evidence it cannot source.
Production path: plugins/test-cases/test-cases.mjs (case_record, case_update, case_verify,
  case_run, case_suite, case_gate, gateForTask), lib/acceptance.mjs and lib/schema.mjs.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gateForTask } from '../test-cases.mjs'
import { createTools } from '../test-cases.mjs'

const control = process.env.CASE_NEGATIVE_CONTROL ?? ''

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
  const cwd = mkdtempSync(join(tmpdir(), 'test-cases-provenance-'))
  const dir = join(cwd, 'docs', 'cases')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(cwd, 'probe.mjs'), DRIVER, 'utf8')
  writeFileSync(join(cwd, 'run-probe.mjs'), RUN_PROBE, 'utf8')
  writeFileSync(join(cwd, 'surface.txt'), 'v1\n', 'utf8')
  return { cwd, dir }
}

const exec = (cwd, preset, sessionId = `sess-${preset}`) => ({ agent: { session: { id: sessionId, header: { cwd, agentPreset: preset } } } })
const human = (cwd, preset = 'orchestrator') => ({ actor: 'human', agent: exec(cwd, preset).agent })

const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

function caseRecord(overrides = {}) {
  return {
    title: 'The probe passes',
    requirement: 'The probe reports the expected outcome',
    expected: 'the probe exits 0 and writes its summary',
    automated: true,
    testPath: 'run-probe.mjs',
    runCommand: 'node run-probe.mjs',
    reqId: 'REQ-900',
    authorRole: 'orchestrator',
    // An automated acceptance case must name the product surface its test exercises (F4).
    surfaceFiles: ['probe.mjs'],
    // FR5: the claim the tester states, and the source that makes the scenario real.
    failsWhen: 'the probe reports success without writing its summary',
    trigger: 'a plain run of the probe with no arguments',
    oracle: 'the requirement: the probe exits 0 AND its summary exists',
    realism: 'the bug report that a silent success shipped once',
    realismReviewedBy: 'reviewer',
    realismReviewedAt: '2026-01-01T00:00:00.000Z',
    tags: ['iv-suite'],
    negativeControl: 'break',
    ...overrides,
  }
}

/** Record one case and return the stored record. */
async function record(tools, cwd, preset, overrides = {}, sessionId) {
  const created = await tools.case_record.execute(caseRecord(overrides), exec(cwd, preset, sessionId))
  assert.equal(created.ok, true, JSON.stringify(created))
  return JSON.parse(readFileSync(join(cwd, 'docs', 'cases', `${created.case.id}.json`), 'utf8'))
}

/** Red then green, by the given preset: a measured verification. */
async function measure(tools, cwd, id, preset) {
  const before = await tools.case_get.execute({ id }, exec(cwd, preset))
  // THE RED THAT COUNTS (FR6): the same command in a copy of the PREVIOUS version, where the
  // probe is the wrong implementation and the test must fail. The driver self-check is not it.
  const wrong = makeWrongTree(cwd)
  const red = await tools.case_run.execute({ id, expectedRevision: before.case.revision, mode: 'red', redSource: 'wrong-product', cwd: wrong }, exec(cwd, preset))
  assert.equal(red.ok, true, JSON.stringify(red))
  const mid = await tools.case_get.execute({ id }, exec(cwd, preset))
  const green = await tools.case_run.execute({ id, expectedRevision: mid.case.revision }, exec(cwd, preset))
  assert.equal(green.ok, true, JSON.stringify(green))
  return green
}

const reasonsOf = (gate, id) => gate.blockers.find((entry) => entry.id === id)?.reasons ?? []

test('negative control expect-pre-fix: a manual pass used to verify an automated case', async () => {
  if (control !== 'expect-pre-fix') return
  const source = readFileSync(join(process.cwd(), 'plugins/test-cases/test-cases.mjs'), 'utf8')
  // The pre-fix shape: the manual automated pass returns status 'verified'.
  assert.match(source, /status: 'verified',\n        lastVerified: \{ at: evidence\.at, command: evidence\.command, exitCode: 0, source: 'manual'/)
})

test('case_record takes the author from the session, and an agent cannot name another one', async () => {
  const { cwd, dir } = workspace()
  const tools = createTools({ dir: 'docs/cases' })
  const stored = await record(tools, cwd, 'orchestrator', {}, 'sess-orchestrator')
  assert.equal(stored.authorPreset, 'orchestrator')
  assert.equal(stored.authorSessionId, 'sess-orchestrator')
  assert.equal(stored.purpose, 'acceptance', 'a case recorded without a purpose must be an acceptance case')
  assert.equal(stored.testHash, sha(join(cwd, 'run-probe.mjs')), 'the case did not freeze the test file hash')
  assert.equal(stored.createdBy, 'orchestrator')

  const forged = await tools.case_record.execute(caseRecord({ title: 'Forged author', authorPreset: 'reviewer' }), exec(cwd, 'backend'))
  assert.equal(forged.ok, false)
  assert.equal(forged.code, 'AUTHOR_IMMUTABLE', JSON.stringify(forged))

  const named = await tools.case_record.execute(caseRecord({ title: 'Named by a human', authorPreset: 'orchestrator' }), human(cwd, 'backend'))
  assert.equal(named.ok, true, JSON.stringify(named))
  const byHuman = JSON.parse(readFileSync(join(dir, `${named.case.id}.json`), 'utf8'))
  assert.equal(byHuman.authorPreset, 'orchestrator', 'a human could not name the author')
  assert.equal(byHuman.createdByKind, 'human')
})

test('a manual pass on an automated case is an observation, not a verification', async () => {
  const { cwd, dir } = workspace()
  const tools = createTools({ dir: 'docs/cases' })
  const stored = await record(tools, cwd, 'orchestrator')
  const verified = await tools.case_verify.execute({
    id: stored.id,
    expectedRevision: stored.revision,
    passed: true,
    evidence: { command: 'node run-probe.mjs', output: 'probe ok', exitCode: 0 },
  }, exec(cwd, 'backend'))
  assert.equal(verified.ok, true, JSON.stringify(verified))
  assert.equal(verified.case.status, 'unverified', 'a manual pass verified an automated case')
  assert.equal(verified.case.lastVerified, null)
  assert.equal(verified.evidence.observation.source, 'manual')
  assert.equal(verified.evidence.observation.passed, true)
  const storedRecord = JSON.parse(readFileSync(join(dir, `${stored.id}.json`), 'utf8'))
  assert.equal(storedRecord.evidence.observation.exitCode, 0)
  assert.equal(storedRecord.history.at(-1).action, 'observed-manual')

  const failed = await tools.case_verify.execute({
    id: stored.id,
    expectedRevision: verified.case.revision,
    passed: false,
    evidence: { command: 'node run-probe.mjs', output: 'boom', exitCode: 1 },
  }, exec(cwd, 'backend'))
  assert.equal(failed.case.status, 'failing', 'a manual failure must still be a finding')
})

test('case_update is the author\'s: another agent is refused, the author\'s oracle edit drops the verification', async () => {
  const { cwd } = workspace()
  const tools = createTools({ dir: 'docs/cases' })
  const stored = await record(tools, cwd, 'orchestrator')
  await measure(tools, cwd, stored.id, 'reviewer')
  const measured = await tools.case_get.execute({ id: stored.id }, exec(cwd, 'reviewer'))
  assert.equal(measured.case.status, 'verified')

  const other = await tools.case_update.execute({ id: stored.id, expectedRevision: measured.case.revision, expected: 'something else' }, exec(cwd, 'backend'))
  assert.equal(other.ok, false)
  assert.equal(other.code, 'AUTHOR_ONLY', JSON.stringify(other))

  const reattributed = await tools.case_update.execute({ id: stored.id, expectedRevision: measured.case.revision, authorRole: 'BACKEND' }, exec(cwd, 'orchestrator'))
  assert.equal(reattributed.ok, false)
  assert.equal(reattributed.code, 'AUTHOR_IMMUTABLE', JSON.stringify(reattributed))

  const edited = await tools.case_update.execute({ id: stored.id, expectedRevision: measured.case.revision, expected: 'a different outcome' }, exec(cwd, 'orchestrator'))
  assert.equal(edited.ok, true, JSON.stringify(edited))
  assert.equal(edited.case.status, 'stale', 'a changed expected outcome kept the verification')
  assert.equal(edited.case.lastVerified, null)
  const after = JSON.parse(readFileSync(join(cwd, 'docs', 'cases', `${stored.id}.json`), 'utf8'))
  assert.deepEqual(after.evidence, {})
})

test('switching automation off, or an acceptance case to implementation, is refused to an agent', async () => {
  const { cwd } = workspace()
  const tools = createTools({ dir: 'docs/cases' })
  const stored = await record(tools, cwd, 'orchestrator')
  const off = await tools.case_update.execute({ id: stored.id, expectedRevision: stored.revision, automated: false, reason: 'documented now' }, exec(cwd, 'orchestrator'))
  assert.equal(off.ok, false)
  assert.equal(off.code, 'AUTOMATED_IMMUTABLE', JSON.stringify(off))
  const downgrade = await tools.case_update.execute({ id: stored.id, expectedRevision: stored.revision, purpose: 'implementation' }, exec(cwd, 'orchestrator'))
  assert.equal(downgrade.ok, false)
  assert.equal(downgrade.code, 'PURPOSE_IMMUTABLE', JSON.stringify(downgrade))
})

test('a changed test path re-pins the test hash and drops the verification', async () => {
  const { cwd } = workspace()
  const tools = createTools({ dir: 'docs/cases' })
  writeFileSync(join(cwd, 'probe2.mjs'), DRIVER, 'utf8')
  const stored = await record(tools, cwd, 'orchestrator')
  await measure(tools, cwd, stored.id, 'reviewer')
  const measured = await tools.case_get.execute({ id: stored.id }, exec(cwd, 'reviewer'))
  const repinned = await tools.case_update.execute({ id: stored.id, expectedRevision: measured.case.revision, testPath: 'probe2.mjs', runCommand: 'node probe2.mjs' }, exec(cwd, 'orchestrator'))
  assert.equal(repinned.ok, true, JSON.stringify(repinned))
  const after = JSON.parse(readFileSync(join(cwd, 'docs', 'cases', `${stored.id}.json`), 'utf8'))
  assert.equal(after.testHash, sha(join(cwd, 'probe2.mjs')), 'the new test was not pinned')
  assert.equal(after.status, 'stale')
  assert.equal(after.lastVerified, null)
})

test('a run records who ran it, refuses unknown bytes, and sees a changed test file by name', async () => {
  const { cwd, dir } = workspace()
  const tools = createTools({ dir: 'docs/cases' })
  const stored = await record(tools, cwd, 'orchestrator')
  const green = await measure(tools, cwd, stored.id, 'reviewer')
  assert.deepEqual(green.runBy, { preset: 'reviewer', sessionId: 'sess-reviewer', taskId: null })
  assert.equal(green.case.lastVerified.runBy.preset, 'reviewer')
  const runs = green.case.lastRun === null ? [] : [green.case.lastRun]
  assert.equal(runs.length, 1)
  const runJson = JSON.parse(readFileSync(join(dir, 'runs', stored.id, `${green.case.lastRun.runId}`, 'run.json'), 'utf8'))
  assert.deepEqual(runJson.runBy, { preset: 'reviewer', sessionId: 'sess-reviewer', taskId: null })
  // The suite is the same measurement in bulk: its report and the case it ran both say who ran.
  const measured = await tools.case_suite.execute({ tag: 'iv-suite' }, exec(cwd, 'reviewer'))
  assert.equal(measured.ok, true, JSON.stringify(measured))
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, measured.report), 'utf8')).runBy, { preset: 'reviewer', sessionId: 'sess-reviewer', taskId: null })

  writeFileSync(join(cwd, 'run-probe.mjs'), `${RUN_PROBE}// the implementer changed the check\n`, 'utf8')
  const current = await tools.case_get.execute({ id: stored.id }, exec(cwd, 'reviewer'))
  const changed = await tools.case_run.execute({ id: stored.id, expectedRevision: current.case.revision }, exec(cwd, 'reviewer'))
  assert.equal(changed.ok, false)
  assert.equal(changed.code, 'TEST_CHANGED', JSON.stringify(changed))

  const legacy = JSON.parse(readFileSync(join(dir, `${stored.id}.json`), 'utf8'))
  delete legacy.testHash
  legacy.revision += 1
  writeFileSync(join(dir, `${stored.id}.json`), `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')
  const missing = await tools.case_run.execute({ id: stored.id, expectedRevision: legacy.revision }, exec(cwd, 'reviewer'))
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'TEST_HASH_MISSING', JSON.stringify(missing))

  // A suite reports the case it cannot bind instead of measuring it.
  const suite = await tools.case_suite.execute({ tag: 'iv-suite' }, exec(cwd, 'reviewer'))
  assert.equal(suite.ok, true, JSON.stringify(suite))
  assert.equal(suite.green, false, 'a suite over an unbound test reported green')
  assert.equal(suite.cases[0].skipped, 'TEST_HASH_MISSING')
})

test('the gate refuses self-authored, self-run, manual, legacy, test-changed and stale cases, and passes an independent run', async () => {
  const { cwd } = workspace()
  // The taskboard service the host mounts: the implementer preset of a row, read by task id.
  const tools = createTools({ dir: 'docs/cases' }, { taskPresetFor: () => 'backend' })
  const gate = async (taskId, id) => {
    // An AGENT asks; the preset comes from the task row, not from its argument (D4).
    const verdict = await tools.case_gate.execute({ taskId }, exec(cwd, 'orchestrator'))
    const reasons = reasonsOf(verdict, id)
    return { verdict, reasons }
  }

  // 1. authored by the implementer, measured by someone else
  await record(tools, cwd, 'backend', { title: 'Self authored', linkedTaskId: 'task-self-authored', authorRole: 'backend' })
  const selfAuthored = await gate('task-self-authored', 'self-authored')
  assert.equal(selfAuthored.verdict.ok, false, JSON.stringify(selfAuthored.verdict))
  assert.ok(selfAuthored.reasons.includes('SELF_AUTHORED'), JSON.stringify(selfAuthored.reasons))

  // 2. authored by the orchestrator, RUN by the implementer
  const runCase = await record(tools, cwd, 'orchestrator', { title: 'Self run', linkedTaskId: 'task-self-run' })
  await measure(tools, cwd, runCase.id, 'backend')
  const selfRun = await gate('task-self-run', runCase.id)
  assert.equal(selfRun.verdict.ok, false, JSON.stringify(selfRun.verdict))
  assert.ok(selfRun.reasons.includes('SELF_RUN'), JSON.stringify(selfRun.reasons))

  // 3. a manual pass by another preset is still not a measurement
  const manualCase = await record(tools, cwd, 'orchestrator', { title: 'Manual only', linkedTaskId: 'task-manual' })
  await tools.case_verify.execute({
    id: manualCase.id,
    expectedRevision: manualCase.revision,
    passed: true,
    evidence: { command: 'node run-probe.mjs', output: 'probe ok', exitCode: 0 },
  }, exec(cwd, 'reviewer'))
  const manual = await gate('task-manual', manualCase.id)
  assert.equal(manual.verdict.ok, false, JSON.stringify(manual.verdict))
  assert.ok(manual.reasons.includes('NOT_VERIFIED'), JSON.stringify(manual.reasons))

  // 4. legacy: verified, but nothing recorded who wrote or ran it
  const legacyCase = await record(tools, cwd, 'orchestrator', { title: 'Legacy verified', linkedTaskId: 'task-legacy' })
  await measure(tools, cwd, legacyCase.id, 'reviewer')
  const legacyPath = join(cwd, 'docs', 'cases', `${legacyCase.id}.json`)
  const legacy = JSON.parse(readFileSync(legacyPath, 'utf8'))
  delete legacy.authorPreset
  delete legacy.createdBy
  delete legacy.lastVerified.runBy
  writeFileSync(legacyPath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')
  const legacyVerdict = await gate('task-legacy', legacyCase.id)
  assert.equal(legacyVerdict.verdict.ok, false, JSON.stringify(legacyVerdict.verdict))
  assert.ok(legacyVerdict.reasons.includes('LEGACY_NO_AUTHOR'), JSON.stringify(legacyVerdict.reasons))
  assert.ok(legacyVerdict.reasons.includes('LEGACY_NO_RUN_BY'), JSON.stringify(legacyVerdict.reasons))

  // 5. the test file changed after the independent run
  const changedCase = await record(tools, cwd, 'orchestrator', { title: 'Test changed', linkedTaskId: 'task-changed' })
  await measure(tools, cwd, changedCase.id, 'reviewer')
  writeFileSync(join(cwd, 'run-probe.mjs'), `${RUN_PROBE}// changed after the run\n`, 'utf8')
  const changed = await gate('task-changed', changedCase.id)
  assert.equal(changed.verdict.ok, false, JSON.stringify(changed.verdict))
  assert.ok(changed.reasons.includes('TEST_CHANGED'), JSON.stringify(changed.reasons))

  // 6. a surface file moved after the independent run
  writeFileSync(join(cwd, 'surface.txt'), 'v1\n', 'utf8')
  const staleCase = await record(tools, cwd, 'orchestrator', { title: 'Surface moved', linkedTaskId: 'task-stale', surfaceFiles: ['probe.mjs'] })
  await measure(tools, cwd, staleCase.id, 'reviewer')
  writeFileSync(join(cwd, 'probe.mjs'), `${DRIVER}// the product moved\n`, 'utf8')
  const stale = await gate('task-stale', staleCase.id)
  assert.equal(stale.verdict.ok, false, JSON.stringify(stale.verdict))
  assert.ok(stale.reasons.includes('STALE'), JSON.stringify(stale.reasons))

  // 7. the independent run: the orchestrator wrote it, the reviewer measured it
  writeFileSync(join(cwd, 'probe.mjs'), DRIVER, 'utf8')
  writeFileSync(join(cwd, 'run-probe.mjs'), RUN_PROBE, 'utf8')
  const accepted = await record(tools, cwd, 'orchestrator', { title: 'Independently measured', linkedTaskId: 'task-accepted' })
  await measure(tools, cwd, accepted.id, 'reviewer')
  const passed = await tools.case_gate.execute({ taskId: 'task-accepted' }, exec(cwd, 'orchestrator'))
  assert.equal(passed.ok, true, JSON.stringify(passed.blockers))
  assert.equal(passed.presetSource, 'task')
  // D4: an agent that names a DIFFERENT implementer to talk itself green is ignored - the row wins.
  const substituted = await tools.case_gate.execute({ taskId: 'task-self-run', implementerPreset: 'reviewer' }, exec(cwd, 'orchestrator'))
  assert.equal(substituted.ok, false, 'an agent preset argument talked the gate green')
  assert.equal(substituted.presetSource, 'task')
  assert.ok(reasonsOf(substituted, runCase.id).includes('SELF_RUN'), JSON.stringify(reasonsOf(substituted, runCase.id)))
  assert.equal(passed.evidence.length, 1)
  const evidence = passed.evidence[0]
  assert.equal(evidence.id, accepted.id)
  assert.equal(evidence.status, 'verified')
  assert.equal(evidence.purpose, 'acceptance')
  assert.equal(evidence.authorPreset, 'orchestrator')
  assert.equal(evidence.runBy.preset, 'reviewer')
  assert.equal(evidence.source, 'runner')
  assert.equal(evidence.testHashOk, true)
  assert.equal(evidence.drift, null)
  assert.match(evidence.runId, /^\d|^[a-z0-9]+-/, 'the gate evidence does not name the run')

  // The same verdict through the taskboard's door: gateForTask with the implementer preset.
  const direct = gateForTask(cwd, 'task-accepted', { dir: 'docs/cases', implementerPreset: 'backend' })
  assert.equal(direct.ok, true, JSON.stringify(direct.blockers))
  const unknown = gateForTask(cwd, 'task-accepted', { dir: 'docs/cases' })
  assert.equal(unknown.ok, false, 'the gate passed without an implementer preset')
  assert.ok(unknown.blockers[0].reasons.includes('IMPLEMENTER_UNKNOWN'))
})
