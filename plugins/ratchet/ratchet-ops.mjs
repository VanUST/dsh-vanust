/**
 * Ratchet operations: the four things the ratchet does, as functions of a root.
 *
 * Until this module existed, "compile" and "verify" lived inside tool bodies, so
 * the only way to exercise them was to boot a harness, build a fake context and
 * dispatch a call. That made the sentence "the gate fails when it should" a claim
 * about a tool declaration rather than about the gate. Extracting the operations
 * makes the gate callable from a shell, from a test and from a tool — and one code
 * path means the three cannot disagree about what "verified" means.
 *
 * The dependency direction is deliberate: `ratchet-tools.mjs` imports this module,
 * never the reverse. A tool is an adapter over an operation, so an operation that
 * needed a tool would be a module that cannot be tested without the harness it was
 * extracted from.
 *
 * Every operation returns a canonical, JSON-safe result with an `ok` field and
 * resolves rather than throwing for a project-level problem. A missing manifest, an
 * uncompilable corpus and a failed verification are ordinary outcomes a caller must
 * branch on; an exception would force every caller to reconstruct that distinction
 * from a stack trace.
 */
import { execFile as execFileCallback } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { MANIFEST_PATH, PROBLEM_CODES, UNUSABLE_PROBLEM_CODES, hashSource, normaliseText, parseAdr, problem } from './ratchet-schema.mjs'
import {
  compileProject,
  comparePersistedBundle,
  readAdrCorpus,
  readManifest,
  renderSpecs,
  resolveActiveSet,
  specDriftProblems,
} from './ratchet-compiler.mjs'
import { DEFAULT_COMMAND_TIMEOUT_MS, codeHashFor, configHashFor, listFiles, verifyProject } from './ratchet-verifier.mjs'
import * as state from './ratchet-state.mjs'
import * as dynamic from './ratchet-dynamic.mjs'
import * as ingestModule from './ratchet-ingest.mjs'
import {
  STATE_PATHS,
  appendLedger,
  detectSpecDrift,
  persistCompile,
  writeSpecDocuments,
  persistVerify,
  readSpecBundle,
  verificationStatus,
} from './ratchet-state.mjs'
import { bootstrapApply, bootstrapPreview } from './ratchet-bootstrap.mjs'
import {
  RATIFY_CHANNEL,
  buildQuiz,
  deriveDecisions,
  nextApprovalId,
  offeredBy,
  ratificationQueue,
  renderApprovalAdr,
  renderTranscript,
  transcriptPathFor,
  writeRatification,
} from './ratchet-ratify.mjs'

/** Promisified execFile, so the command runner can await a process without a shell. */
const execFileAsync = promisify(execFileCallback)

/**
 * Laws that were in force and are gone, with no active record retiring them.
 *
 * The comparison is against the law set the LEDGER last recorded, not against the
 * persisted bundle: `compile --write` rewrites that bundle, so asking it "were you
 * missing a law?" is asking the overwritten copy. The ledger is append-only and is
 * therefore the only artifact a deletion does not rewrite — which is exactly why the
 * check has to read it.
 *
 * A first run on a project with no recorded history returns nothing rather than
 * everything: `null` from the reader means "no set was ever recorded", while `[]`
 * means "a set with no laws", and only the first may be treated as unknown.
 *
 * @param root - Absolute project root.
 * @param compiled - The result of compiling the corpus.
 * @returns An array of problems; empty when no law left force, or when each one left
 *   through an active record's explicit `remove` op.
 */
function lawRemovalProblems(root, compiled) {
  const previous = state.readRecordedLawIds(root)
  if (previous === null) return []
  // A corpus that did not compile has no law set to compare against: with an unreadable
  // manifest every law "disappeared", so this reported all twenty-three of them as
  // removed without a decision — twenty-three findings that say nothing about the code
  // and bury the one real problem. The comparison needs a bundle; without one it is not
  // made.
  if (compiled.bundle === null) return []
  const current = new Set((compiled.bundle?.laws ?? []).map((law) => law.id))
  const retired = new Set(compiled.removedByDecision ?? [])
  return previous
    .filter((id) => !current.has(id) && !retired.has(id))
    .sort()
    .map((id) =>
      problem(
        'LAW_REMOVED_WITHOUT_DECISION',
        `law "${id}" was in force and is no longer compiled, and no active record removes it; deleting the record that declared it retires a constraint without a decision, so retire it with an explicit "op: remove" or restore it`,
        id,
        { lawId: id },
      ),
    )
}

/**
 * The spec drift the gate reports, filtered by whether the project tracks documents.
 *
 * A MISSING document is only a problem when the project tracks specs, because
 * otherwise every project that has not opted into generated documents fails on the
 * day it adopts the ratchet. An EDITED or STALE document is a problem either way:
 * both describe a file that exists on disk and disagrees with the laws, and
 * suppressing them was once the difference between a green gate and a corpus whose
 * human-readable view was silently wrong.
 *
 * @param tracks - Whether missing documents should be reported.
 * @param drift - Result of comparing generated text with disk.
 * @returns The drift subset the gate should turn into problems.
 */
function reportedSpecDrift(tracks, drift) {
  if (tracks) return drift
  return { drifted: drift.drifted, stale: drift.stale, missing: [], orphaned: drift.orphaned ?? [] }
}

/** Process exit codes, so the shell gate and the tools agree on one vocabulary. */
export const EXIT = Object.freeze({
  /** Nothing to report. */
  OK: 0,
  /** The ratchet ran and reported problems. This is the gate failing. */
  PROBLEMS: 1,
  /** The project or its decisions are unusable, so nothing was checked. */
  CONFIG: 2,
})

/**
 * Counts problems by code.
 *
 * @param problems - Problem records.
 * @returns `{ total, byCode }` with codes ordered by descending frequency then
 *   alphabetically, so a report reads the same way twice.
 */
export function summariseProblems(problems) {
  const byCode = new Map()
  for (const entry of problems) byCode.set(entry.code, (byCode.get(entry.code) ?? 0) + 1)
  return {
    total: problems.length,
    byCode: Object.fromEntries(
      [...byCode.entries()].sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1)),
    ),
  }
}

/**
 * The ratchet's own version, read from its package manifest.
 *
 * Recorded with every verification because a verdict is only interpretable against the
 * tool that produced it: a check vocabulary or a verdict rule can change between
 * versions, and `state.json` used to carry `toolVersion: null` forever, so a reader
 * could not tell which ratchet had judged anything.
 *
 * @returns The version string, or `null` when the manifest cannot be read. Never throws.
 */
function ratchetToolVersion() {
  for (const candidate of ['../package.json', './package.json']) {
    try {
      const manifest = JSON.parse(readFileSync(new URL(candidate, import.meta.url), 'utf8'))
      if (typeof manifest.version === 'string') return manifest.version
    } catch {
      // Try the next candidate: a bundled copy may sit at a different depth.
    }
  }
  return null
}

/**
 * The VCS revision of the tree, read from `.git` without spawning git.
 *
 * `codeHash` proves the tree changed; it cannot say WHAT it changed to in terms a human
 * recognises. A short revision in the report and the state turns "the code moved" into a
 * reference someone can look at, and costs one file read.
 *
 * @param root - Absolute project root.
 * @returns The short revision, or `null` for a tree that is not a git checkout (or a
 *   `.git` file, as a worktree or submodule has). Never throws.
 */
function vcsRevisionFor(root) {
  try {
    const head = normaliseText(readFileSync(join(root, '.git', 'HEAD'), 'utf8')).trim()
    const match = /^ref:\s*(.+)$/.exec(head)
    if (match === null) return head.length > 0 ? head.slice(0, 12) : null
    const ref = match[1].trim()
    try {
      const loose = normaliseText(readFileSync(join(root, '.git', ref), 'utf8')).trim()
      return loose.length > 0 ? loose.slice(0, 12) : null
    } catch {
      // A `git gc` packs refs and deletes `.git/refs/heads/<branch>`, so a healthy
      // repository has no loose ref to read and used to report "no VCS revision".
      const packed = normaliseText(readFileSync(join(root, '.git', 'packed-refs'), 'utf8'))
      const line = packed.split('\n').find((entry) => entry.endsWith(` ${ref}`))
      const sha = line === undefined ? null : line.trim().split(/\s+/)[0]
      return sha !== null && /^[0-9a-f]{7,40}$/.test(sha) ? sha.slice(0, 12) : null
    }
  } catch {
    return null
  }
}

/**
 * Resolves a project root by ascending from a starting directory.
 *
 * Verification is done on the START directory rather than trusting the walk:
 * `existsSync` on a relative path would answer for the process directory, which is
 * how a tool that searched "upward" ends up reporting on wherever the harness was
 * launched from.
 *
 * @param start - Directory to begin at.
 * @returns The absolute root, or `null` when no manifest is found within 40 levels
 *   — a bound that stops the walk escaping into an unrelated parent tree.
 */
export function findRoot(start) {
  let current = resolve(start)
  for (let depth = 0; depth < 40; depth += 1) {
    if (existsSync(join(current, MANIFEST_PATH))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
  return null
}

/**
 * Reports the ratchet state of a project without changing it.
 *
 * @param root - Absolute project root.
 * @returns The canonical status result. Always resolves: a project with no
 *   manifest is a status, not an error.
 */
export function status(root) {
  const manifest = readManifest(root)
  const compiled = compileProject(root)

  const persistedBundle = readSpecBundle(root)
  const persistedValue =
    persistedBundle.value === undefined
      ? null
      : {
          version: persistedBundle.value.version,
          project: persistedBundle.value.project,
          laws: persistedBundle.value.laws,
        }
  const comparison =
    compiled.bundle === null
      ? { stale: true, problems: [] }
      : comparePersistedBundle(persistedValue, compiled.bundle)
  // `checksExpected` is what makes "verified" mean the whole law set: a run that
  // evaluated some checks and left the rest pending is recorded, and this is what
  // stops `status` from reading it as a clean verification.
  const checksExpected =
    compiled.bundle === null
      ? null
      : compiled.bundle.laws.reduce((total, law) => total + (Array.isArray(law.checks) ? law.checks.length : 0), 0)
  // The code hash is what ties a recorded verdict to the tree it judged. It costs one
  // walk of the project — the same walk every verification performs — and without it
  // a status can be green over code the gate has since rejected.
  const walked = listFiles(root)
  const verification = verificationStatus(
    root,
    compiled.report.specHash,
    checksExpected,
    codeHashFor(root, walked),
    configHashFor(manifest.config),
  )

  // The persisted bundle and the last verification are read here, not inferred
  // from the compile: "the corpus compiles" and "the verifier has judged the laws
  // currently in force" are different facts, and collapsing them is how a project
  // reports itself verified while nothing has checked it.
  const problems = [...compiled.problems, ...comparison.problems]
  // The ledger is the audit trail, and its reader counts lines it cannot parse rather
  // than throwing — but nothing surfaced that count, and `readLedger` had no production
  // caller at all. A history with silent gaps is worse than one that says it has gaps:
  // "the ledger shows no violation" means nothing if two lines were dropped.
  const ledger = state.readLedger(root)
  // A ledger that cannot be READ is the same silence as one that cannot be parsed: the
  // error branch was returned and dropped, so a ledger path replaced by a directory
  // raised nothing at all.
  if (ledger.error !== undefined) {
    problems.push(
      problem(
        'LEDGER_DAMAGED',
        `${STATE_PATHS.ledger} could not be read (${ledger.error}), so this project's history is unavailable: treat the absence of a recorded violation as unknown rather than as none`,
        null,
        { error: ledger.error },
      ),
    )
  }
  if ((ledger.skipped ?? 0) > 0) {
    problems.push(
      problem(
        'LEDGER_DAMAGED',
        `${STATE_PATHS.ledger} holds ${ledger.skipped} line(s) that cannot be parsed, so this project's history has gaps: a run that is missing from it may still have happened. Repair or archive the file before trusting the ledger as a record`,
        null,
        { skipped: ledger.skipped, events: (ledger.events ?? []).length },
      ),
    )
  }
  if (!verification.ran && compiled.bundle !== null) {
    problems.push(
      problem(
        'VERIFY_NOT_RUN',
        verification.stale
          ? `the code has not been verified against the laws currently in force: ${verification.reason}`
          : `the code has not been verified against any laws: ${verification.reason}`,
        null,
        { stale: verification.stale },
      ),
    )
  }
  // A verification that RAN, at the current laws, and failed is not a clean status.
  // This used to be visible only under `verified.last`, which the human-readable
  // output never printed — so `status` said OK and exited 0 immediately before
  // `verify` exited 1 on the same tree.
  if (verification.ran && verification.recorded?.ok === false) {
    problems.push(
      problem(
        'VERIFICATION_FAILED',
        `the most recent verification of these laws reported ${verification.recorded.errors ?? 'some'} problem(s) at ${verification.recorded.at}; the laws have not changed since, so the code still violates them (run the verify command to see them)`,
        null,
        { at: verification.recorded.at ?? null, errors: verification.recorded.errors ?? null },
      ),
    )
  }

  const rendered = compiled.bundle === null ? { files: {} } : renderSpecs(compiled.bundle)
  const tracksSpecs = state.tracksSpecDocuments(root, manifest.config?.specsDir, manifest.config?.specsRequired)
  const drift = detectSpecDrift(root, rendered.files)
  problems.push(...specDriftProblems(reportedSpecDrift(tracksSpecs, drift)))

  return {
    ok: problems.length === 0,
    stage: 'status',
    project: compiled.report.project,
    root,
    manifestFound: manifest.config !== null,
    ratchetEnabled: compiled.report.enabled,
    decisionsDir: manifest.config?.decisionsDir ?? null,
    counts: compiled.report.counts,
    specHash: compiled.report.specHash,
    bundleOutOfDate: comparison.stale,
    specDrift: {
      drifted: drift.drifted.map((entry) => entry.path),
      stale: drift.stale.map((entry) => entry.path),
      missing: tracksSpecs ? drift.missing : [],
    },
    tracksSpecDocuments: tracksSpecs,
    reviewRequired: compiled.report.reviewRequired,
    verified: {
      ran: verification.ran,
      stale: verification.stale,
      reason: verification.reason,
      last: verification.recorded ?? null,
    },
    reports: {
      compile: STATE_PATHS.compileReport,
      verify: STATE_PATHS.verifyReport,
      ledger: STATE_PATHS.ledger,
      state: STATE_PATHS.state,
      specBundle: STATE_PATHS.specBundle,
    },
    problems,
    summary: summariseProblems(problems),
  }
}

/**
 * Creates the files a project needs before the ratchet can run.
 *
 * @param options - `{ root, mode, name, mainPaths, force }`. `mode` is `'preview'`
 *   (default) or `'apply'`. `root` may be `null`, which is legal in preview mode
 *   and a reported problem in apply mode.
 * @returns The canonical bootstrap result. `wouldCreate` lists EVERY path apply
 *   creates, the manifest included: an apply that writes a file the preview never
 *   mentioned is a preview nobody can plan from.
 */
export function bootstrap({ root = null, mode = 'preview', name = undefined, mainPaths = undefined, force = false } = {}) {
  const plan = bootstrapPreview({ name, mainPaths })
  if (mode !== 'apply') {
    return {
      ok: true,
      stage: 'bootstrap',
      mode: 'preview',
      wrote: false,
      root,
      manifestPath: MANIFEST_PATH,
      manifestText: plan.manifestText,
      wouldCreate: plan.files.map((entry) => `${entry.path}${entry.kind === 'directory' ? '/' : ''}`),
      note: 'Nothing was written. Call again with mode "apply" to create these paths.',
      problems: [],
      summary: summariseProblems([]),
    }
  }
  if (root === null) {
    const problems = [
      problem(
        'MANIFEST_MISSING',
        `cannot apply the bootstrap plan without a project root: no ${MANIFEST_PATH} exists at or above the working directory`,
      ),
    ]
    return {
      ok: false,
      stage: 'bootstrap',
      mode: 'apply',
      wrote: false,
      problems,
      summary: summariseProblems(problems),
    }
  }

  const applied = bootstrapApply(root, plan, { force })
  appendLedger(root, 'ratchet.bootstrap.apply', {
    created: applied.created.length,
    skipped: applied.skipped.length,
    manifestWritten: applied.manifestWritten,
  })
  return {
    ok: true,
    stage: 'bootstrap',
    mode: 'apply',
    wrote: true,
    root,
    created: applied.created,
    skippedExisting: applied.skipped,
    nextStep: applied.manifestWritten
      ? 'write a human-authored ADR with reasoning and a source, then run ratchet compile'
      : 'the manifest already existed and was kept; check ratchet.decisionsDir in it if the decisions live elsewhere',
    problems: [],
    summary: summariseProblems([]),
  }
}

/**
 * Compiles the corpus into laws and records the result.
 *
 * @param options - `{ root, write }`. `write` also emits the generated spec
 *   documents; the report and the spec bundle are recorded either way, because a
 *   report that exists only on success cannot record a failure.
 * @returns The canonical compile result.
 */
export function compile({ root, write = false } = {}) {
  const compiled = compileProject(root)
  const rendered = compiled.bundle === null ? { files: {}, specHash: null } : renderSpecs(compiled.bundle)

  // BEFORE persisting: persisting appends this run's law set to the ledger, and this
  // check is a comparison against the previous one. Running it after would compare the
  // set with itself and always find nothing.
  const removalProblems = lawRemovalProblems(root, compiled)

  // The spec documents are written BEFORE drift is measured, so the drift describes the
  // tree the caller now has: a first `--write` run used to report every document as
  // missing and fail while creating exactly the files it complained about. A write that
  // FAILS is a result, not an exception: the same containment `verify` needs applies
  // here, because an unhandled EPERM exited 1 — the code that means "ran and found
  // problems" — left no ledger line, and left the previous report standing.
  let specWrite = { written: [] }
  const writeProblems = []
  if (write && compiled.bundle !== null) {
    try {
      specWrite = writeSpecDocuments(root, rendered.files)
    } catch (error) {
      writeProblems.push(
        problem(
          'ARTIFACT_WRITE_FAILED',
          `this compile could not write its generated spec documents (${String(error)}), so the documents on disk are from an earlier run and this one left no record of them`,
          null,
          { wrote: false },
        ),
      )
    }
  }

  const config = readManifest(root).config
  const tracksSpecs = state.tracksSpecDocuments(root, config?.specsDir, config?.specsRequired)
  const drift = detectSpecDrift(root, rendered.files)
  const problems = [
    ...compiled.problems,
    ...removalProblems,
    ...specDriftProblems(reportedSpecDrift(tracksSpecs, drift)),
    ...writeProblems,
  ]

  // Persisted AFTER the drift is known, and with the FULL problem list. It used to be
  // persisted before, holding only the compile and removal problems, so a compile that
  // exited 1 over stale generated documents left `compile-report.json` with
  // `"problems": []` and a ledger line saying `ok: true` — the two artifacts a reader or
  // a CI job consults instead of the terminal, both certifying a run that failed.
  const persisted =
    compiled.report.enabled === true || compiled.bundle !== null
      ? persistCompile(root, {
          bundle: compiled.bundle,
          specFiles: null,
          report: { ...compiled.report, problems },
          // `null` holds the recorded set at its previous value: a run that reported an
          // unexplained removal must not also record the shrunken set as the new truth.
          lawIds: removalProblems.length === 0 ? (compiled.bundle?.laws ?? []).map((law) => law.id) : null,
        })
      : { written: [], ledger: { error: 'the ratchet is not enabled in this project' } }

  return {
    ok: problems.length === 0,
    stage: 'compile',
    project: compiled.report.project,
    counts: compiled.report.counts,
    specHash: compiled.report.specHash,
    reviewRequired: compiled.report.reviewRequired,
    specFiles: Object.keys(rendered.files),
    specDrift: {
      drifted: drift.drifted.map((entry) => entry.path),
      stale: drift.stale.map((entry) => entry.path),
      missing: tracksSpecs ? drift.missing : [],
    },
    tracksSpecDocuments: tracksSpecs,
    wrote: [...specWrite.written, ...persisted.written],
    problems,
    summary: summariseProblems(problems),
  }
}

/**
 * Verifies the codebase against the laws currently in force.
 *
 * @param options - `{ root }`.
 * @returns The canonical verify result. A corpus that does not compile blocks the
 *   verification rather than proceeding against a stale bundle, and says so with
 *   `stage: 'compile'` so a caller can tell which stage refused.
 */
export async function verify({ root, runCommand = null } = {}) {
  const compiled = compileProject(root)
  if (!compiled.ok) {
    // The blocking problems themselves, not only how many there were. A count left the
    // cause in terminal output that scrolls away, while the ledger — the one artifact
    // that is supposed to survive the run — said "problems: 2" and nothing else. The
    // spec hash is included because a blocked verify still judged a corpus.
    appendLedger(root, 'ratchet.verify.blocked', {
      stage: 'compile',
      problems: compiled.problems.length,
      problemCodes: summariseProblems(compiled.problems).byCode,
      specHash: compiled.report.specHash,
      subjects: compiled.problems.map((entry) => entry.subject).filter((subject) => subject !== null).slice(0, 20),
    })
    return {
      ok: false,
      stage: 'compile',
      project: compiled.report.project,
      specHash: compiled.report.specHash,
      reason:
        'the decision corpus does not compile, so there are no trustworthy laws to verify against; fix the compile problems first',
      problems: compiled.problems,
      summary: summariseProblems(compiled.problems),
    }
  }

  const manifest = readManifest(root)
  const verified = await verifyProject({
    root,
    bundle: compiled.bundle,
    config: manifest.config,
    manifest: manifest.config,
    // Commands are OPT-IN. Without a runner, a `command` check is reported as
    // pending rather than passing, so the default verification reads the filesystem
    // and runs nothing — which is what makes it safe to call from a tool that an
    // agent invokes mid-edit.
    runCommand: runCommand ?? null,
  })

  // Spec drift is folded into the gate: laws that were hand-edited underneath the
  // code are a reason this verification is not trustworthy, not a separate
  // advisory a caller may ignore. Missing documents are only a problem once the
  // project tracks them — see `tracksSpecDocuments`.
  const rendered = renderSpecs(compiled.bundle)
  const tracksSpecs = state.tracksSpecDocuments(root, manifest.config?.specsDir, manifest.config?.specsRequired)
  const drift = detectSpecDrift(root, rendered.files)
  // Also BEFORE persisting, for the same reason as in `compile`: the persisted verify
  // appends the law set this run observed, so the comparison has to happen first.
  const removalProblems = lawRemovalProblems(root, compiled)
  const problems = [
    ...verified.problems,
    ...removalProblems,
    ...specDriftProblems(reportedSpecDrift(tracksSpecs, drift)),
  ]
  const report = {
    ...verified.report,
    problems,
    counts: { ...verified.report.counts, errors: problems.length },
    // Which tool produced this verdict, and which revision of the tree. Without them a
    // reader cannot answer "was this judged before or after that change" from the
    // artifacts alone — `codeHash` says the tree moved, not where it moved to.
    toolVersion: ratchetToolVersion(),
    vcsRevision: vcsRevisionFor(root),
  }
  // A write that fails is a RESULT, not an exception. The first version let the ENOENT or
  // EPERM escape, so a verify that could write nothing exited 1 — the code the CLI
  // documents as "ran and found problems" — left `state.json` describing the PREVIOUS
  // run, appended no ledger line, and left a `*.tmp-<pid>` sibling behind. The caller now
  // gets a problem with its own code, which maps to exit 2 ("nothing was checked")
  // because nothing durable records that anything was.
  let persisted = { written: [], ledger: { written: false } }
  try {
    persisted = persistVerify(root, {
      report,
      evaluatedSpecHash: compiled.report.specHash,
      toolVersion: report.toolVersion,
      lawIds: removalProblems.length === 0 ? (compiled.bundle?.laws ?? []).map((law) => law.id) : null,
    })
  } catch (error) {
    // Whether the per-run report reached disk before the state write failed decides what
    // the reader should be told: the report exists but is a green verdict for a run the
    // CLI calls "unusable", so the message must not claim the output is the only record.
    const reportWroteOnDisk = existsSync(join(root, STATE_PATHS.verifyReport))
    const failure = problem(
      'ARTIFACT_WRITE_FAILED',
      `this verification ran and evaluated ${report.counts.checksEvaluated} check(s), but its report and state could not be written (${String(error)}), so this run left no durable verdict${reportWroteOnDisk ? `; the report on disk is the one written moments before the failure, and it does NOT contain this problem — read the run's output, not that file` : ''}`,
      null,
      { counts: report.counts, wrote: false },
    )
    problems.push(failure)
    report.problems = problems
    report.counts = { ...report.counts, errors: problems.length }
    appendLedger(root, 'ratchet.verify.write-failed', { error: String(error).slice(0, 300), checksEvaluated: report.counts.checksEvaluated })
  }

  // A ledger that cannot be appended to loses the audit line, and the module reports it
  // on stderr rather than failing the operation. That is right for the operation and
  // wrong for the record: a run whose history line is missing must not also be reported
  // as a clean success, or "the ledger shows no violation" starts meaning "the ledger
  // shows nothing".
  if (persisted.ledger !== undefined && persisted.ledger !== null && persisted.ledger.error !== undefined) {
    problems.push(
      problem(
        'ARTIFACT_WRITE_FAILED',
        `this verification ran and its report was written, but the ledger line could not be appended (${persisted.ledger.error}), so the audit trail does not record this run`,
        null,
        { ledger: STATE_PATHS.ledger },
      ),
    )
  }

  return {
    ok: problems.length === 0,
    stage: 'verify',
    project: compiled.report.project,
    specHash: compiled.report.specHash,
    // The tree this verdict is about. A caller that keeps the spec hash to answer "which
    // laws were judged" needs this half too, or the answer silently outlives the code.
    codeHash: report.codeHash ?? null,
    // The authority table, so a caller that keeps the verdict can compare all three legs
    // of its identity rather than two of them.
    configHash: report.configHash ?? null,
    toolVersion: report.toolVersion,
    vcsRevision: report.vcsRevision,
    counts: report.counts,
    dependencyManifests: report.dependencyManifests,
    laws: report.laws,
    specDrift: {
      drifted: drift.drifted.map((entry) => entry.path),
      stale: drift.stale.map((entry) => entry.path),
      missing: tracksSpecs ? drift.missing : [],
    },
    reports: { verify: STATE_PATHS.verifyReport, state: STATE_PATHS.state, ledger: STATE_PATHS.ledger },
    wrote: persisted.written,
    problems,
    summary: summariseProblems(problems),
  }
}

/**
 * Picks the process exit code for an operation result.
 *
 * The distinction the codes carry is the one a script needs: `2` means the ratchet
 * could not run at all, `1` means it ran and the project has problems. A shell that
 * cannot tell those apart retries a misconfiguration forever or treats a real
 * violation as a tooling fault.
 *
 * @param result - Any operation result.
 * @returns One of {@link EXIT}.
 */
export function exitCodeFor(result) {
  if (result?.ok === true) return EXIT.OK
  const codes = new Set((result?.problems ?? []).map((entry) => entry.code))
  // `CONFIG` is for a project the ratchet cannot read at all. `LAWS_NONE` is
  // deliberately absent: a corpus where every decision is still proposed is a
  // readable project with nothing in force, which is a finding (exit 1) rather than
  // a misconfiguration (exit 2). Reporting it as the latter sends a reader hunting
  // for a broken file when the answer is "that proposal is not approved yet".
  //
  // The list itself lives with the vocabulary, because the ratification queue has to
  // reach the same verdict: a queue that reported `ok` over an unreadable corpus made
  // `ratchet pending` print OK and exit 0 where every other command exits 2.
  for (const code of UNUSABLE_PROBLEM_CODES) if (codes.has(code)) return EXIT.CONFIG
  return EXIT.PROBLEMS
}

/**
 * The exit code a DYNAMIC result should produce.
 *
 * Always {@link EXIT.OK}, and that is the point rather than an oversight. A review
 * answer comes from a model, so it is advisory by construction: a non-deterministic
 * check that can fail a build is one people learn to re-run until it passes. This
 * function exists so the choice is visible in one place instead of being implied by
 * whatever a caller happens to do with `ok`.
 *
 * @returns {@link EXIT.OK}, always.
 */
export function exitCodeForReview() {
  return EXIT.OK
}

/**
 * Builds the stable half of a review context from a project's current state.
 *
 * @param root - Absolute project root.
 * @returns `{ stable, lawIds, adrIds, config, project, problems }`. `lawIds` and
 *   `adrIds` are the sets a verdict is checked against, so a judge cannot cite
 *   something that does not exist and have it passed on.
 */
function contextFor(root) {
  const compiled = compileProject(root)
  const manifest = readManifest(root)
  // The corpus is read a second time rather than taken from the compile result:
  // `compileProject` deliberately returns only what a report needs, and a review
  // needs the records themselves. Re-reading is cheap and keeps the compile's
  // output contract narrow instead of widening it for one caller.
  const corpus = readAdrCorpus(root, manifest.config ?? {})
  const resolve = resolveActiveSet(corpus.records, manifest.config ?? {})
  const activeRecords = resolve.active
  const proposedRecords = resolve.proposed
  return {
    stable: dynamic.renderStableContext({
      project: compiled.report.project,
      config: manifest.config,
      bundle: compiled.bundle,
      activeRecords,
      proposedRecords,
      reviewRequired: compiled.report.reviewRequired,
    }),
    lawIds: (compiled.bundle?.laws ?? []).map((law) => law.id),
    // Both active and proposed ids are citable: a review of a PROPOSED decision
    // must be able to name it, and refusing that reference would make the
    // proposal job unusable. Sorted so the stable context is byte-identical
    // between calls — an unsorted list changes the prefix and silently discards
    // the cache the split exists for.
    adrIds: [...new Set([...activeRecords, ...proposedRecords].map((record) => record.id))].sort(),
    config: manifest.config,
    project: compiled.report.project,
    problems: compiled.problems,
  }
}

/**
 * Runs one advisory review, spawning a judge when a spawner is supplied.
 *
 * The judge is INJECTED rather than reached for. This module never imports the
 * harness or the subagents runtime, so it can be tested without a deployment and
 * the one service dependency lives in the caller. It also means "no judge
 * available" is a value the caller passes rather than a failure discovered deep in
 * a call stack.
 *
 * @param options - `{ root, job, change, proposal, source, conflict, violation,
 *   question, spawnJudge, record }`. `spawnJudge` is
 *   `(prompt, schema) => Promise<{ structured, output, stopReason, diagnostic }>`
 *   or `null` for the degraded path. `record` writes the report when true.
 * @returns The canonical review result. Always resolves; never gates.
 */
export async function review({
  root,
  job,
  change = null,
  proposal = null,
  source = null,
  conflict = null,
  violation = null,
  question = null,
  spawnJudge = null,
  record = true,
} = {}) {
  if (dynamic.REVIEW_JOBS[job] === undefined) {
    const problems = [
      problem(
        'DYNAMIC_REVIEW_REQUIRED',
        `unknown review job ${JSON.stringify(job)}; expected one of ${Object.keys(dynamic.REVIEW_JOBS).join(', ')}`,
      ),
    ]
    return {
      ok: false,
      stage: 'review',
      advisory: true,
      gate: false,
      problems,
      summary: summariseProblems(problems),
    }
  }

  const context = contextFor(root)
  const bundle = dynamic.buildContextBundle({
    stable: context.stable,
    job,
    change,
    proposal,
    source,
    conflict,
    violation,
    question,
  })

  // A job whose material is missing cannot be answered, and asking anyway invites
  // the judge to invent the missing half. That is reported, not papered over.
  if (bundle.missing.length > 0) {
    const problems = [
      problem(
        'DYNAMIC_REVIEW_REQUIRED',
        `review job ${JSON.stringify(job)} needs ${bundle.missing.join(', ')}, which was not supplied, so the question was not asked`,
        null,
        { missing: bundle.missing },
      ),
    ]
    return {
      ok: false,
      stage: 'review',
      job,
      advisory: true,
      gate: false,
      missing: bundle.missing,
      problems,
      summary: summariseProblems(problems),
    }
  }

  const prompt = dynamic.renderReviewPrompt(bundle)
  // The job decides the output contract: a review asks for a verdict, a grilling
  // preparation asks for an agenda. Asking the wrong one produces the wrong shape
  // from a judge that answered the question it was given.
  const outputSchema = dynamic.schemaForJob(job)

  if (spawnJudge === null) {
    const degraded = dynamic.degradeToSelfReview(bundle)
    return {
      ok: false,
      stage: 'review',
      job,
      advisory: true,
      gate: false,
      degraded: true,
      kind: dynamic.jobProducesAgenda(job) ? 'agenda' : 'verdict',
      note: degraded.note,
      prompt: degraded.prompt,
      outputSchema,
      lawIds: context.lawIds,
      adrIds: context.adrIds,
      problems: [],
      summary: summariseProblems([]),
      nextStep: dynamic.jobProducesAgenda(job)
        ? 'answer the prompt and put the agenda in the ADR or source it came from; an agenda is not a gate either'
        : 'answer the prompt and submit the verdict through ratchet_review with `verdict`, so the record shows this was a self-review',
    }
  }

  let judgeResult
  let judgeError = null
  try {
    judgeResult = await spawnJudge(prompt, outputSchema)
  } catch (error) {
    judgeError = String(error)
  }

  const parsed =
    judgeResult === undefined || judgeResult === null
      ? { verdict: null, source: null, problem: judgeError ?? 'the judge produced no result' }
      : dynamic.parseVerdict(judgeResult.structured ?? null, judgeResult.output ?? null)

  // A judge that ran but produced nothing usable is reported as such. Treating an
  // unparseable answer as "no findings" is the single most dangerous outcome this
  // layer can have: it converts a broken review into a clean bill of health.
  const extra = []
  if (parsed.problem !== null) {
    extra.push(
      problem('DYNAMIC_REVIEW_REQUIRED', `the review produced no usable answer: ${parsed.problem}`),
    )
  }
  if (judgeError !== null) {
    extra.push(problem('DYNAMIC_REVIEW_REQUIRED', `the judge could not be run: ${judgeError}`))
  }

  const judgeIdentity =
    judgeResult === undefined || judgeResult === null
      ? { kind: 'none', reason: judgeError ?? 'no result' }
      : { kind: 'subagent', stopReason: judgeResult.stopReason ?? null, verdictSource: parsed.source }

  if (dynamic.jobProducesAgenda(job)) {
    const agenda = dynamic.validateAgenda(parsed.verdict, { lawIds: context.lawIds, adrIds: context.adrIds })
    const problems = [...extra, ...agenda.problems]
    const report = {
      ...dynamic.buildReviewReport({
        job,
        judge: judgeIdentity,
        verdict: parsed.verdict,
        validation: { ok: agenda.ok, findings: [], problems: agenda.problems },
        lawIds: context.lawIds,
        adrIds: context.adrIds,
      }),
      kind: 'ratchet/grill-agenda',
      agenda: {
        request: agenda.request,
        conflictingLaws: agenda.conflictingLaws,
        proposedOverride: agenda.proposedOverride,
        risks: agenda.risks,
        questions: agenda.questions,
      },
      insufficientReasoning: agenda.insufficientReasoning,
      problems,
    }
    if (record) {
      state.writeArtifact(root, STATE_PATHS.dynamicReport, `${JSON.stringify(report, null, 2)}\n`)
      appendLedger(root, 'ratchet.grill.finish', {
        job,
        advisory: true,
        questions: agenda.questions.length,
        conflicts: agenda.conflictingLaws.length,
        usable: problems.length === 0,
      })
    }
    return {
      ok: agenda.ok && problems.length === 0,
      stage: 'review',
      job,
      kind: 'agenda',
      advisory: true,
      gate: false,
      degraded: false,
      verdictSource: parsed.source,
      judge: judgeIdentity,
      agenda: report.agenda,
      insufficientReasoning: agenda.insufficientReasoning,
      lawIds: context.lawIds,
      adrIds: context.adrIds,
      report: STATE_PATHS.dynamicReport,
      problems,
      summary: summariseProblems(problems),
    }
  }

  const validation = dynamic.validateVerdict(parsed.verdict, {
    lawIds: context.lawIds,
    adrIds: context.adrIds,
  })
  const problems = [...extra, ...validation.problems]

  const report = dynamic.buildReviewReport({
    job,
    judge: judgeIdentity,
    verdict: parsed.verdict,
    validation,
    lawIds: context.lawIds,
    adrIds: context.adrIds,
  })
  report.problems = [...report.problems, ...problems]

  if (record) {
    state.writeArtifact(root, STATE_PATHS.dynamicReport, `${JSON.stringify(report, null, 2)}\n`)
    appendLedger(root, 'ratchet.review.finish', {
      job,
      advisory: true,
      verdictOk: report.verdictOk,
      findings: report.findings.length,
      usable: problems.length === 0,
    })
  }

  return {
    // `ok` describes the JUDGE's verdict, never a gate. `exitCodeForReview`
    // returns 0 unconditionally for the same reason.
    ok: validation.ok && problems.length === 0,
    stage: 'review',
    job,
    kind: 'verdict',
    advisory: true,
    gate: false,
    degraded: false,
    verdictSource: parsed.source,
    judge: report.judge,
    findings: validation.findings,
    insufficientReasoning: validation.insufficientReasoning,
    reasoning: validation.reasoning ?? null,
    lawIds: context.lawIds,
    adrIds: context.adrIds,
    report: STATE_PATHS.dynamicReport,
    problems,
    summary: summariseProblems(problems),
  }
}

/**
 * Ingests a raw source into a proposed ADR.
 *
 * The two halves are deliberately separate: `ingest` proposes and never writes, and
 * `write` in the options puts the result on disk. A generator that writes as it
 * generates cannot be reviewed, and a record nobody reviewed is a record nobody
 * trusts — which is the whole point of keeping the record.
 *
 * Three outcomes, all of them results rather than errors:
 *
 * - **proposed** — an ADR was generated, validated against the source, and compiles.
 * - **INSUFFICIENT_REASONING** — the source states a decision without stating why.
 *   Writing a record here would require inventing its justification, so the answer
 *   is a grilling session, and saying so is more useful than a fabricated record.
 * - **rejected** — a quote could not be found in the source, a zone does not exist,
 *   or the corpus does not compile. Each is reported with what failed.
 *
 * @param options - `{ root, sourcePath, spawnJudge, submitted, write, authorName, now }`.
 *   `spawnJudge` is `(prompt, schema) => Promise<{structured, output, stopReason}>`
 *   or `null`, in which case the prompt is returned for a self-ingestion;
 *   `submitted` is a result the caller produced itself, validated exactly like a
 *   spawned judge's — that pair is what makes a session with no subagents runtime a
 *   degraded path rather than a dead end.
 * @returns The canonical ingestion result.
 */
export async function ingest({
  root,
  sourcePath,
  spawnJudge = null,
  submitted = null,
  write = false,
  authorName = 'ratchet-ingest',
  now = null,
} = {}) {
  const manifest = readManifest(root)
  if (manifest.config === null || manifest.config.enabled !== true) {
    const problems = manifest.config === null
      ? manifest.problems
      : [problem('RATCHET_DISABLED', `${MANIFEST_PATH} does not declare ratchet.enabled, so there is nowhere to record a decision`)]
    return { ok: false, stage: 'ingest', problems, summary: summariseProblems(problems) }
  }
  const config = manifest.config

  const source = ingestModule.readSource(root, sourcePath)
  if (source.error !== undefined) {
    const problems = [problem('ADR_SOURCE_MISSING', source.error, null, { path: sourcePath })]
    return { ok: false, stage: 'ingest', problems, summary: summariseProblems(problems) }
  }

  const existing = ingestModule.existingAdrIds(root, config.decisionsDir)
  const context = contextFor(root)
  const prompt = ingestModule.renderIngestPrompt({
    config,
    sourceText: source.text,
    sourcePath,
    existingIds: existing.ids,
    corpusSummary: context.stable,
  })

  if (spawnJudge === null && submitted === null) {
    return {
      ok: false,
      stage: 'ingest',
      advisory: true,
      degraded: true,
      sourcePath,
      sourceHash: source.hash,
      existingIds: existing.ids,
      nextId: ingestModule.nextAdrId(existing.ids),
      prompt,
      outputSchema: ingestModule.INGEST_SCHEMA,
      note:
        'No judge could be spawned, so the ingestion prompt is returned unrun. Answer it and submit the result, ' +
        'or call this again from a session that can spawn a judge.',
      // The answer has somewhere to go, which is the difference between a degraded
      // path and a dead end: `submitted` is validated exactly like a spawned
      // judge's result, so a session with no subagents runtime can still record a
      // decision by reading the prompt and answering it.
      submitHint: 'call ratchet_ingest_source again with the same source and `ingest` set to the JSON object this prompt asks for',
      problems: [],
      summary: summariseProblems([]),
    }
  }

  let judgeResult = null
  let judgeError = null
  let parsed
  let judgeIdentity
  if (submitted !== null && submitted !== undefined) {
    // The caller's own answer, filed rather than spawned. It is read as if it had
    // come from a judge — same parser, same validator, same provenance check —
    // because a result a model transcribed deserves at least the scrutiny of one it
    // produced directly.
    parsed = { verdict: submitted, source: 'submitted', problem: null }
    judgeIdentity = {
      kind: 'caller',
      reason: 'the caller supplied the result; the ratchet spawned no judge',
    }
  } else {
    try {
      judgeResult = await spawnJudge(prompt, ingestModule.INGEST_SCHEMA)
    } catch (error) {
      judgeError = String(error)
    }
    parsed =
      judgeResult === null || judgeResult === undefined
        ? { verdict: null, source: null, problem: judgeError ?? 'the judge produced no result' }
        : dynamic.parseVerdict(judgeResult.structured ?? null, judgeResult.output ?? null)
    judgeIdentity =
      judgeResult === null || judgeResult === undefined
        ? { kind: 'none', reason: judgeError ?? 'no result' }
        : { kind: 'subagent', stopReason: judgeResult.stopReason ?? null, verdictSource: parsed.source }
  }

  const validation = ingestModule.validateIngest(parsed.verdict, {
    sourceText: source.text,
    config,
    existingIds: existing.ids,
  })

  if (validation.insufficientReasoning) {
    appendLedger(root, 'ratchet.ingest.insufficient', { sourcePath, reason: validation.reason })
    return {
      ok: false,
      stage: 'ingest',
      code: 'INSUFFICIENT_REASONING',
      advisory: true,
      sourcePath,
      sourceHash: source.hash,
      judge: judgeIdentity,
      reason: validation.reason,
      nextStep:
        'the source states a decision without the reasoning behind it; capture that reasoning (a grilling session, a design note) and ingest the extended source',
      problems: [],
      summary: summariseProblems([]),
    }
  }

  const problems = [...validation.problems]
  if (parsed.problem !== null) {
    problems.push(
      problem('DYNAMIC_REVIEW_REQUIRED', `the ingestion produced no usable result: ${parsed.problem}`),
    )
  }
  if (judgeError !== null) {
    problems.push(problem('DYNAMIC_REVIEW_REQUIRED', `the judge could not be run: ${judgeError}`))
  }
  if (!validation.ok) {
    appendLedger(root, 'ratchet.ingest.rejected', { sourcePath, problems: problems.length })
    return {
      ok: false,
      stage: 'ingest',
      advisory: true,
      sourcePath,
      sourceHash: source.hash,
      judge: judgeIdentity,
      problems,
      summary: summariseProblems(problems),
    }
  }

  const rendered = ingestModule.renderAdr({
    fields: validation.fields,
    sourcePath,
    sourceHash: source.hash,
    createdAt: now ?? new Date().toISOString(),
    authorName,
    decisionsDir: config.decisionsDir,
  })

  // A decision already on record is not ingested a second time. This is checked
  // before anything is reported as generated, because two records for one decision
  // compile perfectly: both laws agree, the corpus is valid, and the duplication is
  // invisible until somebody counts. Matching on the title's slug rather than on the
  // id is what makes it about the decision instead of the file.
  const alreadyRecorded = ingestModule.findExistingBySlug(root, validation.fields.title, config.decisionsDir)
  if (alreadyRecorded !== null) {
    appendLedger(root, 'ratchet.ingest.duplicate', { sourcePath, existing: alreadyRecorded })
    return {
      ok: false,
      stage: 'ingest',
      advisory: true,
      code: 'ALREADY_RECORDED',
      sourcePath,
      sourceHash: source.hash,
      existingRecord: `${config.decisionsDir}/${alreadyRecorded}`,
      judge: judgeIdentity,
      reason: `a record for this decision already exists at ${config.decisionsDir}/${alreadyRecorded}`,
      nextStep:
        'amend that record instead of adding a second one, or supersede it with a new ADR that names it in `supersedes`',
      problems: [],
      summary: summariseProblems([]),
    }
  }

  // Generation is not finished until the record compiles. Parsing rather than writing
  // means a malformed proposal cannot leave the project in a state where its own
  // ratchet fails.
  const compiled = compileRenderedAdr(root, rendered, config)

  let writtenPath = null
  if (write) {
    if (!compiled.ok) {
      problems.push(
        problem(
          'ADR_FIELD_INVALID',
          `the generated record does not compile, so it was not written: ${compiled.problems.map((entry) => entry.message).join('; ')}`,
        ),
      )
    } else {
      const outcome = ingestModule.writeIngested(root, rendered)
      if (outcome.error !== undefined) problems.push(problem('ADR_UNREADABLE', outcome.error))
      else writtenPath = outcome.written
    }
  }

  appendLedger(root, 'ratchet.ingest.propose', {
    sourcePath,
    adr: rendered.filename,
    laws: validation.fields.laws.length,
    zones: validation.fields.zones.join(','),
    written: writtenPath !== null,
    compiles: compiled.ok,
    checks: validation.fields.laws.reduce((total, law) => total + law.checks.length, 0),
    droppedChecks: (validation.dropped ?? []).length,
  })

  const acceptedChecks = validation.fields.laws.reduce((total, law) => total + law.checks.length, 0)

  return {
    ok: problems.length === 0 && compiled.ok,
    stage: 'ingest',
    advisory: true,
    // Always proposed, whatever the judge said: a generator that could emit an
    // active record would be an agent activating its own decision.
    status: 'proposed',
    sourcePath,
    sourceHash: source.hash,
    judge: judgeIdentity,
    adr: {
      id: validation.fields.id,
      filename: rendered.filename,
      path: rendered.path,
      title: validation.fields.title,
      zones: validation.fields.zones,
      laws: validation.fields.laws.map((law) => law.id),
    },
    // What the record actually enforces, reported so a reader does not have to
    // re-derive it from the rendered text: a law with no check and no stated reason
    // is a rule the verifier will report as unenforced.
    derivedChecks: {
      accepted: acceptedChecks,
      dropped: validation.dropped ?? [],
      lawsWithoutChecks: validation.fields.laws
        .filter((law) => law.checks.length === 0 && law.unenforced === null)
        .map((law) => law.id),
      lawsDeliberatelyUnenforced: validation.fields.laws
        .filter((law) => law.checks.length === 0 && law.unenforced !== null)
        .map((law) => law.id),
    },
    text: rendered.text,
    compiles: compiled.ok,
    compileProblems: compiled.problems,
    written: writtenPath,
    nextStep:
      writtenPath === null
        ? 'review the record above, then call with write enabled to place it under the decisions directory'
        : 'a human must ratify it before it becomes law: run ratchet_ratify, which asks the human to approve this exact text and records the answer',
    problems,
    summary: summariseProblems(problems),
  }
}

/**
 * Checks a generated ADR against the rules a written record would face.
 *
 * The record is PARSED rather than written and compiled in place, for two reasons.
 * Writing it first would let a malformed proposal exist on disk for however long the
 * check takes, and "the tool broke my ratchet" is not a recoverable first
 * impression. Parsing also exercises exactly the rules a written record faces,
 * because `parseAdr` IS that rule set: filename identity, mandatory fields, required
 * sections, a non-empty reasoning section, well-formed laws and checks, and the
 * source hash against the file on disk.
 *
 * @param root - Absolute project root.
 * @param rendered - Result of `renderAdr`.
 * @param config - Parsed ratchet configuration.
 * @returns `{ ok, problems }`.
 */
function compileRenderedAdr(root, rendered, config) {
  const parsed = parseAdr({
    filename: rendered.filename,
    source: rendered.text,
    root,
    decisionsDir: config.decisionsDir,
  })
  return { ok: parsed.problems.length === 0 && parsed.record !== null, problems: parsed.problems }
}

/**
 * Resolve the npm CLI entry that belongs to the running interpreter.
 *
 * A law that runs `npm` cannot spawn the bare name: on Windows npm is a `.cmd` shim
 * that `execFile` refuses, and even where it would resolve, a bare name leaves WHICH
 * npm ambiguous when the law runs under the harness's own interpreter. Resolving the
 * entry beside that interpreter pins both. Two layouts exist and both are checked:
 * npm installed beside its interpreter sits in a sibling `node_modules`, while a
 * POSIX global install keeps it under `<prefix>/lib/node_modules`. Checking only the
 * first located npm on Windows and failed on a Linux machine whose only install was
 * the POSIX global one.
 *
 * @returns Absolute path to `npm-cli.js`. When neither layout exists the sibling
 *   candidate is returned anyway, so the failure names the path that was expected
 *   instead of quietly running a different npm.
 */
function resolveNpmCli() {
  const candidates = [
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
}

/**
 * Builds a command runner for `command` checks.
 *
 * This is the only place in the ratchet that starts a process, and it exists as a
 * separate function for that reason: verification is a pure filesystem reader by
 * default, and running something is a capability a caller hands over deliberately.
 * The tool surface does not supply it; the CLI and CI do.
 *
 * Three properties matter more than convenience. **No shell** — the declared string
 * is split into an argv, so a law cannot smuggle a pipe, a redirect or a
 * substitution past the reader who approved it. **A timeout on every run**, so a
 * hung suite cannot hang the gate. **A hard cap on the capture** (`maxBuffer`, 64×
 * the report budget), so a runaway command cannot exhaust memory.
 *
 * What it does NOT do is truncate the returned streams. It used to, and that made a
 * report-sized budget part of a law's meaning: an `outputContains` assertion read the
 * slice, so a token printed past the cut was reported absent and a forbidden one
 * printed past it passed. Bounding what a report PRINTS is the reporter's job — the
 * verifier slices the excerpt it writes and the evidence it stores.
 *
 * @param options - `{ root, timeoutMs, maxOutputBytes }`, where `maxOutputBytes` sets
 *   the capture cap as `64 × maxOutputBytes`.
 * @returns An async `(run, { timeoutMs, cwd }) => { code, stdout, stderr, timedOut }`
 *   carrying the whole captured output.
 */
export function createCommandRunner({ root, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, maxOutputBytes = 4000 } = {}) {
  return async function runCommand(run, { timeoutMs: budget = timeoutMs, cwd = root } = {}) {
    const argv = shellSplit(run)
    if (argv.length === 0) {
      return { code: 127, stdout: '', stderr: 'the check declares an empty command', timedOut: false }
    }
    // `node` and `npm` are resolved through the running interpreter, so the same law
    // works on a machine where neither is an executable `execFile` can spawn by bare
    // name — which is Windows.
    const [command, ...args] = argv
    const [resolved, resolvedArgs] =
      command === 'node'
        ? [process.execPath, args]
        : command === 'npm'
          ? [process.execPath, [resolveNpmCli(), ...args]]
          : [command, args]
    try {
      const outcome = await execFileAsync(resolved, resolvedArgs, {
        cwd,
        timeout: budget,
        maxBuffer: maxOutputBytes * 64,
        windowsHide: true,
      })
      return {
        code: 0,
        stdout: String(outcome.stdout ?? ''),
        stderr: String(outcome.stderr ?? ''),
        timedOut: false,
      }
    } catch (error) {
      // Timed-out means `execFile` killed it for exceeding the budget, which Node
      // reports as `killed: true` TOGETHER WITH `signal: 'SIGTERM'` and a
      // `killed` flag it also sets for other terminations. Checking `killed` alone
      // reported every non-zero exit as "exceeded its 300000 ms budget" — a
      // diagnostic that sends the reader to the wrong problem entirely, which is
      // worse than no diagnostic.
      const timedOut = error.killed === true && error.signal === 'SIGTERM' && error.code === null
      // The first stream with content wins. A command that fails with an empty
      // stderr and a full stdout — `node --test` is exactly that — otherwise reports
      // "(no output)" and sends the reader looking for a problem that is not there.
      const stderrText = String(error.stderr ?? '').trim()
      const stdoutText = String(error.stdout ?? '').trim()
      return {
        code: typeof error.code === 'number' ? error.code : 1,
        signal: error.signal ?? null,
        stdout: String(error.stdout ?? ''),
        stderr: timedOut
          ? `the command exceeded its ${budget} ms budget and was killed`
          : stderrText || stdoutText || String(error.message ?? ''),
        timedOut,
      }
    }
  }
}

/**
 * Splits a command string into an argv without invoking a shell.
 *
 * Quotes group, a backslash escapes the next character, and everything else splits on
 * whitespace. Deliberately small: a law's command is a tool invocation, and anything
 * needing a shell is a sign the check should be a script the repository owns rather
 * than a line inside an ADR.
 *
 * @param text - The declared command.
 * @returns Argument vector; empty for a blank string.
 */
export function shellSplit(text) {
  const argv = []
  let current = ''
  let quote = null
  let started = false
  const source = String(text ?? '')
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quote !== null) {
      if (character === '\\' && quote === '"' && index + 1 < source.length) {
        current += source[index + 1]
        index += 1
      } else if (character === quote) {
        quote = null
      } else {
        current += character
      }
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      started = true
      continue
    }
    if (character === '\\' && index + 1 < source.length) {
      current += source[index + 1]
      index += 1
      started = true
      continue
    }
    if (/\s/.test(character)) {
      if (started || current.length > 0) {
        argv.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += character
    started = true
  }
  if (started || current.length > 0) argv.push(current)
  return argv
}

/**
 * Lists the decisions waiting for a human, and the ones that cannot wait on one.
 *
 * @param root - Absolute project root.
 * @returns `{ ok, stage, pending, blocked, problems, summary }`. Always resolves:
 *   a project with nothing to ratify is an answer, not an error.
 */
export function ratifications(root) {
  const queue = ratificationQueue(root)
  const problems = queue.problems ?? []
  return {
    ok: queue.ok,
    stage: 'ratify',
    project: queue.config?.project ?? null,
    pending: queue.pending.map((entry) => ({
      id: entry.id,
      title: entry.title,
      path: entry.path,
      status: entry.status,
      authority: entry.authority,
      zones: entry.zones,
      zonePolicies: entry.zonePolicies,
      contentHash: entry.contentHash,
      laws: entry.laws,
      excluded: entry.excluded,
    })),
    blocked: queue.blocked.map((entry) => ({
      id: entry.id,
      path: entry.path,
      status: entry.status,
      zones: entry.zones,
      reason: entry.reason,
    })),
    problems,
    summary: summariseProblems(problems),
  }
}

/**
 * Puts pending decisions to a human and records the consent that follows.
 *
 * One call is one attempt, deliberately: the operation is a function of a root and
 * an answer, so it cannot prompt, wait, or loop. The caller that owns the human
 * channel asks the quiz this returns and calls again with the answer — which is what
 * makes the whole path testable with a literal answer object, and what keeps an
 * unreadable answer from being retried forever by a machine that is guessing.
 *
 * Four outcomes, all results rather than errors:
 *
 * - **needsAnswer** — no answer was supplied; the quiz to put to the human is
 *   returned. Nothing is written.
 * - **ratified** — at least one decision was approved; the transcript and the
 *   approval ADR are written, and the compile that follows reports the new law set.
 * - **rejected** — the human declined; nothing is written.
 * - **unreadable** — the answer matched none of the offered options; nothing is
 *   minted, and a differently shaped re-ask is returned with what actually arrived.
 *
 * @param options - `{ root, answer, quiz, attempt, previous, ids, askedBy, at, write,
 *   present }`.
 *   `answer` is the harness answer object (`{ answers: [{ id, selected, custom? }] }`)
 *   or `null` to prepare the quiz. **`quiz` is required to mint**: it is the exact
 *   quiz the human answered, and passing it is what lets this function bind each
 *   consent to the text that was SHOWN and refuse an answer that answers no question.
 *   An `answer` without a `quiz` is refused, because nothing then distinguishes a
 *   human's answer from a string a caller typed. `attempt` is 1 for the first
 *   question and 2 for the one re-ask, which asks differently and carries `previous`.
 *   `ids` narrows the quiz to named decisions; ids that are not pending are reported
 *   rather than ignored. `askedBy` names who asked the human, and is recorded in the
 *   approval. `present` is forwarded to `buildQuiz` and decides whether the question
 *   asks to be rendered by the ADR panel (`'panel'`, the default) or by the harness's
 *   own card (`'chat'`); it reaches the re-ask too, because a re-ask shown somewhere
 *   other than the question it repeats is a question the human has to find twice.
 * @returns The canonical ratification result. `reask` is present only on attempt 1
 *   with unreadable answers: there is no third attempt, because a machine that keeps
 *   rephrasing a question is one that has decided the answer for itself.
 */
export function ratify({
  root,
  answer = null,
  quiz: answeredQuiz = null,
  attempt = 1,
  previous = [],
  ids = null,
  askedBy = 'unattributed',
  at = null,
  write = true,
  present = 'panel',
} = {}) {
  const queue = ratificationQueue(root)
  if (!queue.ok) {
    appendLedger(root, 'ratchet.ratify.blocked', {
      stage: 'queue',
      problems: (queue.problems ?? []).length,
    })
    return {
      ok: false,
      stage: 'ratify',
      needsManifest: queue.config === null,
      problems: queue.problems,
      summary: summariseProblems(queue.problems ?? []),
    }
  }

  const config = queue.config
  const timestamp = at ?? new Date().toISOString()
  const wanted = Array.isArray(ids) && ids.length > 0 ? ids.map((id) => String(id)) : null
  const unknown = wanted === null ? [] : wanted.filter((id) => !queue.pending.some((entry) => entry.id === id))
  const targets = wanted === null ? queue.pending : queue.pending.filter((entry) => wanted.includes(entry.id))
  const unknownProblems = unknown.map((id) =>
    problem(
      'ADR_FIELD_INVALID',
      `ratification was asked for ADR ${id}, which is not waiting for a human: it is either already in force, or not a decision this project declares. Ask ratchet_ratify with no ids to see the queue`,
      id,
      { id },
    ),
  )

  if (targets.length === 0) {
    appendLedger(root, 'ratchet.ratify.nothing', { blocked: queue.blocked.length, unknown: unknown.length })
    return {
      ok: unknown.length === 0,
      stage: 'ratify',
      project: config.project,
      nothingToRatify: unknown.length === 0,
      message:
        unknown.length > 0
          ? `none of the requested ids is waiting for a human: ${unknown.join(', ')}`
          : queue.blocked.length === 0
            ? 'every decision in this project is already in force; there is nothing waiting for a human'
            : 'no decision is waiting for a human; the ones that are not in force cannot be fixed by ratifying them, and each says why under "blocked"',
      blocked: queue.blocked.map((entry) => ({ id: entry.id, path: entry.path, reason: entry.reason })),
      problems: unknownProblems,
      summary: summariseProblems(unknownProblems),
    }
  }

  const quiz =
    answeredQuiz !== null && answeredQuiz !== undefined
      ? answeredQuiz
      : attempt === 2
        ? buildQuiz(targets, { attempt: 2, previous, present })
        : buildQuiz(targets, { attempt: 1, present })

  // An answer with no quiz is not a consent, it is a string. Without the quiz there
  // is nothing to check the answer against — no question it answers, no offered text
  // — and accepting it would make every consent this module mints indistinguishable
  // from a sentence a caller composed. So it is refused, with the quiz to ask.
  if (answer !== null && answer !== undefined && (answeredQuiz === null || answeredQuiz === undefined)) {
    const problems = [
      ...unknownProblems,
      problem(
        'RATIFICATION_UNPROVEN',
        'an answer was supplied without the quiz it answers, so nothing shows a human was asked anything: consent is derived from the quiz this ratchet put to the human, and a caller-composed answer cannot be distinguished from one they typed',
        null,
        {},
      ),
    ]
    appendLedger(root, 'ratchet.ratify.unpaired-answer', { pending: targets.length })
    return {
      ok: false,
      stage: 'ratify',
      project: config.project,
      needsAnswer: true,
      attempt: 1,
      unanswered: true,
      pending: targets.map((entry) => ({ id: entry.id, title: entry.title, path: entry.path, contentHash: entry.contentHash })),
      quiz,
      problems,
      summary: summariseProblems(problems),
      nextStep:
        'ask the human this quiz through the harness user-questions channel and pass their answer back together with the same quiz',
    }
  }

  if (answer === null || answer === undefined) {
    appendLedger(root, 'ratchet.ratify.prepare', {
      attempt,
      pending: targets.length,
      questions: quiz.questions.length,
    })
    return {
      ok: false,
      stage: 'ratify',
      project: config.project,
      needsAnswer: true,
      attempt,
      pending: targets.map((entry) => ({ id: entry.id, title: entry.title, path: entry.path, contentHash: entry.contentHash })),
      blocked: queue.blocked.map((entry) => ({ id: entry.id, path: entry.path, reason: entry.reason })),
      quiz,
      problems: unknownProblems,
      summary: summariseProblems(unknownProblems),
      nextStep:
        'ask the human these questions through the harness user-questions channel and call again with their answer; the approval is derived from the selected labels, so nothing else counts as consent',
    }
  }

  const derived = deriveDecisions(quiz, answer)
  // The hash check that makes the consent cover the text the human was SHOWN. The
  // quiz recorded each record's content hash when the question was built; a record
  // whose file changed while the question was open is refused rather than approved,
  // because the human read the earlier text and the approval would otherwise bind
  // whatever is on disk when the answer arrives — a substitution performed by
  // timing instead of by an edit.
  const changed = []
  const approvedEntries = []
  for (const entry of targets) {
    if (!derived.approved.includes(entry.id)) continue
    const offered = offeredBy(quiz, entry.id)
    if (offered !== null && offered.contentHash !== null && offered.contentHash !== entry.contentHash) {
      changed.push({ id: entry.id, offered: offered.contentHash, current: entry.contentHash })
      continue
    }
    approvedEntries.push(entry)
  }
  const changedProblems = changed.map((entry) =>
    problem(
      'RATIFICATION_STALE',
      `ADR ${entry.id} changed while the question about it was open: the human was shown the text hashing to ${entry.offered}, and the file now hashes to ${entry.current}, so their answer is about a text that is no longer there. Nothing was ratified for it; ask again`,
      entry.id,
      { offered: entry.offered, current: entry.current },
    ),
  )
  const unreadableEntries = targets.filter((entry) => derived.unreadable.some((item) => item.id === entry.id))
  // One re-ask, differently shaped, and only from the first attempt. A third asks a
  // human to keep answering a machine until it gets the answer it expected.
  const reask =
    attempt === 1 && unreadableEntries.length > 0
      ? buildQuiz(unreadableEntries, { attempt: 2, previous: derived.unreadable, present })
      : null
  const unreadableProblems =
    derived.unreadable.length === 0
      ? []
      : [
          problem(
            'RATIFICATION_UNPROVEN',
            `the answer could not be read as approval or rejection for ${derived.unreadable.map((entry) => entry.id).join(', ')}, so nothing was ratified for ${derived.unreadable.length === 1 ? 'it' : 'them'}: ${derived.unreadable.map((entry) => `ADR ${entry.id}: ${entry.reason}`).join('; ')}`,
            null,
            { unreadable: derived.unreadable },
          ),
        ]

  if (approvedEntries.length === 0) {
    appendLedger(root, 'ratchet.ratify.no-consent', {
      attempt,
      rejected: derived.rejected.length,
      unreadable: derived.unreadable.length,
    })
    const problems = [...unknownProblems, ...unreadableProblems, ...changedProblems]
    return {
      ok: false,
      stage: 'ratify',
      project: config.project,
      decisions: derived.decisions,
      ratified: [],
      rejected: derived.rejected,
      unreadable: derived.unreadable,
      changed,
      wrote: [],
      reask,
      problems,
      summary: summariseProblems(problems),
      nextStep:
        changed.length > 0
          ? 'a record changed while the question was open, so its answer approved a text that is no longer there; ask again to consent to what the file says now'
          : reask === null
            ? 'the human answered, and no answer was an approval: the records stay proposed and nothing was written. Ask only if the decision changed'
            : 'ask the re-ask questions: they name the decision in their labels and carry the previous answer, so this answer can be derived rather than guessed',
    }
  }

  // The transcript is the source the approval cites, so it is rendered before the
  // approval that hashes it, and both are written before the compile that reads
  // them: a compile over a half-written ratification would report a corpus
  // problem the write itself created.
  const transcriptPath = transcriptPathFor(root, {
    sourcesDir: config.sourcesDir,
    at: timestamp,
    ids: approvedEntries.map((entry) => entry.id),
  })
  const transcriptText = renderTranscript({
    project: config.project,
    at: timestamp,
    askedBy,
    channel: RATIFY_CHANNEL,
    quiz,
    answer,
    decisions: derived.decisions,
    // The hashes the human was SHOWN, not the ones the files carry now: for anything
    // that survived the check above the two are equal, and for anything that did not
    // the transcript is the record of what the question offered.
    entries: targets.map((entry) => ({ ...entry, contentHash: offeredBy(quiz, entry.id)?.contentHash ?? entry.contentHash })),
  })
  const { id: approvalId } = nextApprovalId(root, config.decisionsDir)
  const approval = renderApprovalAdr({
    id: approvalId,
    at: timestamp,
    askedBy,
    channel: RATIFY_CHANNEL,
    approved: approvedEntries,
    transcriptPath,
    transcriptHash: hashSource(transcriptText),
    project: config.project,
    decisionsDir: config.decisionsDir,
  })

  if (write !== true) {
    const problems = [...unknownProblems, ...unreadableProblems, ...changedProblems]
    return {
      ok: false,
      stage: 'ratify',
      project: config.project,
      decisions: derived.decisions,
      ratified: approvedEntries.map((entry) => entry.id),
      rejected: derived.rejected,
      unreadable: derived.unreadable,
      changed,
      wrote: [],
      reask,
      approval: { id: approvalId, path: approval.path, title: approval.title },
      transcript: { path: transcriptPath },
      approvalText: approval.text,
      transcriptText,
      problems,
      summary: summariseProblems(problems),
      nextStep: 'call again with write enabled to record the consent; nothing is in force until the approval ADR exists',
    }
  }

  const written = writeRatification(root, {
    transcriptPath,
    transcriptText,
    approvalPath: approval.path,
    approvalText: approval.text,
  })
  if (!written.ok) {
    appendLedger(root, 'ratchet.ratify.write-failed', { problems: written.problems.length })
    const problems = [...unknownProblems, ...unreadableProblems, ...changedProblems, ...written.problems]
    return {
      ok: false,
      stage: 'ratify',
      project: config.project,
      decisions: derived.decisions,
      ratified: approvedEntries.map((entry) => entry.id),
      rejected: derived.rejected,
      unreadable: derived.unreadable,
      changed,
      wrote: written.written,
      reask,
      problems,
      summary: summariseProblems(problems),
    }
  }

  // The compile after the write is the proof the consent took effect: it reports
  // the law set that the approval just changed, and any problem the new record
  // introduced, rather than asserting that the ratification worked.
  const after = compileProject(root)
  appendLedger(root, 'ratchet.ratify.mint', {
    approval: approvalId,
    ratified: approvedEntries.map((entry) => entry.id),
    rejections: derived.rejected.length,
    unreadable: derived.unreadable.length,
    laws: after.report.counts.laws,
    inForce: after.report.counts.active,
    wrote: written.written.length,
  })

  const problems = [...unknownProblems, ...unreadableProblems, ...changedProblems, ...after.problems]
  return {
    ok: problems.length === 0,
    stage: 'ratify',
    project: config.project,
    decisions: derived.decisions,
    ratified: approvedEntries.map((entry) => entry.id),
    rejected: derived.rejected,
    unreadable: derived.unreadable,
    changed,
    wrote: written.written,
    reask,
    approval: { id: approvalId, path: approval.path, title: approval.title },
    transcript: { path: transcriptPath, hash: hashSource(transcriptText) },
    counts: after.report.counts,
    specHash: after.report.specHash,
    problems,
    summary: summariseProblems(problems),
    nextStep:
      reask === null
        ? 'run ratchet verify: the ratified decisions are law now, so the code has to be checked against the law set they changed'
        : 'the records that were ratified are in force; ask the re-ask questions for the ones whose answers could not be read',
  }
}

/**
 * Runs one ratification attempt sequence against a human channel the caller owns.
 *
 * The channel is INJECTED rather than reached for, exactly like the judge a review
 * spawns: this module never imports the harness, "no human channel is composed" is a
 * value the caller passes, and the whole question/answer/re-ask sequence is
 * therefore exercisable against a real service by a probe and against a two-line
 * fake by a test. The harness connection lives in the adapter that supplies
 * `askHuman`, and nowhere else.
 *
 * The sequence is bounded on purpose: one question per waiting decision, then at
 * most one differently shaped re-ask for answers that could not be read. A machine
 * that keeps rephrasing a question until it gets the answer it expected has stopped
 * asking and started insisting.
 *
 * @param options - `{ root, ids, askedBy, at, write, present, askHuman }`. `askHuman` is
 *   `(quiz) => Promise<{ kind: 'ok', answer } | { kind: 'unavailable', reason }>`
 *   or `null`, in which case the quiz is prepared and returned unanswered. `present`
 *   is forwarded to `ratify` for both the first question and the re-ask, so the whole
 *   sequence is shown in the one place the caller chose.
 * @returns A promise for the canonical ratification result, with `asked` describing
 *   how many questions were put to the human and how many attempts that took.
 */
export async function ratifyInteractively({
  root,
  ids = null,
  askedBy = 'unattributed',
  at = null,
  write = true,
  present = 'panel',
  askHuman = null,
} = {}) {
  const prepared = ratify({ root, ids, askedBy, at, write, present })
  if (prepared.needsAnswer !== true) return prepared

  if (askHuman === null) {
    return {
      ...prepared,
      askFailed: true,
      reason:
        'no human channel is available for this call, so the question was prepared but never put to anyone',
      asked: { attempts: 0, questions: 0 },
      nextStep:
        'put these questions to the human in a session where the ratchet can reach the question channel: the tool surface has no argument that accepts an answer, so a refusal here is a deployment fact rather than a prompt for the model to answer on the human\'s behalf',
    }
  }

  const asked = { attempts: 0, questions: 0, answers: [] }
  // A channel that THROWS is a channel that failed, not an exception the operation
  // passes on: the caller supplied it, and a tool call that dies inside its own
  // callback reports nothing about what was or was not consented to.
  const ask = async (quiz) => {
    try {
      const outcome = await askHuman(quiz)
      return outcome === null || outcome === undefined ? { kind: 'unavailable', reason: 'the human channel returned nothing' } : outcome
    } catch (error) {
      return { kind: 'unavailable', reason: String(error) }
    }
  }

  const first = await ask(prepared.quiz)
  asked.attempts += 1
  asked.questions += prepared.quiz.questions.length
  if (first.kind !== 'ok') {
    const reason = first.reason ?? 'the human channel returned nothing'
    appendLedger(root, 'ratchet.ratify.ask-failed', { reason: String(reason).slice(0, 300) })
    return {
      ...prepared,
      askFailed: true,
      reason: String(reason),
      asked,
      nextStep:
        'put these questions to the human yourself — the same ids, questions, options and detail — then ask them in a session where the ratchet can reach the question channel; an answer you type yourself is not a consent this ratchet can check',
    }
  }
  asked.answers.push(first.answer)

  let result = ratify({ root, answer: first.answer, quiz: prepared.quiz, ids, askedBy, at, write, present })
  if (result.reask !== null && result.reask !== undefined && result.reask.questions.length > 0) {
    const second = await ask(result.reask)
    asked.attempts += 1
    asked.questions += result.reask.questions.length
    if (second.kind === 'ok') {
      asked.answers.push(second.answer)
      result = ratify({
        root,
        answer: second.answer,
        quiz: result.reask,
        attempt: 2,
        previous: result.unreadable,
        ids,
        askedBy,
        at,
        write,
      })
    }
  }

  return { ...result, asked }
}

/**
 * Submits a verdict a caller produced without a judge.
 *
 * The self-review path ends here: the caller answers the prompt and files the
 * answer, so the record shows a self-review rather than an independent one.
 * Validation is identical to a spawned judge's, because the argument for checking
 * a model's output applies at least as strongly to output it wrote by hand.
 *
 * @param options - `{ root, job, verdict, record }`.
 * @returns The canonical review result.
 */
export function submitReview({ root, job, verdict, record = true } = {}) {
  const context = contextFor(root)
  const validation = dynamic.acceptSelfReview(verdict, {
    lawIds: context.lawIds,
    adrIds: context.adrIds,
  })
  const report = dynamic.buildReviewReport({
    job: job ?? 'review_change',
    judge: { kind: 'self', reason: 'the caller supplied the verdict; no independent judge ran' },
    verdict,
    validation,
    lawIds: context.lawIds,
    adrIds: context.adrIds,
  })

  if (record) {
    state.writeArtifact(root, STATE_PATHS.dynamicReport, `${JSON.stringify(report, null, 2)}\n`)
    appendLedger(root, 'ratchet.review.submitted', {
      job: report.job,
      advisory: true,
      verdictOk: report.verdictOk,
      findings: report.findings.length,
    })
  }

  return {
    ok: validation.ok && validation.problems.length === 0,
    stage: 'review',
    job: report.job,
    advisory: true,
    gate: false,
    judge: report.judge,
    findings: validation.findings,
    insufficientReasoning: validation.insufficientReasoning,
    report: STATE_PATHS.dynamicReport,
    problems: validation.problems,
    summary: summariseProblems(validation.problems),
  }
}
