/**
 * Ratchet state: the durable artifacts that turn "nothing threw" into "the log
 * says it passed".
 *
 * Every other ratchet module answers a question. This one records the answer, and
 * the recording is not bookkeeping — it is the enforcement mechanism. Three
 * properties depend on it:
 *
 * 1. **A gate nobody can read is not a gate.** `ratchet_verify` returns a value
 *    to the agent that called it, and that value scrolls away. The report file is
 *    what a human, a CI job or a later agent can read to learn whether the code
 *    was verified against the laws currently in force.
 * 2. **`VERIFY_NOT_RUN` is only checkable with state.** Storing the spec hash a
 *    verification judged is what lets a later reader notice that the laws have
 *    changed since. Without it, "was this verified?" is unanswerable, and an
 *    unanswerable question becomes an assumed yes.
 * 3. **The ledger is the audit trail.** Append-only JSON Lines, one event per
 *    operation, so a sequence of ratchet runs can be reconstructed after the fact
 *    rather than inferred from whichever report happened to survive.
 *
 * Writes are atomic-by-rename: a report is written to a temporary name in the
 * same directory and then renamed over the target. A half-written report is worse
 * than no report, because a reader cannot tell the difference between "the gate
 * failed" and "the gate was interrupted".
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { normaliseText } from './ratchet-schema.mjs'

/** Report and state file locations, relative to the project root. */
export const STATE_PATHS = Object.freeze({
  specBundle: '.dsh/ratchet/specs.json',
  state: '.dsh/ratchet/state.json',
  ledger: '.dsh/ratchet/ledger.jsonl',
  compileReport: 'reports/ratchet/compile-report.json',
  verifyReport: 'reports/ratchet/verify-report.json',
  dynamicReport: 'reports/ratchet/dynamic-review.json',
})

/** Bundle format version for the persisted spec bundle. */
export const PERSISTED_BUNDLE_VERSION = 1

/**
 * Writes a file, creating its directory, via a temporary name and a rename.
 *
 * @param root - Absolute project root.
 * @param path - Repository-relative path to write.
 * @param text - Full text.
 * @returns `{ path, bytes }`.
 */
export function writeArtifact(root, path, text) {
  const absolute = join(root, path)
  mkdirSync(dirname(absolute), { recursive: true })
  const temporary = `${absolute}.tmp-${process.pid}`
  writeFileSync(temporary, text, 'utf8')
  renameSync(temporary, absolute)
  return { path, bytes: Buffer.byteLength(text, 'utf8') }
}

/**
 * Reads a JSON artifact.
 *
 * @param root - Absolute project root.
 * @param path - Repository-relative path.
 * @returns `{ value }` or `{ missing: true }` or `{ error }`. The three cases are
 *   distinct on purpose: "no verification has ever run" and "the last
 *   verification wrote something unreadable" need different responses.
 */
export function readJsonArtifact(root, path) {
  const absolute = join(root, path)
  if (!existsSync(absolute)) return { missing: true }
  try {
    const text = normaliseText(readFileSync(absolute, 'utf8'))
    return { value: JSON.parse(text), text }
  } catch (error) {
    return { error: String(error) }
  }
}

/**
 * Reads the persisted machine-readable spec bundle.
 *
 * @param root - Absolute project root.
 * @returns See {@link readJsonArtifact}.
 */
export function readSpecBundle(root) {
  return readJsonArtifact(root, STATE_PATHS.specBundle)
}

/**
 * Reads the ratchet state file.
 *
 * @param root - Absolute project root.
 * @returns See {@link readJsonArtifact}.
 */
export function readState(root) {
  return readJsonArtifact(root, STATE_PATHS.state)
}

/**
 * Appends one structured event to the ledger.
 *
 * Append-only JSON Lines: one object per line, never rewritten, so the file can be
 * tailed while the ratchet runs and reconstructed after a crash. A ledger that
 * cannot be appended to is reported on stderr and does not fail the operation —
 * losing the audit line is bad, failing the gate because of it is worse.
 *
 * @param root - Absolute project root.
 * @param event - Event name, e.g. `ratchet.verify.finish`.
 * @param fields - Additional JSON-safe fields.
 * @returns `{ written, path }` or `{ error }`.
 */
export function appendLedger(root, event, fields = {}) {
  const path = STATE_PATHS.ledger
  const absolute = join(root, path)
  const record = { event, at: new Date().toISOString(), ...fields }
  let line
  try {
    line = `${JSON.stringify(record)}\n`
  } catch (error) {
    return { error: `event ${event} is not lossless JSON: ${String(error)}` }
  }
  // `JSON.stringify` silently DROPS a function, a symbol or an `undefined` value
  // rather than throwing, so the try/catch above cannot see a non-lossless record
  // — it just writes a shorter one. Round-tripping and comparing keys is what
  // makes "the ledger records what happened" true rather than likely: a dropped
  // field is a fact that quietly never got audited.
  let roundTripped
  try {
    roundTripped = JSON.parse(line)
  } catch (error) {
    return { error: `event ${event} did not round-trip: ${String(error)}` }
  }
  const lost = Object.keys(record).filter((key) => !(key in roundTripped))
  if (lost.length > 0) {
    return { error: `event ${event} would lose non-JSON fields: ${lost.join(', ')}` }
  }
  try {
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, line, { encoding: 'utf8', flag: 'a' })
    return { written: true, path }
  } catch (error) {
    process.stderr.write(`ratchet: cannot append to ${path}: ${String(error)}\n`)
    return { error: String(error) }
  }
}

/**
 * Reads the ledger back, skipping unreadable lines.
 *
 * @param root - Absolute project root.
 * @returns `{ events, skipped }`; a damaged line is counted, never thrown, so one
 *   bad append cannot make the whole history unreadable.
 */
export function readLedger(root) {
  const absolute = join(root, STATE_PATHS.ledger)
  if (!existsSync(absolute)) return { events: [], skipped: 0, missing: true }
  let text
  try {
    text = normaliseText(readFileSync(absolute, 'utf8'))
  } catch (error) {
    return { events: [], skipped: 0, error: String(error) }
  }
  const events = []
  let skipped = 0
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      skipped += 1
    }
  }
  return { events, skipped }
}

/**
 * Persists the spec bundle and the compile report.
 *
 * @param root - Absolute project root.
 * @param options - `{ bundle, report, specFiles }`; `specFiles` maps a
 *   repository-relative path to generated text and is written when present.
 * @returns `{ written, ledger }` — the repository-relative paths written, and the
 *   ledger append result.
 */
export function persistCompile(root, { bundle, report, specFiles = null }) {
  const written = []
  if (bundle !== null) {
    written.push(
      writeArtifact(
        root,
        STATE_PATHS.specBundle,
        `${JSON.stringify({ version: PERSISTED_BUNDLE_VERSION, ...bundle }, null, 2)}\n`,
      ).path,
    )
  }
  for (const [path, text] of Object.entries(specFiles ?? {})) {
    written.push(writeArtifact(root, path, text).path)
  }
  written.push(
    writeArtifact(root, STATE_PATHS.compileReport, `${JSON.stringify(report, null, 2)}\n`).path,
  )
  const ledger = appendLedger(root, 'ratchet.compile.finish', {
    ok: report.problems.length === 0,
    activeAdrs: report.counts.active,
    laws: report.counts.laws,
    specHash: report.specHash,
    problems: report.problems.length,
    reviewRequired: report.reviewRequired.length,
  })
  return { written, ledger }
}

/**
 * Persists the verification report and updates the state file.
 *
 * The state file records the spec hash AND the code hash this verification JUDGED,
 * which is the only way a later reader can tell whether the verdict still applies.
 * The spec hash alone answered "which laws did you check against" and left the other
 * half unanswerable, so `status` reported a clean, verified project after arbitrary
 * edits to the code — the laws had not moved, so nothing in the record changed.
 *
 * @param root - Absolute project root.
 * @param options - `{ report, evaluatedSpecHash, toolVersion }`. `report.codeHash`
 *   is the tree the verifier read; when absent the record says so rather than
 *   implying the code was covered.
 * @returns `{ written, ledger }`.
 */
export function persistVerify(root, { report, evaluatedSpecHash, toolVersion = null }) {
  const written = [
    writeArtifact(root, STATE_PATHS.verifyReport, `${JSON.stringify(report, null, 2)}\n`).path,
  ]
  const evaluatedCodeHash = typeof report.codeHash === 'string' ? report.codeHash : null
  const previous = readState(root)
  const state = {
    version: 1,
    lastVerify: {
      at: report.generatedAt,
      ok: report.problems.length === 0,
      specHash: evaluatedSpecHash,
      codeHash: evaluatedCodeHash,
      errors: report.problems.length,
      filesWalked: report.counts.filesWalked,
      checksEvaluated: report.counts.checksEvaluated,
    },
    lastGoodVerify:
      report.problems.length === 0
        ? { at: report.generatedAt, specHash: evaluatedSpecHash, codeHash: evaluatedCodeHash }
        : (previous.value?.lastGoodVerify ?? null),
    toolVersion,
  }
  written.push(writeArtifact(root, STATE_PATHS.state, `${JSON.stringify(state, null, 2)}\n`).path)
  const ledger = appendLedger(root, 'ratchet.verify.finish', {
    ok: report.problems.length === 0,
    errors: report.problems.length,
    checksEvaluated: report.counts.checksEvaluated,
    filesWalked: report.counts.filesWalked,
    specHash: evaluatedSpecHash,
    codeHash: evaluatedCodeHash,
  })
  return { written, ledger }
}

/**
 * Reports what the recorded verification actually covered.
 *
 * A recorded run counts as verified only when it judged the CURRENT laws, evaluated
 * every check they declare, and judged the code that is on disk now. Each condition
 * closes a way for a green status to mean nothing:
 *
 *   - the law hash, because a decision edited after the run makes the verdict apply
 *     to a law that no longer exists;
 *   - the check count, because the tool surface deliberately supplies no command
 *     runner, so a session run evaluates the filesystem checks and leaves every
 *     `command` check pending — calling that verified made `status` report green
 *     over a corpus whose real enforcement had never run;
 *   - the code hash, because a verdict is about a tree. Without it, editing any file
 *     left `status` reporting a verified, clean project while `verify` on the same
 *     tree exited 1.
 *
 * @param root - Absolute project root.
 * @param currentSpecHash - Hash of the laws compiled now.
 * @param expectedChecks - How many checks the current laws declare, or `null` when
 *   the caller cannot say — in which case only the earlier conditions are applied.
 * @param currentCodeHash - Hash of the walked tree now, or `null` when the caller
 *   cannot say. A record written before code hashing existed has no code hash and is
 *   reported as not verified rather than assumed to match.
 * @returns `{ ran, stale, reason, recorded? }`. `ran` is true only for a complete
 *   evaluation of the current laws over the current code.
 */
export function verificationStatus(root, currentSpecHash, expectedChecks = null, currentCodeHash = null) {
  const state = readState(root)
  if (state.missing === true) {
    return { ran: false, stale: false, reason: `no ${STATE_PATHS.state} exists, so no verification has been recorded` }
  }
  if (state.error !== undefined) {
    return { ran: false, stale: false, reason: `${STATE_PATHS.state} could not be read: ${state.error}` }
  }
  const recorded = state.value?.lastVerify ?? null
  if (recorded === null) {
    return { ran: false, stale: false, reason: `${STATE_PATHS.state} records no verification` }
  }
  if ((recorded.checksEvaluated ?? 0) === 0) {
    return {
      ran: false,
      stale: false,
      reason: `the last verification at ${recorded.at} evaluated zero checks, so nothing about this project was actually verified`,
      recorded,
    }
  }
  if (recorded.specHash !== currentSpecHash) {
    return {
      ran: false,
      stale: true,
      reason: `the last verification judged spec ${recorded.specHash ?? '(none)'} at ${recorded.at}, but the current laws hash to ${currentSpecHash}; the decisions changed since the code was checked`,
      recorded,
    }
  }
  if (typeof expectedChecks === 'number' && (recorded.checksEvaluated ?? 0) < expectedChecks) {
    return {
      ran: false,
      stale: false,
      reason: `the last verification at ${recorded.at} evaluated ${recorded.checksEvaluated} of the ${expectedChecks} checks these laws declare; the rest could not be evaluated (a "command" check runs only when the caller supplies a command runner, which the tool surface deliberately does not)`,
      recorded,
    }
  }
  if (currentCodeHash !== null) {
    if (typeof recorded.codeHash !== 'string') {
      return {
        ran: false,
        stale: true,
        reason: `the last verification at ${recorded.at} recorded no code hash, so it cannot be tied to the code on disk; re-run the verify command`,
        recorded,
      }
    }
    if (recorded.codeHash !== currentCodeHash) {
      return {
        ran: false,
        stale: true,
        reason: `the code changed since the last verification at ${recorded.at}: it judged ${recorded.codeHash}, and the tree now hashes to ${currentCodeHash}`,
        recorded,
      }
    }
  }
  return { ran: true, stale: false, reason: null, recorded }
}

/**
 * Builds the ledger events one verification should leave behind.
 *
 * Returned as data rather than written here, so a caller can test the event
 * vocabulary without touching the filesystem — the same split the compiler uses
 * for spec rendering.
 *
 * @param report - A verification report.
 * @param specHash - Hash of the bundle that was judged.
 * @returns An array of event objects, each without its timestamp.
 */
export function verificationEvents(report, specHash) {
  const events = [
    { event: 'ratchet.verify.start', specHash, project: report.project ?? null },
  ]
  for (const problem of report.problems) {
    events.push({
      event: 'ratchet.code.violation',
      lawId: problem.lawId ?? null,
      code: problem.code,
      path: problem.path ?? null,
      severity: problem.severity,
    })
  }
  events.push({
    event: 'ratchet.verify.finish',
    ok: report.problems.length === 0,
    errors: report.problems.length,
    warnings: report.counts.warnings,
  })
  return events
}

/**
 * Reports whether the project tracks generated spec documents.
 *
 * "The specs directory is empty" and "somebody deleted our specs" are different
 * situations, and treating the first as the second makes every project that has
 * not opted into generated documents fail verification on the day it adopts the
 * ratchet. A project tracks specs once it has asked for them (`specsRequired`) or
 * once any generated document exists on disk — after which deleting one is drift.
 *
 * @param root - Absolute project root.
 * @param specsDir - Manifest-declared specs directory.
 * @param explicit - Value of `ratchet.specsRequired` when the manifest sets it.
 * @returns `true` when missing generated documents should be reported.
 */
export function tracksSpecDocuments(root, specsDir, explicit = undefined) {
  if (explicit === true) return true
  if (explicit === false) return false
  const directory = join(root, specsDir ?? 'docs/specs')
  if (!existsSync(directory)) return false
  try {
    return readdirSync(directory).some((entry) => entry.endsWith('.spec.md'))
  } catch {
    return false
  }
}

/**
 * Extracts the `spec-hash` a generated document records in its header.
 *
 * The header is the point of stamping one: it lets a reader decide whether a
 * document describes the laws currently in force WITHOUT regenerating it and
 * comparing every byte. Without reading it, a spec that is merely out of date —
 * structurally valid, unedited, but written from an older bundle — looks perfect.
 *
 * @param text - The document's text.
 * @returns The recorded hash, or `null` when the header carries none.
 */
export function recordedSpecHash(text) {
  const match = /<!--\s*spec-hash:\s*(sha256:[0-9a-f]{64})\s*-->/.exec(text)
  return match === null ? null : match[1]
}

/**
 * Detects drift between the generated spec files on disk and what the bundle
 * currently produces.
 *
 * Three distinct failures, each with its own message, because the fix differs:
 *   - `drifted`  — the file was edited; regenerate it, and find out who edited it.
 *   - `stale`    — the file is unedited but was generated from an older bundle, so
 *                  it describes laws that no longer exist.
 *   - `missing`  — the project tracks spec documents and one has gone.
 *
 * @param root - Absolute project root.
 * @param specFiles - Map of repository-relative path to the text the bundle would
 *   generate now.
 * @returns `{ drifted, stale, missing }`, each an array of path records.
 */
export function detectSpecDrift(root, specFiles) {
  const drifted = []
  const stale = []
  const missing = []
  for (const [path, expected] of Object.entries(specFiles ?? {})) {
    const absolute = join(root, path)
    if (!existsSync(absolute)) {
      missing.push(path)
      continue
    }
    let actual
    try {
      actual = normaliseText(readFileSync(absolute, 'utf8'))
    } catch (error) {
      drifted.push({ path, reason: `could not be read: ${String(error)}` })
      continue
    }
    if (actual === normaliseText(expected)) continue

    // The content differs. Either somebody edited the file, or it was generated
    // from an older bundle — and the header tells the two apart, which decides
    // whether the reader should look for an editor or simply regenerate.
    const recorded = recordedSpecHash(actual)
    const wanted = recordedSpecHash(expected)
    if (recorded !== null && wanted !== null && recorded !== wanted) {
      stale.push({ path, recorded, wanted })
    } else {
      drifted.push({ path, reason: 'content differs from the generated text' })
    }
  }
  return { drifted, stale, missing }
}

