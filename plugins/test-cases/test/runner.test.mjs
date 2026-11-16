/**
 * PROOF:
 * Behavior: `case_run` executes the case's stored command through a real child process, captures
 *   the driver's CASE_SUMMARY, evaluates the declared checks, records artifacts, and decides the
 *   status from the measurement - including metric failures, a missing metric, repeated runs with
 *   a flaky outcome, a baseline ratchet, a negative-control red and a timeout. The CLI runs a
 *   filtered suite, writes its report and exits non-zero on a red case.
 * Fails when: the runner falls back to the exit code only, a missing metric starts passing, a
 *   green run with no red is reported as verified, the baseline band stops applying, or the suite
 *   reports a failing case as green.
 * Production path: plugins/test-cases/lib/runner.mjs, lib/checks.mjs, bin/cases.mjs, used by
 *   case_run / case_suite / the taskboard gate.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { evaluateChecks, median, p95 } from '../lib/checks.mjs'
import { recordRun, runAttempts, spawnExec } from '../lib/runner.mjs'
import { slugify, driftFor } from '../lib/schema.mjs'
import { readCase, safeCaseId, writeCase } from '../lib/store.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'cases.mjs')

const DRIVER = `import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const metrics = JSON.parse(process.env.DRIVER_METRICS ?? '{}')
const hashes = JSON.parse(process.env.DRIVER_HASHES ?? '{}')
if (process.env.CASE_SUMMARY) writeFileSync(process.env.CASE_SUMMARY, JSON.stringify({ metrics, hashes, artifacts: [] }))
if (process.env.DRIVER_ARTIFACT) writeFileSync(join(process.env.CASE_ARTIFACTS, process.env.DRIVER_ARTIFACT), 'artifact-bytes')
if (process.env.DRIVER_COUNTER) {
  let seen = 0
  try { seen = Number(readFileSync(process.env.DRIVER_COUNTER, 'utf8')) } catch {}
  writeFileSync(process.env.DRIVER_COUNTER, String(seen + 1))
  if (seen > 0) process.exit(1)
}
if (process.env.CASE_NEGATIVE_CONTROL === 'break') process.exit(1)
process.exit(Number(process.env.DRIVER_EXIT ?? 0))
`

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cases-'))
  mkdirSync(join(dir, 'docs', 'cases'), { recursive: true })
  writeFileSync(join(dir, 'driver.mjs'), DRIVER)
  return dir
}

function record(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'benchmark-smoke',
    title: 'Benchmark smoke',
    requirement: 'p95 stays under the budget',
    kind: 'regression',
    status: 'unverified',
    source: 'agent',
    automated: true,
    testPath: 'driver.mjs',
    runCommand: "DRIVER_METRICS='{\"p95\":212}' node driver.mjs",
    checks: [{ metric: 'p95', op: '<=', threshold: 250, unit: 'ms', name: 'p95 latency' }],
    steps: ['run it'],
    expected: 'p95 under 250ms',
    revision: 1,
    history: [],
    evidence: {},
    ...overrides,
  }
}

async function run(record, options = {}) {
  const dir = join(options.workspace ?? workspace(), 'docs', 'cases')
  const attempt = await runAttempts({
    workspace: dirname(dirname(dir)),
    dir,
    record,
    runId: options.runId ?? 'run-1',
    runs: options.runs ?? 1,
    timeoutMs: options.timeoutMs ?? 30_000,
    mode: options.mode ?? 'green',
    control: options.control ?? '',
    exec: spawnExec(),
  })
  return { attempt, dir, workspace: dirname(dirname(dir)) }
}

test('slugify and safeCaseId keep a case id a file name', () => {
  assert.equal(slugify('Agent tool-call checks, runnable!'), 'agent-tool-call-checks-runnable')
  assert.throws(() => safeCaseId('../outside'), (error) => error.code === 'INVALID_CASE_ID')
})

test('a changed surface on an UNVERIFIED case reports the files but does not mark it stale', () => {
  const result = driftFor({ status: 'unverified', automated: false, surfaceFiles: [{ path: 'x.mjs', sha256: 'aa' }] }, process.cwd(), { hash: () => 'bb' })
  assert.equal(result.status, null)
  assert.deepEqual(result.changedFiles, ['x.mjs'])
  const verified = driftFor({ status: 'verified', automated: false, surfaceFiles: [{ path: 'x.mjs', sha256: 'aa' }] }, process.cwd(), { hash: () => 'bb' })
  assert.equal(verified.status, 'stale')
})

test('a green run is measured, then a negative control makes it verified', async () => {
  const base = record()
  const first = await run(base)
  assert.equal(first.attempt.passed, true, 'exit 0 and p95 212 <= 250 must pass')
  const firstFold = recordRun(base, { workspace: first.workspace, attempt: first.attempt })
  assert.equal(firstFold.verdict.passed, true)
  assert.equal(firstFold.verdict.needsRed, true)
  assert.equal(firstFold.record.status, 'unverified', 'no red yet: a measurement is not a verification')
  const runDir = join(first.dir, 'runs', base.id, 'run-1-1')
  const stored = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'))
  assert.equal(stored.exitCode, 0)
  assert.match(stored.commandSha256, /^[0-9a-f]{64}$/)
  assert.equal(stored.checks.find((check) => check.name === 'p95 latency').pass, true)
  assert.equal(stored.checks[0].name, 'exit code')

  const red = await run(firstFold.record, { runId: 'red-1', mode: 'red', control: 'break' })
  assert.equal(red.attempt.controlHeld, true, 'the control must fail')
  const redFold = recordRun(firstFold.record, { workspace: red.workspace, attempt: red.attempt, mode: 'red' })
  assert.equal(redFold.record.redFirst.source, 'negative-control')

  const green = await run(redFold.record, { runId: 'green-2' })
  const verified = recordRun(redFold.record, { workspace: green.workspace, attempt: green.attempt })
  assert.equal(verified.record.status, 'verified')
  assert.equal(verified.record.lastVerified.source, 'runner')
  assert.equal(verified.record.lastVerified.runId, 'green-2-1')
})

test('an artifact the driver wrote is hashed into the run', async () => {
  const base = record({ runCommand: "DRIVER_ARTIFACT=a11y.json node driver.mjs" })
  const { attempt, dir } = await run(base)
  const artifacts = attempt.attempts[0].run.artifacts
  assert.equal(artifacts.length, 1)
  assert.equal(artifacts[0].path.endsWith('docs/cases/runs/benchmark-smoke/run-1-1/a11y.json'), true)
  assert.match(artifacts[0].sha256, /^[0-9a-f]{64}$/)
  assert.equal(readFileSync(join(dir, 'runs', 'benchmark-smoke', 'run-1-1', 'a11y.json'), 'utf8'), 'artifact-bytes')
})

test('a metric over its threshold fails the case, and a missing metric never passes', async () => {
  const over = await run(record({ runCommand: "DRIVER_METRICS='{\"p95\":260}' node driver.mjs" }))
  assert.equal(over.attempt.passed, false)
  const folded = recordRun(record(), { workspace: over.workspace, attempt: over.attempt })
  assert.equal(folded.record.status, 'failing')
  const latency = folded.verdict.checks.find((check) => check.name === 'p95 latency')
  assert.equal(latency.measured, 260)
  assert.equal(latency.pass, false)

  const missing = await run(record({ runCommand: 'node driver.mjs' }))
  assert.equal(missing.attempt.passed, false)
  const missingCheck = missing.attempt.attempts[0].run.checks.find((check) => check.name === 'p95 latency')
  assert.match(missingCheck.reason, /metric_missing/)
})

test('a hash check compares the digest the driver reported', async () => {
  const digest = 'sha256:abc'
  const checks = [{ metric: 'golden', expected: digest, op: '==', name: 'golden screenshot' }]
  const base = record({ checks, runCommand: `DRIVER_HASHES='{"golden":"${digest}"}' node driver.mjs` })
  assert.equal((await run(base)).attempt.passed, true)
  const wrong = record({ checks, runCommand: 'DRIVER_HASHES=\'{"golden":"sha256:zzz"}\' node driver.mjs' })
  assert.equal((await run(wrong)).attempt.passed, false)
})

test('repeated runs keep the series, aggregate median/p95 and record a mixed outcome as flaky', async () => {
  const dir = workspace()
  const base = record({ runCommand: `DRIVER_COUNTER=${join(dir, 'flaky.count')} DRIVER_METRICS='{\"p95\":212}' node driver.mjs` })
  const attempt = await runAttempts({ workspace: dir, dir: join(dir, 'docs', 'cases'), record: base, runId: 'flaky-1', runs: 2, exec: spawnExec() })
  assert.equal(attempt.flaky, true)
  const folded = recordRun(base, { workspace: dir, attempt })
  assert.equal(folded.record.status, 'flaky')
  assert.equal(folded.record.runs.length, 2)
  assert.equal(attempt.metrics.p95.values.length, 2)
  assert.equal(attempt.metrics.p95.median, 212)
  const seriesChecks = evaluateChecks([], { metrics: { p95: 250 }, error: null }, { exitCode: 0, baseline: { metrics: { p95: 200 } } })
  assert.equal(seriesChecks.passed, true)
})

test('a baseline ratchet fails a regression beyond the band and passes inside it', async () => {
  const seed = await run(record({ runCommand: "DRIVER_METRICS='{\"p95\":200}' node driver.mjs" }))
  const seeded = recordRun(record(), { workspace: seed.workspace, attempt: seed.attempt, setBaseline: true })
  assert.deepEqual(seeded.record.baseline.metrics, { p95: 200 })
  assert.equal(seeded.record.checks[0].baseline, undefined, 'the seed run used the fixed threshold, not the baseline')
  const ratchet = record({ ...seeded.record, checks: [{ metric: 'p95', op: '<=', baseline: true, band: 0.05, name: 'p95 ratchet' }] })
  const inside = await run({ ...ratchet, runCommand: "DRIVER_METRICS='{\"p95\":205}' node driver.mjs" }, { workspace: seed.workspace })
  assert.equal(inside.attempt.passed, true, '205 is within 200 * 1.05')
  const outside = await run({ ...ratchet, runCommand: "DRIVER_METRICS='{\"p95\":215}' node driver.mjs" }, { workspace: seed.workspace })
  assert.equal(outside.attempt.passed, false, '215 is beyond 200 * 1.05')
})

test('a timeout is a failed run and does not hang the runner', async () => {
  const base = record({ runCommand: 'node -e "setTimeout(() => {}, 5000)"', checks: [] })
  const started = Date.now()
  const { attempt } = await run(base, { timeoutMs: 200 })
  assert.equal(attempt.attempts[0].run.timedOut, true)
  assert.equal(attempt.attempts[0].run.exitCode, null)
  assert.equal(attempt.passed, false)
  assert.ok(Date.now() - started < 4000)
})

test('median and p95 are nearest-rank over a numeric series', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(p95([1, 2, 3, 4, 5]), 5)
  assert.equal(median([]), null)
})

test('the CLI runs a filtered suite, writes the report and exits non-zero on a red case', () => {
  const dir = workspace()
  const library = join(dir, 'docs', 'cases')
  const passing = record({
    id: 'suite-pass',
    title: 'Suite pass',
    runCommand: "DRIVER_METRICS='{\"p95\":212}' node driver.mjs",
    tags: ['suite-proof'],
    // A measured red already exists, so a green run verifies this case. Without one the green
    // run would correctly stay unverified (needsRed) and the suite would not be green either.
    redFirst: { at: new Date().toISOString(), exitCode: 1, control: 'break', source: 'negative-control' },
  })
  const failing = record({ id: 'suite-fail', title: 'Suite fail', runCommand: "DRIVER_METRICS='{\"p95\":999}' node driver.mjs", tags: ['suite-proof'] })
  writeCase(library, passing)
  writeCase(library, failing)
  let code = 0
  let output = ''
  try {
    output = execFileSync(process.execPath, [CLI, 'suite', '--tag', 'suite-proof', '--workspace', dir, '--json'], { encoding: 'utf8' })
  } catch (error) {
    code = error.status
    output = String(error.stdout ?? '')
  }
  assert.equal(code, 1, 'one failing case must make the suite exit 1')
  const report = JSON.parse(output)
  assert.equal(report.checked, 2)
  assert.equal(report.verified, 1)
  const reportFile = JSON.parse(readFileSync(join(dir, report.report), 'utf8'))
  assert.equal(reportFile.cases.find((entry) => entry.id === 'suite-fail').status, 'failing')
  let gateAudit
  try {
    const stdout = execFileSync(process.execPath, [CLI, 'gate', '--id', 'suite-fail', '--workspace', dir, '--json'], { encoding: 'utf8' })
    gateAudit = JSON.parse(stdout)
    assert.fail('the gate CLI must exit 1 on a blocker')
  } catch (error) {
    assert.equal(error.status, 1)
    gateAudit = JSON.parse(String(error.stdout ?? '{}'))
  }
  assert.equal(gateAudit.ok, false, 'an unverified automated case blocks the gate')
  assert.equal(gateAudit.blockers[0].id, 'suite-fail')
  rmSync(dir, { recursive: true, force: true })
})

test('the store refuses an id that is a path and a record whose stored id disagrees', () => {
  const dir = workspace()
  const library = join(dir, 'docs', 'cases')
  assert.throws(() => readCase(library, '../escape'), (error) => error.code === 'INVALID_CASE_ID')
  writeFileSync(join(library, 'other.json'), `${JSON.stringify({ ...record(), id: 'renamed' })}\n`)
  assert.throws(() => readCase(library, 'benchmark-smoke'), (error) => ['CASE_NOT_FOUND', 'CASE_ID_MISMATCH'].includes(error.code))
})
