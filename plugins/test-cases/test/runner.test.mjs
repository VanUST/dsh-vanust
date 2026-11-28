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
import { createHash } from 'node:crypto'
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
// The fixture's environment comes from a JSON file named on the command line, not from a
// POSIX VAR=value prefix: that syntax sh accepts and cmd.exe does not,
// so the same recorded command has to be portable to run on both platforms.
if (process.argv[2]) Object.assign(process.env, JSON.parse(readFileSync(process.argv[2], 'utf8')))
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
  writeFileSync(join(dir, 'default.json'), JSON.stringify({ DRIVER_METRICS: '{"p95":212}' }))
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
    // The case freezes the bytes of its test file; a fixture that skips the hash is a legacy
    // record, and case_run/case_suite/the CLI refuse those by name.
    testHash: createHash('sha256').update(DRIVER).digest('hex'),
    runCommand: 'node driver.mjs default.json',
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
  const root = options.workspace ?? workspace()
  for (const [name, env] of Object.entries(options.envFiles ?? {})) writeFileSync(join(root, name), JSON.stringify(env))
  const dir = join(root, 'docs', 'cases')
  const attempt = await runAttempts({
    workspace: root,
    dir,
    record,
    runId: options.runId ?? 'run-1',
    runs: options.runs ?? 1,
    timeoutMs: options.timeoutMs ?? 30_000,
    mode: options.mode ?? 'green',
    control: options.control ?? '',
    runBy: options.runBy ?? null,
    exec: spawnExec(),
  })
  return { attempt, dir, workspace: dirname(dirname(dir)) }
}

test('slugify and safeCaseId keep a case id a file name', () => {
  assert.equal(slugify('Agent tool-call checks, runnable!'), 'agent-tool-call-checks-runnable')
  assert.throws(() => safeCaseId('../outside'), (error) => error.code === 'INVALID_CASE_ID')
})

test('slugify transliterates a Russian title and falls back to a stable hash id', () => {
  const russian = ['Проверка запуска кейса', 'Случай с русским заголовком', 'Отчёт о покрытии']
  assert.deepEqual(russian.map(slugify), [
    'proverka-zapuska-keysa',
    'sluchay-s-russkim-zagolovkom',
    'otchet-o-pokrytii',
  ])
  assert.equal(new Set(russian.map(slugify)).size, russian.length, 'two Russian titles must not share one id')
  assert.equal(slugify('Кейс про slugify'), 'keys-pro-slugify', 'Latin letters survive a mixed title')

  // Nothing transcribable survives: a stable hash id of its own, not the shared constant.
  assert.match(slugify('  …  '), /^case-[0-9a-f]{12}$/)
  assert.match(slugify(''), /^case-[0-9a-f]{12}$/)
  assert.notEqual(slugify('  …  '), slugify('?!'), 'two punctuation-only titles must differ')
  assert.equal(slugify('  …  '), slugify('  …  '), 'the fallback id must be stable')

  // The ASCII path is unchanged: a stored case title still yields the id of its file.
  assert.equal(slugify('Scrollable test case detail pane'), 'scrollable-test-case-detail-pane')
  // The 60-character slice must not leave the id ending in a separator the grammar refuses.
  assert.equal(slugify(`${'а'.repeat(59)} б`), 'a'.repeat(59))

  const ids = [...russian.map(slugify), slugify('Кейс про slugify'), slugify('  …  '), slugify(''), slugify('Щ'.repeat(80))]
  for (const id of ids) {
    assert.equal(safeCaseId(id), id, `safeCaseId must accept ${JSON.stringify(id)}`)
    assert.ok(id.length <= 60, `${JSON.stringify(id)} is longer than 60 characters`)
  }
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

  const reviewer = { preset: 'reviewer', sessionId: 'sess-reviewer' }
  const red = await run(firstFold.record, { runId: 'red-1', mode: 'red', control: 'break', runBy: reviewer })
  assert.equal(red.attempt.controlHeld, true, 'the control must fail')
  const redFold = recordRun(firstFold.record, { workspace: red.workspace, attempt: red.attempt, mode: 'red', runBy: reviewer })
  assert.equal(redFold.record.redFirst.source, 'negative-control')
  assert.equal(redFold.record.redFirst.redSource, 'runner', 'the reserved redSource is not written')

  const green = await run(redFold.record, { runId: 'green-2', runBy: reviewer })
  const verified = recordRun(redFold.record, { workspace: green.workspace, attempt: green.attempt, runBy: reviewer })
  assert.equal(verified.record.status, 'verified')
  assert.equal(verified.record.lastVerified.source, 'runner')
  assert.equal(verified.record.lastVerified.runId, 'green-2-1')
  // WHO ran it travels with the run and with the verification: the gate compares this preset with
  // the task's implementer, so a run without it could not be judged independent.
  assert.deepEqual(verified.record.lastVerified.runBy, { ...reviewer, taskId: null })
  const greenRun = JSON.parse(readFileSync(join(green.dir, 'runs', base.id, 'green-2-1', 'run.json'), 'utf8'))
  assert.deepEqual(greenRun.runBy, { ...reviewer, taskId: null })
})

test('an artifact the driver wrote is hashed into the run', async () => {
  const base = record({ runCommand: 'node driver.mjs artifact.json' })
  const { attempt, dir } = await run(base, { envFiles: { 'artifact.json': { DRIVER_ARTIFACT: 'a11y.json' } } })
  const artifacts = attempt.attempts[0].run.artifacts
  assert.equal(artifacts.length, 1)
  assert.equal(artifacts[0].path.endsWith('docs/cases/runs/benchmark-smoke/run-1-1/a11y.json'), true)
  assert.match(artifacts[0].sha256, /^[0-9a-f]{64}$/)
  assert.equal(readFileSync(join(dir, 'runs', 'benchmark-smoke', 'run-1-1', 'a11y.json'), 'utf8'), 'artifact-bytes')
})

test('a metric over its threshold fails the case, and a missing metric never passes', async () => {
  const over = await run(record({ runCommand: 'node driver.mjs over.json' }), { envFiles: { 'over.json': { DRIVER_METRICS: '{"p95":260}' } } })
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
  const base = record({ checks, runCommand: 'node driver.mjs hash-ok.json' })
  assert.equal((await run(base, { envFiles: { 'hash-ok.json': { DRIVER_HASHES: JSON.stringify({ golden: digest }) } } })).attempt.passed, true)
  const wrong = record({ checks, runCommand: 'node driver.mjs hash-bad.json' })
  assert.equal((await run(wrong, { envFiles: { 'hash-bad.json': { DRIVER_HASHES: JSON.stringify({ golden: 'sha256:zzz' }) } } })).attempt.passed, false)
})

test('repeated runs keep the series, aggregate median/p95 and record a mixed outcome as flaky', async () => {
  const dir = workspace()
  writeFileSync(join(dir, 'flaky.json'), JSON.stringify({ DRIVER_COUNTER: join(dir, 'flaky.count'), DRIVER_METRICS: '{"p95":212}' }))
  const base = record({ runCommand: 'node driver.mjs flaky.json' })
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
  const seed = await run(record({ runCommand: 'node driver.mjs baseline-seed.json' }), { envFiles: { 'baseline-seed.json': { DRIVER_METRICS: '{"p95":200}' } } })
  const seeded = recordRun(record(), { workspace: seed.workspace, attempt: seed.attempt, setBaseline: true })
  assert.deepEqual(seeded.record.baseline.metrics, { p95: 200 })
  assert.equal(seeded.record.checks[0].baseline, undefined, 'the seed run used the fixed threshold, not the baseline')
  const ratchet = record({ ...seeded.record, checks: [{ metric: 'p95', op: '<=', baseline: true, band: 0.05, name: 'p95 ratchet' }] })
  const inside = await run({ ...ratchet, runCommand: 'node driver.mjs baseline-inside.json' }, { workspace: seed.workspace, envFiles: { 'baseline-inside.json': { DRIVER_METRICS: '{"p95":205}' } } })
  assert.equal(inside.attempt.passed, true, '205 is within 200 * 1.05')
  const outside = await run({ ...ratchet, runCommand: 'node driver.mjs baseline-outside.json' }, { workspace: seed.workspace, envFiles: { 'baseline-outside.json': { DRIVER_METRICS: '{"p95":215}' } } })
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
  writeFileSync(join(dir, 'suite-pass.json'), JSON.stringify({ DRIVER_METRICS: '{"p95":212}' }))
  writeFileSync(join(dir, 'suite-fail.json'), JSON.stringify({ DRIVER_METRICS: '{"p95":999}' }))
  const passing = record({
    id: 'suite-pass',
    title: 'Suite pass',
    runCommand: 'node driver.mjs suite-pass.json',
    tags: ['suite-proof'],
    // A measured red already exists, so a green run verifies this case. Without one the green
    // run would correctly stay unverified (needsRed) and the suite would not be green either.
    redFirst: { at: new Date().toISOString(), exitCode: 1, control: 'break', source: 'negative-control' },
  })
  const failing = record({ id: 'suite-fail', title: 'Suite fail', runCommand: 'node driver.mjs suite-fail.json', tags: ['suite-proof'] })
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

test('the CLI prints SKIP, never PASS, for a case it could not bind to its test bytes', () => {
  const dir = workspace()
  const library = join(dir, 'docs', 'cases')
  const bound = record({
    id: 'skip-bound',
    title: 'Bound',
    tags: ['skip-proof'],
    redFirst: { at: new Date().toISOString(), exitCode: 1, control: 'break', source: 'negative-control' },
  })
  const unbound = record({ id: 'skip-unbound', title: 'Unbound', tags: ['skip-proof'] })
  delete unbound.testHash
  writeCase(library, bound)
  writeCase(library, unbound)
  let code = 0
  let output = ''
  try {
    output = execFileSync(process.execPath, [CLI, 'suite', '--tag', 'skip-proof', '--workspace', dir], { encoding: 'utf8' })
  } catch (error) {
    code = error.status
    output = String(error.stdout ?? '')
  }
  assert.equal(code, 1, 'a skipped case must make the suite exit 1')
  assert.match(output, /SKIP\s+skip-unbound\s+\(TEST_HASH_MISSING\)/, output)
  assert.match(output, /PASS\s+skip-bound/, output)
  rmSync(dir, { recursive: true, force: true })
})

test('the store refuses an id that is a path and a record whose stored id disagrees', () => {
  const dir = workspace()
  const library = join(dir, 'docs', 'cases')
  assert.throws(() => readCase(library, '../escape'), (error) => error.code === 'INVALID_CASE_ID')
  writeFileSync(join(library, 'other.json'), `${JSON.stringify({ ...record(), id: 'renamed' })}\n`)
  assert.throws(() => readCase(library, 'benchmark-smoke'), (error) => ['CASE_NOT_FOUND', 'CASE_ID_MISMATCH'].includes(error.code))
})
