/*
PROOF: case_update can re-point a case at the task whose change it judges
Behavior: an author may pass linkedTaskId to case_update; the new link is written with the same
  compare-and-set, the recorded verification is dropped (stale, lastVerified null) because the
  green artifact named the previous task, the wrong-product red survives, and a fresh green run
  against the new link verifies the case again with runBy.taskId = the new task.
Fails when: the field is refused (the tester's case could never point at the implementing task),
  a relink keeps a verification that names another task, or the relink destroys the red.
Production path: plugins/test-cases/test-cases.mjs (CASE_UPDATE_PARAMS, the linkedTaskId write and
  the taskRelinked invalidation) with plugins/test-cases/lib/acceptance.mjs (RUN_MISMATCH).
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTools } from '../test-cases.mjs'

const RUN_PROBE = `import { existsSync } from 'node:fs'
await import('./probe.mjs')
if (typeof process.env.CASE_SUMMARY === 'string' && process.env.CASE_SUMMARY !== '' && !existsSync(process.env.CASE_SUMMARY)) process.exit(1)
console.log('probe ok')
`

const DRIVER = `import { writeFileSync } from 'node:fs'
if (process.env.CASE_SUMMARY) writeFileSync(process.env.CASE_SUMMARY, JSON.stringify({ metrics: {} }))
if (process.env.CASE_NEGATIVE_CONTROL === 'break') process.exit(1)
console.log('probe ok')
`

function workspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'test-cases-relink-'))
  mkdirSync(join(cwd, 'docs', 'cases'), { recursive: true })
  mkdirSync(join(cwd, '.dsh'), { recursive: true })
  writeFileSync(join(cwd, 'probe.mjs'), DRIVER, 'utf8')
  writeFileSync(join(cwd, 'run-probe.mjs'), RUN_PROBE, 'utf8')
  return cwd
}

/** The wrong product: the SAME test bytes, a different probe, a commit of its own. */
function makeWrongTree(cwd) {
  const wrong = mkdtempSync(join(tmpdir(), 'wrong-relink-'))
  writeFileSync(join(wrong, 'run-probe.mjs'), readFileSync(join(cwd, 'run-probe.mjs')))
  writeFileSync(join(wrong, 'probe.mjs'), 'process.exit(1)\n')
  execFileSync('git', ['init', '-q'], { cwd: wrong })
  execFileSync('git', ['add', '-A'], { cwd: wrong })
  execFileSync('git', ['-c', 'user.email=probe@example.com', '-c', 'user.name=Probe', 'commit', '--allow-empty', '-qm', 'the previous version'], { cwd: wrong })
  return wrong
}

const exec = (cwd, preset) => ({ agent: { session: { id: 'sess-' + preset, header: { cwd, agentPreset: preset } } } })

const CASE = {
  title: 'The probe passes',
  requirement: 'The probe reports the expected outcome',
  expected: 'the probe exits 0',
  automated: true,
  testPath: 'run-probe.mjs',
  runCommand: 'node run-probe.mjs',
  reqId: 'REQ-910',
  authorRole: 'orchestrator',
  surfaceFiles: ['probe.mjs'],
  failsWhen: 'the probe reports success without writing its summary',
  trigger: 'a plain run of the probe with no arguments',
  oracle: 'the requirement: the probe exits 0 AND its summary exists',
  realism: 'the bug report that a silent success shipped once',
  realismReviewedBy: 'reviewer',
  realismReviewedAt: '2026-01-01T00:00:00.000Z',
  negativeControl: 'break',
}

test('a relink moves the case to the implementing task, drops the old verification and keeps the red', async () => {
  const cwd = workspace()
  const tools = createTools({ dir: 'docs/cases' }, { taskPresetFor: () => 'backend' })
  const created = await tools.case_record.execute({ ...CASE, linkedTaskId: 'task-a' }, exec(cwd, 'orchestrator'))
  assert.equal(created.ok, true, JSON.stringify(created))

  const wrong = makeWrongTree(cwd)
  const red = await tools.case_run.execute({ id: created.case.id, expectedRevision: created.case.revision, mode: 'red', redSource: 'wrong-product', cwd: wrong }, exec(cwd, 'reviewer'))
  assert.equal(red.ok, true, 'the wrong-product red must run: ' + JSON.stringify(red))
  const afterRed = await tools.case_get.execute({ id: created.case.id }, exec(cwd, 'orchestrator'))
  const green = await tools.case_run.execute({ id: created.case.id, expectedRevision: afterRed.case.revision }, exec(cwd, 'reviewer'))
  assert.equal(green.ok, true, 'the green run must pass: ' + JSON.stringify(green))
  const verified = await tools.case_get.execute({ id: created.case.id }, exec(cwd, 'orchestrator'))
  assert.equal(verified.case.status, 'verified')
  assert.equal(verified.case.lastVerified.runBy.taskId, 'task-a')

  const relinked = await tools.case_update.execute({ id: created.case.id, expectedRevision: verified.case.revision, linkedTaskId: 'task-b' }, exec(cwd, 'orchestrator'))
  assert.equal(relinked.ok, true, 'case_update must accept linkedTaskId: ' + JSON.stringify(relinked))
  assert.equal(relinked.case.linkedTaskId, 'task-b')
  assert.equal(relinked.case.status, 'stale', 'the recorded green named task-a')
  assert.equal(relinked.case.lastVerified, null)
  const stored = JSON.parse(readFileSync(join(cwd, 'docs', 'cases', created.case.id + '.json'), 'utf8'))
  assert.ok(stored.redFirst !== undefined, 'the wrong-product red survives a relink')

  const beforeGreen = await tools.case_get.execute({ id: created.case.id }, exec(cwd, 'orchestrator'))
  const regreen = await tools.case_run.execute({ id: created.case.id, expectedRevision: beforeGreen.case.revision }, exec(cwd, 'reviewer'))
  assert.equal(regreen.ok, true, 'a fresh green must verify the new link: ' + JSON.stringify(regreen))
  const final = await tools.case_get.execute({ id: created.case.id }, exec(cwd, 'orchestrator'))
  assert.equal(final.case.status, 'verified')
  assert.equal(final.case.lastVerified.runBy.taskId, 'task-b')
})
