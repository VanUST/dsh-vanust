/**
 * PURPOSE
 *   Find the duplicate decisions a machine can decide, and DRAFT the resolution that settles
 *   each one, so the developer's only act is to ratify or decline.
 *
 *   The compiler already sees one law id declared with two different statements
 *   (`LAW_CONFLICT`) and a law that left force with no decision behind it. It cannot see the
 *   same DECISION stated twice under two ids, which is what ingesting one document twice
 *   produces. Two of those cases are decidable from the files alone, and both are decided
 *   here:
 *
 *     1. one law STATEMENT TEXT declared under two different law ids — the corpus then holds
 *        one constraint twice and neither record owns it (`DUPLICATE_LAW_STATEMENT`);
 *     2. one `source.hash` cited by two records that also declare a law id in common — one
 *        document was ingested twice and the later record is a restatement rather than a
 *        decision (`DUPLICATE_SOURCE_CITED`).
 *
 *   A re-declared law with an IDENTICAL statement under ONE id is deliberately NOT reported:
 *   the compiler merges the two declarations into a single law bound to the union of both
 *   records' zones, which is the corpus agreeing with itself rather than duplicating. A test
 *   pins that, because a check that reported it would break the merge.
 *
 *   Why rule 2 asks for a shared law id and not merely a shared source: a source document
 *   legitimately carries many decisions. Batch extraction (ADR 0033) writes one proposed
 *   record per decision from ONE source, so a kit corpus can hold many decisions citing one
 *   design-session document. Reporting every shared source would forbid the batch mechanism
 *   the corpus also decided on, so what is reported is the case the two rules together
 *   describe: one source, and one law declared twice from it.
 *
 *   What this module does with a finding is the second half of its job. For each duplicate it
 *   drafts an ordinary `proposed` decision record carrying `resolves: [loser, winner]` and an
 *   `op: remove` for the law that duplicates — the SURGICAL form ADR 0031 settled on, which
 *   takes the duplicated law out of force while the rest of that record keeps governing. It
 *   never writes an approval and never puts anything into force: a duplicate is settled by a
 *   human ratifying the draft, and every draft is reversible by deleting a proposed file.
 *
 * INPUTS
 *   `findDuplicates(records)` — parsed ADR records, as `readAdrCorpus` returns them.
 *   `draftResolutions(root, options)` — a project root, the parsed ratchet `config`, and
 *   whether to write.
 *
 * OUTPUTS
 *   `findDuplicates` returns `{ scanned, duplicates }` where `scanned` counts the records,
 *   law statements and source hashes examined and `duplicates` is an array of
 *   `{ code, key, message, records, lawIds }`. Empty `duplicates` means the corpus holds no
 *   duplicate THIS module can decide — not that it holds none at all.
 *
 *   `draftResolutions` returns `{ ok, drafts, undraftable, problems }`. Each draft is
 *   `{ duplicate, id, filename, path, text, removes, keeps, status }` ready to be written;
 *   each undraftable finding carries `{ duplicate, reason }` and is reported rather than
 *   guessed at. A corpus that cannot be read yields `{ ok: false, unusable: true, problems }`.
 *
 * KEYWORDS
 *   duplicate, deduplication, resolution, merge, draft, advisory, deterministic, proposed,
 *   ledger, judge-free, corpus
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No records, or records with no law: `duplicates` is empty and nothing is drafted.
 *   - A finding whose two records cannot be ordered into a loser and a winner — both are
 *     terminal, one does not exist, the duplicate is a re-declaration the compiler already
 *     merges — is reported as undraftable with the reason, never silently dropped.
 *   - A law declared in a `humanOnly` zone is never drafted: the authority rule makes the
 *     removal unratifiable by an agent, so the draft would be a question that cannot be
 *     answered.
 *   - A missing id has no draft to address: `renderAdr`-style identity comes from the
 *     existing set, and a corpus that cannot be listed yields a problem rather than a guess.
 *   - Nothing here throws on malformed input: a record that is not an object, a law that is
 *     not a mapping and a `resolves` list that is not a list each contribute nothing.
 */
import { compileProject, readAdrCorpus, readManifest, zonesForRecord } from './ratchet-compiler.mjs'
import { MANIFEST_PATH, TERMINAL_ADR_STATUSES } from './ratchet-schema.mjs'
import { existingAdrIds, nextAdrId, readSource, writeIngested } from './ratchet-ingest.mjs'

/**
 * Collects the decidable duplicates in one corpus.
 *
 * Pure: it reads the records it is given and returns findings, so the two rules can be
 * asserted directly as well as through the process exit code. Both rules are reported
 * per-occurrence rather than per-pair, keyed on the statement text (rule 1) and on the
 * source hash (rule 2), because that key is the thing the caller has to change.
 *
 * A law an active record retires with an explicit `op: remove` is NOT counted. A duplicate
 * is a property of the law IN FORCE: once a ratified resolution withdraws the duplicated law,
 * the corpus holds the constraint once however many records still declare it, and reporting
 * it again would make settling a duplicate turn the gate from red to red — the one outcome
 * that guarantees nobody uses the mechanism. The retiring set comes from the compiler rather
 * than from a second reading of `op: remove`, so the two cannot disagree about what is in
 * force.
 *
 * @param records - Parsed ADR records, as `readAdrCorpus` returns them.
 * @param options - `{ removedLawIds }`: law ids an active record retires. An omitted or empty
 *   set reports every declaration, which is the right answer for a corpus nothing retires.
 * @returns `{ scanned, duplicates }` — see the module header for the shapes. The result is
 *   sorted by code and key, so two runs over one corpus print the same order.
 */
export function findDuplicates(records, { removedLawIds = [] } = {}) {
  const list = Array.isArray(records) ? records : []
  const retired = new Set(removedLawIds ?? [])
  const byStatement = new Map()
  const bySource = new Map()
  let statements = 0
  let sources = 0

  for (const record of list) {
    if (record === null || typeof record !== 'object') continue
    for (const law of record.laws ?? []) {
      if (law === null || typeof law !== 'object' || law.op !== 'upsert') continue
      if (typeof law.id !== 'string' || law.id.length === 0) continue
      if (retired.has(law.id)) continue
      statements += 1
      const statement = typeof law.statement === 'string' ? law.statement.trim() : ''
      if (statement.length === 0) continue
      // Rule 1 keys on the TEXT, because the same constraint under two ids is one constraint
      // the corpus cannot attribute. Keying on the text is what makes a re-declaration under
      // ONE id invisible here and merged by the compiler, which is the intended behaviour.
      if (!byStatement.has(statement)) byStatement.set(statement, new Map())
      const ids = byStatement.get(statement)
      if (!ids.has(law.id)) ids.set(law.id, { records: [], statement })
      ids.get(law.id).records.push(record.id)
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
      statement,
      message: `one law statement is declared under ${ids.size} different law ids (${[...ids.keys()].join(', ')}); the corpus holds one constraint twice and neither record owns it, so either merge them under one id or settle which decision governs`,
      records: [...new Set([...ids.values()].flatMap((entry) => entry.records))].sort(),
      lawIds: [...ids.keys()].sort(),
      // Which law id carries this statement in which record, so a draft can name the law to
      // remove instead of guessing. The two sides of a rule-1 duplicate declare DIFFERENT law
      // ids — that is what makes it a duplicate — so "the id they share" is empty here and a
      // fallback to the first id in the list would remove the KEEPER's law.
      byLawId: Object.fromEntries([...ids.entries()].map(([lawId, entry]) => [lawId, entry.records])),
    })
  }
  for (const [hash, group] of bySource) {
    if (group.length < 2) continue
    const byLaw = new Map()
    for (const record of group) {
      for (const law of record.laws ?? []) {
        if (law === null || typeof law !== 'object' || law.op !== 'upsert') continue
        if (typeof law.id !== 'string' || law.id.length === 0) continue
        if (retired.has(law.id)) continue
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
 * Orders one finding's records into the side that loses a law and the side that keeps it.
 *
 * The order is by id, which is allocation order and therefore the order the decisions were
 * recorded in: the EARLIER record keeps the law and the later record's duplicate is the one
 * removed. That is a choice, not a deduction, and it is the conservative one — it leaves the
 * decision that was written first governing, which is the record every reader has already
 * been following. The two shapes that cannot be drafted are refused with a reason: a finding
 * whose records are not both live (a terminal record contributes no law to remove), and one
 * where fewer than two records were involved.
 *
 * @param duplicate - One entry from {@link findDuplicates}.
 * @param byId - Map of record id to parsed record.
 * @param config - Parsed ratchet configuration.
 * @returns `{ loser, winner, lawId }` when a draft can be made, or `{ reason }` when it
 *   cannot. `lawId` is the law the draft removes: for a shared-statement finding, the losing
 *   record's law whose statement is the duplicated one, and for a shared-source finding, the
 *   law id both records declare. It is never the KEEPER's law — a rule-1 duplicate has two
 *   different ids by definition, so there is no shared id to fall back to.
 */
export function chooseLoser(duplicate, byId, config) {
  const ids = [...new Set(duplicate.records ?? [])].sort()
  if (ids.length < 2) {
    return { reason: `the finding names ${ids.length} record(s), and a duplicate is a relation between at least two, so there is no pair to order` }
  }
  const [keeperId, withdrawnId] = ids
  const winner = byId.get(keeperId)
  const loser = byId.get(withdrawnId)
  if (winner === undefined || loser === undefined) {
    return { reason: `one of ${ids.join(', ')} has no record in the corpus, so the duplicate cannot be attributed to two decisions` }
  }
  if (TERMINAL_ADR_STATUSES.includes(loser.status)) {
    return { reason: `the later record (${withdrawnId}) already carries the terminal status "${loser.status}", so it contributes no law to remove` }
  }
  const humanOnly = zonesForRecord(loser, config).filter((zone) => zone.agentAuthority === 'humanOnly')
  if (humanOnly.length > 0) {
    return {
      reason: `the later record (${withdrawnId}) declares zone "${humanOnly[0].id}", which is reserved to humans, so a drafted resolution could never be ratified by this path and the duplicate has to be settled by a human-authored record`,
    }
  }
  // The law to remove is the one in the LOSING record that is the duplicate. For a shared
  // statement that is the law whose statement is the one the finding keyed on; for a shared
  // source it is the law id both records declare.
  const winnerLaws = new Set(winner.laws.filter((law) => law.op === 'upsert').map((law) => law.id))
  const shared = loser.laws.filter((law) => law.op === 'upsert' && winnerLaws.has(law.id))
  const byStatement =
    typeof duplicate.statement === 'string'
      ? loser.laws.find((law) => law.op === 'upsert' && String(law.statement ?? '').trim() === duplicate.statement)
      : undefined
  const lawId = byStatement?.id ?? shared[0]?.id ?? null
  if (typeof lawId !== 'string' || lawId.length === 0) {
    return { reason: 'the finding names no law id this resolution could remove from the losing record' }
  }
  return { loser, winner, lawId }
}

/**
 * Renders the resolution that settles one duplicate, as a proposal.
 *
 * The record is ordinary in every respect — an ADR with a source, a Reasoning section and a
 * law list — because the schema has no `type: resolution` and ADR 0031 decided against one.
 * What makes it a resolution is `resolves: [loser, winner]` plus the `op: remove` for the
 * duplicated law: the SURGICAL shape, which withdraws the one law that duplicates and leaves
 * everything else the losing record declares in force. The text states which side it keeps
 * and why, so a human ratifying it reads the decision rather than a machine's diff.
 *
 * @param options - `{ id, duplicate, loser, winner, lawId, sourcePath, sourceHash, createdAt,
 *   decisionsDir }`.
 * @returns `{ filename, path, text, title }`, the same shape `renderAdr` produces.
 */
export function renderResolution({ id, duplicate, loser, winner, lawId, sourcePath, sourceHash, createdAt, decisionsDir = 'docs/adrs' }) {
  const title = `Settle duplicate: keep ${winner.id}, withdraw ${lawId}`
  const filename = `${id}-${slug(title)}.adr.md`
  const zones = [...new Set(loser.zones ?? [])]
  const lawInForce = (record) => record.laws.filter((law) => law.op === 'upsert')
  const text = [
    '---',
    `id: "${id}"`,
    `title: ${title}`,
    'type: adr',
    // Proposed, always. A machine found the duplicate; a human decides whether the loss of
    // one law is the right settlement, which is the consent this whole mechanism rests on.
    'status: proposed',
    'author:',
    '  authority: agent',
    '  name: ratchet-deduplicate',
    `created: ${createdAt}`,
    'source:',
    '  kind: file',
    `  path: ${sourcePath}`,
    `  hash: ${sourceHash}`,
    // A block sequence needs at least one item, and `zones:\n  []` is an indent nothing
    // understands: the parser read the draft as declaring no zones at all. An empty list is
    // written in flow form on the key's own line instead, and a resolution with no zone is a
    // resolution that removes a law without claiming a path of its own.
    ...(zones.length === 0 ? ['zones: []'] : ['zones:', ...zones.map((zone) => `  - ${zone}`)]),
    'supersedes: []',
    'approves: []',
    'resolves:',
    `  - "${loser.id}"`,
    `  - "${winner.id}"`,
    'laws:',
    '  - op: remove',
    `    id: ${lawId}`,
    // The frontmatter block has to be CLOSED. Without this line the parser reports
    // `ADR_FRONTMATTER_INVALID` for every draft, so a drafted resolution was a file that
    // could not be read — which the drafter's own parse check in the suite catches.
    '---',
    '',
    '## Context',
    '',
    `The corpus holds the same decision twice: ${duplicate.code}.`,
    '',
    duplicate.message,
    '',
    `- keep: ADR ${winner.id} — ${winner.title ?? '(no title)'} (${winner.path})`,
    ...lawInForce(winner).map((law) => `  - \`${law.id}\` — ${law.statement ?? '(no statement)'}`),
    `- withdraw: ADR ${loser.id} — ${loser.title ?? '(no title)'} (${loser.path})`,
    ...lawInForce(loser).map((law) => `  - \`${law.id}\` — ${law.statement ?? '(no statement)'}${law.id === lawId ? '  ← withdrawn by this resolution' : '  (stays in force)'}`),
    '',
    '## Decision',
    '',
    `Law \`${lawId}\` is withdrawn and the earlier record (ADR ${winner.id}) keeps governing.`,
    `ADR ${loser.id} stays in force and keeps every other law it declares: this is the surgical`,
    'settlement, not a replacement, so nothing is retired that the conflict did not require.',
    '',
    '## Reasoning',
    '',
    `A deterministic check found this duplicate; no model decided it. The two sides are ordered`,
    `by id, which is the order the decisions were recorded in, so the decision a reader has been`,
    `following longest is the one that survives. Removing the duplicated law is what makes the`,
    'corpus attribute the constraint to one record, which is the property `LAW_CONFLICT` and the',
    'compiler cannot restore on their own.',
    '',
    '## Consequences',
    '',
    `- Ratifying this record withdraws \`${lawId}\`; declining it leaves the duplicate in place.`,
    `- Deleting this file is the other way to decline, and nothing else in the corpus changes.`,
    `- If the later decision is the one that should govern, draft the opposite resolution — remove`,
    `  the law from ADR ${winner.id} instead — rather than editing this record's intent.`,
    '',
  ].join('\n')
  return { filename, path: `${String(decisionsDir).replace(/\/+$/, '')}/${filename}`, text, title }
}

/**
 * Makes a filename slug from a title.
 *
 * @param title - Any text.
 * @returns Lowercase words joined by hyphens, at most 60 characters, never empty.
 */
function slug(title) {
  const cleaned = String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned.length === 0 ? 'resolution' : cleaned.slice(0, 60).replace(/-+$/, '')
}

/**
 * Drafts one proposed resolution per decidable duplicate in a project's corpus.
 *
 * This is the automatic half of deduplication: the check reports, and this turns each report
 * into a record a human can ratify. It writes NOTHING into force — every draft is
 * `status: proposed` — and it writes no approval, so a corpus cannot be deduplicated without
 * a consent. Deleting a draft is the whole of a decline.
 *
 * A finding it cannot draft is returned under `undraftable` with the reason, never skipped:
 * a duplicate that is reported by the command and absent from the drafts is a duplicate a
 * reader would otherwise believe was handled.
 *
 * @param root - Absolute project root.
 * @param options - `{ write, createdAt }`. `write` places each draft under the decisions
 *   directory, refusing to overwrite an existing file; `false` returns the text only.
 * @returns `{ ok, drafts, undraftable, problems, scanned }`. `ok` is true when the corpus was
 *   read and every reporting finding was drafted; `unusable` is set when nothing could be
 *   read. `writeIngested` is not used here because a resolution is a draft a caller may want
 *   to review first — the caller decides with `write`.
 */
export function draftResolutions(root, { write = false, createdAt = null } = {}) {
  const manifest = readManifest(root)
  if (manifest.config === null || manifest.config.enabled !== true) {
    const problems = manifest.config === null
      ? manifest.problems
      : [
          {
            code: 'RATCHET_DISABLED',
            severity: 'error',
            subject: null,
            message: `${MANIFEST_PATH} does not declare ratchet.enabled, so there is no corpus to deduplicate`,
          },
        ]
    return { ok: false, unusable: true, drafts: [], undraftable: [], problems, scanned: null }
  }
  const config = manifest.config
  const corpus = readAdrCorpus(root, config)
  if (corpus.records.length === 0 || corpus.problems.length > 0) {
    return { ok: false, unusable: true, drafts: [], undraftable: [], problems: corpus.problems, scanned: null }
  }

  // What is actually in force, from the compiler, so a law a ratified resolution already
  // withdrew is not reported as a duplicate for ever.
  const compiled = compileProject(root)
  const { scanned, duplicates } = findDuplicates(corpus.records, { removedLawIds: compiled.removedByDecision ?? [] })
  if (duplicates.length === 0) {
    return { ok: true, drafts: [], undraftable: [], problems: [], scanned }
  }

  const byId = new Map(corpus.records.map((record) => [record.id, record]))
  const existing = existingAdrIds(root, config.decisionsDir)
  const ids = [...existing.ids]
  const drafts = []
  const undraftable = []
  const problems = []

  for (const duplicate of duplicates) {
    const choice = chooseLoser(duplicate, byId, config)
    if (choice.reason !== undefined) {
      undraftable.push({ duplicate, reason: choice.reason })
      continue
    }
    const id = nextAdrId(ids)
    ids.push(id)
    // The draft cites the LOSING record's own source path, because that is the reasoning the
    // duplicate was drawn from — and the HASH is recomputed from the file rather than copied
    // out of the record. A record whose frontmatter carries no hash is legal, and copying the
    // absent value wrote `hash:` with nothing after it, which made every drafted resolution a
    // file that does not parse. A source that cannot be read is reported for that finding
    // rather than papered over with an empty hash.
    const citedPath = choice.loser.source?.path ?? null
    const cited = citedPath === null ? { error: `ADR ${choice.loser.id} declares no source path, so a draft cannot cite the reasoning the duplicate came from` } : readSource(root, citedPath)
    if (cited.error !== undefined) {
      undraftable.push({ duplicate, reason: cited.error })
      continue
    }
    const rendered = renderResolution({
      id,
      duplicate,
      loser: choice.loser,
      winner: choice.winner,
      lawId: choice.lawId,
      sourcePath: citedPath,
      sourceHash: cited.hash,
      createdAt: createdAt ?? new Date().toISOString(),
      decisionsDir: config.decisionsDir,
    })
    const draft = {
      duplicate,
      id,
      filename: rendered.filename,
      path: rendered.path,
      title: rendered.title,
      text: rendered.text,
      status: 'proposed',
      removes: choice.lawId,
      keeps: choice.winner.id,
      withdraws: choice.loser.id,
      written: null,
    }
    if (write) {
      const outcome = writeIngested(root, rendered)
      if (outcome.error !== undefined) {
        problems.push({ code: 'ARTIFACT_WRITE_FAILED', severity: 'error', subject: rendered.path, message: outcome.error })
        undraftable.push({ duplicate, reason: outcome.error })
        continue
      }
      draft.written = outcome.written
    }
    drafts.push(draft)
  }

  return { ok: problems.length === 0, drafts, undraftable, problems, scanned }
}
