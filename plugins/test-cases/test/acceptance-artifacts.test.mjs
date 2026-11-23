/*
PROOF: the acceptance rule counts only evidence it can check, not fields it can read
Behavior: a verified-looking case is accepted only when the run it names exists in the record and
  on disk (runs/<case>/<runId>/run.json agreeing on the command hash, the runner, the exit code and
  the outcome), the author and the runner are KNOWN presets, the case is automated and not
  degraded, its surface list is not empty, and every file of the library could be read. A
  hand-written record with no runs, a tampered artifact, the literal "agent", a degraded case, an
  empty surface list and an unreadable file all block; the reported reason is the specific fact,
  not the generic "not verified".
Fails when: a typed-in record with correct-looking fields passes, an artifact that disagrees with
  the record passes, "agent" counts as an independent preset, deleting the test file removes the
  case from the rule, or a broken JSON file is swallowed as green.
Production path: plugins/test-cases/lib/acceptance.mjs (acceptanceOf, isAcceptanceCase,
  KNOWN_PRESETS, REASON_ORDER), lib/runner.mjs (runBy.taskId), test-cases.mjs (case_gate,
  case_record surface requirement, case_drift) and bin/cases.mjs.
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_ROLE_TOOLS, createTools } from '../test-cases.mjs'
import { KNOWN_PRESETS, REASON_ORDER } from '../lib/acceptance.mjs'

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
  const cwd = mkdtempSync(join(tmpdir(), 'test-cases-artifact-'))
  mkdirSync(join(cwd, 'docs', 'cases'), { recursive: true })
  writeFileSync(join(cwd, 'probe.mjs'), DRIVER, 'utf8')
  writeFileSync(join(cwd, 'run-probe.mjs'), RUN_PROBE, 'utf8')
  writeFileSync(join(cwd, 'surface.txt'), 'v1\n', 'utf8')
  return cwd
}

const exec = (cwd, preset, sessionId = `sess-${preset}`) => ({ agent: { session: { id: sessionId, header: { cwd, agentPreset: preset } } } })
const anonymous = (cwd) => ({ agent: { session: { id: 'sess-anonymous', header: { cwd } } } })
const caseRecord = (overrides = {}) => ({
  title: 'The probe passes',
  requirement: 'The probe reports the expected outcome',
  expected: 'the probe exits 0',
  automated: true,
  testPath: 'run-probe.mjs',
  runCommand: 'node run-probe.mjs',
  reqId: 'REQ-901',
  authorRole: 'orchestrator',
  surfaceFiles: ['probe.mjs'],
  // FR5: the claim the tester states, and the source that makes the scenario real.
  failsWhen: 'the probe reports success without writing its summary',
  trigger: 'a plain run of the probe with no arguments',
  oracle: 'the requirement: the probe exits 0 AND its summary exists',
  realism: 'the bug report that a silent success shipped once',
  realismReviewedBy: 'reviewer',
  realismReviewedAt: '2026-01-01T00:00:00.000Z',
  negativeControl: 'break',
  ...overrides,
})

async function record(tools, cwd, preset, overrides = {}) {
  const created = await tools.case_record.execute(caseRecord(overrides), exec(cwd, preset))
  assert.equal(created.ok, true, JSON.stringify(created))
  return JSON.parse(readFileSync(join(cwd, 'docs', 'cases', `${created.case.id}.json`), 'utf8'))
}

async function measure(tools, cwd, id, preset) {
  const first = await tools.case_get.execute({ id }, exec(cwd, preset))
  // THE RED THAT COUNTS (FR6): the stored command in a copy of the PREVIOUS version, where the
  // probe is the wrong implementation. The driver self-check alone is no longer acceptance evidence.
  const wrong = makeWrongTree(cwd)
  const red = await tools.case_run.execute({ id, expectedRevision: first.case.revision, mode: 'red', redSource: 'wrong-product', cwd: wrong }, exec(cwd, preset))
  assert.equal(red.ok, true, JSON.stringify(red))
  const second = await tools.case_get.execute({ id }, exec(cwd, preset))
  const green = await tools.case_run.execute({ id, expectedRevision: second.case.revision }, exec(cwd, preset))
  assert.equal(green.ok, true, JSON.stringify(green))
  return green
}

const toolsFor = () => createTools({ dir: 'docs/cases' }, { taskPresetFor: () => 'backend' })
const reasonsOf = (gate, id) => gate.blockers.find((entry) => entry.id === id)?.reasons ?? []

test('negative control expect-pre-fix: a typed-in verification used to pass', async () => {
  if (control !== 'expect-pre-fix') return
  const source = readFileSync(join(process.cwd(), 'plugins/test-cases/lib/acceptance.mjs'), 'utf8')
  // The pre-fix rule trusted `lastVerified.source === 'runner'` and never looked at runs/.
  assert.doesNotMatch(source, /RUN_ARTIFACT_MISSING/)
})

test('the known presets are the rows of the tool policy, so a new preset cannot be forgotten', () => {
  assert.deepEqual([...KNOWN_PRESETS].sort(), Object.keys(DEFAULT_ROLE_TOOLS).sort())
  assert.equal(REASON_ORDER.at(-1), 'NOT_VERIFIED', 'the generic reason must stay last')
  assert.equal(REASON_ORDER[0], 'DEGRADED')
})

test('a hand-written verified record with no run artifact is refused', async () => {
  const cwd = workspace()
  const tools = toolsFor()
  const stored = await record(tools, cwd, 'orchestrator', { title: 'Hand written', linkedTaskId: 'task-hand' })
  const path = join(cwd, 'docs', 'cases', `${stored.id}.json`)
  const hand = JSON.parse(readFileSync(path, 'utf8'))
  hand.status = 'verified'
  hand.runs = []
  hand.lastVerified = {
    at: '2026-01-01T00:00:00.000Z',
    command: 'node run-probe.mjs',
    exitCode: 0,
    runId: 'run-1-1',
    source: 'runner',
    runBy: { preset: 'reviewer', sessionId: 'sess-reviewer', taskId: 'task-hand' },
  }
  writeFileSync(path, `${JSON.stringify(hand, null, 2)}\n`, 'utf8')
  const gate = await tools.case_gate.execute({ taskId: 'task-hand' }, exec(cwd, 'orchestrator'))
  assert.equal(gate.ok, false, 'a typed-in verification passed the gate')
  assert.ok(reasonsOf(gate, hand.id).includes('RUN_ARTIFACT_MISSING'), JSON.stringify(reasonsOf(gate, hand.id)))
  assert.equal(gate.blockers[0].reason, 'RUN_ARTIFACT_MISSING')
})

test('a run artifact that disagrees with the record is refused', async () => {
  const cwd = workspace()
  const tools = toolsFor()
  const stored = await record(tools, cwd, 'orchestrator', { title: 'Tampered artifact', linkedTaskId: 'task-tampered' })
  const green = await measure(tools, cwd, stored.id, 'reviewer')
  const runId = green.case.lastVerified.runId
  const artifactPath = join(cwd, 'docs', 'cases', 'runs', stored.id, runId, 'run.json')
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
  assert.equal(artifact.runBy.taskId, 'task-tampered', 'the run did not record the task it answers to')
  artifact.commandSha256 = 'f'.repeat(64)
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  const gate = await tools.case_gate.execute({ taskId: 'task-tampered' }, exec(cwd, 'orchestrator'))
  assert.equal(gate.ok, false, 'a tampered run artifact passed the gate')
  assert.ok(reasonsOf(gate, stored.id).includes('RUN_MISMATCH'), JSON.stringify(reasonsOf(gate, stored.id)))
})

test('the literal agent is not a preset: neither an author nor a run from it is independent', async () => {
  const cwd = workspace()
  const tools = toolsFor()
  // authored by a session with no preset
  const anonymousCase = await tools.case_record.execute(caseRecord({ title: 'No preset author', authorRole: 'agent', linkedTaskId: 'task-anon-author' }), anonymous(cwd))
  assert.equal(anonymousCase.ok, true, JSON.stringify(anonymousCase))
  const anonymousStored = JSON.parse(readFileSync(join(cwd, 'docs', 'cases', `${anonymousCase.case.id}.json`), 'utf8'))
  assert.equal(anonymousStored.authorPreset, 'agent')
  await measure(tools, cwd, anonymousCase.case.id, 'reviewer')
  const byAuthor = await tools.case_gate.execute({ taskId: 'task-anon-author' }, exec(cwd, 'orchestrator'))
  assert.equal(byAuthor.ok, false, 'an anonymous author counted as independent')
  assert.ok(reasonsOf(byAuthor, anonymousCase.case.id).includes('UNKNOWN_PRESET'), JSON.stringify(reasonsOf(byAuthor, anonymousCase.case.id)))

  // authored by the orchestrator, run by a session with no preset
  const stored = await record(tools, cwd, 'orchestrator', { title: 'No preset runner', linkedTaskId: 'task-anon-runner' })
  const first = await tools.case_get.execute({ id: stored.id }, exec(cwd, 'reviewer'))
  const red = await tools.case_run.execute({ id: stored.id, expectedRevision: first.case.revision, mode: 'red', control: 'break' }, anonymous(cwd))
  assert.equal(red.ok, true, JSON.stringify(red))
  const second = await tools.case_get.execute({ id: stored.id }, exec(cwd, 'reviewer'))
  const green = await tools.case_run.execute({ id: stored.id, expectedRevision: second.case.revision }, anonymous(cwd))
  assert.equal(green.ok, true, JSON.stringify(green))
  assert.equal(green.case.lastVerified.runBy.preset, 'agent')
  const byRunner = await tools.case_gate.execute({ taskId: 'task-anon-runner' }, exec(cwd, 'orchestrator'))
  assert.equal(byRunner.ok, false, 'an anonymous run counted as independent')
  assert.ok(reasonsOf(byRunner, stored.id).includes('UNKNOWN_PRESET'), JSON.stringify(reasonsOf(byRunner, stored.id)))
})

test('a degraded acceptance case keeps blocking after its test file disappears', async () => {
  const cwd = workspace()
  const tools = toolsFor()
  const stored = await record(tools, cwd, 'orchestrator', { title: 'Degraded after the run', linkedTaskId: 'task-degraded' })
  await measure(tools, cwd, stored.id, 'reviewer')
  const before = await tools.case_gate.execute({ taskId: 'task-degraded' }, exec(cwd, 'orchestrator'))
  assert.equal(before.ok, true, JSON.stringify(before.blockers))
  unlinkSync(join(cwd, 'run-probe.mjs'))
  const drifted = await tools.case_drift.execute({}, exec(cwd, 'orchestrator'))
  assert.equal(drifted.ok, true, JSON.stringify(drifted))
  const after = JSON.parse(readFileSync(join(cwd, 'docs', 'cases', `${stored.id}.json`), 'utf8'))
  assert.equal(after.automated, false, 'the drift did not degrade the case')
  assert.equal(after.degraded, true)
  const blocked = await tools.case_gate.execute({ taskId: 'task-degraded' }, exec(cwd, 'orchestrator'))
  assert.equal(blocked.ok, false, 'deleting the test file closed the case out of the rule')
  assert.equal(blocked.blockers[0].reason, 'DEGRADED', JSON.stringify(blocked.blockers[0]))
  // Restoring the test and running it again brings the case back: the rule refuses, it does not
  // condemn. The author re-pins automation, then an independent preset measures a new red+green.
  writeFileSync(join(cwd, 'probe.mjs'), DRIVER, 'utf8')
  writeFileSync(join(cwd, 'run-probe.mjs'), RUN_PROBE, 'utf8')
  const restored = await tools.case_update.execute({ id: stored.id, expectedRevision: after.revision, automated: true }, exec(cwd, 'orchestrator'))
  assert.equal(restored.ok, true, JSON.stringify(restored))
  await measure(tools, cwd, stored.id, 'reviewer')
  const accepted = await tools.case_gate.execute({ taskId: 'task-degraded' }, exec(cwd, 'orchestrator'))
  assert.equal(accepted.ok, true, JSON.stringify(accepted.blockers))
})

test('an automated acceptance case needs a surface list, and an empty one blocks', async () => {
  const cwd = workspace()
  const tools = toolsFor()
  const missing = await tools.case_record.execute(caseRecord({ title: 'No surface', surfaceFiles: [] }), exec(cwd, 'orchestrator'))
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'SURFACE_FILES_REQUIRED')
  // An implementation case is the implementer's own test: it never closes a task, so the surface
  // requirement does not apply to it.
  const implementation = await tools.case_record.execute(caseRecord({ title: 'Own test', purpose: 'implementation', surfaceFiles: [], authorRole: 'backend' }), exec(cwd, 'backend'))
  assert.equal(implementation.ok, true, JSON.stringify(implementation))
  const stored = await record(tools, cwd, 'orchestrator', { title: 'Surface emptied', linkedTaskId: 'task-surface' })
  await measure(tools, cwd, stored.id, 'reviewer')
  const path = join(cwd, 'docs', 'cases', `${stored.id}.json`)
  const edited = JSON.parse(readFileSync(path, 'utf8'))
  edited.surfaceFiles = []
  writeFileSync(path, `${JSON.stringify(edited, null, 2)}\n`, 'utf8')
  const gate = await tools.case_gate.execute({ taskId: 'task-surface' }, exec(cwd, 'orchestrator'))
  assert.equal(gate.ok, false)
  assert.ok(reasonsOf(gate, stored.id).includes('SURFACE_FILES_MISSING'), JSON.stringify(reasonsOf(gate, stored.id)))
})

test('an unreadable case file blocks the task question instead of disappearing', async () => {
  const cwd = workspace()
  const tools = toolsFor()
  const stored = await record(tools, cwd, 'orchestrator', { title: 'Acceptable', linkedTaskId: 'task-readable' })
  await measure(tools, cwd, stored.id, 'reviewer')
  const good = await tools.case_gate.execute({ taskId: 'task-readable' }, exec(cwd, 'orchestrator'))
  assert.equal(good.ok, true, JSON.stringify(good.blockers))
  rmCorrupt(cwd, stored.id)
  const broken = await tools.case_gate.execute({ taskId: 'task-readable' }, exec(cwd, 'orchestrator'))
  assert.equal(broken.ok, false, 'a broken case file was swallowed as green')
  assert.equal(broken.errors[0].id, stored.id)
  assert.match(broken.errors[0].message, /could not be read/)
  // A case file whose stored id disagrees with its name is unreadable too.
  writeFileSync(join(cwd, 'docs', 'cases', 'renamed.json'), `${JSON.stringify({ ...stored, id: 'someone-else' }, null, 2)}\n`, 'utf8')
  const mismatched = await tools.case_gate.execute({ taskId: 'task-readable' }, exec(cwd, 'orchestrator'))
  assert.equal(mismatched.ok, false)
  assert.deepEqual(mismatched.errors.map((entry) => entry.code).sort(), ['CASE_ID_MISMATCH', 'CASE_UNREADABLE'])
})

test('authorRole is the agent\'s own preset; a human may name it', async () => {
  const cwd = workspace()
  const tools = toolsFor()
  const forged = await tools.case_record.execute(caseRecord({ title: 'Forged role', authorRole: 'orchestrator' }), exec(cwd, 'backend'))
  assert.equal(forged.ok, false)
  assert.equal(forged.code, 'AUTHOR_IMMUTABLE', JSON.stringify(forged))
  const own = await tools.case_record.execute(caseRecord({ title: 'Own role', authorRole: 'backend' }), exec(cwd, 'backend'))
  assert.equal(own.ok, true, JSON.stringify(own))
  const stored = JSON.parse(readFileSync(join(cwd, 'docs', 'cases', `${own.case.id}.json`), 'utf8'))
  assert.equal(stored.authorRole, 'backend')
  const named = await tools.case_record.execute(caseRecord({ title: 'Human named role', authorRole: 'orchestrator' }), { actor: 'human', agent: exec(cwd, 'backend').agent })
  assert.equal(named.ok, true, JSON.stringify(named))
})

test('the specific reason is reported first, not the generic one', async () => {
  const cwd = workspace()
  const tools = toolsFor()
  const stored = await record(tools, cwd, 'orchestrator', { title: 'Surface moved later', linkedTaskId: 'task-order' })
  await measure(tools, cwd, stored.id, 'reviewer')
  writeFileSync(join(cwd, 'probe.mjs'), `${DRIVER}// the product moved the expected behaviour\n`, 'utf8')
  const gate = await tools.case_gate.execute({ taskId: 'task-order' }, exec(cwd, 'orchestrator'))
  assert.equal(gate.ok, false)
  assert.equal(gate.blockers[0].reason, 'STALE', JSON.stringify(gate.blockers[0].reasons))
})

/** Corrupt one case file in place, the way a half-written or hand-edited file looks. */
function rmCorrupt(cwd, id) {
  writeFileSync(join(cwd, 'docs', 'cases', `${id}.json`), '{', 'utf8')
}
