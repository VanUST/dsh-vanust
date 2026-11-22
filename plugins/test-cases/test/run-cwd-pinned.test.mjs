/*
PROOF: a run knows the directory it ran in, and a command pinned to one tree is refused
Behavior: case_run executes the stored command in `cwd` (absolute or workspace-relative, default
  the session workspace) and records cwd + cwdRelative with the run; case_get shows the directory
  of the last run and of the last observation; a case whose runCommand starts with `cd /...` or
  carries an absolute path is refused by case_record and case_update with PINNED_COMMAND and a
  hint to use a relative command plus cwd, while an already recorded such case stays readable.
Fails when: a run in a copy of the tree records the workspace instead of the copy, case_get has no
  directory to show, or a pinned command can be registered or re-saved.
Production path: plugins/test-cases/test-cases.mjs (case_run cwd, resolveCwd, pinnedCommand,
  case_record, case_update, case_get) and plugins/test-cases/lib/runner.mjs (run.json cwd).
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTools } from '../test-cases.mjs'

const control = process.env.CASE_NEGATIVE_CONTROL ?? ''

function library() {
  const cwd = mkdtempSync(join(tmpdir(), 'test-cases-cwd-'))
  const dir = join(cwd, 'docs', 'cases')
  mkdirSync(dir, { recursive: true })
  return { cwd, dir }
}

// The command is RELATIVE on purpose: it prints the directory it ran in, so the recorded cwd can be
// checked against what the command itself saw.
const PRINT_CWD = 'node -e "console.log(process.cwd())"'

function automation(cwd, overrides = {}) {
  mkdirSync(join(cwd, 'test'), { recursive: true })
  writeFileSync(join(cwd, 'test', 'anything.test.mjs'), '// placeholder for the case binding\n', 'utf8')
  // A case recorded by the tool freezes the test file's hash; a fixture written straight to disk
  // has to carry the same fields, or case_run refuses it as legacy (TEST_HASH_MISSING).
  const testHash = createHash('sha256').update(readFileSync(join(cwd, 'test', 'anything.test.mjs'))).digest('hex')
  return {
    schemaVersion: 1,
    id: 'prints-its-directory',
    title: 'The run says where it ran',
    requirement: 'A recorded red names the tree it was observed in',
    expected: 'the run echoes the directory it was given',
    kind: 'regression',
    source: 'agent',
    automated: true,
    testPath: 'test/anything.test.mjs',
    runCommand: PRINT_CWD,
    status: 'unverified',
    reqId: 'REQ-180',
    authorRole: 'backend',
    authorPreset: 'backend',
    purpose: 'acceptance',
    testHash,
    // An automated acceptance case names its surface; the fixture keeps the one file it has.
    surfaceFiles: [{ path: 'test/anything.test.mjs', sha256: testHash }],
    revision: 1,
    steps: ['run it'],
    tags: [],
    history: [],
    evidence: {},
    ...overrides,
  }
}

function writeCase(dir, record) {
  writeFileSync(join(dir, record.id + '.json'), JSON.stringify(record, null, 2) + '\n', 'utf8')
  return record
}

const exec = (cwd) => ({ agent: { session: { id: 'sess-backend', header: { cwd, agentPreset: 'backend' } } } })

test('negative control expect-pre-fix: a pinned command used to be accepted', async () => {
  if (control !== 'expect-pre-fix') return
  const { cwd } = library()
  const tools = createTools({ dir: 'docs/cases' })
  const verdict = await tools.case_record.execute({
    title: 'Pinned to one tree', requirement: 'r', expected: 'e', automated: true,
    testPath: 'test/anything.test.mjs', runCommand: 'cd /home/iustimov/tasks/autolabel_pipeline && node --test t.mjs',
    reqId: 'REQ-180', authorRole: 'BACKEND',
  }, exec(cwd))
  assert.equal(verdict.ok, true, 'the pre-fix library registered a command pinned to one tree: ' + JSON.stringify(verdict))
})

test('a run records the directory it happened in, and case_get shows it', async () => {
  const { cwd, dir } = library()
  const copy = join(cwd, 'copy-of-tree')
  mkdirSync(copy, { recursive: true })
  writeCase(dir, automation(cwd))
  const tools = createTools({ dir: 'docs/cases' })

  const inCopy = await tools.case_run.execute({ id: 'prints-its-directory', expectedRevision: 1, cwd: copy }, exec(cwd))
  assert.equal(inCopy.ok, true, JSON.stringify(inCopy))
  const seen = await tools.case_get.execute({ id: 'prints-its-directory' }, exec(cwd))
  const runId = seen.case.runs.at(-1).runId
  const run = JSON.parse(readFileSync(join(dir, 'runs', 'prints-its-directory', runId, 'run.json'), 'utf8'))
  assert.equal(run.cwd, copy, 'the run.json does not name the directory the command ran in')
  assert.equal(run.cwdRelative, 'copy-of-tree')
  const stdout = readFileSync(join(dir, 'runs', 'prints-its-directory', runId, 'stdout.log'), 'utf8')
  assert.equal(stdout.trim(), copy, 'the command did not actually run in the directory the record names')
  assert.equal(inCopy.verdict.cwd, copy)

  assert.equal(seen.directories.lastRun.cwd, copy, 'case_get does not show the directory of the last run')
  assert.equal(seen.directories.lastRun.cwdRelative, 'copy-of-tree')
  const record = seen.case
  assert.equal(record.runs.at(-1).cwd, copy, 'the stored run lost its directory')

  const atRoot = await tools.case_run.execute({ id: 'prints-its-directory', expectedRevision: record.revision }, exec(cwd))
  assert.equal(atRoot.ok, true, JSON.stringify(atRoot))
  assert.equal(atRoot.verdict.cwd, cwd, 'a run without cwd must happen in the session workspace')
  const after = await tools.case_get.execute({ id: 'prints-its-directory' }, exec(cwd))
  assert.equal(after.directories.lastRun.cwd, cwd)
  assert.notEqual(after.directories.lastRun.cwd, copy, 'the two runs must be tellable apart by their directory')
})

test('case_verify records the directory of the observation too', async () => {
  const { cwd, dir } = library()
  const copy = join(cwd, 'copy-of-tree')
  mkdirSync(copy, { recursive: true })
  writeCase(dir, automation(cwd))
  const tools = createTools({ dir: 'docs/cases' })
  const verdict = await tools.case_verify.execute({
    id: 'prints-its-directory',
    expectedRevision: 1,
    passed: false,
    evidence: { command: PRINT_CWD, output: copy, exitCode: 1, cwd: copy },
  }, exec(cwd))
  assert.equal(verdict.ok, true, JSON.stringify(verdict))
  assert.equal(verdict.evidence.run.cwd, copy, 'the observation lost the directory it was taken in')
  assert.equal(verdict.evidence.run.cwdRelative, 'copy-of-tree')
  const seen = await tools.case_get.execute({ id: 'prints-its-directory' }, exec(cwd))
  assert.equal(seen.directories.lastObservation.cwd, copy, 'case_get does not show the directory of the last observation')
})

test('a missing cwd is refused by name instead of failing inside the command', async () => {
  const { cwd, dir } = library()
  writeCase(dir, automation(cwd))
  const tools = createTools({ dir: 'docs/cases' })
  const verdict = await tools.case_run.execute({ id: 'prints-its-directory', expectedRevision: 1, cwd: 'there-is-no-such-tree' }, exec(cwd))
  assert.equal(verdict.ok, false)
  assert.equal(verdict.code, 'CWD_NOT_FOUND', JSON.stringify(verdict))
})

test('a command pinned to one checkout is refused with a named reason and a hint', async () => {
  const { cwd } = library()
  const tools = createTools({ dir: 'docs/cases' })
  const pinned = [
    'cd /home/iustimov/tasks/autolabel_pipeline && node --test test/x.test.mjs',
    'node --test /home/iustimov/tasks/autolabel_pipeline/test/x.test.mjs',
    'cd C:\\work\\repo && node --test test\\x.test.mjs',
  ]
  for (const runCommand of pinned) {
    const verdict = await tools.case_record.execute({
      title: 'Pinned ' + pinned.indexOf(runCommand), requirement: 'r', expected: 'e', automated: true,
      testPath: 'test/anything.test.mjs', runCommand, reqId: 'REQ-180', authorRole: 'BACKEND',
    }, exec(cwd))
    assert.equal(verdict.ok, false, 'a pinned command was registered: ' + runCommand)
    assert.equal(verdict.code, 'PINNED_COMMAND')
    assert.match(verdict.message, /cwd/, 'the refusal does not offer the relative-command + cwd route')
  }
})

test('a relative command, including a relative cd, is still accepted', async () => {
  const { cwd } = library()
  const tools = createTools({ dir: 'docs/cases' })
  const verdict = await tools.case_record.execute({
    title: 'Relative command stays valid', requirement: 'r', expected: 'e', automated: true,
    testPath: 'test/anything.test.mjs', runCommand: 'cd plugins/designmap && node --test test/x.test.mjs',
    reqId: 'REQ-180', authorRole: 'BACKEND', surfaceFiles: ['test/anything.test.mjs'],
    failsWhen: 'the command does not run in the directory it was given',
    trigger: 'a run with cwd',
    oracle: 'the command prints the directory it ran in',
    realism: 'the pinned-command bug report',
    realismReviewedBy: 'reviewer',
    realismReviewedAt: '2026-01-01T00:00:00.000Z',
  }, exec(cwd))
  assert.equal(verdict.ok, true, JSON.stringify(verdict))
})

test('an already recorded pinned case stays readable but cannot be saved through case_update', async () => {
  const { cwd, dir } = library()
  writeCase(dir, automation(cwd, { runCommand: 'cd /home/iustimov/tasks/autolabel_pipeline && node --test t.mjs' }))
  const tools = createTools({ dir: 'docs/cases' })
  const seen = await tools.case_get.execute({ id: 'prints-its-directory' }, exec(cwd))
  assert.equal(seen.ok, true, 'a pinned legacy case must stay readable')
  const edit = await tools.case_update.execute({ id: 'prints-its-directory', expectedRevision: 1, title: 'Retitled' }, exec(cwd))
  assert.equal(edit.ok, false, 'case_update saved a case whose command is pinned to one tree')
  assert.equal(edit.code, 'PINNED_COMMAND')
  const repaired = await tools.case_update.execute({ id: 'prints-its-directory', expectedRevision: 1, title: 'Retitled', runCommand: PRINT_CWD }, exec(cwd))
  assert.equal(repaired.ok, true, 'a repaired command must be saved: ' + JSON.stringify(repaired))
  assert.equal(repaired.case.revision, 2)
})
