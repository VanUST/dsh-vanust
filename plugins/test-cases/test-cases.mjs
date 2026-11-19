/**
 * PURPOSE
 *   Turn a test that a role actually performed into durable, reproducible knowledge in the
 *   repository - and EXECUTE it: one case per accepted behaviour, stored under `docs/cases/`,
 *   written only through this tool family so the schema and the evidence trail cannot drift.
 *
 *   The deployment rule used to be "no autotests". The honest rule is "no SPECULATIVE tests":
 *   explore with the role's own tools, reproduce the behaviour, and only then persist the case.
 *   A case is either AUTOMATED (a real test file plus the exact command that runs it) or
 *   DOCUMENTED-ONLY (steps, expected outcome and a named reason why it cannot be a test). An
 *   automated case is RUN by `case_run`, which records the MEASUREMENT (exit code, duration,
 *   the driver's CASE_SUMMARY metrics/hashes/artifacts, the declared checks), while `case_verify`
 *   is the manual report and is stamped `source: manual`. A green run with no recorded red is a
 *   measurement, not a verification; the measured red is a negative control. Every run keeps
 *   stdout/stderr and artifacts under `docs/cases/runs/` (gitignored, last 20 per case).
 *
 *   The business requirement survives either way; a missing test or a changed surface file makes
 *   the case STALE, never deleted.
 *
 * INPUTS
 *   Config (all optional):
 *     dir       - library root, relative to the session workspace. Default `docs/cases`.
 *     roles     - override the per-preset tool policy (see DEFAULT_ROLE_TOOLS).
 *     shownInPrompt - whether to contribute a short status section. Default true.
 *
 * OUTPUTS
 *   Twelve host tools (registered per agent according to the role policy):
 *     case_record, case_update, case_verify, case_run, case_suite, case_gate, case_list,
 *     case_get, case_supersede, case_deprecate, case_remove, case_drift.
 *   A `cases` service (ctx.provide) with `gateForTask`, consumed by the taskboard's close gate.
 *   One `/test-cases` command for the client panel, over the same tool objects.
 *   Every refusal is a value `{ ok:false, code, message }` with a stable code, never a throw;
 *   the model gets the same word the client panel shows.
 *
 * KEYWORDS
 *   test cases, case library, case runner, typed checks, metrics, baseline, flaky, artifacts,
 *   red-first, negative control, drift, stale, compare-and-set, supersede, deprecate,
 *   requirement intake, docs/cases
 *
 * BEHAVIOUR ON EDGE CASES
 *   - automated:true without testPath + runCommand -> `AUTOMATED_REQUIRES_TEST`.
 *   - automated:false without a reason -> `DOCUMENTED_REQUIRES_REASON`; checks on a
 *     documented-only case -> `CHECKS_REQUIRE_AUTOMATED`.
 *   - case_update/case_verify/case_run/case_supersede/case_deprecate without the current
 *     revision -> `REVISION_CONFLICT` carrying the current revision; the file is not touched.
 *   - automated manual verification without an observed red run -> `RED_FIRST_REQUIRED`;
 *     verification without a command/output/exit -> `EVIDENCE_REQUIRED`.
 *   - case_run on a documented-only/degraded/missing-test case -> `NOT_AUTOMATED` or
 *     `TEST_REQUIRED`; a red run without a control -> `NEGATIVE_CONTROL_REQUIRED`; a control
 *     that exits 0 -> `NEGATIVE_CONTROL_DID_NOT_FAIL`.
 *   - a declared check whose metric is absent from the summary FAILS (`metric_missing`), it does
 *     not pass; `runs>1` with a mixed outcome is recorded as `flaky`.
 *   - a superseded/deprecated case is CLOSED: edits, runs and verifications refuse `CASE_CLOSED`.
 *   - drift on a FLAGGABLE case (verified/failing/flaky) whose test file is gone degrades it to
 *     automated:false with a reason and status stale; an unverified case reports the change
 *     without claiming a regression, and the requirement stays.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { driftFor, fileHash, slugify } from './lib/schema.mjs'
import { normalizeChecks } from './lib/checks.mjs'
import { recordRun, runAttempts, shellExec, spawnExec } from './lib/runner.mjs'
import { mirrorCase } from './mirror.mjs'
import { Refusal, appendAudit, libraryDir, readCase, readCases, removeCaseFile, safeCaseId, writeCase } from './lib/store.mjs'

export { driftFor, slugify, safeCaseId, readCase, writeCase }

export const name = 'test-cases'
export const inject = ['tools', 'systemPrompt', 'commands']

/** Tools every tester role gets: the full library, including execution and evidence. */
const ALL_TOOLS = ['case_record', 'case_update', 'case_verify', 'case_run', 'case_suite', 'case_gate', 'case_list', 'case_get', 'case_supersede', 'case_deprecate', 'case_remove', 'case_drift']
/** The root intake set: record a human requirement, read the library and check the gate; never claim a run. */
const INTAKE_TOOLS = ['case_record', 'case_list', 'case_get', 'case_drift', 'case_gate']

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
/**
 * The preset in force: the tool-families service owns the resolution (projection first,
 * remembered selection, creation header last). Reading `agent.session.header.agentPreset`
 * here resolved the preset the session was CREATED with — the profile default `orchestrator`
 * — so every seat received the orchestrator intake set and the verify/run set never reached
 * a worker. The lookup is guarded because a composition without the service must not fail a
 * session creation.
 */
/**
 * The role-surface policy: a per-agent tool is registered only when the preset's row admits
 * it. `tools.restrict` cannot mask a tool registered into the agent's own layer, so the
 * registration itself has to ask. No tool-families row (or no service) admits everything.
 */
function surfaceAllows(ctx, agent, name) {
  try {
    return ctx.get?.('toolFamilies')?.allows?.(agent, name) !== false
  } catch {
    return true
  }
}

function presetOf(ctx, agent) {
  try {
    const resolved = ctx.get?.('toolFamilies')?.presetFor?.(agent?.session)
    if (typeof resolved === 'string' && resolved.trim() !== '') return resolved
  } catch {
    // No policy owner in this composition: fall back to the projection.
  }
  try {
    const projected = ctx.get?.('agentPresets')?.presetForSession?.(agent?.session)
    if (typeof projected === 'string' && projected.trim() !== '') return projected
  } catch {
    // No projection either: the creation header is the last fallback.
  }
  try {
    const header = agent?.session?.header?.agentPreset
    return typeof header === 'string' && header !== '' ? header : undefined
  } catch {
    return undefined
  }
}

/**
 * Keep one agent's case tools in line with its CURRENT preset.
 *
 * A seat selected on a blank session is committed as `agent-preset/selected`, which is raised
 * on the ROOT context and may arrive after `agent/created`; the previous set is disposed
 * before the new one is registered, or the duplicate registration would throw.
 */
function installCaseGate(ctx, { policy, tools, showSection }) {
  const installed = new Map()
  const sectionFor = (agent, preset) => {
    const granted = (Array.isArray(policy[preset]) ? policy[preset] : []).filter((name) => tools[name] !== undefined)
    if (showSection && granted.length > 0 && typeof agent?.ctx?.systemPrompt?.section === 'function') {
      agent.ctx.systemPrompt.section({
        name: 'deployment:test-cases',
        order: 123,
        text: granted.includes('case_run') ? SECTION_FULL : SECTION_INTAKE,
      })
    }
  }
  const sync = (agent) => {
    if (agent === undefined || agent === null) return
    try {
      const preset = presetOf(ctx, agent)
      const current = installed.get(agent)
      if (current !== undefined && current.preset === preset) return
      if (current !== undefined) {
        for (const dispose of current.disposers) {
          try {
            dispose()
          } catch {
            // A failing disposer must not take the session down.
          }
        }
        installed.delete(agent)
      }
      // Fail closed: an unrecognised or unlisted preset gets NO case tools.
      const granted = Array.isArray(policy[preset]) ? policy[preset] : []
      const selected = granted.filter((name) => tools[name] !== undefined && surfaceAllows(ctx, agent, name)).map((name) => tools[name])
      if (selected.length > 0) {
        const disposers = selected.map((tool) => agent.ctx.tools.register(tool)).filter((dispose) => typeof dispose === 'function')
        installed.set(agent, { preset, disposers })
      }
      sectionFor(agent, preset)
    } catch {
      // Never throw into agent/created: an exception there cancels the session creation.
    }
  }
  ctx.on('agent/created', ({ agent }) => sync(agent))
  if (typeof ctx.root?.on === 'function') {
    ctx.root.on('session/event', (session, event) => {
      if (event?.type !== 'agent-preset/selected') return
      let live
      try {
        live = ctx.get?.('agents')?.get?.(session?.id)
      } catch {
        live = undefined
      }
      if (live !== undefined && live !== null) sync(live)
    })
  }
  ctx.on('agent/pre-step', (payload, next) => {
    sync(payload?.agent)
    return next()
  }, { prepend: true })
}

// The case surface per role (design §5.3: intake at the root, the run/verify loop only
// where a role proves changes, read-only where it cites them). A preset absent from this
// map - gatherer included - gets NO case tools.
export const DEFAULT_ROLE_TOOLS = {
  orchestrator: INTAKE_TOOLS,
  backend: ['case_record', 'case_run', 'case_suite', 'case_get', 'case_list'],
  reviewer: ['case_get', 'case_list', 'case_run', 'case_gate'],
  critic: ['case_get', 'case_list', 'case_run'],
  ux: ['case_record', 'case_list'],
  research: ['case_get', 'case_list'],
  docs: ['case_record', 'case_list', 'case_get'],
  gatherer: [],
}

const STATUSES = ['unverified', 'verified', 'failing', 'flaky', 'stale', 'superseded', 'deprecated']
const KINDS = ['regression', 'scenario']
const CLOSED = new Set(['superseded', 'deprecated'])

/** Resolve the session workspace the same way the other host plugins do. */
function workingDir(agent) {
  return agent?.session?.header?.cwd ?? process.cwd()
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

/** The normalised view a list returns. Light on purpose: the detail carries the runs. */
function summary(record) {
  const runs = Array.isArray(record.runs) ? record.runs : []
  const last = runs.length > 0 ? runs[runs.length - 1] : null
  return {
    id: record.id, title: record.title, kind: record.kind, status: record.status,
    source: record.source, automated: record.automated, revision: record.revision,
    tags: record.tags, lastVerified: record.lastVerified ?? null,
    provenance: record.lastVerified?.source ?? null,
    runs: runs.length,
    lastRun: last === null ? null : { runId: last.runId, at: last.at, exitCode: last.exitCode, passed: last.passed, mode: last.mode },
    baseline: record.baseline?.metrics ?? null,
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
 * Decide whether a MANUAL verification is admissible, and what the case becomes.
 *
 * This is the reported half of the evidence: a human or an agent typed what it observed, so the
 * result is stamped `source: 'manual'` and the tool surfaces say so. `case_run` is the measured
 * half: it executes the stored command and the plugin produces the numbers. The rules here are
 * unchanged on purpose - a manual automated pass still needs the observed red run, exactly the
 * case's runCommand, and a green exit - but nothing here is called a measurement.
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
      return {
        evidence: { run: { ...evidence, passed: true, source: 'manual' }, redFirst: { ...red, source: 'manual' }, commit: args.commit ?? null, source: 'manual' },
        redFirst: { ...red, source: 'manual' },
        status: 'verified',
        lastVerified: { at: evidence.at, command: evidence.command, exitCode: 0, source: 'manual', commit: args.commit ?? null },
      }
    }
    return {
      evidence: { run: { ...evidence, passed: false, source: 'manual' }, redFirst: null, commit: args.commit ?? null, source: 'manual' },
      redFirst: null,
      status: 'failing',
      lastVerified: null,
    }
  }
  if (args.passed === true && evidence.exitCode !== 0) {
    throw new Refusal('EVIDENCE_NOT_GREEN', 'a documented-only pass must be a green observation (exitCode 0)')
  }
  return {
    evidence: { observation: { ...evidence, passed: args.passed === true, source: 'manual' }, commit: args.commit ?? null, source: 'manual' },
    redFirst: null,
    status: args.passed ? 'verified' : 'failing',
    lastVerified: args.passed ? { at: evidence.at, command: evidence.command, exitCode: evidence.exitCode, source: 'manual', commit: args.commit ?? null } : null,
  }
}

/**
 * The one blocker rule: an AUTOMATED case that is linked to this task (or is this case) and is
 * not verified blocks acceptance. Documented-only cases never block, and a case with no link to
 * the task is somebody else's requirement.
 */
function blockersFor(rows, { taskId, id } = {}) {
  const blockers = []
  const errors = []
  for (const row of rows) {
    if (row.record === undefined) {
      errors.push({ id: row.id, code: row.error })
      continue
    }
    const record = row.record
    if (id !== undefined && record.id !== id) continue
    if (taskId !== undefined && record.linkedTaskId !== taskId) continue
    if (record.automated !== true) continue
    if (record.status === 'verified') continue
    blockers.push({ id: record.id, status: record.status, provenance: record.lastVerified?.source ?? null, lastVerified: record.lastVerified ?? null })
  }
  return { blockers, errors }
}

/** The read-only gate the taskboard consumes (ctx.provide('cases', …)). */
export function gateForTask(cwd, taskId, config = {}) {
  const rows = readCases(libraryDir(cwd, config))
  const { blockers, errors } = blockersFor(rows, { taskId })
  return { ok: blockers.length === 0, blockers, errors }
}

/**
 * Build the twelve tools against one config.
 *
 * `env.shell` is the harness execution seam when the host mounted it; without it (tests, the
 * CLI) the runner falls back to its own `sh -c` executor. Either way the command comes from the
 * case, not from the caller.
 */
/** FR8: a waiver is complete only with a reason and the human. */
export function validWaiver(waiver) {
  return waiver !== null && typeof waiver === 'object' && typeof waiver.reason === 'string' && waiver.reason.trim() !== '' && waiver.by === 'human'
}

export function createTools(config = {}, env = {}) {
  /** Mirror one written case into the project state, when the core is mounted. */
  const mirror = async (agent, record) => {
    if (typeof env.mirror !== 'function' || record === undefined || record === null) return null
    try {
      return await env.mirror(agent, record)
    } catch {
      return null
    }
  }
  const dirFor = (agent) => libraryDir(workingDir(agent), config)
  const executor = env.shell !== undefined && env.shell !== null ? shellExec(env.shell) : spawnExec()

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
      reqId: { type: 'string', description: 'The REQ this test protects (REQ-001). Required: a test without a requirement proves nothing the register can close.' },
      authorRole: { type: 'string', description: 'The role that authored the test (orchestrator for acceptance tests, backend for implementation tests). Required: the author of an acceptance test must not be its implementer.' },
      waiver: { type: 'object', additionalProperties: false, description: 'Explicit waiver of test_req_required: {reason, by: "human"}; written to the state journal.', properties: { reason: { type: 'string' }, by: { type: 'string' } } },
      checks: {
        type: 'array',
        description: 'Typed checks case_run evaluates from the driver\'s CASE_SUMMARY: {name?, metric, op?, threshold?|expected?|baseline?, band?, unit?}. A check with none of threshold/expected/baseline is refused.',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            name: { type: 'string' }, metric: { type: 'string' },
            op: { type: 'string', enum: ['<=', '>=', '<', '>', '==', '!='] },
            threshold: { type: 'number' }, expected: { type: 'string' },
            baseline: { type: 'boolean' }, band: { type: 'number' }, unit: { type: 'string' },
          },
        },
      },
      negativeControl: { type: 'string', description: 'Driver control name for a measured red: the driver must break its own assertion when it receives CASE_NEGATIVE_CONTROL.' },
    },
    output: OUTPUT,
    execute: (args, exec) => guarded(async () => {
      requireStrings(args, ['title', 'requirement', 'expected'])
      const kind = KINDS.includes(args.kind) ? args.kind : 'regression'
      const automated = args.automated === true
      // FR11: a test belongs to a REQ and names its author. A case without either is refused
      // before the file is written (test_req_required).
      const reqId = typeof args.reqId === 'string' ? args.reqId.trim() : ''
      const authorRole = typeof args.authorRole === 'string' ? args.authorRole.trim() : ''
      if (reqId === '' || authorRole === '') {
        if (args.waiver === undefined) throw new Refusal('TEST_REQ_REQUIRED', 'a case needs reqId (the REQ it protects) and authorRole (who wrote it); pass both, or an explicit waiver {reason, by: "human"}')
        if (!validWaiver(args.waiver)) throw new Refusal('WAIVER_REQUIRED', 'a waiver needs {reason, by: "human"}; both fields are required')
        if (typeof env.waive === 'function') await env.waive(exec.agent, 'test_req_required', args.waiver, { caseId: slugify(args.title) })
      }
      if (automated) {
        requireStrings(args, ['testPath', 'runCommand'])
      } else if (typeof args.reason !== 'string' || args.reason.trim() === '') {
        throw new Refusal('DOCUMENTED_REQUIRES_REASON', 'automated:false needs a `reason` naming why this case cannot be a test')
      }
      const source = args.source === 'human' ? 'human' : 'agent'
      const checks = normalizeChecks(args.checks)
      if (automated !== true && checks.length > 0) {
        throw new Refusal('CHECKS_REQUIRE_AUTOMATED', 'checks are evaluated by case_run; a documented-only case has no command to run')
      }
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
        reqId,
        authorRole,
        ...(checks.length > 0 ? { checks } : {}),
        ...(typeof args.negativeControl === 'string' && args.negativeControl !== '' ? { negativeControl: args.negativeControl } : {}),
        revision: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: exec.agent?.session?.header?.agentPreset ?? 'agent',
        createdByKind: 'agent',
        history: [],
        evidence: {},
      }
      const path = writeCase(dir, record)
      const testMirror = await mirror(exec.agent, record)
      return { ok: true, case: summary(record), path: relative(workspace, path), ...(testMirror === null ? {} : { testMirror }) }
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
      reqId: { type: 'string' }, authorRole: { type: 'string' },
      fixture: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
      surfaceFiles: { type: 'array', items: { type: 'string' } },
      negativeControl: { type: 'string', description: 'Driver control name for a measured red (pass an empty string to clear it).' },
      checks: {
        type: 'array',
        description: 'Replace the typed checks case_run evaluates (an empty array clears them).',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            name: { type: 'string' }, metric: { type: 'string' },
            op: { type: 'string', enum: ['<=', '>=', '<', '>', '==', '!='] },
            threshold: { type: 'number' }, expected: { type: 'string' },
            baseline: { type: 'boolean' }, band: { type: 'number' }, unit: { type: 'string' },
          },
        },
      },
    },
    output: OUTPUT,
    execute: (args, exec) => guarded(async () => {
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
      if (Array.isArray(args.checks)) next.checks = normalizeChecks(args.checks)
      if (typeof args.negativeControl === 'string') {
        if (args.negativeControl === '') delete next.negativeControl
        else next.negativeControl = args.negativeControl
      }
      if (typeof args.automated === 'boolean') next.automated = args.automated
      if (typeof args.reqId === 'string' && args.reqId.trim() !== '') next.reqId = args.reqId.trim()
      if (typeof args.authorRole === 'string' && args.authorRole.trim() !== '') next.authorRole = args.authorRole.trim()
      if (next.automated === true && (typeof next.testPath !== 'string' || next.testPath.trim() === '' || typeof next.runCommand !== 'string' || next.runCommand.trim() === '')) {
        throw new Refusal('AUTOMATED_REQUIRES_TEST', 'automated:true needs testPath and runCommand')
      }
      if (next.automated === false && (typeof next.reason !== 'string' || next.reason === '')) {
        throw new Refusal('DOCUMENTED_REQUIRES_REASON', 'automated:false needs a reason')
      }
      if (next.automated !== true && Array.isArray(next.checks) && next.checks.length > 0) {
        throw new Refusal('CHECKS_REQUIRE_AUTOMATED', 'checks are evaluated by case_run; a documented-only case has no command to run')
      }
      // Attribution comes from the INVOCATION, not from a caller-supplied field: a tool call is
      // an agent edit, the panel command passes actor 'human'. `source` records who stated the
      // requirement; it is not evidence that a human edited this revision.
      const editedBy = exec.actor === 'human' ? 'human' : 'agent'
      next.revision = existing.revision + 1
      next.updatedAt = new Date().toISOString()
      next.history = [...(existing.history ?? []), { revision: existing.revision, at: existing.updatedAt, editedBy, snapshot: { title: existing.title, requirement: existing.requirement, expected: existing.expected, steps: existing.steps, automated: existing.automated, testPath: existing.testPath, runCommand: existing.runCommand, reason: existing.reason, status: existing.status, checks: existing.checks ?? [], negativeControl: existing.negativeControl ?? null } }]
      // ANY change to the requirement or the automation/test binding invalidates the previous
      // verification: the evidence no longer covers the case. The case goes stale and its
      // evidence is dropped, so a later verify must produce red+green again.
      const bindingChanged = next.automated !== existing.automated
        || next.testPath !== existing.testPath
        || next.runCommand !== existing.runCommand
      const checksChanged = JSON.stringify(next.checks ?? []) !== JSON.stringify(existing.checks ?? [])
      if (next.requirement !== existing.requirement || bindingChanged || checksChanged) {
        next.status = next.status === 'verified' || next.status === 'failing' || next.status === 'flaky' ? 'stale' : next.status
        next.lastVerified = null
        next.evidence = {}
        // A changed command or test invalidates the recorded red as well: it was observed against
        // bytes this case no longer names. A changed threshold does not (the driver still breaks
        // the same assertion), so the red survives a checks-only edit.
        if (bindingChanged) {
          delete next.redFirst
          next.degraded = next.automated === true ? false : existing.degraded === true
        }
      }
      const path = writeCase(dir, next)
      const testMirror = await mirror(exec.agent, next)
      return { ok: true, case: summary(next), path: relative(workspace, path), ...(testMirror === null ? {} : { testMirror }) }
    }),
  })

  const verify = defineTool({
    name: 'case_verify',
    description: 'Record a MANUAL observation of a case: what you ran and what you saw, stamped source "manual" so it is never presented as a measurement. Automated cases need a red-first run (exitCode != 0) and a green run (exitCode 0) of runCommand; documented-only cases record the observation command/output. Use case_run to execute the stored command instead. Refuses to invent a pass.',
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
      if (plan.redFirst !== null) record.redFirst = plan.redFirst
      if (plan.status === 'verified') {
        record.surfaceFiles = (record.surfaceFiles ?? []).map((entry) => ({ path: entry.path, sha256: fileHash(join(workspace, entry.path)) ?? entry.sha256 }))
      }
      record.revision += 1
      record.updatedAt = new Date().toISOString()
      record.history = [...(record.history ?? []), { revision: record.revision - 1, at: record.updatedAt, editedBy: exec.actor === 'human' ? 'human' : 'agent', action: plan.status === 'verified' ? 'verified-manual' : 'failed-manual', notes: args.notes ?? null }]
      const path = writeCase(dir, record)
      return { ok: true, case: summary(record), evidence: record.evidence, path: relative(workspace, path) }
    }),
  })

  /**
   * EXECUTE the case. The command comes from the RECORD, never from the caller, so a run cannot
   * be aimed at a different command; the measurement (exit code, duration, checks, artifacts)
   * is what the plugin records, not a transcript the model typed.
   */
  const run = defineTool({
    name: 'case_run',
    description: 'Execute a case\'s STORED runCommand and record the measured result: exit code, duration, stdout/stderr under docs/cases/runs/, the driver\'s CASE_SUMMARY checks and its artifacts. A green run with no recorded red is a measurement but NOT a verification (needsRed); mode "red" runs the negative control (CASE_NEGATIVE_CONTROL) and must FAIL. Only this measured evidence reaches status verified; case_verify is the manual report.',
    parameters: {
      id: { type: 'string', required: true },
      expectedRevision: { type: 'number', required: true, description: 'The revision you read. A mismatch is refused, so two runs cannot race a record.' },
      mode: { type: 'string', enum: ['green', 'red'], description: 'green (default) executes the case; red executes its negative control and must FAIL.' },
      runs: { type: 'number', description: 'Repeat the command 1-5 times. A mixed outcome is recorded as flaky; the metrics keep the series with median/p95. Default 1.' },
      timeoutMs: { type: 'number', description: 'Per-run timeout in ms (1000-600000, default 120000). A timeout is a failed run.' },
      control: { type: 'string', description: 'Red only: the control name passed as CASE_NEGATIVE_CONTROL. The driver must break its own assertion when it sees it.' },
      setBaseline: { type: 'boolean', description: 'Seed the ratchet from this passing run: every numeric metric\'s median becomes the baseline.' },
      commit: { type: 'string', description: 'Optional commit you attribute the run to; HEAD and dirty state are recorded automatically.' },
    },
    output: OUTPUT,
    execute: (args, exec) => guarded(async () => {
      requireStrings(args, ['id'])
      const dir = dirFor(exec.agent)
      const workspace = workingDir(exec.agent)
      const { record } = readCase(dir, args.id)
      checkRevision(record, args.expectedRevision)
      if (record.automated !== true) throw new Refusal('NOT_AUTOMATED', `case "${record.id}" is documented-only; it has no command to run`)
      if (record.degraded === true) throw new Refusal('TEST_REQUIRED', 'this case was degraded because its test disappeared; restore the test first')
      if (typeof record.runCommand !== 'string' || record.runCommand.trim() === '') throw new Refusal('TEST_REQUIRED', 'automated case needs a runCommand')
      if (typeof record.testPath !== 'string' || record.testPath === '' || !existsSync(join(workspace, record.testPath))) {
        throw new Refusal('TEST_REQUIRED', `automated case needs its test file present: ${typeof record.testPath === 'string' && record.testPath !== '' ? record.testPath : '(no testPath)'}`)
      }
      const mode = args.mode === 'red' ? 'red' : 'green'
      const control = typeof args.control === 'string' && args.control !== '' ? args.control : (typeof record.negativeControl === 'string' ? record.negativeControl : '')
      if (mode === 'red' && control === '') {
        throw new Refusal('NEGATIVE_CONTROL_REQUIRED', 'a red run needs a control: pass control, or record negativeControl on the case (the driver breaks its own assertion when it receives CASE_NEGATIVE_CONTROL)')
      }
      const attempt = await runAttempts({
        workspace,
        dir,
        record,
        runId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        runs: args.runs,
        timeoutMs: args.timeoutMs,
        mode,
        control,
        exec: executor,
      })
      if (mode === 'red' && attempt.controlHeld !== true) {
        throw new Refusal('NEGATIVE_CONTROL_DID_NOT_FAIL', 'the negative control exited 0 (or timed out); a red run must FAIL for the control to prove the check can fail')
      }
      const folded = recordRun(record, { workspace, attempt, mode, setBaseline: args.setBaseline === true, commit: typeof args.commit === 'string' ? args.commit : null })
      const path = writeCase(dir, folded.record)
      const testMirror = await mirror(exec.agent, folded.record)
      return { ok: true, case: summary(folded.record), verdict: folded.verdict, path: relative(workspace, path), ...(testMirror === null ? {} : { testMirror }) }
    }),
  })

  /**
   * Run every automated case that matches a filter, record each, and write the report a gate or a
   * CI job reads. The suite is a WRITER: it moves every case it ran to its measured status.
   */
  const suite = defineTool({
    name: 'case_suite',
    description: 'Execute every automated case matching a filter (tag/kind/status), record each run, write docs/cases/runs/suites/<suiteId>.json and return the per-case verdicts. A case that is not verified makes the suite not green; the report is the artifact a gate or a CI job reads.',
    parameters: {
      tag: { type: 'string' }, kind: { type: 'string', enum: KINDS }, status: { type: 'string', enum: STATUSES },
      runs: { type: 'number', description: 'Runs per case, 1-5. Default 1.' },
      timeoutMs: { type: 'number' }, commit: { type: 'string' },
    },
    output: OUTPUT,
    execute: (args, exec) => guarded(async () => {
      const dir = dirFor(exec.agent)
      const workspace = workingDir(exec.agent)
      const rows = readCases(dir)
      const candidates = rows.filter((row) => row.record !== undefined
        && row.record.automated === true
        && !CLOSED.has(row.record.status)
        && (args.tag === undefined || (row.record.tags ?? []).includes(args.tag))
        && (args.kind === undefined || row.record.kind === args.kind)
        && (args.status === undefined || row.record.status === args.status))
      if (candidates.length === 0) throw new Refusal('EMPTY_SUITE', 'no automated case matches this filter')
      const suiteId = `suite-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      const results = []
      for (const row of candidates) {
        const record = row.record
        const attempt = await runAttempts({ workspace, dir, record, runId: `${suiteId}-${record.id}`, runs: args.runs, timeoutMs: args.timeoutMs, exec: executor })
        const folded = recordRun(record, { workspace, attempt, commit: typeof args.commit === 'string' ? args.commit : null })
        writeCase(dir, folded.record)
        results.push({ id: record.id, status: folded.verdict.status, runId: folded.verdict.runId, passed: folded.verdict.passed, flaky: folded.verdict.flaky, needsRed: folded.verdict.needsRed === true, checks: folded.verdict.checks })
      }
      const failed = results.filter((entry) => entry.status !== 'verified')
      const reportDir = join(dir, 'runs', 'suites')
      const reportPath = join(reportDir, `${suiteId}.json`)
      mkdirSync(reportDir, { recursive: true })
      writeFileSync(reportPath, `${JSON.stringify({ suiteId, at: new Date().toISOString(), filter: { tag: args.tag ?? null, kind: args.kind ?? null, status: args.status ?? null }, checked: results.length, verified: results.length - failed.length, failed: failed.length, cases: results }, null, 2)}\n`, 'utf8')
      try {
        const reports = readdirSync(reportDir).filter((name) => name.endsWith('.json')).sort()
        for (const name of reports.slice(0, Math.max(0, reports.length - 50))) rmSync(join(reportDir, name), { force: true })
      } catch {
        // Derived reports; a failed prune is not a failed suite.
      }
      return { ok: true, suiteId, checked: results.length, verified: results.length - failed.length, failed: failed.length, green: failed.length === 0, cases: results, report: relative(workspace, reportPath) }
    }),
  })

  /**
   * The read-only verdict the taskboard also enforces on close: an AUTOMATED case linked to the
   * task that is not verified blocks acceptance. Documented-only cases never block.
   */
  const gate = defineTool({
    name: 'case_gate',
    description: 'Read-only verdict for a task or a case: which linked AUTOMATED cases are not verified (status + provenance). The taskboard refuses task_close on the same rule; use this before accepting work. Documented-only cases never block.',
    parameters: {
      taskId: { type: 'string', description: 'Check every automated case linked to this task id.' },
      id: { type: 'string', description: 'Check one case.' },
    },
    output: OUTPUT,
    execute: (args, exec) => guarded(() => {
      if (typeof args.taskId !== 'string' && typeof args.id !== 'string') throw new Refusal('INVALID_CASE', 'pass taskId or id')
      const rows = readCases(dirFor(exec.agent))
      const verdict = blockersFor(rows, { taskId: args.taskId, id: args.id })
      return { ok: verdict.blockers.length === 0, taskId: args.taskId ?? null, caseId: args.id ?? null, checked: rows.length, ...verdict }
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
      const rows = readCases(dirFor(exec.agent))
      const cases = rows.filter((row) => row.record !== undefined).map((row) => row.record)
      const counts = {}
      for (const record of cases) counts[record.status] = (counts[record.status] ?? 0) + 1
      const filtered = cases.filter((record) => (args.status === undefined || record.status === args.status)
        && (args.kind === undefined || record.kind === args.kind)
        && (args.source === undefined || record.source === args.source)
        && (args.automated === undefined || record.automated === args.automated)
        && (args.tag === undefined || (record.tags ?? []).includes(args.tag)))
      filtered.sort((a, b) => String(a.id).localeCompare(String(b.id)))
      const unreadable = rows.filter((row) => row.error !== undefined).map((row) => ({ id: row.id, code: row.error }))
      return { ok: true, total: filtered.length, library: cases.length, counts, cases: filtered.map(summary), unreadable }
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
        // A status of null means the case is not in a state that can go stale (unverified,
        // superseded, deprecated). A missing test is still reported in the finding, but it must
        // not rewrite a record that never verified anything.
        if (missingTest && result.status !== null && !alreadyDegraded) {
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
      appendAudit(dir, '.removed.jsonl', audit)
      removeCaseFile(dir, record.id)
      return { ok: true, removed: audit, path: relative(workspace, path) }
    }),
  })

  return { case_record: record, case_update: update, case_verify: verify, case_run: run, case_suite: suite, case_gate: gate, case_list: list, case_get: get, case_supersede: supersede, case_deprecate: deprecate, case_remove: remove, case_drift: drift }
}

/** The full prompt section: the rule that makes the library worth trusting. */
export const SECTION_FULL = [
  'TEST CASES (docs/cases/, host tool family):',
  '  Explore with your own tools first and OBSERVE the behaviour, then persist the case. Never record a speculative test.',
  '  Record ONE case per accepted behaviour, not per requirement: one verified run may prove several requirements at once. The case keeps its primary reqId - the requirement it protects - and names the other REQs in its text; the schema does not grow a reqIds field.',
  '  case_run EXECUTES an automated case\'s stored runCommand and records the MEASUREMENT (exit code, duration, checks, artifacts under docs/cases/runs/). Declare checks on the case - {metric, op, threshold} reads the driver\'s CASE_SUMMARY JSON, {baseline: true} ratchets against the recorded baseline, runs>1 gives median/p95 and records a mixed outcome as flaky.',
  '  A green run on a case with no recorded red is a measurement, not a verification: record the negative control with case_run mode:"red" (the driver breaks its own assertion on CASE_NEGATIVE_CONTROL), or use case_verify, which is the MANUAL report and is stamped source manual.',
  '  case_suite runs a filtered set and writes a report; case_gate reads whether the automated cases linked to a task are verified (the taskboard refuses task_close on the same rule).',
  '  The library is compare-and-set: read the case (case_get), pass expectedRevision on every edit/run, and supersede/deprecate instead of deleting. A changed surface file or a missing test makes a case stale; it never erases the requirement.',
].join('\n')

/**
 * The INTAKE section, for a role that was granted only record/list/get/drift/gate.
 *
 * WHY TWO SECTIONS. The orchestrator records what the human states and reads the library; it
 * cannot verify (no case_verify), edit (no case_update) or close (no supersede/deprecate). The
 * full section named verbs it does not have and described a red-first ritual it cannot run, so
 * the prompt was teaching an agent to call tools that are not registered — the one instruction
 * a model cannot follow and cannot report. The text below names exactly what is on its surface.
 */
export const SECTION_INTAKE = [
  'TEST CASES (docs/cases/, intake subset):',
  '  One case per accepted behaviour, not per requirement: a case may name several requirements (REQs) while its primary reqId is the one it protects. One verified run can prove the batch.',
  '  Your surface is intake only: case_record, case_list, case_get, case_drift, case_gate. Recording is NOT verifying - you have no case_run, case_verify or case_update, so never claim a case passed.',
  '  When the human states a requirement, record it with case_record: source human, automated:false with a named reason (or a real testPath + runCommand + checks when one exists), and linkedTaskId of the task that implements it. Leave the status unverified.',
  '  Read with case_get (compare-and-set needs its revision) and case_list; case_gate is the same verdict the taskboard enforces on task_close. Verification belongs to the specialist that owns the work, in its own session.',
].join('\n')

/**
 * Register the tools.
 *
 * @param ctx - Host context; needs `tools` and (optionally) `systemPrompt`.
 * @param config - See the file contract.
 */
export function apply(ctx, config = {}) {
  // The harness executor when the host mounted it (sandbox, caps, timeout); the runner falls back
  // to its own sh -c when it is absent (tests, a bare profile). The command still comes from the
  // case, never from the caller.
  let shell
  try {
    shell = ctx.get('shell')
  } catch {
    shell = undefined
  }
  // THE PROJECT STATE CORE IS OPTIONAL. With `ccProjectState` mounted every written case is
  // mirrored into state/test/ (found again by caseId) and the projections are regenerated.
  const mirrorQueue = new Map()
  const coreOf = () => {
    try {
      return ctx.get?.('ccProjectState')
    } catch {
      return undefined
    }
  }
  const scheduleMirror = (agent, record) => {
    const core = coreOf()
    if (core === undefined || core === null) return null
    const cwd = workingDir(agent)
    const run = async () => {
      try {
        const result = await mirrorCase(core, { cwd, record })
        const state = typeof core.open === 'function' ? core.open(cwd) : core
        if (typeof state.regenerateViews === 'function') await state.regenerateViews()
        if (result.ok === false) ctx.logger?.warn?.(`test-cases: TEST mirror for ${record.id} failed: ${result.code ?? 'unknown'}`)
        return result
      } catch (error) {
        ctx.logger?.warn?.(`test-cases: TEST mirror for ${record.id} threw: ${error instanceof Error ? error.message : String(error)}`)
        return { ok: false, code: 'mirror_failed' }
      }
    }
    const previous = mirrorQueue.get(cwd) ?? Promise.resolve()
    mirrorQueue.set(cwd, previous.then(run, run))
    return mirrorQueue.get(cwd)
  }
  const waive = async (agent, code, waiver, meta = {}) => {
    const core = coreOf()
    if (core === undefined || core === null || typeof core.journal !== 'function') return
    try {
      const state = typeof core.open === 'function' ? core.open(workingDir(agent)) : core
      await state.journal({ code, reason: String(waiver?.reason ?? ''), by: 'human', ...meta })
    } catch {
      // The waiver is recorded on a best-effort basis; the operation already passed its gate.
    }
  }
  const tools = createTools(config, { shell, waive, mirror: (agent, record) => scheduleMirror(agent, record) })
  // THE TASKBOARD'S READ. A workspace without this row keeps its legacy close behaviour: the
  // taskboard looks the service up with ctx.get('cases') and skips the gate when it is absent.
  const providedCases = ctx.provide('cases', {
    gateForTask: (cwd, taskId) => gateForTask(cwd, taskId, config),
    flushMirror: async (cwd) => { await (mirrorQueue.get(cwd) ?? Promise.resolve()) },
  })
  if (typeof ctx.effect === 'function') ctx.effect(() => providedCases)
  const policy = config.roles !== null && typeof config.roles === 'object' ? config.roles : DEFAULT_ROLE_TOOLS
  const showSection = config.shownInPrompt !== false
  installCaseGate(ctx, { policy, tools, showSection })

  // THE PANEL'S DOOR. The human's panel is not a tool caller, so the same verbs are exposed
  // as one `/test-cases` JSON command. It executes the very same tool objects (and therefore
  // the same schema, CAS and writer); it never edits docs/cases/ itself.
  const COMMANDS = {
    list: 'case_list', detail: 'case_get', get: 'case_get', update: 'case_update',
    verify: 'case_verify', run: 'case_run', suite: 'case_suite', gate: 'case_gate',
    deprecate: 'case_deprecate', remove: 'case_remove', drift: 'case_drift',
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
      if (toolName === undefined) return { kind: 'error', text: 'test-cases: unknown op (list | detail | update | verify | run | suite | gate | deprecate | remove | drift)' }
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
