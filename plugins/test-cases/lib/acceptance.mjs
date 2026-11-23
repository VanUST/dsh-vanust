/**
 * PURPOSE
 *   The one rule that says whether an automated case stands as acceptance evidence for a task,
 *   and what provenance backs it either way. It lives outside the tool module so the host
 *   `case_gate`, the taskboard's close gate and the CLI (`plugins/test-cases/bin/cases.mjs`) all
 *   read the same rule: three copies of it is how a gate starts disagreeing with itself.
 *
 *   THE RULE DOES NOT TRUST THE RECORD'S FIELDS. A verified-looking case can be typed by hand:
 *   `status: verified`, `lastVerified.source: runner` and a `runBy` are three strings. So the claim
 *   is only counted when the run it names EXISTS: the run id must be in `record.runs` as a green
 *   passing run, and `<library>/runs/<case>/<runId>/run.json` must be there and agree on the
 *   command hash, the runner, the exit code and the outcome. A record with no runs blocks
 *   (`RUN_ARTIFACT_MISSING`); a record whose artifact disagrees blocks (`RUN_MISMATCH`).
 *
 * INPUTS / OUTPUTS
 *   purposeOf(value) -> 'acceptance' | 'implementation' (anything but 'implementation' is
 *   acceptance, so a case written before the field existed stays an acceptance case).
 *   isAcceptanceCase(record) -> true for an automated case whose purpose is acceptance, AND for a
 *   case that was automated and was DEGRADED when its test file disappeared (dropping the second
 *   kind out of the rule is how deleting a test file would close a task).
 *   acceptanceOf(record, { workspace, dir, implementerPreset, knownPresets, hash }) -> the
 *   evidence: { id, status, purpose, authorPreset, runBy, source, at, runId, testHashOk, drift,
 *   reasons, blocked }. `reasons` is empty exactly when the case is acceptable, and the FIRST
 *   reason is the most specific fact (see REASON_ORDER).
 *
 *   A case is acceptable only when ALL of these hold:
 *     - it was not degraded, and it is automated;
 *     - it says who wrote it and who ran it, both KNOWN presets, and neither is the implementer's;
 *     - its status is `verified` and the last verification came from the runner;
 *     - that run's artifact exists and agrees with the record;
 *     - the test file still hashes to the stored value, and the surface list is not empty;
 *     - no surface file drifted since the verification.
 *   Anything the rule cannot establish is a refusal. It never answers "probably fine".
 *
 * KEYWORDS
 *   acceptance, provenance, independence, self-verification, run artifact, test hash, degraded,
 *   legacy, fail closed
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { driftFor, testHashState } from './schema.mjs'

/**
 * The presets that may author or run a case. A session without one is recorded as `agent`, and
 * `human` is what a nameless human invocation looks like: neither is a preset anybody can compare
 * against the implementer, so neither counts as an independent author or run. The list is checked
 * against `DEFAULT_ROLE_TOOLS` by test/independent-verification.test.mjs, so adding a preset to the
 * tool policy without adding it here fails the suite instead of silently blocking its cases.
 */
export const KNOWN_PRESETS = ['orchestrator', 'backend', 'reviewer', 'critic', 'ux', 'research', 'docs', 'gatherer', 'tester']

/** The default purpose: a case written before purposes existed still guards a task. */
export function purposeOf(value) {
  return value === 'implementation' ? 'implementation' : 'acceptance'
}

/**
 * An acceptance case: automated, or automated-and-degraded with a task to answer to.
 *
 * WHY THE DEGRADED CASE COUNTS. `case_drift` turns a case whose test file disappeared into
 * `automated:false`, `degraded:true`, `stale`. If that removed the case from the acceptance rule,
 * deleting the test file would be a way to close the task with no evidence at all.
 */
export function isAcceptanceCase(record) {
  if (record === null || typeof record !== 'object') return false
  if (purposeOf(record.purpose) !== 'acceptance') return false
  if (record.automated === true) return true
  return record.degraded === true && typeof record.linkedTaskId === 'string' && record.linkedTaskId !== ''
}

/** A non-empty string, or null. */
function text(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * Why an acceptance case is refused, in the order it is reported.
 *
 * The FIRST reason is the specific fact; a generic "not verified" is last, because a closer who
 * reads "its status is not verified" about a case whose surface moved learns nothing.
 */
export const REASON_ORDER = [
  'DEGRADED',
  'RUN_ARTIFACT_MISSING',
  'RUN_MISMATCH',
  'TEST_CHANGED',
  'STALE',
  'NOT_WRONG_PRODUCT_RED',
  'REALISM_MISSING',
  'REALISM_UNSIGNED',
  'SELF_AUTHORED',
  'SELF_RUN',
  'NOT_MEASURED',
  'UNKNOWN_PRESET',
  'IMPLEMENTER_UNKNOWN',
  'LEGACY_NO_AUTHOR',
  'LEGACY_NO_RUN_BY',
  'SURFACE_FILES_MISSING',
  'TEST_HASH_MISSING',
  'NOT_VERIFIED',
]

/** The wording for each reason, for a human or a CLI line. */
export const REASONS = {
  DEGRADED: 'its test file is gone, so the case was degraded to documented-only',
  RUN_ARTIFACT_MISSING: 'the run it names left no artifact (docs/cases/runs/<case>/<runId>/run.json)',
  RUN_MISMATCH: 'the run artifact does not match the recorded run',
  TEST_CHANGED: 'its test file changed after the verification',
  STALE: 'a surface file changed after the verification',
  REALISM_UNSIGNED: 'nobody independent confirmed that its scenario is real (no realism sign-off)',
  SELF_AUTHORED: 'the case was authored by the implementer',
  SELF_RUN: 'the case was run by the implementer',
  NOT_MEASURED: 'the last confirmation was reported manually, not measured by a run',
  UNKNOWN_PRESET: 'its author or its run is not a known preset, so independence cannot be established',
  IMPLEMENTER_UNKNOWN: 'the implementer preset is unknown, so independence cannot be established',
  LEGACY_NO_AUTHOR: 'the case records no author',
  LEGACY_NO_RUN_BY: 'the case records no preset for the run that verified it',
  SURFACE_FILES_MISSING: 'it names no surface files, so a changed surface cannot be noticed',
  CASE_MISSING: 'the task links to a case that is not in the library',
  CASE_FOREIGN: 'it belongs to another task, so its evidence is about other work',
  CASE_UNLINKED: 'it names no task, so the task row cannot claim it',
  CASE_NOT_ACCEPTANCE: 'it is not an automated acceptance case, so it cannot close the task',
  TEST_HASH_MISSING: 'the case records no hash of its test file',
  NOT_VERIFIED: 'its status is not verified',
}

/** The sha256 of the stored command, the same value the runner writes into run.json. */
function commandHashOf(command) {
  return createHash('sha256').update(String(command ?? '')).digest('hex')
}

/**
 * Does the run the case claims to have been verified by exist on disk, and does it agree?
 *
 * @returns `null` when there is nothing to check (no runner verification claimed), otherwise
 *   `{ code, detail }` with code RUN_ARTIFACT_MISSING or RUN_MISMATCH.
 */
function artifactMismatch(record, dir, lastVerified, expectedTaskId = null) {
  const runId = text(lastVerified?.runId)
  const runs = Array.isArray(record.runs) ? record.runs : []
  const run = runId === null
    ? undefined
    : runs.find((entry) => entry !== null && typeof entry === 'object' && entry.runId === runId)
  if (runId === null || run === undefined || run.mode !== 'green' || run.passed !== true) {
    return { code: 'RUN_ARTIFACT_MISSING', detail: runId === null ? 'the verification names no run' : `run ${runId} is not in the record as a passing green run` }
  }
  const path = join(dir, 'runs', record.id, runId, 'run.json')
  if (!existsSync(path)) return { code: 'RUN_ARTIFACT_MISSING', detail: `no artifact at ${path}` }
  let artifact
  try {
    artifact = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return { code: 'RUN_ARTIFACT_MISSING', detail: `the artifact is not readable JSON: ${error.message}` }
  }
  const runBy = lastVerified?.runBy !== null && typeof lastVerified?.runBy === 'object' ? lastVerified.runBy : null
  const mismatches = []
  if (artifact?.commandSha256 !== commandHashOf(record.runCommand)) mismatches.push('commandSha256')
  // The run must answer to the TASK BEING ASKED ABOUT: a run recorded for another task (or for
  // none) is evidence about a different row, however green it is. The question task is the one the
  // close asks about; the case's own link is the fallback when the caller asked about no task.
  if (expectedTaskId !== null && (artifact?.runBy?.taskId ?? null) !== expectedTaskId) {
    mismatches.push(`runBy.taskId (task ${expectedTaskId}, artifact ${String(artifact?.runBy?.taskId)})`)
  }
  if (artifact?.exitCode !== 0) mismatches.push(`exitCode ${String(artifact?.exitCode)}`)
  if (artifact?.passed !== true) mismatches.push('passed')
  if ((artifact?.runBy?.preset ?? null) !== (runBy?.preset ?? null)) mismatches.push('runBy.preset')
  if ((artifact?.runBy?.sessionId ?? null) !== (runBy?.sessionId ?? null)) mismatches.push('runBy.sessionId')
  if (artifact?.runId !== runId) mismatches.push('runId')
  if (mismatches.length === 0) return null
  return { code: 'RUN_MISMATCH', detail: `${path} disagrees on ${mismatches.join(', ')}` }
}

/**
 * The acceptance verdict for one case, with its provenance.
 *
 * @param record - A stored case record (any status).
 * @param options - `{ workspace, dir, implementerPreset, knownPresets, hash }`; `dir` is the
 *   absolute case library root (default `<workspace>/docs/cases`), `knownPresets` defaults to
 *   {@link KNOWN_PRESETS}, `hash` overrides the file hasher.
 * @returns The evidence object; `blocked` is true when `reasons` is not empty.
 */
export function acceptanceOf(record, options = {}) {
  const workspace = text(options.workspace) ?? process.cwd()
  const dir = text(options.dir) ?? join(workspace, 'docs', 'cases')
  const hashOptions = typeof options.hash === 'function' ? { hash: options.hash } : {}
  const implementerPreset = text(options?.implementerPreset)
  const known = new Set((Array.isArray(options?.knownPresets) ? options.knownPresets : KNOWN_PRESETS).map((value) => String(value)))
  const lastVerified = record.lastVerified !== null && typeof record.lastVerified === 'object' ? record.lastVerified : null
  const runBy = lastVerified?.runBy !== null && typeof lastVerified?.runBy === 'object' ? lastVerified.runBy : null
  const authorPreset = text(record.authorPreset) ?? text(record.createdBy)
  const runPreset = text(runBy?.preset)
  const hashes = testHashState(record, workspace, hashOptions)
  const drift = driftFor(record, workspace, hashOptions)
  const claimedRunner = lastVerified !== null && lastVerified.source === 'runner'
  const ownTask = typeof record.linkedTaskId === 'string' && record.linkedTaskId !== '' ? record.linkedTaskId : null
  const expectedTaskId = text(options?.taskId) ?? ownTask
  const artifact = claimedRunner ? artifactMismatch(record, dir, lastVerified, expectedTaskId) : null
  const surfaceCount = Array.isArray(record.surfaceFiles) ? record.surfaceFiles.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.path === 'string' && entry.path !== '').length : 0
  const found = new Set()
  if (record.automated !== true || record.degraded === true) found.add('DEGRADED')
  if (artifact?.code === 'RUN_ARTIFACT_MISSING') found.add('RUN_ARTIFACT_MISSING')
  if (artifact?.code === 'RUN_MISMATCH') found.add('RUN_MISMATCH')
  if (hashes.recorded !== null && !hashes.ok) found.add('TEST_CHANGED')
  if (record.status === 'stale' || drift.status === 'stale') found.add('STALE')
  // FR6: THE RED THAT COUNTS. A negative-control red proves the CHECK can fail; only a failure
  // against another version proves the check is about THIS product. The driver self-check alone is
  // not acceptance evidence.
  if (lastVerified !== null || record.status === 'verified') {
    const red = record.redFirst !== null && typeof record.redFirst === 'object' ? record.redFirst : null
    const redTree = text(red?.cwd)
    const redHead = text(red?.head)
    // The green run's commit, so "the red was against another version" is a fact and not a hope.
    const greenRunId = text(lastVerified?.runId)
    const greenRun = greenRunId === null ? undefined : (Array.isArray(record.runs) ? record.runs : []).find((entry) => entry !== null && typeof entry === 'object' && entry.runId === greenRunId)
    const greenHead = text(greenRun?.head)
    const redIsReal = red !== null
      && red.source === 'wrong-product'
      && redTree !== null
      && resolve(redTree) !== resolve(workspace)
      && redHead !== null
      && (greenHead === null || greenHead !== redHead)
    if (!redIsReal) found.add('NOT_WRONG_PRODUCT_RED')
  }
  // FR5: the claim itself. A case that does not say what it catches, through which input, with
  // which oracle and from which real source cannot be audited by anyone.
  if (['failsWhen', 'trigger', 'oracle', 'realism'].some((field) => text(record[field]) === null)) found.add('REALISM_MISSING')
  // S4 is a HUMAN JUDGEMENT, and this is its mechanical shadow: an INDEPENDENT task counts only a
  // case whose realism somebody other than its author confirmed. The field is a sign-off, not a
  // guarantee - what it buys is that the question was asked by a named party.
  const signedBy = text(record.realismReviewedBy)
  const signedAt = text(record.realismReviewedAt)
  if (options.requireRealismSignoff === true && (signedBy === null || signedAt === null || (authorPreset !== null && signedBy.toLowerCase() === authorPreset.toLowerCase()))) found.add('REALISM_UNSIGNED')
  if (authorPreset !== null && implementerPreset !== null && authorPreset === implementerPreset) found.add('SELF_AUTHORED')
  if (runPreset !== null && implementerPreset !== null && runPreset === implementerPreset) found.add('SELF_RUN')
  if (lastVerified === null || lastVerified.source !== 'runner') found.add('NOT_MEASURED')
  if ((authorPreset !== null && !known.has(authorPreset)) || (runPreset !== null && !known.has(runPreset))) found.add('UNKNOWN_PRESET')
  if (implementerPreset === null) found.add('IMPLEMENTER_UNKNOWN')
  if (authorPreset === null) found.add('LEGACY_NO_AUTHOR')
  if (runBy === null) found.add('LEGACY_NO_RUN_BY')
  if (surfaceCount === 0) found.add('SURFACE_FILES_MISSING')
  if (hashes.recorded === null) found.add('TEST_HASH_MISSING')
  if (record.status !== 'verified') found.add('NOT_VERIFIED')
  const reasons = REASON_ORDER.filter((code) => found.has(code))
  return {
    id: record.id,
    status: record.status,
    purpose: purposeOf(record.purpose),
    authorPreset,
    runBy: runBy === null ? null : { preset: runPreset, sessionId: text(runBy.sessionId), taskId: text(runBy.taskId) },
    source: text(lastVerified?.source),
    at: text(lastVerified?.at),
    runId: text(lastVerified?.runId),
    testHashOk: hashes.ok,
    surfaceFiles: surfaceCount,
    // The claim, returned with the evidence so a reviewer can judge the REALISM, not just the
    // fields (D-REALISM-HUMAN: presence is checkable here, plausibility is a person's judgement).
    realism: {
      failsWhen: text(record.failsWhen),
      trigger: text(record.trigger),
      oracle: text(record.oracle),
      realism: text(record.realism),
    },
    redSource: text(record.redFirst?.source),
    drift: drift.status,
    ...(artifact === null ? {} : { artifact: artifact.code, artifactDetail: artifact.detail }),
    ...(typeof drift.reason === 'string' && drift.reason !== '' ? { driftReason: drift.reason } : {}),
    reasons,
    blocked: reasons.length > 0,
  }
}


/**
 * The verdict for a task or a case, from the library rows.
 *
 * TWO WAYS TO KNOW WHICH CASES A TASK OWES, and the difference is deliberate:
 *   - `caseIds` (an ARRAY): the task row names its cases. Only those are judged. A named id that is
 *     not in the library is `CASE_MISSING` - deleting the file cannot close the task; an unreadable
 *     named file blocks THAT task alone; an id that is not an automated acceptance case cannot close
 *     it (`CASE_NOT_ACCEPTANCE`). An EMPTY array is a task that owes no case (L0/L1, or a task with
 *     no acceptance case at all), and that is a legitimate green.
 *   - `caseIds` ABSENT (a row written before the link existed): fall back to the scan by
 *     `linkedTaskId`, where an unreadable file blocks every task question - its link is inside the
 *     file nobody can read. That fallback is why unrelated broken files can still block a legacy
 *     workspace, and why the row-level link is the fix.
 */
export function gateRows(rows, options = {}) {
  const workspace = text(options.workspace) ?? process.cwd()
  const dir = text(options.dir) ?? join(workspace, 'docs', 'cases')
  const taskId = text(options.taskId) ?? undefined
  const id = text(options.id) ?? undefined
  const implementerPreset = text(options.implementerPreset)
  const base = { workspace, dir, implementerPreset, knownPresets: options.knownPresets, ...(taskId === undefined ? {} : { taskId }), ...(options.requireRealismSignoff === true ? { requireRealismSignoff: true } : {}) }
  const rowsById = new Map()
  for (const row of rows) {
    const rowId = row.record === undefined ? row.id : row.record.id
    if (rowId !== undefined) rowsById.set(rowId, row)
  }
  const blockers = []
  const evidence = []
  const errors = []
  const unreadableOf = (rowId, row) => ({ id: rowId, code: row.error, message: 'the case file could not be read, so its evidence cannot be judged' })
  const blockerOf = (record, verdict) => ({
    id: record.id,
    status: record.status,
    reason: verdict.reasons[0] ?? null,
    reasons: verdict.reasons,
    provenance: verdict.source,
    lastVerified: record.lastVerified ?? null,
    purpose: verdict.purpose,
    authorPreset: verdict.authorPreset,
    runBy: verdict.runBy,
    testHashOk: verdict.testHashOk,
    drift: verdict.drift,
    ...(verdict.artifact === undefined ? {} : { artifact: verdict.artifact }),
    ...(verdict.surfaceFiles === 0 ? { surfaceFiles: 0 } : {}),
  })
  if (Array.isArray(options.caseIds)) {
    const wanted = [...new Set(options.caseIds.filter((value) => typeof value === 'string' && value.trim() !== '').map((value) => value.trim()))]
    for (const caseId of wanted) {
      const row = rowsById.get(caseId)
      if (row === undefined) {
        blockers.push({ id: caseId, status: 'missing', reason: 'CASE_MISSING', reasons: ['CASE_MISSING'], linkedTaskId: taskId ?? null })
        continue
      }
      if (row.record === undefined) {
        errors.push(unreadableOf(caseId, row))
        continue
      }
      const record = row.record
      // A CASE NAMED BY THIS TASK MUST BELONG TO THIS TASK. Otherwise any row could borrow another
      // row's measured case by adding its id: the evidence would be real and about the wrong work.
      if (taskId !== undefined) {
        const own = typeof record.linkedTaskId === 'string' && record.linkedTaskId !== '' ? record.linkedTaskId : null
        if (own === null) {
          blockers.push({ id: caseId, status: record.status, reason: 'CASE_UNLINKED', reasons: ['CASE_UNLINKED'], linkedTaskId: null, questionTaskId: taskId })
          continue
        }
        if (own !== taskId) {
          blockers.push({ id: caseId, status: record.status, reason: 'CASE_FOREIGN', reasons: ['CASE_FOREIGN'], linkedTaskId: own, questionTaskId: taskId })
          continue
        }
      }
      if (!isAcceptanceCase(record)) {
        blockers.push({
          id: caseId,
          status: record.status,
          purpose: purposeOf(record.purpose),
          reason: 'CASE_NOT_ACCEPTANCE',
          reasons: ['CASE_NOT_ACCEPTANCE'],
          linkedTaskId: taskId ?? null,
        })
        continue
      }
      const verdict = acceptanceOf(record, base)
      evidence.push(verdict)
      if (verdict.blocked) blockers.push(blockerOf(record, verdict))
    }
    return { ok: blockers.length === 0 && errors.length === 0, blockers, evidence, errors, linked: wanted }
  }
  let asked = false
  for (const row of rows) {
    const rowId = row.record === undefined ? row.id : row.record.id
    if (id !== undefined && rowId !== id) continue
    if (id !== undefined) asked = true
    if (row.record === undefined) {
      errors.push(unreadableOf(rowId, row))
      continue
    }
    const record = row.record
    if (taskId !== undefined && record.linkedTaskId !== taskId) continue
    if (!isAcceptanceCase(record)) continue
    const verdict = acceptanceOf(record, base)
    evidence.push(verdict)
    if (verdict.blocked) blockers.push(blockerOf(record, verdict))
  }
  // A question about ONE case that is not in the library is a refusal, not a green: "no blocker
  // among the rows I found" answers a different question than "this case is acceptable".
  if (id !== undefined && !asked) {
    blockers.push({ id, status: 'missing', reason: 'CASE_MISSING', reasons: ['CASE_MISSING'], linkedTaskId: taskId ?? null })
  }
  return { ok: blockers.length === 0 && errors.length === 0, blockers, evidence, errors }
}

