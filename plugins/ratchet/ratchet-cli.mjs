/**
 * PURPOSE
 *   Give the ratchet an enforcement point a shell can use: a command that exits
 *   non-zero when the project violates its decisions.
 *
 *   Until this existed, the gate was a tool return value. A tool return value is
 *   read by the agent that called it and then scrolls away; nothing else in the
 *   repository could fail because of it, and no script could refuse to proceed.
 *   "A rule is real only where something fails when it is broken" was therefore
 *   unsatisfied for every rule the ratchet claimed — including "no decision
 *   without reasoning" and "a task is not complete unless ratchet_verify reports
 *   success". This command is the missing failure.
 *
 *   It calls the same `ratchet-ops.mjs` functions the model-facing tools call, so
 *   the gate a human runs in CI and the gate an agent runs mid-task cannot
 *   disagree about what "verified" means.
 *
 * INPUTS
 *   `ratchet <command> [options]`
 *     status                 report state; exit 0 only when verified and clean
 *     compile [--write]      compile ADRs into laws; --write emits spec documents
 *     verify                 verify the code against the laws; the primary gate
 *     bootstrap [--apply]    preview (default) or create the manifest and skeleton
 *     hash <file>            print the sha256:<hex> a source file hashes to
 *     check                  `verify` with machine-readable output for CI
 *     falsify                break one generic invariant at a time and require the
 *                            gate to fail (project-agnostic; mutates and restores)
 *   Options: `--root <dir>` (default: search upward from the working directory),
 *   `--json` (machine-readable result on stdout), `--quiet` (problems only).
 *   Exit codes: 0 ok, 1 the ratchet ran and reported problems, 2 the project or
 *   its decisions are unusable so nothing was checked, 3 a usage error.
 *
 * OUTPUTS
 *   Human-readable report on stdout by default; one JSON object with `--json`.
 *   Exit codes as above. Nothing is written to the project except through the
 *   operations themselves (reports, spec bundle, ledger, and — only with --write
 *   or --apply — generated specs or bootstrap files).
 *
 * KEYWORDS
 *   ratchet, gate, exit code, ci, enforcement, cli, verify, compile
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Unknown command or option: usage on stderr, exit 3. A typo must not be read
 *     as "nothing to do" and exit 0, which is how a disabled check goes unnoticed.
 *   - `--root` names a directory with no manifest: reported as MANIFEST_MISSING and
 *     exit 2, never as success.
 *   - The ratchet is enabled but has no ADRs: NO_VALID_ADRS, exit 2. An empty
 *     corpus is not a passing project.
 *   - `hash` on a missing file: message on stderr, exit 2.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { UNUSABLE_PROBLEM_CODES, hashSource } from './ratchet-schema.mjs'
import { writeArtifact } from './ratchet-state.mjs'
import { REVIEW_JOBS } from './ratchet-dynamic.mjs'
import { falsify, recover } from './ratchet-falsify.mjs'
import { zoneReport } from './ratchet-zones.mjs'
import { resolvePlan } from './ratchet-resolve.mjs'
import {
  EXIT,
  bootstrap,
  compile,
  createCommandRunner,
  deduplicate,
  exitCodeFor,
  exitCodeForReview,
  findRoot,
  ingest,
  ratifications,
  review,
  status,
  verify,
} from './ratchet-ops.mjs'

/** Usage text, kept next to the parser so the two cannot drift. */
const USAGE = `ratchet — verify this project against its own architecture decisions

Usage: ratchet <command> [options]

Commands:
  status              report ratchet state without changing anything
  compile [--write]   compile ADRs into laws; --write also emits spec documents
  verify              verify the code against the laws (the gate)
  check               verify with machine-readable output, for CI
  bootstrap [--apply] preview (default) or create the manifest and skeleton
  pending             list the decisions waiting for a human ratification
  review              build an advisory review prompt or grilling agenda
  ingest <source>     turn a raw source into a PROPOSED ADR (advisory)
  deduplicate [--write] draft a PROPOSED resolution for every decidable duplicate
  zones [--write]     report the authority table: undeclared zones, paths matching
                      nothing, laws outside their zones; --write drafts a declaration
  resolve <id>        print the steps that would unblock one record, and whether any
                      of them needs a human rather than an agent
  falsify             break one generic invariant at a time and require the gate to fail
  hash <file>         print the sha256 of a decision source file

Options:
  --root <dir>      project directory (default: search upward from the cwd)
  --job <name>      review job: ${Object.keys(REVIEW_JOBS).join(', ')}
  --change <file>   file whose contents are the proposed change
  --question <text> extra question for the review
  --no-commands     verify WITHOUT running command checks (they are reported pending,
                    and a run with pending checks is never a pass)
  --recover         with \`falsify\`: repair a stale journal from a hard-killed run and
                    exit without running any case (0 recovered or nothing to do, 2 unusable)
  --json            print one JSON object instead of a report
  --quiet           print only problems and the exit-relevant summary

Exit codes:
  0  the ratchet ran and reported no problems (and ALWAYS for review: see below)
  1  the ratchet ran and reported problems
  2  the project or its decisions are unusable, so nothing was checked
  3  usage error

\`falsify\` uses 0 when every applicable case was detected, 1 when any case was missed
or errored, and 2 when the project is unusable. With \`--recover\` it always exits 0
unless the project is unusable.

\`review\` always exits 0. Its answer comes from a model, so it is advisory by
construction: a non-deterministic check that can fail a build is one people learn
to re-run until it passes. The static gate is \`verify\`.
`

/**
 * Parses argv into a command, its positionals and its options.
 *
 * @param argv - Arguments after the executable and script.
 * @returns `{ command, positionals, options }`, or `{ error }` describing the
 *   first thing that could not be parsed.
 */
export function parseArgs(argv) {
  const commands = new Set(['status', 'compile', 'verify', 'check', 'bootstrap', 'pending', 'review', 'ingest', 'deduplicate', 'zones', 'resolve', 'falsify', 'hash', 'help'])
  const options = {
    root: null,
    json: false,
    quiet: false,
    write: false,
    apply: false,
    commands: true,
    recover: false,
    job: 'review_corpus',
    change: null,
    question: null,
  }
  const positionals = []
  let command = null
  let unknownCommand = null
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--help' || token === '-h') return { command: 'help', positionals, options }
    if (token === '--json') options.json = true
    else if (token === '--quiet') options.quiet = true
    else if (token === '--write') options.write = true
    else if (token === '--apply') options.apply = true
    else if (token === '--recover') options.recover = true
    else if (token === '--no-commands') options.commands = false
    else if (token === '--root' || token === '--job' || token === '--change' || token === '--question') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        return { error: `${token} needs a value` }
      }
      if (token === '--root') options.root = value
      else if (token === '--job') options.job = value
      else if (token === '--change') options.change = value
      else options.question = value
      index += 1
    } else if (token.startsWith('-')) {
      return { error: `unknown option ${JSON.stringify(token)}` }
    } else if (command === null && commands.has(token)) {
      command = token
    } else if (command === null) {
      // A first bare word that is not a command is a TYPO, not a positional. It
      // must be an error: defaulting to help and exiting 0 makes `ratchet verfy`
      // in a CI script look like a passing gate, which is the exact failure this
      // CLI exists to prevent.
      unknownCommand = token
    } else {
      positionals.push(token)
    }
  }
  if (unknownCommand !== null) {
    return { error: `unknown command ${JSON.stringify(unknownCommand)}`, positionals, options }
  }
  if (command === null) command = 'help'
  if (command === 'review' && REVIEW_JOBS[options.job] === undefined) {
    return { error: `unknown review job ${JSON.stringify(options.job)}; expected one of ${Object.keys(REVIEW_JOBS).join(', ')}` }
  }
  return { command, positionals, options }
}

/**
 * Resolves the root an operation should run against.
 *
 * @param options - Parsed options; `root` may be `null`.
 * @returns `{ root }` or `{ error }` when an explicit root does not exist.
 */
function resolveRoot(options) {
  if (options.root !== null) return { root: resolve(options.root) }
  return { root: findRoot(process.cwd()) ?? process.cwd() }
}

/**
 * Prints a human-readable problem list.
 *
 * @param result - Any operation result.
 * @param quiet - When true, prints the summary line only when there are problems.
 */
function printProblems(result, quiet) {
  const problems = result.problems ?? []
  if (problems.length === 0) {
    if (!quiet) process.stdout.write('  no problems\n')
    return
  }
  for (const entry of problems) {
    const subject = entry.subject === null || entry.subject === undefined ? '' : ` [${entry.subject}]`
    process.stdout.write(`  ${entry.code}${subject}\n    ${entry.message}\n`)
  }
}

/**
 * Runs one invocation and returns the process exit code.
 *
 * Async because `review` is: it may await a judge. Every other command resolves
 * immediately, so making this async costs nothing and avoids two code paths that
 * would have to agree about the exit code.
 *
 * @param argv - Arguments after the executable and script.
 * @returns A promise for the exit code; the caller assigns it to `process.exitCode`.
 */
export async function run(argv) {
  const parsed = parseArgs(argv)
  if (parsed.error !== undefined) {
    process.stderr.write(`ratchet: ${parsed.error}\n\n${USAGE}`)
    return 3
  }
  const { command, positionals, options } = parsed

  if (command === 'help') {
    process.stdout.write(USAGE)
    return 0
  }

  if (command === 'hash') {
    const target = positionals[0]
    if (target === undefined) {
      process.stderr.write('ratchet: hash needs a file path\n')
      return 3
    }
    try {
      // The hash is taken over the same normalised text the ADR verifier hashes,
      // so the value printed here is the value that will match.
      process.stdout.write(`${hashSource(readFileSync(resolve(target), 'utf8'))}\n`)
      return 0
    } catch (error) {
      process.stderr.write(`ratchet: cannot hash ${target}: ${String(error)}\n`)
      return EXIT.CONFIG
    }
  }

  const resolvedRoot = resolveRoot(options)
  if (resolvedRoot.error !== undefined) {
    process.stderr.write(`ratchet: ${resolvedRoot.error}\n`)
    return EXIT.CONFIG
  }
  const root = resolvedRoot.root

  // `command` checks run only when the caller asks for them, and the CLI is the
  // caller that does: a CI script wants the laws whose invariant is a test run. The
  // tool surface deliberately does not, so an agent editing files cannot cause
  // processes to start.
  const runCommand = options.commands === true ? createCommandRunner({ root }) : null

  let result
  if (command === 'status') result = status(root)
  else if (command === 'compile') result = compile({ root, write: options.write })
  else if (command === 'verify' || command === 'check') result = await verify({ root, runCommand })
  else if (command === 'bootstrap') {
    result = bootstrap({ root, mode: options.apply ? 'apply' : 'preview' })
  } else if (command === 'pending') {
    // Read-only, and deliberately the ONLY ratification-shaped command a shell
    // gets. A shell cannot ask a human anything: it has no question channel, and a
    // prompt it could print is a prompt an agent could answer. Minting a consent
    // therefore belongs to a session, and this command exists to say what is
    // waiting for one.
    result = ratifications(root)
  } else if (command === 'review') {
    // The CLI never spawns a judge: a shell has no agent to parent it with, and
    // the runtime refuses `start` without one. So the CLI always takes the
    // degraded path and prints the prompt, which is the useful thing a script can
    // have. `ratchet_review` is the tool that spawns.
    let change = null
    if (options.change !== null) {
      try {
        change = readFileSync(resolve(options.change), 'utf8')
      } catch (error) {
        process.stderr.write(`ratchet: cannot read --change ${options.change}: ${String(error)}\n`)
        return EXIT.CONFIG
      }
    }
    result = await review({
      root,
      job: options.job,
      change,
      question: options.question,
      spawnJudge: null,
      record: false,
    })
  } else if (command === 'ingest') {
    // Same split as review: the CLI prepares, the tool spawns. What it can do that
    // a bare prompt cannot is the part that needs no model — reading the source,
    // hashing it, and choosing the next free id.
    const sourcePath = positionals[0] ?? options.change
    if (sourcePath === undefined || sourcePath === null) {
      process.stderr.write('ratchet: ingest needs the path of a source file, e.g. `ratchet ingest docs/ratchet/sources/x.md`\n')
      return 3
    }
    result = await ingest({
      root,
      sourcePath: sourcePath.split('\\').join('/'),
      spawnJudge: null,
      write: options.write,
    })
  } else if (command === 'zones') {
    result = zoneReport(root, { write: options.write })
  } else if (command === 'resolve') {
    const id = positionals[0]
    result = id === undefined
      ? { ok: false, id: null, steps: [], humanRequired: false, reason: 'resolve needs a record id: ratchet resolve <id>' }
      : resolvePlan(root, id)
  } else if (command === 'deduplicate') {
    // The drafting half of duplicate detection, and the same split as ingest: it needs no
    // model, so a shell can do all of it. `--write` places the drafts; without it the text
    // is printed, which is how a reviewer reads a settlement before it exists as a file.
    result = deduplicate({ root, write: options.write })
  } else if (command === 'falsify') {
    // The breaker: it mutates the project, runs the real verifier, and restores every
    // mutation. It is deterministic and needs no model — the counterexample is the
    // output, not a verdict. `handleSignals` is set because the CLI owns this process:
    // a SIGTERM must restore the mutation in flight before exiting. `--recover` repairs a
    // hard-killed run's journal and runs no case.
    result = options.recover === true ? recover({ root }) : await falsify({ root, runCommand, handleSignals: true })
    // Then the run is RECORDED, after the restore. The breaker restores the project
    // byte-identically — the ledger included, because the journal backs up the ratchet's
    // own record directories — so a run whose whole purpose is to prove the gate can fail
    // was the one gate command with no durable evidence: "the ledger is the audit trail"
    // did not cover it. Writing the summary here leaves the code tree untouched (nothing
    // restores anything afterwards) and gives the release gate a record that survives the
    // terminal.
    try {
      writeArtifact(
        root,
        'reports/ratchet/falsify-report.json',
        `${JSON.stringify({ kind: 'ratchet/falsify-report', at: new Date().toISOString(), ...result }, null, 2)}\n`,
      )
    } catch (error) {
      process.stderr.write(`ratchet: could not write the falsify report: ${String(error)}\n`)
    }
  } else {
    process.stderr.write(`ratchet: unknown command ${JSON.stringify(command)}\n\n${USAGE}`)
    return 3
  }

  if (options.json || command === 'check') {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    // The word after the command describes what actually happened, not whether a
    // problem list is empty. "PROBLEMS" over a run that never started is true and
    // useless; a reader needs to know nothing was checked.
    const state =
      command === 'review' || command === 'ingest'
        ? result.degraded === true
          ? 'NOT RUN'
          : result.code === 'INSUFFICIENT_REASONING' || result.code === 'ALREADY_RECORDED'
            ? result.code
            : 'ADVISORY'
        : command === 'deduplicate'
          ? // Advisory, and it says what it did rather than whether a problem list is empty:
            // a corpus with no duplicate and a corpus it could not settle are both "no
            // problems" and need opposite next actions.
            result.unusable === true
              ? 'UNUSABLE'
              : result.drafts.length === 0 && result.undraftable.length === 0 && (result.alreadyDrafted ?? []).length === 0
                ? 'CLEAN'
                : 'DRAFTED'
          : result.ok
            ? 'OK'
            : 'PROBLEMS'
    process.stdout.write(`ratchet ${command}: ${state} (${root})\n`)
    // How much was actually evaluated, printed BEFORE the problem list. A gate that
    // says "OK" without saying what it looked at is the same failure as a check that
    // cannot run: `verify --no-commands` evaluated 3 of 19 checks and printed
    // "no problems" while 15 laws went unexamined, and stdout never mentioned it.
    if (result.counts !== undefined && result.counts.checksDeclared !== undefined) {
      const counts = result.counts
      process.stdout.write(
        `  ${counts.laws} law(s), ${counts.checksDeclared} check(s) declared, ${counts.checksEvaluated} evaluated, ${counts.checksPending} pending\n`,
      )
    } else if (result.counts !== undefined && result.counts.laws !== undefined && command === 'compile') {
      const counts = result.counts
      process.stdout.write(
        `  ${counts.records} record(s): ${counts.active} active, ${counts.proposed} proposed, ${counts.excluded} excluded — ${counts.laws} law(s)\n`,
      )
    }
    printProblems(result, options.quiet)
    // A fact that is not a problem still has to be READ, which is why it is printed here
    // rather than left in the JSON. `compile` and `verify` both carry it: it says whether any
    // corpus review has recorded the law set now in force, which is the one thing the
    // deterministic checks cannot answer for themselves. Silence would be indistinguishable
    // from "reviewed and clean", which is the state this field exists to tell apart.
    if (result.contradictionReview !== null && result.contradictionReview !== undefined) {
      const review = result.contradictionReview
      process.stdout.write(
        review.stale === true
          ? `  contradiction detection: NOT RUN for these laws — ${review.reason}\n`
          : `  contradiction detection: ${review.at ?? '(no time recorded)'} read the law set now in force\n`,
      )
      // What the fact above was READ FROM. The ledger is append-only and an unparseable
      // line is counted rather than thrown, so "no review recorded" and "the line that
      // recorded it was unreadable" are different states that would otherwise print
      // identically. It is printed for a healthy ledger too (as 0): a line that appears
      // only when something is wrong is a line nobody knows to look for, and zero is what
      // makes "nothing was skipped" a measurement rather than an assumption.
      if (review.ledgerSkipped !== undefined || review.ledgerError !== undefined) {
        process.stdout.write(
          `  ledger: ${review.ledgerSkipped ?? 0} unreadable line(s) skipped` +
            `${review.ledgerError === null || review.ledgerError === undefined ? '' : ` — ${review.ledgerError}`}\n`,
        )
      }
    }
    if (result.summary !== undefined && result.summary.total > 0) {
      process.stdout.write(
        `  ${result.summary.total} problem(s): ${Object.entries(result.summary.byCode)
          .map(([code, count]) => `${code}×${count}`)
          .join(', ')}\n`,
      )
    }
    if (command === 'bootstrap' && result.mode === 'preview') {
      process.stdout.write(`  would create: ${result.wouldCreate.join(', ')}\n`)
      process.stdout.write(`  ${result.note}\n`)
    }
    if (command === 'bootstrap' && result.mode === 'apply') {
      process.stdout.write(`  created: ${(result.created ?? []).join(', ') || '(nothing)'}\n`)
      if ((result.skippedExisting ?? []).length > 0) {
        process.stdout.write(`  kept existing: ${result.skippedExisting.join(', ')}\n`)
      }
    }
    if (command === 'pending') {
      if (result.pending.length === 0) {
        process.stdout.write('  nothing is waiting for a human\n')
      }
      for (const entry of result.pending) {
        process.stdout.write(
          `  ADR ${entry.id}  ${entry.status}  ${entry.authority}  ${entry.zones.join(', ') || '(unzoned)'} (${entry.zonePolicies.join(', ')})\n`,
        )
        process.stdout.write(`    ${entry.title ?? '(no title)'} — ${entry.path}\n`)
        process.stdout.write(`    content hash: ${entry.contentHash}\n`)
        if (entry.laws.length > 0) {
          process.stdout.write(
            `    laws: ${entry.laws.map((law) => `${law.id}${law.checks === 0 ? ' (no check)' : ''}`).join(', ')}\n`,
          )
        }
      }
      for (const entry of result.blocked) {
        process.stdout.write(`  BLOCKED ADR ${entry.id}: ${entry.reason}\n`)
      }
      process.stdout.write(
        '  a shell cannot ask you anything, so this command cannot ratify: run the ratification in a session, where the ratchet puts the question to you and records your answer\n',
      )
    }
    if (command === 'resolve') {
      process.stdout.write(`  ADR ${result.id ?? '(none)'}: ${result.reason === null ? `${result.steps.length} step(s) to unblock it` : result.reason}\n`)
      for (const step of result.steps ?? []) {
        process.stdout.write(`  [${step.op}] ${step.detail ?? ''}\n`)
      }
      for (const entry of result.declined ?? []) {
        process.stdout.write(`  declined${entry.at === null ? '' : ` ${entry.at}`}${entry.comment === null ? ' (no reason given)' : `: ${entry.comment}`}\n`)
      }
      process.stdout.write(
        result.humanRequired === true
          ? '  at least one step needs a human: an agent cannot author a record or change a zone authority\n'
          : '  every step can be carried out by an agent; the consent that puts the record in force is still a human\u2019s\n',
      )
    }
    if (command === 'zones') {
      const summary = result.summary ?? {}
      process.stdout.write(
        `  declared: ${summary.declared ?? 0} zone(s), referenced: ${summary.referenced ?? 0}, ` +
          `undeclared: ${summary.undeclared ?? 0}, unused: ${summary.unused ?? 0}, laws outside their zones: ${summary.lawsOutside ?? 0}\n`,
      )
      process.stdout.write(
        summary.trackedPaths === null || summary.trackedPaths === undefined
          ? '  path check: NOT RUN — the project could not be walked, so a declared path that matches nothing was not looked for\n'
          : `  files walked: ${summary.trackedPaths}\n`,
      )
      for (const entry of result.undeclared ?? []) {
        process.stdout.write(`  undeclared zone "${entry.id}" — records ${entry.records.join(', ')}\n`)
        process.stdout.write(`    inferred paths: ${entry.inferredPaths.length === 0 ? '(none inferable from the laws)' : entry.inferredPaths.join(', ')}\n`)
      }
      for (const zone of result.declared ?? []) {
        for (const glob of zone.emptyPaths ?? []) {
          process.stdout.write(`  empty path in zone "${zone.id}": ${JSON.stringify(glob)} matches no tracked file\n`)
        }
      }
      for (const draft of result.drafts?.written ?? []) process.stdout.write(`  drafted ${draft}\n`)
      for (const draft of result.drafts?.skipped ?? []) process.stdout.write(`  kept existing draft ${draft}\n`)
      if (result.ok === true) process.stdout.write('  zones ok\n')
    }
    if (command === 'deduplicate') {
      if (result.scanned !== null && result.scanned !== undefined) {
        process.stdout.write(
          `  examined ${result.scanned.records} record(s), ${result.scanned.statements} law statement(s), ${result.scanned.sources} source hash(es)\n`,
        )
      }
      for (const draft of result.drafts) {
        process.stdout.write(`  draft ${draft.id}: ${draft.title}\n`)
        process.stdout.write(`    withdraws ${draft.removes} from ADR ${draft.withdraws}; ADR ${draft.keeps} keeps governing\n`)
        process.stdout.write(`    ${draft.written === null ? `not written (${draft.path}; pass --write)` : `written to ${draft.written}`}\n`)
      }
      for (const draft of result.alreadyDrafted ?? []) {
        process.stdout.write(`  already drafted ${draft.id}: ${draft.title}\n`)
        process.stdout.write(`    ${draft.path}; this run did not touch it — ratify or decline it\n`)
      }
      for (const entry of result.undraftable) {
        process.stdout.write(`  NOT DRAFTED [${entry.duplicate.code}]: ${entry.reason}\n`)
      }
      if (result.nextStep !== undefined) process.stdout.write(`  ${result.nextStep}\n`)
    }
    if (command === 'review' || command === 'ingest') {
      if (result.degraded === true) {
        // The CLI cannot spawn a judge, so it prints the prompt it would have sent.
        // Saying "no problems" here would be true and useless: nothing ran.
        process.stdout.write(`  NOT RUN — ${result.note}\n\n`)
        process.stdout.write(`${result.prompt}\n`)
      } else if ((result.missing ?? []).length > 0) {
        // A job whose material was never supplied. `findings: 0` over a question that
        // was never asked reads as a clean review, which is the one thing an advisory
        // must never be mistaken for.
        process.stdout.write(
          `  NOT RUN — this job needs ${result.missing.join(', ')}, which was not supplied, so the question was not asked\n`,
        )
        process.stdout.write(`  supply it with the matching flag, or run the job where the material exists\n`)
      } else if (command === 'ingest' && result.code === 'INSUFFICIENT_REASONING') {
        process.stdout.write(`  INSUFFICIENT_REASONING: ${result.reason}\n`)
        process.stdout.write(`  ${result.nextStep}\n`)
      } else if (command === 'ingest' && result.code === 'ALREADY_RECORDED') {
        process.stdout.write(`  ALREADY_RECORDED: ${result.reason}\n`)
        process.stdout.write(`  ${result.nextStep}\n`)
      } else if (command === 'ingest' && result.adr !== undefined && result.adr !== null) {
        process.stdout.write(`  proposed ${result.adr.id}: ${result.adr.title}\n`)
        process.stdout.write(`  file:   ${result.adr.path}\n`)
        process.stdout.write(`  zones:  ${result.adr.zones.join(', ') || '(none)'}\n`)
        process.stdout.write(`  laws:   ${result.adr.laws.join(', ') || '(none)'}\n`)
        process.stdout.write(`  ${result.written === null ? 'not written (pass --write)' : `written to ${result.written}`}\n`)
      } else if (command === 'ingest') {
        // An ingestion that produced no record — a missing manifest, an unreadable
        // source, a judge that answered nothing usable. Reading `result.adr` here
        // threw a TypeError, so the CLI died with a stack trace instead of printing
        // the reason it had just computed.
        process.stdout.write(`  no record was proposed\n`)
        for (const entry of result.problems ?? []) {
          process.stdout.write(`  ${entry.code}: ${entry.message}\n`)
        }
        if (result.nextStep !== undefined) process.stdout.write(`  ${result.nextStep}\n`)
        if (result.reason !== undefined) process.stdout.write(`  ${result.reason}\n`)
      } else {
        if (result.kind === 'agenda') {
          process.stdout.write(`  agenda: ${(result.agenda?.questions ?? []).length} question(s) for a human\n`)
          for (const question of result.agenda?.questions ?? []) {
            process.stdout.write(`  ? ${question.question}\n`)
            if (question.recommendation !== null) {
              process.stdout.write(`    recommended: ${question.recommendation}\n`)
            }
          }
        } else {
          process.stdout.write(`  findings: ${(result.findings ?? []).length}\n`)
          for (const finding of result.findings ?? []) {
            process.stdout.write(`  [${finding.severity}] ${finding.kind}: ${finding.explanation}\n`)
          }
        }
      }
      process.stdout.write('  advisory: this never changes the exit code; `verify` is the gate\n')
    }
    if (command === 'falsify') {
      if (result.unusable === true) {
        process.stdout.write('  NOT RUN — the project is unusable, so no case was attempted\n')
        for (const entry of result.problems ?? []) process.stdout.write(`  ${entry.code}: ${entry.message}\n`)
      } else if (options.recover === true) {
        if (result.recovered.length === 0) process.stdout.write('  nothing to recover\n')
        else {
          for (const relativePath of result.recovered) process.stdout.write(`  restored ${relativePath}\n`)
          process.stdout.write(`  recovered ${result.recovered.length} path(s) from a stale journal\n`)
        }
        for (const warning of result.warnings ?? []) process.stdout.write(`  warning: ${warning}\n`)
      } else {
        for (const entry of result.recovered ?? []) {
          process.stdout.write(`  recovered ${entry} from a previous killed run\n`)
        }
        for (const warning of result.warnings ?? []) process.stdout.write(`  warning: ${warning}\n`)
        for (const entry of result.cases) {
          process.stdout.write(
            `  [${entry.status}] ${entry.id}${entry.target === null || entry.target === undefined ? '' : ` -> ${entry.target}`}\n`,
          )
          if (entry.detail !== null && entry.detail !== undefined) process.stdout.write(`         ${entry.detail}\n`)
          if (entry.observedCodes.length > 0) {
            process.stdout.write(`         observed: ${entry.observedCodes.join(', ')}\n`)
          }
        }
        process.stdout.write(
          `  ${result.counts.detected} detected, ${result.counts.missed} missed, ${result.counts.skipped} skipped, ` +
            `${result.counts['out-of-scope']} out-of-scope, ${result.counts.error} error\n`,
        )
      }
    }
    if (result.reports !== undefined && result.ok) {
      // Only the artifacts that are actually there. This line used to name every path the
      // operation could write — including `verify-report.json` after it had been deleted —
      // so a reader was pointed at evidence that did not exist while the output said OK.
      const present = Object.values(result.reports).filter((path) => existsSync(join(root, path)))
      const missing = Object.values(result.reports).filter((path) => !existsSync(join(root, path)))
      process.stdout.write(`  evidence: ${present.length > 0 ? present.join(', ') : '(none written yet)'}\n`)
      if (missing.length > 0) process.stdout.write(`  not written: ${missing.join(', ')}\n`)
    }
  }

  // A review and an ingestion are advisory by construction, so they exit 0 whatever
  // the judge said — and 0 when no judge ran at all, because "you must answer this
  // prompt yourself" is a successful outcome for a command whose job is to prepare
  // the question. Only `verify` gates.
  //
  // One exception, and it is the opposite of advisory: a project the ratchet cannot
  // READ has produced no answer at all, and the exit table calls that 2. Reporting 0
  // for it told a script that a project with no manifest had been ingested cleanly.
  if (command === 'review' || command === 'ingest') {
    const unusable = (result.problems ?? []).some((entry) => UNUSABLE_PROBLEM_CODES.includes(entry.code))
    return unusable ? EXIT.CONFIG : exitCodeForReview()
  }
  // Falsify has its own three-way contract: every applicable case detected is a pass,
  // any missed (or errored) case is a failure, and a project that cannot be falsified
  // at all is a configuration error rather than a red gate.
  if (command === 'falsify') {
    if (result.unusable === true) return EXIT.CONFIG
    // `--recover` only repairs; recovered-or-nothing is a success by definition.
    if (options.recover === true) return EXIT.OK
    return result.ok === true ? EXIT.OK : EXIT.PROBLEMS
  }
  // The zone report is a gate on the AUTHORITY TABLE, not on a record: an undeclared
  // zone referenced by records, or a declared path that matches nothing, is exit 1.
  // A project the ratchet cannot read at all stays exit 2.
  if (command === 'zones' || command === 'resolve') {
    if (result.unusable === true) return EXIT.CONFIG
    return result.ok === true ? EXIT.OK : EXIT.PROBLEMS
  }
  // Deduplication drafts proposals; it never gates. A corpus with a duplicate is the
  // deterministic command's red gate (`check-duplicate-decisions`), not this one's, so the
  // exit code here distinguishes only "the corpus could not be read" (2) from "the run
  // happened" (0). Making this command fail on a duplicate it had just drafted would mean
  // the drafter's own output turned the command red.
  if (command === 'deduplicate') {
    if (result.unusable === true) return EXIT.CONFIG
    return EXIT.OK
  }
  return exitCodeFor(result)
}

// Entry point when executed directly rather than imported.
//
// `import.meta.main` is the clean spelling, but it only exists from Node 24.2 —
// and this kit's own floor is Node 24.0, so on an early 24.x it is `undefined`
// rather than an error, and a CLI gated on it alone would print nothing and exit
// 0. The path comparison is therefore the load-bearing half, with the platform's
// own path parsing rather than a string suffix match so it behaves identically on
// Linux and Windows.
//
// Known limitation, stated rather than hidden: launching through a SYMLINK makes
// `argv[1]` the link and `import.meta.url` the target, so the comparison misses.
// Run the real path (`node <kit>/plugins/ratchet/ratchet-cli.mjs`) or import `run`.
const isDirectInvocation =
  import.meta.main === true ||
  (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))

if (isDirectInvocation) {
  process.exitCode = await run(process.argv.slice(2))
}
