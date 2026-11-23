#!/usr/bin/env node
/**
 * PURPOSE
 *   P0 proof for independent verification: reproduce the real ways an implementer used to sign
 *   off its own work, run each one against the code in this tree AND against the PRE-FIX tree
 *   (the commit before the acceptance gate landed, resolved from history), and show that every
 *   bypass is refused now while the pre-fix tree accepted it - plus the one path that must still
 *   pass (a case authored by the orchestrator and measured by the reviewer).
 *
 *   WHY THE OLD TREE IS RUN, NOT ASSERTED. A check that only asserts the new code's refusal
 *   cannot tell a closed hole from a hole that was never there. The red is the OLD code ACCEPTING
 *   the same sequence and closing the task; the green is the new code refusing it by name. Both
 *   are produced by the same scenario function over the two module trees, against real files,
 *   real task rows and real child processes (no stub of case_run, no `assert(false)`).
 *
 *   THE SCENARIOS (the bypass -> what the new code does):
 *     1. the implementer authors the acceptance case and confirms it manually
 *        -> the manual pass is an observation; the case stays unverified (NOT_VERIFIED).
 *     2. someone confirms the author's case manually with exit 0
 *        -> same rule, whichever preset typed it (NOT_VERIFIED / NOT_MEASURED).
 *     3. the author rewrites `expected` after a measured verification
 *        -> the verification is dropped; the case goes stale (NOT_VERIFIED).
 *     4. automation is switched off so the case can be confirmed by hand
 *        -> AUTOMATED_IMMUTABLE; a manual pass no longer verifies it either.
 *     5. the test file is edited after the verification
 *        -> TEST_CHANGED on the next run and in the gate.
 *     6. a verified case recorded before authors and runs were written down (legacy)
 *        -> LEGACY_NO_AUTHOR / LEGACY_NO_RUN_BY / TEST_HASH_MISSING.
 *     7. CONTROL: the orchestrator writes the case, the REVIEWER measures it
 *        -> accepted in both trees; without this the six refusals would prove nothing.
 *
 * INPUTS
 *   None. Reads the pre-fix commit for the modules it compares and writes its scratch trees under
 *   `.cache/independent-verification/` (derived, gitignored, removed on exit).
 *
 * OUTPUTS
 *   One PASS/FAIL line per check (new refusal + pre-fix acceptance), a summary line, and exit 0
 *   only when every check held: the six bypasses are refused here and were accepted before, and
 *   the control passes in both trees. Exit 1 otherwise, naming the check that failed.
 *
 * KEYWORDS
 *   independent verification, self-verification, provenance, acceptance gate, task close,
 *   test hash, legacy cases, red against the pre-fix commit
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = join(KIT, '.cache', 'independent-verification')
// The module that only exists from the acceptance gate onwards: the pre-fix commit is the one
// before this file was added, so it is what names the code the red is measured against.
const PRE_FIX_MODULE = 'plugins/test-cases/lib/acceptance.mjs'
const OLD_FILES = [
  'plugins/test-cases/test-cases.mjs',
  'plugins/test-cases/mirror.mjs',
  'plugins/test-cases/lib/schema.mjs',
  'plugins/test-cases/lib/store.mjs',
  'plugins/test-cases/lib/checks.mjs',
  'plugins/test-cases/lib/runner.mjs',
  'plugins/taskboard/taskboard.mjs',
  'plugins/taskboard/mirror.mjs',
]
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

const results = []
function check(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined || detail === '' ? '' : `  [${detail}]`}`)
}

/**
 * The commit the pre-fix modules are read from: the parent of the commit that ADDED the
 * acceptance gate. It is resolved from history on every run because HEAD stops being the
 * pre-fix tree the moment the gate is committed: on a clean checkout HEAD and this tree are the
 * same code, the collected tree is missing the gate's own module, and the red half silently
 * becomes a copy of the green half. A shallow clone has no adding commit, so the resolution
 * refuses loudly instead of pretending the two trees differ.
 */
function preFixRef() {
  const added = spawnSync('git', ['-C', KIT, 'log', '--diff-filter=A', '--format=%H', '-1', '--', PRE_FIX_MODULE], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  const sha = String(added.stdout ?? '').trim()
  if (added.status !== 0 || sha === '') {
    throw new Error(`cannot resolve the pre-fix commit: no commit in this clone added ${PRE_FIX_MODULE} (a shallow clone has no such history)`)
  }
  const parent = spawnSync('git', ['-C', KIT, 'rev-parse', `${sha}^`], { encoding: 'utf8' })
  const ref = String(parent.stdout ?? '').trim()
  if (parent.status !== 0 || ref === '') throw new Error(`cannot resolve the parent of ${sha} (the commit that added ${PRE_FIX_MODULE})`)
  return ref
}

/** The pre-fix module tree: the files above, exactly as the pre-fix commit has them. */
function oldTree(ref) {
  const root = join(SCRATCH, `pre-fix-${process.pid}`)
  for (const file of OLD_FILES) {
    const shown = spawnSync('git', ['-C', KIT, 'show', `${ref}:${file}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    if (shown.status !== 0) {
      throw new Error(`could not read ${file} from the pre-fix commit ${ref}: ${String(shown.stderr ?? '').trim() || 'git show failed'}`)
    }
    const target = join(root, file)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, shown.stdout, 'utf8')
  }
  return root
}

async function load(treeRoot) {
  const testCases = await import(pathToFileURL(join(treeRoot, 'plugins/test-cases/test-cases.mjs')).href)
  const taskboard = await import(pathToFileURL(join(treeRoot, 'plugins/taskboard/taskboard.mjs')).href)
  return { name: treeRoot === KIT ? 'new' : 'pre-fix', createTools: testCases.createTools, gateForTask: testCases.gateForTask, apply: taskboard.apply }
}

/**
 * One workspace with a probe test file, a task row and the two plugins wired the way the host
 * wires them: the taskboard reads the `cases` service on close, and that service is this tree's
 * `gateForTask`.
 */
function harness(tree) {
  const cwd = mkdtempSync(join(tmpdir(), 'iv-proof-'))
  mkdirSync(join(cwd, '.dsh'), { recursive: true })
  writeFileSync(join(cwd, 'probe.mjs'), DRIVER, 'utf8')
  writeFileSync(join(cwd, 'run-probe.mjs'), RUN_PROBE, 'utf8')
  const tools = tree.createTools({ dir: 'docs/cases' }, { presetFor: (agent) => agent?.session?.header?.agentPreset })
  const cases = {
    gateForTask: (dir, taskId, context) => tree.gateForTask(dir, taskId, { dir: 'docs/cases', ...(context ?? {}) }),
  }
  const registry = new Map()
  const ctx = {
    logger: { warn() {}, info() {} },
    provide(name, value) { registry.set(name, value); return value },
    effect(fn) { fn(); return () => {} },
    on() {},
    get(name) { return name === 'cases' ? cases : undefined },
    tools: { register() { return () => {} } },
    commands: { register() { return () => {} } },
  }
  tree.apply(ctx, { file: join(cwd, '.dsh', 'taskboard.json'), linksFile: join(cwd, 'links.json'), lockWaitMs: 1000 })
  return { cwd, tools, board: registry.get('taskboard') }
}

const session = (cwd, preset) => ({ agent: { session: { id: `sess-${preset}`, header: { cwd, agentPreset: preset } } }, actor: 'agent' })

/**
 * The row as a library written before the link existed: no `caseIds` field at all, so the case
 * library falls back to its scan by `linkedTaskId`. That is the only shape where the broad scan
 * still runs, and the shape these scenarios are about.
 */
function asLegacyRow(h, taskId) {
  const boardPath = join(h.cwd, '.dsh', 'taskboard.json')
  const board = JSON.parse(readFileSync(boardPath, 'utf8'))
  for (const entry of board.tasks ?? []) if (entry.id === taskId) delete entry.caseIds
  writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`, 'utf8')
}

/** A row for BACKEND, moved to review with a result so the only thing left is the close. */
function task(h) {
  const created = h.board.create(h.cwd, {
    title: 'The change under test',
    role: 'BACKEND',
    preset: 'backend',
    chatId: 'chat-1',
  })
  if (created === undefined || created.ok === false || typeof created.id !== 'string') {
    throw new Error(`the task row could not be created: ${JSON.stringify(created)}`)
  }
  const moved = h.board.update(h.cwd, {
    id: created.id,
    expectedRevision: created.revision,
    chatId: 'chat-1',
    patch: { status: 'review', result: { summary: 'the change is in', evidence: ['node --test x'] } },
  })
  if (moved === undefined || moved.ok === false) {
    throw new Error(`the task row could not move to review: ${JSON.stringify(moved)}`)
  }
  return moved.task ?? created
}

async function recordCase(h, taskId, preset, title) {
  const created = await h.tools.case_record.execute({
    title,
    requirement: 'The probe reports the expected outcome',
    expected: 'the probe exits 0 and writes its summary',
    automated: true,
    testPath: 'run-probe.mjs',
    runCommand: 'node run-probe.mjs',
    reqId: 'REQ-900',
    // The role label is the caller's own preset: an agent cannot write a case as somebody else.
    authorRole: preset,
    linkedTaskId: taskId,
    // An automated acceptance case must name the product surface its test exercises.
    surfaceFiles: ['probe.mjs'],
    // P1: the claim the tester states, and the source that makes the scenario real.
    failsWhen: 'the probe reports success without writing its summary',
    trigger: 'a plain run of the probe with no arguments',
    oracle: 'the requirement: the probe exits 0 AND its summary exists',
    realism: 'the bug report that a silent success shipped once',
    realismReviewedBy: 'reviewer',
    realismReviewedAt: '2026-01-01T00:00:00.000Z',
    negativeControl: 'break',
  }, session(h.cwd, preset))
  if (created.ok !== true) throw new Error(`case_record refused: ${JSON.stringify(created)}`)
  // The row names its case (the host links it through the taskboard service; here the scenario
  // does it explicitly, because the proof builds the two plugins by hand).
  const current = h.board.get(h.cwd, taskId)
  const ids = current !== null && Array.isArray(current?.caseIds) ? current.caseIds : []
  if (current !== null && !ids.includes(created.case.id)) {
    const linked = h.board.update(h.cwd, { id: taskId, expectedRevision: current.revision, chatId: 'chat-1', patch: { caseIds: [...ids, created.case.id] } })
    if (linked === undefined || linked.ok === false) throw new Error(`the case could not be linked to the row: ${JSON.stringify(linked)}`)
  }
  return created.case
}

/** Red then green by `preset`: a measured verification (the only kind that verifies). */
async function measure(h, id, preset) {
  // P1: the red that counts is a run against the PREVIOUS version - here a copy of the tree whose
  // probe is the wrong implementation. The driver self-check is no longer acceptance evidence.
  const wrong = mkdtempSync(join(tmpdir(), 'iv-wrong-'))
  writeFileSync(join(wrong, 'run-probe.mjs'), readFileSync(join(h.cwd, 'run-probe.mjs')))
  writeFileSync(join(wrong, 'probe.mjs'), 'process.exit(1)\n', 'utf8')
  // W1: the wrong tree must be a REAL version that can be named - a committed copy.
  execFileSync('git', ['init', '-q'], { cwd: wrong })
  execFileSync('git', ['add', '-A'], { cwd: wrong })
  execFileSync('git', ['-c', 'user.email=probe@example.com', '-c', 'user.name=Probe', 'commit', '--allow-empty', '-qm', 'the previous version'], { cwd: wrong })
  const first = await h.tools.case_get.execute({ id }, session(h.cwd, preset))
  const red = await h.tools.case_run.execute({ id, expectedRevision: first.case.revision, mode: 'red', redSource: 'wrong-product', cwd: wrong }, session(h.cwd, preset))
  if (red.ok !== true) throw new Error(`the wrong-product red failed: ${JSON.stringify(red)}`)
  const second = await h.tools.case_get.execute({ id }, session(h.cwd, preset))
  const green = await h.tools.case_run.execute({ id, expectedRevision: second.case.revision }, session(h.cwd, preset))
  if (green.ok !== true) throw new Error(`the green run failed: ${JSON.stringify(green)}`)
  return green
}

function close(h, id) {
  return h.board.close(h.cwd, {
    id,
    chatId: 'chat-1',
    parentSessionId: 'root',
    result: { summary: 'accepted', evidence: ['node --test probe.mjs'] },
  })
}

/** What the close decided, in one line of evidence. */
function verdictOf(closed) {
  if (closed !== null && closed.ok === true) return { accepted: true, code: 'closed', detail: 'the task closed' }
  const blockers = Array.isArray(closed?.blockers)
    ? closed.blockers.map((entry) => `${entry.id}:${(entry.reasons ?? [entry.reason]).filter(Boolean).join('+')}`).join(', ')
    : ''
  return {
    accepted: false,
    code: String(closed?.code ?? 'refused'),
    detail: [closed?.code, blockers].filter(Boolean).join(' '),
    message: typeof closed?.message === 'string' ? closed.message : '',
  }
}

// ---------------------------------------------------------------------------------------------
// The scenarios. Each takes one tree and returns the close verdict plus the detail the reader
// needs; the caller runs it against both trees.
// ---------------------------------------------------------------------------------------------

async function selfAuthoredManual(tree) {
  const h = harness(tree)
  const row = task(h)
  const record = await recordCase(h, row.id, 'backend', 'The probe passes')
  const observed = await h.tools.case_verify.execute({
    id: record.id,
    expectedRevision: record.revision,
    passed: true,
    evidence: { command: 'node run-probe.mjs', output: 'probe ok', exitCode: 0 },
    redFirst: { command: 'node run-probe.mjs', output: 'probe broke', exitCode: 1 },
  }, session(h.cwd, 'backend'))
  const closed = close(h, row.id)
  return { ...verdictOf(closed), status: observed.case?.status ?? observed.code }
}

async function manualConfirmExitZero(tree) {
  const h = harness(tree)
  const row = task(h)
  const record = await recordCase(h, row.id, 'orchestrator', 'The probe passes')
  const observed = await h.tools.case_verify.execute({
    id: record.id,
    expectedRevision: record.revision,
    passed: true,
    evidence: { command: 'node run-probe.mjs', output: 'probe ok', exitCode: 0 },
    redFirst: { command: 'node run-probe.mjs', output: 'probe broke', exitCode: 1 },
  }, session(h.cwd, 'reviewer'))
  const closed = close(h, row.id)
  return { ...verdictOf(closed), status: observed.case?.status ?? observed.code }
}

async function authorRewritesExpected(tree) {
  const h = harness(tree)
  const row = task(h)
  const record = await recordCase(h, row.id, 'orchestrator', 'The probe passes')
  const green = await measure(h, record.id, 'reviewer')
  const edit = await h.tools.case_update.execute({
    id: record.id,
    expectedRevision: green.case.revision,
    expected: 'the probe prints something else',
  }, session(h.cwd, 'orchestrator'))
  const closed = close(h, row.id)
  return { ...verdictOf(closed), edit: edit.ok === true ? `saved (status ${edit.case.status})` : String(edit.code) }
}

async function automationSwitchedOff(tree) {
  const h = harness(tree)
  const row = task(h)
  const record = await recordCase(h, row.id, 'orchestrator', 'The probe passes')
  // The case has NOT been measured: switching automation off is how the implementer turns "nobody
  // ran this" into "there is nothing to run", after which a manual pass is all the library asks.
  const off = await h.tools.case_update.execute({
    id: record.id,
    expectedRevision: record.revision,
    automated: false,
    reason: 'it is documented now',
  }, session(h.cwd, 'orchestrator'))
  if (off.ok === true) {
    const current = await h.tools.case_get.execute({ id: record.id }, session(h.cwd, 'orchestrator'))
    await h.tools.case_verify.execute({
      id: record.id,
      expectedRevision: current.case.revision,
      passed: true,
      evidence: { command: 'node run-probe.mjs', output: 'probe ok', exitCode: 0 },
    }, session(h.cwd, 'orchestrator'))
  }
  const closed = close(h, row.id)
  return { ...verdictOf(closed), edit: off.ok === true ? 'automation switched off' : String(off.code) }
}

async function testFileEdited(tree) {
  const h = harness(tree)
  const row = task(h)
  const record = await recordCase(h, row.id, 'orchestrator', 'The probe passes')
  const measured = await measure(h, record.id, 'reviewer')
  writeFileSync(join(h.cwd, 'run-probe.mjs'), `${RUN_PROBE}// edited after the verification\n`, 'utf8')
  const run = await h.tools.case_run.execute({ id: record.id, expectedRevision: measured.case.revision }, session(h.cwd, 'reviewer'))
  const closed = close(h, row.id)
  return { ...verdictOf(closed), rerun: run.ok === true ? 'the run executed the edited file' : String(run.code) }
}

async function legacyVerified(tree) {
  const h = harness(tree)
  const row = task(h)
  const dir = join(h.cwd, 'docs', 'cases')
  mkdirSync(dir, { recursive: true })
  // The shape a library written before P0 holds: verified, no author, no run, no test hash. It is
  // written straight to disk because that is exactly what an old library contains.
  writeFileSync(join(dir, 'legacy-probe.json'), `${JSON.stringify({
    schemaVersion: 1,
    id: 'legacy-probe',
    title: 'Verified before provenance was recorded',
    requirement: 'The probe reports the expected outcome',
    expected: 'the probe exits 0',
    kind: 'regression',
    source: 'agent',
    automated: true,
    testPath: 'run-probe.mjs',
    runCommand: 'node run-probe.mjs',
    status: 'verified',
    reqId: 'REQ-900',
    authorRole: 'BACKEND',
    linkedTaskId: row.id,
    surfaceFiles: [],
    revision: 2,
    steps: ['run it'],
    tags: [],
    history: [],
    evidence: {},
    lastVerified: { at: '2026-01-01T00:00:00.000Z', command: 'node probe.mjs', exitCode: 0, runId: 'old-run-1', source: 'runner' },
    runs: [],
  }, null, 2)}\n`, 'utf8')
  asLegacyRow(h, row.id)
  const closed = close(h, row.id)
  return verdictOf(closed)
}

async function unreadableCaseFile(tree) {
  const h = harness(tree)
  const row = task(h)
  const record = await recordCase(h, row.id, 'orchestrator', 'The probe passes')
  await measure(h, record.id, 'reviewer')
  // A half-written or hand-edited file: the requirement is still there, and nobody can read it.
  writeFileSync(join(h.cwd, 'docs', 'cases', `${record.id}.json`), '{', 'utf8')
  const closed = close(h, row.id)
  return verdictOf(closed)
}

async function handWrittenVerification(tree) {
  const h = harness(tree)
  const row = task(h)
  // Every field a verified case would carry, typed by hand: no run ever happened.
  const dir = join(h.cwd, 'docs', 'cases')
  mkdirSync(dir, { recursive: true })
  const command = 'node probe.mjs'
  writeFileSync(join(dir, 'typed-in.json'), `${JSON.stringify({
    schemaVersion: 1,
    id: 'typed-in',
    title: 'Typed in by hand',
    requirement: 'The probe reports the expected outcome',
    expected: 'the probe exits 0',
    kind: 'regression',
    source: 'agent',
    automated: true,
    purpose: 'acceptance',
    testPath: 'probe.mjs',
    runCommand: command,
    status: 'verified',
    reqId: 'REQ-900',
    authorRole: 'orchestrator',
    authorPreset: 'orchestrator',
    authorSessionId: 'sess-orchestrator',
    linkedTaskId: row.id,
    surfaceFiles: [{ path: 'probe.mjs', sha256: 'unused-by-this-check' }],
    runs: [],
    lastVerified: {
      at: '2026-01-01T00:00:00.000Z',
      command,
      exitCode: 0,
      runId: 'never-ran-1',
      source: 'runner',
      runBy: { preset: 'reviewer', sessionId: 'sess-reviewer', taskId: row.id },
    },
    revision: 3,
    steps: ['run it'],
    tags: [],
    history: [],
    evidence: {},
  }, null, 2)}\n`, 'utf8')
  asLegacyRow(h, row.id)
  const closed = close(h, row.id)
  return verdictOf(closed)
}

async function anonymousPreset(tree) {
  const h = harness(tree)
  const row = task(h)
  // A session with no preset records `agent`; the run is a real one, by the same kind of session.
  const created = await h.tools.case_record.execute({
    title: 'The probe passes',
    requirement: 'The probe reports the expected outcome',
    expected: 'the probe exits 0 and writes its summary',
    automated: true,
    testPath: 'run-probe.mjs',
    runCommand: 'node run-probe.mjs',
    reqId: 'REQ-900',
    authorRole: 'agent',
    linkedTaskId: row.id,
    surfaceFiles: ['probe.mjs'],
    failsWhen: 'the probe reports success without writing its summary',
    trigger: 'a plain run of the probe with no arguments',
    oracle: 'the requirement: the probe exits 0 AND its summary exists',
    realism: 'the bug report that a silent success shipped once',
    realismReviewedBy: 'reviewer',
    realismReviewedAt: '2026-01-01T00:00:00.000Z',
    negativeControl: 'break',
  }, { agent: { session: { id: 'sess-anonymous', header: { cwd: h.cwd } } }, actor: 'agent' })
  if (created.ok !== true) throw new Error(`case_record refused: ${JSON.stringify(created)}`)
  await measure(h, created.case.id, 'reviewer')
  asLegacyRow(h, row.id)
  const closed = close(h, row.id)
  return verdictOf(closed)
}

async function degradedCase(tree) {
  const h = harness(tree)
  const row = task(h)
  const record = await recordCase(h, row.id, 'orchestrator', 'The probe passes')
  await measure(h, record.id, 'reviewer')
  // The test file disappears: case_drift degrades the case to documented-only (automated:false).
  unlinkSync(join(h.cwd, 'run-probe.mjs'))
  const drifted = await h.tools.case_drift.execute({}, session(h.cwd, 'orchestrator'))
  if (drifted.ok !== true) throw new Error(`case_drift refused: ${JSON.stringify(drifted)}`)
  const closed = close(h, row.id)
  return { ...verdictOf(closed), drift: drifted.findings?.length === 1 ? 'degraded' : 'unchanged' }
}

async function deletedLinkedCase(tree) {
  const h = harness(tree)
  const row = task(h)
  const record = await recordCase(h, row.id, 'orchestrator', 'The probe passes')
  await measure(h, record.id, 'reviewer')
  // The task row NAMES its case; then the file disappears. The row is the thing that outlives it.
  const current = h.board.get(h.cwd, row.id)
  const ids = Array.isArray(current?.caseIds) ? current.caseIds : []
  if (!ids.includes(record.id)) {
    const linked = h.board.update(h.cwd, { id: row.id, expectedRevision: current.revision, chatId: 'chat-1', patch: { caseIds: [...ids, record.id] } })
    if (linked === undefined || linked.ok === false) throw new Error(`the row could not name its case: ${JSON.stringify(linked)}`)
  }
  unlinkSync(join(h.cwd, 'docs', 'cases', `${record.id}.json`))
  const closed = close(h, row.id)
  return verdictOf(closed)
}

async function independentRun(tree) {
  const h = harness(tree)
  const row = task(h)
  const record = await recordCase(h, row.id, 'orchestrator', 'The probe passes')
  await measure(h, record.id, 'reviewer')
  const closed = close(h, row.id)
  return verdictOf(closed)
}

// ---------------------------------------------------------------------------------------------

const SCENARIOS = [
  { id: 'self-authored manual confirmation', run: selfAuthoredManual, expect: 'blocked' },
  { id: 'manual confirmation with exit 0', run: manualConfirmExitZero, expect: 'blocked' },
  { id: 'expected rewritten after verification', run: authorRewritesExpected, expect: 'blocked' },
  { id: 'automation switched off by hand', run: automationSwitchedOff, expect: 'blocked' },
  { id: 'test file edited after the run', run: testFileEdited, expect: 'blocked' },
  { id: 'legacy verified case with no provenance', run: legacyVerified, expect: 'blocked' },
  { id: 'unreadable case file', run: unreadableCaseFile, expect: 'blocked' },
  { id: 'hand-written verification with no run artifact', run: handWrittenVerification, expect: 'blocked' },
  { id: 'anonymous preset as author', run: anonymousPreset, expect: 'blocked' },
  { id: 'degraded case whose test file is gone', run: degradedCase, expect: 'blocked' },
  { id: 'deleted case the task row still names', run: deletedLinkedCase, expect: 'blocked' },
  { id: 'CONTROL: orchestrator writes, reviewer measures', run: independentRun, expect: 'accepted' },
]

async function main() {
  mkdirSync(SCRATCH, { recursive: true })
  let oldRoot = ''
  let preFixLog = 'unresolved'
  try {
    const preFix = preFixRef()
    preFixLog = `${preFix.slice(0, 7)}: ${String(spawnSync('git', ['-C', KIT, 'log', '-1', '--format=%s', preFix], { encoding: 'utf8' }).stdout ?? '').trim()}`
    oldRoot = oldTree(preFix)
    const [now, before] = await Promise.all([load(KIT), load(oldRoot)])
    // P1: the tester seat, its write scope, and the red that counts.
    const { PRESET_IDS, presetForRole } = await import(pathToFileURL(join(KIT, 'plugins/orchestrator/orchestrator.mjs')).href)
    check('P1: TESTER is a child preset and QA/TESTER map to it', PRESET_IDS.includes('tester') && presetForRole('QA') === 'tester' && presetForRole('TESTER') === 'tester', `${PRESET_IDS.length} presets`)
    const guard = await import(pathToFileURL(join(KIT, 'plugins/proof-guard/proof-guard.mjs')).href)
    const guardHandlers = []
    guard.apply({ on: (event, handler) => { if (event === 'tools/pre-execute') guardHandlers.push(handler) }, get: () => undefined, logger: { warn() {} } }, {
      mode: 'deny',
      roles: { tester: { allow: ['docs/cases/', 'test/', 'tests/', '**/*.test.*', '**/*.spec.*'] } },
    })
    const guardCwd = mkdtempSync(join(tmpdir(), 'iv-guard-'))
    // The guard registers more than one pre-execute listener (the scope and the shell audit):
    // run them in order, as the tool pipeline does.
    const guardExec = async (name, path, content = '') => {
      const exec = { name, arguments: { file_path: path, content, new_string: content }, agent: { session: { header: { cwd: guardCwd, agentPreset: 'tester', id: 'sess-guard' } } } }
      const step = async (index) => (index >= guardHandlers.length ? { kind: 'allow' } : guardHandlers[index](exec, () => step(index + 1)))
      return step(0)
    }
    const productWrite = await guardExec('write', join(guardCwd, 'src', 'probe.mjs'), 'export default 1\n')
    check('P1: the TESTER cannot write product code', productWrite?.kind === 'deny' && /WRITE_SCOPE/.test(String(productWrite?.reason)), String(productWrite?.kind))
    // B1: a path that starts with an allowed PREFIX and climbs out is still the product file.
    const climb = await guardExec('write', 'docs/cases/../../src/app.mjs', 'export default 1\n')
    check('P1/B1: a path climbing out of the case root is refused', climb?.kind === 'deny' && /WRITE_SCOPE/.test(String(climb?.reason)), String(climb?.kind))
    // W1: a "wrong product" that is an empty directory is refused before a byte is measured.
    const w1 = harness(now)
    const w1Row = task(w1)
    const w1Case = await recordCase(w1, w1Row.id, 'tester', 'The probe passes')
    const emptyTree = join(w1.cwd, 'empty-tree')
    mkdirSync(emptyTree, { recursive: true })
    const emptyRed = await w1.tools.case_run.execute({ id: w1Case.id, expectedRevision: w1Case.revision, mode: 'red', redSource: 'wrong-product', cwd: emptyTree }, session(w1.cwd, 'tester'))
    check('P1/W1: a wrong-product red in an empty tree is refused', emptyRed.ok === false && emptyRed.code === 'WRONG_PRODUCT_TREE_INVALID', String(emptyRed.code ?? emptyRed.ok))
    const caseWrite = await guardExec('write', join(guardCwd, 'docs', 'cases', 'probe.json'), '{}')
    const testWrite = await guardExec('write', join(guardCwd, 'test', 'probe.test.mjs'), '/*\nPROOF: x\nBehavior: y\nFails when: z\n*/\n')
    check('P1: the TESTER may write its case and a PROOF header test', caseWrite?.kind === 'allow' && testWrite?.kind === 'allow', `${String(caseWrite?.kind)}/${String(testWrite?.kind)}`)
    rmSync(guardCwd, { recursive: true, force: true })

    for (const scenario of SCENARIOS) {
      let fresh
      let old
      try {
        fresh = await scenario.run(now)
      } catch (error) {
        check(`${scenario.id}: the new tree runs the scenario`, false, String(error?.message ?? error))
        continue
      }
      try {
        old = await scenario.run(before)
      } catch (error) {
        check(`${scenario.id}: the pre-fix tree runs the scenario`, false, String(error?.message ?? error))
        continue
      }
      const wanted = scenario.expect === 'accepted'
      const newOk = fresh.accepted === wanted
      const said = typeof fresh.message === 'string' && fresh.message !== '' ? ` · "${fresh.message}"` : ''
      check(`${scenario.id}: the new tree ${wanted ? 'accepts' : 'refuses'} it`, newOk, `${fresh.code}${fresh.status ? ` · case ${fresh.status}` : ''}${fresh.edit ? ` · ${fresh.edit}` : ''}${fresh.rerun ? ` · ${fresh.rerun}` : ''}${said}`)
      if (!wanted) {
        // The red half: the SAME sequence against the pre-fix tree must get through, or this
        // scenario was never a bypass and its refusal here proves nothing.
        check(`${scenario.id}: the pre-fix tree accepted the bypass (the red)`, old.accepted === true, `${old.code}${old.status ? ` · case ${old.status}` : ''}${old.edit ? ` · ${old.edit}` : ''}${old.rerun ? ` · ${old.rerun}` : ''}`)
      } else {
        check(`${scenario.id}: the pre-fix tree accepts it too (the gate is not simply always red)`, old.accepted === true, old.code)
      }
    }
  } finally {
    if (oldRoot !== '') rmSync(oldRoot, { recursive: true, force: true })
  }
  const failed = results.filter((entry) => !entry.ok)
  const bypasses = SCENARIOS.filter((scenario) => scenario.expect === 'blocked').length
  console.log(`\n${results.length - failed.length}/${results.length} checks held: ${bypasses} bypass(es) refused here and accepted by the pre-fix tree (${preFixLog}), 1 independent run accepted in both trees`)
  if (failed.length > 0) {
    console.log(`FAILED: ${failed.map((entry) => entry.name).join('; ')}`)
    process.exit(1)
  }
  console.log('independent verification: every bypass is refused and the independent run still passes')
  process.exit(0)
}

await main()
