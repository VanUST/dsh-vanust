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
import { MANIFEST_PATH, PROBLEM_CODES, UNUSABLE_PROBLEM_CODES, budgetProblem, hashSource, normaliseText, parseAdr, problem, workBudgetRead } from './ratchet-schema.mjs'
import {
  compileProject,
  comparePersistedBundle,
  bundleHash,
  readAdrCorpus,
  readManifest,
  renderSpecs,
  resolveActiveSet,
  specDriftProblems,
} from './ratchet-compiler.mjs'
import { DEFAULT_COMMAND_TIMEOUT_MS, codeHashFilesFor, codeHashFor, configHashFor, verifyProject } from './ratchet-verifier.mjs'
import * as state from './ratchet-state.mjs'
import * as dynamic from './ratchet-dynamic.mjs'
import * as contradictionModule from './ratchet-contradiction.mjs'
import * as dedupeModule from './ratchet-dedupe.mjs'
import { draftNeedsHuman, staleNotePath } from './ratchet-drafts.mjs'
import * as ingestModule from './ratchet-ingest.mjs'
import {
  STATE_PATHS,
  appendLedger,
  detectSpecDrift,
  persistCompile,
  readLedger,
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
 * The comparison is against the previous law set, read from the LEDGER first, because
 * `compile --write` rewrites the persisted bundle and a deletion that also removed the
 * ledger used to leave no history to compare against. When the ledger holds no recorded
 * set — it was deleted, or holds only runs that recorded none — the persisted bundle is
 * read as the fallback: `readPersistedLawIds` explains why that is safe here and which
 * gap it leaves. Both reads happen BEFORE this run persists, so neither can compare the
 * set with itself.
 *
 * A first run on a project with no recorded history returns nothing rather than
 * everything: `null` from both readers means "no set was ever recorded", while `[]`
 * means "a set with no laws", and only the first may be treated as unknown.
 *
 * @param root - Absolute project root.
 * @param compiled - The result of compiling the corpus.
 * @returns An array of problems; empty when no law left force, or when each one left
 *   through an active record's explicit `remove` op.
 */
function lawRemovalProblems(root, compiled) {
  const previous = state.readRecordedLawIds(root) ?? state.readPersistedLawIds(root)
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
 * @param options - `{ budget }`. `budget` is a work-budget tracker (see
 *   `createWorkBudget`); the tool surface supplies one so the walk, the ADR reads and the code
 *   hash are bounded on the harness event loop, while the CLI supplies none and stays
 *   unbounded. An exhausted budget adds a `WORK_BUDGET_EXCEEDED` problem, so a status over a
 *   tree that could not be fully read never reads as clean.
 * @returns The canonical status result. Always resolves: a project with no
 *   manifest is a status, not an error.
 */
export function status(root, options = {}) {
  const budget = options.budget ?? null
  const manifest = readManifest(root, budget)
  const compiled = compileProject(root, { budget })

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
  // a status can be green over code the gate has since rejected. The list comes from
  // `codeHashFilesFor`, the budget-independent definition `verifyProject` also uses, so
  // both compute one tree identity and `status` cannot report VERIFY_NOT_RUN on a tree
  // nobody edited because the two walked it differently.
  const codeFiles = codeHashFilesFor(root)
  const verification = verificationStatus(
    root,
    compiled.report.specHash,
    checksExpected,
    codeHashFor(root, codeFiles, budget === null ? {} : budget.limits),
    configHashFor(manifest.config),
  )

  // The persisted bundle and the last verification are read here, not inferred
  // from the compile: "the corpus compiles" and "the verifier has judged the laws
  // currently in force" are different facts, and collapsing them is how a project
  // reports itself verified while nothing has checked it.
  const problems = [...compiled.problems, ...comparison.problems]
  // The compile already took the budget summary if it exhausted the budget reading ADRs. This
  // covers a stop in the walk or the code hash instead, and `budgetProblem` emits at most one
  // summary per tracker, so the two calls cannot double-report.
  const statusBudgetSummary = budgetProblem(budget)
  if (statusBudgetSummary !== null) problems.push(statusBudgetSummary)
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

  // The corpus's MEANING is checked by a different instrument — a judge, not the deterministic
  // verifier — and "nobody has looked" is a fact about a project rather than a defect in it.
  // It is therefore carried as a field the human-readable output prints and does NOT make
  // `status` red. The reason is the one §6.6 already records for generated specs: a status
  // that is red on the first run of every new project, for a step that needs a model and a
  // network, is a status people learn to ignore — and an ignored status is worse than a
  // separate line. `VERIFY_NOT_RUN` stays a problem because a shell can clear it.
  const contradictionReview =
    compiled.bundle === null ? null : contradictionReviewFact(root, bundleHash(compiled.bundle))

  const rendered = compiled.bundle === null ? { files: {} } : renderSpecs(compiled.bundle, manifest.config?.specsDir)
  const tracksSpecs = state.tracksSpecDocuments(root, manifest.config?.specsDir, manifest.config?.specsRequired)
  const drift = detectSpecDrift(root, rendered.files, manifest.config?.specsDir ?? null, budget)
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
      // A stale document is advisory; its drafted withdrawal note's path is reported here so a
      // reader can act on it. `status` is read-only, so it names the note the drafting pass
      // would write without writing it.
      notes: drift.stale.map((entry) => ({ path: entry.path, notePath: staleNotePath(manifest.config, entry.path) })),
    },
    tracksSpecDocuments: tracksSpecs,
    reviewRequired: compiled.report.reviewRequired,
    verified: {
      ran: verification.ran,
      stale: verification.stale,
      reason: verification.reason,
      last: verification.recorded ?? null,
    },
    contradictionReview,
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
 * @param options - `{ root, write, budget }`. `write` also emits the generated spec
 *   documents; the report and the spec bundle are recorded either way, because a
 *   report that exists only on success cannot record a failure. `budget` is a work-budget
 *   tracker (see `createWorkBudget`); the tool surface supplies one, the CLI none.
 * @returns The canonical compile result.
 */
export function compile({ root, write = false, budget = null } = {}) {
  const compiled = compileProject(root, { budget })
  // Read once, before the first use: the spec path comes from the manifest, and this function used
  // to read it further down. Naming `manifest` before it existed was a ReferenceError waiting for
  // the first project whose bundle compiled.
  const manifest = readManifest(root, budget)
  const rendered = compiled.bundle === null ? { files: {}, specHash: null } : renderSpecs(compiled.bundle, manifest.config?.specsDir)

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

  const config = manifest.config
  const tracksSpecs = state.tracksSpecDocuments(root, config?.specsDir, config?.specsRequired)
  const drift = detectSpecDrift(root, rendered.files, config?.specsDir ?? null, budget)
  const problems = [
    ...compiled.problems,
    ...removalProblems,
    ...specDriftProblems(reportedSpecDrift(tracksSpecs, drift)),
    ...writeProblems,
  ]
  // Idempotent: the compile took the summary if it exhausted the budget, and this covers a
  // budget spent outside `compileProject` (nothing currently is, but the contract is that the
  // operation's budget is reported by the operation, not by whichever helper happened to stop).
  const compileBudgetSummary = budgetProblem(budget)
  if (compileBudgetSummary !== null) problems.push(compileBudgetSummary)

  // The ratchet's OWN automatic drafting pass, run here rather than from a tool an agent has to
  // remember to call: it detects the decidable duplicates, the decidable contradictions and the
  // stale generated documents, and puts a `proposed` resolution — or, for a stale document, a
  // withdrawal NOTE — in front of a human. It writes no force and no approval, it is idempotent
  // (a draft carries `draft: true` and a `draftKey`), and a failure in it is a draft problem
  // carried in the result, never a gate: an advisory cannot make the compile red.
  //
  // The pass re-reads the whole corpus through paths that carry no budget, so on the in-process
  // path it is SKIPPED once the compile has exhausted its budget: reading a corpus the compile
  // just refused to read unbounded would defeat the budget entirely. The skip is reported, not
  // silent — the drafting result is advisory, and an advisory nobody could compute is a fact the
  // caller must see rather than an empty list they read as "nothing to draft".
  const budgetExhausted = budget !== null && budget !== undefined && budget.exceededCount > 0
  const drafting = budgetExhausted
    ? {
        duplicates: { drafts: [], alreadyDrafted: [], undraftable: [] },
        contradictions: { drafts: [], alreadyDrafted: [], undraftable: [] },
        staleNotes: [],
        problems: [
          problem(
            'WORK_BUDGET_EXCEEDED',
            'the automatic drafting pass was skipped because this compile exhausted the in-process work budget, so the corpus could not be read again in full: run the CLI (node plugins/ratchet/ratchet-cli.mjs compile) to draft over the whole corpus',
            null,
            { skipped: 'drafting', exceeded: budget.exceededCount },
          ),
        ],
      }
    : draftNeedsHuman(root, { write: true })
  const draftedStaleNotes = drafting.staleNotes.map((note) => ({
    path: note.path,
    notePath: note.notePath,
    written: note.written,
    existed: note.existed,
  }))

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
      // A stale document is advisory and carries the withdrawal note the ratchet drafted for
      // it. The other three kinds are blocking problems above and carry no note.
      notes: draftedStaleNotes,
    },
    tracksSpecDocuments: tracksSpecs,
    wrote: [...specWrite.written, ...persisted.written],
    // What the automatic pass drafted, so the CLI can report it and a test can assert it
    // without reading the project. Nothing here is force.
    drafting: {
      duplicates: {
        drafted: drafting.duplicates.drafts.map((draft) => ({ id: draft.id, path: draft.path, title: draft.title, written: draft.written })),
        alreadyDrafted: drafting.duplicates.alreadyDrafted.map((draft) => ({ id: draft.id, path: draft.path, title: draft.title })),
        undraftable: drafting.duplicates.undraftable.map((entry) => ({ reason: entry.reason })),
      },
      contradictions: {
        drafted: drafting.contradictions.drafts.map((draft) => ({
          id: draft.id,
          path: draft.path,
          title: draft.title,
          written: draft.written,
          offenderId: draft.offenderId,
          holderId: draft.holderId,
          lawIds: draft.lawIds,
          strategy: draft.strategy,
        })),
        alreadyDrafted: drafting.contradictions.alreadyDrafted.map((draft) => ({ id: draft.id, path: draft.path, offenderId: draft.offenderId, holderId: draft.holderId })),
        undraftable: drafting.contradictions.undraftable.map((entry) => ({ offenderId: entry.offenderId, holderId: entry.holderId, reason: entry.reason })),
      },
      staleNotes: draftedStaleNotes,
      problems: drafting.problems,
    },
    // A deterministic fact, reported and never a gate: whether any corpus review has recorded
    // the law set this compile produced. `status` is where it is a problem, the way
    // `VERIFY_NOT_RUN` is; here it is a field the CLI prints, so the operation that changed
    // the laws says out loud what nobody has judged about them yet.
    contradictionReview:
      compiled.bundle === null
        ? null
        : contradictionReviewFact(root, bundleHash(compiled.bundle)),
    problems,
    summary: summariseProblems(problems),
  }
}

/**
 * Verifies the codebase against the laws currently in force.
 *
 * @param options - `{ root, runCommand, budget }`. `budget` is a work-budget tracker (see
 *   `createWorkBudget`); the tool surface supplies one so the walk, the ADR reads and every
 *   text check are bounded on the harness event loop, while the CLI supplies none and stays
 *   unbounded. When the budget is exhausted the verification returns a `WORK_BUDGET_EXCEEDED`
 *   problem, `stage: 'budget'`, and no verdict — it is not a clean run over part of the tree.
 * @returns The canonical verify result. A corpus that does not compile blocks the
 *   verification rather than proceeding against a stale bundle, and says so with
 *   `stage: 'compile'` so a caller can tell which stage refused.
 */
export async function verify({ root, runCommand = null, budget = null } = {}) {
  const compiled = compileProject(root, { budget })
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

  const manifest = readManifest(root, budget)
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
    budget,
  })

  // Spec drift is folded into the gate: laws that were hand-edited underneath the
  // code are a reason this verification is not trustworthy, not a separate
  // advisory a caller may ignore. Missing documents are only a problem once the
  // project tracks them — see `tracksSpecDocuments`.
  const rendered = renderSpecs(compiled.bundle, manifest.config?.specsDir)
  const tracksSpecs = state.tracksSpecDocuments(root, manifest.config?.specsDir, manifest.config?.specsRequired)
  const drift = detectSpecDrift(root, rendered.files, manifest.config?.specsDir ?? null, budget)
  // Also BEFORE persisting, for the same reason as in `compile`: the persisted verify
  // appends the law set this run observed, so the comparison has to happen first.
  const removalProblems = lawRemovalProblems(root, compiled)
  const problems = [
    ...verified.problems,
    ...removalProblems,
    ...specDriftProblems(reportedSpecDrift(tracksSpecs, drift)),
  ]
  if (budget !== null && budget !== undefined && budget.exceededCount > 0) {
    // Fail closed and produce NO verdict. A run that exhausted the budget read only part of
    // the tree, so recording it as this project's current verification would let a later
    // `status` answer "verified" from a partial read. The specific files are already in
    // `problems` (`CODE_FILE_TOO_LARGE` / `WORK_BUDGET_EXCEEDED`); this returns at the budget
    // stage instead of persisting, and the tool's caller is told to run the CLI.
    return {
      ok: false,
      stage: 'budget',
      project: compiled.report.project,
      specHash: compiled.report.specHash,
      reason:
        'the in-process work budget was exhausted, so this verification read only part of the tree and produced no verdict; run the CLI (node plugins/ratchet/ratchet-cli.mjs verify) which has no budget',
      problems,
      summary: summariseProblems(problems),
    }
  }
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
    counts: report.counts,    dependencyManifests: report.dependencyManifests,
    laws: report.laws,
    specDrift: {
      drifted: drift.drifted.map((entry) => entry.path),
      stale: drift.stale.map((entry) => entry.path),
      missing: tracksSpecs ? drift.missing : [],
      // Stale documents are advisory and carry the drafted withdrawal note's path; the other
      // three drift kinds remain blocking problems in `problems`.
      notes: drift.stale.map((entry) => ({ path: entry.path, notePath: staleNotePath(manifest.config, entry.path) })),
    },
    reports: { verify: STATE_PATHS.verifyReport, state: STATE_PATHS.state, ledger: STATE_PATHS.ledger },
    wrote: persisted.written,
    // The same deterministic fact a compile carries. Advisory here by construction: it is a
    // field, not a problem, so a project nobody has reviewed yet can still be verified.
    contradictionReview: contradictionReviewFact(root, bundleHash(compiled.bundle)),
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
    // The records and the bundle, because a judge's verdict has to be bound to the corpus it was
    // about: a block is retired by the record's own content hash moving, which needs the record.
    records: corpus.records,
    activeRecords,
    proposedRecords,
    bundle: compiled.bundle,
  }
}

/**
 * The ledger event that records a corpus contradiction review having run.
 *
 * One event per run, carrying the spec hash of the law set the judge actually read. It is the
 * deterministic fact a later `compile` or `verify` compares against: not what the judge
 * concluded — a model verdict is never a gate — but WHICH LAW SET HAS BEEN LOOKED AT. Without
 * it, "no contradiction was found" and "nobody ever looked" are the same state, which is how
 * three ratified laws came to contradict the shipped panel with no command noticing.
 */
export const CONTRADICTION_REVIEW_EVENT = 'ratchet.contradiction.reviewed'

/** Where a corpus review is recorded, and where its staleness is read from. */
const CORPUS_REVIEW_JOBS = new Set(['review_corpus'])

/**
 * The jobs whose findings belong to the CORPUS rather than to one change.
 *
 * Their advisory findings are persisted (`advisoryFindings`) so the decisions view model can
 * raise a `duplicate` or `deprecated` need long after the judge ran. `review_duplicates` is
 * here but deliberately NOT in {@link CORPUS_REVIEW_JOBS}: a duplicates review finding
 * something does not mean the corpus's contradictoriness has been reviewed, so it must not
 * clear that staleness.
 */
const CORPUS_FINDING_JOBS = new Set(['review_corpus', 'review_duplicates'])

/**
 * Reports whether the corpus's meaning has been reviewed for the law set now in force.
 *
 * The question this answers is deterministic, which is what lets the answer be reported by a
 * build gate: it is not "does the corpus contradict itself" — that is a judge's, and a
 * non-deterministic check that can fail a build is one people learn to re-run until it passes
 * — but "has any contradiction review run against the laws as they are now".
 *
 * The comparison is by spec hash, so it costs nothing when nothing changed: a corpus whose law
 * set is untouched since the last review is neither re-judged nor reported.
 *
 * @param root - Absolute project root.
 * @param specHash - Hash of the laws compiled now.
 * @returns `{ reviewed, stale, at, recordedHash, reason, ledgerSkipped, ledgerError }`.
 *   `reviewed` is false when no corpus review has ever been recorded, in which case
 *   `reason` says so and `stale` is true — a corpus nobody has looked at is not a corpus
 *   that has been checked. `ledgerSkipped` is how many ledger lines could not be parsed
 *   and were skipped, and `ledgerError` names a ledger that could not be read at all;
 *   both travel with the verdict because this answer is read FROM the ledger, and a
 *   partly-read history that reports only "no review recorded" is indistinguishable from
 *   a clean one. `ledgerSkipped` is always a number (0 for a healthy ledger) and
 *   `ledgerError` is always a string or null.
 */
export function contradictionReviewStatus(root, specHash) {
  const ledger = readLedger(root)
  const events = ledger.events ?? []
  // The ledger read is what produced — or failed to produce — this verdict, so what it
  // could not read is part of the answer rather than a separate question a caller has to
  // remember to ask. Never a problem and never a gate input: a damaged append is reported,
  // not fatal, which is why this is carried as fields on the same fact `compile` and
  // `verify` already print.
  const ledgerSkipped = Number.isFinite(ledger.skipped) ? ledger.skipped : 0
  const ledgerError = typeof ledger.error === 'string' ? ledger.error : null
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === null || typeof event !== 'object' || event.event !== CONTRADICTION_REVIEW_EVENT) continue
    const recordedHash = typeof event.specHash === 'string' ? event.specHash : null
    if (recordedHash === specHash) {
      return { reviewed: true, stale: false, at: event.at ?? null, recordedHash, reason: null, ledgerSkipped, ledgerError }
    }
    return {
      reviewed: true,
      stale: true,
      at: event.at ?? null,
      recordedHash,
      reason: `the last contradiction review ran at ${event.at ?? '(unknown time)'} against the law set hashing to ${recordedHash ?? '(none)'}, and the laws now hash to ${specHash}, so the corpus has changed since anything looked at its meaning`,
      ledgerSkipped,
      ledgerError,
    }
  }
  return {
    reviewed: false,
    stale: true,
    at: null,
    recordedHash: null,
    reason: `no contradiction review has ever been recorded for this project, so no run has looked for a decision that contradicts another in meaning — the deterministic checks see only the letter, which is how a contradiction can be written and enforced at the same time`,
    ledgerSkipped,
    ledgerError,
  }
}

/**
 * Records that a corpus review ran, against the law set it read.
 *
 * @param root - Absolute project root.
 * @param specHash - Hash of the laws the judge judged.
 * @param job - The review job.
 * @returns The ledger append result. A ledger that cannot be appended to is reported by
 *   `appendLedger` itself and does not fail the review.
 */
function recordContradictionReview(root, specHash, job) {
  return appendLedger(root, CONTRADICTION_REVIEW_EVENT, { job, specHash, advisory: true })
}

/**
 * The deterministic fact about contradiction detection, for a compile or a verify result.
 *
 * Deliberately NOT a problem, and so deliberately not a gate. `status` reports the same fact
 * the way it reports `VERIFY_NOT_RUN` — there it is a problem, because a status is a claim
 * about what is known — while `compile` and `verify` carry it as a named field the CLI prints.
 * The distinction is what keeps a rule that fires on the first run of every new project from
 * being a rule people disable on the second: a project that has never been reviewed has one
 * deterministic fact to read, not a red gate it cannot clear without a judge.
 *
 * @param root - Absolute project root.
 * @param specHash - Hash of the laws compiled now.
 * @returns `{ reviewed, stale, at, recordedHash, reason }` — see
 *   {@link contradictionReviewStatus}.
 */
function contradictionReviewFact(root, specHash) {
  return contradictionReviewStatus(root, specHash)
}

/**
 * The in-force statement of every law in a bundle, keyed by id.
 *
 * @param bundle - A compiled spec bundle, or `null`.
 * @returns A plain object of law id to statement text. `{}` for a null bundle, so a caller
 *   that has no bundle gets a map that matches nothing rather than a throw.
 */
function lawStatementsOf(bundle) {
  const out = {}
  for (const law of bundle?.laws ?? []) {
    if (typeof law?.id === 'string' && typeof law.statement === 'string') out[law.id] = law.statement
  }
  return out
}

/**
 * The spec hash of every law in a bundle, keyed by id.
 *
 * The hash of one law is not stored on the bundle — the bundle hashes as a whole — so this is
 * the whole-bundle hash, which is what a judge can see and quote. It is enough for the check
 * it serves: a finding that cites the current bundle hash is talking about the law set that
 * is in force, and the statement comparison covers the per-law case.
 *
 * @param bundle - A compiled spec bundle, or `null`.
 * @returns A plain object of law id to `sha256:<hex>`. `{}` for a null bundle.
 */
function lawHashesOf(bundle) {
  const out = {}
  if (bundle === null || bundle === undefined) return out
  const hash = bundleHash(bundle)
  for (const law of bundle.laws ?? []) {
    if (typeof law?.id === 'string') out[law.id] = hash
  }
  return out
}

/**
 * Extracts the static prefix of a rendered judge prompt, for the shared judge.
 *
 * The judge pool delivers a prompt's static prefix once, when the child is created, and
 * sends only the remainder on later calls. The prefix has to be an exact byte prefix of the
 * rendered prompt, so it is found by its section marker (the point where call-specific
 * material starts) rather than regenerated — a second rendering would drift from the first.
 *
 * It is deliberately forgiving: when no marker is present the whole prompt is returned, so
 * the caller sends the full prompt every call and no text is ever dropped because a prompt
 * builder changed shape. That degrades to "no prefix caching", never to a truncated task.
 *
 * @param prompt - A fully rendered judge prompt.
 * @param markers - Section markers that begin the per-call material, in preference order.
 * @returns A prefix of `prompt` (possibly all of it).
 */
function staticPrefixOf(prompt, markers) {
  const text = String(prompt ?? '')
  for (const marker of markers) {
    const at = text.indexOf(marker)
    if (at > 0) return text.slice(0, at)
  }
  return text
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
 *   `(prompt, schema, staticPrompt?) => Promise<{ structured, output, stopReason, diagnostic }>`
 *   or `null` for the degraded path. `staticPrompt` is the prompt's unchanged prefix; a
 *   reused judge receives it once and only the remainder afterwards, and a one-shot spawner
 *   ignores it. `record` writes the report when true.
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
    // The corpus material before `# Question` does not change between reviews of the same
    // project state, so a reused judge child reads it once; only the question and the change
    // travel as call-specific material.
    judgeResult = await spawnJudge(prompt, outputSchema, staticPrefixOf(prompt, ['\n# Question']))
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
        specHash: context.bundle === null ? null : bundleHash(context.bundle),
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
    // What each law in force SAYS, and its hash, so a finding bound to a law has to quote
    // that law to be believed. Without this the validator can only check that the id exists,
    // and a judge that names a real id while describing a superseded statement produces a
    // finding nothing can refute — measured on this kit, where exactly that froze every
    // write under `plugins/**` until a second review corrected it.
    laws: lawStatementsOf(context.bundle),
    lawHashes: lawHashesOf(context.bundle),
  })
  const problems = [...extra, ...validation.problems]

  // The judge's semantic verdict becomes a FACT here, not advice. A finding that this change
  // contradicts a decision in meaning is recorded, so the write guard can refuse the work and hand
  // this reasoning back to whoever proposed it; and the review itself DECLINES. An independent
  // judge's clean verdict retires the entry for the material it judged, which is how a
  // material-targeted block is cleared. Everything else a judge may say stays advice.
  const target = contradictionModule.contradictionTarget({
    job,
    proposal,
    change,
    source,
    records: context.records,
  })
  const blocking = contradictionModule.blockingFindings(validation.findings)
  const independentJudge = judgeIdentity.kind === 'subagent'
  let declined = null
  if (record && blocking.length > 0) {
    contradictionModule.recordContradiction(root, { target, findings: blocking, job })
    declined = {
      findings: blocking,
      zones: [
        ...contradictionModule.blockedZones([{ entry: { target, findings: blocking } }], {
          active: context.activeRecords,
          proposed: context.proposedRecords,
          laws: context.bundle?.laws ?? [],
        }),
      ],
    }
    appendLedger(root, 'ratchet.review.declined', {
      job,
      findings: blocking.length,
      zones: declined.zones.length,
      target: contradictionModule.contradictionKey(target),
    })
  } else if (record && independentJudge && parsed.problem === null && judgeError === null && validation.ok) {
    // Only an INDEPENDENT, USABLE, clean verdict retires a block. Two ways this was wrong:
    // a self-submitted verdict could clear one (an agent lifting its own block by answering its own
    // question), and so could an independent judge whose answer could not be parsed or failed
    // validation — prose, `{}`, or a finding citing a law nobody declares. An unusable answer is not
    // a clean bill of health, which is what `validateVerdict` warns about in its own comment; here it
    // silently lifted the block instead.
    contradictionModule.clearContradiction(root, target)
  }

  const report = dynamic.buildReviewReport({
    job,
    judge: judgeIdentity,
    verdict: parsed.verdict,
    validation,
    lawIds: context.lawIds,
    adrIds: context.adrIds,
    specHash: context.bundle === null ? null : bundleHash(context.bundle),
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
    // A corpus review is the one that answers "does this law set contradict itself in
    // meaning", so it is the one that records WHICH law set was read. Recorded even when the
    // judge's answer was unusable: "somebody looked and the answer was unusable" and "nobody
    // looked" are different states, and the ledger has to be able to tell them apart.
    if (CORPUS_REVIEW_JOBS.has(job)) recordContradictionReview(root, bundleHash(context.bundle), job)
    // The findings themselves, keyed by job and bound to the law set the judge read, so a
    // duplicate or a retirement the judge named reaches a human through the decisions view
    // model instead of dying with this report file (which the next review overwrites).
    if (CORPUS_FINDING_JOBS.has(job)) {
      state.recordAdvisoryFindings(root, {
        job,
        specHash: context.bundle === null ? null : bundleHash(context.bundle),
        findings: report.findings,
        at: report.generatedAt,
      })
    }
  }

  return {
    // `ok` describes the JUDGE's verdict. On a blocking contradiction it also describes the
    // REVIEW's answer, because that verdict is what the guard now enforces: the change is
    // declined, not merely annotated.
    ok: declined === null && validation.ok && problems.length === 0,
    stage: 'review',
    job,
    kind: 'verdict',
    advisory: declined === null,
    gate: declined !== null,
    declined: declined !== null,
    ...(declined === null ? {} : { blocking: declined }),
    ...(declined === null
      ? {}
      : {
          nextStep:
            'change the change so it stops contradicting the law in force, then review it again: an independent clean verdict retires this block, and a proposal-bound block retires by itself when the record is edited. A human can also decide the question, which is what ratchet_ratify is for — do not edit .dsh/ratchet/contradiction.json, which is machine-written state',
        }),
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
  budget = null,
} = {}) {
  const manifest = readManifest(root, budget)
  if (manifest.config === null || manifest.config.enabled !== true) {
    const problems = manifest.config === null
      ? manifest.problems
      : [problem('RATCHET_DISABLED', `${MANIFEST_PATH} does not declare ratchet.enabled, so there is nowhere to record a decision`)]
    return { ok: false, stage: 'ingest', problems, summary: summariseProblems(problems) }
  }
  const config = manifest.config

  const source = ingestModule.readSource(root, sourcePath, budget)
  if (source.error !== undefined) {
    const problems = [
      source.notRegular === undefined
        ? problem('ADR_SOURCE_MISSING', source.error, null, { path: sourcePath })
        : problem(
            'CODE_FILE_NOT_REGULAR',
            `${sourcePath} was not opened because it is a ${source.notRegular.kind}, not a regular file, so there is no reasoning to ingest`,
            null,
            { path: sourcePath, kind: source.notRegular.kind },
          ),
    ]
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
      judgeResult = await spawnJudge(prompt, ingestModule.INGEST_SCHEMA, staticPrefixOf(prompt, ['\nExisting ADR ids']))
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
 * Extracts MANY proposed records from one source in one call.
 *
 * The batch counterpart of {@link ingest}, and a separate operation rather than a mode flag
 * because the two carry different guarantees: a single ingestion proves that every sentence
 * the judge attributes to the source appears there, while a batch proves only that each
 * decision cites a span that does — a weaker per-record attribution, knowingly accepted in
 * exchange for serving a document that holds many decisions. One call whose guarantees
 * differ by argument is a call whose callers cannot tell which guarantee they got.
 *
 * The work is split the same way `ingest` splits it: this operation owns the project, the
 * source, the ledger and the disk; `ratchet-ingest.mjs` owns the prompt, the contract, the
 * span locator, the cap and per-decision validation. The judge is injected, so this module
 * never imports the harness and the whole path is testable with a submitted answer.
 *
 * Order of operations, and why:
 *
 *  1. The cap is checked before anything is written, and it refuses the whole call. A batch
 *     above the cap needs the source SPLIT, and the refusal carries the headings
 *     `ratchet-ingest.mjs` found so the split is mechanical.
 *  2. Each decision is validated independently. One whose span cannot be located, whose
 *     zones are undeclared or whose reasoning is missing is refused BY NAME while the rest
 *     still land: one misattributed extraction costs one record, not the batch.
 *  3. Each accepted record is parsed against the rules a written record faces BEFORE it is
 *     written, and one that does not compile is not written. A refusal that still left the
 *     file behind would be the worst outcome — a corpus the ratchet cannot read, from a call
 *     that reported a refusal.
 *
 * Every record it writes is `proposed`: the renderer emits that status unconditionally, so
 * no batch puts a decision into force.
 *
 * @param options - `{ root, sourcePath, spawnJudge, submitted, write, authorName, now }`.
 *   `submitted` is a caller-produced judge result, validated exactly like a spawned one;
 *   `spawnJudge` is `null` in a shell, which yields the degraded path — the prompt returned
 *   unrun with the source hash, the cap and the headings, so the caller can answer it.
 * @returns A JSON-safe result with `ok`, `stage: 'ingest-batch'`, `advisory: true`, the
 *   `cap`, the `headings` found, `records` (one entry per decision with its id, path, laws
 *   and whether it was written), `written` (the paths that landed), `refused` (one entry per
 *   refused decision, with the code naming what was wrong), `problems`, `summary` and
 *   `nextStep`. `ok` is true only when every decision landed: a batch that wrote five of six
 *   records reports the sixth. A missing manifest, an unreadable source or an over-cap batch
 *   yields `ok: false` with the reason and writes nothing.
 */
export async function ingestBatch({
  root,
  sourcePath,
  spawnJudge = null,
  submitted = null,
  write = false,
  authorName = 'ratchet-ingest',
  now = null,
  budget = null,
} = {}) {
  const manifest = readManifest(root, budget)
  if (manifest.config === null || manifest.config.enabled !== true) {
    const problems = manifest.config === null
      ? manifest.problems
      : [problem('RATCHET_DISABLED', `${MANIFEST_PATH} does not declare ratchet.enabled, so there is nowhere to record a decision`)]
    return { ok: false, stage: 'ingest-batch', problems, summary: summariseProblems(problems) }
  }
  const config = manifest.config

  const source = ingestModule.readSource(root, sourcePath, budget)
  if (source.error !== undefined) {
    const problems = [
      source.notRegular === undefined
        ? problem('ADR_SOURCE_MISSING', source.error, null, { path: sourcePath })
        : problem(
            'CODE_FILE_NOT_REGULAR',
            `${sourcePath} was not opened because it is a ${source.notRegular.kind}, not a regular file, so there is no reasoning to ingest`,
            null,
            { path: sourcePath, kind: source.notRegular.kind },
          ),
    ]
    return { ok: false, stage: 'ingest-batch', problems, summary: summariseProblems(problems) }
  }

  const existing = ingestModule.existingAdrIds(root, config.decisionsDir)
  const context = contextFor(root)
  const prompt = ingestModule.renderBatchIngestPrompt({
    config,
    sourceText: source.text,
    sourcePath,
    existingIds: existing.ids,
    corpusSummary: context.stable,
  })
  const headings = ingestModule.headingsIn(source.text)

  if (spawnJudge === null && submitted === null) {
    return {
      ok: false,
      stage: 'ingest-batch',
      advisory: true,
      degraded: true,
      sourcePath,
      sourceHash: source.hash,
      existingIds: existing.ids,
      nextId: ingestModule.nextAdrId(existing.ids),
      cap: ingestModule.BATCH_DECISION_CAP,
      headings,
      prompt,
      outputSchema: ingestModule.BATCH_INGEST_SCHEMA,
      note:
        'No judge could be spawned, so the batch prompt is returned unrun. Answer it and submit the result, ' +
        'or call this again from a session that can spawn a judge.',
      submitHint:
        'call ratchet_ingest_batch again with the same source and `ingest` set to the JSON object this prompt asks for',
      problems: [],
      summary: summariseProblems([]),
    }
  }

  let judgeResult = null
  let judgeError = null
  let parsed
  let judgeIdentity
  if (submitted !== null && submitted !== undefined) {
    parsed = { verdict: submitted, source: 'submitted', problem: null }
    judgeIdentity = { kind: 'caller', reason: 'the caller supplied the result; the ratchet spawned no judge' }
  } else {
    try {
      judgeResult = await spawnJudge(prompt, ingestModule.BATCH_INGEST_SCHEMA, staticPrefixOf(prompt, ['\nExisting ADR ids']))
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

  const validation = ingestModule.validateBatchIngest(parsed.verdict, {
    sourceText: source.text,
    config,
    existingIds: existing.ids,
  })

  if (validation.overCap) {
    appendLedger(root, 'ratchet.ingest.batch-over-cap', { sourcePath, cap: validation.cap, headings: headings.length })
    return {
      ok: false,
      stage: 'ingest-batch',
      advisory: true,
      code: 'BATCH_OVER_CAP',
      sourcePath,
      sourceHash: source.hash,
      judge: judgeIdentity,
      cap: validation.cap,
      // The boundaries the tool found, so the caller splits the source mechanically rather
      // than guessing where its sections are.
      headings: validation.headings,
      reason: `the batch carries more decisions than the cap of ${validation.cap}, so nothing was written: a batch above the cap is split on the source's headings and given to several calls`,
      nextStep: `split the source at the headings below and call again with at most ${validation.cap} decisions each; a call that writes the first ${validation.cap} would hide the decisions it did not reach`,
      problems: [],
      summary: summariseProblems([]),
    }
  }

  const problems = [...validation.problems]
  if (parsed.problem !== null) {
    problems.push(problem('DYNAMIC_REVIEW_REQUIRED', `the batch extraction produced no usable result: ${parsed.problem}`))
  }
  if (judgeError !== null) {
    problems.push(problem('DYNAMIC_REVIEW_REQUIRED', `the judge could not be run: ${judgeError}`))
  }
  if (validation.problems.length > 0) {
    appendLedger(root, 'ratchet.ingest.batch-rejected', { sourcePath, problems: validation.problems.length })
    return {
      ok: false,
      stage: 'ingest-batch',
      advisory: true,
      sourcePath,
      sourceHash: source.hash,
      judge: judgeIdentity,
      cap: validation.cap,
      headings: validation.headings,
      problems,
      summary: summariseProblems(problems),
    }
  }

  const records = []
  const refused = [...validation.refused]
  buildBatchRecords({
    root,
    config,
    accepted: validation.accepted,
    refused,
    records,
    sourcePath,
    sourceHash: source.hash,
    write,
    now,
    authorName,
  })

  const written = records.map((record) => record.written).filter((path) => path !== null)
  appendLedger(root, 'ratchet.ingest.batch-propose', {
    sourcePath,
    decisions: validation.accepted.length,
    written: written.length,
    refused: refused.length,
    cap: validation.cap,
  })

  return {
    ok: records.length > 0 && refused.length === 0,
    stage: 'ingest-batch',
    advisory: true,
    status: 'proposed',
    sourcePath,
    sourceHash: source.hash,
    judge: judgeIdentity,
    cap: validation.cap,
    headings: validation.headings,
    records,
    written,
    refused,
    problems,
    summary: summariseProblems(problems),
    nextStep:
      refused.length > 0
        ? 'fix the refused decisions and call again: each refusal names the decision and what was wrong with it, and the records that were accepted are already written'
        : records.length === 0
          ? 'nothing was accepted from this batch, so no record exists to ratify'
          : 'every record is proposed: a human must ratify each one before it becomes law, through the one consent channel',
  }
}

/**
 * Turns accepted decisions into records, writing each one, and records each refusal in place.
 *
 * Extracted from the batch operation so the multi-chunk path uses the SAME record-building
 * rules rather than a second copy of them: two paths that each decide what compiles, what is
 * already recorded and what a refusal looks like are two paths that will disagree. Mutates
 * `records` and `refused`, which the caller owns, so the caller's ordering is preserved.
 *
 * @param options - `{ root, config, accepted, refused, records, sourcePath, sourceHash,
 *   write, now, authorName }`. `accepted` is `validateIngest`'s accepted list; `refused` is
 *   appended to, never replaced.
 * @returns Nothing. A decision already on record, one that does not compile, and one whose
 *   file cannot be written each become a refusal with its own code, and the rest become
 *   records. Empty `accepted` writes nothing.
 */
function buildBatchRecords({
  root,
  config,
  accepted = [],
  refused,
  records,
  sourcePath,
  sourceHash,
  write,
  now,
  authorName,
}) {
  for (const decision of accepted) {
    // A decision already on record is not written a second time, for the same reason the
    // single-decision path refuses it: two records for one decision compile perfectly and the
    // duplication is invisible until somebody counts.
    const alreadyRecorded = ingestModule.findExistingBySlug(root, decision.fields.title, config.decisionsDir)
    if (alreadyRecorded !== null) {
      refused.push({
        index: decision.index,
        title: decision.title,
        code: 'ALREADY_RECORDED',
        span: decision.span.slice(0, 200),
        reason: `a record for this decision already exists at ${config.decisionsDir}/${alreadyRecorded}`,
        problems: [],
      })
      continue
    }

    const rendered = ingestModule.renderAdr({
      fields: decision.fields,
      sourcePath,
      sourceHash,
      createdAt: now ?? new Date().toISOString(),
      authorName,
      decisionsDir: config.decisionsDir,
    })
    const compiled = compileRenderedAdr(root, rendered, config)
    let writtenPath = null
    if (write) {
      if (!compiled.ok) {
        refused.push({
          index: decision.index,
          title: decision.title,
          code: 'DOES_NOT_COMPILE',
          span: decision.span.slice(0, 200),
          reason: `the generated record does not compile, so it was not written: ${compiled.problems.map((entry) => entry.message).join('; ')}`,
          problems: compiled.problems,
        })
        continue
      }
      const outcome = ingestModule.writeIngested(root, rendered)
      if (outcome.error !== undefined) {
        refused.push({
          index: decision.index,
          title: decision.title,
          code: 'WRITE_FAILED',
          span: decision.span.slice(0, 200),
          reason: outcome.error,
          problems: [],
        })
        continue
      }
      writtenPath = outcome.written
    }
    records.push({
      index: decision.index,
      id: decision.fields.id,
      filename: rendered.filename,
      path: rendered.path,
      title: decision.fields.title,
      // Always proposed, whatever the judge said: `renderAdr` emits the status, and this is
      // restated here so a caller reading the batch result does not have to open the file.
      status: 'proposed',
      zones: decision.fields.zones,
      laws: decision.fields.laws.map((law) => law.id),
      span: decision.span,
      acceptedChecks: decision.fields.laws.reduce((total, law) => total + law.checks.length, 0),
      dropped: decision.dropped,
      compiles: compiled.ok,
      written: writtenPath,
    })
  }
}

/**
 * Ingests a document of decisions through ONE entry point that decides how to read it.
 *
 * The two extraction paths were two tools a developer had to choose between, and choosing
 * wrongly was invisible: a fifty-decision document sent to the single-decision path produced
 * one record and silently left the rest, while a one-decision source sent to the batch path
 * carried weaker attribution than it needed. Neither is a mistake the caller can see from the
 * outside, so the choice is not the caller's to make. This operation makes it: it splits the
 * source into the chunks one batch may carry ({@link planIngestChunks}), asks a judge for each
 * chunk in turn, validates each answer against ITS OWN chunk rather than against the whole
 * document, and writes what passes. A document the cap can hold is one chunk and therefore
 * exactly one judge call, which is what keeps the common case cheap.
 *
 * The attribution guarantee is unchanged and is per decision: every decision must cite a span
 * that {@link validateBatchIngest} locates in the text it was extracted from, and a decision
 * whose span cannot be found is refused ALONE while the rest of its chunk still lands.
 * Nothing here can put a decision into force — every record is written `proposed`.
 *
 * When no judge can be spawned, the operation does not fail: it returns the per-chunk prompts
 * this system asked for and says so, and the answers come back the same way the single-chunk
 * path already accepts them — in the `ingest` argument of the next call. That is the
 * split-and-drive behaviour a tool can implement without a judge, and it is deliberately not
 * an invented API: the prompt and the schema are the ones the judge would have received.
 *
 * @param options - `{ root, sourcePath, write, submitted, spawnJudge, authorName, now }`.
 *   `submitted` is either a single chunk verdict (an object with a `decisions` array, which
 *   is what the one-chunk case asks for) or an array of them in chunk order; a missing or
 *   `null` entry for a chunk is the chunk the caller did not answer. `spawnJudge` is
 *   `(prompt, schema) => Promise<{ structured, output, stopReason }>` or `null`.
 * @returns The canonical multi-chunk ingest result: `{ ok, stage, chunks, records, written,
 *   refused, unanswered, problems, summary, nextStep }`. `chunks` reports what the split did
 *   — its boundaries, its headings and the judge's identity per chunk — so "what did it do to
 *   my document" is answerable from the result rather than inferred.
 */
export async function ingestAuto({
  root,
  sourcePath,
  write = false,
  submitted = null,
  spawnJudge = null,
  authorName = 'ratchet-ingest',
  now = null,
  budget = null,
} = {}) {
  const manifest = readManifest(root, budget)
  if (manifest.config === null || manifest.config.enabled !== true) {
    const problems = manifest.config === null
      ? manifest.problems
      : [problem('RATCHET_DISABLED', `${MANIFEST_PATH} does not declare ratchet.enabled, so there is nowhere to record a decision`)]
    return { ok: false, stage: 'ingest-auto', problems, summary: summariseProblems(problems) }
  }
  const config = manifest.config

  const source = ingestModule.readSource(root, sourcePath, budget)
  if (source.error !== undefined) {
    const problems = [
      source.notRegular === undefined
        ? problem('ADR_SOURCE_MISSING', source.error, null, { path: sourcePath })
        : problem(
            'CODE_FILE_NOT_REGULAR',
            `${sourcePath} was not opened because it is a ${source.notRegular.kind}, not a regular file, so there is no reasoning to ingest`,
            null,
            { path: sourcePath, kind: source.notRegular.kind },
          ),
    ]
    return { ok: false, stage: 'ingest-auto', problems, summary: summariseProblems(problems) }
  }

  const plan = ingestModule.planIngestChunks(source.text)
  const existing = ingestModule.existingAdrIds(root, config.decisionsDir)
  const context = contextFor(root)
  // The answers, by chunk. A single verdict object is the one-chunk case; an array is one
  // answer per chunk with `null` for the ones still missing. Neither shape carries a
  // decision of its own: every entry is validated exactly as the batch path validates one.
  const answers = Array.isArray(submitted) ? submitted : plan.chunks.length === 1 && submitted !== null ? [submitted] : []

  const records = []
  const refused = []
  const chunks = []
  const unanswered = []
  const problems = []
  const ids = [...existing.ids]

  for (const chunk of plan.chunks) {
    const prompt = ingestModule.renderBatchIngestPrompt({
      config,
      sourceText: chunk.text,
      sourcePath,
      existingIds: ids,
      corpusSummary: context.stable,
    })
    const answer = answers[chunk.index - 1] ?? null
    let verdict = null
    let judgeIdentity = null

    if (answer !== null && answer !== undefined) {
      verdict = answer
      judgeIdentity = { kind: 'caller', reason: 'the caller supplied the result; the ratchet spawned no judge' }
    } else if (spawnJudge !== null) {
      try {
        // Each auto-ingest chunk draws on the same project header, so a batch of chunks
        // reuses one judge and pays for the orientation once; only the ids, source and
        // format travel per chunk.
        const judged = await spawnJudge(prompt, ingestModule.BATCH_INGEST_SCHEMA, staticPrefixOf(prompt, ['\nExisting ADR ids']))
        const parsed = judged === null || judged === undefined
          ? { verdict: null, problem: 'the judge produced no result' }
          : dynamic.parseVerdict(judged.structured ?? null, judged.output ?? null)
        verdict = parsed.verdict
        judgeIdentity = { kind: 'subagent', stopReason: judged?.stopReason ?? null, verdictSource: parsed.source ?? null }
        if (parsed.problem !== null && parsed.problem !== undefined) {
          problems.push(problem('DYNAMIC_REVIEW_REQUIRED', `chunk ${chunk.index} produced no usable result: ${parsed.problem}`))
        }
      } catch (error) {
        judgeIdentity = { kind: 'none', reason: String(error) }
        problems.push(problem('DYNAMIC_REVIEW_REQUIRED', `the judge could not be run for chunk ${chunk.index}: ${String(error)}`))
      }
    } else {
      unanswered.push({
        index: chunk.index,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        headings: chunk.headings,
        prompt,
      })
      chunks.push({
        index: chunk.index,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        headings: chunk.headings,
        mechanical: chunk.mechanical,
        judge: null,
        accepted: 0,
        refused: 0,
        unanswered: true,
      })
      continue
    }

    const validation = ingestModule.validateBatchIngest(verdict, {
      sourceText: chunk.text,
      config,
      existingIds: ids,
      cap: plan.cap,
    })
    const before = { records: records.length, refused: refused.length }
    // A decision this chunk refused is reported whatever the batch verdict was, and an
    // over-cap batch is the ONE case with no per-decision verdicts at all: `validateBatchIngest`
    // returns before judging any decision when the call itself is too large. Gating on
    // `problems` alone was wrong — the per-decision failures live in `refused` and `problems`
    // is empty for them — so a chunk whose single decision cited a span from another chunk
    // fell into the "nothing to see" branch and its refusal vanished.
    refused.push(...(validation.refused ?? []).map((entry) => ({ ...entry, chunk: chunk.index })))
    if (validation.overCap) {
      problems.push(
        problem(
          'DYNAMIC_REVIEW_REQUIRED',
          `chunk ${chunk.index} (lines ${chunk.startLine}-${chunk.endLine}) still carries more decisions than the cap of ${plan.cap} after the split, so nothing was written from it: the split cuts on headings, so this means one heading covers more than ${plan.cap} decisions and the chunk has to be split by hand`,
        ),
      )
    } else {
      problems.push(...validation.problems)
      buildBatchRecords({
        root,
        config,
        accepted: validation.accepted,
        refused,
        records,
        sourcePath,
        sourceHash: source.hash,
        write,
        now,
        authorName,
      })
      for (const decision of validation.accepted) ids.push(decision.fields.id)
    }

    chunks.push({
      index: chunk.index,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      headings: chunk.headings,
      mechanical: chunk.mechanical,
      judge: judgeIdentity,
      accepted: records.length - before.records,
      refused: refused.length - before.refused,
      unanswered: false,
    })
  }

  const written = records.map((record) => record.written).filter((path) => path !== null)
  appendLedger(root, 'ratchet.ingest.auto', {
    sourcePath,
    chunks: chunks.length,
    unanswered: unanswered.length,
    written: written.length,
    refused: refused.length,
  })

  return {
    ok: records.length > 0 && refused.length === 0 && unanswered.length === 0 && problems.length === 0,
    stage: 'ingest-auto',
    advisory: true,
    status: 'proposed',
    sourcePath,
    sourceHash: source.hash,
    cap: plan.cap,
    chunkCount: chunks.length,
    chunks,
    records,
    written,
    refused,
    unanswered,
    problems,
    summary: summariseProblems(problems),
    nextStep:
      unanswered.length > 0
        ? `no judge could be spawned for ${unanswered.length} of ${chunks.length} chunk(s), so their prompts are returned unrun: answer them and call ratchet_ingest again with the same source and \`ingest\` set to the array of results, or call again from a session that can spawn a judge. Chunk ${unanswered[0].index} covers lines ${unanswered[0].startLine}-${unanswered[0].endLine}`
        : refused.length > 0
          ? 'fix the refused decisions and call again: each refusal names its chunk, the decision and what was wrong with it, and the records that were accepted are already written'
          : records.length === 0
            ? 'nothing was accepted from this source, so no record exists to ratify'
            : 'every record is proposed: a human ratifies each one before it becomes law, through the one consent channel',
  }
}

/**
 * Drafts one proposed resolution for every duplicate the deterministic rules can decide.
 *
 * This is the automatic half of deduplication, and it stops exactly where consent begins. It
 * detects the duplicates a machine can decide, drafts an ordinary `proposed` decision record
 * for each — `resolves: [loser, winner]` plus the surgical `op: remove` for the law that
 * duplicates, as ADR 0031 settled — writes them if asked, and reports what it did. It writes
 * no approval and puts nothing into force: the developer's only act is to ratify or decline,
 * and deleting a draft is the whole of a decline. A finding it cannot draft is reported with
 * its reason rather than guessed at.
 *
 * The deterministic command keeps its own exit code and never runs a model; this operation
 * shares the same rule module rather than a second copy of the rules, so the report and the
 * drafts cannot disagree about what a duplicate is.
 *
 * @param options - `{ root, write, createdAt }`. `write` places each draft under the
 *   decisions directory, refusing to overwrite an existing file.
 * @returns The drafting result from `draftResolutions`, plus `stage` and a `nextStep` naming
 *   the one action left to the developer. An unusable corpus is returned as
 *   `ok: false, unusable: true` with its problems, never as an empty corpus.
 */
export function deduplicate({ root, write = false, createdAt = null } = {}) {
  const drafted = dedupeModule.draftResolutions(root, { write, createdAt })
  const problems = drafted.problems ?? []
  const codes = problems.map((entry) => entry.code)
  if (drafted.unusable === true) {
    appendLedger(root, 'ratchet.dedupe.unusable', { problems: problems.length })
    return {
      ok: false,
      unusable: true,
      stage: 'deduplicate',
      scanned: drafted.scanned ?? null,
      duplicates: [],
      drafts: [],
      alreadyDrafted: [],
      undraftable: [],
      written: [],
      problems,
      summary: summariseProblems(problems),
    }
  }
  const written = drafted.drafts.map((draft) => draft.written).filter((path) => path !== null && path !== undefined)
  appendLedger(root, 'ratchet.dedupe.draft', {
    duplicates: drafted.drafts.length + drafted.alreadyDrafted.length + drafted.undraftable.length,
    drafted: drafted.drafts.length,
    alreadyDrafted: drafted.alreadyDrafted.length,
    undraftable: drafted.undraftable.length,
    written: written.length,
  })
  return {
    ok: codes.length === 0,
    stage: 'deduplicate',
    advisory: true,
    scanned: drafted.scanned,
    duplicates: [...drafted.drafts, ...drafted.alreadyDrafted].map((draft) => draft.duplicate),
    drafts: drafted.drafts.map((draft) => ({
      id: draft.id,
      title: draft.title,
      path: draft.path,
      text: draft.written === null ? draft.text : undefined,
      status: draft.status,
      removes: draft.removes,
      withdraws: draft.withdraws,
      keeps: draft.keeps,
      written: draft.written,
      duplicate: draft.duplicate.code,
    })),
    alreadyDrafted: drafted.alreadyDrafted.map((draft) => ({
      id: draft.id,
      title: draft.title,
      path: draft.path,
      status: draft.status,
      duplicate: draft.duplicate.code,
    })),
    undraftable: drafted.undraftable,
    written,
    problems,
    summary: summariseProblems(problems),
    nextStep:
      drafted.drafts.length === 0 && drafted.alreadyDrafted.length === 0 && drafted.undraftable.length === 0
        ? 'the corpus holds no decidable duplicate: the deterministic rules examined it and found nothing to settle'
        : drafted.drafts.length === 0 && drafted.alreadyDrafted.length === 0
          ? 'every duplicate found needs a human-authored record rather than a draft; each reason is under "undraftable"'
          : drafted.alreadyDrafted.length > 0
            ? `${drafted.alreadyDrafted.length} duplicate${drafted.alreadyDrafted.length === 1 ? '' : 's'} already ha${drafted.alreadyDrafted.length === 1 ? 's' : 've'} a drafted resolution on disk, which this run did not touch: ratify or decline ${drafted.alreadyDrafted.length === 1 ? 'it' : 'them'}, and deleting a draft is how it is declined`
            : `ratify the drafted resolution${drafted.drafts.length === 1 ? '' : 's'} to settle ${drafted.drafts.length === 1 ? 'the duplicate' : 'the duplicates'}: nothing is in force until a human consents, and deleting a draft is how it is declined`,
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
 * Checks that a supplied quiz is the question this ratchet asked, and why if not.
 *
 * Compares what makes a consent answerable: which records are being asked about, the two labels
 * each question offered, and that every one of them was FROZEN with a content hash — the hash is
 * what lets the stale-text check refuse a record edited while the question was open. The hash
 * VALUES are deliberately not compared: a record changed while the question was open must still
 * reach `RATIFICATION_STALE`, which is a statement about the tabulated answer, not a foreign quiz.
 * Prose, headers and option descriptions are ignored, because a client or the harness may
 * reformat them without changing the question, and a question's identity is not its wording.
 *
 * @param supplied - The quiz a caller handed to `ratify`.
 * @param expected - The quiz {@link buildQuiz} produces for the records waiting now.
 * @returns `null` when the supplied quiz is acceptable, or a reason string.
 */
function quizRejection(supplied, expected) {
  if (supplied === null || typeof supplied !== 'object') return 'the supplied quiz is not an object'
  if ((supplied.attempt ?? null) !== (expected?.attempt ?? null)) {
    return `the supplied quiz is attempt ${JSON.stringify(supplied.attempt ?? null)} and this answer is attempt ${JSON.stringify(expected?.attempt)}`
  }
  const roles = (quiz) => Object.values(quiz?.roles ?? {})
  const targets = (quiz) => roles(quiz).map((role) => role?.adrId ?? null).sort()
  if (JSON.stringify(targets(supplied)) !== JSON.stringify(targets(expected))) {
    return 'the supplied quiz asks about different records than the ones now waiting'
  }
  const labels = (quiz) =>
    roles(quiz)
      .map((role) => [role?.adrId ?? null, role?.approveLabel ?? null, role?.rejectLabel ?? null])
      .sort()
  if (JSON.stringify(labels(supplied)) !== JSON.stringify(labels(expected))) {
    return 'the supplied quiz offers labels this ratchet did not'
  }
  const frozen = new Map((supplied.frozen ?? []).map((entry) => [entry?.id, entry]))
  for (const id of targets(expected)) {
    const entry = frozen.get(id)
    if (entry === undefined || typeof entry.contentHash !== 'string' || entry.contentHash.length === 0) {
      return `the supplied quiz froze no content hash for ADR ${id}, so there is no text its answer could cover`
    }
  }
  return null
}

/**
 * The generated-document digests this project has itself written, from its ledger.
 *
 * A generated law card's own bytes cannot say whether a person has since edited it:
 * a card left carrying an older law set's hash and a card somebody annotated and left
 * carrying the older hash are the same shape. The ledger can say, because a document
 * the ratchet wrote is one whose digest it recorded, and any other byte sequence in
 * that path was written by something else. That is what makes the automatic
 * regeneration below safe: it rewrites only documents the ratchet produced, and
 * leaves anything else exactly where a reader can see it.
 *
 * @param root - Absolute project root.
 * @returns A `Set` of `sha256:<64 hex>` document digests, empty when nothing was recorded.
 */
function writtenSpecDigests(root) {
  const known = new Set()
  for (const event of readLedger(root).events ?? []) {
    if (typeof event?.specDigest === 'string') known.add(event.specDigest)
    for (const digest of Array.isArray(event?.specDigests) ? event.specDigests : []) {
      if (typeof digest === 'string') known.add(digest)
    }
  }
  return known
}

/**
 * Regenerates the generated spec documents from a compile that has just run.
 *
 * A ratification changes the law set, and the generated law cards are written from
 * that law set. Until this existed, the sequence was: ratify, then somebody who
 * KNEW the rule ran `ratchet compile --write`, then `ratchet verify` — and a
 * developer who did not know it ran verify, which failed with `SPEC_OUT_OF_DATE`
 * on a tree that was otherwise correct. The rule was folklore: nothing in the tool
 * output named it, and the failure looked like a defect rather than a missed step.
 *
 * The write is therefore the ratifying operation's own last step, which is what
 * makes the rule unnecessary to know. It costs one render and one byte comparison
 * at the one moment the law set changed, and writes nothing when nothing drifted.
 *
 * The drift CHECK is deliberately not weakened, which is why the write is guarded by
 * {@link writtenSpecDigests} rather than by a drift verdict alone. A card the ratchet
 * wrote is regenerated from the new law set; a card whose current bytes the ledger
 * never recorded was written by somebody else, and is left untouched so that `verify`
 * keeps reporting `SPEC_HASH_MISMATCH` against it. Without that guard the automatic
 * write would erase the very edit the drift check exists to surface — a person's
 * annotation made into a law card that looks machine-generated.
 *
 * A write that fails is returned as a problem rather than thrown: an EPERM here is
 * an ordinary outcome, and letting it escape would turn a recorded consent into an
 * exception at the caller after the approval ADR is already on disk.
 *
 * The regeneration is bounded by the same work budget the rest of the operation carries, and
 * it reads each card through `workBudgetRead`, so a card that is not a regular file is refused
 * rather than opened: a `readFileSync` on a FIFO would hang the consent click.
 *
 * @param root - Absolute project root.
 * @param compiled - The compile result for the law set now in force; its `bundle`
 *   is the source of the documents. A compile with no bundle (`bundle: null`)
 *   writes nothing, because there are no laws to render.
 * @param budget - A work-budget tracker (see `createWorkBudget`), or `null`/`undefined` for
 *   an unbounded read of regular files.
 * @returns `{ written, paths, skipped, problems }`. `written` lists the paths this
 *   call actually rewrote, `paths` every document the bundle renders, `skipped` the
 *   documents left alone because the ledger does not attribute their bytes to the
 *   ratchet, and `problems` is empty on success and carries one
 *   `ARTIFACT_WRITE_FAILED` when the write failed.
 */
function regenerateSpecs(root, compiled, budget = null) {
  if (compiled?.bundle === null || compiled?.bundle === undefined) {
    return { written: [], paths: [], skipped: [], problems: [] }
  }
  const manifest = readManifest(root, budget)
  const rendered = renderSpecs(compiled.bundle, manifest.config?.specsDir)
  const drift = detectSpecDrift(root, rendered.files, manifest.config?.specsDir ?? null, budget)
  const ours = writtenSpecDigests(root)
  const stale = new Set([...(drift.missing ?? []), ...(drift.stale ?? []).map((entry) => entry.path)])
  const toWrite = {}
  const skipped = []
  for (const [path, text] of Object.entries(rendered.files)) {
    if (!stale.has(path)) continue
    const absolute = join(root, path)
    if (existsSync(absolute)) {
      const read = workBudgetRead(budget, root, path)
      const current = read.text === undefined ? null : hashSource(read.text)
      if (current === null || !ours.has(current)) {
        skipped.push(path)
        continue
      }
    }
    toWrite[path] = text
  }
  if (Object.keys(toWrite).length === 0) {
    return { written: [], paths: Object.keys(rendered.files), skipped, problems: [] }
  }
  try {
    // `writeSpecDocuments` writes the documents and records the digest of each in the
    // ledger, under this operation's own event name, so the NEXT law set can tell these
    // bytes apart from a person's.
    const result = writeSpecDocuments(root, toWrite, { event: 'ratchet.ratify.specs-regenerated', fields: { skipped } })
    return { written: result.written, paths: Object.keys(rendered.files), skipped, problems: [] }
  } catch (error) {
    return {
      written: [],
      paths: Object.keys(rendered.files),
      skipped,
      problems: [
        problem(
          'ARTIFACT_WRITE_FAILED',
          `the ratification was recorded, but the generated spec documents could not be brought in step with the new law set (${String(error)}): the documents on disk describe the previous laws, and \`ratchet compile --write\` is the command that writes them`,
          null,
          { wrote: false, paths: Object.keys(toWrite) },
        ),
      ],
    }
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
 *   present, channel }`.
 *   `answer` is the harness answer object (`{ answers: [{ id, selected, custom? }] }`)
 *   or `null` to prepare the quiz. **`quiz` is required to mint and must be the question this
 *   ratchet builds** for the records now waiting: it is the exact quiz the human answered, and
 *   requiring it to match is what lets this function bind each consent to the text that was SHOWN
 *   and refuse an answer that answers no question. A quiz whose frozen hashes, labels or targets
 *   differ from the rebuilt one is refused as `RATIFICATION_UNPROVEN`. An `answer` without a `quiz`
 *   is refused too, because nothing then distinguishes a human's answer from a string a caller
 *   typed. `attempt` is 1 for the first question and 2 for the one re-ask, which asks differently
 *   and carries `previous`.
 *   `ids` narrows the quiz to named decisions; ids that are not pending are reported
 *   rather than ignored. `askedBy` names who asked the human, and is recorded in the
 *   approval. `present` is forwarded to `buildQuiz` and decides whether the question
 *   asks to be rendered by the ADR panel (`'panel'`, the default) or by the harness's
 *   own card (`'chat'`); it reaches the re-ask too, because a re-ask shown somewhere
 *   other than the question it repeats is a question the human has to find twice.
 *   `channel` is the surface that CARRIED the answer and is recorded in the approval and
 *   its transcript: `user-question` (the default) for a question the harness delivered,
 *   `adr-panel` for one the ADR panel's decision window rendered. It is provenance only —
 *   the quiz pairing, the derivation and the hash binding are the same on both.
 *   `comment` is the human's own reason for a DECLINE: a sentence they typed, carried by
 *   the surface that showed the question. It is recorded — trimmed and bounded — beside
 *   the refusal in the append-only ledger and returned with the result, and it is the one
 *   place a "no" says why, so a later proposal can be drafted against it. An approval has
 *   no such commentary: a reason sent with one is not recorded, because nothing about a
 *   yes needs explaining. A comment is never read as an answer: the label and the quiz
 *   decide that, and this parameter cannot make a refusal into a consent.
 *   `budget` is a work-budget tracker (see `createWorkBudget`), or `null` for the CLI. This is
 *   the CONSENT path — the panel's click reaches it — so the in-process callers supply one and
 *   a corpus too large to read fails closed instead of blocking the event loop through the
 *   queue, the compile that follows and the regeneration of the invalidated law cards.
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
  channel = RATIFY_CHANNEL,
  comment = null,
  budget = null,
} = {}) {
  const queue = ratificationQueue(root, budget)
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
  // A blocked id names why it is blocked, not merely that it is not waiting: the queue's reason
  // carries the resolution that lifts the block, and a refusal that did not repeat it would send
  // the caller to `pending` to rediscover what this call already knew.
  const blockedById = new Map((queue.blocked ?? []).map((entry) => [entry.id, entry]))
  const unknownProblems = unknown.map((id) => {
    const blockedEntry = blockedById.get(id)
    if (blockedEntry !== undefined) {
      return problem(
        'ADR_FIELD_INVALID',
        `ratification was asked for ADR ${id}, which is blocked and cannot be ratified: ${blockedEntry.reason}`,
        id,
        { id, blocked: true },
      )
    }
    return problem(
      'ADR_FIELD_INVALID',
      `ratification was asked for ADR ${id}, which is not waiting for a human: it is either already in force, or not a decision this project declares. Ask ratchet_ratify with no ids to see the queue`,
      id,
      { id },
    )
  })

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

  const expectedQuiz =
    attempt === 2 ? buildQuiz(targets, { attempt: 2, previous, present }) : buildQuiz(targets, { attempt: 1, present })

  // The quiz a caller hands back must BE the question this ratchet asks for the records waiting
  // now. `ratify` used to accept any object with a `roles` map, and a `frozen` entry whose
  // `contentHash` was null skipped the stale-text check entirely — so a caller-composed quiz with
  // an empty frozen list minted a real approval with no question ever asked. Rebuilding the quiz
  // and requiring the supplied one to match binds the consent to the ratchet's own question: its
  // targets, the two labels it offered, and a frozen hash for every one of them. What remains is
  // the gap the consent model already states plainly — a caller who writes that exact question by
  // hand is writing a consent file — but a question the ratchet never built mints nothing.
  const quizRejected = answeredQuiz === null || answeredQuiz === undefined ? null : quizRejection(answeredQuiz, expectedQuiz)
  if (quizRejected !== null) {
    const problems = [
      ...unknownProblems,
      problem(
        'RATIFICATION_UNPROVEN',
        `the quiz supplied with this answer is not the question this ratchet asks for the records now waiting (${quizRejected}), so the answer is about a question nobody asked and nothing is ratified`,
        null,
        {},
      ),
    ]
    appendLedger(root, 'ratchet.ratify.foreign-quiz', { pending: targets.length })
    return {
      ok: false,
      stage: 'ratify',
      project: config.project,
      needsAnswer: true,
      attempt,
      pending: targets.map((entry) => ({ id: entry.id, title: entry.title, path: entry.path, contentHash: entry.contentHash })),
      quiz: expectedQuiz,
      problems,
      summary: summariseProblems(problems),
      nextStep:
        'ask the human the question this ratchet builds (the `quiz` field) and pass their answer back with that same object',
    }
  }

  const quiz = answeredQuiz ?? expectedQuiz

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
    // The human's reason for a decline is part of the record, not a throwaway: it is the
    // one place a "no" says WHY, and it is what a later proposal is drafted against. It
    // is written to the append-only ledger with the decision it refused, trimmed and
    // bounded, and returned so the surface that carried it can show it back.
    const declineComment = typeof comment === 'string' && comment.trim().length > 0 ? comment.trim().slice(0, 2000) : null
    appendLedger(root, 'ratchet.ratify.no-consent', {
      attempt,
      // `derived.rejected` is already the record ids (the reader derives them from the
      // answer), so this is the list itself. It was mapped through `entry.id`, which read a
      // property off a string and wrote `[null]` — a refusal recorded against nothing, and
      // therefore invisible to every later reader that looked the id up.
      rejected: derived.rejected,
      unreadable: derived.unreadable.length,
      comment: declineComment,
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
      comment: declineComment,
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
    channel,
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
    channel,
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
  const after = compileProject(root, { budget })
  // ...and the generated law cards are regenerated from that same bundle, in the same
  // operation. See `regenerateSpecs` for why this is not left to the caller.
  const specs = regenerateSpecs(root, after, budget)
  appendLedger(root, 'ratchet.ratify.mint', {
    approval: approvalId,
    ratified: approvedEntries.map((entry) => entry.id),
    rejections: derived.rejected.length,
    unreadable: derived.unreadable.length,
    laws: after.report.counts.laws,
    inForce: after.report.counts.active,
    wrote: written.written.length,
    specsRegenerated: specs.written.length,
  })

  const problems = [...unknownProblems, ...unreadableProblems, ...changedProblems, ...after.problems, ...specs.problems]
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
    specFiles: specs.paths,
    specsRegenerated: specs.written,
    specsSkipped: specs.skipped,
    problems,
    summary: summariseProblems(problems),
    nextStep:
      reask === null
        ? `run ratchet verify: the ratified decisions are law now, so the code has to be checked against the law set they changed${specs.written.length === 0 ? '' : ` (the ${specs.written.length} generated spec document${specs.written.length === 1 ? '' : 's'} the new laws changed were regenerated here)`}`
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
 * @param options - `{ root, ids, askedBy, at, write, present, askHuman, budget }`. `askHuman` is
 *   `(quiz) => Promise<{ kind: 'ok', answer } | { kind: 'unavailable', reason }>`
 *   or `null`, in which case the quiz is prepared and returned unanswered. `present`
 *   is forwarded to `ratify` for both the first question and the re-ask, so the whole
 *   sequence is shown in the one place the caller chose. `budget` is forwarded to every
 *   `ratify` call so the in-process consent path stays bounded across the whole sequence.
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
  budget = null,
} = {}) {
  const prepared = ratify({ root, ids, askedBy, at, write, present, budget })
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

  let result = ratify({ root, answer: first.answer, quiz: prepared.quiz, ids, askedBy, at, write, present, budget })
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
        budget,
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
export function submitReview({ root, job, verdict, record = true, change = null, proposal = null, source = null } = {}) {
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
    specHash: context.bundle === null ? null : bundleHash(context.bundle),
  })

  if (record) {
    state.writeArtifact(root, STATE_PATHS.dynamicReport, `${JSON.stringify(report, null, 2)}\n`)
    appendLedger(root, 'ratchet.review.submitted', {
      job: report.job,
      advisory: true,
      verdictOk: report.verdictOk,
      findings: report.findings.length,
    })
    // A self-review of the corpus persists its findings too, so the degraded path is not a
    // second-class one: a duplicate or a retirement it names must reach a human exactly as an
    // independent judge's would.
    if (CORPUS_FINDING_JOBS.has(report.job)) {
      state.recordAdvisoryFindings(root, {
        job: report.job,
        specHash: context.bundle === null ? null : bundleHash(context.bundle),
        findings: report.findings,
        at: report.generatedAt,
      })
    }
  }

  // A self-review may RAISE a block — an honest self-assessment that the change contradicts a
  // decision should stop the work — but it may never CLEAR one. Clearing takes an independent
  // judge or an edit to the record the finding is bound to, because otherwise an agent could lift
  // its own block by submitting the verdict it wrote itself.
  const blocking = contradictionModule.blockingFindings(validation.findings)
  // A block has to be bound to something whose change can retire it. A self-review that names
  // neither a proposal nor the material it judged still DECLINES — the finding is reported — but it
  // records nothing, because a block on unnamed material is a block nobody can clear.
  const judgedSomething = proposal !== null || change !== null || source !== null
  if (record && blocking.length > 0) {
    const target = contradictionModule.contradictionTarget({ job: report.job, proposal, change, source, records: context.records })
    // `replace: false`: an existing entry stands. A self-review that OVERWRITES an independent
    // finding lifts the zone that finding blocked — a deterministic bypass by the agent the gate
    // gates, which is the one thing this path is documented never to allow.
    contradictionModule.recordContradiction(root, { target, findings: blocking, job: report.job, replace: false })
  }

  return {
    ok: blocking.length === 0 && validation.ok && validation.problems.length === 0,
    stage: 'review',
    job: report.job,
    // A self-review that reports a contradiction is a GATE, not advice — the same as an
    // independent one. Its `advisory` flag says so, and it carries the same route out.
    advisory: blocking.length === 0,
    gate: blocking.length > 0,
    declined: blocking.length > 0,
    ...(blocking.length === 0
      ? {}
      : {
          blocking: { findings: blocking },
          nextStep:
            'change the change so it stops contradicting the law in force, then review it again: an independent clean verdict retires this block, and it also retires when the contradicted record is edited, ratified or withdrawn. A human can decide the question instead — do not edit .dsh/ratchet/contradiction.json, which is machine-written state',
        }),
    selfReview: true,
    judge: report.judge,
    findings: validation.findings,
    insufficientReasoning: validation.insufficientReasoning,
    report: STATE_PATHS.dynamicReport,
    problems: validation.problems,
    summary: summariseProblems(validation.problems),
  }
}
