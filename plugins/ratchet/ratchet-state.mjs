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
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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
  try {
    renameSync(temporary, absolute)
  } catch (error) {
    // The rename is the step that can fail where the temp write succeeded — the target
    // being a directory, a permission change between the two, an antivirus lock. Leaving
    // the temp file behind made the next reader's directory listing show a
    // `*.tmp-<pid>` sibling that looks like a half-written report, so it is removed
    // before the error is passed on.
    try {
      rmSync(temporary, { force: true })
    } catch {
      // Nothing further to do: the caller reports the rename failure either way.
    }
    throw error
  }
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
 * Writes the generated spec documents for one compile.
 *
 * Split out of {@link persistCompile} so the caller can write the documents BEFORE it
 * computes spec drift: drift describes the tree the caller now has, so computing it
 * first made a `--write` run report every file as missing and fail while creating exactly
 * the files it complained about. The reason it cannot simply move into `persistCompile`
 * is that the persisted report and the ledger's `ok` must carry the drift problems too —
 * a compile that exited 1 because a generated document was stale used to be recorded as
 * `ok: true` with no problems, because the report was written before drift was measured.
 *
 * @param root - Absolute project root.
 * @param specFiles - Map of repository-relative path to generated text.
 * @returns `{ written }` — the paths written, in the order given.
 */
export function writeSpecDocuments(root, specFiles) {
  const written = []
  for (const [path, text] of Object.entries(specFiles ?? {})) {
    written.push(writeArtifact(root, path, text).path)
  }
  return { written }
}

/**
 * Persists the spec bundle and the compile report.
 *
 * @param root - Absolute project root.
 * @param options - `{ bundle, report, specFiles, lawIds }`; `specFiles` maps a
 *   repository-relative path to generated text and is written when present. A caller
 *   that writes the documents itself (to measure drift between the write and the report)
 *   passes `null` and uses {@link writeSpecDocuments}.
 * @returns `{ written, ledger }` — the repository-relative paths written, and the
 *   ledger append result. `report.problems` is the FULL set the caller returned, so the
 *   ledger's `ok` and the `problems` count cannot disagree with the exit code.
 */
export function persistCompile(root, { bundle, report, specFiles = null, lawIds = null }) {
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
    // The law IDS, not the count. A count cannot tell a retirement from a deletion:
    // 19 laws becoming 18 looks the same whichever way it happened, and the persisted
    // bundle is overwritten by the very compile that would be asked about it. The
    // ledger is append-only, so it is the one place the previous set survives.
    //
    // A `null` here means the caller found an unexplained removal and is deliberately
    // NOT advancing the record. Omitting the field keeps the last known set in force
    // as the comparison base, so the problem keeps being reported until a decision
    // retires the law or it comes back — a run that recorded the shrunken set would
    // certify the deletion one command later.
    ...(Array.isArray(lawIds) ? { lawIds: [...lawIds].sort() } : {}),
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
export function persistVerify(root, { report, evaluatedSpecHash, toolVersion = null, lawIds = null }) {
  const written = [
    writeArtifact(root, STATE_PATHS.verifyReport, `${JSON.stringify(report, null, 2)}\n`).path,
  ]
  const evaluatedCodeHash = typeof report.codeHash === 'string' ? report.codeHash : null
  // The authority table, recorded with the laws and the tree: the three things a verdict
  // is about. Absent here, relaxing a zone's `agentAuthority` invalidated neither hash,
  // so `status` reported a verified project that the gate was failing.
  const evaluatedConfigHash = typeof report.configHash === 'string' ? report.configHash : null
  const previous = readState(root)
  const state = {
    version: 1,
    lastVerify: {
      at: report.generatedAt,
      ok: report.problems.length === 0,
      specHash: evaluatedSpecHash,
      codeHash: evaluatedCodeHash,
      configHash: evaluatedConfigHash,
      // Which tool judged this, and which revision of the tree. The report carries them
      // already; without them here a reader of `state.json` alone — the file `status`
      // reads — cannot tie the verdict to a version or a commit.
      toolVersion: toolVersion ?? null,
      vcsRevision: report.vcsRevision ?? null,
      errors: report.problems.length,
      filesWalked: report.counts.filesWalked,
      checksEvaluated: report.counts.checksEvaluated,
    },
    lastGoodVerify:
      report.problems.length === 0
        ? { at: report.generatedAt, specHash: evaluatedSpecHash, codeHash: evaluatedCodeHash, configHash: evaluatedConfigHash }
        : (previous.value?.lastGoodVerify ?? null),
    toolVersion,
  }
  written.push(writeArtifact(root, STATE_PATHS.state, `${JSON.stringify(state, null, 2)}\n`).path)
  const ledger = appendLedger(root, 'ratchet.verify.finish', {
    ok: report.problems.length === 0,
    errors: report.problems.length,
    checksEvaluated: report.counts.checksEvaluated,
    filesWalked: report.counts.filesWalked,
    // Recorded here as well as on compile: a verify is a run that observed a law set,
    // and a project that only ever verifies still needs a history to compare against.
    // Omitted when the caller found an unexplained removal — see `persistCompile`.
    ...(Array.isArray(lawIds) ? { lawIds: [...lawIds].sort() } : {}),
    specHash: evaluatedSpecHash,
    codeHash: evaluatedCodeHash,
    configHash: evaluatedConfigHash,
  })
  return { written, ledger }
}

/**
 * The law ids the most recent ledger entry recorded, or `null` when none did.
 *
 * Read backwards from the end of an append-only file, so the answer is the last set
 * any run observed rather than the current one — which is the whole point, since the
 * current set is what a deletion has already changed. `null` (no history) is a
 * distinct answer from `[]` (a corpus with no laws): the caller must not report
 * every law as newly added on a project that has simply never recorded a set.
 *
 * @param root - Absolute project root.
 * @returns A sorted copy of the recorded ids, or `null` when the ledger holds none.
 */
export function readRecordedLawIds(root) {
  let text
  try {
    text = readFileSync(join(root, STATE_PATHS.ledger), 'utf8')
  } catch {
    return null
  }
  const lines = text.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim() === '') continue
    let entry
    try {
      entry = JSON.parse(lines[index])
    } catch {
      // A torn final line is possible; keep walking rather than abandoning history.
      continue
    }
    if (Array.isArray(entry?.lawIds)) return [...entry.lawIds]
  }
  return null
}

/**
 * The law ids the persisted spec bundle names, or `null` when it names none.
 *
 * The ledger is the primary record of the previous law set, but the file itself can
 * be deleted and a missing ledger must not turn "a law was removed" into "no history".
 * This is the fallback the removal check reads then. `.dsh/ratchet/specs.json` is
 * rewritten only by `compile --write`, and the removal check runs BEFORE that rewrite,
 * so on the run that matters it still holds the set the project had. Deleting the
 * ledger alone therefore no longer launders a removal; deleting the bundle as well is
 * the unauthenticated-state gap no file-based check can close without signed history.
 *
 * @param root - Absolute project root.
 * @returns A sorted copy of the ids the persisted bundle records, or `null` when the
 *   bundle is absent, unreadable, or holds a law the reader cannot identify.
 */
export function readPersistedLawIds(root) {
  const read = readSpecBundle(root)
  if (read.missing === true || read.error !== undefined) return null
  const laws = read.value?.laws
  if (!Array.isArray(laws)) return null
  const ids = laws.map((law) => law?.id).filter((id) => typeof id === 'string')
  // A bundle with an unidentifiable law cannot be compared law-by-law: treating the
  // readable subset as the whole set would report every unnamed law as removed.
  if (ids.length !== laws.length) return null
  return [...ids].sort()
}

/**
 * The most recent verification the append-only ledger records, or `null`.
 *
 * The ledger writes one `ratchet.verify.finish` event per run, carrying the same `at`,
 * `checksEvaluated`, `specHash`, `codeHash` and `configHash` the state cache holds. Reading the
 * verdict here rather than from the mutable cache is what stops a hand-edited `state.json` from
 * certifying a tree the last run did not judge.
 *
 * @param root - Absolute project root.
 * @returns The event object, or `null` when the ledger holds none or cannot be read.
 */
function lastRecordedVerification(root) {
  const ledger = readLedger(root)
  const events = Array.isArray(ledger.events) ? ledger.events : []
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event !== null && typeof event === 'object' && event.event === 'ratchet.verify.finish') return event
  }
  return null
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
export function verificationStatus(root, currentSpecHash, expectedChecks = null, currentCodeHash = null, currentConfigHash = null) {  const state = readState(root)
  // The verdict is read from the APPEND-ONLY ledger first. `.dsh/ratchet/state.json` is a mutable
  // cache, and a hand-edit of it made `status` report a verified-clean project while `verify` on
  // the same tree exited 1. The ledger records every verification as it happens and is never
  // rewritten, so it is the copy to trust; the state file is the fallback for a project whose
  // history predates the event.
  const fromLedger = lastRecordedVerification(root)
  if (fromLedger === null && state.missing === true) {
    return {
      ran: false,
      stale: false,
      reason: `no ${STATE_PATHS.state} exists and ${STATE_PATHS.ledger} records no verification, so no verification has been recorded`,
    }
  }
  if (fromLedger === null && state.error !== undefined) {
    return { ran: false, stale: false, reason: `${STATE_PATHS.state} could not be read: ${state.error}` }
  }
  const recorded = fromLedger ?? state.value?.lastVerify ?? null
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
  // The authority table. ADR 0012's fourth rule: the zone table "cannot be relaxed
  // without the gate saying so". `.dsh/` is excluded from the walk, so neither hash above
  // moves when a zone's `agentAuthority` is widened — status called such a project
  // verified and current while `verify` was red on the tripwire law.
  if (currentConfigHash !== null) {
    if (typeof recorded.configHash !== 'string') {
      return {
        ran: false,
        stale: true,
        reason: `the last verification at ${recorded.at} recorded no authority table, so it cannot be tied to the zones the manifest declares now; re-run the verify command`,
        recorded,
      }
    }
    if (recorded.configHash !== currentConfigHash) {
      return {
        ran: false,
        stale: true,
        reason: `the authority table changed since the last verification at ${recorded.at}: the manifest now declares zones, authorities or directories that the verdict was not judged under (${recorded.configHash} → ${currentConfigHash})`,
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
 * ratchet. A project therefore tracks specs once ANY generated document exists on
 * disk, or once it asks for them with `ratchet.specsRequired: true`.
 *
 * `specsRequired: false` does NOT opt out once documents exist. It was read that way
 * once and the reading was wrong: the flag means "do not REQUIRE generated
 * documents", not "do not NOTICE the ones this project committed". Returning false
 * here suppressed the deleted-document problem and the stale-document problem
 * together, so a project could commit generated specs, let them drift from the
 * decisions they were compiled from, and still verify clean — the exact drift this
 * function exists to catch. Opting out of generated documents is done by not having
 * them.
 *
 * @param root - Absolute project root.
 * @param specsDir - Manifest-declared specs directory.
 * @param explicit - Value of `ratchet.specsRequired` when the manifest sets it.
 *   Only `true` short-circuits; `false` and `undefined` both fall through to the
 *   on-disk test.
 * @returns `true` when missing generated documents should be reported; `false` when
 *   the directory is absent or unreadable. Never throws.
 */
export function tracksSpecDocuments(root, specsDir, explicit = undefined) {
  if (explicit === true) return true
  const directory = join(root, specsDir ?? 'docs/specs')
  try {
    if (existsSync(directory) && readdirSync(directory).some((entry) => entry.endsWith('.spec.md'))) return true
  } catch {
    // An unreadable directory is not evidence that the project has no documents.
  }
  // A project that has EVER tracked specs keeps tracking them. The persisted bundle is the
  // evidence, and without this clause deleting the LAST generated document switched the guarantee
  // off silently: the on-disk test above asks whether any document exists, so removing the only one
  // answered "no" and the deletion became invisible. That is the same drift this function exists to
  // catch, reachable by deleting one file.
  return existsSync(join(root, STATE_PATHS.specBundle))
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
export function detectSpecDrift(root, specFiles, specsDir = null) {
  const drifted = []
  const stale = []
  const missing = []
  const orphaned = []
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

  // A generated document the CURRENT bundle no longer renders. Renaming or removing a
  // zone changes the generated filename, and a comparison driven only by the files the
  // bundle wants never looks at the old one — so a stale document describing laws that
  // no longer exist survived a green verify. A file counts as ours only when it carries
  // the compile banner or a recorded spec hash, so a hand-written document beside them
  // is not reported as generated output.
  const directory = specsDir ?? (Object.keys(specFiles ?? {}).map((path) => dirname(path))[0] ?? null)
  if (directory !== null) {
    const expectedPaths = new Set(Object.keys(specFiles ?? {}))
    let entries = []
    try {
      entries = readdirSync(join(root, directory))
    } catch {
      entries = []
    }
    for (const entry of entries) {
      if (!entry.endsWith('.spec.md')) continue
      const path = `${directory}/${entry}`
      if (expectedPaths.has(path)) continue
      let text
      try {
        text = normaliseText(readFileSync(join(root, path), 'utf8'))
      } catch {
        continue
      }
      const recorded = recordedSpecHash(text)
      if (recorded === null && !text.includes('GENERATED BY ratchet compile')) continue
      orphaned.push({ path, recorded })
    }
  }
  return { drifted, stale, missing, orphaned }
}

