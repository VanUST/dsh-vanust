/**
 * PURPOSE
 *   Detect the decision issues a MACHINE can decide and DRAFT the settlement for each, inside
 *   the ratchet's own flow rather than behind a tool an agent has to remember to call. The
 *   human's direction is explicit: the ratchet detects these and flags them for a human to
 *   resolve. This module is that detection and drafting pass; it is invoked by `ratchet compile`
 *   (which the ADR panel's view also runs, read-only) and by `ratchet_deduplicate` for an
 *   explicit call, and it is never an agent's own initiative.
 *
 *   Three issues are in scope, and for each it DRAFTS a proposal and writes NOTHING into force:
 *
 *     1. DUPLICATE — one law statement under two ids, or one source cited by two records that
 *        share a law. The rule and the draft both live in `ratchet-dedupe.mjs`; this module
 *        reuses `draftResolutions` and adds no second rule.
 *     2. CONTRADICTION — a plain (non-resolution) proposed record removes or redeclares a law
 *        in force. The conflicts come from the compiler's own `decidableContradictions`, gated
 *        by `auditedResolutions`, exactly as the write guard and the ratification queue read
 *        them; this module re-implements neither. Each draft is an ordinary `proposed` record
 *        naming `resolves: [<holder>, <offender>]` and taking force away in the one-way shape
 *        ADR 0045 fixes: an `op: remove` of the redeclared law, or — when the offender merely
 *        REMOVES a law in force, where the removal arm is refused by the resolution audit as
 *        `ADR_RESOLVES_OUTSIDE_FORCE` — a `supersedes` of the offending proposal. A record that
 *        already declares `resolves` is never drafted for.
 *     3. STALE SPEC — a generated document that is unedited but was written from an older law
 *        set. The draft is a withdrawal NOTE under `reports/ratchet/drafts/`, written by the
 *        ratchet and never applied: the ratchet does not delete or regenerate the document.
 *
 *   Idempotence is mandatory and is carried by the draft's own identity. Every draft this
 *   module writes records `draft: true` and a deterministic `draftKey` in its frontmatter; the
 *   parsed corpus is searched for that key before anything is written, so a second pass neither
 *   adds a second draft for an issue nor overwrites a draft a human has edited or ratified.
 *   The stale note's identity is its deterministic path, and an existing file is never
 *   overwritten.
 *
 * INPUTS
 *   `draftNeedsHuman(root, options)` — `root` is an absolute project root (string); options is
 *   `{ write, createdAt }`. `write:false` computes the same drafts and returns their text
 *   without touching the project, which is what the ADR panel's state route uses because a
 *   read must not mutate.
 *
 * OUTPUTS
 *   A plain JSON-serializable object:
 *     - `ok` — true when the corpus was readable.
 *     - `unusable` — true when it was not; the other lists are then empty.
 *     - `duplicates` — `{ drafts, alreadyDrafted, undraftable, scanned }` straight from
 *       `draftResolutions`.
 *     - `contradictions` — `{ drafts, alreadyDrafted, undraftable, needs }`. Each draft is
 *       `{ id, path, title, text, draftKey, written, offenderId, holderId, lawIds, strategy }`;
 *       each need is `{ offenderId, holderId, lawIds, reason, draft, draftReason }`, where draft
 *       is `{ id, path }` or null and `draftReason` says why no draft exists.
 *     - `staleNotes` — one `{ path, notePath, recorded, wanted, text, written, existed }` per
 *       stale generated document.
 *     - `advisory` — `{ specHash, findings, error }`: the corpus reviews' advisory findings
 *       whose recorded law set is the one now compiled. Only the `deprecated_decision` entries
 *       are consumed downstream (as a `deprecated` need); the `semantic_duplicate` entries have
 *       already been drafted or reported undraftable under `duplicates`.
 *     - `problems` — drafting failures, never the issues themselves.
 *   A non-string or empty `root`, or a project with no enabled ratchet, returns `{ ok:false,
 *   unusable:true, ... }` rather than throwing.
 *
 * KEYWORDS
 *   automatic drafting, needs a human, duplicate, contradiction, stale spec, withdrawal note,
 *   idempotent, draftKey, resolution, one-way shape, ratchet owns the derivation
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No manifest, or a disabled ratchet: unusable with the manifest's own problems.
 *   - A corpus that does not parse: every list is empty and the problems are carried.
 *   - A contradiction whose holder is unnamed, or whose offender already declares `resolves`:
 *     reported under `undraftable`/as a need with no draft and the reason, never guessed at.
 *   - A conflict in a `humanOnly` zone is not drafted: an agent-authored resolution there could
 *     never be ratified, so it is reported with that reason.
 *   - Nothing here throws on malformed input; a missing field contributes an empty list.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  auditedResolutions,
  bundleHash,
  compileLaws,
  compileProject,
  decidableContradictions,
  readAdrCorpus,
  readManifest,
  renderSpecs,
  resolveActiveSet,
  zonesForRecord,
} from './ratchet-compiler.mjs'
import { draftResolutions } from './ratchet-dedupe.mjs'
import { advisoryFindingsFor, detectSpecDrift } from './ratchet-state.mjs'
import { existingAdrIds, nextAdrId, readSource, writeIngested } from './ratchet-ingest.mjs'
import { hashSource } from './ratchet-schema.mjs'

/** The directory the ratchet writes a draft's withdrawal note into, under the reports dir. */
export const STALE_NOTE_DIR = 'drafts'

/**
 * The stable identity of one contradiction finding, used as a draft's `draftKey`.
 *
 * The pair of record ids is the identity because that is what a resolution NAMES and what the
 * conflict is between: two laws contested by the same two records are one settlement, however
 * many laws it names.
 *
 * @param offenderId - The proposed record that contradicts law in force.
 * @param holderId - The record that put the contradicted law in force.
 * @returns A token of the form `contradiction:<offender>:<holder>`; never null and never throws.
 */
export function contradictionDraftKey(offenderId, holderId) {
  return `contradiction:${String(offenderId ?? 'none')}:${String(holderId ?? 'none')}`
}

/**
 * The stable identity of one stale-spec finding, used as a draft's `draftKey`.
 *
 * @param path - The generated document those laws no longer match.
 * @returns A token of the form `stale-spec:<16 hex>`; never null and never throws.
 */
export function staleSpecDraftKey(path) {
  return `stale-spec:${createHash('sha256').update(String(path ?? '')).digest('hex').slice(0, 16)}`
}

/**
 * A filename slug for a repository-relative path, for the deterministic note name.
 *
 * @param value - Any text.
 * @returns Lowercase words joined by hyphens, bounded in length, never empty.
 */
function slug(value) {
  const cleaned = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned.length === 0 ? 'note' : cleaned.slice(0, 48).replace(/-+$/, '')
}

/**
 * The deterministic path a stale document's withdrawal note is drafted to.
 *
 * Deterministic because "does a draft for this document already exist" is answered by the path
 * alone, and a human who edits the note keeps it: the ratchet never overwrites the file.
 *
 * @param config - Parsed ratchet configuration (`reportsDir`).
 * @param specPath - The stale document's repository-relative path.
 * @returns A repository-relative path under the reports drafts directory.
 */
export function staleNotePath(config, specPath) {
  const reportsDir = typeof config?.reportsDir === 'string' && config.reportsDir.length > 0 ? config.reportsDir : 'reports/ratchet'
  return `${reportsDir.replace(/\/+$/, '')}/${STALE_NOTE_DIR}/withdraw-${slug(specPath)}-${createHash('sha256').update(String(specPath ?? '')).digest('hex').slice(0, 8)}.md`
}

/**
 * The withdrawal note the ratchet drafts for one stale generated document.
 *
 * It states what is stale, by the two hashes the drift report already carries, and what a human
 * may do — regenerate or delete the document. It is a NOTE and never an applied change: the
 * ratchet writes it and stops, because deleting or regenerating a human-readable document is
 * the human's act.
 *
 * @param entry - `{ path, recorded, wanted }` from `detectSpecDrift`'s `stale` list.
 * @param notePath - The repository-relative path the note is drafted to.
 * @returns The note's text.
 */
export function renderStaleSpecNote(entry, notePath) {
  return [
    '# Drafted withdrawal note: stale generated spec',
    '',
    `The generated spec document \`${entry.path}\` was written from spec ${entry.recorded} but`,
    `the laws now hash to ${entry.wanted}. It is unedited and describes decisions that are no`,
    'longer in force.',
    '',
    'This note was written by the RATCHET itself as part of its detection pass — no agent and no',
    'model decided to write it. It proposes the document be withdrawn: regenerate it with',
    '`ratchet compile --write`, or delete it if the laws it described were removed deliberately.',
    'The ratchet has NOT applied either change; the document on disk is untouched.',
    '',
    `Draft identity: stale-spec for \`${entry.path}\``,
    `Note path: ${notePath}`,
    '',
  ].join('\n')
}

/**
 * Write a file once, creating its directory, and never overwrite an existing one.
 *
 * The no-overwrite rule is what protects a draft a human edited or ratified: on every path
 * this module writes, an existing file is a human's or a previous run's and is left exactly as
 * it is.
 *
 * @param root - Absolute project root.
 * @param relativePath - Repository-relative path to write.
 * @param text - The text to write.
 * @returns `{ written, existed, error }`. `existed` is true when the file was already there and
 *   was left alone; `error` is set instead of `written` when the write failed.
 */
function writeOnce(root, relativePath, text) {
  const absolute = join(root, relativePath)
  if (existsSync(absolute)) return { written: null, existed: true, error: undefined }
  try {
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, text, 'utf8')
    return { written: relativePath, existed: false, error: undefined }
  } catch (error) {
    return { written: null, existed: false, error: `cannot write ${relativePath}: ${String(error)}` }
  }
}

/**
 * Renders the resolution that settles one contradiction, as a proposal.
 *
 * The record is ordinary in every respect — a source, a Reasoning section and a law list —
 * because the schema has no `type: resolution`. What makes it one is `resolves: [holder,
 * offender]` and the ONE-WAY way it takes force away, which ADR 0045 fixes: the `remove` arm
 * withdraws the redeclared law while the holder keeps everything else, and the `supersedes`
 * arm retires a proposal that only removes law in force. The `remove` arm is unusable for the
 * pure-removal offender: the resolution audit refuses it as `ADR_RESOLVES_OUTSIDE_FORCE`
 * because neither named record is leaving force, so that case is the `supersedes` arm.
 *
 * @param options - `{ id, offender, holder, lawIds, strategy, sourcePath, sourceHash, createdAt,
 *   draftKey, decisionsDir }`. `strategy` is `'remove'` or `'supersede'`.
 * @returns `{ filename, path, text, title }`.
 */
export function renderContradictionResolution({
  id,
  offender,
  holder,
  lawIds = [],
  strategy = 'remove',
  sourcePath,
  sourceHash,
  createdAt,
  draftKey = null,
  decisionsDir = 'docs/adrs',
}) {
  const laws = [...new Set((lawIds ?? []).filter((law) => typeof law === 'string' && law.length > 0))]
  const title =
    strategy === 'supersede'
      ? `Settle contradiction: retire ${offender.id}, keep ${holder.id}`
      : `Settle contradiction: withdraw ${laws.join(', ')} from ${holder.id}`
  const filename = `${id}-${slug(title)}.adr.md`
  const zones = [...new Set(offender.zones ?? [])]
  const lawLines =
    strategy === 'supersede'
      ? ['laws: []']
      : ['laws:', ...laws.flatMap((law) => ['  - op: remove', `    id: ${law}`])]
  const text = [
    '---',
    `id: "${id}"`,
    `title: ${title}`,
    'type: adr',
    // Proposed, always. The ratchet found the conflict; a human decides whether withdrawing the
    // law, or retiring the proposal that contested it, is the right settlement.
    'status: proposed',
    'author:',
    '  authority: agent',
    '  name: ratchet-drafts',
    `created: ${createdAt}`,
    'source:',
    '  kind: file',
    `  path: ${sourcePath}`,
    `  hash: ${sourceHash}`,
    'draft: true',
    ...(draftKey === null ? [] : [`draftKey: "${draftKey}"`]),
    ...(zones.length === 0 ? ['zones: []'] : ['zones:', ...zones.map((zone) => `  - ${zone}`)]),
    ...(strategy === 'supersede' ? ['supersedes:', `  - "${offender.id}"`] : ['supersedes: []']),
    'approves: []',
    'resolves:',
    `  - "${holder.id}"`,
    `  - "${offender.id}"`,
    ...lawLines,
    '---',
    '',
    '## Context',
    '',
    `ADR ${offender.id} (${offender.path}) contradicts law in force.`,
    '',
    ...(strategy === 'supersede'
      ? [`The proposal removes law in force rather than redeclaring it. A removal-shaped resolution cannot be`, 'audited against it, so this record retires the proposal and leaves the law in force.']
      : [`It redeclares ${laws.map((law) => `\`${law}\``).join(', ')} with a different statement, where ADR ${holder.id} put the in-force statement.`]),
    '',
    `- holder: ADR ${holder.id} — ${holder.title ?? '(no title)'} (${holder.path})`,
    `- offender: ADR ${offender.id} — ${offender.title ?? '(no title)'} (${offender.path})`,
    '',
    '## Decision',
    '',
    strategy === 'supersede'
      ? `ADR ${offender.id} is superseded. Law in force is untouched.`
      : `Law ${laws.map((law) => `\`${law}\``).join(', ')} is withdrawn. The offending redeclaration has nothing left to contest.`,
    '',
    '## Reasoning',
    '',
    'The compiler\'s decidable contradiction check found this conflict and no model decided it:',
    'a proposed record may not take away or rewrite what a human already put in force. The',
    'ratchet wrote this resolution itself, not an agent, and proposed it so a human can settle',
    'the conflict by consent rather than by an unrecorded edit.',
    '',
    '## Consequences',
    '',
    strategy === 'supersede'
      ? `- Ratifying this record retires ADR ${offender.id}; declining it leaves the proposal and its contradiction in place.`
      : `- Ratifying this record withdraws ${laws.map((law) => `\`${law}\``).join(', ')}; declining it leaves the contradiction in place.`,
    '- Deleting this file is the other way to decline, and nothing else in the corpus changes.',
    '',
  ].join('\n')
  return { filename, path: `${String(decisionsDir).replace(/\/+$/, '')}/${filename}`, text, title }
}

/**
 * The reasoning note a drafted contradiction resolution cites.
 *
 * The reasoning source must exist and hash to what the record cites, so the ratchet writes this
 * note itself — the resolution's justification is the ratchet's detection, not an agent's
 * prose — and cites it. The path is deterministic per offender/holder pair, and an existing
 * note is read rather than overwritten so a human's edit to it is never lost.
 *
 * @param options - `{ root, config, offender, holder, lawIds, strategy, draftKey, write }`.
 * @returns `{ path, hash, text, written, existed }` or `{ error }`.
 */
function contradictionSourceNote({ root, config, offender, holder, lawIds, strategy, draftKey, write }) {
  const sourcesDir = typeof config?.sourcesDir === 'string' && config.sourcesDir.length > 0 ? config.sourcesDir : 'docs/ratchet/sources'
  const path = `${sourcesDir.replace(/\/+$/, '')}/draft-${draftKey.replace(/[^A-Za-z0-9]+/g, '-')}.md`
  const text = [
    '# Drafted resolution reasoning',
    '',
    `The ratchet detected that ADR ${offender.id} (${offender.path}) contradicts law in force`,
    `held by ADR ${holder.id} (${holder.path}).`,
    '',
    `Conflicting law: ${[...new Set(lawIds)].map((law) => `\`${law}\``).join(', ') || '(none)'}`,
    `Settlement shape: ${strategy === 'supersede' ? `supersede ADR ${offender.id}` : `withdraw the conflicting law`}`,
    '',
    'This note was written by the RATCHET itself, not by an agent and not by a model. It exists',
    'so the drafted resolution cites the detection that produced it, and it is frozen with the',
    'resolution if a human ratifies that record.',
    '',
  ].join('\n')
  if (existsSync(join(root, path))) {
    const read = readSource(root, path)
    if (read.error !== undefined) return { error: read.error }
    return { path, hash: read.hash, text: read.text, written: null, existed: true }
  }
  if (write) {
    const outcome = writeOnce(root, path, text)
    if (outcome.error !== undefined) return { error: outcome.error }
  }
  return { path, hash: hashSource(text), text, written: write ? path : null, existed: false }
}

/**
 * Detect every contradiction a machine can decide and draft the resolution for it.
 *
 * @param context - `{ root, config, corpus, resolved, compiled, resolutions, write, createdAt }`,
 *   all produced by the caller from one consistent read of the corpus.
 * @returns `{ drafts, alreadyDrafted, undraftable, needs, problems }`.
 */
function draftContradictions({ root, config, corpus, resolved, compiled, resolutions, write, createdAt }) {
  const inForce = compileLaws(resolved.active, config)
  const inForceIds = new Set((inForce.bundle?.laws ?? []).map((law) => law.id))
  const draftedByKey = new Map(
    corpus.records
      .filter((record) => record !== null && typeof record === 'object' && record.draft === true && typeof record.draftKey === 'string')
      .map((record) => [record.draftKey, record]),
  )
  const existing = existingAdrIds(root, config.decisionsDir)
  const ids = [...existing.ids]
  const drafts = []
  const alreadyDrafted = []
  const undraftable = []
  const needs = []
  const problems = []

  // Group the conflicts by the PAIR a resolution names, because a resolution names exactly two
  // sides: one draft per offender/holder pair, however many laws the pair contests.
  const groups = new Map()
  for (const record of resolved.proposed) {
    const conflicts = decidableContradictions(record, inForce.bundle.laws, { resolutions })
    for (const conflict of conflicts) {
      const holderId = typeof conflict.inForceBy === 'string' && conflict.inForceBy.length > 0 ? conflict.inForceBy : null
      const groupKey = `${record.id}\n${holderId ?? 'none'}`
      if (!groups.has(groupKey)) groups.set(groupKey, { offender: record, holderId, conflicts: [] })
      groups.get(groupKey).conflicts.push(conflict)
    }
  }

  const holderById = new Map(corpus.records.map((record) => [record.id, record]))
  for (const group of groups.values()) {
    const { offender, holderId } = group
    const lawIds = [...new Set(group.conflicts.map((conflict) => conflict.lawId))]
    const why = group.conflicts.map((conflict) => conflict.why).join('; ')
    const base = { offenderId: offender.id, holderId, lawIds, why }

    // A record that already declares `resolves` IS a resolution; the ratchet drafts no second
    // one over it. It is reported so the human sees the conflict, with the reason no draft was
    // made.
    if (Array.isArray(offender.resolves) && offender.resolves.length > 0) {
      const reason = `ADR ${offender.id} already declares resolves ${JSON.stringify(offender.resolves)}, so it is a resolution itself rather than a plain proposal this pass may settle`
      undraftable.push({ ...base, reason })
      needs.push({ ...base, reason, draft: null, draftReason: reason })
      continue
    }
    const holder = holderId === null ? null : holderById.get(holderId)
    if (holder === null || holder === undefined) {
      const reason = `the conflict names no record holding the law in force, so there is no holder for a resolution to name alongside ADR ${offender.id}`
      undraftable.push({ ...base, reason })
      needs.push({ ...base, reason, draft: null, draftReason: reason })
      continue
    }
    const humanOnly = zonesForRecord(offender, config).filter((zone) => zone.agentAuthority === 'humanOnly')
    if (humanOnly.length > 0) {
      const reason = `ADR ${offender.id} declares zone "${humanOnly[0].id}", which is reserved to humans, so a drafted resolution could never be ratified by this path`
      undraftable.push({ ...base, reason })
      needs.push({ ...base, reason, draft: null, draftReason: reason })
      continue
    }

    // The one-way shape. An offender that only REMOVES law in force cannot be audited against
    // the removal arm — neither record is leaving force — so it is retired by supersession.
    const strategy = group.conflicts.some((conflict) => conflict.op === 'remove') ? 'supersede' : 'remove'

    // An AMENDMENT is a record that removes law in force AND restates the decision under a new
    // law id — the shape the lifecycle itself requires (ADR 0043 removed six laws and restated
    // them; ADR 0045 removed one and restated it). The ratchet must not draft a resolution whose
    // supersede arm would RETIRE the amendment, because the amendment IS the human's resolution:
    // nothing is drafted here, and the need says so. Enforcement is unchanged — the ratify queue
    // still reads the removal as a conflict and decides whether to put the record to a human.
    const removesInForce = group.conflicts.some((conflict) => conflict.op === 'remove')
    const restatesNewLaw = (offender.laws ?? []).some(
      (law) => law !== null && typeof law === 'object' && law.op !== 'remove' && typeof law.id === 'string' && !inForceIds.has(law.id),
    )
    if (removesInForce && restatesNewLaw) {
      const reason = `ADR ${offender.id} is an amendment: it removes law in force and restates the decision under a new law id, so the record itself is the resolution a human settles and the ratchet drafts no second one over it`
      undraftable.push({ ...base, reason })
      needs.push({ ...base, reason, draft: null, draftReason: reason })
      continue
    }

    const draftKey = contradictionDraftKey(offender.id, holderId)

    const existingDraft = draftedByKey.get(draftKey)
    if (existingDraft !== undefined) {
      alreadyDrafted.push({
        ...base,
        id: existingDraft.id,
        path: existingDraft.path,
        title: existingDraft.title,
        draftKey,
        strategy,
        status: existingDraft.status,
      })
      needs.push({ ...base, draft: { id: existingDraft.id, path: existingDraft.path }, draftReason: null })
      continue
    }

    const id = nextAdrId(ids)
    ids.push(id)
    const note = contradictionSourceNote({ root, config, offender, holder, lawIds, strategy, draftKey, write })
    if (note.error !== undefined) {
      problems.push({ code: 'ARTIFACT_WRITE_FAILED', severity: 'error', subject: null, message: note.error })
      undraftable.push({ ...base, reason: note.error })
      needs.push({ ...base, reason: note.error, draft: null, draftReason: note.error })
      continue
    }
    const rendered = renderContradictionResolution({
      id,
      offender,
      holder,
      lawIds,
      strategy,
      sourcePath: note.path,
      sourceHash: note.hash,
      createdAt: createdAt ?? new Date().toISOString(),
      draftKey,
      decisionsDir: config.decisionsDir,
    })
    const draft = {
      ...base,
      id,
      filename: rendered.filename,
      path: rendered.path,
      title: rendered.title,
      text: rendered.text,
      draftKey,
      strategy,
      status: 'proposed',
      written: null,
    }
    if (write) {
      const outcome = writeIngested(root, rendered)
      if (outcome.error !== undefined) {
        problems.push({ code: 'ARTIFACT_WRITE_FAILED', severity: 'error', subject: rendered.path, message: outcome.error })
        undraftable.push({ ...base, reason: outcome.error })
        needs.push({ ...base, reason: outcome.error, draft: null, draftReason: outcome.error })
        continue
      }
      draft.written = outcome.written
    }
    draftedByKey.set(draftKey, { id, path: rendered.path, title: rendered.title, status: 'proposed', draft: true, draftKey })
    drafts.push(draft)
    needs.push({ ...base, draft: { id, path: rendered.path }, draftReason: null })
  }

  return { drafts, alreadyDrafted, undraftable, needs, problems }
}

/**
 * Detect every stale generated document and draft its withdrawal note.
 *
 * @param context - `{ root, config, compiled, write }`.
 * @returns An array of `{ path, notePath, recorded, wanted, text, written, existed }`.
 */
function draftStaleNotes({ root, config, compiled, write }) {
  if (compiled.bundle === null) return []
  const rendered = renderSpecs(compiled.bundle, config.specsDir)
  const drift = detectSpecDrift(root, rendered.files, config.specsDir ?? null)
  const notes = []
  for (const entry of drift.stale ?? []) {
    const notePath = staleNotePath(config, entry.path)
    const text = renderStaleSpecNote(entry, notePath)
    const outcome = write ? writeOnce(root, notePath, text) : { written: null, existed: existsSync(join(root, notePath)), error: undefined }
    notes.push({
      path: entry.path,
      notePath,
      recorded: entry.recorded ?? null,
      wanted: entry.wanted ?? null,
      text,
      written: outcome.written,
      existed: outcome.existed === true,
      error: outcome.error ?? null,
    })
  }
  return notes
}

/**
 * The one drafting pass the ratchet runs on its own: detect the decidable issues and draft the
 * settlement for each, idempotently.
 *
 * @param root - Absolute project root.
 * @param options - `{ write, createdAt }`. `write:false` computes the drafts and returns their
 *   text without touching the project.
 * @returns The result described in this module's header. Never throws.
 */
export function draftNeedsHuman(root, { write = false, createdAt = null } = {}) {
  const empty = {
    ok: false,
    unusable: true,
    duplicates: { drafts: [], alreadyDrafted: [], undraftable: [], scanned: null },
    contradictions: { drafts: [], alreadyDrafted: [], undraftable: [], needs: [] },
    staleNotes: [],
    advisory: { specHash: null, findings: [], error: null },
    problems: [],
  }
  if (typeof root !== 'string' || root.length === 0) {
    return { ...empty, problems: [{ code: 'ROOT_INVALID', severity: 'error', subject: null, message: 'drafting needs an absolute project root' }] }
  }
  const manifest = readManifest(root)
  const config = manifest.config
  if (config === null || config.enabled !== true) {
    return { ...empty, problems: manifest.problems }
  }

  // Duplicates: the rule and the draft live in `ratchet-dedupe.mjs`, so this call is the whole
  // of the duplicate half and there is no second copy of the duplicate rule here. The advisory
  // `semantic_duplicate` findings a corpus review recorded are passed WITH the decidable ones,
  // so a duplicate only meaning reveals is drafted through the same path when the verdict named
  // enough to draft it and reported undraftable with the reason when it did not.
  const compiled = compileProject(root)
  const specHash = compiled.bundle === null ? null : bundleHash(compiled.bundle)
  const advisory = advisoryFindingsFor(root, specHash)
  const duplicates = draftResolutions(root, { write, createdAt, judgeFindings: advisory.findings })

  const corpus = readAdrCorpus(root, config)
  const resolved = resolveActiveSet(corpus.records, config)
  const resolutions = auditedResolutions(corpus.records, {
    active: resolved.active,
    removedByDecision: compiled.removedByDecision ?? [],
    problems: corpus.problems,
  })
  const contradictions = draftContradictions({
    root,
    config,
    corpus,
    resolved,
    compiled,
    resolutions,
    write,
    createdAt,
  })
  const staleNotes = draftStaleNotes({ root, config, compiled, write })

  return {
    ok: true,
    unusable: false,
    duplicates: {
      drafts: duplicates.drafts ?? [],
      alreadyDrafted: duplicates.alreadyDrafted ?? [],
      undraftable: duplicates.undraftable ?? [],
      scanned: duplicates.scanned ?? null,
    },
    contradictions,
    staleNotes,
    // The advisory corpus findings, bound to the law set they were recorded against. The
    // decisions view model reads `deprecated_decision` entries from here to raise a
    // `deprecated` need; the duplicate entries have already become drafts or undraftable
    // findings above, so the two paths never report one finding twice.
    advisory: { specHash, findings: advisory.findings, error: advisory.error },
    problems: [...(duplicates.problems ?? []), ...contradictions.problems],
  }
}
