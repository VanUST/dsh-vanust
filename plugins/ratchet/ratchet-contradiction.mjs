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
 *   `readContradictions(root)` — the recorded map, folded from the append-only ledger when it
 *   holds any contradiction event, and from the JSON cache otherwise. `{}` when neither holds one
 *   (an unreadable record is not a block: a guard that refuses work because its own state file is
 *   corrupt is a guard that gets switched off). Because the ledger wins once it has an event,
 *   deleting or hand-editing the JSON file does not lift a block.
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
 *   the zones the contradicted law is bound to, which the compiler unions across every record that
 *   declares it, plus the zones a rejected proposal itself named. A finding that names a law nobody
 *   declares blocks nothing, because the guard cannot place it and a refusal it cannot explain is
 *   worse than none.
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
 *   - A ledger whose contradiction events were deleted falls back to the JSON cache, so removing
 *     BOTH is the residual hole in a file-based record; removing one of the two is not.
 *   - A finding with no `lawId`, a `severity` other than `error`, or a kind outside the blocking
 *     vocabulary: not blocking.
 *   - An entry whose findings no longer name a law in force: dropped by `blockedZones` rather than
 *     carried as an unexplained block.
 *   - A proposal edited to a DIFFERENT text that still contradicts: the old entry stops standing
 *     and the next review records a new one against the new hash. The block follows the text.
 *   - Clearing the last entry removes the file, so an absent file and an empty one mean the same
 *     thing.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { hashSource } from './ratchet-schema.mjs'
import { appendLedger, readLedger } from './ratchet-state.mjs'

/** Where a recorded verdict lives. Machine-written, and inside the ratchet's own state dir. */
export const CONTRADICTION_PATH = '.dsh/ratchet/contradiction.json'

/**
 * The ledger events that make a block durable.
 *
 * The JSON file above is a cache a person can edit or delete; the ledger is append-only. A block
 * recorded only in the file was lifted by `rm .dsh/ratchet/contradiction.json` — the guard then saw
 * no contradiction and allowed the work the judge had just refused. Each record and each clear is
 * therefore also an event here, and `readContradictions` folds the ledger when it holds any, so
 * deleting the file changes nothing while the ledger survives.
 */
export const CONTRADICTION_RECORDED = 'ratchet.contradiction.recorded'
export const CONTRADICTION_CLEARED = 'ratchet.contradiction.cleared'

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
 * A proposal whose text matches a proposed record is identified by THAT RECORD, which is what makes
 * the block self-clearing: the record's content hash is the text the judge read, so editing the
 * record moves the hash and retires the finding.
 *
 * The match is by `contentHash`, computed with the same `hashSource` the corpus uses. It used to
 * compare a `text` field — which a corpus record does not carry — so the match was dead code and
 * every block silently became a material one, which is a block the prescribed loop can never retire.
 *
 * Anything else is identified by the REVIEW JOB, not by a hash of the material. That is deliberate:
 * keyed on the material, the block cannot be retired by doing what the refusal says, because the
 * agent changes the text, reviews the NEW text, and writes a different key while the old entry
 * stands for ever. Keyed on the job, the next independent review of that job replaces the entry —
 * blocking again if it is still wrong, clearing it if it is not.
 */
export function contradictionTarget({ job = null, proposal = null, change = null, source = null, records = [] } = {}) {
  const material = proposal ?? change ?? source ?? ''
  const wanted = hashSource(String(material))
  const match = (Array.isArray(records) ? records : []).find(
    (record) => record !== null && typeof record === 'object' && record.status === 'proposed' && record.contentHash === wanted,
  )
  if (match !== undefined) return { kind: 'proposal', id: match.id, hash: match.contentHash ?? null }
  return { kind: 'review', id: typeof job === 'string' && job !== '' ? job : 'review_change', hash: null }
}

/** The key one target is stored under. */
export function contradictionKey(target) {
  return `${target.kind}:${target.id}`
}

/** The file's own map, or `{}` when nothing is there or it cannot be read as one. */
function fileContradictions(root) {
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

/**
 * The recorded map, folded from the append-only ledger when it holds any contradiction event.
 *
 * The ledger is the authority once it has one event, because the JSON file is a cache a person can
 * edit or delete and the ledger is not rewritten. A ledger with no such event (a project recorded
 * before the events existed, or a file a human wrote) falls back to the file, so nothing that
 * worked before stops working. A malformed event is skipped rather than throwing.
 *
 * @param root - Project root.
 * @returns A map of contradiction key to entry.
 */
export function readContradictions(root) {
  const ledger = readLedger(root)
  const events = (ledger.events ?? []).filter(
    (entry) =>
      entry !== null &&
      typeof entry === 'object' &&
      (entry.event === CONTRADICTION_RECORDED || entry.event === CONTRADICTION_CLEARED),
  )
  if (events.length === 0) return fileContradictions(root)
  const entries = {}
  for (const event of events) {
    if (typeof event.key !== 'string') continue
    if (event.event === CONTRADICTION_CLEARED) delete entries[event.key]
    else if (event.entry !== null && typeof event.entry === 'object') entries[event.key] = event.entry
  }
  return entries
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
export function recordContradiction(root, { target, findings, job = null, at = null, replace = true } = {}) {
  const entries = readContradictions(root)
  const key = contradictionKey(target)
  // A SELF-REVIEW may raise a block and never REPLACE one. Overwriting an independent judge's
  // finding with the agent's own would lift the zone that finding blocked, silently and
  // deterministically, which is the bypass the two-caller rule exists to prevent.
  if (replace === false && entries[key] !== undefined) return entries[key]
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
  entries[key] = entry
  writeContradictions(root, entries)
  // The durable copy. A later `clearContradiction` appends a `cleared` event; until then deleting
  // or hand-editing the JSON file does not lift the block, because the fold reads this.
  appendLedger(root, CONTRADICTION_RECORDED, { key, at: entry.at, entry })
  return entry
}

/** Retires the entry for one target. Clearing a target nobody recorded changes nothing. */
export function clearContradiction(root, target) {
  const entries = readContradictions(root)
  const key = contradictionKey(target)
  if (entries[key] === undefined) return false
  delete entries[key]
  writeContradictions(root, entries)
  // The clear is itself a fact, and the ledger keeps it: folding a `recorded` event with no
  // matching `cleared` is exactly how a deleted JSON file used to become silent again.
  appendLedger(root, CONTRADICTION_CLEARED, { key })
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
    // A job-scoped entry stands until a later independent review of that job replaces it. There is
    // no artifact whose change could retire it, which is why the review job — the stream the agent
    // is iterating — is its identity.
    standing.push({ key, entry })
  }
  return standing
}

/**
 * The paths a law's own checks claim, as globs.
 *
 * A zone is a coarse area; a law inside it may govern a narrower set of paths. This reads the
 * path-scoped check types the corpus defines and returns the globs they spell, so a caller can
 * decide whether a given path is one the law is actually about.
 *
 * @param law - A compiled law, `{ checks }`, or anything at all.
 * @returns An array of glob strings; empty when the law makes no path claim, when `law` is null,
 *   when `checks` is not an array, or when a check is malformed. Never throws on bad input.
 */
export function lawPathClaims(law) {
  const globs = []
  for (const check of Array.isArray(law?.checks) ? law.checks : []) {
    if (check === null || typeof check !== 'object') continue
    if (check.type === 'required_glob' || check.type === 'forbidden_glob') {
      if (typeof check.pattern === 'string' && check.pattern.length > 0) globs.push(check.pattern)
    } else if (check.type === 'path_boundary') {
      for (const deny of Array.isArray(check.deny) ? check.deny : []) {
        if (typeof deny === 'string' && deny.length > 0) globs.push(deny)
      }
    }
  }
  return globs
}

/**
 * The zones a set of standing entries blocks, each with the paths the finding reaches.
 *
 * @param entries - Standing entries, each `{ entry: { target, findings } }`.
 * @param options.active - In-force records, for the zones a contradicted law governs.
 * @param options.proposed - Proposed records, for the zones a rejected proposal named.
 * @param options.laws - The compiled law bundle, for `lawId` to `sourceAdr`.
 * @returns A `Map` from zone id to either `null` — the whole zone, which is what a law with no
 *   path claim blocks — or a `Set` of globs, when every contradicted law in that zone made a
 *   path claim and only a path matching one of them is refused.
 */
export function blockedScopes(entries, { active = [], proposed = [], laws = [] } = {}) {
  const zonesByRecord = new Map()
  for (const record of [...(active ?? []), ...(proposed ?? [])]) {
    if (record !== null && typeof record === 'object' && typeof record.id === 'string') zonesByRecord.set(record.id, record.zones ?? [])
  }
  const lawById = new Map()
  for (const law of laws ?? []) {
    if (law !== null && typeof law === 'object' && typeof law.id === 'string') lawById.set(law.id, law)
  }
  const scopes = new Map()
  // `null` is the whole zone and is absorbing: once one finding blocks every path in a zone, a
  // later narrower finding cannot narrow it back. A `Set` accumulates the globs of every narrower
  // finding, so a zone is refused where ANY contradicted law in it reaches.
  const addZone = (zone, globs) => {
    if (globs.length === 0) {
      scopes.set(zone, null)
      return
    }
    if (scopes.has(zone) && scopes.get(zone) === null) return
    const current = scopes.has(zone) ? scopes.get(zone) : new Set()
    for (const glob of globs) current.add(glob)
    scopes.set(zone, current)
  }
  for (const { entry } of Array.isArray(entries) ? entries : []) {
    // `findings` is read from a FILE, so it can be anything: a number, an object, a list with a
    // null in it. `?? []` does not guard a non-iterable, and iterating it threw — which the guard's
    // catch-all turned into an ALLOW, so a corrupt record BYPASSED the very block it recorded. A
    // malformed finding is skipped; the well-formed ones around it still block.
    const findings = entry !== null && typeof entry === 'object' && Array.isArray(entry.findings) ? entry.findings : []
    for (const finding of findings) {
      if (finding === null || typeof finding !== 'object') continue
      const law = lawById.get(finding.lawId)
      if (law === undefined) continue
      // The law's OWN zones, which the compiler unions across every record that declares it. Using
      // the source record's zones blocked only the first declarer: a law in force in two zones left
      // the second unguarded. A caller whose law objects carry no `zones` still gets the record's.
      const bound = Array.isArray(law.zones) && law.zones.length > 0 ? law.zones : zonesByRecord.get(law.sourceAdr) ?? []
      // The law's own path claim narrows the block to the paths the finding is about. A law that
      // governs `src/org/alpha/**` refuses a write there, not a write beside it in the same zone:
      // a block that stops work its finding says nothing about destroys trust in the block itself.
      const claims = lawPathClaims(law)
      for (const zone of bound) addZone(zone, claims)
    }
    if (entry !== null && typeof entry === 'object' && entry.target !== null && typeof entry.target === 'object' && entry.target.kind === 'proposal') {
      // A rejected PROPOSAL names zones and no path claim of its own, so it blocks the whole zone.
      for (const zone of zonesByRecord.get(entry.target.id) ?? []) addZone(zone, [])
    }
  }
  return scopes
}

/**
 * The zones a set of standing entries blocks.
 *
 * @param entries - Standing entries, each `{ entry: { target, findings } }`.
 * @param options.active - In-force records, for the zones a contradicted law governs.
 * @param options.proposed - Proposed records, for the zones a rejected proposal named.
 * @param options.laws - The compiled law bundle, for `lawId` to `sourceAdr`.
 * @returns A `Set` of zone ids. The path scope of each is `blockedScopes`, for a caller that can
 *   place the path it is about to write.
 */
export function blockedZones(entries, { active = [], proposed = [], laws = [] } = {}) {
  return new Set(blockedScopes(entries, { active, proposed, laws }).keys())
}
