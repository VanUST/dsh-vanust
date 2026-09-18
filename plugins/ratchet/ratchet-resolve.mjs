/**
 * PURPOSE
 *   Turn "this decision cannot enter force" into the concrete steps that would
 *   unblock it, so a blocked record is a pending item with a plan rather than a
 *   dead end. It is the deterministic half of automatic resolution: it reads the
 *   manifest, the record and the compiler's problems, and names what has to change.
 *   It changes nothing — no file, no record, no manifest.
 *
 * INPUTS
 *   `resolveStepsFor(record, config, problems)` — a parsed record, the parsed
 *     ratchet configuration and the compiler's problem list. Pure.
 *   `resolvePlan(root, id)` — an absolute root and a record id; reads the manifest,
 *     the corpus and a fresh compile, and returns the same steps plus the record's
 *     display facts and the reasons a human already declined.
 *   `recordResolveDecline(root, { id, comment, at })` — appends one refusal with its
 *     reason to the ledger; mints nothing.
 *   `resolveHistory(root, id)` — reads those refusals back, newest first.
 *   `resolverPrompt(plan, declines)` — the ratchet's own task text for a resolver child.
 *   `resolveRootFor(start)` — the Session workspace resolved to the project root.
 *   `createResolveService()` — the `ratchetResolve` cordis service the panel host
 *     reaches all of the above through, including `rootFor`.
 *
 * OUTPUTS
 *   `{ ok, id, title, path, authority, status, zones, steps, humanRequired, declined,
 *   reason }`.
 *   `steps` is `[{ op, ... }]` where `op` is one of:
 *     - `declare-zone` — the zone is undeclared and its paths were inferred from the
 *       positive targets of the record's laws;
 *     - `widen-or-remap-zone` — a law targets a path its record's zones do not govern;
 *     - `human-authorship-required` — a `humanOnly` zone refuses an agent record, and
 *       authorship cannot be automated.
 *   `humanRequired` is true only when a step cannot be carried out by an agent. A
 *   record with no steps is already unblocked (or blocked for a reason this module does
 *   not model, which `reason` states). `declined` is `[{ at, comment }]`, newest first
 *   and capped, so a resolution can be told what a human already rejected.
 *   `resolverPrompt` marks each step `[you]` or `[human only]` and repeats the declined
 *   reasons, and it never instructs a child to put anything into force.
 *
 * KEYWORDS
 *   blocked decision, resolve plan, automatic resolution, undeclared zone, zone
 *   inference, authorship, pending resolution
 *
 * BEHAVIOUR ON EDGE CASES
 *   - An unknown id: `ok:false` with a reason; never a throw.
 *   - An unreadable manifest: `ok:false` with `unusable:true`.
 *   - An undeclared zone whose records declare no law with a check target: a
 *     `declare-zone` step with no paths and a detail saying the paths could not be
 *     inferred, rather than an invented path.
 *   - An approval record: no steps; an approval declares no law and governs nothing.
 *   - A record whose only blocker is authorship: one step, `humanRequired: true`, and no
 *     automatable step — the caller must not offer a "resolve" action for it.
 */
import { checkTargets, compileProject, readAdrCorpus, readManifest, zonesForRecord } from './ratchet-compiler.mjs'
import { appendLedger, readLedger } from './ratchet-state.mjs'
import { findRoot } from './ratchet-ops.mjs'

/**
 * The cordis service the resolution is reached through.
 *
 * Like the consent and decision services it is PROVIDED, never registered as a tool:
 * a route that triggers a resolution must call the ratchet's own plan and prompt, and
 * a tool surface that accepted a resolve request would be a second way to start one.
 */
export const RESOLVE_SERVICE = 'ratchetResolve'

/** The ledger event a human's refusal of a proposed resolution is recorded as. */
export const RESOLVE_DECLINED_EVENT = 'ratchet.resolve.declined'

/** The most recent declines one plan reports back, so a long history cannot flood a prompt. */
const MAX_DECLINES = 5

/** The longest reason stored, in characters. */
const MAX_COMMENT = 2000

/**
 * Infers the paths an undeclared zone must govern.
 *
 * @param record - A parsed record.
 * @param config - The parsed ratchet configuration.
 * @returns The sorted union of the positive targets of the record's laws. Empty when
 *   no law declares a check with a target, which is reported rather than guessed.
 */
function inferZonePaths(record, config) {
  const targets = new Set()
  for (const law of record.laws ?? []) {
    for (const check of law.checks ?? []) {
      for (const path of checkTargets(check, config)) targets.add(path)
    }
  }
  return [...targets].sort()
}

/**
 * Derives the steps that would unblock one record.
 *
 * @param record - A parsed record (the corpus shape, carrying `zones` and `laws`).
 * @param config - The parsed ratchet configuration.
 * @param problems - The compiler's problem list, defaulting to none.
 * @returns `{ steps, humanRequired }`.
 */
export function resolveStepsFor(record, config, problems = []) {
  const zones = config?.zones ?? []
  const declared = new Set(zones.map((zone) => zone.id))
  const steps = []

  for (const zoneId of record.zones ?? []) {
    if (declared.has(zoneId)) continue
    const paths = inferZonePaths(record, config)
    steps.push({
      op: 'declare-zone',
      zone: zoneId,
      paths,
      agentAuthority: config?.defaultAgentAuthority ?? 'proposeOnly',
      detail:
        paths.length === 0
          ? `zone "${zoneId}" is not declared and none of the laws that use it has a check target to infer paths from; declare it by hand or point the record at a declared zone`
          : `declare zone "${zoneId}" with ${paths.join(', ')} (inferred from the laws that use it), or point the record at a declared zone that governs them`,
    })
  }

  for (const problem of problems) {
    if (problem.code !== 'LAW_PATH_OUTSIDE_DECLARED_ZONE') continue
    if (problem.subject !== record.id) continue
    steps.push({
      op: 'widen-or-remap-zone',
      lawId: typeof problem.lawId === 'string' ? problem.lawId : null,
      target: typeof problem.target === 'string' ? problem.target : null,
      detail: `law "${problem.lawId}" enforces against ${problem.target}, which none of the record's zones govern: add that path to a declared zone the record uses, or move the law under a zone that governs it`,
    })
  }

  const humanOnly = zonesForRecord(record, config).filter((zone) => zone.agentAuthority === 'humanOnly')
  if (record.authority === 'agent' && record.type !== 'approval' && humanOnly.length > 0) {
    steps.push({
      op: 'human-authorship-required',
      zone: humanOnly[0].id,
      detail: `zone "${humanOnly[0].id}" is humanOnly and refuses an agent-authored record however a human answers: a human authors the record, or the zone's authority changes (which is itself a decision)`,
    })
  }

  return { steps, humanRequired: steps.some((step) => step.op === 'human-authorship-required') }
}

/**
 * Reads a project and returns the plan for one record.
 *
 * @param root - Absolute project root.
 * @param id - The record id.
 * @returns `{ ok, id, ... }` as described in this module's OUTPUTS.
 */
export function resolvePlan(root, id) {
  const manifest = readManifest(root)
  if (manifest.config === null) {
    return { ok: false, unusable: true, id, steps: [], humanRequired: false, reason: 'the manifest could not be read' }
  }
  const config = manifest.config
  const corpus = readAdrCorpus(root, config)
  const record = (corpus.records ?? []).find((candidate) => candidate.id === id) ?? null
  if (record === null) {
    return { ok: false, id, steps: [], humanRequired: false, reason: `no record "${id}" is in the corpus` }
  }
  const compiled = compileProject(root)
  const plan = resolveStepsFor(record, config, compiled.problems)
  return {
    ok: true,
    id,
    title: record.title ?? null,
    path: record.path ?? null,
    authority: record.authority ?? null,
    status: record.status ?? null,
    zones: Array.isArray(record.zones) ? [...record.zones] : [],
    steps: plan.steps,
    humanRequired: plan.humanRequired,
    // The human's earlier refusals, newest first, read back from the ledger so a
    // resolution offered now can differ from one already rejected.
    declined: resolveHistory(root, id).declines,
    reason: plan.steps.length === 0 ? 'no structural blocker was found for this record' : null,
  }
}

/**
 * Resolves a directory to the project root the resolve route serves.
 *
 * The Session's workspace is the only source: the panel's host half hands this function
 * the directory it read for the Session, and gets back the nearest ancestor carrying
 * `.dsh/project.json`. A non-string input or an unreadable tree is `null` rather than a
 * throw, so an unknown Session is a named refusal and never an exception out of a handler.
 *
 * @param start - A directory path, or `null`/`undefined`.
 * @returns The absolute project root, or `null` when there is none in the search bound.
 */
export function resolveRootFor(start) {
  if (typeof start !== 'string' || start.length === 0) return null
  try {
    return findRoot(start)
  } catch {
    return null
  }
}

/**
 * The value the ratchet provides as the {@link RESOLVE_SERVICE} cordis service.
 *
 * The panel's host half reaches the resolution through this and nothing else, exactly as
 * it reaches the consent through the consent service: it derives no step, builds no
 * prompt and records no refusal of its own. Every method is synchronous and reads or
 * appends only the ratchet's own files.
 *
 * @returns `{ plan, decline, history, rootFor, prompt }`.
 */
export function createResolveService() {
  return {
    /** The plan for one record, including the human's earlier refusals. */
    plan: ({ root, id } = {}) => resolvePlan(root, id),
    /** Records one refusal with its reason; mints nothing and changes no record. */
    decline: ({ root, id, comment = null, at = null } = {}) => recordResolveDecline(root, { id, comment, at }),
    /** The reasons a human already declined for one record. */
    history: ({ root, id } = {}) => resolveHistory(root, id),
    /** The project root a Session workspace belongs to; the route resolves it from the Session. */
    rootFor: resolveRootFor,
    /**
     * The ratchet's own resolver prompt for one record OR a batch, plus the plans it was
     * built from. `ids` is the batch form the panel dispatches when it closes; `id` stays
     * for a single record. A record whose plan cannot be built is left out of the prompt
     * and its reason is returned instead, so one bad id cannot stop the rest.
     */
    prompt: ({ root, id = null, ids = null } = {}) => {
      const wanted = Array.isArray(ids) && ids.length > 0 ? ids : id === null || id === undefined ? [] : [id]
      if (wanted.length === 0) return { ok: false, id: null, ids: [], plan: null, plans: [], skipped: [], prompt: null, reason: 'no record was named' }
      const plans = wanted.map((entry) => resolvePlan(root, entry))
      const usable = plans.filter((plan) => plan.ok === true)
      const skipped = plans.filter((plan) => plan.ok !== true).map((plan) => ({ id: plan.id ?? null, reason: plan.reason ?? 'the plan could not be built' }))
      if (usable.length === 0) return { ok: false, id: wanted[0], ids: wanted, plan: plans[0] ?? null, plans, skipped, prompt: null, reason: skipped[0]?.reason ?? 'no plan could be built' }
      return { ok: true, id: usable[0].id, ids: usable.map((plan) => plan.id), plan: usable[0], plans: usable, skipped, prompt: resolverPrompt(usable) }
    },
  }
}

/**
 * Whether one plan step can be carried out by an agent.
 *
 * `human-authorship-required` cannot: a `humanOnly` zone refuses an agent record however
 * a human answers, and the alternative — an agent writing `authority: human` — is the
 * one act the deployment forbids. Every other step is a file or manifest edit an agent
 * may make.
 *
 * @param step - One `resolveStepsFor` step.
 * @returns `true` when an agent may carry the step, `false` when only a human may.
 */
export function stepIsAutomated(step) {
  return step !== null && typeof step === 'object' && step.op !== 'human-authorship-required'
}

/**
 * Records one human refusal of a proposed resolution, with the reason they gave.
 *
 * This is what makes a decline actionable rather than terminal: the reason is appended
 * to the same append-only ledger the rest of the ratchet's history lives in, and the
 * next plan for that record reads it back, so a resolver is told what was already
 * rejected instead of proposing it again. It writes no record, changes no manifest and
 * mints no consent — a refusal records nothing into force, and this cannot approve.
 *
 * @param root - Absolute project root.
 * @param id - The blocked record id.
 * @param comment - The human's reason, or `null`/empty for a silent decline.
 * @param at - Optional ISO timestamp for the event (tests); defaults to now.
 * @returns `{ ok, id, comment, recorded, path }`; `recorded` is false when the ledger
 *   could not be appended to, which is reported rather than passed off as success.
 */
export function recordResolveDecline(root, { id, comment = null, at = null } = {}) {
  const reason = typeof comment === 'string' && comment.trim().length > 0 ? comment.trim().slice(0, MAX_COMMENT) : null
  const fields = { id, comment: reason }
  if (typeof at === 'string' && at.length > 0) fields.at = at
  const written = appendLedger(root, RESOLVE_DECLINED_EVENT, fields)
  return { ok: written.error === undefined, id, comment: reason, recorded: written.error === undefined, path: written.path ?? null, error: written.error }
}

/**
 * Reads back the reasons a human has declined a resolution for one record.
 *
 * @param root - Absolute project root.
 * @param id - The blocked record id.
 * @returns `{ declines, skipped }`, newest first and capped at {@link MAX_DECLINES}.
 *   `declines` is `[{ at, comment }]`; a silent decline carries `comment: null`.
 */
export function resolveHistory(root, id) {
  const ledger = readLedger(root)
  if (ledger.error !== undefined) return { declines: [], skipped: ledger.skipped ?? 0, error: ledger.error }
  const declines = (ledger.events ?? [])
    .filter((event) => event?.event === RESOLVE_DECLINED_EVENT && event.id === id)
    .map((event) => ({ at: typeof event.at === 'string' ? event.at : null, comment: typeof event.comment === 'string' && event.comment.length > 0 ? event.comment : null }))
    .reverse()
    .slice(0, MAX_DECLINES)
  return { declines, skipped: ledger.skipped ?? 0 }
}

/**
 * The key that decides whether two plan steps are the SAME step.
 *
 * Six blocked records in one project are usually blocked by one zone map, so their plans
 * repeat: four `declare-zone art` lines are one decision about one zone, and an agent told to
 * make that decision four times can make it four different ways. Two steps merge when they
 * name the same operation, zone, law and target; anything else is a genuinely separate step.
 *
 * @param step - One `resolveStepsFor` step.
 * @returns A string key. Two steps with the same key are the same step.
 */
function stepKey(step) {
  return [step?.op ?? '', step?.zone ?? '', step?.lawId ?? '', step?.target ?? ''].join('\u0000')
}

/**
 * The records a batch covers, in the order the caller named them.
 *
 * @param plans - An array of `resolvePlan` results, or anything.
 * @returns The plans, each kept once, with entries that name no record dropped.
 */
function planSet(plans) {
  const seen = new Set()
  const kept = []
  for (const plan of Array.isArray(plans) ? plans : []) {
    if (plan === null || plan === undefined || typeof plan.id !== 'string' || plan.id === '') continue
    if (seen.has(plan.id)) continue
    seen.add(plan.id)
    kept.push(plan)
  }
  return kept
}

/**
 * Builds the task prompt a resolver child is spawned with, for ONE record or a batch.
 *
 * It is the ratchet's own text, not the transport's: the transport passes record ids and gets
 * an opaque string, so it can neither invent a step nor drop one. **Steps shared by several
 * records are stated ONCE**, because that is what they are — one zone declared in one manifest
 * edit — and because six agents each making the same judgement is how a manifest gets six
 * different answers. A step only one record needs stays under that record.
 *
 * The prompt marks each step `[you]` or `[human only]`, carries every reason a human already
 * declined, and never instructs a child to put anything into force.
 *
 * @param plans - One `resolvePlan` result, or an array of them.
 * @param declines - Extra declines for the single-record form. A plan's own `declined` is
 *   always read, so the route never has to fetch it separately.
 * @returns A prompt string. A batch of no records is stated as nothing to resolve.
 */
export function resolverPrompt(plans, declines = []) {
  const list = planSet(Array.isArray(plans) ? plans : [plans])
  if (list.length === 0) return 'No blocked record was named, so there is nothing to resolve.'
  const single = list.length === 1
  const lines = []
  lines.push(single ? 'Resolve a blocked architecture decision record in this project.' : `Resolve ${list.length} blocked architecture decision records in this project.`)
  lines.push('')
  if (single) {
    const plan = list[0]
    lines.push(`Record: ADR ${plan.id}${plan.title === undefined || plan.title === null ? '' : ` — ${plan.title}`}`)
    if (typeof plan.path === 'string' && plan.path.length > 0) lines.push(`File: ${plan.path}`)
    if (typeof plan.reason === 'string' && plan.reason.length > 0) lines.push(`Status: ${plan.reason}`)
  } else {
    lines.push('The records:')
    for (const plan of list) {
      lines.push(`- ADR ${plan.id}${typeof plan.title === 'string' && plan.title !== '' ? ` — ${plan.title}` : ''}${typeof plan.path === 'string' && plan.path !== '' ? ` (${plan.path})` : ''}`)
    }
  }
  lines.push('')

  // One bucket per distinct step, with every record that needs it. Insertion order is the
  // order the records were named, so the same input always produces the same prompt.
  const buckets = new Map()
  for (const plan of list) {
    for (const step of Array.isArray(plan.steps) ? plan.steps : []) {
      const key = stepKey(step)
      if (!buckets.has(key)) buckets.set(key, { step, ids: [] })
      buckets.get(key).ids.push(plan.id)
    }
  }
  const entries = [...buckets.values()]
  const shared = entries.filter((entry) => entry.ids.length > 1)
  const once = entries.filter((entry) => entry.ids.length === 1)
  const render = (entry) => {
    const step = entry.step
    const where =
      (typeof step.zone === 'string' ? ` (zone ${step.zone})` : '') + (typeof step.target === 'string' ? ` (target ${step.target})` : '')
    return `- ${stepIsAutomated(step) ? '[you]' : '[human only]'} ${String(step.op)}${where}: ${typeof step.detail === 'string' ? step.detail : ''}`
  }

  if (entries.length === 0) {
    lines.push('No structural step was found; inspect the records and the gate report yourself.')
  } else {
    lines.push(single ? 'The deterministic plan names these steps:' : 'Shared steps — do each ONCE, and decide it once:')
    for (const entry of shared) lines.push(render(entry))
    if (!single && once.length > 0) {
      lines.push('')
      lines.push('Steps one record needs:')
    }
    for (const entry of once) lines.push(`${render(entry)}${single ? '' : `  [for ADR ${entry.ids[0]}]`}`)
  }
  lines.push('')

  const reasons = []
  for (const plan of list) {
    for (const entry of Array.isArray(plan.declined) ? plan.declined : []) {
      if (entry !== null && typeof entry.comment === 'string' && entry.comment.length > 0) reasons.push({ id: plan.id, comment: entry.comment })
    }
  }
  for (const entry of Array.isArray(declines) ? declines : []) {
    if (entry !== null && typeof entry.comment === 'string' && entry.comment.length > 0) reasons.push({ id: null, comment: entry.comment })
  }
  if (reasons.length > 0) {
    lines.push('A human has ALREADY DECLINED a resolution here. Do not propose what these reasons rejected; address them instead:')
    for (const entry of reasons) lines.push(`- ${entry.id === null ? '' : `ADR ${entry.id}: `}${entry.comment}`)
    lines.push('')
  }

  lines.push('Carry out every step marked [you]. Leave every step marked [human only] to the human and say so — never write `authority: human`, and never put a record into force: your proposal is `proposed` and a human ratifies it.')
  lines.push('Run `node plugins/ratchet/ratchet-cli.mjs compile` and `node plugins/ratchet/ratchet-cli.mjs verify` from the project root when you are done, and report exactly what you changed and what the gate now says.')
  return lines.join('\n')
}
