/**
 * PURPOSE
 *   Turn a judge's semantic verdict into a BLOCKING fact. A deterministic guard can see a
 *   contradiction written as a removal or a redeclared law id, and nothing else; a contradiction
 *   that only a reader can see — a change that honours the letter of a law while inverting what
 *   the decision was for — had no enforcement point at all, so the guarantee "no drift in the
 *   logic" was prose. This module records such a verdict and says whether it still stands, which
 *   is what lets a pre-execute guard refuse the work and hand the judge's reasoning back to the
 *   agent that proposed it.
 *
 *   It is a separate module because the two halves live in different processes of the same call
 *   path: `ratchet-ops.mjs` WRITES a verdict here when a review runs, and `ratchet-guard.mjs`
 *   READS it before every write. Neither imports the harness, and both reach this file.
 *
 * INPUTS
 *   A root, and — when recording — the validated verdict findings, the review job, and the
 *   material the judge read (`proposal`, `change`, `source`). When reading, the resolved corpus
 *   (`{ active, proposed }`) and the compiled law bundle, so a recorded finding can be checked
 *   against the corpus as it is NOW.
 *
 * OUTPUTS
 *   `blockingFindings(findings)` — the findings that mean "this contradicts a decision in
 *   meaning": `severity === 'error'`, a `kind` in `BLOCKING_FINDING_KINDS`, and a `lawId`.
 *   Everything else a judge may say — a note, a prose/law mismatch inside one record, a gap in
 *   the reasoning, a conflict between two laws that is the corpus's problem rather than the
 *   change's — is advisory and blocks nothing.
 *
 *   `readContradictions(root)` — the recorded map, or `{}` when nothing is recorded or the file
 *   is unreadable (an unreadable record is not a block: a guard that refuses work because its own
 *   state file is corrupt is a guard that gets switched off).
 *
 *   `standingContradictions(root, { resolved })` — the entries that still stand. An entry bound to
 *   a PROPOSED record stops standing the moment that record is edited (its content hash moves),
 *   or is no longer proposed (ratified, withdrawn, rejected or gone): the judge's finding was
 *   about a text that is no longer the one on disk, and a block on a text nobody can point at is
 *   a block that can never be cleared. An entry bound to judged MATERIAL (a diff, a source, a
 *   change with no record behind it) stands until a later review of that same material clears it,
 *   because there is no other artifact whose change could clear it.
 *
 *   `blockedZones(entries, { active, proposed, laws })` — the zone ids a standing entry blocks:
 *   the zones of the records that put each contradicted law in force, plus the zones a rejected
 *   proposal itself named. A finding that names a law nobody declares blocks nothing, because the
 *   guard cannot place it and a refusal it cannot explain is worse than none.
 *
 *   Every output is a plain value; nothing here throws on malformed input.
 *
 * KEYWORDS
 *   contradiction, semantic violation, judge verdict, blocking gate, drift, guard, standing,
 *   self-clearing, content hash, zones, review
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No recorded file, an unreadable one, or JSON that is not an object of entries: `{}` — never
 *     a throw and never a block.
 *   - A finding with no `lawId`, a `severity` other than `error`, or a kind outside the blocking
 *     vocabulary: not blocking.
 *   - An entry whose findings no longer name a law in force: dropped by `blockedZones` rather than
 *     carried as an unexplained block.
 *   - A proposal edited to a DIFFERENT text that still contradicts: the old entry stops standing
 *     and the next review records a new one against the new hash. The block follows the text.
 *   - Clearing the last entry removes the file, so an absent file and an empty one mean the same
 *     thing.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Where a recorded verdict lives. Machine-written, and inside the ratchet's own state dir. */
export const CONTRADICTION_PATH = '.dsh/ratchet/contradiction.json'

/**
 * The finding kinds that mean "this change contradicts a decision in meaning".
 *
 * A closed list, deliberately. `incompatible_checks` and `incoherent_corpus` describe the CORPUS
 * disagreeing with itself — a problem for a human to settle, not for the agent that happened to
 * trigger the review to fix by editing its change. `prose_law_mismatch` is one record's prose
 * against its own laws. `insufficient_reasoning` asks for more reasoning. None of those is the
 * change contradicting law in force, and treating them as blocks would refuse work nobody has
 * shown to be wrong.
 */
export const BLOCKING_FINDING_KINDS = Object.freeze(['semantic_violation', 'intent_violation'])

/** The findings in one verdict that block: an error, a blocking kind, and a named law. */
export function blockingFindings(findings) {
  return (Array.isArray(findings) ? findings : []).filter(
    (finding) =>
      finding !== null &&
      typeof finding === 'object' &&
      finding.severity === 'error' &&
      BLOCKING_FINDING_KINDS.includes(finding.kind) &&
      typeof finding.lawId === 'string' &&
      finding.lawId !== '',
  )
}

/**
 * What the judge judged, so a later corpus can say whether the finding still applies.
 *
 * A proposal that matches a proposed record in the corpus is identified by THAT RECORD, which is
 * what makes the block self-clearing: the record's content hash is the text the judge read, and
 * editing the record moves the hash and retires the finding. Anything else is identified by a hash
 * of the material itself.
 */
export function contradictionTarget({ proposal = null, change = null, source = null, records = [] } = {}) {
  const material = proposal ?? change ?? source ?? ''
  const text = String(material).trim()
  const match = (Array.isArray(records) ? records : []).find(
    (record) => record !== null && typeof record === 'object' && record.status === 'proposed' && typeof record.text === 'string' && record.text.trim() === text,
  )
  if (match !== undefined) return { kind: 'proposal', id: match.id, hash: match.contentHash ?? null }
  return { kind: 'material', id: createHash('sha256').update(String(material)).digest('hex').slice(0, 32), hash: null }
}

/** The key one target is stored under. */
export function contradictionKey(target) {
  return `${target.kind}:${target.id}`
}

/** The recorded map, or `{}` when nothing is recorded or the file cannot be read as one. */
export function readContradictions(root) {
  const path = join(root, CONTRADICTION_PATH)
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const entries = parsed === null || typeof parsed !== 'object' ? null : parsed.entries
    return entries !== null && typeof entries === 'object' ? entries : {}
  } catch {
    return {}
  }
}

/** Writes the map, or removes the file when it is empty. */
function writeContradictions(root, entries) {
  const path = join(root, CONTRADICTION_PATH)
  if (Object.keys(entries).length === 0) {
    rmSync(path, { force: true })
    return
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`)
}

/**
 * Records one blocking verdict against the material it judged, replacing any earlier entry for
 * the same target. A later review of the same target therefore supersedes the earlier one, which
 * is how a material-targeted finding is cleared.
 *
 * @returns The entry that was written.
 */
export function recordContradiction(root, { target, findings, job = null, at = null } = {}) {
  const entries = readContradictions(root)
  const entry = {
    job,
    at: at ?? new Date().toISOString(),
    target,
    findings: blockingFindings(findings).map((finding) => ({
      severity: finding.severity,
      kind: finding.kind,
      lawId: finding.lawId,
      ...(finding.sourceAdr === undefined ? {} : { sourceAdr: finding.sourceAdr }),
      explanation: finding.explanation,
      ...(finding.suggestedAction === undefined ? {} : { suggestedAction: finding.suggestedAction }),
    })),
  }
  entries[contradictionKey(target)] = entry
  writeContradictions(root, entries)
  return entry
}

/** Retires the entry for one target. Clearing a target nobody recorded changes nothing. */
export function clearContradiction(root, target) {
  const entries = readContradictions(root)
  const key = contradictionKey(target)
  if (entries[key] === undefined) return false
  delete entries[key]
  writeContradictions(root, entries)
  return true
}

/**
 * The entries that still stand for the corpus as it is now.
 *
 * @param root - Project root.
 * @param options.resolved - `{ active, proposed }` from `resolveActiveSet`.
 * @returns An array of `{ key, entry }`, in a stable order.
 */
export function standingContradictions(root, { resolved = null } = {}) {
  const entries = readContradictions(root)
  const standing = []
  for (const key of Object.keys(entries).sort()) {
    const entry = entries[key]
    if (entry === null || typeof entry !== 'object') continue
    const target = entry.target
    if (target === null || typeof target !== 'object') continue
    if (target.kind === 'proposal') {
      const record = (resolved?.proposed ?? []).find((candidate) => candidate.id === target.id)
      // Gone, ratified, withdrawn — or edited, which moves the hash the judge's finding was
      // about. Either way the finding is about a text nobody can point at any more.
      if (record === undefined) continue
      if (target.hash !== null && record.contentHash !== target.hash) continue
    }
    standing.push({ key, entry })
  }
  return standing
}

/**
 * The zones a set of standing entries blocks.
 *
 * @param entries - Standing entries, each `{ entry: { target, findings } }`.
 * @param options.active - In-force records, for the zones a contradicted law governs.
 * @param options.proposed - Proposed records, for the zones a rejected proposal named.
 * @param options.laws - The compiled law bundle, for `lawId` to `sourceAdr`.
 * @returns A `Set` of zone ids.
 */
export function blockedZones(entries, { active = [], proposed = [], laws = [] } = {}) {
  const zonesByRecord = new Map()
  for (const record of [...(active ?? []), ...(proposed ?? [])]) {
    if (record !== null && typeof record === 'object' && typeof record.id === 'string') zonesByRecord.set(record.id, record.zones ?? [])
  }
  const sourceByLaw = new Map()
  for (const law of laws ?? []) {
    if (law !== null && typeof law === 'object' && typeof law.id === 'string') sourceByLaw.set(law.id, law.sourceAdr)
  }
  const zones = new Set()
  for (const { entry } of entries ?? []) {
    for (const finding of entry?.findings ?? []) {
      const source = sourceByLaw.get(finding.lawId)
      if (source === undefined) continue
      for (const zone of zonesByRecord.get(source) ?? []) zones.add(zone)
    }
    if (entry?.target?.kind === 'proposal') {
      for (const zone of zonesByRecord.get(entry.target.id) ?? []) zones.add(zone)
    }
  }
  return zones
}
