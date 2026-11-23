#!/usr/bin/env node
/**
 * PURPOSE
 *   Run the case library from a terminal: the same runner and the same decision logic the host
 *   tool `case_run` uses, without a harness. This is the `make cases` entry and the CI hook, and
 *   it is also how a benchmark case is measured once and then gated.
 *
 * INPUTS
 *   cases list  [--status <s>] [--tag <t>] [--automated] [--json]
 *   cases run   --id <case> [--runs 1..5] [--timeout <ms>] [--set-baseline] [--commit <sha>]
 *               [--red --control <name>] [--json]
 *   cases suite [--tag <t>] [--kind <k>] [--status <s>] [--runs 1..5] [--timeout <ms>] [--json]
 *   cases gate  (--task <taskId> | --id <case>) [--implementer <preset>] [--json]
 *   Common: --workspace <dir> (default: cwd), --dir <library> (default: docs/cases).
 *
 *   `gate` reads the SAME acceptance rule as the host `case_gate` and the taskboard's close
 *   (lib/acceptance.mjs). Independence is judged against the preset that did the work, so a
 *   terminal caller must name it with `--implementer`; without it every acceptance case is
 *   refused as IMPLEMENTER_UNKNOWN rather than passing because nothing was compared.
 *
 * OUTPUTS
 *   Human text or JSON on stdout. Exit 0 = the case/suite/gate is green; 1 = ran but not green;
 *   2 = a refusal (bad id, not automated, no red control, a write failure).
 *
 * KEYWORDS
 *   case runner CLI, make cases, suite report, task gate, measured evidence
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { KNOWN_PRESETS, REASONS, gateRows } from '../lib/acceptance.mjs'
import { testHashState } from '../lib/schema.mjs'
import { readCase, readCases, writeCase, libraryDir, Refusal } from '../lib/store.mjs'
import { runAttempts, recordRun, spawnExec } from '../lib/runner.mjs'

function usage() {
  return `Usage:
  node plugins/test-cases/bin/cases.mjs list  [--status s] [--tag t] [--automated] [--json]
  node plugins/test-cases/bin/cases.mjs run   --id <case> [--runs 1..5] [--timeout ms] [--set-baseline] [--json]
  node plugins/test-cases/bin/cases.mjs run   --id <case> --red --control <name> [--json]
  node plugins/test-cases/bin/cases.mjs suite [--tag t] [--kind k] [--status s] [--runs 1..5] [--json]
  node plugins/test-cases/bin/cases.mjs gate  (--task <taskId> | --id <case>) [--implementer <preset>] [--board <path>] [--json]

Common: --workspace <dir> (default cwd), --dir <library> (default docs/cases).`
}

function parseArgs(argv) {
  const options = { _: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) { options._.push(token); continue }
    const name = token.slice(2)
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) { options[name] = true; continue }
    options[name] = next
    index += 1
  }
  return options
}

const options = parseArgs(process.argv.slice(2))
const workspace = typeof options.workspace === 'string' ? options.workspace : process.cwd()
const dir = libraryDir(workspace, { dir: typeof options.dir === 'string' ? options.dir : 'docs/cases' })
const json = options.json === true
const now = () => new Date().toISOString()
const runId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

function fail(code, message, extra = {}) {
  if (json) process.stdout.write(`${JSON.stringify({ ok: false, code, message, ...extra })}\n`)
  else process.stderr.write(`cases: ${code}: ${message}\n`)
  process.exit(2)
}

function say(value) {
  process.stdout.write(`${json ? JSON.stringify(value) : value}\n`)
}

function provenance(record) {
  return record.lastVerified?.source === 'runner' ? 'measured' : record.lastVerified === null || record.lastVerified === undefined ? 'never' : 'reported'
}

function printRun(id, verdict) {
  if (json) { say({ ok: true, id, ...verdict }); return }
  say(`case: ${id}`)
  say(`status: ${verdict.status}${verdict.needsRed === true ? ' (needs a red run before it can be verified)' : ''}`)
  say(`run: ${verdict.runId}`)
  for (const check of verdict.checks ?? []) {
    const measured = check.measured === null || check.measured === undefined ? '—' : String(check.measured)
    const target = check.expected !== undefined ? String(check.expected) : check.threshold !== undefined ? String(check.threshold) : '—'
    say(`  ${check.pass ? 'PASS' : 'FAIL'}  ${check.name}: ${measured} ${check.op} ${target}${check.unit ? ` ${check.unit}` : ''}${check.pass ? '' : `  ${check.reason ?? ''}`}`)
  }
  if ((verdict.artifacts ?? []).length > 0) say(`artifacts: ${verdict.artifacts.map((entry) => entry.path).join(', ')}`)
}

function requireAutomated(record) {
  if (record.automated !== true) throw new Refusal('NOT_AUTOMATED', `case "${record.id}" is documented-only; it has no command to run`)
  if (record.degraded === true) throw new Refusal('TEST_REQUIRED', 'the case was degraded because its test disappeared; restore the test first')
  if (typeof record.runCommand !== 'string' || record.runCommand.trim() === '') throw new Refusal('TEST_REQUIRED', 'the case has no runCommand')
  if (typeof record.testPath !== 'string' || record.testPath === '' || !existsSync(join(workspace, record.testPath))) {
    throw new Refusal('TEST_REQUIRED', `automated case needs its test file present: ${record.testPath ?? '(no testPath)'}`)
  }
  // THE SAME BINDING THE HOST TOOL ENFORCES: a run executes the bytes the case recorded. Without
  // this, `make cases` would measure a test file the case never named while case_run refused it.
  const hashes = testHashState(record, workspace)
  if (hashes.recorded === null) {
    throw new Refusal('TEST_HASH_MISSING', `case "${record.id}" records no hash of ${record.testPath}; re-record it with case_record or re-pin it with case_update { testPath }`)
  }
  if (!hashes.ok) {
    throw new Refusal('TEST_CHANGED', `${record.testPath} changed since the case recorded its hash; review the change, re-pin it with case_update { testPath } and run again`)
  }
}

async function commandRun() {
  const id = typeof options.id === 'string' ? options.id : ''
  if (id === '') fail('usage', 'run needs --id <case>')
  let record
  try {
    ;({ record } = readCase(dir, id))
  } catch (error) {
    fail(error instanceof Refusal ? error.code : 'CASE_UNREADABLE', String(error?.message ?? error))
  }
  try {
    requireAutomated(record)
  } catch (error) {
    fail(error instanceof Refusal ? error.code : 'refused', String(error?.message ?? error))
  }
  const control = typeof options.control === 'string' ? options.control : (typeof record.negativeControl === 'string' ? record.negativeControl : '')
  const red = options.red === true
  if (red && control === '') fail('NEGATIVE_CONTROL_REQUIRED', '--red needs --control <name> (or a negativeControl recorded on the case); the driver must break its own assertion when it receives CASE_NEGATIVE_CONTROL')
  const attempt = await runAttempts({
    workspace,
    dir,
    record,
    runId: runId(),
    runs: options.runs === undefined ? 1 : Number(options.runs),
    timeoutMs: options.timeout === undefined ? undefined : Number(options.timeout),
    mode: red ? 'red' : 'green',
    control,
    exec: spawnExec(),
  })
  if (red && attempt.controlHeld !== true) {
    fail('NEGATIVE_CONTROL_DID_NOT_FAIL', 'the negative control exited 0 (or timed out); a red run must FAIL for the control to prove anything')
  }
  let result
  try {
    result = recordRun(record, { workspace, attempt, mode: red ? 'red' : 'green', at: now(), setBaseline: options['set-baseline'] === true, commit: typeof options.commit === 'string' ? options.commit : null })
    writeCase(dir, result.record)
  } catch (error) {
    fail(error instanceof Refusal ? error.code : 'refused', String(error?.message ?? error))
  }
  const verdict = result.verdict
  printRun(id, verdict)
  // A successful red run is a successful action even though the case is still not verified.
  process.exit(red === true ? 0 : verdict.status === 'verified' ? 0 : 1)
}

function matches(record, filter) {
  if (filter.tag !== undefined && !(record.tags ?? []).includes(filter.tag)) return false
  if (filter.kind !== undefined && record.kind !== filter.kind) return false
  if (filter.status !== undefined && record.status !== filter.status) return false
  if (record.automated !== true) return false
  if (record.status === 'superseded' || record.status === 'deprecated') return false
  return true
}

async function commandSuite() {
  const filter = {
    tag: typeof options.tag === 'string' ? options.tag : undefined,
    kind: typeof options.kind === 'string' ? options.kind : undefined,
    status: typeof options.status === 'string' ? options.status : undefined,
  }
  const rows = readCases(dir)
  const cases = rows.filter((row) => row.record !== undefined && matches(row.record, filter))
  if (cases.length === 0) fail('EMPTY_SUITE', 'no automated case matches this filter')
  const suiteId = `suite-${runId()}`
  const exec = spawnExec()
  const results = []
  for (const row of cases) {
    const record = row.record
    // A case whose test bytes are unknown or changed is reported, not measured: the suite is the
    // CI hook, so skipping it silently would make a red suite look green.
    const hashes = testHashState(record, workspace)
    if (hashes.recorded === null || !hashes.ok) {
      results.push({ id: record.id, status: record.status, skipped: hashes.recorded === null ? 'TEST_HASH_MISSING' : 'TEST_CHANGED', passed: false, flaky: false, needsRed: false, checks: [] })
      continue
    }
    const attempt = await runAttempts({ workspace, dir, record, runId: `${suiteId}-${record.id}`, runs: options.runs === undefined ? 1 : Number(options.runs), timeoutMs: options.timeout === undefined ? undefined : Number(options.timeout), exec })
    const result = recordRun(record, { workspace, attempt, at: now(), commit: typeof options.commit === 'string' ? options.commit : null })
    writeCase(dir, result.record)
    results.push({ id: record.id, status: result.verdict.status, runId: result.verdict.runId, needsRed: result.verdict.needsRed === true, passed: result.verdict.passed, flaky: result.verdict.flaky, checks: result.verdict.checks })
  }
  const failed = results.filter((entry) => entry.status !== 'verified' || entry.skipped !== undefined)
  const report = { suiteId, at: now(), filter, checked: results.length, verified: results.length - failed.length, failed: failed.length, cases: results }
  const reportDir = join(dir, 'runs', 'suites')
  const reportPath = join(reportDir, `${suiteId}.json`)
  try {
    const { mkdirSync, readdirSync, rmSync, writeFileSync } = await import('node:fs')
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    const reports = readdirSync(reportDir).filter((name) => name.endsWith('.json')).sort()
    for (const name of reports.slice(0, Math.max(0, reports.length - 50))) rmSync(join(reportDir, name), { force: true })
  } catch (error) {
    fail('REPORT_WRITE_FAILED', String(error?.message ?? error))
  }
  if (json) say({ ok: failed.length === 0, ...report, report: relative(workspace, reportPath).split('\\').join('/') })
  else {
    say(`suite: ${suiteId}`)
    say(`checked: ${results.length} · verified: ${report.verified} · not green: ${failed.length}`)
    // A case the suite could not bind to its recorded test bytes was NOT measured: printing PASS
    // for its unchanged `status` is how a skipped case read as a green one.
    for (const entry of results) {
      const mark = entry.skipped !== undefined ? 'SKIP' : (entry.status === 'verified' ? 'PASS' : 'FAIL')
      const note = entry.skipped !== undefined ? entry.skipped : `${entry.status}${entry.needsRed ? ', needs red' : ''}`
      say(`  ${mark}  ${entry.id}  (${note})`)
    }
    say(`report: ${relative(workspace, reportPath).split('\\').join('/')}`)
  }
  process.exit(failed.length === 0 ? 0 : 1)
}

/**
 * The task row the gate must agree with: `{ preset, caseIds }`, or a named reason it cannot.
 *
 * A terminal has no taskboard service, so it reads the ledger file the host writes. Guessing is
 * not an option here: without the row the gate would judge a different set of cases (or a
 * different implementer) than task_close, and the two answers would disagree.
 */
function readTaskRow(taskId) {
  const boardPath = typeof options.board === 'string' && options.board !== ''
    ? resolve(workspace, options.board)
    : join(workspace, '.dsh', 'taskboard.json')
  if (!existsSync(boardPath)) return { error: `no taskboard at ${boardPath}` }
  let board
  try {
    board = JSON.parse(readFileSync(boardPath, 'utf8'))
  } catch (error) {
    return { error: `${boardPath} is not readable JSON: ${error.message}` }
  }
  const list = Array.isArray(board?.tasks) ? board.tasks : []
  const task = list.find((entry) => entry !== null && typeof entry === 'object' && entry.id === taskId)
  if (task === undefined) return { error: `no task "${taskId}" in ${boardPath}` }
  const preset = typeof task.preset === 'string' && task.preset !== ''
    ? task.preset
    : (task.inline === true || typeof task.role !== 'string' || task.role === '' ? 'orchestrator' : undefined)
  return { task, preset, boardPath }
}

function commandGate() {
  const taskId = typeof options.task === 'string' ? options.task : undefined
  const id = typeof options.id === 'string' ? options.id : undefined
  if (taskId === undefined && id === undefined) fail('usage', 'gate needs --task <taskId> or --id <case>')
  let implementerPreset = typeof options.implementer === 'string' ? options.implementer : undefined
  let caseIds
  if (taskId !== undefined) {
    const row = readTaskRow(taskId)
    if (row.error !== undefined) {
      fail('TASKBOARD_UNREADABLE', `${row.error}; the gate refuses to guess the task's cases and implementer - pass --board <path> or --id <case>`)
    }
    if (implementerPreset === undefined) implementerPreset = row.preset
    if (Array.isArray(row.task.caseIds)) caseIds = row.task.caseIds
  }
  const rows = readCases(dir)
  // ONE RULE: the CLI judges the rows with the same function the host uses (lib/acceptance.mjs),
  // with the same known-preset list and the same task-owned links.
  const verdict = gateRows(rows, {
    taskId,
    id,
    ...(caseIds === undefined ? {} : { caseIds }),
    workspace,
    dir,
    implementerPreset,
    knownPresets: KNOWN_PRESETS,
  })
  const { blockers, evidence, errors } = verdict
  const gate = { ...verdict, taskId: taskId ?? null, caseId: id ?? null, implementerPreset: implementerPreset ?? null, checked: rows.length }
  if (json) say(gate)
  else {
    if (gate.ok) say('gate: green')
    else {
      // The two failures are different questions: a refused case, and a library that cannot be
      // read. Saying "0 acceptance case(s) are not acceptable" over a broken file hides the cause.
      if (blockers.length > 0) say(`gate: ${blockers.length} acceptance case(s) are not acceptable evidence`)
      if (errors.length > 0) say(`gate: ${errors.length} case file(s) cannot be read, so the task cannot be judged`)
    }
    for (const blocker of blockers) say(`  BLOCK  ${blocker.id}  (${blocker.status}: ${blocker.reasons.map((reason) => REASONS[reason] ?? reason).join('; ')})`)
    for (const entry of evidence) if (!entry.blocked) say(`  PASS   ${entry.id}  (author ${entry.authorPreset}, run by ${entry.runBy?.preset ?? 'unknown'})`)
    for (const error of errors) say(`  ERROR  ${error.id}  (${error.code})`)
    if (implementerPreset === undefined && blockers.some((entry) => entry.reasons.includes('IMPLEMENTER_UNKNOWN'))) say('  hint: pass --implementer <preset> (the preset that did the work) so independence can be judged')
  }
  process.exit(gate.ok ? 0 : 1)
}

function commandList() {
  const rows = readCases(dir)
  const filter = {
    status: typeof options.status === 'string' ? options.status : undefined,
    tag: typeof options.tag === 'string' ? options.tag : undefined,
    automated: options.automated === true ? true : undefined,
  }
  const cases = rows.filter((row) => row.record !== undefined
    && (filter.status === undefined || row.record.status === filter.status)
    && (filter.tag === undefined || (row.record.tags ?? []).includes(filter.tag))
    && (filter.automated === undefined || row.record.automated === true))
  const counts = {}
  for (const row of rows) if (row.record !== undefined) counts[row.record.status] = (counts[row.record.status] ?? 0) + 1
  if (json) { say({ ok: true, total: cases.length, counts, cases: cases.map((row) => ({ id: row.record.id, title: row.record.title, status: row.record.status, automated: row.record.automated, provenance: provenance(row.record) })) }); return }
  say(`cases: ${cases.length} (library ${rows.filter((row) => row.record !== undefined).length})`)
  for (const row of cases) say(`  ${row.record.status.padEnd(11)} ${row.record.automated === true ? 'auto' : 'doc '} ${provenance(row.record).padEnd(8)} ${row.record.id}`)
}

const command = options._[0]
try {
  if (command === 'list') commandList()
  else if (command === 'run') await commandRun()
  else if (command === 'suite') await commandSuite()
  else if (command === 'gate') commandGate()
  else { process.stderr.write(`${usage()}\n`); process.exit(2) }
} catch (error) {
  fail(error instanceof Refusal ? error.code : 'failed', String(error?.message ?? error))
}
