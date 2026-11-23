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
 *   WHOSE EVIDENCE IT IS. A case records WHO wrote it (`authorPreset`, `authorSessionId`, taken
 *   from the calling session - an agent cannot name another author) and WHO ran it (`runBy` on
 *   every measured run). It is either an ACCEPTANCE case (it can close a task) or an
 *   IMPLEMENTATION case (the implementer's own test, useful, never acceptance). Only a case that
 *   is automated, `verified` by the RUNNER, written by one preset and run by another, and whose
 *   test file still hashes to the recorded value can close a task; the taskboard asks the same
 *   rule through `gateForTask`. A manual observation of an automated case no longer verifies it:
 *   it records what was seen and leaves the case unverified (D-NO-NEW-STATUS).
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
 *   - `case_verify` on an automated case records a MANUAL observation: a pass leaves the status
 *     unverified (a measured run is what verifies), a failure is `failing`. A documented-only
 *     case is unchanged: its observation is all the evidence it can have.
 *   - `case_update` is the AUTHOR's or a human's: an agent that is not the recorded author gets
 *     `AUTHOR_ONLY`, and no agent may change `authorPreset`/`authorRole` (`AUTHOR_IMMUTABLE`).
 *     A changed expected/steps/checks/surfaceFiles/automation drops the verification (`stale`);
 *     switching automation OFF or an acceptance case to `implementation` is refused to an agent
 *     (`AUTOMATED_IMMUTABLE`/`PURPOSE_IMMUTABLE`) and needs a human waiver otherwise.
 *   - `case_run` and `case_suite` execute only the test file the case recorded: no `testHash` is
 *     `TEST_HASH_MISSING` (re-record the case), different bytes are `TEST_CHANGED`.
 *   - a superseded/deprecated case is CLOSED: edits, runs and verifications refuse `CASE_CLOSED`.
 *   - drift on a FLAGGABLE case (verified/failing/flaky) whose test file is gone degrades it to
 *     automated:false with a reason and status stale; an unverified case reports the change
 *     without claiming a regression, and the requirement stays.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { acceptanceOf, gateRows, isAcceptanceCase, purposeOf } from './lib/acceptance.mjs'
import { appendCaseEvent, checkCase } from './lib/journal.mjs'
import { driftFor, fileHash, slugify, testHashOf, testHashState, textHash } from './lib/schema.mjs'
import { normalizeChecks } from './lib/checks.mjs'
import { gitState, recordRun, runAttempts, shellExec, spawnExec } from './lib/runner.mjs'
import { mirrorCase } from './mirror.mjs'
import { Refusal, appendAudit, libraryDir, readCase, readCases, removeCaseFile, safeCaseId, writeCase } from './lib/store.mjs'

export { driftFor, slugify, safeCaseId, readCase, writeCase }

export const name = 'test-cases'
export const inject = ['tools', 'systemPrompt', 'commands']

/** Tools every tester role gets: the full library, including execution and evidence. */
export const ALL_TOOLS = ['case_record', 'case_update', 'case_verify', 'case_run', 'case_suite', 'case_gate', 'case_list', 'case_get', 'case_supersede', 'case_deprecate', 'case_remove', 'case_drift']
/** The root intake set: record a human requirement, read the library and check the gate; never claim a run. */
export const INTAKE_TOOLS = ['case_record', 'case_list', 'case_get', 'case_drift', 'case_gate']

/**
 * Per-preset tool policy.
 *
 * WHY ROLE-AWARE AT ALL. The human states requirements in chat; the orchestrator is the intake
 * point, so it must be able to record a case (source human, status unverified) and read the
 * library - but it must not be able to claim a verification it never ran. The role that owns
 * the work (backend) also repairs the case: it has case_update and case_verify, because a case
 * whose text is wrong is the owner's to fix, and a manual observation is theirs to record. A
 * role that JUDGES the change (reviewer) may record an observation but never edits the case it
 * judges; the role that attacks it (critic) only reads and runs. ux, research and docs cite
 * cases, so they keep the narrow sets below.
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
        // The text follows the SAME row that registers the tools: a section that names a verb the
        // role does not have is an instruction it can neither follow nor report.
        text: sectionText(granted),
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
  backend: ['case_record', 'case_update', 'case_verify', 'case_run', 'case_suite', 'case_get', 'case_list'],
  reviewer: ['case_get', 'case_list', 'case_run', 'case_gate', 'case_verify'],
  critic: ['case_get', 'case_list', 'case_run'],
  // The independent acceptance tester: it authors and runs cases and never edits the case it
  // judged against its own implementation. The full set minus removal: a case is superseded, not
  // deleted, and the tester is not the one who forgets evidence.
  tester: ['case_record', 'case_update', 'case_verify', 'case_run', 'case_suite', 'case_gate', 'case_list', 'case_get', 'case_supersede', 'case_deprecate'],
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

/**
 * Who is calling, taken from the INVOCATION and never from a caller-supplied field.
 *
 * WHY IT IS NOT A PARAMETER. `authorPreset` used to be part of the case text with nothing
 * checking it, so a case could be recorded under any author and then edited under any other: the
 * one field that makes an independent verification possible was a free-text field. The preset
 * comes from the session (the tool-families resolution when the host mounts it, the creation
 * header otherwise), the session id from the session; a human acting through the panel may name
 * the author, because the human is the only one who can know it.
 *
 * @returns `{ authorPreset, authorSessionId, human }`; `authorPreset` falls back to `agent` for
 *   a session with no preset, the value the record always used.
 */
function callerIdentity(exec, env, args) {
  const human = exec !== null && typeof exec === 'object' && exec.actor === 'human'
  const session = exec?.agent?.session
  const header = session?.header ?? {}
  const sessionId = typeof session?.id === 'string' && session.id !== '' ? session.id : null
  let preset = ''
  try {
    const resolved = typeof env?.presetFor === 'function' ? env.presetFor(exec?.agent) : undefined
    if (typeof resolved === 'string') preset = resolved.trim()
  } catch {
    preset = ''
  }
  if (preset === '' && typeof header.agentPreset === 'string') preset = header.agentPreset.trim()
  const named = typeof args?.authorPreset === 'string' ? args.authorPreset.trim() : ''
  if (!human) {
    // An agent that names an author other than itself is forging provenance; one that names its
    // own preset gains nothing, so both go through the session value.
    if (named !== '' && preset !== '' && named !== preset) {
      throw new Refusal('AUTHOR_IMMUTABLE', `authorPreset comes from the calling session (${preset}); an agent cannot record or edit a case under a different author`)
    }
    return { authorPreset: preset === '' ? 'agent' : preset, authorSessionId: sessionId, human }
  }
  return { authorPreset: named !== '' ? named : (preset === '' ? 'human' : preset), authorSessionId: sessionId, human }
}

/**
 * Resolve the directory a run or an observation executes in.
 *
 * WHY IT EXISTS. A red-first pair only means something when both runs happened in a tree that
 * contains the change under test. Without a recorded directory, the honest red - the one taken
 * in a COPY of the tree at the previous commit - had nowhere to be written, so the red and the
 * green of one case could have been observed in two different trees and the record could not
 * tell. `value` is absolute or relative to the session workspace; absent means the workspace,
 * which is what a run in this checkout is.
 */
function resolveCwd(workspace, value) {
  if (value === undefined || value === null || value === '') return { cwd: workspace, cwdRelative: '.' }
  if (typeof value !== 'string') throw new Refusal('CWD_INVALID', 'cwd must be a string: an absolute path, or one relative to the session workspace')
  if (value.trim() === '') return { cwd: workspace, cwdRelative: '.' }
  const cwd = resolve(workspace, value)
  let stat
  try {
    stat = statSync(cwd)
  } catch {
    throw new Refusal('CWD_NOT_FOUND', `cwd does not exist: ${cwd}`)
  }
  if (!stat.isDirectory()) throw new Refusal('CWD_NOT_FOUND', `cwd is not a directory: ${cwd}`)
  return { cwd, cwdRelative: relative(workspace, cwd).split('\\').join('/') || '.' }
}

/**
 * Refuse a command pinned to one checkout by an absolute path.
 *
 * `cd /home/me/repo && node --test test/x.test.mjs` reads as reproducible and is not: run from a
 * copy of the tree it still executes the ORIGINAL one, so the case can never go red for a change
 * made in the copy - it is the one shape that makes an honest red impossible to record. The
 * command must be relative and the directory comes from the run itself (`cwd`), which the run
 * record stores next to the command.
 */
export function pinnedCommand(command) {
  const text = String(command ?? '')
  // Both shapes are refused: a leading `cd` into an absolute path (POSIX, drive letter or home),
  // and an absolute path anywhere in the command (`node --test /home/me/x.test.mjs`).
  const cdAbsolute = /^\s*(?:cd|pushd)\s+(?:"|')?(?:\/|[A-Za-z]:[\\/]|~)/.test(text)
  const absolute = /(?:^|[\s"'=(])(?:\/(?!\/)|[A-Za-z]:[\\/])/.test(text)
  if (!cdAbsolute && !absolute) return null
  return {
    code: 'PINNED_COMMAND',
    reason: cdAbsolute ? 'it starts with `cd` into an absolute path' : 'it contains an absolute path',
    hint: 'make the command RELATIVE and pass the directory as cwd - case_run { cwd: "<abs or workspace-relative path>" }; e.g. "node --test test/x.test.mjs" with cwd, instead of "cd /abs/tree && node --test test/x.test.mjs"',
  }
}

/** Throw when a command is pinned to one checkout. */
function checkPinned(command, label) {
  const pinned = pinnedCommand(command)
  if (pinned !== null) {
    throw new Refusal(pinned.code, `${label} is pinned to one tree: ${pinned.reason}. ${pinned.hint}`)
  }
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
function requireEvidence(evidence, label, workspace = process.cwd()) {
  if (evidence === null || typeof evidence !== 'object') throw new Refusal('EVIDENCE_REQUIRED', `${label} evidence is required: { command, output, exitCode, at?, cwd? }`)
  for (const field of ['command', 'output']) {
    if (typeof evidence[field] !== 'string' || evidence[field].trim() === '') throw new Refusal('EVIDENCE_REQUIRED', `${label} evidence needs \`${field}\``)
  }
  if (!Number.isInteger(evidence.exitCode)) throw new Refusal('EVIDENCE_REQUIRED', `${label} evidence needs an integer \`exitCode\``)
  // WHERE the observation was taken travels with it, exactly as it does for a measured run: an
  // observation taken in a copy of the tree and one taken in this checkout are not the same claim.
  const tree = resolveCwd(workspace, evidence.cwd)
  return {
    command: evidence.command,
    output: String(evidence.output).slice(0, 8000),
    exitCode: evidence.exitCode,
    at: typeof evidence.at === 'string' && evidence.at !== '' ? evidence.at : new Date().toISOString(),
    cwd: tree.cwd,
    cwdRelative: tree.cwdRelative,
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
    purpose: purposeOf(record.purpose),
    authorPreset: record.authorPreset ?? record.createdBy ?? null,
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
 * Decide what a MANUAL observation is admissible as, and what the case becomes.
 *
 * This is the reported half of the evidence: a human or an agent typed what it observed, so the
 * result is stamped `source: 'manual'` and the tool surfaces say so. `case_run` is the measured
 * half: it executes the stored command and the plugin produces the numbers.
 *
 * ON AN AUTOMATED CASE A MANUAL PASS VERIFIES NOTHING (D-NO-NEW-STATUS). It is recorded as an
 * observation - command, output, exit code, directory and time - and the case stays unverified,
 * because "I saw it pass" is exactly the claim a self-verifying implementer can make without
 * running anything. A manual FAILURE is still a finding: it sets `failing`, and a case that only
 * ever fails is not one a gate can accept. A case already verified BY THE RUNNER keeps that
 * verification: a later observation cannot take away a measurement.
 */
export function verificationPlan(record, args, workspace) {
  if (typeof args.passed !== 'boolean') throw new Refusal('EVIDENCE_REQUIRED', 'passed must be true or false')
  const evidence = requireEvidence(args.evidence, 'verification', workspace)
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
      if (evidence.exitCode !== 0) throw new Refusal('EVIDENCE_NOT_GREEN', 'the observed pass must have exitCode 0')
      // The observed red is still worth keeping when the caller has one - it is evidence of the
      // failure that was fixed - but it is not what makes this case verified, and its absence is
      // no longer an error: the observation cannot verify anything either way.
      const red = args.redFirst === undefined || args.redFirst === null ? null : requireEvidence(args.redFirst, 'red-first', workspace)
      if (red !== null && red.command.trim() !== runCommand) {
        throw new Refusal('COMMAND_MISMATCH', `redFirst.command must be the case's runCommand (${runCommand})`)
      }
      if (red !== null && red.exitCode === 0) throw new Refusal('RED_FIRST_REQUIRED', 'red-first evidence must show the test FAILING (non-zero exit) before the fix')
      const measured = record.lastVerified !== null && typeof record.lastVerified === 'object' && record.lastVerified.source === 'runner'
      return {
        evidence: {
          observation: { ...evidence, passed: true, source: 'manual' },
          ...(red === null ? {} : { redFirst: { ...red, source: 'manual' } }),
          commit: args.commit ?? null,
          source: 'manual',
        },
        redFirst: red === null ? undefined : { ...red, source: 'manual' },
        status: measured ? record.status : 'unverified',
        lastVerified: measured ? record.lastVerified : null,
        action: 'observed-manual',
        note: measured
          ? 'observed manually; the case keeps its measured verification'
          : 'observed manually; a manual pass does not verify an automated case - run it with case_run',
      }
    }
    return {
      evidence: { run: { ...evidence, passed: false, source: 'manual' }, redFirst: null, commit: args.commit ?? null, source: 'manual' },
      redFirst: null,
      status: 'failing',
      lastVerified: null,
      action: 'failed-manual',
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
    action: args.passed ? 'verified-manual' : 'failed-manual',
  }
}

/**
 * The acceptance rule: every AUTOMATED ACCEPTANCE case linked to this task (or this case) must
 * pass `acceptanceOf`, and each one is returned with its provenance either way.
 *
 * WHAT REPLACED "status is verified". That single test accepted a case its own implementer had
 * just recorded and confirmed, a case verified before anyone recorded who ran it, and a case
 * whose test file had been rewritten after the run. The rule now lives in
 * `lib/acceptance.mjs` so the taskboard, `case_gate` and the CLI read one implementation.
 *
 * `implementerPreset` is the preset of the session that DOES the task. Without it the gate cannot
 * establish independence and refuses: an unknown implementer is not an independent one.
 */
function acceptanceFor(rows, options = {}) {
  // One implementation, shared with the CLI: see lib/acceptance.mjs (gateRows) for the difference
  // between a task that NAMES its cases (caseIds) and a legacy row scanned by linkedTaskId.
  return gateRows(rows, options)
}

/**
 * The read-only gate the taskboard consumes (`ctx.provide('cases', …)`).
 *
 * `context.implementerPreset` is the preset of the session that does the task, read from the
 * taskboard row by the caller. It is optional so an older caller still compiles, and a missing
 * value FAILS CLOSED: every acceptance case blocks with `IMPLEMENTER_UNKNOWN` instead of passing
 * because nothing was compared.
 */
export function gateForTask(cwd, taskId, context = {}) {
  const dir = libraryDir(cwd, context)
  const rows = readCases(dir)
  // THE JOURNAL IS PART OF READING THE LIBRARY. A case file that changed without a recorded write
  // is reported as an error (which the taskboard turns into `cases_unreadable`, a refusal): a gate
  // that cannot trust the bytes must not answer green.
  const journalErrors = []
  // `dir` may be the relative library path from the config: the journal lives beside the files, so
  // the check resolves it once against the workspace instead of against the process cwd.
  const absDir = isAbsolute(dir) ? dir : resolve(cwd, dir)
  for (const row of rows) {
    if (row?.record === undefined || row.record === null) continue
    const status = checkCase(absDir, row.record.id, join(absDir, `${row.record.id}.json`))
    if (status.status === 'mismatch' || status.status === 'broken') journalErrors.push({ id: row.record.id, code: 'CASE_JOURNAL_MISMATCH', message: status.detail ?? 'the case does not match its journal' })
  }
  const { blockers, evidence, errors: gateErrors, ok: gateOk, linked } = acceptanceFor(rows, {
    taskId,
    workspace: cwd,
    dir,
    implementerPreset: context?.implementerPreset,
    knownPresets: context?.knownPresets,
    // THE ROW OWNS THE LINK. Without this, deleting a case file silently satisfies the task.
    ...(Array.isArray(context?.caseIds) ? { caseIds: context.caseIds } : {}),
    // P1 residual (S4): an INDEPENDENT task counts only a case whose realism an independent party
    // signed; a proof/case task does not ask for that judgement.
    ...(typeof context?.verification === 'string' && context.verification === 'independent' ? { requireRealismSignoff: true } : {}),
  })
  // A hand-edited case is refused as evidence for an INDEPENDENT task (the level whose acceptance
  // rests on the library) and reported for every other question: a proof task's close must not
  // fail because some unrelated file was edited by hand. `case_get` refuses the edit either way.
  const verification = typeof context?.verification === 'string' ? context.verification.trim() : ''
  const errors = [...gateErrors, ...(verification === 'independent' ? journalErrors : [])]
  const ok = gateOk && (verification !== 'independent' || journalErrors.length === 0)
  const base = {
    ok,
    blockers,
    evidence,
    errors,
    // Present only when the question came from a row that NAMES its cases: the caller can then
    // tell "this task owes no case" (an empty list) from "this row predates the link".
    ...(Array.isArray(linked) ? { linked } : {}),
    ...(journalErrors.length === 0 ? {} : { journal: journalErrors }),
    implementerPreset: typeof context?.implementerPreset === 'string' && context.implementerPreset !== '' ? context.implementerPreset : null,
  }

  // P2: CRITERIA COVERAGE, ONLY FOR A TASK WHOSE LEVEL ASKS FOR IT.
  //   `proof` and `case` close on the owner's own proof: the taskboard does not even call this gate
  //   for them. `independent` closes only when EVERY criterion has an ACCEPTABLE case that names
  //   it (`criterionId`), because "a case exists" and "the claim was checked" are different facts.
  //   A row with no level (written before P2) keeps the pre-P2 answer exactly.
  if (verification !== 'independent') return base
  const criteria = (Array.isArray(context?.criteria) ? context.criteria : [])
    .filter((criterion) => criterion !== null && typeof criterion === 'object' && typeof criterion.id === 'string' && criterion.id.trim() !== '')
    .map((criterion) => ({ id: criterion.id.trim(), text: typeof criterion.text === 'string' ? criterion.text : '' }))
  if (criteria.length === 0) {
    return {
      ...base,
      ok: false,
      code: 'CRITERIA_REQUIRED',
      coverage: [],
      message: `this task is level "independent" and states no acceptance criteria: with nothing to cover, "another preset checked it" cannot be judged. Add the criteria (task_update criteria) or lower the level to proof/case`,
    }
  }
  const caseById = new Map()
  for (const row of rows) {
    if (row !== null && typeof row === 'object' && row.record !== undefined && row.record !== null && typeof row.record.id === 'string') caseById.set(row.record.id, row.record)
  }
  const blockedIds = new Set(blockers.map((blocker) => blocker?.id).filter((id) => typeof id === 'string'))
  const acceptable = evidence.map((entry) => entry?.id).filter((id) => typeof id === 'string' && !blockedIds.has(id))
  const coverage = criteria.map((criterion) => {
    const covering = acceptable.find((caseId) => caseById.get(caseId)?.criterionId === criterion.id)
    return { id: criterion.id, text: criterion.text, covered: covering !== undefined, caseId: covering ?? null }
  })
  const uncovered = coverage.filter((entry) => entry.covered !== true)
  if (uncovered.length === 0) return { ...base, verification, ok: base.ok, code: undefined, coverage }
  const described = uncovered.map((entry) => `${entry.id}${entry.text === '' ? '' : ` (${entry.text})`}`)
  return {
    ...base,
    ok: false,
    verification,
    code: 'CRITERIA_UNCOVERED',
    coverage,
    message: `not every acceptance criterion is covered by an acceptable case: ${described.join(', ')}; a case covers a criterion only when it names it (criterionId) and it is acceptable evidence (measured, independent, not stale). Record a case for each missing criterion`,
  }
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
  /** The presets a case may name: the rows of the same tool policy, never a free-text value. */
  const knownPresets = Object.keys(config.roles !== null && typeof config.roles === 'object' ? config.roles : DEFAULT_ROLE_TOOLS)
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
    description: 'Persist ONE observed test case in docs/cases/. Use after exploring and reproducing the behaviour, never to speculate. automated:true REQUIRES testPath + runCommand (a real test file and the exact command) and freezes the test file hash; automated:false REQUIRES a reason (why it cannot be a test) plus steps and expected. The AUTHOR is taken from the calling session (an agent cannot name another one). purpose:"acceptance" (default) can close a task; "implementation" is your own test and never closes one. source:human records a requirement stated by the human (status unverified, no verification claimed).',
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
      authorPreset: { type: 'string', description: 'The preset that authors the case. An agent should OMIT it: the plugin takes the calling session\'s preset and refuses a different value (AUTHOR_IMMUTABLE). A human using the panel may name the author.' },
      purpose: { type: 'string', enum: ['acceptance', 'implementation'], description: 'acceptance (default) is evidence for closing a task; implementation is the implementer\'s own test and never closes one.' },
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
      negativeControl: { type: 'string', description: 'Driver control name for a measured red: the driver must break its own assertion when it receives CASE_NEGATIVE_CONTROL. This is the driver self-check; an acceptance case also needs a wrong-product red (case_run redSource:"wrong-product" in a copy of the previous version).' },
      // REALISM (FR5). A test can pass, fail on demand, and still prove nothing about the product:
      // the trigger may be unreachable, the oracle may restate the implementation. These four
      // fields make the tester state the claim, and the gate returns them with the evidence.
      failsWhen: { type: 'string', description: 'Required for an automated acceptance case: the defect this case must catch, in one sentence (what goes wrong, not where).' },
      trigger: { type: 'string', description: 'Required for an automated acceptance case: the public input or sequence a real user or producer sends that reaches the defect.' },
      oracle: { type: 'string', description: 'Required for an automated acceptance case: where the expected result comes from - the requirement, a contract, a domain invariant - never from reading the implementation.' },
      // P2: the criterion this case covers. The id is the task's own stable id; the close counts
      // criteria, so a case that names none covers none.
      // REALISM SIGN-OFF (P1 residual, S4). Presence of failsWhen/trigger/oracle/realism is
      // checkable; whether the scenario is REAL is a judgement. It is recorded as a sign-off by a
      // preset that did not write the case, and an independent task counts only signed cases.
      realismReviewedBy: { type: 'string', description: 'Who confirmed that the scenario is real (a preset id other than the author, or "human"). Required for an automated acceptance case; a self-sign-off is refused.' },
      realismReviewedAt: { type: 'string', description: 'ISO time of that confirmation, recorded with the case.' },
      criterionId: { type: 'string', description: 'The acceptance criterion this case covers (the id from the task, for example AC-1). An independent task closes only when every criterion has an acceptable case that names it.' },
      realism: { type: 'string', description: 'Required for an automated acceptance case: the source that makes the scenario real - a bug report, a user path, production-shaped data, a contract, a domain invariant.' },
    },
    output: OUTPUT,
    execute: (args, exec) => guarded(async () => {
      requireStrings(args, ['title', 'requirement', 'expected'])
      const kind = KINDS.includes(args.kind) ? args.kind : 'regression'
      const automated = args.automated === true
      // WHO wrote this, and WHAT it is for. Both come from the invocation: the author from the
      // session, the purpose from the caller (default acceptance).
      const caller = callerIdentity(exec, env, args)
      const purpose = purposeOf(args.purpose)
      // FR11: a test belongs to a REQ and names its author. A case without either is refused
      // before the file is written (test_req_required).
      const reqId = typeof args.reqId === 'string' ? args.reqId.trim() : ''
      let authorRole = typeof args.authorRole === 'string' ? args.authorRole.trim() : ''
      if (!caller.human && authorRole !== '') {
        // THE ROLE LABEL IS THE AUTHOR'S TOO. An agent whose preset is backend that writes
        // "orchestrator" as authorRole forges the one field a reader uses to tell the writer from
        // the implementer, so the stored value is the session's preset, not the caller's word.
        if (authorRole.toLowerCase() !== caller.authorPreset.toLowerCase()) {
          throw new Refusal('AUTHOR_IMMUTABLE', `authorRole is the calling session's preset (${caller.authorPreset}); an agent cannot record a case under "${authorRole}"`)
        }
        authorRole = caller.authorPreset
      }
      if (reqId === '' || authorRole === '') {
        if (args.waiver === undefined) throw new Refusal('TEST_REQ_REQUIRED', 'a case needs reqId (the REQ it protects) and authorRole (who wrote it); pass both, or an explicit waiver {reason, by: "human"}')
        if (!validWaiver(args.waiver)) throw new Refusal('WAIVER_REQUIRED', 'a waiver needs {reason, by: "human"}; both fields are required')
        if (typeof env.waive === 'function') await env.waive(exec.agent, 'test_req_required', args.waiver, { caseId: slugify(args.title) })
      }
      if (automated) {
        requireStrings(args, ['testPath', 'runCommand'])
        checkPinned(args.runCommand, 'runCommand')
      } else if (typeof args.reason !== 'string' || args.reason.trim() === '') {
        throw new Refusal('DOCUMENTED_REQUIRES_REASON', 'automated:false needs a `reason` naming why this case cannot be a test')
      }
      const source = args.source === 'human' ? 'human' : 'agent'
      const checks = normalizeChecks(args.checks)
      if (automated !== true && checks.length > 0) {
        throw new Refusal('CHECKS_REQUIRE_AUTOMATED', 'checks are evaluated by case_run; a documented-only case has no command to run')
      }
      // AN AUTOMATED ACCEPTANCE CASE NAMES ITS SURFACE. The test hash pins the test file; the
      // surface list pins the product files the test exercises. A forgotten import is still
      // invisible here - this list is as good as the author's care - but an empty list makes every
      // product change invisible, so it is refused.
      const surfaces = (Array.isArray(args.surfaceFiles) ? args.surfaceFiles : []).filter((path) => typeof path === 'string' && path.trim() !== '')
      if (automated && purpose === 'acceptance' && surfaces.length === 0) {
        throw new Refusal('SURFACE_FILES_REQUIRED', 'an automated acceptance case must name the surface files its test exercises (surfaceFiles); without them a changed product file cannot invalidate the verification')
      }
      // FR5: an automated acceptance case states its claim - what defect it catches, through which
      // real input, with an oracle that does not come from the implementation, and the source that
      // makes the scenario realistic. A test that cannot answer these is a restatement of the code.
      const realism = {}
      for (const [field, code] of [['failsWhen', 'FAILS_WHEN_REQUIRED'], ['trigger', 'TRIGGER_REQUIRED'], ['oracle', 'ORACLE_REQUIRED'], ['realism', 'REALISM_REQUIRED']]) {
        const value = typeof args[field] === 'string' ? args[field].trim() : ''
        if (automated && purpose === 'acceptance' && value === '') {
          throw new Refusal(code, 'an automated acceptance case must state ' + field + ' - what it catches, how a real input reaches it, where the expected result comes from, and what makes the scenario real. The tester writes it; the gate returns it with the evidence')
        }
        if (value !== '') realism[field] = value
      }
      // A SIGN-OFF, NOT A BOOLEAN. The scenario is real when somebody who was not the author says
      // so; the record keeps who and when, so a reader can weigh it. An automated acceptance case
      // without one is refused, and the author cannot sign for itself.
      const reviewedBy = typeof args.realismReviewedBy === 'string' ? args.realismReviewedBy.trim() : ''
      const reviewedAt = typeof args.realismReviewedAt === 'string' ? args.realismReviewedAt.trim() : ''
      if (automated && purpose === 'acceptance') {
        if (reviewedBy === '' || reviewedAt === '') {
          throw new Refusal('REALISM_SIGNOFF_REQUIRED', 'an automated acceptance case needs a realism sign-off: pass realismReviewedBy (a preset that did not author this case, or "human") and realismReviewedAt (ISO time); presence of the four fields is checkable, whether the scenario is real is a judgement somebody must make')
        }
        if (!caller.human && reviewedBy.toLowerCase() === caller.authorPreset.toLowerCase()) {
          throw new Refusal('REALISM_SIGNOFF_SELF', 'the author cannot confirm its own scenario as real; ask another preset (a reviewer) or a human to sign it')
        }
        if (Number.isNaN(Date.parse(reviewedAt))) throw new Refusal('REALISM_SIGNOFF_INVALID', 'realismReviewedAt must be an ISO date')
      }
      if (Array.isArray(args.steps) && args.steps.filter((step) => typeof step === 'string' && step.trim() !== '').length === 0) {
        throw new Refusal('INVALID_CASE', '`steps` must not be empty; a case without reproduction steps cannot be rerun')
      }
      const dir = dirFor(exec.agent)
      const workspace = workingDir(exec.agent)
      const testHash = automated ? testHashOf({ automated, testPath: args.testPath }, workspace) : null
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
        ...(typeof args.criterionId === 'string' && args.criterionId.trim() !== '' ? { criterionId: args.criterionId.trim().slice(0, 40) } : {}),
        reqId,
        authorRole,
        authorPreset: caller.authorPreset,
        ...(caller.authorSessionId === null ? {} : { authorSessionId: caller.authorSessionId }),
        purpose,
        // The bytes the run will execute, frozen now: a test file edited after this point makes
        // case_run refuse (TEST_CHANGED) instead of measuring code the case never named.
        ...(testHash === null ? {} : { testHash }),
        ...realism,
        ...(reviewedBy === '' ? {} : { realismReviewedBy: reviewedBy.slice(0, 80) }),
        ...(reviewedAt === '' ? {} : { realismReviewedAt: reviewedAt.slice(0, 40) }),
        ...(checks.length > 0 ? { checks } : {}),
        ...(typeof args.negativeControl === 'string' && args.negativeControl !== '' ? { negativeControl: args.negativeControl } : {}),
        revision: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: caller.authorPreset,
        createdByKind: caller.human ? 'human' : 'agent',
        history: [],
        evidence: {},
      }
      const path = writeCase(dir, record)
      // THE TASK KNOWS ITS CASES. Without the link on the row, deleting this file would satisfy the
      // task (an unlinked library looks like a task that never owed a case); with it, the close
      // refuses CASE_MISSING. A missing or failing taskboard does not lose the case: it is written,
      // and the answer says it was not linked so the orchestrator can attach it by hand.
      let linked
      if (typeof record.linkedTaskId === 'string' && record.linkedTaskId !== '') {
        linked = typeof env.linkCase === 'function'
          ? await env.linkCase(exec.agent, record.linkedTaskId, record.id)
          : { ok: false, code: 'taskboard_missing' }
      }
      const testMirror = await mirror(exec.agent, record)
      return {
        ok: true,
        case: summary(record),
        path: relative(workspace, path),
        ...(linked === undefined ? {} : { linked: linked.ok === true }),
        ...(linked === undefined || linked.ok === true
          ? {}
          : { warning: `the case is recorded but the task row was not updated (${linked.code}); run task_update { caseIds: [...] } to attach it, or the close will not see it` }),
        ...(testMirror === null ? {} : { testMirror }),
      }
    }),
  })

  /**
   * The fields case_update may write, as ONE object.
   *
   * WHY IT IS ONE OBJECT. The tool declares its parameters and then copied named fields into the
   * record; the two lists drifted, so a field could be declared, accepted and silently dropped - or,
   * like status, never declared and dropped without a word. Parameters and the write set are now
   * the same keys, and anything else is refused by name (CASE_FIELD_UNKNOWN). status is deliberately
   * absent: a case becomes verified by a measured run (case_run) or a recorded observation
   * (case_verify), never by an edit.
   */
  const CASE_UPDATE_PARAMS = {
      id: { type: 'string', required: true },
      expectedRevision: { type: 'number', required: true, description: 'The revision you read. A mismatch is refused.' },
      title: { type: 'string' }, requirement: { type: 'string' }, expected: { type: 'string' },
      steps: { type: 'array', items: { type: 'string' } },
      automated: { type: 'boolean' }, testPath: { type: 'string' }, runCommand: { type: 'string' }, reason: { type: 'string' },
      reqId: { type: 'string' }, authorRole: { type: 'string' },
      authorPreset: { type: 'string', description: 'Humans only: name the author. An agent cannot change it (AUTHOR_IMMUTABLE).' },
      purpose: { type: 'string', enum: ['acceptance', 'implementation'], description: 'acceptance | implementation. An agent cannot turn an automated acceptance case into an implementation case (PURPOSE_IMMUTABLE).' },
      waiver: { type: 'object', additionalProperties: false, description: 'Human only, for switching automation off or downgrading an automated acceptance case: {reason, by: "human"}.', properties: { reason: { type: 'string' }, by: { type: 'string' } } },
      fixture: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
      surfaceFiles: { type: 'array', items: { type: 'string' } },
      negativeControl: { type: 'string', description: 'Driver control name for a measured red (pass an empty string to clear it).' },
      failsWhen: { type: 'string', description: 'The defect the case must catch (automated acceptance). A change drops the verification.' },
      trigger: { type: 'string', description: 'The public input or sequence that reaches the defect. A change drops the verification.' },
      oracle: { type: 'string', description: 'Where the expected result comes from. A change drops the verification.' },
      realism: { type: 'string', description: 'The source that makes the scenario real. A change drops the verification.' },
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
    }
  const CASE_UPDATE_FIELDS = new Set(Object.keys(CASE_UPDATE_PARAMS))

  const update = defineTool({
    name: 'case_update',
    description: 'Edit a case with compare-and-set on its revision. Every edit keeps the previous text in history and records editedBy, so a contradicting requirement is resolved without losing either version. Refuses on a stale revision (REVISION_CONFLICT) or a closed case.',
    parameters: CASE_UPDATE_PARAMS,
    output: OUTPUT,
    execute: (args, exec) => guarded(async () => {
      requireStrings(args, ['id'])
      // AN EDIT WRITES WHAT THE TOOL DECLARES, AND NOTHING ELSE. The field list and the write set
      // were two lists; a field outside the second was accepted and dropped without a word. Now
      // the parameters ARE the write set, and a key the tool does not declare is refused by name -
      // `status` most of all: a case becomes verified by a measured run or a recorded observation,
      // never by an edit.
      const unknownFields = Object.keys(args ?? {}).filter((key) => !CASE_UPDATE_FIELDS.has(key))
      if (unknownFields.length > 0) {
        const status = unknownFields.includes('status') ? ' status is not writable through case_update: use case_run (a measured run) or case_verify (a recorded observation).' : ''
        throw new Refusal('CASE_FIELD_UNKNOWN', 'case_update does not write ' + unknownFields.join(', ') + '; the fields it may change are ' + [...CASE_UPDATE_FIELDS].join(', ') + '.' + status)
      }
      const dir = dirFor(exec.agent)
      const workspace = workingDir(exec.agent)
      const { record: existing } = readCase(dir, args.id)
      checkRevision(existing, args.expectedRevision)
      // THE ORACLE IS THE AUTHOR'S, OR A HUMAN'S. A case is a claim about a behaviour; whoever
      // carries out the work must not be able to rewrite the claim after seeing the result. An
      // agent that is not the recorded author is refused before anything is written, and no
      // agent may move authorship to another preset or role.
      const caller = callerIdentity(exec, env, args)
      const author = typeof existing.authorPreset === 'string' && existing.authorPreset !== ''
        ? existing.authorPreset
        : (typeof existing.createdBy === 'string' && existing.createdBy !== '' ? existing.createdBy : null)
      if (!caller.human && author !== caller.authorPreset) {
        throw new Refusal('AUTHOR_ONLY', `case "${existing.id}" was authored by ${author ?? '(nobody recorded)'}; only that author or a human may change it`)
      }
      if (!caller.human) {
        const named = typeof args.authorPreset === 'string' ? args.authorPreset.trim() : ''
        if (named !== '' && named !== author) {
          throw new Refusal('AUTHOR_IMMUTABLE', `case "${existing.id}" was authored by ${author ?? '(nobody recorded)'}; an agent cannot re-attribute it to ${named}`)
        }
        const role = typeof args.authorRole === 'string' ? args.authorRole.trim() : ''
        if (role !== '' && role.toLowerCase() !== String(existing.authorRole ?? '').trim().toLowerCase()) {
          throw new Refusal('AUTHOR_IMMUTABLE', `case "${existing.id}" names authorRole "${existing.authorRole ?? ''}"; an agent cannot re-attribute it to "${role}"`)
        }
      }
      const next = { ...existing }
      for (const field of ['title', 'requirement', 'expected', 'testPath', 'runCommand', 'reason', 'fixture', 'failsWhen', 'trigger', 'oracle', 'realism']) {
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
      next.purpose = purposeOf(typeof args.purpose === 'string' ? args.purpose : existing.purpose)
      if (caller.human && typeof args.authorPreset === 'string' && args.authorPreset.trim() !== '') next.authorPreset = args.authorPreset.trim()
      if (typeof args.reqId === 'string' && args.reqId.trim() !== '') next.reqId = args.reqId.trim()
      if (typeof args.authorRole === 'string' && args.authorRole.trim() !== '') next.authorRole = args.authorRole.trim()
      // SWITCHING THE EVIDENCE OFF IS NOT AN EDIT. `automated:false` turns a measured run into a
      // typed report, and `implementation` takes an acceptance case out of the acceptance rule:
      // either one is a way out of the gate rather than a repair of the case, so an agent cannot
      // take it and a human needs an explicit, recorded waiver.
      const automatedOff = existing.automated === true && next.automated !== true
      const acceptanceDowngrade = existing.automated === true && purposeOf(existing.purpose) === 'acceptance' && purposeOf(next.purpose) === 'implementation'
      if (automatedOff || acceptanceDowngrade) {
        const code = automatedOff ? 'AUTOMATED_IMMUTABLE' : 'PURPOSE_IMMUTABLE'
        const what = automatedOff
          ? 'switching automation off turns a measured run into a manual report'
          : 'moving an automated acceptance case to implementation removes it from the acceptance rule'
        if (!caller.human) throw new Refusal(code, `${what}; an agent cannot do it - record a new implementation case instead, or ask a human for a waiver {reason, by: "human"}`)
        if (!validWaiver(args.waiver)) throw new Refusal('WAIVER_REQUIRED', `${what}: it needs an explicit human waiver {reason, by: "human"}`)
        if (typeof env.waive === 'function') await env.waive(exec.agent, automatedOff ? 'automated_immutable' : 'purpose_immutable', args.waiver, { caseId: existing.id })
      }
      // The same surface requirement holds on the EDITED record, so a case cannot be saved without
      // the list the acceptance rule needs to notice a changed product file.
      if (next.automated === true && purposeOf(next.purpose) === 'acceptance') {
        const surfaces = (Array.isArray(next.surfaceFiles) ? next.surfaceFiles : []).filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.path === 'string' && entry.path !== '')
        if (surfaces.length === 0) throw new Refusal('SURFACE_FILES_REQUIRED', 'an automated acceptance case must name the surface files its test exercises; pass surfaceFiles with at least one product file')
      }
      if (next.automated === true && (typeof next.testPath !== 'string' || next.testPath.trim() === '' || typeof next.runCommand !== 'string' || next.runCommand.trim() === '')) {
        throw new Refusal('AUTOMATED_REQUIRES_TEST', 'automated:true needs testPath and runCommand')
      }
      if (next.automated === false && (typeof next.reason !== 'string' || next.reason === '')) {
        throw new Refusal('DOCUMENTED_REQUIRES_REASON', 'automated:false needs a reason')
      }
      // The pinned-command rule holds on the EDITED record, not only on the incoming field: a case
      // registered before the rule keeps its text (it stays readable), but no edit may save it
      // again until its command is relative.
      if (next.automated === true) checkPinned(next.runCommand, 'runCommand')
      if (next.automated !== true && Array.isArray(next.checks) && next.checks.length > 0) {
        throw new Refusal('CHECKS_REQUIRE_AUTOMATED', 'checks are evaluated by case_run; a documented-only case has no command to run')
      }
      // The run executes the BYTES of the test file, so an edit that changes the test binding
      // re-pins them: a new test path, automation coming back on, or an explicit testPath from the
      // author. If the bytes on disk differ from the recorded hash, that is a re-pin and it drops
      // the verification (see `hashChanged` below) - it is never a silent refresh.
      const repin = next.automated === true
        && (typeof args.testPath === 'string' || next.testPath !== existing.testPath || next.automated !== existing.automated)
      if (repin) {
        const hash = testHashOf(next, workspace)
        if (hash === null) delete next.testHash
        else next.testHash = hash
      } else if (next.automated !== true) {
        delete next.testHash
      }
      // Attribution comes from the INVOCATION, not from a caller-supplied field: a tool call is
      // an agent edit, the panel command passes actor 'human'. `source` records who stated the
      // requirement; it is not evidence that a human edited this revision.
      const editedBy = exec.actor === 'human' ? 'human' : 'agent'
      next.revision = existing.revision + 1
      next.updatedAt = new Date().toISOString()
      next.history = [...(existing.history ?? []), { revision: existing.revision, at: existing.updatedAt, editedBy, snapshot: { title: existing.title, requirement: existing.requirement, expected: existing.expected, steps: existing.steps, automated: existing.automated, testPath: existing.testPath, runCommand: existing.runCommand, reason: existing.reason, status: existing.status, checks: existing.checks ?? [], negativeControl: existing.negativeControl ?? null } }]
      // ANY change to the ORACLE (requirement, expected outcome, steps, checks, surface) or to the
      // automation/test binding invalidates the previous verification: the evidence measured a
      // claim this case no longer makes. The case goes stale and its evidence is dropped, so a
      // later verification must be produced again - by a run, since only a run verifies.
      const hashChanged = (next.testHash ?? null) !== (existing.testHash ?? null)
      const bindingChanged = next.automated !== existing.automated
        || next.testPath !== existing.testPath
        || next.runCommand !== existing.runCommand
        || hashChanged
      // A surface file whose bytes moved since the record was written (re-hashed above when the
      // author passed the list) is drift, not a decision: dropping the verification here is what
      // stops an edit from laundering a quietly changed surface file.
      const surfaceDrifted = (next.surfaceFiles ?? []).some((entry) => {
        const before = (existing.surfaceFiles ?? []).find((old) => old.path === entry.path)
        return before !== undefined && before.sha256 !== entry.sha256
      })
      const pathsOf = (list) => (Array.isArray(list) ? list : []).map((entry) => (typeof entry === 'string' ? entry : entry?.path)).join('\n')
      const oracleChanged = next.expected !== existing.expected
        || JSON.stringify(next.steps ?? []) !== JSON.stringify(existing.steps ?? [])
        || JSON.stringify(next.checks ?? []) !== JSON.stringify(existing.checks ?? [])
        || pathsOf(next.surfaceFiles) !== pathsOf(existing.surfaceFiles)
        // FR5: the realism fields ARE the claim. Rewriting the defect a case catches, or the
        // input that reaches it, or its oracle, is a new claim and drops the old verification.
        || ['failsWhen', 'trigger', 'oracle', 'realism'].some((field) => (next[field] ?? '') !== (existing[field] ?? ''))
      if (next.requirement !== existing.requirement || oracleChanged || bindingChanged || surfaceDrifted) {
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
    description: 'Record a MANUAL observation of a case: what you ran and what you saw, stamped source "manual" so it is never presented as a measurement. On an AUTOMATED case a manual pass is an observation only: the case stays unverified and lastVerified stays null (a case already verified by the runner keeps that verification); a manual failure sets failing. On a documented-only case it records the observation command/output. Use case_run to execute the stored command and actually verify. Refuses to invent a pass.',
    parameters: {
      id: { type: 'string', required: true },
      expectedRevision: { type: 'number', required: true },
      passed: { type: 'boolean', required: true, description: 'True when the run/observation showed the expected outcome.' },
      evidence: { type: 'object', additionalProperties: false, description: '{ command, output, exitCode, at?, cwd? } of the green/observation run. cwd is absolute or workspace-relative; default the session workspace.', properties: { command: { type: 'string' }, output: { type: 'string' }, exitCode: { type: 'number' }, at: { type: 'string' }, cwd: { type: 'string' } } },
      redFirst: { type: 'object', additionalProperties: false, description: 'Automated only: { command, output, exitCode, at?, cwd? } of the observed failing run before the fix. exitCode must be non-zero.', properties: { command: { type: 'string' }, output: { type: 'string' }, exitCode: { type: 'number' }, at: { type: 'string' }, cwd: { type: 'string' } } },
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
      if (plan.redFirst !== null && plan.redFirst !== undefined) record.redFirst = plan.redFirst
      if (plan.status === 'verified') {
        record.surfaceFiles = (record.surfaceFiles ?? []).map((entry) => ({ path: entry.path, sha256: fileHash(join(workspace, entry.path)) ?? entry.sha256 }))
      }
      record.revision += 1
      record.updatedAt = new Date().toISOString()
      const action = plan.action ?? (plan.status === 'verified' ? 'verified-manual' : 'failed-manual')
      record.history = [...(record.history ?? []), {
        revision: record.revision - 1,
        at: record.updatedAt,
        editedBy: exec.actor === 'human' ? 'human' : 'agent',
        action,
        ...(plan.note === undefined ? {} : { reason: plan.note }),
        notes: args.notes ?? null,
      }]
      const path = writeCase(dir, record)
      return {
        ok: true,
        case: summary(record),
        evidence: record.evidence,
        path: relative(workspace, path),
        ...(plan.note === undefined ? {} : { note: plan.note }),
      }
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
      control: { type: 'string', description: 'Red only, negative-control: the control name passed as CASE_NEGATIVE_CONTROL. The driver must break its own assertion when it sees it.' },
      redSource: { type: 'string', enum: ['negative-control', 'wrong-product'], description: 'Red only (default negative-control). negative-control runs the driver self-check; wrong-product runs the stored command in cwd - a copy of the previous version or a named wrong implementation - with NO control hooks, and expects it to FAIL. Only the wrong-product red makes an acceptance case acceptable.' },
      setBaseline: { type: 'boolean', description: 'Seed the ratchet from this passing run: every numeric metric\'s median becomes the baseline.' },
      cwd: { type: 'string', description: 'Directory the stored command runs in: absolute, or relative to the session workspace (default: the workspace). Recorded with the run, so a red and a green name the tree they were observed in. Use it for a red-first run in a COPY of the tree instead of pinning the command with \`cd /abs/path\`.' },
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
      // THE RUN IS BOUND TO THE BYTES. The case froze the test file's hash when it was registered
      // or re-pinned; a run whose file no longer hashes to it would measure code the case never
      // named, so it is refused by name instead of producing a green over an unknown check.
      const hashes = testHashState(record, workspace)
      if (hashes.recorded === null) {
        throw new Refusal('TEST_HASH_MISSING', `case "${record.id}" records no hash of ${record.testPath}; re-record it (case_record) or re-pin the test with case_update { testPath }, so the run is bound to the bytes it measures`)
      }
      if (!hashes.ok) {
        throw new Refusal('TEST_CHANGED', `${record.testPath} changed since the case recorded its hash (${hashes.recorded.slice(0, 12)}… -> ${hashes.actual === null ? 'missing' : `${hashes.actual.slice(0, 12)}…`}); review the change, then re-pin it with case_update { testPath } and run again`)
      }
      const mode = args.mode === 'red' ? 'red' : 'green'
      const rawRedSource = args.redSource === 'wrong-product' ? 'wrong-product' : 'negative-control'
      let redSource = rawRedSource
      // A WRONG-PRODUCT RED MUST RUN IN A REAL OTHER TREE. An empty directory, a path back to this
      // checkout, a tree without the test file, or a tree that cannot name its version all produce
      // a "red" that proves nothing: the command would fail for the wrong reason. Refused as a
      // tree problem, before a single byte is measured.
      let wrongTreeGit = null
      if (mode === 'red' && rawRedSource === 'wrong-product') {
        const other = resolveCwd(workspace, args.cwd)
        const inside = relative(workspace, other.cwd)
        const problems = []
        if (typeof args.cwd !== 'string' || args.cwd.trim() === '') problems.push('no cwd was given')
        // (a) OUTSIDE the workspace: a stub under docs/cases/ is inside it and would borrow the
        // workspace tree, its git HEAD and its dependencies. `relative` returns an ABSOLUTE path
        // when the two paths are on different drives (Windows), which is outside and not inside:
        // the check is `isAbsolute` first for that reason.
        else if (inside === '' || (!isAbsolute(inside) && !inside.startsWith('..'))) problems.push('cwd is inside the session workspace')
        if (problems.length === 0 && !existsSync(join(other.cwd, record.testPath))) problems.push(`the test file ${record.testPath} is not in that tree`)
        // (b) the SAME test bytes: the red must fail because the PRODUCT differs, not the test.
        if (problems.length === 0) {
          // D1: compare the LINES, not the bytes - a `core.autocrlf=true` clone is the same check
          // with CRLF line endings, and refusing it was a false refusal on Windows.
          const redTestHash = textHash(join(other.cwd, record.testPath))
          const liveTestHash = textHash(join(workspace, record.testPath))
          if (redTestHash === null) problems.push(`the test file ${record.testPath} is not readable in that tree`)
          else if (liveTestHash !== null && redTestHash !== liveTestHash) {
            throw new Refusal('WRONG_PRODUCT_TEST_MISMATCH', `the test file in ${other.cwd} is not the one in this workspace, so the red would measure a different check; copy the tree with the same test bytes`)
          }
        }
        // (c) the PRODUCT must be there: a tree with only the test proves the test fails against
        // nothing, not against another implementation.
        if (problems.length === 0) {
          const product = (record.surfaceFiles ?? [])
            .map((entry) => (typeof entry === 'string' ? entry : entry?.path))
            .filter((path) => typeof path === 'string' && path !== '' && path !== record.testPath && !path.replaceAll('\\', '/').startsWith('docs/cases/'))
          if (product.length === 0) problems.push('the case names no product surface file, so there is no wrong product to run against')
          const missing = product.filter((path) => !existsSync(join(other.cwd, path)))
          if (missing.length > 0) problems.push(`the product is missing from that tree: ${missing.join(', ')}`)
        }
        if (problems.length === 0) {
          // (d) an EARLIER version: the same HEAD as this checkout is the same code.
          wrongTreeGit = gitState(other.cwd)
          if (wrongTreeGit.head === null) problems.push('that tree is not a git checkout, so the version it is cannot be named')
          else {
            const mine = gitState(workspace)
            if (mine.head !== null && mine.head === wrongTreeGit.head) {
              throw new Refusal('WRONG_PRODUCT_HEAD_NOT_PREVIOUS', `${other.cwd} is at the same commit as this workspace (${mine.head.slice(0, 12)}), so it is not a previous version: check out the version before the change, or break it deliberately and say so`)
            }
          }
        }
        if (problems.length > 0) {
          throw new Refusal('WRONG_PRODUCT_TREE_INVALID', `a wrong-product red must run in a copy of the previous version (or a named wrong implementation): ${problems.join('; ')}. Copy the tree outside this workspace, keep the same test bytes and the product, and pass its path as cwd`)
        }
      }
      const control = typeof args.control === 'string' && args.control !== '' ? args.control : (typeof record.negativeControl === 'string' ? record.negativeControl : '')
      // A wrong-product red needs no control: nothing breaks on purpose, the OTHER TREE fails.
      if (mode === 'red' && redSource !== 'wrong-product' && control === '') {
        throw new Refusal('NEGATIVE_CONTROL_REQUIRED', 'a red run needs a control: pass control, or record negativeControl on the case (the driver breaks its own assertion when it receives CASE_NEGATIVE_CONTROL). For a wrong-product red pass redSource: "wrong-product" with cwd pointing at the other tree')
      }
      // WHERE the run happens is part of the evidence: a command relative to a copy of the tree is
      // what makes the recorded red real, and the record keeps the directory beside the command.
      const tree = resolveCwd(workspace, args.cwd)
      // WHO ran it comes from the session, not from the caller: the gate compares this preset with
      // the task's implementer, and a field the caller fills would be a field the caller forges.
      const runBy = {
        preset: callerIdentity(exec, env, {}).authorPreset,
        sessionId: exec?.agent?.session?.id ?? null,
        taskId: typeof record.linkedTaskId === 'string' && record.linkedTaskId !== '' ? record.linkedTaskId : null,
      }
      const attempt = await runAttempts({
        workspace,
        cwd: tree.cwd,
        dir,
        record,
        runId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        runs: args.runs,
        timeoutMs: args.timeoutMs,
        mode,
        control,
        redSource,
        runBy,
        exec: executor,
      })
      if (mode === 'red' && attempt.controlHeld !== true) {
        throw new Refusal(
          redSource === 'wrong-product' ? 'WRONG_PRODUCT_DID_NOT_FAIL' : 'NEGATIVE_CONTROL_DID_NOT_FAIL',
          redSource === 'wrong-product'
            ? `the case passed against the tree in ${tree.cwd}, so that tree is not the wrong product: a wrong-product red must FAIL there (previous version, or the named wrong implementation)`
            : 'the negative control exited 0 (or timed out); a red run must FAIL for the control to prove the check can fail',
        )
      }
      const folded = recordRun(record, { workspace, attempt, mode, setBaseline: args.setBaseline === true, commit: typeof args.commit === 'string' ? args.commit : null, runBy })
      if (folded.record.lastVerified !== null && folded.record.lastVerified !== undefined) {
        folded.record.lastVerified = { ...folded.record.lastVerified, cwd: tree.cwd, cwdRelative: tree.cwdRelative }
      }
      folded.verdict = { ...folded.verdict, cwd: tree.cwd, cwdRelative: tree.cwdRelative }
      const path = writeCase(dir, folded.record)
      const testMirror = await mirror(exec.agent, folded.record)
      return { ok: true, case: summary(folded.record), verdict: folded.verdict, runBy, path: relative(workspace, path), ...(testMirror === null ? {} : { testMirror }) }
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
      const runBy = { preset: callerIdentity(exec, env, {}).authorPreset, sessionId: exec?.agent?.session?.id ?? null, taskId: null }
      const results = []
      for (const row of candidates) {
        const record = row.record
        // A case whose test bytes are unknown or changed is not run: the suite reports it as not
        // green with the named reason, so one legacy case cannot be measured over the wrong code.
        const hashes = testHashState(record, workspace)
        if (hashes.recorded === null || !hashes.ok) {
          const skipped = hashes.recorded === null ? 'TEST_HASH_MISSING' : 'TEST_CHANGED'
          results.push({ id: record.id, status: record.status, skipped, passed: false, flaky: false, needsRed: false, checks: [] })
          continue
        }
        const attempt = await runAttempts({ workspace, dir, record, runId: `${suiteId}-${record.id}`, runs: args.runs, timeoutMs: args.timeoutMs, runBy, exec: executor })
        const folded = recordRun(record, { workspace, attempt, commit: typeof args.commit === 'string' ? args.commit : null, runBy })
        writeCase(dir, folded.record)
        results.push({ id: record.id, status: folded.verdict.status, runId: folded.verdict.runId, passed: folded.verdict.passed, flaky: folded.verdict.flaky, needsRed: folded.verdict.needsRed === true, checks: folded.verdict.checks })
      }
      // A skipped case is never green, whatever its recorded status says.
      const failed = results.filter((entry) => entry.status !== 'verified' || entry.skipped !== undefined)
      const reportDir = join(dir, 'runs', 'suites')
      const reportPath = join(reportDir, `${suiteId}.json`)
      mkdirSync(reportDir, { recursive: true })
      writeFileSync(reportPath, `${JSON.stringify({ suiteId, at: new Date().toISOString(), runBy, filter: { tag: args.tag ?? null, kind: args.kind ?? null, status: args.status ?? null }, checked: results.length, verified: results.length - failed.length, failed: failed.length, cases: results }, null, 2)}\n`, 'utf8')
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
   * The read-only verdict the taskboard also enforces on close: an AUTOMATED ACCEPTANCE case
   * linked to the task must be verified by a measured run, written and run by presets that are
   * not the implementer's, over the test bytes it recorded. Documented-only and implementation
   * cases never block.
   */
  const gate = defineTool({
    name: 'case_gate',
    description: 'Read-only acceptance verdict for a task or a case: every linked automated acceptance case with its provenance (status, author, who ran it, whether its test file still matches) and the reasons it is refused. The taskboard refuses task_close on the same rule. Independence is judged against the task\'s implementer preset: pass implementerPreset, or let the taskboard service supply it; with no preset the gate fails closed.',
    parameters: {
      taskId: { type: 'string', description: 'Check every automated acceptance case linked to this task id.' },
      id: { type: 'string', description: 'Check one case.' },
      implementerPreset: { type: 'string', description: 'The preset of the session that did the work. Default: read from the taskboard row of taskId (or of the case\'s linked task).' },
    },
    output: OUTPUT,
    execute: (args, exec) => guarded(() => {
      if (typeof args.taskId !== 'string' && typeof args.id !== 'string') throw new Refusal('INVALID_CASE', 'pass taskId or id')
      const dir = dirFor(exec.agent)
      const workspace = workingDir(exec.agent)
      const rows = readCases(dir)
      const human = exec?.actor === 'human'
      const named = typeof args.implementerPreset === 'string' && args.implementerPreset.trim() !== '' ? args.implementerPreset.trim() : ''
      let taskId = args.taskId
      if (typeof args.id === 'string') {
        const row = rows.find((entry) => entry.record !== undefined && entry.record.id === args.id)
        if (taskId === undefined && row !== undefined && typeof row.record.linkedTaskId === 'string') taskId = row.record.linkedTaskId
      }
      // The task ROW is the authority for both facts: which preset did the work, and which cases
      // the row owns. Reading them from one place is what keeps this gate and task_close identical.
      const taskRow = typeof env.taskRowFor === 'function' ? env.taskRowFor(workspace, taskId) : undefined
      const fromTask = typeof taskRow?.preset === 'string' && taskRow.preset !== ''
        ? taskRow.preset
        : (typeof env.taskPresetFor === 'function' ? env.taskPresetFor(workspace, taskId) : undefined)
      const taskPreset = typeof fromTask === 'string' && fromTask !== '' ? fromTask : undefined
      const caseIds = Array.isArray(taskRow?.caseIds) && args.taskId !== undefined ? taskRow.caseIds : undefined
      // WHO DID THE WORK IS NOT THE CALLER'S WORD. An agent asking "would this pass if the
      // implementer were someone else?" is asking the gate to prove a counterfactual; the only
      // honest implementer is the one on the task row. A human (the panel) may name it, and so may
      // a caller outside an agent session (the CLI passes it directly to the same rule).
      const implementerPreset = human ? (named !== '' ? named : taskPreset) : taskPreset
      const presetSource = implementerPreset === undefined ? null : (human && named !== '' ? 'argument' : 'task')
      const verdict = acceptanceFor(rows, {
        taskId: args.taskId,
        id: args.id,
        workspace,
        dir,
        implementerPreset,
        knownPresets,
        ...(caseIds === undefined ? {} : { caseIds }),
      })
      return {
        ok: verdict.ok,
        taskId: args.taskId ?? null,
        caseId: args.id ?? null,
        implementerPreset: implementerPreset ?? null,
        presetSource,
        ...(human || named === '' || named === taskPreset ? {} : { warning: `implementerPreset "${named}" was ignored: it is read from the task row, not from the caller` }),
        checked: rows.length,
        ...verdict,
      }
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
    description: 'Read one case in full: requirement, steps, expected, automation fields, evidence, surface hashes, revision and history, plus the directory of the last measured run and of the last manual observation (directories.lastRun / directories.lastObservation).',
    parameters: { id: { type: 'string', required: true } },
    output: OUTPUT,
    execute: (args, exec) => guarded(() => {
      requireStrings(args, ['id'])
      const readDir = dirFor(exec.agent)
      const { record, path } = readCase(readDir, args.id)
      // THE JOURNAL, WHEN THERE IS ONE. A file that changed without a recorded write is reported
      // by name: the bytes on disk are not the bytes the journal last saw. A case written before
      // the journal existed (or by hand) has no event and reads as legacy - readable, not signed.
      const journal = checkCase(readDir, record.id, path)
      if (journal.status === 'mismatch' || journal.status === 'broken') {
        throw new Refusal('CASE_JOURNAL_MISMATCH', journal.detail ?? 'the case does not match its journal')
      }
      // The directory is what tells two otherwise identical runs apart: a red taken in a copy of
      // the tree and a green taken here are the same command in two different trees.
      const where = (entry) => (entry === null || entry === undefined || typeof entry.cwd !== 'string' || entry.cwd === ''
        ? null
        : { cwd: entry.cwd, cwdRelative: typeof entry.cwdRelative === 'string' ? entry.cwdRelative : null, at: entry.at ?? null, ...(typeof entry.runId === 'string' ? { runId: entry.runId } : {}) })
      const runs = Array.isArray(record.runs) ? record.runs : []
      const lastRun = runs.length > 0 ? runs[runs.length - 1] : null
      const observation = record.evidence?.run ?? record.evidence?.observation ?? null
      return { ok: true, case: record, directories: { lastRun: where(lastRun), lastObservation: where(observation) } }
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

/**
 * The prompt section for ONE role's granted surface.
 *
 * WHY IT IS GENERATED, NOT FIXED. The section used to be chosen by one bit - "has case_run? the
 * full section : the intake section" - so the critic, which has three tools, was told to use
 * case_verify it cannot call, and the backend was told nothing about the case_update it now owns.
 * A prompt that names a verb the role does not have is an instruction a model can neither follow
 * nor report. The text is therefore built from the same policy row that registers the tools, and
 * `test/policy-docs.test.mjs` compares it with the row and with the README table.
 */
export function sectionText(granted = ALL_TOOLS) {
  const list = Array.isArray(granted) ? granted : []
  const has = (verb) => list.includes(verb)
  const lines = [
    has('case_run') || has('case_verify') ? 'TEST CASES (docs/cases/, host tool family):' : 'TEST CASES (docs/cases/, intake subset):',
    '  Explore with your own tools first and OBSERVE the behaviour, then persist the case. Never record a speculative test.',
    '  Record ONE case per accepted behaviour, not per requirement: one verified run may prove several requirements at once. The case keeps its primary reqId - the requirement it protects - and names the other REQs in its text; the schema does not grow a reqIds field.',
    `  Your surface is exactly: ${list.join(', ')}. A case verb outside that list is not registered for this role; do not describe a check you cannot run.`,
  ]
  if (has('case_record')) {
    lines.push('  case_record persists ONE observed case: source human for a requirement the human stated (status unverified), a named reason when it cannot be a test, a real testPath + runCommand when it can, and linkedTaskId of the task that implements it.')
  }
  if (has('case_run')) {
    lines.push('  case_run EXECUTES an automated case\'s stored runCommand and records the MEASUREMENT (exit code, duration, checks, artifacts under docs/cases/runs/, and the directory it ran in - pass cwd for a red-first run in a COPY of the tree instead of pinning the command with `cd /abs/path`). Declare checks on the case - {metric, op, threshold} reads the driver\'s CASE_SUMMARY JSON, {baseline: true} ratchets against the recorded baseline, runs>1 gives median/p95 and records a mixed outcome as flaky.')
  }
  if (has('case_run') || has('case_verify')) {
    // The red-first rule is one rule, but the verb that satisfies it differs per row: case_run
    // records the measured control, case_verify the observed one. Naming both to a role that has
    // one of them is the same defect the generated section exists to prevent.
    const control = has('case_run') ? 'record the negative control with case_run mode:"red" (the driver breaks its own assertion on CASE_NEGATIVE_CONTROL)' : ''
    const manual = has('case_verify') ? 'case_verify is the MANUAL report, stamped source manual' : ''
    const observed = !has('case_run') && has('case_verify') ? ' and an automated pass needs the observed red-first run of the same command' : ''
    lines.push(`  A green run on a case with no recorded red is a measurement, not a verification: ${[control, manual].filter((part) => part !== '').join(', or ')}.${observed}`)
  }
  if (has('case_verify') && has('case_run')) {
    lines.push('  case_verify records what YOU observed - {command, output, exitCode, cwd} - with the directory included, so a red taken in a copy of the tree is not confused with a green taken here. A manual pass on an automated case does not verify it: it stays unverified until case_run measures it.')
  }
  if (has('case_update')) {
    lines.push('  case_update repairs the case itself: read it with case_get, pass expectedRevision, and know that a changed requirement, command or check returns the case to stale and drops the recorded red.')
  }
  if (has('case_suite')) lines.push('  case_suite runs a filtered set and writes a report.')
  if (has('case_gate')) lines.push('  case_gate reads the acceptance evidence of the automated cases linked to a task: status, author, who ran it, whether its test file still matches, and the reasons it is refused. A case closes a task only when a RUN measured it and neither its author nor its run was the preset that did the work; the taskboard refuses task_close on the same rule.')
  if (has('case_drift')) lines.push('  case_drift rehashes the recorded surface files and degrades a case whose test disappeared; only verified/failing/flaky can go stale.')
  if (!has('case_run') && !has('case_verify')) lines.push('  Recording is NOT verifying: a case you record stays unverified until the role that owns the work runs it in its own session, so never claim a case passed.')
  const read = has('case_get') ? 'read the case (case_get)' : 'read the case with case_list first'
  lines.push(has('case_supersede') || has('case_deprecate')
    ? `  The library is compare-and-set: ${read}, pass expectedRevision on every edit/run, and supersede/deprecate instead of deleting. A changed surface file or a missing test makes a case stale; it never erases the requirement.`
    : `  The library is compare-and-set: ${read} and pass expectedRevision on every run; a changed surface file or a missing test makes a case stale, and it never erases the requirement.`)
  return lines.join('\n')
}

/** The full prompt section: the surface of a role that records, runs, edits and verifies. */
export const SECTION_FULL = sectionText(ALL_TOOLS)

/** The intake section: the orchestrator's surface (record, list, get, drift, gate). */
export const SECTION_INTAKE = sectionText(INTAKE_TOOLS)

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
  /**
   * The implementer preset of a taskboard row, read through the taskboard service.
   *
   * It is the FALLBACK for `case_gate`: the close gate gets the preset from the same row and
   * passes it in, so the two doors judge the same fact. An inline task is the owner's own work,
   * and the owner is the orchestrator.
   */
  const taskPresetFor = (cwd, taskId) => {
    if (typeof taskId !== 'string' || taskId === '') return undefined
    try {
      const board = ctx.get?.('taskboard')
      const task = typeof board?.get === 'function' ? board.get(cwd, taskId) : undefined
      if (task === null || typeof task !== 'object') return undefined
      if (typeof task.preset === 'string' && task.preset.trim() !== '') return task.preset.trim()
      return task.inline === true || typeof task.role !== 'string' || task.role.trim() === '' ? 'orchestrator' : undefined
    } catch {
      return undefined
    }
  }
  /**
   * The task row behind #taskId, or undefined: `{ preset, caseIds }`.
   *
   * It is the FALLBACK for `case_gate`, so a gate asked by a tool reads the same row the close
   * gate reads - the preset that did the work and the cases the row owns.
   */
  const taskRowFor = (cwd, taskId) => {
    if (typeof taskId !== 'string' || taskId === '') return undefined
    try {
      const board = ctx.get?.('taskboard')
      const task = typeof board?.get === 'function' ? board.get(cwd, taskId) : undefined
      if (task === null || typeof task !== 'object') return undefined
      const preset = typeof task.preset === 'string' && task.preset.trim() !== ''
        ? task.preset.trim()
        : (task.inline === true || typeof task.role !== 'string' || task.role.trim() === '' ? 'orchestrator' : undefined)
      return { preset, ...(Array.isArray(task.caseIds) ? { caseIds: task.caseIds } : {}) }
    } catch {
      return undefined
    }
  }
  /**
   * Attach a recorded case to its task row.
   *
   * A workspace without the taskboard keeps its case (the write already happened) and the answer
   * says it was not linked; the orchestrator can attach it with `task_update { caseIds }`. The
   * update is compare-and-set against the revision just read, and a concurrent writer simply
   * loses this round - the row is still the authority, and the next case_record retries.
   */
  const linkCase = async (agent, taskId, caseId) => {
    const board = ctx.get?.('taskboard')
    if (board === undefined || board === null || typeof board.get !== 'function' || typeof board.update !== 'function') {
      return { ok: false, code: 'taskboard_missing' }
    }
    try {
      const cwd = workingDir(agent)
      const task = board.get(cwd, taskId)
      if (task === null || typeof task !== 'object') return { ok: false, code: 'task_unknown' }
      const existing = Array.isArray(task.caseIds) ? task.caseIds : []
      if (existing.includes(caseId)) return { ok: true, added: false }
      const updated = board.update(cwd, {
        id: taskId,
        expectedRevision: task.revision,
        patch: { caseIds: [...existing, caseId] },
      })
      if (updated === undefined || updated.ok === false) return { ok: false, code: String(updated?.code ?? 'link_refused') }
      return { ok: true, added: true }
    } catch (error) {
      return { ok: false, code: `link_failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
  const tools = createTools(config, {
    shell,
    waive,
    mirror: (agent, record) => scheduleMirror(agent, record),
    // The preset the REGISTRATION resolved, so a case records the same preset its tools were
    // granted for; the session header is the fallback inside callerIdentity.
    presetFor: (agent) => presetOf(ctx, agent),
    taskPresetFor,
    taskRowFor,
    linkCase,
  })
  // THE TASKBOARD'S READ. A workspace without this row keeps its legacy close behaviour: the
  // taskboard looks the service up with ctx.get('cases') and skips the gate when it is absent.
  // The presets a case may name as its author or its runner: the same rows the tool policy grants,
  // so a preset added to the policy is a preset the acceptance rule can compare.
  const policy = config.roles !== null && typeof config.roles === 'object' ? config.roles : DEFAULT_ROLE_TOOLS
  const knownPresets = Object.keys(policy)
  const providedCases = ctx.provide('cases', {
    gateForTask: (cwd, taskId, context) => gateForTask(cwd, taskId, { ...config, knownPresets, ...(context ?? {}) }),
    flushMirror: async (cwd) => { await (mirrorQueue.get(cwd) ?? Promise.resolve()) },
  })
  if (typeof ctx.effect === 'function') ctx.effect(() => providedCases)
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
