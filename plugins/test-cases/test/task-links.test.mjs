/*
PROOF: a task owns its cases by id, so deleting one cannot close the task, and a broken file blocks only the task that names it
Behavior: case_record attaches the new case to the task row it names (via the taskboard service) and reports
  linked:false with a warning when it cannot; gateForTask asked with caseIds judges ONLY those ids and
  reports CASE_MISSING for a deleted case, CASE_UNREADABLE for a broken linked file, CASE_NOT_ACCEPTANCE
  for a documented/implementation one, and a healthy green for an empty list or for a task whose
  unrelated library file is broken. A row without caseIds keeps the legacy scan by linkedTaskId.
  A run artifact whose runBy.taskId disagrees with the case's linkedTaskId is RUN_MISMATCH. The CLI
  reads the same task row and the same known-preset list, so its verdict is the host's verdict.
Fails when: deleting a case file leaves the task closeable, one broken file blocks every task, the
  links live only in the case file, the run can answer to another task, or the CLI guesses the row.
Production path: plugins/test-cases/lib/acceptance.mjs (gateRows, KNOWN_PRESETS), test-cases.mjs
  (case_record linkCase, gateForTask caseIds), taskboard.mjs (caseIds on the row, beforeClose) and
  plugins/test-cases/bin/cases.mjs (gate --task reads .dsh/taskboard.json).
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_ROLE_TOOLS, createTools, gateForTask } from '../test-cases.mjs'
import { KNOWN_PRESETS } from '../lib/acceptance.mjs'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cases.mjs')

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
  const cwd = mkdtempSync(join(tmpdir(), 'test-cases-links-'))
  mkdirSync(join(cwd, 'docs', 'cases'), { recursive: true })
  mkdirSync(join(cwd, '.dsh'), { recursive: true })
  writeFileSync(join(cwd, 'probe.mjs'), DRIVER, 'utf8')
  writeFileSync(join(cwd, 'run-probe.mjs'), RUN_PROBE, 'utf8')
  writeFileSync(join(cwd, 'surface.txt'), 'v1\n', 'utf8')
  return cwd
}

const exec = (cwd, preset, sessionId = `sess-${preset}`) => ({ agent: { session: { id: sessionId, header: { cwd, agentPreset: preset } } } })

function caseRecord(overrides = {}) {
  return {
    title: 'The probe passes',
    requirement: 'The probe reports the expected outcome',
    expected: 'the probe exits 0',
    automated: true,
    testPath: 'run-probe.mjs',
    runCommand: 'node run-probe.mjs',
    reqId: 'REQ-902',
    authorRole: 'orchestrator',
    surfaceFiles: ['probe.mjs'],
    // FR5: the claim and the source that makes the scenario real.
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
  return created
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
}

/** The verified acceptance case an independent reviewer measured, linked to taskId. */
async function verifiedCase(cwd, taskId) {
  const tools = createTools({ dir: 'docs/cases' }, { taskPresetFor: () => 'backend' })
  const created = await record(tools, cwd, 'orchestrator', { title: `Probe for ${taskId}`, linkedTaskId: taskId })
  await measure(tools, cwd, created.case.id, 'reviewer')
  return { tools, id: created.case.id }
}

test('case_record attaches the case to the task row it names', async () => {
  const cwd = workspace()
  const linked = []
  const tools = createTools({ dir: 'docs/cases' }, { linkCase: async (agent, taskId, caseId) => { linked.push({ taskId, caseId }); return { ok: true, added: true } } })
  const created = await record(tools, cwd, 'orchestrator', { title: 'Linked by the tool', linkedTaskId: 'task-link' })
  assert.equal(created.linked, true, JSON.stringify(created))
  assert.deepEqual(linked, [{ taskId: 'task-link', caseId: created.case.id }])

  // No taskboard: the case is still recorded, and the answer says it was not linked.
  const orphan = await record(createTools({ dir: 'docs/cases' }), cwd, 'orchestrator', { title: 'Not linked', linkedTaskId: 'task-orphan' })
  assert.equal(orphan.linked, false, JSON.stringify(orphan))
  assert.match(orphan.warning, /task_update/, 'the answer does not say how to attach the case')
  assert.equal(readFileSync(join(cwd, 'docs', 'cases', `${orphan.case.id}.json`), 'utf8').length > 0, true)
})

test('a task that names its cases refuses a missing one and ignores unrelated broken files', async () => {
  const cwd = workspace()
  const { tools, id } = await verifiedCase(cwd, 'task-own')
  const healthy = gateForTask(cwd, 'task-own', { dir: 'docs/cases', implementerPreset: 'backend', knownPresets: Object.keys(DEFAULT_ROLE_TOOLS), caseIds: [id] })
  assert.equal(healthy.ok, true, JSON.stringify(healthy.blockers))
  assert.deepEqual(healthy.linked, [id])

  // An unrelated broken file must not block a task that names its own case (R2).
  writeFileSync(join(cwd, 'docs', 'cases', 'unrelated.json'), '{', 'utf8')
  const stillGreen = gateForTask(cwd, 'task-own', { dir: 'docs/cases', implementerPreset: 'backend', knownPresets: Object.keys(DEFAULT_ROLE_TOOLS), caseIds: [id] })
  assert.equal(stillGreen.ok, true, JSON.stringify(stillGreen.errors))

  // The linked file broken: that task, and only that task, refuses.
  writeFileSync(join(cwd, 'docs', 'cases', `${id}.json`), '{', 'utf8')
  const broken = gateForTask(cwd, 'task-own', { dir: 'docs/cases', implementerPreset: 'backend', knownPresets: Object.keys(DEFAULT_ROLE_TOOLS), caseIds: [id] })
  assert.equal(broken.ok, false)
  assert.deepEqual(broken.errors.map((entry) => entry.code), ['CASE_UNREADABLE'])
  // A different task with no links is untouched by that same broken file.
  const other = gateForTask(cwd, 'task-other', { dir: 'docs/cases', implementerPreset: 'backend', caseIds: [] })
  assert.equal(other.ok, true)
  assert.deepEqual(other.errors, [])

  // The linked file gone: the row still names it, so the close refuses instead of passing.
  const missing = gateForTask(cwd, 'task-gone', { dir: 'docs/cases', implementerPreset: 'backend', caseIds: ['deleted-case'] })
  assert.equal(missing.ok, false)
  assert.equal(missing.blockers[0].reason, 'CASE_MISSING', JSON.stringify(missing.blockers[0]))
})

test('an empty link list means the task owes no case, and a non-acceptance id cannot close it', async () => {
  const cwd = workspace()
  const none = gateForTask(cwd, 'task-l0', { dir: 'docs/cases', implementerPreset: 'backend', caseIds: [] })
  assert.equal(none.ok, true, JSON.stringify(none))
  assert.deepEqual(none.blockers, [])

  const tools = createTools({ dir: 'docs/cases' })
  const documented = await tools.case_record.execute(caseRecord({ title: 'Documented', automated: false, reason: 'why not', linkedTaskId: 'task-doc' }), exec(cwd, 'orchestrator'))
  assert.equal(documented.ok, true, JSON.stringify(documented))
  const verdict = gateForTask(cwd, 'task-doc', { dir: 'docs/cases', implementerPreset: 'backend', caseIds: [documented.case.id] })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.blockers[0].reason, 'CASE_NOT_ACCEPTANCE', JSON.stringify(verdict.blockers[0]))
})

test('a row without the link falls back to the scan by linkedTaskId (legacy)', async () => {
  const cwd = workspace()
  const { id } = await verifiedCase(cwd, 'task-legacy')
  const byScan = gateForTask(cwd, 'task-legacy', { dir: 'docs/cases', implementerPreset: 'backend', knownPresets: Object.keys(DEFAULT_ROLE_TOOLS) })
  assert.equal(byScan.ok, true, JSON.stringify(byScan.blockers))
  assert.deepEqual(byScan.evidence.map((entry) => entry.id), [id])
})

test('a run artifact recorded for another task is RUN_MISMATCH', async () => {
  const cwd = workspace()
  const { tools, id } = await verifiedCase(cwd, 'task-right')
  const path = join(cwd, 'docs', 'cases', `${id}.json`)
  const recordOnDisk = JSON.parse(readFileSync(path, 'utf8'))
  const runId = recordOnDisk.lastVerified.runId
  const artifactPath = join(cwd, 'docs', 'cases', 'runs', id, runId, 'run.json')
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
  assert.equal(artifact.runBy.taskId, 'task-right', 'the run did not record its task')
  artifact.runBy.taskId = 'task-somebody-else'
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  const verdict = await tools.case_gate.execute({ taskId: 'task-right' }, exec(cwd, 'orchestrator'))
  assert.equal(verdict.ok, false)
  assert.equal(verdict.blockers[0].reason, 'RUN_MISMATCH', JSON.stringify(verdict.blockers[0].reasons))
  assert.match(verdict.blockers[0].lastVerified ? 'artifact' : '', /artifact/)
})

test('a case that belongs to another task cannot close this one', async () => {
  const cwd = workspace()
  const { tools, id } = await verifiedCase(cwd, 'task-a')
  // Task B names task A's measured case: the evidence is real, and it is about other work.
  const foreign = gateForTask(cwd, 'task-b', { dir: 'docs/cases', implementerPreset: 'backend', knownPresets: Object.keys(DEFAULT_ROLE_TOOLS), caseIds: [id] })
  assert.equal(foreign.ok, false)
  assert.equal(foreign.blockers[0].reason, 'CASE_FOREIGN', JSON.stringify(foreign.blockers[0]))
  assert.equal(foreign.blockers[0].status, 'verified', 'the blocker must still report the case status')

  // A case that names no task cannot be claimed by a row either.
  const unlinked = await record(tools, cwd, 'orchestrator', { title: 'No task of its own' })
  await measure(tools, cwd, unlinked.case.id, 'reviewer')
  const unlinkedVerdict = gateForTask(cwd, 'task-c', { dir: 'docs/cases', implementerPreset: 'backend', knownPresets: Object.keys(DEFAULT_ROLE_TOOLS), caseIds: [unlinked.case.id] })
  assert.equal(unlinkedVerdict.ok, false)
  assert.equal(unlinkedVerdict.blockers[0].reason, 'CASE_UNLINKED', JSON.stringify(unlinkedVerdict.blockers[0]))

  // A case id that is not in the library is a refusal, not "nothing to check".
  const absent = gateForTask(cwd, 'task-d', { dir: 'docs/cases', implementerPreset: 'backend', caseIds: ['never-existed'] })
  assert.equal(absent.ok, false)
  assert.equal(absent.blockers[0].status, 'missing')
})

test('case_gate asked about one absent case refuses instead of answering green', async () => {
  const cwd = workspace()
  const tools = createTools({ dir: 'docs/cases' }, { taskPresetFor: () => 'backend' })
  const verdict = await tools.case_gate.execute({ id: 'never-written' }, exec(cwd, 'orchestrator'))
  assert.equal(verdict.ok, false, 'an absent case answered green')
  assert.equal(verdict.blockers[0].reason, 'CASE_MISSING')
  assert.equal(verdict.blockers[0].status, 'missing')
})

test('the CLI reads the task row and judges with the host list of presets', async () => {
  const cwd = workspace()
  // A case authored by the REVIEWER (a known preset) and measured by the reviewer: independent of
  // a backend task, so the only way to refuse it is to disagree with the host about the presets.
  const tools = createTools({ dir: 'docs/cases' })
  const created = await record(tools, cwd, 'reviewer', { title: 'Reviewer written', authorRole: 'reviewer', realismReviewedBy: 'orchestrator', linkedTaskId: 'task-cli' })
  await measure(tools, cwd, created.case.id, 'reviewer')
  writeFileSync(join(cwd, '.dsh', 'taskboard.json'), `${JSON.stringify({
    version: 1,
    revision: 4,
    tasks: [{ id: 'task-cli', revision: 1, title: 'cli', status: 'review', role: 'BACKEND', preset: 'backend', caseIds: [created.case.id] }],
    agents: [],
  }, null, 2)}\n`, 'utf8')
  const raw = execFileSync(process.execPath, [CLI, 'gate', '--task', 'task-cli', '--workspace', cwd, '--json'], { encoding: 'utf8' })
  const gate = JSON.parse(raw)
  assert.equal(gate.ok, true, JSON.stringify(gate.blockers))
  assert.equal(gate.implementerPreset, 'backend', 'the CLI did not read the implementer preset from the row')
  assert.deepEqual(gate.linked, [created.case.id], 'the CLI did not read the row caseIds')
  assert.deepEqual(gate.blockers, [])
  assert.deepEqual([...KNOWN_PRESETS].sort(), Object.keys(DEFAULT_ROLE_TOOLS).sort())

  // Without the row the CLI refuses to guess.
  let refused
  try {
    execFileSync(process.execPath, [CLI, 'gate', '--task', 'task-absent', '--workspace', cwd, '--json'], { encoding: 'utf8' })
    assert.fail('the CLI judged a task it could not read')
  } catch (error) {
    refused = { status: error.status, stdout: String(error.stdout ?? '') }
  }
  assert.equal(refused.status, 2)
  assert.match(refused.stdout, /TASKBOARD_UNREADABLE/)
})
