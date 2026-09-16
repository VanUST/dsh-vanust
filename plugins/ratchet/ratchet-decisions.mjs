/**
 * PURPOSE
 *   The ratchet's host-side DECISIONS SERVICE: the one seam a non-agent surface (the
 *   ADR panel's host half) uses to obtain the complete STATE of a project's decision
 *   corpus for display. It exists so the window never derives a decision's force,
 *   matches a consent against a content hash, or assembles a ratify queue of its own:
 *   this module computes none of those rules, it CALLS the functions that already hold
 *   them (`compileProject`, `readManifest`, `readAdrCorpus`, `resolveActiveSet`,
 *   `zonesForRecord`, `renderSpecs`, `detectSpecDrift`, `ratificationQueue`) and shapes
 *   their facts into one view model.
 *
 *   The service is a cordis service value, not a tool: `ratchet-tools.mjs` provides it
 *   under {@link DECISIONS_SERVICE}, and the only caller in this kit is the ADR panel's
 *   HTTP route, which sits behind the browser trust fence and a per-activation
 *   capability. No tool, no CLI verb and no command argument reaches it, which is what
 *   keeps the agent-facing surface free of a state reader.
 *
 *   There is exactly ONE source of truth for every fact it returns. If a fact is a
 *   ratchet rule — is this record in force, which approval proved it, which record
 *   superseded it, what waits for a human and why — the function above computes it and
 *   this module copies it. The display state a row is drawn with (`state`/`provenance`)
 *   is a mapping over those facts with no rule of its own: it chooses a label and a
 *   tone from `inForce`, `approvedBy`, `supersededBy`, `status` and the queue's own
 *   blocked reason.
 *
 * INPUTS
 *   `derive({ root })` — `root` is an absolute project root (string). Any other value
 *   yields an empty, unusable view rather than an exception.
 *
 * OUTPUTS
 *   `derive` returns a plain JSON-serializable object:
 *     - `ok` — true when the project's manifest is usable and readable.
 *     - `root` — the root the view was derived for.
 *     - `project` — `{ name, decisionsDir, specsDir }`, resolved from the manifest with
 *       the ratchet's own defaults.
 *     - `specHash` — the compiled bundle's hash, or null when nothing compiled.
 *     - `records` — every parsed decision, in corpus order. Each carries its identity
 *       (`id`, `path`, `title`, `type`, `status`, `authority`, `authorName`, `created`,
 *       `zones`, `supersedes`, `approves`), its source provenance (`source.hash`,
 *       `source.path`), its status facts (`contentHash`, `ratificationChannel`,
 *       `inForce`, `approvedBy`, `supersededBy`), its queue membership
 *       (`queue: 'waiting'|'blocked'|null`, `blockedReason`, `canRatify`), its display
 *       view (`state: { text, kind, derived }`, `provenance`), its declared law ids
 *       (`laws: [string]`) and its whole file `text` (or null when unreadable).
 *     - `queue` — the ratchet's own `ratificationQueue` result: `ok`, `pending`
 *       (`id`/`title`/`path`/`contentHash`/`laws`) and `blocked` (`id`/`path`/`reason`).
 *     - `specs` — the generated spec documents from `renderSpecs`:
 *       `[{ path, name, text, specHash }]`, one per zone.
 *     - `drift` — the `detectSpecDrift` result for those documents.
 *     - `needsHuman` — the ONE derived set of things a human must settle, each
 *       `{ kind, id, title, path, reason, action }` with `kind` one of `consent`,
 *       `contradiction`, `duplicate`, `stale-spec`, `red-gate`. Every entry is the
 *       ratchet's own fact, copied or shaped, never a second rule: consents from
 *       `ratificationQueue.pending`, contradictions from the guard's decidable
 *       `loadDecisionState().conflictsByZone`, duplicates from `findDuplicates` and
 *       the draft `draftResolutions` makes, stale specs from `detectSpecDrift`, and
 *       the red gate from the persisted verify report/state read with `readJsonArtifact`
 *       and `readState`. When a finding has no draft behind it, `action` says so rather
 *       than naming one that does not exist.
 *     - `problems` — every problem the manifest, the corpus and the queue reported,
 *       so a caller can show why a project is not green.
 *   A null/empty `root` returns `{ ok:false, root, records:[], queue:{...empty}, specs:[],
 *   drift:{...empty}, needsHuman:[], problems:[MANIFEST_MISSING-like] }` and never throws.
 *
 * KEYWORDS
 *   decisions service, cordis service, host route, ADR panel, view model, in force,
 *   consent match, ratify queue, spec documents, one source of truth, needs a human,
 *   contradiction, duplicate, stale spec, red gate
 *
 * BEHAVIOUR ON EDGE CASES
 *   - `root` not a string, or empty: an unusable view with the reason, no read.
 *   - No manifest: `ok:false`, every record list empty, the manifest's own problem.
 *   - A manifest that declares `enabled: false`: `ok:false` with `RATCHET_DISABLED`,
 *     but the corpus is still read so a viewer can show the records it holds.
 *   - A decisions directory that does not exist or holds no parseable record: the
 *     corpus problems are returned; `records` is empty.
 *   - A record file that cannot be read for display: its `text` is null and it is
 *     still listed with the facts the compiler derived.
 *   - The bundle does not compile: `specs` is empty and `specHash` is null, but the
 *     per-record force facts are still returned because `resolveActiveSet` runs.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileProject, readAdrCorpus, readManifest, renderSpecs, resolveActiveSet, zonesForRecord } from './ratchet-compiler.mjs'
import { ratificationQueue } from './ratchet-ratify.mjs'
import { detectSpecDrift, readJsonArtifact, readState, STATE_PATHS, verificationStatus } from './ratchet-state.mjs'
import { draftResolutions } from './ratchet-dedupe.mjs'
import { loadDecisionState } from './ratchet-guard.mjs'
import { findRoot } from './ratchet-ops.mjs'

/**
 * The cordis service name the panel's host half reaches with `ctx.get`.
 *
 * One value, duplicated in the ADR panel because a cordis service name cannot be
 * imported across a package boundary this deployment packs independently (the ratchet
 * and the panel are two tarballs with no dependency between them). The ADR panel
 * declares the literal itself and `scripts/check-consent-surface.mjs` fails when the two
 * copies stop being equal, which is the only thing that keeps them honest — the same
 * arrangement as `CONSENT_SERVICE`, and for the same reason.
 */
export const DECISIONS_SERVICE = 'ratchetDecisions'

/**
 * The tone kind a frontmatter status maps to, matching the panel's own vocabulary.
 *
 * A pure table over a status string; it derives no force. `active` and `in force` share
 * the success tone, `proposed` is the warn tone, a terminal supersession is muted, and
 * rejection/withdrawal are errors. An unknown status is `unknown`, which renders in the
 * warn tone rather than as a silent neutral.
 *
 * @param status - A record's declared status, or any value.
 * @returns One of `active`, `pending`, `superseded`, `rejected`, `withdrawn`, `unknown`.
 */
function stateKindOfStatus(status) {
  if (status === 'active') return 'active'
  if (status === 'proposed') return 'pending'
  if (status === 'superseded') return 'superseded'
  if (status === 'rejected' || status === 'withdrawn') return status
  return 'unknown'
}

/**
 * PURPOSE
 *   Compute the display state and provenance of one non-approval record from the force
 *   facts the ratchet already derived. The mapping has no rule of its own: it reads
 *   `inForce`, `approvedBy`, `supersededBy` and `status` (all set by `resolveActiveSet`)
 *   and the queue's own blocked reason, and selects a label and a tone.
 *
 * INPUTS
 *   record - a parsed record that `resolveActiveSet` has visited, so it carries
 *     `inForce`, `approvedBy` and `supersededBy`.
 *   blockedReason - the reason `ratificationQueue` gave for this record, or null.
 *
 * OUTPUTS
 *   `{ state: { text, kind, derived }, provenance: { text, kind, link } | null }`.
 *   `derived` is true only when the state was computed from ANOTHER record rather than
 *   read from this one's frontmatter (a supersession, or force granted by a consent for
 *   a record whose own status is not active). A superseded record leads; a terminal
 *   rejected/withdrawn record next; an in-force record shows its provenance; a record
 *   the queue reports blocked names the reason; a record that waits shows the waiting
 *   state; a human-authored proposed record is `not in force` because its authorship
 *   already carries the authority a question would ask it to grant. Never throws; a
 *   record missing a field falls through to the status label or `unknown`.
 *
 * KEYWORDS
 *   display state, provenance, in force, superseded, blocked, awaiting a human,
 *   view model, tone kind
 */
function displayedState(record, blockedReason) {
  if (record.supersededBy !== null && record.supersededBy !== undefined) {
    return {
      state: { text: `superseded by ${record.supersededBy}`, kind: 'superseded', derived: true },
      provenance: null,
    }
  }
  if (record.status === 'rejected' || record.status === 'withdrawn') {
    return { state: { text: record.status, kind: stateKindOfStatus(record.status), derived: false }, provenance: null }
  }
  if (record.inForce === true) {
    let provenance = null
    if (record.approvedBy !== null && record.approvedBy !== undefined) {
      provenance = { text: `ratified by ${record.approvedBy}`, kind: 'ratified', link: [record.approvedBy] }
    } else if (record.authority === 'human') {
      provenance = { text: 'human-authored', kind: 'human', link: null }
    } else if (record.authority === 'agent') {
      provenance = { text: 'agent-activated', kind: 'pending', link: null }
    }
    return {
      state: { text: 'in force', kind: 'in-force', derived: !(record.status === 'active') },
      provenance,
    }
  }
  if (typeof blockedReason === 'string' && blockedReason.length > 0) {
    return { state: { text: `blocked \u2014 ${blockedReason}`, kind: 'neutral', derived: false }, provenance: null }
  }
  if (record.canRatify === true) {
    if (record.status === 'active') {
      return {
        state: { text: 'not in force \u2014 this record needs a human ratification', kind: 'pending', derived: false },
        provenance: null,
      }
    }
    return { state: { text: 'awaiting a human', kind: 'pending', derived: false }, provenance: null }
  }
  if (record.status === 'proposed') {
    // Only an agent record is in the queue; a human-authored proposed record carries its
    // own authority and awaits its author's activation, not a consent.
    return { state: { text: 'not in force', kind: 'neutral', derived: false }, provenance: null }
  }
  const unknown = record.status === null || record.status === '' ? 'unknown' : record.status
  return { state: { text: unknown, kind: stateKindOfStatus(unknown), derived: false }, provenance: null }
}

/**
 * PURPOSE
 *   Drop duplicate problems from a view model's list.
 *
 *   The view is composed from several ratchet functions that each read the corpus
 *   (`compileProject` compiles it; `readAdrCorpus`/`resolveActiveSet` derive the
 *   per-record facts; `ratificationQueue` reads it again), so one malformed record can be
 *   reported by more than one of them. The window shows these problems as notes, and one
 *   problem repeated is noise rather than a second fact, so identical code+message pairs
 *   are collapsed. Order is preserved: the first occurrence wins.
 *
 * INPUTS
 *   problems — an array of `{ code, message, ... }` problem records, or anything.
 *
 * OUTPUTS
 *   A new array with the duplicate code+message pairs removed in first-seen order.
 *   A non-array input yields `[]`. Entries that are not objects are stringified for the
 *   key but returned as they were, so nothing a caller passed is lost.
 *
 * KEYWORDS
 *   problems, dedupe, view model, logs, noise
 */
function dedupeProblems(problems) {
  if (!Array.isArray(problems)) return []
  const seen = new Set()
  const out = []
  for (const entry of problems) {
    const code = entry !== null && typeof entry === 'object' && typeof entry.code === 'string' ? entry.code : ''
    const message = entry !== null && typeof entry === 'object' && typeof entry.message === 'string' ? entry.message : String(entry)
    const key = `${code}\n${message}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
  }
  return out
}

/**
 * PURPOSE
 *   Find a corpus record's display title by id, so a needs-human entry names the thing
 *   it concerns without this module inventing a title. A record the corpus does not
 *   contain contributes its id, and an empty id contributes null.
 *
 * INPUTS
 *   records - the view model's per-record list (`{ id, title, path }`), or anything.
 *   id - a record id, or null/undefined.
 *
 * OUTPUTS
 *   The record's `title` when the record is present and titled, else the id when it is
 *   a non-empty string, else null. Never throws; a non-array `records` yields the id.
 *
 * KEYWORDS
 *   needs a human, title, record lookup, view model
 */
function titleOf(records, id) {
  if (typeof id !== 'string' || id.length === 0) return null
  const list = Array.isArray(records) ? records : []
  const record = list.find((entry) => entry !== null && typeof entry === 'object' && entry.id === id)
  if (record !== undefined && typeof record.title === 'string' && record.title.length > 0) return record.title
  return id
}

/**
 * PURPOSE
 *   Find a corpus record's repository-relative path by id, so a needs-human entry can
 *   point the window at the record's own row. The lookup is display-only: no force is
 *   decided here.
 *
 * INPUTS
 *   records - the view model's per-record list (`{ id, path }`), or anything.
 *   id - a record id, or null/undefined.
 *
 * OUTPUTS
 *   The record's `path` when present and non-empty, else null. Never throws.
 *
 * KEYWORDS
 *   needs a human, path, record lookup, view model
 */
function pathOf(records, id) {
  if (typeof id !== 'string' || id.length === 0) return null
  const list = Array.isArray(records) ? records : []
  const record = list.find((entry) => entry !== null && typeof entry === 'object' && entry.id === id)
  return record !== undefined && typeof record.path === 'string' && record.path.length > 0 ? record.path : null
}

/**
 * PURPOSE
 *   Read the RED-GATE fact from the persisted verification artifacts, never by running
 *   verify again. A recorded verdict that found problems, or one that no longer covers
 *   the current laws, is a gate a human must look at; a project that has never recorded
 *   a verification is not reported as red, because "never run" is not "failed".
 *
 * INPUTS
 *   root - an absolute project root (string).
 *   currentSpecHash - the hash `compileProject` just computed, or null.
 *
 * OUTPUTS
 *   One `{ kind:'red-gate', id:'verify', title, path, reason, action }` entry, or null
 *   when the persisted report and state record no red verdict and the recorded run
 *   still covers the current laws. Never throws; an unreadable or missing artifact is
 *   treated as no recorded verdict.
 *
 * KEYWORDS
 *   red gate, verify report, verify state, verification status, artifact fact
 */
function redGateNeed(root, currentSpecHash) {
  const reportPath = STATE_PATHS.verifyReport
  const report = readJsonArtifact(root, reportPath)
  const reportProblems =
    report.value !== undefined && report.value !== null && Array.isArray(report.value.problems) ? report.value.problems : null
  if (reportProblems !== null && reportProblems.length > 0) {
    const count = reportProblems.length
    return {
      kind: 'red-gate',
      id: 'verify',
      title: `the last recorded verification found ${count} problem${count === 1 ? '' : 's'}`,
      path: reportPath,
      reason: `${reportPath} records ${count} problem${count === 1 ? '' : 's'} from the last verification`,
      action: `no drafted fix exists \u2014 read ${reportPath}, fix what it names, and re-run "ratchet verify"`,
    }
  }
  const state = readState(root)
  const last = state.value !== undefined && state.value !== null && typeof state.value === 'object' ? state.value.lastVerify : null
  if (last !== null && last !== undefined && last.ok === false) {
    const errors = typeof last.errors === 'number' ? last.errors : null
    return {
      kind: 'red-gate',
      id: 'verify',
      title: 'the last recorded verification was not green',
      path: STATE_PATHS.state,
      reason: `${STATE_PATHS.state} records the last verification at ${typeof last.at === 'string' ? last.at : '(an unknown time)'} as not ok${errors === null ? '' : ` (${errors} problem${errors === 1 ? '' : 's'})`}`,
      action: `no drafted fix exists \u2014 fix what ${reportPath} names and re-run "ratchet verify"`,
    }
  }
  const status = verificationStatus(root, currentSpecHash)
  if (status.stale === true) {
    return {
      kind: 'red-gate',
      id: 'verify',
      title: 'the last recorded verification does not cover the current laws',
      path: STATE_PATHS.state,
      reason: status.reason,
      action: 'no drafted fix exists \u2014 re-run "ratchet verify" against the current laws and the current code',
    }
  }
  return null
}

/**
 * PURPOSE
 *   Derive the ONE set of things a human must settle from the ratchet's own facts, so
 *   the ADR window has a single entry point instead of five separate silences. Every
 *   entry is copied or shaped from a function that already holds the rule; this module
 *   invents no finding, and when a finding has no draft behind it the `action` says so
 *   rather than naming one that does not exist.
 *
 * INPUTS
 *   root - an absolute project root (string).
 *   records - the view model's per-record list, for titles and paths.
 *   queue - the `ratificationQueue` result (`pending`, `blocked`).
 *   drift - the `detectSpecDrift` result (`drifted`, `stale`, `missing`, `orphaned`).
 *   currentSpecHash - the compiled bundle's hash, or null, for the red-gate fact.
 *
 * OUTPUTS
 *   An array, ordered consents, contradictions, duplicates, stale specs, red gate.
 *   Each entry is `{ kind, id, title, path, reason, action }`, `kind` one of the five
 *   names. An empty project yields `[]`. Never throws: a guard, drafter or artifact
 *   read that fails contributes no entry rather than an exception.
 *
 * KEYWORDS
 *   needs a human, consent, contradiction, duplicate, stale spec, red gate, entry point
 */
function buildNeedsHuman(root, records, queue, drift, currentSpecHash) {
  const needs = []

  // (1) A consent WAITING to be answered, from the ratchet's own queue. A blocked
  // decision is deliberately absent: it is not waiting for anyone — see the queue's
  // own `blocked` reason.
  for (const entry of queue.pending ?? []) {
    needs.push({
      kind: 'consent',
      id: entry.id,
      title: entry.title ?? titleOf(records, entry.id) ?? entry.id,
      path: entry.path ?? pathOf(records, entry.id),
      reason: 'the ratchet\u2019s ratification queue lists this decision as waiting for a human: a "yes" settles it',
      action: 'use Approve or Decline in its row below',
    })
  }

  // (2) A contradiction between a proposal and law in force, from the guard's own
  // DECIDABLE computation. The conflict appears once per zone the record names, so
  // identical record+law pairs are collapsed. The FIX is the ratify queue's own blocked
  // reason for the same record — the sentence `contradictionBlockReason` builds, which
  // already names any resolution a draft proposes — reused whole rather than paraphrased.
  // A record the queue blocked for another reason (a humanOnly zone, say) is not given
  // that reason, so its action says plainly that a resolution is needed and none is drafted.
  let guardState = null
  try {
    guardState = loadDecisionState(root)
  } catch {
    guardState = null
  }
  const conflictsByZone = guardState !== null && guardState.conflictsByZone instanceof Map ? guardState.conflictsByZone : new Map()
  const blockedReasons = new Map(
    (Array.isArray(records) ? records : []).map((record) => [
      record?.id,
      typeof record?.blockedReason === 'string' ? record.blockedReason : null,
    ]),
  )
  const seenConflicts = new Set()
  for (const conflicts of conflictsByZone.values()) {
    for (const conflict of conflicts ?? []) {
      const key = `${conflict?.adrId}\n${conflict?.lawId}`
      if (seenConflicts.has(key)) continue
      seenConflicts.add(key)
      const blockedReason = blockedReasons.get(conflict.adrId) ?? null
      const ratchetFix =
        blockedReason !== null && blockedReason.startsWith(`ADR ${conflict.adrId} contradicts law in force`) ? blockedReason : null
      needs.push({
        kind: 'contradiction',
        id: conflict.adrId,
        title: titleOf(records, conflict.adrId) ?? conflict.adrId,
        path: conflict.path ?? pathOf(records, conflict.adrId),
        reason: conflict.why,
        action:
          ratchetFix ??
          `no drafted resolution exists \u2014 a resolution that withdraws law "${conflict.lawId}" is needed before this record can be ratified`,
      })
    }
  }

  // (3) A duplicate the deterministic rules find, with the resolution the SAME drafting
  // half produces: `draftResolutions({ write:false })` is the gate's own drafter, so the
  // entry and the command cannot disagree about what the merge is.
  let dedupe = null
  try {
    dedupe = draftResolutions(root, { write: false })
  } catch {
    dedupe = null
  }
  if (dedupe !== null && dedupe.unusable !== true) {
    for (const draft of dedupe.drafts ?? []) {
      const duplicate = draft.duplicate ?? {}
      needs.push({
        kind: 'duplicate',
        id: draft.id,
        title: draft.title ?? `drafted resolution for ${draft.withdraws}`,
        path: pathOf(records, draft.withdraws) ?? (typeof draft.path === 'string' ? draft.path : null),
        reason: duplicate.message ?? `the corpus holds a duplicate (${duplicate.code ?? 'duplicate'})`,
        action: `ratify or decline the drafted resolution "${draft.title}" at ${draft.path}: it withdraws law "${draft.removes}" from ADR ${draft.withdraws} and keeps ADR ${draft.keeps}; the draft is a proposal and is not in force`,
      })
    }
    for (const undraftable of dedupe.undraftable ?? []) {
      const duplicate = undraftable.duplicate ?? {}
      const first = Array.isArray(duplicate.records) ? duplicate.records[0] ?? null : null
      needs.push({
        kind: 'duplicate',
        id: first ?? duplicate.key ?? 'duplicate',
        title: first === null ? 'a duplicate the ratchet cannot draft' : titleOf(records, first) ?? first,
        path: pathOf(records, first),
        reason: duplicate.message ?? 'the ratchet reports a duplicate it cannot draft',
        action: `no drafted resolution exists \u2014 ${undraftable.reason}`,
      })
    }
  }

  // (4) A stale specification, from `detectSpecDrift` over the documents the current
  // bundle renders. The three non-orphaned kinds are fixed the same way; an orphan is
  // the one that is withdrawn instead. Nothing drafts a correction in either case.
  const specFixes = {
    drifted: 'regenerate the document with "ratchet compile --write"',
    stale: 'regenerate the document with "ratchet compile --write"',
    missing: 'regenerate the document with "ratchet compile --write"',
    orphaned: 'delete the orphaned document, or regenerate the corpus that produced it',
  }
  const specEntries = [
    ...(drift.drifted ?? []).map((entry) => ({
      path: typeof entry === 'string' ? entry : entry?.path,
      reason: `detectSpecDrift reports the generated document as drifted: ${typeof entry === 'object' && entry !== null && typeof entry.reason === 'string' ? entry.reason : 'content differs from the generated text'}`,
      fix: specFixes.drifted,
    })),
    ...(drift.stale ?? []).map((entry) => ({
      path: entry?.path,
      reason: `detectSpecDrift reports the generated document as stale: it records spec ${entry?.recorded} and the current laws hash to ${entry?.wanted}`,
      fix: specFixes.stale,
    })),
    ...(drift.missing ?? []).map((path) => ({
      path,
      reason: 'detectSpecDrift reports the generated document as missing: the project tracks generated spec documents and this one is gone',
      fix: specFixes.missing,
    })),
    ...(drift.orphaned ?? []).map((entry) => ({
      path: entry?.path,
      reason: 'detectSpecDrift reports the generated document as orphaned: the current bundle no longer renders a document at this path',
      fix: specFixes.orphaned,
    })),
  ]
  for (const entry of specEntries) {
    if (typeof entry.path !== 'string' || entry.path.length === 0) continue
    needs.push({
      kind: 'stale-spec',
      id: entry.path,
      title: `spec ${entry.path.split('/').pop()}`,
      path: entry.path,
      reason: entry.reason,
      action: `no drafted correction exists \u2014 ${entry.fix}`,
    })
  }

  // (5) The red gate, read from the persisted artifacts.
  const red = redGateNeed(root, currentSpecHash)
  if (red !== null) needs.push(red)

  return needs
}

/**
 * PURPOSE
 *   Build the complete view model the ADR panel window renders, from the ratchet's own
 *   functions. It is a composition of facts, never a second implementation: every force
 *   fact comes from `resolveActiveSet`, every queue fact from `ratificationQueue`, every
 *   spec fact from `compileProject`/`renderSpecs`/`detectSpecDrift`, and the
 *   needs-a-human set from `buildNeedsHuman`.
 *
 * INPUTS
 *   options — `{ root }` as described in this module's header.
 *
 * OUTPUTS
 *   The view model described in this module's header. Never null and never throws.
 *
 * KEYWORDS
 *   view model, derive, compileProject, resolveActiveSet, ratificationQueue, renderSpecs,
 *   detectSpecDrift, content hash
 */
export function deriveDecisions({ root } = {}) {
  const empty = {
    ok: false,
    root: typeof root === 'string' && root.length > 0 ? root : null,
    project: { name: null, decisionsDir: 'docs/adrs', specsDir: 'docs/specs' },
    specHash: null,
    records: [],
    queue: { ok: false, config: null, pending: [], blocked: [], problems: [] },
    specs: [],
    drift: { drifted: [], stale: [], missing: [], orphaned: [] },
    needsHuman: [],
    problems: [],
  }
  if (typeof root !== 'string' || root.length === 0) {
    empty.problems = [{ code: 'ROOT_INVALID', message: 'the decisions service needs an absolute project root' }]
    return empty
  }

  const manifest = readManifest(root)
  const config = manifest.config
  const problems = [...manifest.problems]
  const compiled = compileProject(root)
  problems.push(...compiled.problems)

  let records = []
  if (config !== null) {
    const corpus = readAdrCorpus(root, config)
    problems.push(...corpus.problems)
    const resolved = resolveActiveSet(corpus.records, config)
    problems.push(...resolved.problems)
    records = corpus.records
  }

  const queue = ratificationQueue(root)
  const waiting = new Map((queue.pending ?? []).map((entry) => [entry.id, entry]))
  const blocked = new Map((queue.blocked ?? []).map((entry) => [entry.id, entry]))
  // The catalog: one entry per record, with the state a row is drawn with. `state` and
  // `provenance` are the only fields not copied from a ratchet function; they select a
  // label over the facts the functions derived.
  const viewRecords = records.map((record) => {
    const blockedEntry = blocked.get(record.id)
    const isWaiting = waiting.has(record.id)
    const relevantZones = config === null ? [] : zonesForRecord(record, config)
    const awaitingZone = relevantZones.find((zone) => zone.agentAuthority === 'proposeOnly') ?? null
    const withQueue = {
      ...record,
      // `canRatify` is the ratchet's own queue membership, never a re-derived predicate:
      // a record the queue lists as waiting is one a "yes" can settle.
      canRatify: isWaiting,
      queue: isWaiting ? 'waiting' : blockedEntry === undefined ? null : 'blocked',
      blockedReason: blockedEntry === undefined ? null : blockedEntry.reason,
      // The zone a proposed/excluded AGENT record would need a human to ratify under, so
      // the display label can name it without re-deriving which zone refused it.
      awaitingZone: awaitingZone === null ? null : awaitingZone.id,
      ratificationChannel: record.ratification?.channel ?? null,
      text: null,
    }
    const state = displayedState(withQueue, withQueue.blockedReason)
    return { ...withQueue, ...state }
  })

  // Read each record's whole text for display (body sections and summaries). A read
  // failure leaves `text` null and is not fatal; the facts above are unaffected.
  for (const record of viewRecords) {
    if (typeof record.path !== 'string' || record.path.length === 0) continue
    try {
      record.text = readFileSync(join(root, record.path), 'utf8')
    } catch {
      record.text = null
    }
  }

  const specFiles = {}
  if (compiled.bundle !== null) {
    const specsDir = config?.specsDir ?? 'docs/specs'
    const rendered = renderSpecs(compiled.bundle, specsDir)
    for (const [path, text] of Object.entries(rendered.files)) {
      specFiles[path] = text
    }
  }
  const specs = Object.entries(specFiles).map(([path, text]) => ({
    path,
    name: path.split('/').pop(),
    text,
    specHash: compiled.report?.specHash ?? null,
  }))
  const drift = compiled.bundle === null ? { drifted: [], stale: [], missing: [], orphaned: [] } : detectSpecDrift(root, specFiles, config?.specsDir ?? null)

  const projectName = config?.project ?? compiled.bundle?.project ?? 'this project'

  return {
    ok: config !== null && config.enabled === true,
    root,
    project: {
      name: projectName,
      decisionsDir: config?.decisionsDir ?? 'docs/adrs',
      specsDir: config?.specsDir ?? 'docs/specs',
    },
    specHash: compiled.report?.specHash ?? null,
    records: viewRecords,
    queue,
    specs,
    drift,
    needsHuman: buildNeedsHuman(root, viewRecords, queue, drift, compiled.report?.specHash ?? null),
    problems: dedupeProblems([...problems, ...(queue.problems ?? [])]),
  }
}

/**
 * PURPOSE
 *   Resolve a project root from a directory the caller already knows, so a host route
 *   can turn a Session's workspace into the project the ratchet answers about. Exposed
 *   here because the panel must not carry its own copy of the ratchet's root rule.
 *
 * INPUTS
 *   start — a directory path, or `null`/`undefined`.
 *
 * OUTPUTS
 *   The absolute project root containing `.dsh/project.json` at or above `start`, or
 *   `null` when there is none within the ratchet's search bound. A non-string input
 *   returns `null` rather than throwing.
 *
 * KEYWORDS
 *   project root, manifest, session workspace, resolution
 */
export function decisionsRootFor(start) {
  if (typeof start !== 'string' || start.length === 0) return null
  try {
    return findRoot(start)
  } catch {
    return null
  }
}

/**
 * PURPOSE
 *   Build the value `ratchet-tools.mjs` provides as the {@link DECISIONS_SERVICE} cordis
 *   service. It is a plain object of the two operations above, so the panel's host half
 *   reaches one stable shape with `ctx.get` and this module keeps every force fact
 *   inside the ratchet.
 *
 * INPUTS
 *   None.
 *
 * OUTPUTS
 *   `{ view, rootFor }` — `view({ root })` returns the view model above; `rootFor(start)`
 *   resolves a project root. Never null.
 *
 * KEYWORDS
 *   cordis service, provide, host seam, adr panel, view model
 */
export function createDecisionsService() {
  return {
    view: ({ root } = {}) => deriveDecisions({ root }),
    rootFor: decisionsRootFor,
  }
}
