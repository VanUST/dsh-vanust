/**
 * PURPOSE
 *   Execute a case's stored command and turn the run into evidence. A case whose test path and
 *   command are recorded can be RUN here instead of asking a model to paste what it remembers:
 *   the plugin invokes the command, captures stdout/stderr, reads the driver's summary, evaluates
 *   the declared checks, hashes the artifacts and writes the run under `docs/cases/runs/`.
 *
 *   The command comes from the CASE, never from the caller, so a run cannot be aimed at a
 *   different command. Manual evidence still exists (`case_verify`) but is stamped `manual`; only
 *   a run recorded here is a measurement.
 *
 * INPUTS / OUTPUTS
 *   spawnExec() -> the default executor (sh -c, timeout, bounded tail of both streams).
 *   shellExec(shell) -> an executor over the harness `ctx.shell` (sandbox, caps, timeout).
 *   runAttempts({workspace, dir, record, runId, runs, timeoutMs, mode, control, exec})
 *     -> { runId, attempts, metrics, passed, flaky, failed }.
 *   recordRun(record, {workspace, attempt, mode, at, setBaseline, commit})
 *     -> { record, verdict }; the caller writes the returned record (compare-and-set).
 *   commandHash / gitState / collectArtifacts are exported for the tools and the tests.
 *
 *   A run directory holds `stdout.log`, `stderr.log`, `summary.json` (driver), `run.json` and the
 *   driver's artifacts. The last 20 runs per case are kept.
 *
 * KEYWORDS
 *   case runner, case_run, artifacts, CASE_SUMMARY, baseline, flaky, negative control,
 *   measured evidence, docs/cases/runs
 */

import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { aggregateMetrics, evaluateChecks, parseSummary } from './checks.mjs'
import { fileHash } from './schema.mjs'
import { Refusal } from './store.mjs'

const MAX_STREAM_BYTES = 512 * 1024
const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000
const KEEP_RUNS = 20
const COLLECTED_FILES = new Set(['stdout.log', 'stderr.log', 'summary.json', 'run.json'])

/** sha256 of the stored command: binds a run record to the bytes that were executed. */
export function commandHash(command) {
  return createHash('sha256').update(String(command ?? '')).digest('hex')
}

/** The executor used outside a host: sh -c, a bounded tail of each stream, a kill on timeout. */
export function spawnExec() {
  return (command, { cwd, env, timeoutMs }) => new Promise((resolve) => {
    const started = Date.now()
    const windows = process.platform === 'win32'
    const shell = windows ? (process.env.ComSpec ?? 'cmd.exe') : '/bin/sh'
    const args = windows ? ['/d', '/s', '/c', String(command)] : ['-c', String(command)]
    let child
    try {
      child = spawn(shell, args, { cwd, env, detached: !windows, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (error) {
      resolve({ exitCode: null, signal: null, timedOut: false, stdout: '', stderr: String(error?.message ?? error), truncated: false, durationMs: Date.now() - started })
      return
    }
    let stdout = ''
    let stderr = ''
    let truncated = false
    let timedOut = false
    const collect = (current, chunk) => {
      const next = current + String(chunk)
      if (next.length > MAX_STREAM_BYTES) {
        truncated = true
        return next.slice(-MAX_STREAM_BYTES)
      }
      return next
    }
    child.stdout?.on('data', (chunk) => { stdout = collect(stdout, chunk) })
    child.stderr?.on('data', (chunk) => { stderr = collect(stderr, chunk) })
    const killTree = () => {
      try {
        if (!windows && Number.isInteger(child.pid)) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch {
        // Already gone; close settles the promise.
      }
    }
    const timer = setTimeout(() => { timedOut = true; killTree() }, Math.max(1, timeoutMs))
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ exitCode: null, signal: null, timedOut, stdout, stderr: `${stderr}\nspawn failed: ${error?.message ?? error}`.trim(), truncated, durationMs: Date.now() - started })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolve({ exitCode: Number.isInteger(code) ? code : null, signal: signal ?? null, timedOut, stdout, stderr, truncated, durationMs: Date.now() - started })
    })
  })
}

/**
 * An executor over the harness shell service.
 *
 * The same runs then inherit the deployment's sandbox mode, output caps and timeout semantics
 * instead of a private interpretation of them.
 */
export function shellExec(shell) {
  return async (command, { cwd, env, timeoutMs }) => {
    const started = Date.now()
    const spec = shell.resolve({ command, workdir: cwd, timeoutMs, env })
    const execution = await shell.execute(spec)
    const result = await execution.result()
    return {
      exitCode: Number.isInteger(result.exitCode) ? result.exitCode : null,
      signal: result.signal ?? null,
      timedOut: result.timedOut === true,
      stdout: result.stdout?.text ?? '',
      stderr: result.stderr?.text ?? '',
      truncated: Boolean(result.stdout?.truncated || result.stderr?.truncated),
      durationMs: Date.now() - started,
    }
  }
}

/** `head`/`dirty` at run time, so a result cannot be attached to the wrong tree. */
export function gitState(workspace) {
  try {
    const read = (args) => execFileSync('git', args, { cwd: workspace, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const head = read(['rev-parse', 'HEAD'])
    const dirty = read(['status', '--porcelain']) !== ''
    return { head: head === '' ? null : head, dirty }
  } catch {
    return { head: null, dirty: null }
  }
}

/** Files the driver wrote under the run directory (bounded, recursive, hashed). */
export function collectArtifacts(workspace, runDir, depth = 0) {
  if (depth > 3 || !existsSync(runDir)) return []
  const artifacts = []
  for (const entry of readdirSync(runDir, { withFileTypes: true })) {
    if (artifacts.length >= 60) break
    const path = join(runDir, entry.name)
    if (entry.isDirectory()) {
      artifacts.push(...collectArtifacts(workspace, path, depth + 1))
      continue
    }
    if (!entry.isFile() || COLLECTED_FILES.has(entry.name)) continue
    let bytes = 0
    try { bytes = statSync(path).size } catch { continue }
    artifacts.push({ path: relative(workspace, path).split('\\').join('/'), sha256: fileHash(path) ?? '', bytes })
  }
  return artifacts.slice(0, 60)
}

/** Keep the newest `keep` run directories under one case's runs root. */
function pruneRuns(runRoot, keep) {
  if (!existsSync(runRoot)) return
  const dirs = readdirSync(runRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  for (const name of dirs.slice(0, Math.max(0, dirs.length - keep))) {
    try { rmSync(join(runRoot, name), { recursive: true, force: true }) } catch { /* derived data */ }
  }
}

/** One execution: logs, summary, checks, artifacts, run.json. */
export async function runAttempt({ workspace, dir, record, runId, timeoutMs, mode = 'green', control = '', exec }) {
  const runRoot = join(dir, 'runs', record.id)
  const runDir = join(runRoot, runId)
  mkdirSync(runDir, { recursive: true })
  const summaryPath = join(runDir, 'summary.json')
  const env = {
    ...process.env,
    CASE_ID: record.id,
    CASE_RUN_ID: runId,
    CASE_SUMMARY: summaryPath,
    CASE_ARTIFACTS: runDir,
    ...(mode === 'red' && control !== '' ? { CASE_NEGATIVE_CONTROL: control } : {}),
  }
  const git = gitState(workspace)
  const outcome = await exec(record.runCommand, { cwd: workspace, env, timeoutMs })
  const at = new Date().toISOString()
  const summary = parseSummary(summaryPath)
  const checks = evaluateChecks(record.checks ?? [], summary, { exitCode: outcome.exitCode, baseline: record.baseline })
  const artifacts = collectArtifacts(workspace, runDir)
  const run = {
    runId,
    at,
    mode,
    ...(mode === 'red' ? { control } : {}),
    exitCode: outcome.exitCode,
    signal: outcome.signal ?? null,
    timedOut: outcome.timedOut === true,
    durationMs: Number.isFinite(outcome.durationMs) ? outcome.durationMs : null,
    commandSha256: commandHash(record.runCommand),
    head: git.head,
    dirty: git.dirty,
    stdout: relative(workspace, join(runDir, 'stdout.log')).split('\\').join('/'),
    stderr: relative(workspace, join(runDir, 'stderr.log')).split('\\').join('/'),
    summary: relative(workspace, summaryPath).split('\\').join('/'),
    summaryError: summary.error,
    metrics: summary.metrics,
    checks: checks.results,
    passed: checks.passed,
    artifacts,
  }
  const note = (stream) => (outcome.truncated ? `[... truncated to the tail at ${MAX_STREAM_BYTES} bytes ...]\n${stream}` : stream)
  writeFileSync(join(runDir, 'stdout.log'), note(outcome.stdout ?? ''), 'utf8')
  writeFileSync(join(runDir, 'stderr.log'), note(outcome.stderr ?? ''), 'utf8')
  writeFileSync(join(runDir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`, 'utf8')
  return { run, passed: checks.passed, summary }
}

/**
 * Run a case `runs` times (1..5) and aggregate the measurements.
 *
 * A red run is the negative control: it must FAIL on EVERY attempt, otherwise the control is not
 * demonstrating anything and the caller refuses to record it.
 */
export async function runAttempts({ workspace, dir, record, runId, runs = 1, timeoutMs = DEFAULT_TIMEOUT_MS, mode = 'green', control = '', exec = spawnExec() }) {
  const count = Number.isInteger(runs) && runs > 0 ? Math.min(runs, 5) : 1
  const timeout = Number.isInteger(timeoutMs) && timeoutMs > 0 ? Math.min(Math.max(timeoutMs, 1000), MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS
  const runRoot = join(dir, 'runs', record.id)
  mkdirSync(runRoot, { recursive: true })
  const attempts = []
  for (let index = 1; index <= count; index += 1) {
    attempts.push(await runAttempt({ workspace, dir, record, runId: `${runId}-${index}`, timeoutMs: timeout, mode, control, exec }))
  }
  pruneRuns(runRoot, KEEP_RUNS * 5)
  const metrics = aggregateMetrics(attempts.map((attempt) => attempt.run.metrics))
  if (mode === 'red') {
    const controlHeld = attempts.every((attempt) => attempt.run.exitCode !== 0 && attempt.run.timedOut !== true)
    return { runId, attempts, metrics, mode, passed: false, flaky: false, failed: false, controlHeld }
  }
  const passedCount = attempts.filter((attempt) => attempt.passed).length
  return {
    runId,
    attempts,
    metrics,
    mode,
    passed: passedCount === attempts.length,
    flaky: passedCount > 0 && passedCount < attempts.length,
    failed: passedCount === 0,
  }
}

/** Was a red run ever recorded for this case (runner negative control or the manual red)? */
export function hasRedEvidence(record) {
  if (record.redFirst !== null && typeof record.redFirst === 'object') return true
  if (record.evidence?.redFirst !== null && typeof record.evidence?.redFirst === 'object') return true
  return false
}

/**
 * Fold a measured run into the case: append the run, decide the status, record the baseline.
 *
 * The status is decided HERE, from the measurement, so the tool, the CLI and a future panel
 * cannot disagree. A green run on a case with no recorded red is a measurement but NOT a
 * verification: the verdict says `needsRed` and the status is left where it was.
 */
export function recordRun(record, { workspace, attempt, mode = 'green', at = new Date().toISOString(), setBaseline = false, commit = null }) {
  const next = { ...record }
  const runs = attempt.attempts.map((entry) => entry.run)
  next.runs = [...(Array.isArray(record.runs) ? record.runs : []), ...runs].slice(-KEEP_RUNS)
  next.updatedAt = at
  next.revision = (Number.isInteger(record.revision) ? record.revision : 0) + 1
  const history = Array.isArray(record.history) ? [...record.history] : []
  const last = runs[runs.length - 1]
  if (mode === 'red') {
    next.redFirst = {
      at,
      runId: last.runId,
      exitCode: last.exitCode,
      control: last.control ?? '',
      command: record.runCommand,
      source: 'negative-control',
    }
    history.push({ revision: next.revision - 1, at, editedBy: 'agent', action: 'red', reason: `negative control "${last.control ?? ''}" failed as expected (exit ${last.exitCode})` })
    next.history = history
    return { record: next, verdict: { ok: true, mode: 'red', red: true, runId: last.runId, status: next.status, checks: last.checks, artifacts: last.artifacts } }
  }
  const hasRed = hasRedEvidence(record)
  let status = record.status
  let lastVerified = record.lastVerified ?? null
  if (attempt.passed && hasRed) {
    status = 'verified'
    lastVerified = { at, command: record.runCommand, exitCode: 0, runId: last.runId, source: 'runner', commit: commit ?? null }
    delete next.needsReverification
  } else if (attempt.flaky) {
    status = 'flaky'
    lastVerified = null
  } else if (attempt.failed) {
    status = 'failing'
    lastVerified = null
  }
  next.status = status
  next.lastVerified = lastVerified
  if (status === 'verified') {
    next.surfaceFiles = (record.surfaceFiles ?? []).map((entry) => ({ path: entry.path, sha256: fileHash(join(workspace, entry.path)) ?? entry.sha256 }))
  }
  let baseline = record.baseline ?? null
  if (setBaseline === true) {
    if (attempt.passed !== true) throw new Refusal('BASELINE_REQUIRES_PASS', 'only a passing run can seed a baseline')
    const metrics = {}
    for (const [name, aggregate] of Object.entries(attempt.metrics ?? {})) {
      if (Number.isFinite(aggregate.median)) metrics[name] = aggregate.median
    }
    if (Object.keys(metrics).length === 0) throw new Refusal('BASELINE_UNSUPPORTED', 'the run recorded no numeric metric; a baseline needs at least one')
    baseline = { metrics, at, runId: attempt.runId, commit: commit ?? null }
    next.baseline = baseline
  }
  const needsRed = attempt.passed === true && !hasRed
  history.push({
    revision: next.revision - 1,
    at,
    editedBy: 'agent',
    action: attempt.passed ? (hasRed ? 'ran-verified' : 'ran-needs-red') : attempt.flaky ? 'ran-flaky' : 'ran-failed',
    reason: `${attempt.attempts.length} run(s), ${attempt.attempts.filter((entry) => entry.passed).length} passed${needsRed ? '; no red run recorded, so the case is not verified' : ''}`,
  })
  next.history = history
  return {
    record: next,
    verdict: {
      ok: true,
      mode: 'green',
      runId: attempt.runId,
      status,
      passed: attempt.passed,
      flaky: attempt.flaky,
      needsRed,
      checks: last.checks,
      metrics: attempt.metrics,
      baseline,
      artifacts: last.artifacts,
    },
  }
}
