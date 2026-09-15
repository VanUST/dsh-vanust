/**
 * PURPOSE
 *   Fail the gate when the decision corpus holds the same decision twice in a way a machine
 *   can decide, and stay silent about every other kind of duplication.
 *
 *   The compiler already sees one law id declared with two different statements
 *   (`LAW_CONFLICT`) and a law that left force with no decision behind it. It cannot see the
 *   same DECISION stated twice under two ids, which is what a document ingested twice
 *   produces. Two of those cases are decidable from the files alone and are decided here:
 *
 *     1. one law STATEMENT TEXT declared under two different law ids — the corpus then holds
 *        one constraint twice and neither record owns it (`DUPLICATE_LAW_STATEMENT`);
 *     2. one `source.hash` cited by two records that also declare a law id in common — one
 *        document was ingested twice and the second record is a restatement rather than a
 *        decision (`DUPLICATE_SOURCE_CITED`).
 *
 *   A re-declared law with an IDENTICAL statement under ONE id is deliberately NOT reported:
 *   the compiler merges the two declarations into a single law bound to the union of both
 *   records' zones, which is the corpus agreeing with itself rather than duplicating. A test
 *   pins that, because the check that reports it would break the merge.
 *
 *   Why rule 2 asks for a shared law id and not merely a shared source: a source document
 *   legitimately carries many decisions. Batch extraction (ADR 0033) writes one proposed
 *   record per decision from ONE source, and this kit's own corpus holds four decisions that
 *   cite one design-session document and two that cite one API-discovery document. Reporting
 *   every shared source would therefore fail this kit and forbid the batch mechanism the
 *   corpus also decided on, so what is reported is the case the two rules together describe:
 *   one source, and one law declared twice from it.
 *
 *   This command is DETERMINISTIC and runs no model. Duplicates that only meaning reveals
 *   are a separate ADVISORY report — `ratchet_review --job review_duplicates`, which spawns a
 *   judge — and its findings never reach this exit code. A model verdict that could fail a
 *   build is one people learn to re-run until it passes, so the two strengths are kept
 *   apart on purpose, and a test pins the separation.
 *
 * INPUTS
 *   `--root <dir>`  the project to check (default: the nearest ancestor of the working
 *                   directory that holds `.dsh/project.json`). `--json` prints the whole
 *                   result as one JSON object instead of the report.
 *
 * OUTPUTS
 *   On stdout: one line naming what was examined, then the duplicates found (each with its
 *   stable problem code, the source, and the records and law ids involved), then
 *   `duplicate decisions ok` when there are none. Exits 0 when the corpus holds no
 *   decidable duplicate, 1 when it does, 2 when the project cannot be read at all (no
 *   manifest, the ratchet disabled, no decisions directory, or no ADR that parses) so that
 *   "nothing was checked" is never reported as "nothing is wrong". A run that exits 0
 *   without printing the marker is not a pass, which is why the law's check asserts on the
 *   marker rather than on the exit code alone.
 *
 * KEYWORDS
 *   duplicate, deduplication, corpus, gate, deterministic, enforcement point, exit code
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A project with one record, or with no law at all, reports its counts and exits 0:
 *     there is nothing two records could duplicate.
 *   - An unreadable ADR or a malformed manifest exits 2 rather than reporting a clean
 *     corpus, because the duplicates may be in the file that could not be read.
 *   - An approval ADR declares no law, so it can never be reported: two approvals are not
 *     two decisions.
 *   - A duplicate whose two records are the same file read twice cannot occur; ids are
 *     unique per corpus and the compiler reports `ADR_ID_DUPLICATE` for that.
 */
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { readAdrCorpus, readManifest } from '../plugins/ratchet/ratchet-compiler.mjs'
import { MANIFEST_PATH } from '../plugins/ratchet/ratchet-schema.mjs'

/**
 * The nearest ancestor of a directory that holds the project manifest.
 *
 * @param start - Absolute directory to search upward from.
 * @returns The absolute project root, or `null` when no ancestor holds the manifest.
 */
function findRoot(start) {
  let current = resolve(start)
  for (;;) {
    if (existsSync(resolve(current, MANIFEST_PATH))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/**
 * Collects the decidable duplicates in one corpus.
 *
 * Pure: it reads the records it is given and returns findings, so the two rules can be
 * asserted directly as well as through the process exit code. Both rules are reported
 * per-occurrence rather than per-pair, keyed on the statement text (rule 1) and on the
 * source hash (rule 2), because that key is the thing the caller has to change.
 *
 * @param records - Parsed ADR records, as `readAdrCorpus` returns them.
 * @returns `{ scanned, duplicates }` where `scanned` counts the records, law statements and
 *   source hashes examined, and `duplicates` is an array of
 *   `{ code, key, message, records, lawIds }`. Empty `duplicates` means the corpus holds no
 *   duplicate this command can decide — not that it holds none at all.
 */
export function findDuplicates(records) {
  const list = Array.isArray(records) ? records : []
  const byStatement = new Map()
  const bySource = new Map()
  let statements = 0
  let sources = 0

  for (const record of list) {
    if (record === null || typeof record !== 'object') continue
    for (const law of record.laws ?? []) {
      if (law === null || typeof law !== 'object' || law.op !== 'upsert') continue
      if (typeof law.id !== 'string' || law.id.length === 0) continue
      statements += 1
      const statement = typeof law.statement === 'string' ? law.statement.trim() : ''
      if (statement.length === 0) continue
      // Rule 1 keys on the TEXT, because the same constraint under two ids is one constraint
      // the corpus cannot attribute. Keying on the text is what makes a re-declaration under
      // ONE id invisible here and merged by the compiler, which is the intended behaviour.
      if (!byStatement.has(statement)) byStatement.set(statement, new Map())
      const ids = byStatement.get(statement)
      if (!ids.has(law.id)) ids.set(law.id, [])
      ids.get(law.id).push(record.id)
    }

    const hash = record.source?.hash
    if (typeof hash !== 'string' || hash.length === 0) continue
    sources += 1
    if (!bySource.has(hash)) bySource.set(hash, [])
    bySource.get(hash).push(record)
  }

  const duplicates = []
  for (const [statement, ids] of byStatement) {
    if (ids.size < 2) continue
    duplicates.push({
      code: 'DUPLICATE_LAW_STATEMENT',
      key: statement,
      message: `one law statement is declared under ${ids.size} different law ids (${[...ids.keys()].join(', ')}); the corpus holds one constraint twice and neither record owns it, so either merge them under one id or settle which decision governs`,
      records: [...new Set([...ids.values()].flat())].sort(),
      lawIds: [...ids.keys()].sort(),
    })
  }
  for (const [hash, group] of bySource) {
    if (group.length < 2) continue
    const byLaw = new Map()
    for (const record of group) {
      for (const law of record.laws ?? []) {
        if (law === null || typeof law !== 'object' || law.op !== 'upsert') continue
        if (typeof law.id !== 'string' || law.id.length === 0) continue
        if (!byLaw.has(law.id)) byLaw.set(law.id, [])
        byLaw.get(law.id).push(record.id)
      }
    }
    const shared = [...byLaw.entries()].filter(([, ids]) => new Set(ids).size > 1)
    if (shared.length === 0) continue
    duplicates.push({
      code: 'DUPLICATE_SOURCE_CITED',
      key: hash,
      message: `source ${hash} is cited by ${group.length} records (${group.map((record) => record.id).sort().join(', ')}) and they declare ${shared.map(([id]) => `"${id}"`).join(', ')} in common; one document was ingested twice and the later record is a restatement rather than a decision`,
      records: group.map((record) => record.id).sort(),
      lawIds: shared.map(([id]) => id).sort(),
    })
  }

  duplicates.sort((left, right) => (left.code < right.code ? -1 : left.code > right.code ? 1 : left.key < right.key ? -1 : 1))
  return { scanned: { records: list.length, statements, sources }, duplicates }
}

/**
 * Runs the command and returns the result without printing it.
 *
 * @param root - Absolute project root.
 * @returns `{ ok, stage, codes, duplicates, scanned, problems, summary }`. `stage` is
 *   `'unusable'` when nothing could be checked, `'duplicates'` when the corpus holds a
 *   decidable duplicate, and `'clean'` otherwise.
 */
export function checkDuplicates(root) {
  const manifest = readManifest(root)
  if (manifest.config === null) {
    return { ok: false, stage: 'unusable', codes: manifest.problems.map((entry) => entry.code), duplicates: [], scanned: null, problems: manifest.problems }
  }
  if (manifest.config.enabled !== true) {
    return {
      ok: false,
      stage: 'unusable',
      codes: ['RATCHET_DISABLED'],
      duplicates: [],
      scanned: null,
      problems: [
        {
          code: 'RATCHET_DISABLED',
          severity: 'error',
          subject: null,
          message: `${MANIFEST_PATH} exists but does not declare ratchet.enabled: true, so there is no corpus to deduplicate`,
        },
      ],
    }
  }
  const corpus = readAdrCorpus(root, manifest.config)
  // A corpus that could not be read is not a clean corpus: the duplicate may be in the file
  // that was not read, so this is the "nothing was checked" case and exits 2.
  if (corpus.records.length === 0 || corpus.problems.length > 0) {
    return {
      ok: false,
      stage: 'unusable',
      codes: corpus.problems.map((entry) => entry.code),
      duplicates: [],
      scanned: null,
      problems: corpus.problems,
    }
  }
  const { scanned, duplicates } = findDuplicates(corpus.records)
  return {
    ok: duplicates.length === 0,
    stage: duplicates.length === 0 ? 'clean' : 'duplicates',
    codes: duplicates.map((entry) => entry.code),
    duplicates,
    scanned,
    problems: [],
  }
}

/** Parses argv; an unknown flag or a missing value is a usage error. */
function parseArgs(argv) {
  const options = { root: null, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--json') options.json = true
    else if (token === '--root') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) return { error: '--root needs a directory' }
      options.root = value
      index += 1
    } else return { error: `unknown argument ${JSON.stringify(token)}` }
  }
  return { options }
}

const parsed = parseArgs(process.argv.slice(2))
if (parsed.error !== undefined) {
  process.stderr.write(`check-duplicate-decisions: ${parsed.error}\n`)
  process.exit(2)
}
const root = parsed.options.root === null ? findRoot(process.cwd()) : resolve(parsed.options.root)
if (root === null) {
  process.stderr.write(`check-duplicate-decisions: no ${MANIFEST_PATH} found above ${process.cwd()}\n`)
  process.exit(2)
}

const result = checkDuplicates(root)

if (parsed.options.json) {
  process.stdout.write(`${JSON.stringify({ root, ...result }, null, 2)}\n`)
} else {
  process.stdout.write(`check-duplicate-decisions: ${result.stage} (${root})\n`)
  if (result.scanned !== null) {
    process.stdout.write(
      `  examined ${result.scanned.records} record(s), ${result.scanned.statements} law statement(s), ${result.scanned.sources} source hash(es)\n`,
    )
  }
  for (const entry of result.duplicates) {
    process.stdout.write(`  ${entry.code} [${entry.key.length > 60 ? `${entry.key.slice(0, 57)}...` : entry.key}]\n`)
    process.stdout.write(`    ${entry.message}\n`)
  }
  for (const entry of result.problems) {
    process.stdout.write(`  ${entry.code}: ${entry.message}\n`)
  }
  if (result.stage === 'clean') {
    process.stdout.write('duplicate decisions ok\n')
  }
}

// 0 nothing decidable is duplicated, 1 the corpus duplicates something, 2 nothing was
// checked. A judge's finding never reaches this number: no model runs in this process.
process.exit(result.stage === 'unusable' ? 2 : result.ok ? 0 : 1)
