/**
 * PURPOSE
 *   Turn a test that a role actually performed into durable, reproducible knowledge in the
 *   repository: one case per observed requirement, stored under `docs/cases/`, editable only
 *   through this tool so the schema (and the evidence trail) cannot drift.
 *
 *   The deployment rule used to be "no autotests". The honest rule is "no SPECULATIVE tests":
 *   explore with the role's own tools, reproduce the behaviour, observe it fail before the fix
 *   if it is a regression, and only then persist the case. A case is either AUTOMATED (a real
 *   test file plus the exact command that ran it, with a red run and a green run recorded) or
 *   DOCUMENTED-ONLY (steps, expected outcome and a named reason why it cannot be a test). The
 *   business requirement survives either way; a missing test or a changed surface file makes the
 *   case STALE, never deleted.
 *
 * INPUTS
 *   Config (all optional):
 *     dir       - library root, relative to the session workspace. Default `docs/cases`.
 *     roles     - override the per-preset tool policy (see DEFAULT_ROLE_TOOLS).
 *     shownInPrompt - whether to contribute a short status section. Default true.
 *
 * OUTPUTS
 *   Eight host tools (registered per agent according to the role policy):
 *     case_record, case_update, case_verify, case_list, case_get, case_supersede,
 *     case_deprecate, case_drift.
 *   Every refusal is a value `{ ok:false, code, message }` with a stable code, never a throw;
 *   the model gets the same word the future client panel will show.
 *
 * KEYWORDS
 *   test cases, case library, red-first, documented-only, drift, stale, compare-and-set,
 *   supersede, deprecate, requirement intake, docs/cases
 *
 * BEHAVIOUR ON EDGE CASES
 *   - automated:true without testPath + runCommand -> `AUTOMATED_REQUIRES_TEST`.
 *   - automated:false without a reason -> `DOCUMENTED_REQUIRES_REASON`.
 *   - case_update/case_verify/case_supersede/case_deprecate without the current revision ->
 *     `REVISION_CONFLICT` carrying the current revision; the file is not touched.
 *   - automated verification without an observed red run -> `RED_FIRST_REQUIRED`.
 *   - verification without a command/output/exit -> `EVIDENCE_REQUIRED`.
 *   - a superseded/deprecated case is CLOSED: edits and verifications refuse `CASE_CLOSED`.
 *   - drift on an automated case whose test file is gone degrades it to automated:false with a
 *     reason and status stale; the requirement stays.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { driftFor, fileHash, slugify } from './lib/schema.mjs'

export { driftFor, slugify }

export const name = 'test-cases'
export const inject = ['tools', 'systemPrompt', 'commands']

/** Tools every tester role gets: the full library, including evidence. */
const ALL_TOOLS = ['case_record', 'case_update', 'case_verify', 'case_list', 'case_get', 'case_supersede', 'case_deprecate', 'case_remove', 'case_drift']
/** The root intake set: record a human requirement and read the library, never claim a run. */
const INTAKE_TOOLS = ['case_record', 'case_list', 'case_get', 'case_drift']

/**
 * Per-preset tool policy.
 *
 * WHY ROLE-AWARE AT ALL. The human states requirements in chat; the orchestrator is the intake
 * point, so it must be able to record a case (source human, status unverified) and read the
 * library - but it must not be able to claim a verification it never ran. The roles that
 * explore and prove (backend, ux, reviewer, critic, docs, research) get the whole surface.
 * A session without a preset (standard/headless) gets the whole surface so the library is
 * usable outside the orchestrated presets; that is a deliberate default, not an oversight.
 */
export const DEFAULT_ROLE_TOOLS = {
  orchestrator: INTAKE_TOOLS,
  backend: ALL_TOOLS,
  ux: ALL_TOOLS,
  reviewer: ALL_TOOLS,
  critic: ALL_TOOLS,
  docs: ALL_TOOLS,
  research: ALL_TOOLS,
}

const STATUSES = ['unverified', 'verified', 'failing', 'stale', 'superseded', 'deprecated']
const KINDS = ['regression', 'scenario']
const CLOSED = new Set(['superseded', 'deprecated'])

/** A refusal is a value with a stable code; the tool layer never sees an exception. */
class Refusal extends Error {
  constructor(code, message, extra = {}) {
    super(message)
    this.code = code
    this.extra = extra
  }
}

/** Resolve the session workspace the same way the other host plugins do. */
function workingDir(agent) {
  return agent?.session?.header?.cwd ?? process.cwd()
}

/** Absolute library root for a workspace. */
function libraryDir(cwd, config) {
  const dir = typeof config?.dir === 'string' && config.dir !== '' ? config.dir : 'docs/cases'
  return join(cwd, ...dir.split('/').filter(Boolean))
}

/** Case ids are file names: one lowercase kebab segment, never a path. */
const CASE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Validate a requested case id.
 *
 * A case id is a FILE NAME, not a path. The first version joined the raw string, so
 * `id: "../outside"` read a JSON file outside the library and a crafted `record.id` wrote one
 * there. The grammar allows no slash, dot or separator, and the caller's id is checked against
 * the stored `record.id` on read, so a renamed file cannot smuggle a different id in.
 *
 * @param id - The requested id (any value).
 * @returns The id when valid.
 */
export function safeCaseId(id) {
  if (typeof id !== 'string' || !CASE_ID.test(id)) {
    throw new Refusal('INVALID_CASE_ID', `"${String(id).slice(0, 80)}" is not a case id; expected ^[a-z0-9]+(-[a-z0-9]+)*$`)
  }
  return id
}

/**
 * Resolve a case path inside the library, refusing a symlink that leaves it.
 *
 * @param dir - Library root.
 * @param id - Validated id.
 * @returns Absolute path (the file may not exist yet).
 */
function casePath(dir, id) {
  safeCaseId(id)
  const path = join(dir, `${id}.json`)
  let realDir
  try {
    realDir = realpathSync(dir)
  } catch {
    return join(dir, `${id}.json`)
  }
  try {
    const realFile = realpathSync(path)
    if (realFile !== join(realDir, `${id}.json`)) {
      throw new Refusal('CASE_OUTSIDE_LIBRARY', `case "${id}" resolves outside the library (${realFile})`)
    }
    return realFile
  } catch (error) {
    if (error instanceof Refusal) throw error
    // The file does not exist yet (or the symlink is dangling): the validated join is the path.
    return join(realDir, `${id}.json`)
  }
}

/** Read one case file; a missing file is a refusal, not an empty case. */
export function readCase(dir, id) {
  const path = casePath(dir, id)
  if (!existsSync(path)) throw new Refusal('CASE_NOT_FOUND', `no case "${id}" in ${dir}`)
  let record
  try {
    record = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Refusal('CASE_UNREADABLE', `${path}: ${error.message}`)
  }
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new Refusal('CASE_UNREADABLE', `${path}: not a case object`)
  }
  if (record.id !== id) {
    throw new Refusal('CASE_ID_MISMATCH', `${path} holds id "${String(record.id).slice(0, 80)}", not "${id}"`)
  }
  return { record, path }
}

/** Atomic write: a reader never sees a half-written case, and a write failure is a refusal. */
export function writeCase(dir, record) {
  safeCaseId(record?.id)
  const path = casePath(dir, record.id)
  const temp = `${path}.${process.pid}.tmp`
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    renameSync(temp, path)
  } catch (error) {
    throw new Refusal('CASE_WRITE_FAILED', `${path}: ${error.message}`)
  }
  return path
}

/** Validate the fields the library cannot work without. */
function requireStrings(args, fields) {
  for (const field of fields) {
    if (typeof args?.[field] !== 'string' || args[field].trim() === '') {
      throw new Refusal('INVALID_CASE', `\`${field}\` must be a non-empty string`)
    }
  }
}

/** A recorded run: command, output excerpt, exit code and time. */
function requireEvidence(evidence, label) {
  if (evidence === null || typeof evidence !== 'object') throw new Refusal('EVIDENCE_REQUIRED', `${label} evidence is required: { command, output, exitCode, at? }`)
  for (const field of ['command', 'output']) {
    if (typeof evidence[field] !== 'string' || evidence[field].trim() === '') throw new Refusal('EVIDENCE_REQUIRED', `${label} evidence needs \`${field}\``)
  }
  if (!Number.isInteger(evidence.exitCode)) throw new Refusal('EVIDENCE_REQUIRED', `${label} evidence needs an integer \`exitCode\``)
  return {
    command: evidence.command,
    output: String(evidence.output).slice(0, 8000),
    exitCode: evidence.exitCode,
    at: typeof evidence.at === 'string' && evidence.at !== '' ? evidence.at : new Date().toISOString(),
  }
}

/** Require the caller's expected revision to match the file. */
function checkRevision(record, expectedRevision) {
  if (!Number.isInteger(expectedRevision)) throw new Refusal('REVISION_REQUIRED', 'expectedRevision is required (read the case first; the library is compare-and-set)')
  if (record.revision !== expectedRevision) {
    throw new Refusal('REVISION_CONFLICT', `case "${record.id}" is at revision ${record.revision}, not ${expectedRevision}`, { currentRevision: record.revision })
  }
  if (CLOSED.has(record.status)) throw new Refusal('CASE_CLOSED', `case "${record.id}" is ${record.status}; record a new case instead`)
}

/** The normalised view a list returns. */
function summary(record) {
  return {
    id: record.id, title: record.title, kind: record.kind, status: record.status,
    source: record.source, automated: record.automated, revision: record.revision,
    tags: record.tags, lastVerified: record.lastVerified ?? null,
    updatedAt: record.updatedAt, surfaceFiles: (record.surfaceFiles ?? []).map((entry) => entry.path),
  }
}

/** The shared execute wrapper: refusal -> value, anything else is a real bug and throws. */
async function guarded(fn) {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, code: error.code, message: error.message, ...error.extra }
    throw error
  }
}

const OUTPUT = {
  schema: { type: 'json' },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
}

/**
 * Decide whether a recorded verification is admissible, and what the case becomes.
 *
 * The rules are enforced HERE, once, so neither the tool nor a future panel path can accept a
 * weaker claim:
 *  - a degraded case (its test disappeared) cannot be verified by observation; it needs a real
 *    test back (TEST_REQUIRED), otherwise a lost test would silently turn into a green case;
 *  - an automated case needs its test file present, a red run and a green run of EXACTLY its
 *    runCommand (COMMAND_MISMATCH), and the red run must have failed (RED_FIRST_REQUIRED);
 *  - a documented-only pass must be a green observation (EVIDENCE_NOT_GREEN).
 *
 * @param record - Stored case.
 * @param args - `{ passed, evidence, redFirst?, commit? }`.
 * @param workspace - Session workspace (test existence is checked against it).
 * @returns `{ evidence, status, lastVerified }`.
 */
export function verificationPlan(record, args, workspace) {
  if (typeof args.passed !== 'boolean') throw new Refusal('EVIDENCE_REQUIRED', 'passed must be true or false')
  const evidence = requireEvidence(args.evidence, 'verification')
  if (record.degraded === true) {
    throw new Refusal('TEST_REQUIRED', 'this case was degraded to documented-only because its test disappeared; restore the test and record it as automated before verifying again')
  }
  if (record.automated === true) {
    const testPath = typeof record.testPath === 'string' ? record.testPath : ''
    if (testPath === '' || !existsSync(join(workspace, testPath))) {
      throw new Refusal('TEST_REQUIRED', `automated case needs its test file present: ${testPath === '' ? '(no testPath)' : testPath}`)
    }
    const runCommand = typeof record.runCommand === 'string' ? record.runCommand.trim() : ''
    if (runCommand === '') throw new Refusal('TEST_REQUIRED', 'automated case needs a runCommand')
    if (evidence.command.trim() !== runCommand) {
      throw new Refusal('COMMAND_MISMATCH', `evidence.command must be the case's runCommand (${runCommand})`)
    }
    if (args.passed === true) {
      const red = requireEvidence(args.redFirst, 'red-first')
      if (red.command.trim() !== runCommand) {
        throw new Refusal('COMMAND_MISMATCH', `redFirst.command must be the case's runCommand (${runCommand})`)
      }
      if (red.exitCode === 0) throw new Refusal('RED_FIRST_REQUIRED', 'red-first evidence must show the test FAILING (non-zero exit) before the fix')
      if (evidence.exitCode !== 0) throw new Refusal('EVIDENCE_NOT_GREEN', 'the green run must have exitCode 0')
      return { evidence: { redFirst: red, green: evidence, commit: args.commit ?? null }, status: 'verified', lastVerified: { at: evidence.at, command: evidence.command, exitCode: 0 } }
    }
    return { evidence: { redFirst: null, green: evidence, commit: args.commit ?? null }, status: 'failing', lastVerified: null }
  }
  if (args.passed === true && evidence.exitCode !== 0) {
    throw new Refusal('EVIDENCE_NOT_GREEN', 'a documented-only pass must be a green observation (exitCode 0)')
  }
  return { evidence: { observation: evidence, commit: args.commit ?? null }, status: args.passed ? 'verified' : 'failing', lastVerified: args.passed ? { at: evidence.at, command: evidence.command, exitCode: evidence.exitCode } : null }
}

/** Build the eight tools against one config. */
export function createTools(config = {}) {
  const dirFor = (agent) => libraryDir(workingDir(agent), config)

  const record = defineTool({
    name: 'case_record',
    description: 'Persist ONE observed test case in docs/cases/. Use after exploring and reproducing the behaviour, never to speculate. automated:true REQUIRES testPath + runCommand (a real test file and the exact command); automated:false REQUIRES a reason (why it cannot be a test) plus steps and expected. source:human records a requirement stated by the human (status unverified, no verification claimed).',
    parameters: {
      title: { type: 'string', required: true, description: 'Short outcome-focused title; it becomes the case id.' },
      requirement: { type: 'string', required: true, description: 'The business requirement this case protects, in one or two sentences.' },
      kind: { type: 'string', enum: KINDS, description: 'regression (must keep working) | scenario (a flow a user walks).' },
      steps: { type: 'array', items: { type: 'string' }, description: 'How to reproduce, in order. For automated cases: what the test does.' },
      expected: { type: 'string', required: true, description: 'The observable expected outcome.' },
      automated: { type: 'boolean', description: 'true when a real test file exists and was run; false for documented-only.' },
      testPath: { type: 'string', description: 'Repository-relative path of the test that encodes this case (automated only).' },
      runCommand: { type: 'string', description: 'Exact command that runs that test (automated only).' },
      reason: { type: 'string', description: 'Why this case cannot be automated (documented-only only).' },
      fixture: { type: 'string', description: 'Optional fixture/seed the case needs.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Free tags for filtering.' },
      surfaceFiles: { type: 'array', items: { type: 'string' }, description: 'Repository-relative files whose change invalidates this verification.' },
      source: { type: 'string', enum: ['human', 'agent'], description: 'Who stated the requirement. Default agent.' },
      linkedTaskId: { type: 'string', description: 'Optional taskboard task that implements this requirement.' },
    },
    output: OUTPUT,
    execute: (args, exec) => guarded(() => {
      requireStrings(args, ['title', 'requirement', 'expected'])
      const kind = KINDS.includes(args.kind) ? args.kind : 'regression'
      const automated = args.automated === true
      if (automated) {
        requireStrings(args, ['testPath', 'runCommand'])
      } else if (typeof args.reason !== 'string' || args.reason.trim() === '') {
        throw new Refusal('DOCUMENTED_REQUIRES_REASON', 'automated:false needs a `reason` naming why this case cannot be a test')
      }
      const source = args.source === 'human' ? 'human' : 'agent'
      if (Array.isArray(args.steps) && args.steps.filter((step) => typeof step === 'string' && step.trim() !== '').length === 0) {
        throw new Refusal('INVALID_CASE', '`steps` must not be empty; a case without reproduction steps cannot be rerun')
      }
      const dir = dirFor(exec.agent)
      const workspace = workingDir(exec.agent)
      const id = slugify(args.title)
      if (existsSync(join(dir, `${id}.json`))) throw new Refusal('CASE_EXISTS', `case "${id}" already exists; update it with case_update or give a different title`)
      const now = new Date().toISOString()
      const record = {
        schemaVersion: 1,
        id,
        title: args.title.trim(),
        requirement: args.requirement.trim(),
        kind,
        status: 'unverified',
        source,
        automated,
        ...(automated ? { testPath: args.testPath, runCommand: args.runCommand } : { reason: args.reason }),
        steps: Array.isArray(args.steps) ? args.steps.filter((step) => typeof step === 'string' && step !== '') : [],
        expected: args.expected.trim(),
        ...(typeof args.fixture === 'string' && args.fixture !== '' ? { fixture: args.fixture } : {}),
        tags: Array.isArray(args.tags) ? args.tags.filter((tag) => typeof tag === 'string' && tag !== '') : [],
        surfaceFiles: (Array.isArray(args.surfaceFiles) ? args.surfaceFiles : []).filter((path) => typeof path === 'string' && path !== '').map((path) => ({ path, sha256: fileHash(join(workspace, path)) ?? '' })),
        ...(typeof args.linkedTaskId === 'string' && args.linkedTaskId !== '' ? { linkedTaskId: args.linkedTaskId } : {}),
        revision: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: exec.agent?.session?.header?.agentPreset ?? 'agent',
        createdByKind: 'agent',
        history: [],
        evidence: {},
      }
      const path = writeCase(dir, record)
      return { ok: true, case: summary(record), path: relative(workspace, path) }
    }),
  })

  const update = defineTool({
    name: 'case_update',
    description: 'Edit a case with compare-and-set on its revision. Every edit keeps the previous text in history and records editedBy, so a contradicting requirement is resolved without losing either version. Refuses on a stale revision (REVISION_CONFLICT) or a closed case.',
    parameters: {
      id: { type: 'string', required: true },
      expectedRevision: { type: 'number', required: true, description: 'The revision you read. A mismatch is refused.' },
      title: { type: 'string' }, requirement: { type: 'string' }, expected: { type: 'string' },
      steps: { type: 'array', items: { type: 'string' } },
      automated: { type: 'boolean' }, testPath: { type: 'string' }, runCommand: { type: 'string' }, reason: { type: 'string' },
      fixture: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
      surfaceFiles: { type: 'array', items: { type: 'string' } },
    },
    output: OUTPUT,
    execute: (args, exec) => guarded(() => {
      requireStrings(args, ['id'])
      const dir = dirFor(exec.agent)
      const workspace = workingDir(exec.agent)
      const { record: existing } = readCase(dir, args.id)
      checkRevision(existing, args.expectedRevision)
      const next = { ...existing }
      for (const field of ['title', 'requirement', 'expected', 'testPath', 'runCommand', 'reason', 'fixture']) {
        if (typeof args[field] === 'string') next[field] = args[field]
      }
      if (Array.isArray(args.steps)) {
        next.steps = args.steps.filter((step) => typeof step === 'string')
        if (next.steps.length === 0) throw new Refusal('INVALID_CASE', '`steps` must not be empty')
      }
      if (Array.isArray(args.tags)) next.tags = args.tags.filter((tag) => typeof tag === 'string')
      if (Array.isArray(args.surfaceFiles)) next.surfaceFiles = args.surfaceFiles.filter((path) => typeof path === 'string').map((path) => ({ path, sha256: fileHash(join(workspace, path)) ?? '' }))
      if (typeof args.automated === 'boolean') next.automated = args.automated
      if (next.automated === true && (typeof next.testPath !== 'string' || next.testPath.trim() === '' || typeof next.runCommand !== 'string' || next.runCommand.trim() === '')) {
        throw new Refusal('AUTOMATED_REQUIRES_TEST', 'automated:true needs testPath and runCommand')
      }
      if (next.automated === false && (typeof next.reason !== 'string' || next.reason === '')) {
        throw new Refusal('DOCUMENTED_REQUIRES_REASON', 'automated:false needs a reason')
      }
      // Attribution comes from the INVOCATION, not from a caller-supplied field: a tool call is
      // an agent edit, the panel command passes actor 'human'. `source` records who stated the
      // requirement; it is not evidence that a human edited this revision.
      const editedBy = exec.actor === 'human' ? 'human' : 'agent'
      next.revision = existing.revision + 1
      next.updatedAt = new Date().toISOString()
      next.history = [...(existing.history ?? []), { revision: existing.revision, at: existing.updatedAt, editedBy, snapshot: { title: existing.title, requirement: existing.requirement, expected: existing.expected, steps: existing.steps, automated: existing.automated, testPath: existing.testPath, runCommand: existing.runCommand, reason: existing.reason, status: existing.status } }]
      // ANY change to the requirement or the automation/test binding invalidates the previous
      // verification: the evidence no longer covers the case. The case goes stale and its
      // evidence is dropped, so a later verify must produce red+green again.
      const automationChanged = next.automated !== existing.automated
        || next.testPath !== existing.testPath
        || next.runCommand !== existing.runCommand
      if (next.requirement !== existing.requirement || automationChanged) {
        next.status = next.status === 'verified' || next.status === 'failing' ? 'stale' : next.status
        next.lastVerified = null
        next.evidence = {}
        if (automationChanged) next.degraded = next.automated === true ? false : existing.degraded === true
      }
      const path = writeCase(dir, next)
      return { ok: true, case: summary(next), path: relative(workspace, path) }
    }),
  })

  const verify = defineTool({
    name: 'case_verify',
    description: 'Record an OBSERVED run of a case. Automated cases need a red-first run (exitCode != 0) and a green run (exitCode 0) of runCommand; documented-only cases record the observation command/output. On success the case is verified, lastVerified is set and surface hashes are re-snapshotted. Refuses to invent a pass.',
    parameters: {
      id: { type: 'string', required: true },
      expectedRevision: { type: 'number', required: true },
      passed: { type: 'boolean', required: true, description: 'True when the run/observation showed the expected outcome.' },
      evidence: { type: 'object', additionalProperties: false, description: '{ command, output, exitCode, at? } of the green/observation run.', properties: { command: { type: 'string' }, output: { type: 'string' }, exitCode: { type: 'number' }, at: { type: 'string' } } },
      redFirst: { type: 'object', additionalProperties: false, description: 'Automated only: { command, output, exitCode, at? } of the observed failing run before the fix. exitCode must be non-zero.', properties: { command: { type: 'string' }, output: { type: 'string' }, exitCode: { type: 'number' }, at: { type: 'string' } } },
      commit: { type: 'string', description: 'Optional git commit at verification time.' },
      notes: { type: 'string' },
    },
    output: OUTPUT,
    execute: (args, exec) => guarded(() => {
      requireStrings(args, ['id'])
      const dir = dirFor(exec.agent)
      const workspace = workingDir(exec.agent)
      const { record } = readCase(dir, args.id)
      checkRevision(record, args.expectedRevision)
      const plan = verificationPlan(record, args, workspace)
      record.evidence = plan.evidence
      record.status = plan.status
      record.lastVerified = plan.lastVerified
      if (plan.status === 'verified') {
        record.surfaceFiles = (record.surfaceFiles ?? []).map((entry) => ({ path: entry.path, sha256: fileHash(join(workspace, entry.path)) ?? entry.sha256 }))
      }
      record.revision += 1
      record.updatedAt = new Date().toISOString()
      record.history = [...(record.history ?? []), { revision: record.revision - 1, at: record.updatedAt, editedBy: 'agent', action: plan.status === 'verified' ? 'verified' : 'failed', notes: args.notes ?? null }]
      const path = writeCase(dir, record)
      return { ok: true, case: summary(record), evidence: record.evidence, path: relative(workspace, path) }
    }),
  })

  const list = defineTool({
    name: 'case_list',
    description: 'List cases in this workspace library, optionally filtered by status, kind, source, tag or automated flag. Returns summaries; use case_get for the full record and history.',
    parameters: {
      status: { type: 'string', enum: STATUSES }, kind: { type: 'string', enum: KINDS },
      source: { type: 'string', enum: ['human', 'agent'] }, tag: { type: 'string' }, automated: { type: 'boolean' },
    },
    output: OUTPUT,
    execute: (args, exec) => guarded(() => {
      const dir = dirFor(exec.agent)
      if (!existsSync(dir)) return { ok: true, cases: [], total: 0 }
      const cases = []
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json')) continue
        try {
          const record = JSON.parse(readFileSync(join(dir, file), 'utf8'))
          if (typeof record.id !== 'string' || !Array.isArray(record.history)) continue
          cases.push(record)
        } catch {
          // A malformed file is reported by case_drift, not silently listed.
        }
      }
      const filtered = cases.filter((record) => (args.status === undefined || record.status === args.status)
        && (args.kind === undefined || record.kind === args.kind)
        && (args.source === undefined || record.source === args.source)
        && (args.automated === undefined || record.automated === args.automated)
        && (args.tag === undefined || (record.tags ?? []).includes(args.tag)))
      filtered.sort((a, b) => String(a.id).localeCompare(String(b.id)))
      return { ok: true, total: filtered.length, cases: filtered.map(summary) }
    }),
  })

  const get = defineTool({
    name: 'case_get',
    description: 'Read one case in full: requirement, steps, expected, automation fields, evidence, surface hashes, revision and history.',
    parameters: { id: { type: 'string', required: true } },
    output: OUTPUT,
    execute: (args, exec) => guarded(() => {
      requireStrings(args, ['id'])
      const { record } = readCase(dirFor(exec.agent), args.id)
      return { ok: true, case: record }
    }),
  })

  const supersede = defineTool({
    name: 'case_supersede',
    description: 'Mark a case superseded by a newer case (they contradict). The old record stays with status superseded and supersededBy; nothing is deleted.',
    parameters: {
      id: { type: 'string', required: true }, expectedRevision: { type: 'number', required: true },
      by: { type: 'string', required: true, description: 'Id of the replacement case.' },
      reason: { type: 'string', description: 'Why the new case contradicts the old one.' },
    },
    output: OUTPUT,
    execute: (args, exec) => guarded(() => {
      requireStrings(args, ['id', 'by'])
      const dir = dirFor(exec.agent)
      const { record } = readCase(dir, args.id)
      checkRevision(record, args.expectedRevision)
      if (args.id === args.by) throw new Refusal('SELF_SUPERSEDE', 'a case cannot supersede itself')
      readCase(dir, args.by)
      record.status = 'superseded'
      record.supersededBy = args.by
      record.supersedeReason = args.reason ?? null
      record.revision += 1
      record.updatedAt = new Date().toISOString()
      record.history = [...(record.history ?? []), { revision: record.revision - 1, at: record.updatedAt, editedBy: exec.actor === 'human' ? 'human' : 'agent', action: 'superseded', by: args.by, reason: args.reason ?? null }]
      writeCase(dir, record)
      return { ok: true, case: summary(record) }
    }),
  })

  const deprecate = defineTool({
    name: 'case_deprecate',
    description: 'Deprecate a case with a required reason. The record and its requirement stay; status becomes deprecated and edits/verifications refuse CASE_CLOSED.',
    parameters: {
      id: { type: 'string', required: true }, expectedRevision: { type: 'number', required: true },
      reason: { type: 'string', required: true },
    },
    output: OUTPUT,
    execute: (args, exec) => guarded(() => {
      requireStrings(args, ['id', 'reason'])
      const dir = dirFor(exec.agent)
      const { record } = readCase(dir, args.id)
      checkRevision(record, args.expectedRevision)
      record.status = 'deprecated'
      record.deprecateReason = args.reason
      record.revision += 1
      record.updatedAt = new Date().toISOString()
      record.history = [...(record.history ?? []), { revision: record.revision - 1, at: record.updatedAt, editedBy: exec.actor === 'human' ? 'human' : 'agent', action: 'deprecated', reason: args.reason }]
      writeCase(dir, record)
      return { ok: true, case: summary(record) }
    }),
  })

  const drift = defineTool({
    name: 'case_drift',
    description: 'Check the library against the workspace NOW: rehash every recorded surface file and check every automated test path. A changed file marks the case stale (needs re-verification); a missing test degrades it to documented-only with a reason and marks it stale. Nothing is deleted. Pass an id to check one case, or omit for all.',
    parameters: { id: { type: 'string', description: 'Optional single case id.' } },
    output: OUTPUT,
    execute: (args, exec) => guarded(() => {
      const dir = dirFor(exec.agent)
      const workspace = workingDir(exec.agent)
      if (!existsSync(dir)) return { ok: true, findings: [], checked: 0 }
      const ids = typeof args.id === 'string' && args.id !== ''
        ? [args.id]
        : readdirSync(dir).filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -'.json'.length))
      const findings = []
      for (const id of ids) {
        let record
        try {
          ;({ record } = readCase(dir, id))
        } catch (error) {
          // A malformed or hostile file is a FINDING, not the end of the sweep - one bad file
          // must not hide every other case.
          findings.push({ id, error: error instanceof Refusal ? error.code : 'CASE_UNREADABLE', message: String(error?.message ?? error) })
          continue
        }
        const result = driftFor(record, workspace)
        const now = new Date().toISOString()
        const missingTest = result.missingTest === true
        const alreadyDegraded = record.degraded === true && record.status === 'stale'
        const statusChanged = result.status !== null && result.status !== record.status
        // Idempotent: a case already stale (or already degraded) with the same files unchanged
        // is not rewritten, so repeated drift runs do not churn revisions.
        if (missingTest && !alreadyDegraded) {
          record.automated = false
          record.degraded = true
          record.reason = `test file missing: ${record.testPath}; degraded to documented-only on ${now}`
          record.status = 'stale'
          record.needsReverification = { at: now, changedFiles: result.changedFiles, reason: result.reason }
          record.revision += 1
          record.updatedAt = now
          record.history = [...(record.history ?? []), { revision: record.revision - 1, at: now, editedBy: 'agent', action: 'degraded', reason: record.reason }]
          writeCase(dir, record)
        } else if (statusChanged && result.status !== null) {
          record.status = result.status
          record.needsReverification = { at: now, changedFiles: result.changedFiles, reason: result.reason }
          record.revision += 1
          record.updatedAt = now
          record.history = [...(record.history ?? []), { revision: record.revision - 1, at: now, editedBy: 'agent', action: 'stale', reason: result.reason }]
          writeCase(dir, record)
        } else if (result.status !== null) {
          findings.push({ id: record.id, status: record.status, changedFiles: result.changedFiles, missingTest: result.missingTest, reason: result.reason })
          continue
        }
        if (result.status !== null) findings.push({ id: record.id, status: record.status, changedFiles: result.changedFiles, missingTest: result.missingTest, reason: result.reason })
      }
      return { ok: true, checked: ids.length, findings }
    }),
  })

  /**
   * Permanently remove a CLOSED case.
   *
   * The library's rule was "never delete", but the owner now needs to retire deprecated and
   * superseded records. Removal is the only destructive verb and is deliberately narrow:
   * terminal status only, compare-and-set with the revision the caller read, and an append-only
   * audit line before the file is unlinked. Active/open cases are refused, never silently
   * degraded.
   */
  const remove = defineTool({
    name: 'case_remove',
    description: 'Permanently remove a DEPRECATED or SUPERSEDED case with compare-and-set. Active/open cases are refused (CASE_NOT_REMOVABLE). The removal is written to docs/cases/.removed.jsonl before the case file is unlinked.',
    parameters: {
      id: { type: 'string', required: true },
      expectedRevision: { type: 'number', required: true },
      removedBy: { type: 'string', enum: ['human', 'agent'], description: 'Who removed the case. Default agent.' },
    },
    output: OUTPUT,
    execute: (args, exec) => guarded(() => {
      requireStrings(args, ['id'])
      const dir = dirFor(exec.agent)
      const workspace = workingDir(exec.agent)
      const { record, path } = readCase(dir, args.id)
      // Do NOT use checkRevision: it refuses closed cases, and closed cases are exactly the
      // ones this verb exists for. Revision checks are repeated here without the status gate.
      if (!Number.isInteger(args.expectedRevision)) throw new Refusal('REVISION_REQUIRED', 'expectedRevision is required (read the case first; removal is compare-and-set)')
      if (record.revision !== args.expectedRevision) {
        throw new Refusal('REVISION_CONFLICT', `case "${record.id}" is at revision ${record.revision}, not ${args.expectedRevision}`, { currentRevision: record.revision })
      }
      if (!CLOSED.has(record.status)) {
        throw new Refusal('CASE_NOT_REMOVABLE', `case "${record.id}" is ${record.status}; only deprecated or superseded cases can be removed`)
      }
      const removedBy = args.removedBy === 'human' || exec.actor === 'human' ? 'human' : 'agent'
      const audit = { at: new Date().toISOString(), id: record.id, title: record.title, status: record.status, revision: record.revision, removedBy }
      // Audit first: a failed audit write must not destroy the only copy of the record.
      mkdirSync(dir, { recursive: true })
      appendFileSync(join(dir, '.removed.jsonl'), `${JSON.stringify(audit)}\n`, 'utf8')
      unlinkSync(path)
      return { ok: true, removed: audit, path: relative(workspace, path) }
    }),
  })

  return { case_record: record, case_update: update, case_verify: verify, case_list: list, case_get: get, case_supersede: supersede, case_deprecate: deprecate, case_remove: remove, case_drift: drift }
}

/** Short prompt section: the rule that makes the library worth trusting. */
const SECTION = [
  'TEST CASES (docs/cases/, host tool family):',
  '  Explore with your own tools first and OBSERVE the behaviour, then persist the case. Never record a speculative test.',
  '  automated:true needs a real test file + exact runCommand, and case_verify needs the observed red run (non-zero exit) before the green one. Otherwise record automated:false with steps, expected and the reason it cannot be a test.',
  '  The library is compare-and-set: read the case (case_get), pass expectedRevision on every edit, and supersede/deprecate instead of deleting. A changed surface file or a missing test makes a case stale; it never erases the requirement.',
  '  Removal is the only destructive verb: case_remove accepts ONLY deprecated/superseded cases, with the revision and an audit line; active/open cases are refused.',
].join('\n')

/**
 * Register the tools.
 *
 * @param ctx - Host context; needs `tools` and (optionally) `systemPrompt`.
 * @param config - See the file contract.
 */
export function apply(ctx, config = {}) {
  const tools = createTools(config)
  const policy = config.roles !== null && typeof config.roles === 'object' ? config.roles : DEFAULT_ROLE_TOOLS
  const showSection = config.shownInPrompt !== false
  ctx.on('agent/created', ({ agent }) => {
    const preset = agent?.session?.header?.agentPreset
    // Fail closed: an unrecognised preset gets NO tools. Only a preset-less session (the
    // deliberate case documented in README) or an explicitly listed one is served.
    const allowed = Array.isArray(policy[preset])
      ? policy[preset]
      : (preset === undefined || preset === 'standard' ? ALL_TOOLS : [])
    for (const toolName of allowed) {
      if (tools[toolName] !== undefined) agent.ctx.tools.register(tools[toolName])
    }
    if (showSection && typeof agent?.ctx?.systemPrompt?.section === 'function') {
      agent.ctx.systemPrompt.section({ name: 'deployment:test-cases', order: 123, text: SECTION })
    }
  })

  // THE PANEL'S DOOR. The human's panel is not a tool caller, so the same verbs are exposed
  // as one `/test-cases` JSON command. It executes the very same tool objects (and therefore
  // the same schema, CAS and writer); it never edits docs/cases/ itself.
  const COMMANDS = {
    list: 'case_list', detail: 'case_get', get: 'case_get', update: 'case_update',
    verify: 'case_verify', deprecate: 'case_deprecate', remove: 'case_remove', drift: 'case_drift',
  }
  ctx.commands.register({
    name: 'test-cases',
    description: 'Read or change the workspace test-case library (used by the Test cases panel).',
    recordInput: false,
    handler: async (invocation) => {
      let op
      try {
        op = JSON.parse(invocation.rawInput)
      } catch {
        return { kind: 'error', text: 'test-cases: expected a JSON operation' }
      }
      const toolName = COMMANDS[op?.op]
      if (toolName === undefined) return { kind: 'error', text: 'test-cases: unknown op (list | detail | update | verify | deprecate | remove | drift)' }
      const args = { ...op }
      delete args.op
      try {
        const value = await tools[toolName].execute(args, { agent: invocation.agent, actor: 'human' })
        if (value?.ok === false) {
          const current = Number.isInteger(value.currentRevision) ? ` (current rev ${value.currentRevision})` : ''
          return { kind: 'error', text: `test-cases: ${value.code}: ${value.message}${current}` }
        }
        return { kind: 'success', text: JSON.stringify(value) }
      } catch (error) {
        return { kind: 'error', text: `test-cases: ${error?.message ?? error}` }
      }
    },
  })
}
