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
 *     - `problems` — every problem the manifest, the corpus and the queue reported,
 *       so a caller can show why a project is not green.
 *   A null/empty `root` returns `{ ok:false, root, records:[], queue:{...empty}, specs:[],
 *   drift:{...empty}, problems:[MANIFEST_MISSING-like] }` and never throws.
 *
 * KEYWORDS
 *   decisions service, cordis service, host route, ADR panel, view model, in force,
 *   consent match, ratify queue, spec documents, one source of truth
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
import { detectSpecDrift } from './ratchet-state.mjs'
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
 *   Build the complete view model the ADR panel window renders, from the ratchet's own
 *   functions. It is a composition of facts, never a second implementation: every force
 *   fact comes from `resolveActiveSet`, every queue fact from `ratificationQueue`, every
 *   spec fact from `compileProject`/`renderSpecs`/`detectSpecDrift`.
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
