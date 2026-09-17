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
 *   `deriveDecisions` computes the view SYNCHRONOUSLY and is the pure composition of
 *   the ratchet's facts; `createDecisionsService().view` is the host-facing operation
 *   and is ASYNC: it caches the derived view under a cheap corpus signature and, on a
 *   miss, derives it on a worker thread, so neither the IO of parsing a large corpus nor
 *   the serialisation of a large view runs on the event loop that serves the harness. It
 *   also CAPS the view it returns (record count, spec count, needs-a-human count and
 *   serialised bytes) and marks what it dropped, instead of shipping an unbounded object.
 *
 * INPUTS
 *   `deriveDecisions({ root })` — `root` is an absolute project root (string). Any other
 *   value yields an empty, unusable view rather than an exception.
 *   `createDecisionsService().view({ root })` — the same `root`, returning a Promise.
 *
 * OUTPUTS
 *   `deriveDecisions` returns a plain JSON-serializable object:
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
 *       `{ kind, id, title, path, reason, action, draft, draftReason }` with `kind` one of
 *       `consent`, `blocked`, `contradiction`, `duplicate`, `deprecated`, `stale-spec`, `red-gate`.
 *       A `consent` waits to be answered; a `blocked` record cannot be settled by a consent
 *       (the queue says why) and is reported so a human sees it, not so it can be approved. Every
 *       entry is the ratchet's own fact, copied or shaped, never a second rule: consents from
 *       `ratificationQueue.pending`; contradictions, duplicates and stale specs from the
 *       ONE drafting pass `draftNeedsHuman(root, { write:false })` runs — the same pass
 *       `ratchet compile` invokes to place the drafts; and deprecations from that pass's
 *       `advisory` findings, which a corpus review persisted bound to the law set it read. A
 *       semantic duplicate (a restatement no text comparison sees) reaches this set through the
 *       same `duplicate` kind, because `draftNeedsHuman` translates the review's advisory
 *       `semantic_duplicate` findings into the drafting path. `draft` is the drafted id and
 *       path (or null) and `draftReason` says why no draft exists when there is none, so the
 *       window can send the human straight to the draft. The red gate comes from the persisted
 *       verify report/state read with `readJsonArtifact` and `readState`. When a finding has no
 *       draft behind it, `action` says so rather than naming one that does not exist.
 *     - `drafting` — the same `draftNeedsHuman` result, shaped for display: the duplicate and
 *       contradiction drafts (written or computed) and the stale notes, with their ids and paths.
 *     - `problems` — every problem the manifest, the corpus and the queue reported,
 *       so a caller can show why a project is not green.
 *     - `truncated` — null when the whole view was returned, otherwise the cap's own
 *       record: `{ records, specs, needsHuman, texts, specTexts, byteLimit }`, where
 *       `records` and `specs` are `{ shown, total }` when a count was cut, `needsHuman`
 *       is `{ shown, total, kinds }` when the needs-a-human set itself was cut (`kinds`
 *       lists every kind that lost an entry, as `{ kind, shown, total }`, so a kind
 *       cannot vanish silently), and `texts`/`specTexts` are `{ dropped, total }` when a
 *       body had to be dropped to stay under `byteLimit`. It is the view's own statement
 *       that what arrived is not the whole corpus, so a renderer can say so rather than
 *       presenting a partial list as complete.
 *   A null/empty `root` returns `{ ok:false, root, records:[], queue:{...empty}, specs:[],
 *   drift:{...empty}, needsHuman:[], problems:[MANIFEST_MISSING-like], truncated:null }` and
 *   never throws.
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
 *   - The service's `view` is called with a `root` that is not a non-empty string: it
 *     resolves synchronously, with no worker spawned, to the same unusable view.
 *   - The corpus changes between two calls: the signature moves, so the cache is not
 *     consulted and the view is derived again. A signature that cannot be read (a
 *     directory that is absent) still yields a stable value rather than a throw.
 *   - A corpus larger than {@link MAX_STATE_RECORDS}, a needs-a-human set larger than
 *     {@link MAX_STATE_NEEDS} (or one kind larger than
 *     {@link MAX_STATE_NEEDS_PER_KIND}), or a view larger than {@link MAX_STATE_BYTES}:
 *     the view is cut and `truncated` names what was cut, including every kind that
 *     lost an entry.
 *   - A worker that cannot be created, throws, or exits before answering: the service's
 *     promise rejects with a sentence naming the failure, which the caller reports; it
 *     never falls back to a blocking derivation, because the property the worker exists
 *     for is that the event loop stays free.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { compileProject, readAdrCorpus, readManifest, renderSpecs, resolveActiveSet, zonesForRecord } from './ratchet-compiler.mjs'
import { resolveStepsFor } from './ratchet-resolve.mjs'
import { ratificationQueue } from './ratchet-ratify.mjs'
import { detectSpecDrift, readJsonArtifact, readState, STATE_PATHS, verificationStatus } from './ratchet-state.mjs'
import { draftNeedsHuman } from './ratchet-drafts.mjs'
import { findRoot } from './ratchet-ops.mjs'
import { MANIFEST_PATH } from './ratchet-schema.mjs'

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
 *   state; a record that is neither in the queue nor blocked — a terminal one, or any
 *   record when the queue could not be read — falls through to its status label or
 *   `unknown`. A human-authored proposed record is NOT special-cased: it is in the
 *   queue like every other not-in-force record, so it renders as `awaiting a human`
 *   and carries the ratify action. Never throws; a
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
    // Reachable only when the queue could not be read, or the record is blocked for a
    // reason this row does not carry: a proposed record that can be ratified comes from
    // the branch above, human-authored ones included. Authorship is not activation; the
    // consent is, which is why the human-authored case is no longer a dead end here.
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
function redGateNeed(root, currentSpecHash, lawDecider) {
  const reportPath = STATE_PATHS.verifyReport
  const report = readJsonArtifact(root, reportPath)
  const reportProblems =
    report.value !== undefined && report.value !== null && Array.isArray(report.value.problems) ? report.value.problems : null
  if (reportProblems !== null && reportProblems.length > 0) {
    const count = reportProblems.length
    // The count alone told a human the gate was red and nothing else: the card offered no
    // option and the report path was the only lead. Each problem is carried with the record
    // that decided its law, so the window can point at what to change instead of at a file.
    const problems = reportProblems.slice(0, MAX_RED_GATE_PROBLEMS).map((problem) => {
      const lawId = typeof problem?.lawId === 'string' ? problem.lawId : null
      return {
        code: typeof problem?.code === 'string' ? problem.code : null,
        lawId,
        adrId: lawId === null || lawDecider === null ? null : lawDecider.get(lawId) ?? null,
        message: typeof problem?.message === 'string' ? problem.message.slice(0, 400) : null,
      }
    })
    return {
      kind: 'red-gate',
      id: 'verify',
      title: `the last recorded verification found ${count} problem${count === 1 ? '' : 's'}`,
      path: reportPath,
      reason: `${reportPath} records ${count} problem${count === 1 ? '' : 's'} from the last verification`,
      action: `read ${reportPath}, fix what it names, and re-run "ratchet verify"`,
      problems,
      problemCount: count,
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
      action: `fix what ${reportPath} names and re-run "ratchet verify"`,
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
      action: 're-run "ratchet verify" against the current laws and the current code',
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
 *   drafted - the `draftNeedsHuman(root, { write:false })` result, whose detections and
 *     drafts the contradiction, duplicate and stale entries are built from. The one fact that
 *     is NOT in it — a consent — comes from the queue above.
 *
 * OUTPUTS
 *   An array, ordered consents, contradictions, duplicates, deprecated decisions, stale specs,
 *   red gate. Each entry is `{ kind, id, title, path, reason, action, draft, draftReason }`,
 *   `kind` one of the six names. `draft` is `{ id, path }` when the ratchet drafted a
 *   settlement for the issue and null otherwise; `draftReason` says why no draft exists when
 *   it does not (null when one does). A deprecated decision never carries a draft: retiring a
 *   decision is a human act, so its `action` names the retirement shape. An empty project
 *   yields `[]`. Never throws: a guard, drafter or artifact read that fails contributes no
 *   entry rather than an exception.
 *
 * KEYWORDS
 *   needs a human, consent, contradiction, duplicate, stale spec, red gate, entry point,
 *   drafted path, draft identity
 */
function buildNeedsHuman(root, records, queue, drift, currentSpecHash, drafted, lawDecider, config, problems = []) {
  const needs = []
  const asDraft = (value) =>
    value === null || value === undefined || typeof value !== 'object'
      ? null
      : { id: value.id === undefined ? null : value.id, path: value.path === undefined ? null : value.path }

  // (1) A consent WAITING to be answered, from the ratchet's own queue. Nothing is
  // drafted for a consent: the human's answer IS the act.
  for (const entry of queue.pending ?? []) {
    needs.push({
      kind: 'consent',
      id: entry.id,
      title: entry.title ?? titleOf(records, entry.id) ?? entry.id,
      path: entry.path ?? pathOf(records, entry.id),
      reason: 'the ratchet\u2019s ratification queue lists this decision as waiting for a human: a "yes" settles it',
      action: 'use Approve or Decline in its row below',
      draft: null,
      draftReason: 'a consent is put to a human as a question; nothing is drafted for it',
    })
  }

  // (1b) A decision the queue reports as BLOCKED. It is not waiting for a consent —
  // the reason says why a "yes" would mint nothing — but it is still something only a
  // human can settle: author the record, or change the zone authority. Leaving it out
  // made a humanOnly-zone proposal invisible in the one set that is meant to tell a
  // human what needs them. The row it names offers no Approve, because `canRatify` is
  // the queue's own membership and it is false here.
  for (const entry of queue.blocked ?? []) {
    // A blocked record is a PENDING item, not a dead end: it carries the plan that would
    // unblock it, computed from the same facts the compiler refused it with. `steps` is
    // empty only when the resolver models no blocker for it, and `humanRequired` is true
    // only when a step (a humanOnly zone) is one no agent may carry out.
    const blockedRecord = records.find((candidate) => candidate.id === entry.id) ?? null
    const plan = blockedRecord === null ? { steps: [], humanRequired: false } : resolveStepsFor(blockedRecord, config, problems)
    needs.push({
      kind: 'blocked',
      id: entry.id,
      title: entry.title ?? titleOf(records, entry.id) ?? entry.id,
      path: entry.path ?? pathOf(records, entry.id),
      reason: entry.reason ?? 'the ratification queue reports this decision as blocked',
      action:
        'a consent cannot settle it: the record has to be replaced by a human-authored one, or the zone authority has to change',
      draft: null,
      draftReason: 'a consent is refused rather than drafted for; the blocked reason says why',
      steps: plan.steps,
      humanRequired: plan.humanRequired,
    })
  }

  // (2) A contradiction between a proposal and law in force, from the ratchet's OWN drafting
  // pass (`draftNeedsHuman`), which computes it with the compiler's `decidableContradictions`
  // and `auditedResolutions`. Each need carries the drafted resolution's id and path when the
  // ratchet produced one, and says why when it could not.
  for (const need of drafted?.contradictions?.needs ?? []) {
    const draft = asDraft(need.draft)
    needs.push({
      kind: 'contradiction',
      id: need.offenderId,
      title: titleOf(records, need.offenderId) ?? need.offenderId,
      path: pathOf(records, need.offenderId) ?? null,
      reason: need.why ?? need.reason ?? 'the compiler reports a decidable contradiction with law in force',
      action:
        draft !== null
          ? `ratify or decline the drafted resolution at ${draft.path}: it names resolves ["${need.holderId}", "${need.offenderId}"] and takes the conflicting law out of force; the draft is a proposal and is not in force`
          : `no drafted resolution exists \u2014 ${need.draftReason ?? need.reason ?? 'the ratchet could not draft one for this conflict'}`,
      draft,
      draftReason: draft === null ? need.draftReason ?? need.reason ?? null : null,
    })
  }

  // (3) A duplicate the deterministic rules find, with the resolution the SAME drafting pass
  // produced. A duplicate already drafted is reported too, pointing at the draft on disk, so
  // the second run's silence does not read as "nothing to do".
  const duplicates = drafted?.duplicates ?? null
  if (duplicates !== null && duplicates !== undefined) {
    for (const draft of [...(duplicates.drafts ?? []), ...(duplicates.alreadyDrafted ?? [])]) {
      const duplicate = draft.duplicate ?? {}
      needs.push({
        kind: 'duplicate',
        id: draft.id,
        title: draft.title ?? `drafted resolution for ${draft.withdraws}`,
        path: pathOf(records, draft.withdraws) ?? (typeof draft.path === 'string' ? draft.path : null),
        reason: duplicate.message ?? `the corpus holds a duplicate (${duplicate.code ?? 'duplicate'})`,
        action: `ratify or decline the drafted resolution "${draft.title}" at ${draft.path}: it withdraws law "${draft.removes}" from ADR ${draft.withdraws} and keeps ADR ${draft.keeps}; the draft is a proposal and is not in force`,
        draft: asDraft(draft),
        draftReason: null,
      })
    }
    for (const undraftable of duplicates.undraftable ?? []) {
      const duplicate = undraftable.duplicate ?? {}
      const first = Array.isArray(duplicate.records) ? duplicate.records[0] ?? null : null
      needs.push({
        kind: 'duplicate',
        id: first ?? duplicate.key ?? 'duplicate',
        title: first === null ? 'a duplicate the ratchet cannot draft' : titleOf(records, first) ?? first,
        path: pathOf(records, first),
        reason: duplicate.message ?? 'the ratchet reports a duplicate it cannot draft',
        action: `no drafted resolution exists \u2014 ${undraftable.reason}`,
        draft: null,
        draftReason: undraftable.reason ?? null,
      })
    }
  }

  // (3b) A decision the corpus review says should be RETIRED: every law it declares has left
  // force, or a newer decision restates what it decided. This is the advisory `deprecated`
  // kind. It is deliberately not a gate — the judge's belief that a decision is redundant is
  // advice — and the ratchet drafts nothing for it: retiring a decision is a human act, so the
  // `action` names the retirement shapes the lifecycle already has (`supersedes`, or `op:
  // remove` plus a `resolves` list). The findings come from the corpus review's persisted
  // advisory set, bound to the law set it read; a finding about another law set is skipped by
  // `draftNeedsHuman` before it reaches here.
  const deprecatedSeen = new Set()
  for (const finding of drafted?.advisory?.findings ?? []) {
    if (finding === null || typeof finding !== 'object' || finding.kind !== 'deprecated_decision') continue
    const adrId = typeof finding.sourceAdr === 'string' && finding.sourceAdr.length > 0 ? finding.sourceAdr : null
    if (adrId !== null && deprecatedSeen.has(adrId)) continue
    if (adrId !== null) deprecatedSeen.add(adrId)
    needs.push({
      kind: 'deprecated',
      id: adrId ?? (typeof finding.lawId === 'string' && finding.lawId.length > 0 ? finding.lawId : 'deprecated'),
      title: adrId === null ? 'a decision the review says should be retired' : titleOf(records, adrId) ?? adrId,
      path: adrId === null ? null : pathOf(records, adrId),
      reason: typeof finding.explanation === 'string' && finding.explanation.trim().length > 0
        ? finding.explanation
        : 'the corpus review reports this decision should be retired',
      action:
        adrId === null
          ? 'retire the decision the review names: write a record that supersedes it, or that removes its laws with an op: remove and a resolves list; the ratchet drafts no retirement of its own'
          : `retire ADR ${adrId}: write a new decision carrying \`supersedes: ["${adrId}"]\`, or one that removes each of its laws with an op: remove and a resolves list naming ${adrId}; the ratchet drafts no retirement of its own, because retiring a decision is a human act`,
      draft: null,
      draftReason: 'the ratchet drafts nothing for a retirement — the action is the human-authored record that supersedes the decision or removes its laws',
    })
  }

  // (4) A generated specification that no longer matches. A STALE one is advisory and carries
  // the withdrawal note the ratchet drafted for it; a hand-edited, missing or orphaned one still
  // blocks the gate and has no note.
  const notesByPath = new Map((drafted?.staleNotes ?? []).map((note) => [note.path, note]))
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
      stale: true,
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
    const note = entry.stale === true ? notesByPath.get(entry.path) ?? null : null
    needs.push({
      kind: 'stale-spec',
      id: entry.path,
      title: `spec ${entry.path.split('/').pop()}`,
      path: entry.path,
      reason: entry.reason,
      action:
        note === null
          ? `${entry.fix}`
          : `a withdrawal note is drafted at ${note.notePath}; the ratchet wrote it and will NOT apply it \u2014 ${entry.fix}, or delete the document if its laws were removed deliberately`,
      draft: note === null ? null : { id: null, path: note.notePath },
      draftReason:
        note === null
          ? 'no drafted correction exists \u2014 the ratchet found no withdrawal note on disk for this document; run "ratchet compile" so it drafts one'
          : null,
    })
  }

  // (5) The red gate, read from the persisted artifacts.
  const red = redGateNeed(root, currentSpecHash, lawDecider)
  if (red !== null) {
    // The action is the instruction; this says WHY no record can be drafted for it, so the
    // card does not print the same "no drafted fix exists" sentence twice.
    needs.push({ ...red, draft: null, draftReason: 'no drafted fix exists \u2014 a red verification is a fact about the report and the code, not a decision the ratchet can draft a record for' })
  }

  // A record blocked by a decidable contradiction or a duplicate is already reported
  // by that need, which carries the drafted resolution; a second card for the same
  // record would say less. A block with no other need — the humanOnly-zone case — is
  // exactly the one this set would otherwise hide, so it is kept.
  const covered = new Set(needs.filter((need) => need.kind !== 'blocked').map((need) => String(need.id)))
  return needs.filter((need) => need.kind !== 'blocked' || !covered.has(String(need.id)))
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
    truncated: null,
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

  // The ratchet's own detection and drafting pass, run READ-ONLY: the window must not mutate
  // the project, so this computes the same drafts `ratchet compile` would write and reports
  // their paths. `ratchet compile` is what actually places them on disk.
  let drafted = null
  try {
    drafted = draftNeedsHuman(root, { write: false })
  } catch {
    drafted = null
  }

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
    drafting: drafted === null
      ? { ok: false, unusable: true, duplicates: { drafts: [], alreadyDrafted: [], undraftable: [], scanned: null }, contradictions: { drafts: [], alreadyDrafted: [], undraftable: [], needs: [] }, staleNotes: [], problems: [] }
      : {
          ok: drafted.ok,
          unusable: drafted.unusable,
          duplicates: drafted.duplicates,
          contradictions: drafted.contradictions,
          staleNotes: drafted.staleNotes.map((note) => ({ path: note.path, notePath: note.notePath, recorded: note.recorded, wanted: note.wanted })),
          problems: drafted.problems,
        },
    needsHuman: buildNeedsHuman(
        root,
        viewRecords,
        queue,
        drift,
        compiled.report?.specHash ?? null,
        drafted,
        // law id -> the record that decided it, so a red-gate problem can name the
        // decision to open rather than only the report file to read.
        new Map((compiled.bundle?.laws ?? []).map((law) => [law.id, law.sourceAdr ?? null])),
        config,
        compiled.problems,
      ),
    problems: dedupeProblems([...problems, ...(queue.problems ?? [])]),
    // The derivation itself never truncates; the service's cap is what may cut the view,
    // and it records its cuts here. Present and null keeps the shape uniform.
    truncated: null,
  }
}

/**
 * The most records one state response carries. A corpus larger than this is truncated and
 * the view says so. It exists because the panel's own corpus is tens of records while a
 * generated project can hold thousands, and a response that grew without bound would be a
 * memory and latency fact about a read-only display route.
 */
export const MAX_STATE_RECORDS = 500

/**
 * The most generated spec documents one state response carries. A spec document is a whole
 * law card rather than a line, so this ceiling is lower than the record one and its
 * truncation is reported separately.
 */
export const MAX_STATE_SPECS = 64

/**
 * The most needs-a-human entries one state response carries in total. The set is a
 * human's to-do list, and a homogeneous batch — most often one `stale-spec` entry per
 * generated document — can be hundreds long; without a ceiling it would dominate both
 * the response and the window that renders it.
 */
export const MAX_STATE_NEEDS = 200

/**
 * The most needs-a-human entries of any ONE kind that a state response carries. It bounds
 * a single dominant batch so the decision-shaped kinds (`consent`, `contradiction`,
 * `duplicate`) that each need a distinct human act are not pushed out by stale specs. A
 * kind cut this way is named in `truncated.needsHuman.kinds`, never dropped silently.
 */
export const MAX_STATE_NEEDS_PER_KIND = 50

/**
 * The most problems a red-gate need carries into the view model. A verification can
 * report hundreds; the card needs enough to act on, and the count it also carries says
 * how many were held back, so a bounded list never reads as the whole report.
 */
const MAX_RED_GATE_PROBLEMS = 5

/**
 * The byte ceiling for one serialised state response. When the document exceeds it, the
 * cap drops record bodies, then spec bodies, then the queue's copies, newest-last, until
 * the estimate fits, and records exactly what it dropped under `truncated`.
 */
export const MAX_STATE_BYTES = 1_500_000

/**
 * How many project roots one decisions service remembers a derived view for. A service is
 * a process-lifetime singleton and its caller resolves a root from a Session workspace, so
 * this is the ceiling that keeps a long-lived server from accumulating one view per project
 * it has ever been asked about. The oldest entry is dropped when a new root arrives.
 */
const CACHE_LIMIT = 8

/**
 * PURPOSE
 *   Hash the manifest file's own bytes, so a corpus signature notices an edit to the
 *   project declaration (a renamed decisions directory, a changed zone table) even when
 *   no record file changed.
 *
 * INPUTS
 *   root - an absolute project root (string).
 *
 * OUTPUTS
 *   The sha256 hex digest of `<root>/.dsh/project.json`, or the literal `no-manifest`
 *   when the file cannot be read. Never throws.
 *
 * KEYWORDS
 *   corpus signature, manifest hash, cache invalidation, sha256
 */
function manifestDigest(root) {
  try {
    return createHash('sha256').update(readFileSync(join(root, MANIFEST_PATH))).digest('hex')
  } catch {
    return 'no-manifest'
  }
}

/**
 * PURPOSE
 *   Render a directory's entry signature: one row per entry carrying its name, size and
 *   modification time, sorted so the value depends on the set and not on readdir order.
 *   It is the cheap way to notice a record added, removed, renamed, resized or rewritten
 *   without parsing any of them.
 *
 * INPUTS
 *   root - an absolute project root (string).
 *   relativeDir - a repository-relative directory path (string).
 *
 * OUTPUTS
 *   A stable string. An absent or unreadable directory yields `<relativeDir>:-absent`
 *   rather than throwing. Subdirectories are recorded by name only and are not walked;
 *   the ratchet's record and source directories are flat by construction.
 *
 * KEYWORDS
 *   corpus signature, directory entries, mtime, cache invalidation
 */
function directoryEntrySignature(root, relativeDir) {
  const dir = join(root, relativeDir)
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return `${relativeDir}:-absent`
  }
  const rows = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      rows.push(`${entry.name}/`)
      continue
    }
    try {
      const stat = statSync(join(dir, entry.name))
      rows.push(`${entry.name}:${stat.size}:${stat.mtimeMs}`)
    } catch {
      rows.push(`${entry.name}:unreadable`)
    }
  }
  rows.sort()
  return `${relativeDir}:${rows.join(',')}`
}

/**
 * PURPOSE
 *   Compute the cheap signature the decisions service keys its cache by: the manifest's
 *   own bytes plus the entry signatures of the decisions, sources and ratchet-state
 *   directories. It is deliberately cheaper than deriving the view (a handful of stats
 *   instead of parsing and hashing every record) and deliberately complete for the view's
 *   inputs, so a corpus that changed in any way the view can see cannot be served from a
 *   cache keyed by this value.
 *
 * INPUTS
 *   root - an absolute project root (string).
 *
 * OUTPUTS
 *   A stable string. A non-string or empty root yields `invalid-root`; a missing manifest
 *   or directory contributes its own stable marker rather than throwing. Never throws.
 *
 * KEYWORDS
 *   corpus signature, cache key, cache invalidation, manifest hash, directory entries
 */
export function decisionsSignature(root) {
  if (typeof root !== 'string' || root.length === 0) return 'invalid-root'
  const config = readManifest(root).config
  const decisionsDir = config?.decisionsDir ?? 'docs/adrs'
  const sourcesDir = config?.sourcesDir ?? 'docs/ratchet/sources'
  return [
    `manifest:${manifestDigest(root)}`,
    directoryEntrySignature(root, decisionsDir),
    directoryEntrySignature(root, sourcesDir),
    directoryEntrySignature(root, '.dsh/ratchet'),
  ].join('|')
}

/**
 * PURPOSE
 *   Produce a copy of a view with every body text set to null, keeping the shape. It is
 *   the skeleton the byte cap measures before it decides how much text the response can
 *   afford.
 *
 * INPUTS
 *   view - the view model, or anything.
 *
 * OUTPUTS
 *   An object with `records[].text`, `specs[].text` and the queue entries' `text` nulled.
 *   A non-object input is returned unchanged. Never mutates its input and never throws.
 *
 * KEYWORDS
 *   byte cap, skeleton, response size, view model
 */
function stripViewTexts(view) {
  if (view === null || typeof view !== 'object') return view
  const queue = view.queue !== null && typeof view.queue === 'object' ? view.queue : {}
  const stripList = (entries) =>
    Array.isArray(entries) ? entries.map((entry) => (entry !== null && typeof entry === 'object' ? { ...entry, text: null } : entry)) : []
  return {
    ...view,
    records: Array.isArray(view.records) ? view.records.map((record) => (record !== null && typeof record === 'object' ? { ...record, text: null } : record)) : [],
    specs: Array.isArray(view.specs) ? view.specs.map((spec) => (spec !== null && typeof spec === 'object' ? { ...spec, text: null } : spec)) : [],
    queue: { ...queue, pending: stripList(queue.pending), blocked: stripList(queue.blocked) },
  }
}

/**
 * PURPOSE
 *   Cut the needs-a-human set down to the per-kind and total ceilings, keeping the
 *   ratchet's own order and naming every kind that lost an entry. It exists so a single
 *   dominant batch (stale generated specs) cannot fill the state response or the window,
 *   while the decision-shaped kinds that each need a distinct human act survive it.
 *
 * INPUTS
 *   allNeeds - the view model's `needsHuman` array, or anything.
 *
 * OUTPUTS
 *   `{ needs, cut }`. `needs` is the kept prefix: the input when nothing had to be cut,
 *   otherwise at most {@link MAX_STATE_NEEDS} entries, with at most
 *   {@link MAX_STATE_NEEDS_PER_KIND} of any one kind. `cut` is null when nothing was cut,
 *   otherwise `{ shown, total, kinds }` where `kinds` lists every kind that lost an entry
 *   as `{ kind, shown, total }` — so a kind reduced to zero is still stated. An entry that
 *   is not an object, or carries no string `kind`, is treated as the kind `unknown`. Never
 *   mutates its input and never throws.
 *
 * KEYWORDS
 *   needs a human, response cap, per-kind ceiling, stale spec batch, truncation, no silent
 *   drop
 */
function capNeedsHuman(allNeeds) {
  const list = Array.isArray(allNeeds) ? allNeeds : []
  const kindOf = (entry) =>
    entry !== null && typeof entry === 'object' && typeof entry.kind === 'string' && entry.kind.length > 0 ? entry.kind : 'unknown'
  const totals = new Map()
  for (const entry of list) {
    const kind = kindOf(entry)
    totals.set(kind, (totals.get(kind) ?? 0) + 1)
  }
  const shownByKind = new Map()
  const kept = []
  for (const entry of list) {
    if (kept.length >= MAX_STATE_NEEDS) break
    const kind = kindOf(entry)
    const shown = shownByKind.get(kind) ?? 0
    if (shown >= MAX_STATE_NEEDS_PER_KIND) continue
    shownByKind.set(kind, shown + 1)
    kept.push(entry)
  }
  if (kept.length === list.length) return { needs: list, cut: null }
  const kinds = []
  for (const [kind, total] of totals) {
    const shown = shownByKind.get(kind) ?? 0
    if (shown < total) kinds.push({ kind, shown, total })
  }
  return { needs: kept, cut: { shown: kept.length, total: list.length, kinds } }
}

/**
 * PURPOSE
 *   Cap a derived view to what one HTTP response may carry: a record ceiling, a spec
 *   ceiling and a byte ceiling, with a `truncated` record naming every cut. It exists so
 *   a read-only display route can answer a generated project of thousands of records
 *   without serialising an unbounded object, and so the renderer can SAY that what it
 *   has is partial rather than presenting a cut list as the whole corpus.
 *
 * INPUTS
 *   view - the view model described in this module's header, or anything.
 *
 * OUTPUTS
 *   A new object of the same shape with `truncated` null when nothing was cut, otherwise
 *   `{ records, specs, needsHuman, texts, specTexts, queueTexts, byteLimit }` where each
 *   element is null or an object naming what was cut (`records`/`specs`: `{ shown, total }`;
 *   `needsHuman`: `{ shown, total, kinds }` with every cut kind as `{ kind, shown, total }`;
 *   `texts`/`specTexts`/`queueTexts`: `{ dropped, total }`). A non-object input is
 *   returned unchanged. Record bodies are kept before spec bodies, and spec bodies before
 *   the queue's copies, so the most reader-facing text survives the budget. Never throws.
 *
 * KEYWORDS
 *   response cap, truncation, byte budget, record ceiling, spec ceiling, needs-a-human
 *   ceiling, partial view
 */
export function capDecisionsView(view) {
  if (view === null || typeof view !== 'object') return view
  const allRecords = Array.isArray(view.records) ? view.records : []
  const allSpecs = Array.isArray(view.specs) ? view.specs : []
  const truncated = { records: null, specs: null, needsHuman: null, texts: null, specTexts: null, queueTexts: null, byteLimit: MAX_STATE_BYTES }
  let records = allRecords
  let specs = allSpecs
  if (allRecords.length > MAX_STATE_RECORDS) {
    truncated.records = { shown: MAX_STATE_RECORDS, total: allRecords.length }
    records = allRecords.slice(0, MAX_STATE_RECORDS)
  }
  if (allSpecs.length > MAX_STATE_SPECS) {
    truncated.specs = { shown: MAX_STATE_SPECS, total: allSpecs.length }
    specs = allSpecs.slice(0, MAX_STATE_SPECS)
  }
  const needsCap = capNeedsHuman(view.needsHuman)
  truncated.needsHuman = needsCap.cut
  const shaped = { ...view, records, specs, needsHuman: needsCap.needs }
  const candidate = { ...shaped, truncated: truncated.records !== null || truncated.specs !== null || truncated.needsHuman !== null ? truncated : null }
  if (JSON.stringify(candidate).length <= MAX_STATE_BYTES) return candidate

  // Halve the shape until its text-free skeleton fits, then spend what is left on the
  // bodies in priority order. The guard bounds the loop if a pathological metadata block
  // keeps the skeleton above the ceiling however few records remain. The reserve covers
  // the `truncated` record's own bytes, which grow as bodies are dropped and are therefore
  // not in the skeleton measured here.
  const TRUNCATED_RESERVE = 1024
  const cutInHalf = (list) => (list.length <= 1 ? [] : list.slice(0, Math.floor(list.length / 2)))
  let skeleton = JSON.stringify({ ...stripViewTexts(shaped), truncated: null })
  let guard = 0
  while (skeleton.length > MAX_STATE_BYTES && (records.length > 0 || specs.length > 0) && guard < 64) {
    guard += 1
    if (records.length >= specs.length) records = cutInHalf(records)
    else specs = cutInHalf(specs)
    if (records !== allRecords) truncated.records = { shown: records.length, total: allRecords.length }
    if (specs !== allSpecs) truncated.specs = { shown: specs.length, total: allSpecs.length }
    skeleton = JSON.stringify({ ...stripViewTexts({ ...shaped, records, specs }), truncated: null })
  }
  let budget = MAX_STATE_BYTES - skeleton.length - TRUNCATED_RESERVE
  let droppedTexts = 0
  const keptRecords = records.map((record) => {
    if (record === null || typeof record !== 'object' || typeof record.text !== 'string') return record
    const cost = JSON.stringify(record.text).length
    if (cost <= budget) {
      budget -= cost
      return record
    }
    droppedTexts += 1
    return { ...record, text: null }
  })
  let droppedSpecTexts = 0
  const keptSpecs = specs.map((spec) => {
    if (spec === null || typeof spec !== 'object' || typeof spec.text !== 'string') return spec
    const cost = JSON.stringify(spec.text).length
    if (cost <= budget) {
      budget -= cost
      return spec
    }
    droppedSpecTexts += 1
    return { ...spec, text: null }
  })
  const queue = shaped.queue !== null && typeof shaped.queue === 'object' ? shaped.queue : {}
  let droppedQueueTexts = 0
  const capQueue = (entries) =>
    Array.isArray(entries)
      ? entries.map((entry) => {
          if (entry === null || typeof entry !== 'object' || typeof entry.text !== 'string') return entry
          const cost = JSON.stringify(entry.text).length
          if (cost <= budget) {
            budget -= cost
            return entry
          }
          droppedQueueTexts += 1
          return { ...entry, text: null }
        })
      : []
  const keptQueue = { ...queue, pending: capQueue(queue.pending), blocked: capQueue(queue.blocked) }
  if (droppedTexts > 0) truncated.texts = { dropped: droppedTexts, total: records.length }
  if (droppedSpecTexts > 0) truncated.specTexts = { dropped: droppedSpecTexts, total: specs.length }
  if (droppedQueueTexts > 0) truncated.queueTexts = { dropped: droppedQueueTexts, total: (queue.pending?.length ?? 0) + (queue.blocked?.length ?? 0) }
  return { ...shaped, records: keptRecords, specs: keptSpecs, queue: keptQueue, truncated }
}

/**
 * PURPOSE
 *   Derive the view on a worker thread and resolve with its CAPPED result, so parsing a
 *   large corpus and serialising a large view never run on the event loop that serves the
 *   harness. It is the cache-miss half of the service's `view`, and the reason a state
 *   request stays answerable while another project's corpus is being read.
 *
 * INPUTS
 *   options - `{ root }`. Any `root` value is forwarded unchanged; the worker's own
 *     `deriveDecisions` turns an unusable one into the empty view.
 *
 * OUTPUTS
 *   A Promise resolving to the capped view model. It rejects with an Error naming the
 *   failure when the worker cannot be created, reports an error, or exits before
 *   answering — never with a partial view, and never by falling back to a blocking
 *   derivation here.
 *
 * KEYWORDS
 *   worker thread, off the event loop, derive asynchronously, response cap, decisions service
 */
export function deriveDecisionsAsync({ root } = {}) {
  return new Promise((resolve, reject) => {
    let worker
    try {
      worker = new Worker(new URL('./ratchet-decisions-worker.mjs', import.meta.url), { workerData: { root } })
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }
    let settled = false
    const finish = (settle, value) => {
      if (settled) return
      settled = true
      worker.terminate().catch(() => {})
      settle(value)
    }
    worker.once('message', (message) => {
      if (message !== null && typeof message === 'object' && message.ok === true) finish(resolve, message.view)
      else {
        const detail = message !== null && typeof message === 'object' && typeof message.error === 'string' ? message.error : 'the decisions worker returned no usable view'
        finish(reject, new Error(detail))
      }
    })
    worker.once('error', (error) => finish(reject, error instanceof Error ? error : new Error(String(error))))
    worker.once('exit', (code) => {
      if (!settled) finish(reject, new Error(`the decisions worker exited with code ${String(code)} before returning a view`))
    })
  })
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
 *   `view` is ASYNC and memoises its result. On every call it computes
 *   {@link decisionsSignature} for the root; when the stored signature is equal it
 *   returns the cached view without touching the corpus, and otherwise it derives a new
 *   one on a worker thread through {@link deriveDecisionsAsync} and stores it under the
 *   signature it observed before the derivation. A corpus edit moves the signature, so
 *   the next call re-derives rather than serving the old view — that is the whole
 *   invalidation rule, and it needs no watcher. At most {@link CACHE_LIMIT} roots are
 *   remembered, so a long-lived process that is asked about many projects does not grow
 *   without bound.
 *
 * INPUTS
 *   None.
 *
 * OUTPUTS
 *   `{ view, rootFor }` — `view({ root })` returns a Promise of the view model above
 *   (synchronously resolved to the empty view for an unusable root); `rootFor(start)`
 *   resolves a project root. Never null.
 *
 * KEYWORDS
 *   cordis service, provide, host seam, adr panel, view model, cache, worker thread
 */
export function createDecisionsService() {
  const cache = new Map()
  return {
    view: async ({ root } = {}) => {
      if (typeof root !== 'string' || root.length === 0) return deriveDecisions({ root })
      const signature = decisionsSignature(root)
      const cached = cache.get(root)
      if (cached !== undefined && cached.signature === signature) return cached.view
      const view = await deriveDecisionsAsync({ root })
      if (cache.size >= CACHE_LIMIT && !cache.has(root)) cache.delete(cache.keys().next().value)
      cache.set(root, { signature, view })
      return view
    },
    rootFor: decisionsRootFor,
  }
}
