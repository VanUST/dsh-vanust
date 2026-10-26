/**
 * PURPOSE
 *   Bridge the real babysitter CLI into DSH. Babysitter has no DSH harness, so this
 *   plugin does not pretend to be one: it shells out to the installed CLI, reads the
 *   event journal directly for status, and maps each run onto exactly one taskboard
 *   task. The taskboard stays the outer ledger; the journal stays the run authority.
 *
 * INPUTS
 *   Config (all optional):
 *     timeoutMs           bound for run/resume spawns. Default 600000.
 *     doctorTimeoutMs     bound for genty doctor. Default 60000.
 *     maxOutputBytes      tail cap for each of stdout and stderr. Default 24000.
 *     maxRecentRuns       recent-run list size. Default 10.
 *     maxTransitionNotes  journal transitions copied to the task timeline. Default 20.
 *     maxJournalScan      journal entries scanned per run. Default 500.
 *     babysitterPath      absolute path to bin/babysitter.js when not on PATH.
 *     gentyPath           absolute path to genty's CLI when it cannot be derived.
 *     runsDir             extra runs directory to scan.
 *     linksFile           run -> task lookup index. Default `.dsh/babysitter-links.json`.
 *     taskboard           set false to disable task mapping. Default true.
 *   Tool arguments are listed on each tool below.
 *
 * OUTPUTS
 *   Four tools: babysitter_run, babysitter_status, babysitter_resume, babysitter_doctor.
 *   Every result is a JSON object with `ok`, the exit code verbatim, separated stdout and
 *   stderr tails, and the run id when the CLI printed one. `babysitter_run` also returns
 *   `taskId`, `taskRevision` and `taskStatus: "review"` when a taskboard is mounted.
 *
 * KEYWORDS
 *   babysitter, genty, journal, run, resume, doctor, taskboard, harness, a5c
 *
 * BEHAVIOUR ON EDGE CASES
 *   - CLI absent: every tool returns one actionable install message, before any spawn.
 *     No stack trace reaches the model.
 *   - Every spawn is bounded. A timeout kills the child, then returns a failure that
 *     names the timeout; it does not leave the agent waiting.
 *   - stdout and stderr are captured separately and tail-capped, so a huge log cannot
 *     flood the context.
 *   - `genty call` exits 0 even when a shell task failed. The journal's task result is
 *     read and a failed task makes `ok:false`; a clean exit code alone is not success.
 *   - A process file that imports @a5c-ai/babysitter-sdk is refused early when that
 *     package is not resolvable from the process/workspace, because the CLI would
 *     otherwise retry the import until the timeout.
 *   - Taskboard bookkeeping is best effort: every service call is caught and downgraded
 *     to a warning in the result. A bookkeeping error never fails a run. A finished run
 *     moves its task to `review`, never `done`; the human/orchestrator accepts it.
 *   - DSH is not a babysitter harness. The `internal` harness is genty's built-in loop;
 *     deterministic shell tasks run without an external agent CLI, but LLM-backed tasks
 *     still need a model provider API key. `doctor` and `resume` are the paths that
 *     currently demand one.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { spawn } from 'node:child_process'
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

/** Every tool call that needs a CLI gets this one line, never a stack trace. */
const INSTALL_HINT =
  'The babysitter CLI is not available. Install it with: npm install -g @a5c-ai/babysitter (Node 24+), then verify with: babysitter --version. If it is installed outside PATH, set the plugin config "babysitterPath" to the absolute path of bin/babysitter.js (and optionally "gentyPath" to the genty CLI).'

/** The genty message is separate because genty is nested inside the babysitter package. */
const GENTY_HINT =
  'The genty CLI (shipped inside @a5c-ai/babysitter) was not found. Reinstall with: npm install -g @a5c-ai/babysitter, then verify with: babysitter --version. If genty is installed elsewhere, set the plugin config "gentyPath" to its absolute CLI path.'

const DEFAULT_TIMEOUT_MS = 600_000
const DEFAULT_DOCTOR_TIMEOUT_MS = 60_000
const DEFAULT_MAX_OUTPUT_BYTES = 24_000
const DEFAULT_MAX_RECENT_RUNS = 10
const DEFAULT_MAX_TRANSITION_NOTES = 20
const DEFAULT_MAX_JOURNAL_SCAN = 500
const DEFAULT_LINKS_FILE = '.dsh/babysitter-links.json'
const MAX_LINK_ENTRIES = 500
const MAX_RESULT_PREVIEW = 8_000
const RUN_MODES = ['call', 'plan', 'yolo']
const TERMINAL_STATES = new Map([
  ['RUN_COMPLETED', 'completed'],
  ['RUN_FAILED', 'failed'],
  ['RUN_HALTED', 'halted'],
  ['RUN_CANCELLED', 'cancelled'],
])
const NONTERMINAL_STATES = new Map([
  ['RUN_CREATED', 'created'],
  ['RUN_RESUMED', 'running'],
  ['EFFECT_REQUESTED', 'running'],
  ['EFFECT_RESOLVED', 'running'],
  ['RUN_REBUILT', 'running'],
])

/** Trim a value to a string, or return an empty string. */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** Take a positive integer from config/tool args, or the fallback. */
function positive(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

/** Keep a string under a hard character cap. */
function truncate(value, limit) {
  const string = String(value ?? '')
  return string.length <= limit ? string : `${string.slice(0, Math.max(0, limit - 1))}…`
}

/** The tail of a log, for an error message that must stay short. */
function tail(value, limit = 800) {
  const string = String(value ?? '').trim()
  if (string === '') return ''
  return string.length <= limit ? string : `…${string.slice(-limit)}`
}

/**
 * Normalize plugin config.
 *
 * @param config - Raw plugin config.
 * @returns A total config with every bound in range.
 */
export function normalizeConfig(config = {}) {
  return {
    timeoutMs: positive(config.timeoutMs, DEFAULT_TIMEOUT_MS),
    doctorTimeoutMs: positive(config.doctorTimeoutMs, DEFAULT_DOCTOR_TIMEOUT_MS),
    maxOutputBytes: Math.max(2_000, positive(config.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES)),
    maxRecentRuns: Math.min(100, positive(config.maxRecentRuns, DEFAULT_MAX_RECENT_RUNS)),
    maxTransitionNotes: Math.min(200, positive(config.maxTransitionNotes, DEFAULT_MAX_TRANSITION_NOTES)),
    maxJournalScan: Math.min(5_000, positive(config.maxJournalScan, DEFAULT_MAX_JOURNAL_SCAN)),
    babysitterPath: text(config.babysitterPath),
    gentyPath: text(config.gentyPath),
    runsDir: text(config.runsDir),
    linksFile: text(config.linksFile) || DEFAULT_LINKS_FILE,
    taskboard: config.taskboard !== false,
  }
}

/** Whether a path exists and is a regular file. */
function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** Whether POSIX would execute this path. Windows extensions are handled separately. */
function isExecutable(path) {
  if (!isFile(path)) return false
  if (process.platform === 'win32') return true
  try {
    accessSync(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

/** A JS entry is run through the current Node, which is the documented runtime. */
function isJavaScript(path) {
  return /\.(c|m)?js$/i.test(path)
}

/**
 * Locate one command on PATH without spawning a shell.
 *
 * @param name - Executable name, e.g. `babysitter`.
 * @param env - Environment to read PATH from.
 * @returns Absolute path, or null.
 */
export function findOnPath(name, env = process.env) {
  const pathValue = typeof env?.PATH === 'string' ? env.PATH : ''
  if (pathValue === '') return null
  const extensions =
    process.platform === 'win32'
      ? ['', ...String(env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)]
      : ['']
  for (const directory of pathValue.split(process.platform === 'win32' ? ';' : ':')) {
    if (directory === '') continue
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`)
      if (isExecutable(candidate)) return candidate
    }
  }
  return null
}

/** Resolve symlinks when possible; a missing path falls back to itself. */
function realPath(path) {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/**
 * Turn a CLI path into a spawnable argv. JS entries use the current Node so the
 * plugin does not depend on the shebang or on PATH inside the child.
 *
 * @param path - Absolute CLI path.
 * @param source - Where the path came from, for diagnostics.
 * @returns An entry with a fixed argv prefix.
 */
function cliEntry(path, source) {
  const real = realPath(path)
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(real)) {
    return { path: real, argv: [process.env.ComSpec ?? 'cmd.exe', '/d', '/s', '/c', real], source }
  }
  if (isJavaScript(real)) return { path: real, argv: [process.execPath, real], source }
  return { path: real, argv: [real], source }
}

/** Candidate locations for genty, derived from an installed babysitter path. */
function gentyCandidates(babysitterPath) {
  const candidates = []
  const real = realPath(babysitterPath)
  const packageDir = dirname(dirname(real))
  candidates.push(join(packageDir, 'node_modules', '@a5c-ai', 'genty', 'dist', 'cli', 'main.js'))
  candidates.push(join(packageDir, 'node_modules', '@a5c-ai', 'genty', 'dist', 'cli', 'index.js'))
  // A globally installed SDK shim may sit beside a hoisted genty package.
  let dir = packageDir
  for (let depth = 0; depth < 6; depth += 1) {
    candidates.push(join(dir, 'node_modules', '@a5c-ai', 'genty', 'dist', 'cli', 'main.js'))
    candidates.push(join(dir, 'genty', 'dist', 'cli', 'main.js'))
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return [...new Set(candidates)]
}

/**
 * Resolve the two CLIs. `babysitter` alone is enough for status; run/resume/doctor
 * need genty. Deriving genty from a PATH-installed babysitter is what makes the
 * global npm layout work without a second global install.
 *
 * @param config - Normalized config.
 * @param env - Environment to search.
 * @returns `{babysitter, genty, notes}` or `{error}`.
 */
export function resolveCli(config, env = process.env) {
  let babysitter = null
  let genty = null
  const notes = []
  try {
    if (config.babysitterPath !== '') {
      const target = isAbsolute(config.babysitterPath) ? config.babysitterPath : resolve(process.cwd(), config.babysitterPath)
      if (!isFile(target)) return { error: `Configured babysitterPath does not exist: ${target}. ${INSTALL_HINT}` }
      babysitter = cliEntry(target, 'config')
    } else {
      const found = findOnPath('babysitter', env)
      if (found !== null) babysitter = cliEntry(found, 'PATH')
    }

    if (config.gentyPath !== '') {
      const target = isAbsolute(config.gentyPath) ? config.gentyPath : resolve(process.cwd(), config.gentyPath)
      if (!isFile(target)) return { error: `Configured gentyPath does not exist: ${target}. ${GENTY_HINT}` }
      genty = cliEntry(target, 'config')
    } else {
      const found = findOnPath('genty', env)
      if (found !== null) genty = cliEntry(found, 'PATH')
      if (genty === null && babysitter !== null) {
        for (const candidate of gentyCandidates(babysitter.path)) {
          if (isFile(candidate)) {
            genty = cliEntry(candidate, 'derived-from-babysitter')
            notes.push(`genty was derived from the babysitter install: ${genty.path}`)
            break
          }
        }
      }
    }

    if (babysitter === null && genty === null) return { error: INSTALL_HINT }
    return { babysitter, genty, notes }
  } catch (error) {
    return { error: `Could not resolve the babysitter CLI: ${error instanceof Error ? error.message : String(error)}. ${INSTALL_HINT}` }
  }
}

/**
 * Locate the SDK directory that process files import. The global metapackage nests
 * it, so this is also the value an operator needs for a workspace symlink.
 *
 * @param clis - Resolved CLI entries.
 * @returns Absolute SDK package directory, or null.
 */
export function resolveSdkDir(clis) {
  const candidates = []
  if (clis?.babysitter) {
    const packageDir = dirname(dirname(realPath(clis.babysitter.path)))
    candidates.push(join(packageDir, 'node_modules', '@a5c-ai', 'babysitter-sdk'))
    candidates.push(join(dirname(packageDir), 'babysitter-sdk'))
  }
  if (clis?.genty) {
    let dir = dirname(realPath(clis.genty.path))
    for (let depth = 0; depth < 4; depth += 1) dir = dirname(dir)
    candidates.push(join(dir, 'babysitter-sdk'))
    candidates.push(join(dir, 'node_modules', '@a5c-ai', 'babysitter-sdk'))
    candidates.push(join(dirname(dir), 'babysitter-sdk'))
  }
  return candidates.find((candidate) => isFile(join(candidate, 'package.json'))) ?? null
}

/** Whether `packageName` resolves from `startDir` through node_modules ancestors. */
function packageResolvableFrom(startDir, packageName) {
  const parts = packageName.split('/')
  let dir = resolve(startDir)
  for (;;) {
    const candidate = join(dir, 'node_modules', ...parts, 'package.json')
    if (isFile(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** A tail-capped accumulator. It keeps the newest bytes, which is where the error is. */
function tailBuffer(limit) {
  const cap = Math.max(1_000, Math.floor(limit))
  return {
    text: '',
    truncated: false,
    push(chunk) {
      this.text += chunk
      if (this.text.length > cap * 2) {
        this.text = this.text.slice(-cap)
        this.truncated = true
      }
    },
    finish() {
      if (this.text.length > cap) {
        this.text = this.text.slice(-cap)
        this.truncated = true
      }
      return this.text
    },
  }
}

/**
 * Run one CLI command without a shell, with a hard timeout and separated tails.
 *
 * @param entry - `{argv}` prefix from cliEntry.
 * @param args - Arguments after the fixed prefix.
 * @param options - `{cwd, timeoutMs, maxOutputBytes, env}`.
 * @returns `{exitCode, signal, timedOut, stdout, stderr, truncated, durationMs, error}`.
 */
export function runCli(entry, args, options = {}) {
  const timeoutMs = positive(options.timeoutMs, DEFAULT_TIMEOUT_MS)
  const maxOutputBytes = positive(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES)
  const cwd = typeof options.cwd === 'string' && options.cwd !== '' ? options.cwd : process.cwd()
  const env = { ...process.env, NO_COLOR: '1', ...(options.env ?? {}) }
  const startedAt = Date.now()

  return new Promise((resolvePromise) => {
    let settled = false
    let timedOut = false
    let child = null
    let timeoutTimer = null
    let hardTimer = null
    let killTimer = null
    const out = tailBuffer(maxOutputBytes)
    const err = tailBuffer(maxOutputBytes)

    const settle = (value) => {
      if (settled) return
      settled = true
      if (timeoutTimer !== null) clearTimeout(timeoutTimer)
      if (hardTimer !== null) clearTimeout(hardTimer)
      if (killTimer !== null) clearTimeout(killTimer)
      resolvePromise({
        exitCode: value.exitCode ?? null,
        signal: value.signal ?? null,
        timedOut,
        stdout: out.finish(),
        stderr: err.finish(),
        truncated: { stdout: out.truncated, stderr: err.truncated },
        durationMs: Date.now() - startedAt,
        error: value.error ?? null,
      })
    }

    try {
      child = spawn(entry.argv[0], [...entry.argv.slice(1), ...args], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      settle({ exitCode: null, signal: null, error: error instanceof Error ? error.message : String(error) })
      return
    }

    timeoutTimer = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGTERM')
      } catch {
        // The hard timer below still resolves the promise.
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // Ignore: the process may have exited between the two signals.
        }
      }, 2_000)
      killTimer.unref?.()
    }, timeoutMs)

    hardTimer = setTimeout(() => {
      settle({ exitCode: null, signal: null, error: `timed out after ${timeoutMs} ms; the child did not exit after SIGKILL` })
    }, timeoutMs + 5_000)
    hardTimer.unref?.()

    child.stdout?.on('data', (chunk) => out.push(chunk.toString('utf8')))
    child.stderr?.on('data', (chunk) => err.push(chunk.toString('utf8')))
    child.on('error', (error) => settle({ exitCode: null, signal: null, error: error instanceof Error ? error.message : String(error) }))
    child.on('close', (code, signal) => settle({ exitCode: code, signal: signal ?? null, error: null }))
  })
}

/** The exact failure for one CLI invocation, or null when it succeeded. */
function cliFailure(label, result, timeoutMs) {
  if (result.timedOut) {
    const detail = [tail(result.stderr, 400), tail(result.stdout, 400)].filter(Boolean).join(' | ') || '(empty)'
    return `${label} timed out after ${timeoutMs} ms; the child was terminated. stderr/stdout tail: ${detail}`
  }
  if (result.error) return `${label} could not start: ${result.error}`
  if (result.exitCode !== 0) {
    // resume-run puts its actionable message on stdout while stderr carries only a
    // progress line, so one non-empty stream must not hide the other.
    const detail = [tail(result.stderr, 800), tail(result.stdout, 800)].filter(Boolean).join(' | ') || '(empty)'
    return `${label} exited with code ${result.exitCode}${result.signal ? ` (signal ${result.signal})` : ''}. stderr/stdout tail: ${detail}`
  }
  return null
}

/** Extract a run id from progress JSON or a plain CLI line. */
export function extractRunId(stdout, stderr = '') {
  const all = `${stdout}\n${stderr}`
  const json = /"runId"\s*:\s*"([A-Za-z0-9._-]+)"/.exec(all)
  if (json !== null) return json[1]
  const plain = /(?:run id|runId|Run ID)\s*[:=]\s*([A-Za-z0-9._-]+)/i.exec(all)
  return plain === null ? null : plain[1]
}

/** Extract a run directory from progress JSON, when the CLI prints one. */
export function extractRunDir(stdout, stderr = '') {
  const all = `${stdout}\n${stderr}`
  const json = /"runDir"\s*:\s*"([^"]+)"/.exec(all)
  return json === null ? null : json[1]
}

/** Whether a value looks like a run id rather than a path. */
function isRunId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(value)
}

/** The session workspace, falling back to the process directory. */
export function sessionCwd(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  if (typeof cwd === 'string' && cwd !== '') return resolve(cwd)
  return process.cwd()
}

/** The babysitter workspace: explicit argument first, then the session workspace. */
function workspaceOf(exec, args, fallback) {
  const explicit = text(args?.workspace)
  if (explicit !== '') return isAbsolute(explicit) ? resolve(explicit) : resolve(fallback, explicit)
  return fallback
}

/**
 * Runs directories to scan, nearest first. The CLI resolves a repo root for nested
 * workspaces, so walking up covers that without guessing a single location.
 *
 * @param workspace - Absolute workspace.
 * @param config - Normalized config.
 * @returns Existing absolute runs directories, deduplicated.
 */
export function runsDirCandidates(workspace, config) {
  const out = []
  const add = (path) => {
    if (typeof path === 'string' && path !== '' && !out.includes(path)) out.push(path)
  }
  if (config.runsDir !== '') add(isAbsolute(config.runsDir) ? config.runsDir : resolve(workspace, config.runsDir))
  if (typeof process.env.BABYSITTER_RUNS_DIR === 'string' && process.env.BABYSITTER_RUNS_DIR !== '') {
    add(process.env.BABYSITTER_RUNS_DIR)
  }
  let dir = resolve(workspace)
  for (;;) {
    add(join(dir, '.a5c', 'runs'))
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  add(join(homedir(), '.a5c', 'runs'))
  return out.filter((path) => {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  })
}

/** Read and parse one JSON file, or null. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** Find a run directory by id. An absolute run directory is accepted as well. */
export function findRunDir(runId, workspace, config) {
  const candidate = text(runId)
  if (candidate === '') return null
  if (isAbsolute(candidate) && isFile(join(candidate, 'run.json'))) return resolve(candidate)
  for (const base of runsDirCandidates(workspace, config)) {
    const dir = join(base, candidate)
    if (isFile(join(dir, 'run.json'))) return dir
  }
  return null
}

/** Map the last journal event type to a state a caller can act on. */
function stateOf(lastType) {
  if (lastType === null) return 'unknown'
  return TERMINAL_STATES.get(lastType) ?? NONTERMINAL_STATES.get(lastType) ?? 'unknown'
}

/** A compact transition row for the task timeline. */
function transitionOf(entry) {
  const data = entry?.data !== null && typeof entry?.data === 'object' ? entry.data : {}
  return {
    seq: entry.seq,
    type: entry.type,
    at: entry.recordedAt ?? null,
    effectId: typeof data.effectId === 'string' ? data.effectId : null,
    taskId: typeof data.taskId === 'string' ? data.taskId : null,
    label: typeof data.label === 'string' ? data.label : null,
    status: typeof data.status === 'string' ? data.status : null,
    reason: typeof data.reason === 'string' ? data.reason : null,
  }
}

/** Human-readable one-line transition, used as a taskboard note. */
function transitionNote(transition) {
  const parts = [`journal ${transition.seq}: ${transition.type}`]
  if (transition.taskId !== null) parts.push(`task=${transition.taskId}`)
  if (transition.label !== null) parts.push(`label=${transition.label}`)
  if (transition.effectId !== null) parts.push(`effect=${transition.effectId}`)
  if (transition.status !== null) parts.push(`status=${transition.status}`)
  if (transition.reason !== null) parts.push(`reason=${transition.reason}`)
  return parts.join('; ')
}

/**
 * Read one run from its journal. The journal is the authority; state.json is only a
 * cache. Task results are read because `genty call` can exit 0 with a failed shell task.
 *
 * @param runDir - Absolute run directory.
 * @param config - Normalized config.
 * @returns A JSON-safe run summary.
 */
export function summarizeRunDir(runDir, config) {
  const runJson = readJson(join(runDir, 'run.json')) ?? {}
  const journalDir = join(runDir, 'journal')
  let files = []
  try {
    files = readdirSync(journalDir).filter((name) => name.endsWith('.json')).sort()
  } catch {
    files = []
  }
  const scannedFiles = files.slice(-config.maxJournalScan)
  const entries = []
  let parseErrors = 0
  for (const file of scannedFiles) {
    const value = readJson(join(journalDir, file))
    if (value === null || typeof value !== 'object') {
      parseErrors += 1
      continue
    }
    const seq = Number.parseInt(file.split('.')[0], 10)
    entries.push({ ...value, seq: Number.isSafeInteger(seq) ? seq : null, filename: file })
  }
  const last = entries.length > 0 ? entries[entries.length - 1] : null
  const transitions = entries.slice(-config.maxTransitionNotes).map(transitionOf)
  const failedTasks = []
  for (const entry of entries) {
    if (entry.type !== 'EFFECT_RESOLVED') continue
    const data = entry.data !== null && typeof entry.data === 'object' ? entry.data : {}
    const resultRef = typeof data.resultRef === 'string' ? data.resultRef : null
    if (data.status === 'error') {
      failedTasks.push({ effectId: data.effectId ?? null, taskId: data.taskId ?? null, error: 'effect resolved with error status', exitCode: null })
      continue
    }
    if (resultRef === null) continue
    const result = readJson(join(runDir, resultRef))
    const value = result?.result !== null && typeof result?.result === 'object' ? result.result : null
    if (value !== null && (value.success === false || (Number.isInteger(value.exitCode) && value.exitCode !== 0))) {
      failedTasks.push({
        effectId: data.effectId ?? null,
        taskId: result.taskId ?? data.taskId ?? null,
        error: typeof value.error === 'string' ? value.error : 'task reported success:false',
        exitCode: Number.isInteger(value.exitCode) ? value.exitCode : null,
      })
    }
  }

  const stateCache = readJson(join(runDir, 'state', 'state.json'))
  const outputValue = readJson(join(runDir, 'state', 'output.json'))
  let output = null
  let outputTruncated = false
  if (outputValue !== null) {
    const encoded = JSON.stringify(outputValue)
    if (encoded.length <= MAX_RESULT_PREVIEW) output = outputValue
    else {
      output = encoded.slice(0, MAX_RESULT_PREVIEW)
      outputTruncated = true
    }
  }

  return {
    runId: typeof runJson.runId === 'string' ? runJson.runId : basename(runDir),
    runDir: resolve(runDir),
    journalPath: resolve(journalDir),
    processId: typeof runJson.processId === 'string' ? runJson.processId : null,
    request: typeof runJson.request === 'string' ? runJson.request : null,
    harness: typeof runJson.harness === 'string' ? runJson.harness : null,
    prompt: typeof runJson.prompt === 'string' ? truncate(runJson.prompt, 2_000) : '',
    cwd: typeof runJson.cwd === 'string' ? runJson.cwd : null,
    createdAt: typeof runJson.createdAt === 'string' ? runJson.createdAt : null,
    completionProof: typeof runJson.completionProof === 'string' ? runJson.completionProof : null,
    state: stateOf(last?.type ?? null),
    lastEvent: last === null ? null : transitionOf(last),
    journalEntryCount: files.length,
    journalScanned: entries.length,
    journalParseErrors: parseErrors,
    transitions,
    eventCounts: entries.reduce((counts, entry) => {
      const key = String(entry.type ?? 'UNKNOWN')
      counts[key] = (counts[key] ?? 0) + 1
      return counts
    }, {}),
    failedTasks: failedTasks.slice(0, 20),
    pendingEffects: stateCache?.pendingEffectsByKind ?? {},
    stateCacheSavedAt: typeof stateCache?.savedAt === 'string' ? stateCache.savedAt : null,
    output,
    outputTruncated,
  }
}

/**
 * Recent runs, newest first, from run.json creation times. Summaries are built only
 * for the returned window, so a large runs directory is not fully re-read.
 */
export function listRecentRuns(workspace, config, limit) {
  const rows = []
  const sources = runsDirCandidates(workspace, config)
  for (const base of sources) {
    let entries = []
    try {
      entries = readdirSync(base, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const runDir = join(base, entry.name)
      const runJson = readJson(join(runDir, 'run.json'))
      const createdAt = typeof runJson?.createdAt === 'string' ? runJson.createdAt : null
      rows.push({ runDir, runId: runJson?.runId ?? entry.name, createdAt })
    }
  }
  rows.sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')))
  const selected = rows.slice(0, Math.max(1, limit))
  return {
    sources,
    scanned: rows.length,
    runs: selected.map((row) => summarizeRunDir(row.runDir, config)),
  }
}

/** Absolute path of the run -> task lookup index. */
function linksPath(cwd, config) {
  return isAbsolute(config.linksFile) ? config.linksFile : resolve(cwd, config.linksFile)
}

/** Read the lookup index. A malformed index is an empty index, never a crash. */
function readLinks(cwd, config) {
  const path = linksPath(cwd, config)
  const value = readJson(path)
  if (value === null || typeof value !== 'object') return { version: 1, runs: {}, path, error: null }
  const runs = value.runs !== null && typeof value.runs === 'object' ? value.runs : value
  return { version: 1, runs, path, error: null }
}

/** Persist one run -> task link. The taskboard remains the ledger; this is an index. */
function writeLink(cwd, config, runId, taskId) {
  if (runId === null || taskId === null) return null
  const path = linksPath(cwd, config)
  try {
    const links = readLinks(cwd, config)
    links.runs[runId] = { taskId, cwd: resolve(cwd), updatedAt: new Date().toISOString() }
    const entries = Object.entries(links.runs)
      .sort((left, right) => String(right[1]?.updatedAt ?? '').localeCompare(String(left[1]?.updatedAt ?? '')))
      .slice(0, MAX_LINK_ENTRIES)
    const document = { version: 1, runs: Object.fromEntries(entries) }
    mkdirSync(dirname(path), { recursive: true })
    const temp = `${path}.${process.pid}.tmp`
    writeFileSync(temp, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    renameSync(temp, path)
    return null
  } catch (error) {
    return `could not write ${path}: ${error instanceof Error ? error.message : String(error)}`
  }
}

/** Look up the task linked to one run, when this adapter created it. */
function linkFor(cwd, config, runId) {
  const links = readLinks(cwd, config)
  const entry = links.runs[runId]
  return entry !== null && typeof entry === 'object' && typeof entry.taskId === 'string' ? entry : null
}

/** A full task view for status/resume, or null. */
function taskView(board, cwd, taskId) {
  if (board === null || typeof taskId !== 'string') return null
  try {
    const task = board.get(cwd, taskId)
    if (task === undefined || task === null) return null
    const timeline = Array.isArray(task.timeline) ? task.timeline : []
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      revision: task.revision,
      updatedAt: task.updatedAt ?? null,
      timelineCount: timeline.length,
      lastNote: timeline.length === 0 ? null : timeline[timeline.length - 1].text ?? null,
    }
  } catch {
    return null
  }
}

/** Create one task for a run. Returns null and records a warning on any failure. */
function createRunTask(board, cwd, input, errors) {
  if (board === null) return null
  try {
    const task = board.create(
      cwd,
      {
        title: truncate(input.title, 200),
        objective: truncate(input.objective, 4_000),
        scope: input.scope,
        nonScope: ['Accepting or rejecting the run; only the human/orchestrator can do that.'],
        acceptance: ['The babysitter journal shows the run result.', 'The linked task is reviewed by a human/orchestrator.'],
        status: 'active',
        priority: 'normal',
      },
      'orchestrator',
    )
    if (task === null || typeof task?.id !== 'string') {
      errors.push(`taskboard create returned ${task?.code ?? 'no task'}`)
      return null
    }
    return task
  } catch (error) {
    errors.push(`taskboard create threw: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/** Append one note and report the latest revision. */
function noteTask(board, cwd, taskId, value, errors) {
  if (board === null || typeof taskId !== 'string') return null
  try {
    const result = board.note(cwd, { id: taskId, text: truncate(value, 1_000) })
    if (result === null || result?.ok === false) {
      errors.push(`taskboard note failed: ${result?.code ?? 'unknown'}`)
      return null
    }
    return result.task ?? null
  } catch (error) {
    errors.push(`taskboard note threw: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/** Move a finished task to review. Never `done`: acceptance belongs to the human. */
function reviewTask(board, cwd, taskId, revision, errors) {
  if (board === null || typeof taskId !== 'string') return { task: null, revision }
  let expected = revision
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = board.update(cwd, { id: taskId, expectedRevision: expected, patch: { status: 'review' } })
      if (result?.ok === true) return { task: result.task ?? null, revision: result.task?.revision ?? expected }
      if (result?.code === 'stale' && result.task !== undefined) {
        expected = result.task.revision
        continue
      }
      errors.push(`taskboard review update failed: ${result?.code ?? 'unknown'}`)
      return { task: result?.task ?? null, revision: expected }
    } catch (error) {
      errors.push(`taskboard review update threw: ${error instanceof Error ? error.message : String(error)}`)
      return { task: null, revision: expected }
    }
  }
  errors.push('taskboard review update stayed stale after 3 attempts')
  return { task: null, revision: expected }
}

/** The task name from a process path, without the `#export` suffix or extension. */
function processName(processSpec) {
  const file = processSpec.split('#')[0]
  const name = basename(file).replace(/\.(c|m)?js$/i, '').replace(/\.process$/i, '')
  return name === '' ? 'process' : name
}

/** Resolve a process argument; the file part becomes absolute, `#export` is kept. */
function processSpecOf(raw, cwd) {
  const value = text(raw)
  if (value === '') return { spec: '', file: '', error: null }
  const hashIndex = value.lastIndexOf('#')
  const filePart = hashIndex === -1 ? value : value.slice(0, hashIndex)
  const exportPart = hashIndex === -1 ? '' : value.slice(hashIndex)
  const file = isAbsolute(filePart) ? resolve(filePart) : resolve(cwd, filePart)
  if (!existsSync(file)) return { spec: value, file, error: `Process file not found: ${file}. Pass an absolute path, or a path relative to the workspace.` }
  if (!isFile(file)) return { spec: value, file, error: `Process path is not a file: ${file}.` }
  return { spec: `${file}${exportPart}`, file, error: null }
}

/** Whether a process file imports the SDK, and from where that import resolves. */
function sdkImportProbe(processFile, workspace) {
  let source = ''
  try {
    source = readFileSync(processFile, 'utf8').slice(0, 500_000)
  } catch {
    return { importsSdk: false, resolvedFrom: null }
  }
  if (!source.includes('@a5c-ai/babysitter-sdk')) return { importsSdk: false, resolvedFrom: null }
  const fromProcess = packageResolvableFrom(dirname(processFile), '@a5c-ai/babysitter-sdk')
  const fromWorkspace = packageResolvableFrom(workspace, '@a5c-ai/babysitter-sdk')
  return { importsSdk: true, resolvedFrom: fromProcess ?? fromWorkspace }
}

/** A JSON-safe tool result. */
function result(value) {
  return JSON.parse(JSON.stringify(value))
}

/** Build the four tools. Exported so the selftest can exercise them without a Host. */
export function babysitterTools(define, settings, boardOf) {
  const output = {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }

  const run = define({
    name: 'babysitter_run',
    description:
      'Run a babysitter process through the real CLI, or author one from a prompt. Modes: call (default), plan, yolo. The built-in `internal` harness runs deterministic shell tasks with no external agent CLI, but LLM/agent tasks still need a model provider API key. Creates exactly one taskboard task, notes start, finish and journal transitions, and leaves the task in `review` for human acceptance. Every spawn is bounded by timeoutMs (default 600000). Returns the run id, journal path, exit code verbatim, and failed task results separately.',
    parameters: {
      process: { type: 'string', description: 'Process module path, optionally with #export. The file must exist; it may import @a5c-ai/babysitter-sdk.' },
      prompt: { type: 'string', description: 'Prompt for genty to author and run a process. Requires a model provider; mutually usable with process.' },
      workspace: { type: 'string', description: 'Babysitter workspace. Defaults to the session workspace.' },
      mode: { type: 'string', enum: RUN_MODES, description: 'call | plan | yolo. Default call.' },
      harness: { type: 'string', description: 'Babysitter harness name. Default internal (genty built-in, no external agent CLI).' },
      model: { type: 'string', description: 'Optional model for LLM-backed tasks.' },
      maxIterations: { type: 'number', description: 'Optional iteration cap passed to genty.' },
      timeoutMs: { type: 'number', description: 'Per-call spawn bound in milliseconds. Default from plugin config.' },
    },
    output,
    async execute(args, exec) {
      const cwd = sessionCwd(exec)
      const warnings = []
      const bookkeeping = { taskId: null, taskRevision: null, taskStatus: null, notes: 0, errors: [] }
      const fail = (error, extra = {}) =>
        result({
          ok: false,
          tool: 'babysitter_run',
          runId: null,
          runDir: null,
          exitCode: null,
          timedOut: false,
          durationMs: 0,
          error,
          warnings,
          taskId: bookkeeping.taskId,
          taskRevision: bookkeeping.taskRevision,
          taskStatus: bookkeeping.taskStatus,
          taskboard: { mounted: boardOf() !== null, ...bookkeeping },
          ...extra,
        })

      try {
        const processRaw = text(args?.process)
        const prompt = text(args?.prompt)
        const mode = RUN_MODES.includes(text(args?.mode)) ? text(args?.mode) : 'call'
        const harness = text(args?.harness) || 'internal'
        const workspace = workspaceOf(exec, args, cwd)
        const timeoutMs = positive(args?.timeoutMs, settings.timeoutMs)

        if (processRaw === '' && prompt === '') {
          return fail('Provide `process` (a process module path, optionally file#export) or `prompt` (genty will author a process).')
        }
        if (!existsSync(workspace) || !statSync(workspace).isDirectory()) {
          return fail(`Workspace is not a directory: ${workspace}`)
        }
        const clis = resolveCli(settings)
        if (clis.error !== undefined) return fail(clis.error)
        if (clis.genty === null) return fail(GENTY_HINT)

        const processInfo = processSpecOf(processRaw, cwd)
        if (processInfo.error !== null) return fail(processInfo.error)
        if (processInfo.file !== '') {
          const probe = sdkImportProbe(processInfo.file, workspace)
          if (probe.importsSdk && probe.resolvedFrom === null) {
            const sdkDir = resolveSdkDir(clis)
            return fail(
              `The process file imports @a5c-ai/babysitter-sdk, but that package is not resolvable from ${dirname(processInfo.file)} or ${workspace}. The global install nests it at ${sdkDir ?? '<not found>'}. Add a workspace symlink: mkdir -p ${join(workspace, 'node_modules', '@a5c-ai')} && ln -s ${sdkDir ?? '<sdk-dir>'} ${join(workspace, 'node_modules', '@a5c-ai', 'babysitter-sdk')}. The CLI would otherwise retry the import until the timeout.`,
            )
          }
        }

        const title = processInfo.file !== '' ? `babysitter: ${processName(processInfo.spec)}` : `babysitter: ${truncate(prompt, 80)}`
        const objective =
          processInfo.file !== ''
            ? `Run babysitter process ${processInfo.spec} in ${workspace} (mode ${mode}, harness ${harness}).`
            : prompt
        const board = boardOf()
        const task = settings.taskboard ? createRunTask(board, cwd, {
          title,
          objective,
          scope: [`workspace:${workspace}`, `babysitter-mode:${mode}`, `babysitter-harness:${harness}`],
        }, bookkeeping.errors) : null
        if (task !== null) {
          bookkeeping.taskId = task.id
          bookkeeping.taskRevision = task.revision
          bookkeeping.taskStatus = task.status
          const noted = noteTask(
            board,
            cwd,
            task.id,
            `babysitter start: mode=${mode}; harness=${harness}; workspace=${workspace}; process=${processInfo.spec || '(prompt)'}; timeoutMs=${timeoutMs}`,
            bookkeeping.errors,
          )
          if (noted !== null) {
            bookkeeping.notes += 1
            bookkeeping.taskRevision = noted.revision
          }
        }
        if (!settings.taskboard) warnings.push('taskboard mapping is disabled by config.')
        else if (board === null) warnings.push('taskboard service is not mounted; the run is tracked only in the babysitter journal.')

        const cliArgs = [mode, '--harness', harness, '--workspace', workspace, '--no-interactive', '--json']
        if (processInfo.spec !== '') cliArgs.push('--process', processInfo.spec)
        else cliArgs.push('--prompt', prompt)
        if (text(args?.model) !== '') cliArgs.push('--model', text(args?.model))
        if (Number.isFinite(Number(args?.maxIterations)) && Number(args.maxIterations) > 0) {
          cliArgs.push('--max-iterations', String(Math.floor(Number(args.maxIterations))))
        }

        const cliResult = await runCli(clis.genty, cliArgs, { cwd: workspace, timeoutMs, maxOutputBytes: settings.maxOutputBytes })
        const runId = extractRunId(cliResult.stdout, cliResult.stderr)
        const printedDir = extractRunDir(cliResult.stdout, cliResult.stderr)
        const runDir = printedDir !== null && isFile(join(printedDir, 'run.json'))
          ? printedDir
          : runId === null
            ? null
            : findRunDir(runId, workspace, settings)
        if (runId !== null && task !== null) {
          const linkError = writeLink(cwd, settings, runId, task.id)
          if (linkError !== null) bookkeeping.errors.push(linkError)
        }
        let runSummary = runDir === null ? null : summarizeRunDir(runDir, settings)
        const sdkProbe = processInfo.file === '' ? null : sdkImportProbe(processInfo.file, workspace)
        if (sdkProbe?.importsSdk === true && sdkProbe.resolvedFrom === null) {
          warnings.push('The process file imports @a5c-ai/babysitter-sdk, but it was not resolvable when the run started.')
        }

        if (task !== null) {
          const runNote =
            runId === null
              ? `babysitter printed no run id; exit=${cliResult.exitCode ?? 'null'}`
              : `babysitter run id: ${runId}; journal: ${runDir ?? '(not found)'}`
          const noted = noteTask(board, cwd, task.id, runNote, bookkeeping.errors)
          if (noted !== null) {
            bookkeeping.notes += 1
            bookkeeping.taskRevision = noted.revision
          }
          const finishNote = `babysitter finish: exit=${cliResult.exitCode ?? 'null'}${cliResult.signal ? `; signal=${cliResult.signal}` : ''}; timedOut=${cliResult.timedOut}; runState=${runSummary?.state ?? 'unknown'}; journal=${runDir ?? '(not found)'}`
          const finished = noteTask(board, cwd, task.id, finishNote, bookkeeping.errors)
          if (finished !== null) {
            bookkeeping.notes += 1
            bookkeeping.taskRevision = finished.revision
          }
          if (runSummary !== null) {
            for (const transition of runSummary.transitions) {
              const notedTransition = noteTask(board, cwd, task.id, transitionNote(transition), bookkeeping.errors)
              if (notedTransition !== null) {
                bookkeeping.notes += 1
                bookkeeping.taskRevision = notedTransition.revision
              }
            }
            if (runSummary.journalEntryCount > runSummary.transitions.length) {
              const omitted = runSummary.journalEntryCount - runSummary.transitions.length
              const notedOmitted = noteTask(board, cwd, task.id, `journal: ${omitted} earlier entries not expanded`, bookkeeping.errors)
              if (notedOmitted !== null) {
                bookkeeping.notes += 1
                bookkeeping.taskRevision = notedOmitted.revision
              }
            }
            if (runSummary.failedTasks.length > 0) {
              const failedText = runSummary.failedTasks
                .map((entry) => `${entry.taskId ?? entry.effectId ?? 'task'}: ${entry.error}${entry.exitCode === null ? '' : ` (exit ${entry.exitCode})`}`)
                .join('; ')
              const notedFailure = noteTask(board, cwd, task.id, `babysitter task failures: ${failedText}`, bookkeeping.errors)
              if (notedFailure !== null) {
                bookkeeping.notes += 1
                bookkeeping.taskRevision = notedFailure.revision
              }
            }
          }
          const reviewed = reviewTask(board, cwd, task.id, bookkeeping.taskRevision, bookkeeping.errors)
          bookkeeping.taskRevision = reviewed.revision
          bookkeeping.taskStatus = reviewed.task?.status ?? 'review'
          if (reviewed.task === null) warnings.push('the linked task could not be re-read after the review update.')
        }

        const cliError = cliFailure(`genty ${mode}`, cliResult, timeoutMs)
        const runError =
          runSummary === null
            ? `the CLI exited ${cliResult.exitCode ?? 'null'} but no journal was found for the run. ${runId === null ? 'The CLI printed no run id.' : `Run id: ${runId}.`}`
            : ['failed', 'halted', 'cancelled'].includes(runSummary.state)
              ? `the journal reports run state ${runSummary.state}${runSummary.lastEvent?.reason ? `: ${runSummary.lastEvent.reason}` : ''}.`
              : runSummary.state !== 'completed'
                ? `the journal reports run state ${runSummary.state}; the run is not terminal. Use babysitter_status or babysitter_resume.`
                : runSummary.failedTasks.length > 0
                  ? `${runSummary.failedTasks.length} task(s) failed inside a run the journal marks completed.`
                  : null
        const error = cliError ?? runError
        return result({
          ok: error === null,
          tool: 'babysitter_run',
          mode,
          harness,
          workspace,
          process: processInfo.spec || null,
          prompt: processInfo.file === '' ? truncate(prompt, 2_000) : null,
          runId,
          runDir: runDir === null ? null : resolve(runDir),
          exitCode: cliResult.exitCode,
          signal: cliResult.signal,
          timedOut: cliResult.timedOut,
          durationMs: cliResult.durationMs,
          stdout: cliResult.stdout,
          stderr: cliResult.stderr,
          stdoutTruncated: cliResult.truncated.stdout,
          stderrTruncated: cliResult.truncated.stderr,
          run: runSummary,
          failedTasks: runSummary?.failedTasks ?? [],
          taskId: bookkeeping.taskId,
          taskRevision: bookkeeping.taskRevision,
          taskStatus: bookkeeping.taskStatus,
          taskboard: {
            mounted: board !== null,
            ...bookkeeping,
          },
          gentyPath: clis.genty.path,
          error,
          warnings,
        })
      } catch (error) {
        return fail(`babysitter_run failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  })

  const status = define({
    name: 'babysitter_status',
    description:
      'Report one babysitter run by id, or list recent runs, read from the event journal (journal/*.json under the workspace .a5c/runs or ~/.a5c/runs). Includes the last event, state, journal path, transitions, task failures and the linked taskboard task id/revision when the run was started by babysitter_run. The journal is the authority; state.json is only a cache.',
    parameters: {
      runId: { type: 'string', description: 'One run id. Omit it for the recent list.' },
      workspace: { type: 'string', description: 'Babysitter workspace. Defaults to the session workspace.' },
      limit: { type: 'number', description: 'Recent-list size. Default from plugin config (10).' },
    },
    output,
    async execute(args, exec) {
      const cwd = sessionCwd(exec)
      try {
        const clis = resolveCli(settings)
        if (clis.error !== undefined) return result({ ok: false, tool: 'babysitter_status', error: clis.error, runs: [] })
        const workspace = workspaceOf(exec, args, cwd)
        const board = boardOf()
        const runId = text(args?.runId)
        if (runId !== '') {
          if (!isRunId(runId) && !(isAbsolute(runId) && isFile(join(runId, 'run.json')))) {
            return result({ ok: false, tool: 'babysitter_status', error: `Not a run id: ${runId}. Pass the id the CLI printed, or an absolute run directory.` })
          }
          const runDir = findRunDir(runId, workspace, settings)
          if (runDir === null) {
            return result({
              ok: false,
              tool: 'babysitter_status',
              error: `No babysitter run ${runId} found. Scanned: ${runsDirCandidates(workspace, settings).join(', ') || '(no runs directories exist)'}.`,
            })
          }
          const runSummary = summarizeRunDir(runDir, settings)
          const link = linkFor(cwd, settings, runSummary.runId)
          const linkedTask = link === null ? null : taskView(board, cwd, link.taskId)
          return result({
            ok: true,
            tool: 'babysitter_status',
            runId: runSummary.runId,
            run: runSummary,
            task: linkedTask,
            taskId: linkedTask?.id ?? null,
            taskRevision: linkedTask?.revision ?? null,
            taskStatus: linkedTask?.status ?? null,
            taskboard: { mounted: board !== null, linked: link !== null, linkSource: link === null ? null : 'lookup-index' },
            clis: { babysitter: clis.babysitter?.path ?? null, genty: clis.genty?.path ?? null },
          })
        }
        const limit = positive(args?.limit, settings.maxRecentRuns)
        const recent = listRecentRuns(workspace, settings, limit)
        return result({
          ok: true,
          tool: 'babysitter_status',
          runs: recent.runs.map((runSummary) => {
            const link = linkFor(cwd, settings, runSummary.runId)
            return {
              runId: runSummary.runId,
              state: runSummary.state,
              processId: runSummary.processId,
              harness: runSummary.harness,
              createdAt: runSummary.createdAt,
              journalEntryCount: runSummary.journalEntryCount,
              lastEvent: runSummary.lastEvent,
              runDir: runSummary.runDir,
              taskId: link === null ? null : link.taskId,
            }
          }),
          scanned: recent.scanned,
          sources: recent.sources,
          taskboard: { mounted: board !== null },
          note: recent.runs.length === 0 ? 'No babysitter runs found in the scanned directories.' : null,
        })
      } catch (error) {
        return result({ ok: false, tool: 'babysitter_status', error: `babysitter_status failed: ${error instanceof Error ? error.message : String(error)}` })
      }
    },
  })

  const resume = define({
    name: 'babysitter_resume',
    description:
      'Resume a babysitter run by id through genty resume-run. This path needs the same model provider credentials as any LLM-backed run, so a deterministic shell-only run that already completed usually has nothing to resume. Appends notes to the linked taskboard task and leaves it in review. Every spawn is bounded by timeoutMs (default 600000).',
    parameters: {
      runId: { type: 'string', required: true, description: 'Run id to resume.' },
      workspace: { type: 'string', description: 'Babysitter workspace. Defaults to the session workspace.' },
      harness: { type: 'string', description: 'Babysitter harness name. Default internal.' },
      model: { type: 'string', description: 'Optional model for LLM-backed tasks.' },
      maxIterations: { type: 'number', description: 'Optional iteration cap passed to genty.' },
      timeoutMs: { type: 'number', description: 'Per-call spawn bound in milliseconds. Default from plugin config.' },
    },
    output,
    async execute(args, exec) {
      const cwd = sessionCwd(exec)
      const warnings = []
      const bookkeeping = { taskId: null, taskRevision: null, taskStatus: null, notes: 0, errors: [] }
      try {
        const runId = text(args?.runId)
        if (runId === '' || !isRunId(runId)) return result({ ok: false, tool: 'babysitter_resume', error: 'Provide the run id printed by babysitter_run or babysitter_status.' })
        const workspace = workspaceOf(exec, args, cwd)
        const harness = text(args?.harness) || 'internal'
        const timeoutMs = positive(args?.timeoutMs, settings.timeoutMs)
        const clis = resolveCli(settings)
        if (clis.error !== undefined) return result({ ok: false, tool: 'babysitter_resume', error: clis.error, runId })
        if (clis.genty === null) return result({ ok: false, tool: 'babysitter_resume', error: GENTY_HINT, runId })
        const runDir = findRunDir(runId, workspace, settings)
        const board = boardOf()
        const link = linkFor(cwd, settings, runId)
        const taskId = link?.taskId ?? null
        if (board !== null && taskId !== null) {
          bookkeeping.taskId = taskId
          const noted = noteTask(board, cwd, taskId, `babysitter resume start: workspace=${workspace}; harness=${harness}; timeoutMs=${timeoutMs}`, bookkeeping.errors)
          if (noted !== null) {
            bookkeeping.notes += 1
            bookkeeping.taskRevision = noted.revision
          }
        }
        const cliArgs = ['resume-run', '--run-id', runId, '--harness', harness, '--workspace', workspace, '--no-interactive', '--json']
        if (text(args?.model) !== '') cliArgs.push('--model', text(args?.model))
        if (Number.isFinite(Number(args?.maxIterations)) && Number(args.maxIterations) > 0) {
          cliArgs.push('--max-iterations', String(Math.floor(Number(args.maxIterations))))
        }
        const cliResult = await runCli(clis.genty, cliArgs, { cwd: workspace, timeoutMs, maxOutputBytes: settings.maxOutputBytes })
        const resolvedRunDir = runDir ?? findRunDir(runId, workspace, settings)
        const runSummary = resolvedRunDir === null ? null : summarizeRunDir(resolvedRunDir, settings)
        if (board !== null && taskId !== null) {
          const finishNote = `babysitter resume finish: exit=${cliResult.exitCode ?? 'null'}${cliResult.signal ? `; signal=${cliResult.signal}` : ''}; timedOut=${cliResult.timedOut}; runState=${runSummary?.state ?? 'unknown'}; journal=${resolvedRunDir ?? '(not found)'}`
          const noted = noteTask(board, cwd, taskId, finishNote, bookkeeping.errors)
          if (noted !== null) {
            bookkeeping.notes += 1
            bookkeeping.taskRevision = noted.revision
          }
          const reviewed = reviewTask(board, cwd, taskId, bookkeeping.taskRevision, bookkeeping.errors)
          bookkeeping.taskRevision = reviewed.revision
          bookkeeping.taskStatus = reviewed.task?.status ?? 'review'
          const finalView = taskView(board, cwd, taskId)
          if (finalView !== null) bookkeeping.taskRevision = finalView.revision
        }
        const cliError = cliFailure('genty resume-run', cliResult, timeoutMs)
        const runError =
          runSummary === null
            ? `no journal was found for run ${runId}.`
            : runSummary.state !== 'completed'
              ? `the journal reports run state ${runSummary.state}; the run is not terminal.`
              : runSummary.failedTasks.length > 0
                ? `${runSummary.failedTasks.length} task(s) failed inside a run the journal marks completed.`
                : null
        const error = cliError ?? runError
        return result({
          ok: error === null,
          tool: 'babysitter_resume',
          runId,
          runDir: resolvedRunDir === null ? null : resolve(resolvedRunDir),
          exitCode: cliResult.exitCode,
          signal: cliResult.signal,
          timedOut: cliResult.timedOut,
          durationMs: cliResult.durationMs,
          stdout: cliResult.stdout,
          stderr: cliResult.stderr,
          stdoutTruncated: cliResult.truncated.stdout,
          stderrTruncated: cliResult.truncated.stderr,
          run: runSummary,
          taskId: bookkeeping.taskId,
          taskRevision: bookkeeping.taskRevision,
          taskStatus: bookkeeping.taskStatus,
          taskboard: { mounted: board !== null, ...bookkeeping },
          gentyPath: clis.genty.path,
          error,
          warnings,
        })
      } catch (error) {
        return result({ ok: false, tool: 'babysitter_resume', error: `babysitter_resume failed: ${error instanceof Error ? error.message : String(error)}`, ...bookkeeping })
      }
    },
  })

  const doctor = define({
    name: 'babysitter_doctor',
    description:
      'Run genty doctor --json plus CLI version probes. Reports the exact failure when no model provider credentials are configured; it does not install or fix anything. Also reports the resolved babysitter/genty paths, the SDK directory process files import, and the runs directories that status scans.',
    parameters: {
      workspace: { type: 'string', description: 'Workspace to run diagnostics in. Defaults to the session workspace.' },
      timeoutMs: { type: 'number', description: 'Doctor bound in milliseconds. Default from plugin config (60000).' },
    },
    output,
    async execute(args, exec) {
      const cwd = sessionCwd(exec)
      try {
        const clis = resolveCli(settings)
        if (clis.error !== undefined) return result({ ok: false, tool: 'babysitter_doctor', error: clis.error, versions: null, doctor: null })
        const workspace = workspaceOf(exec, args, cwd)
        const timeoutMs = positive(args?.timeoutMs, settings.doctorTimeoutMs)
        const versions = {}
        if (clis.babysitter !== null) {
          const versionResult = await runCli(clis.babysitter, ['--version'], { cwd: workspace, timeoutMs: 15_000, maxOutputBytes: 4_000 })
          versions.babysitter = { version: tail(versionResult.stdout, 200) || null, exitCode: versionResult.exitCode, stderr: tail(versionResult.stderr, 400) || null }
        }
        if (clis.genty !== null) {
          const versionResult = await runCli(clis.genty, ['--version'], { cwd: workspace, timeoutMs: 15_000, maxOutputBytes: 4_000 })
          versions.genty = { version: tail(versionResult.stdout, 200) || null, exitCode: versionResult.exitCode, stderr: tail(versionResult.stderr, 400) || null }
        }
        let doctorResult = null
        if (clis.genty !== null) {
          doctorResult = await runCli(clis.genty, ['doctor', '--json'], { cwd: workspace, timeoutMs, maxOutputBytes: settings.maxOutputBytes })
        }
        const error = doctorResult === null ? GENTY_HINT : cliFailure('genty doctor', doctorResult, timeoutMs)
        const sdkDir = resolveSdkDir(clis)
        return result({
          ok: error === null,
          tool: 'babysitter_doctor',
          clis: { babysitter: clis.babysitter?.path ?? null, genty: clis.genty?.path ?? null },
          versions,
          sdkDir,
          sdkResolvableFromWorkspace: packageResolvableFrom(workspace, '@a5c-ai/babysitter-sdk'),
          runsDirs: runsDirCandidates(workspace, settings),
          doctor:
            doctorResult === null
              ? null
              : {
                  exitCode: doctorResult.exitCode,
                  signal: doctorResult.signal,
                  timedOut: doctorResult.timedOut,
                  durationMs: doctorResult.durationMs,
                  stdout: doctorResult.stdout,
                  stderr: doctorResult.stderr,
                  stdoutTruncated: doctorResult.truncated.stdout,
                  stderrTruncated: doctorResult.truncated.stderr,
                },
          error,
          note:
            error === null
              ? 'genty doctor exited 0.'
              : 'genty doctor did not pass. The exact CLI message is in doctor.stderr and doctor.stdout; this tool does not fix credentials.',
        })
      } catch (error) {
        return result({ ok: false, tool: 'babysitter_doctor', error: `babysitter_doctor failed: ${error instanceof Error ? error.message : String(error)}` })
      }
    },
  })

  return { run, status, resume, doctor }
}

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = '@cc/dsh-babysitter'

/** The tool registry is the only hard dependency; taskboard is injected optionally. */
export const inject = ['tools']

/**
 * Register the four tools and bind the optional taskboard service.
 *
 * The taskboard is read through `ctx.inject(['taskboard'], ...)` rather than a
 * required `inject` entry: a required dependency would leave this plugin pending on
 * a machine without the taskboard, and its tools would disappear with it.
 *
 * @param ctx - Cordis context.
 * @param config - Raw plugin config.
 */
export function apply(ctx, config = {}) {
  const settings = normalizeConfig(config)
  let injectedBoard = null
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['taskboard'], (scope) => {
        injectedBoard = scope?.taskboard ?? null
      })
    } catch {
      injectedBoard = null
    }
  }
  const boardOf = () => {
    if (injectedBoard !== null) return injectedBoard
    try {
      return typeof ctx.get === 'function' ? ctx.get('taskboard') ?? null : null
    } catch {
      return null
    }
  }
  const tools = babysitterTools(defineTool, settings, boardOf)
  ctx.tools.register(tools.run)
  ctx.tools.register(tools.status)
  ctx.tools.register(tools.resume)
  ctx.tools.register(tools.doctor)
}
