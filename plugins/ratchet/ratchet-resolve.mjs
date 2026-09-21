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
     * Whether the outstanding findings warrant ONE automatic dispatch, and the prompt it
     * would carry. The ratchet owns this because the findings, the steps that clear them and
     * the cooldown are all its own facts; the host only carries the request and starts the
     * child. It decides nothing about record ids and mints nothing.
     */
    autoResolve: ({ root, needs = [], specHash = null, now = Date.now(), cooldownMs = DISPATCH_COOLDOWN_MS } = {}) => {
      const findings = clearableFindings(needs)
      const keys = findings.map((finding) => finding.key)
      const decision = resolveDispatchDue(root, keys, { now, cooldownMs, specHash })
      return { ...decision, keys, findings, prompt: decision.due ? findingPrompt(root, findings) : null }
    },
    /** Records that one dispatch happened, so the same findings are not re-sent in a row. */
    noteDispatch: ({ root, keys = [], specHash = null, at = null } = {}) => recordResolveDispatch(root, { keys, specHash, at }),
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

/** The ledger event one automatic resolver dispatch is recorded as. */
export const RESOLVE_DISPATCH_EVENT = 'ratchet.resolve.dispatched'

/**
 * How long the same finding set is left alone after a dispatch, in milliseconds.
 *
 * A finding the resolver cannot clear would otherwise be re-dispatched on every state read,
 * which is a model turn per panel open. Thirty minutes is long enough for a resolver to make
 * progress and short enough that a project is not stranded.
 */
const DISPATCH_COOLDOWN_MS = 30 * 60 * 1000

/**
 * The steps that clear one needs-a-human finding WITHOUT a human decision.
 *
 * Only findings whose fix is a command are listed. A consent is a human answer, a
 * contradiction or a duplicate is a human ratification, and a blocked record may need a
 * human author — none of those is resolvable here, and offering them would be the
 * automation that decides for the human, which the ratchet forbids.
 *
 * @param need - One `needsHuman` entry.
 * @returns An array of `{ op, detail }` steps; empty when the finding is not automatable.
 */
export function findingSteps(need) {
  const kind = need === null || need === undefined ? '' : String(need.kind)
  if (kind === 'stale-spec') {
    return [
      {
        op: 'compile-write',
        detail: `run \`node plugins/ratchet/ratchet-cli.mjs compile --write\` so ${String(need.id)} is regenerated from the laws now in force`,
      },
    ]
  }
  if (kind === 'red-gate') {
    return [
      { op: 'compile-write', detail: 'regenerate the spec bundle with `ratchet-cli.mjs compile --write` so it matches the current laws' },
      {
        op: 'verify',
        detail:
          're-run `ratchet-cli.mjs verify` against the current laws and code, then fix what each problem names — a CODE_* problem is about the code or the check, so read the law and the target before changing either',
      },
    ]
  }
  if (kind === 'review') {
    return [
      {
        op: 'corpus-review',
        detail:
          'run the corpus review, which needs a judge: call the `ratchet_compile` tool (it runs the review automatically when the law set has no recorded one) or `ratchet_review` with job "review_corpus", and report the findings it records',
      },
    ]
  }
  return []
}

/**
 * The findings an automatic resolver may act on, with a stable key each.
 *
 * @param needs - The whole `needsHuman` set.
 * @returns `[{ key, kind, id, title, steps }]` for the automatable ones, in the order given.
 *   A finding with no steps is absent, so the resolver is never told to do something a human
 *   must do.
 */
export function clearableFindings(needs) {
  const out = []
  for (const need of Array.isArray(needs) ? needs : []) {
    const steps = findingSteps(need)
    if (steps.length === 0) continue
    out.push({ key: `${String(need.kind)}:${String(need.id)}`, kind: String(need.kind), id: need.id, title: need.title ?? null, steps })
  }
  return out
}

/**
 * Builds the resolver prompt for a set of FINDINGS (not records).
 *
 * @param root - Absolute project root, named so the child knows where to work.
 * @param findings - The `clearableFindings` result.
 * @returns A prompt string. Empty when there is nothing to act on.
 */
export function findingPrompt(root, findings) {
  const list = Array.isArray(findings) ? findings : []
  if (list.length === 0) return ''
  const lines = [
    'Clear the outstanding ratchet findings in this project.',
    '',
    `Project root: ${root}`,
    '',
    'Findings:',
  ]
  for (const finding of list) {
    lines.push(`- ${finding.kind} ${String(finding.id)}${finding.title === null || finding.title === undefined ? '' : ` — ${finding.title}`}`)
    for (const step of finding.steps) lines.push(`  - ${step.detail}`)
  }
  lines.push('')
  lines.push('Work from the project root. Do NOT approve, decline or ratify anything, do not write `authority: human`, and do not edit a decision record to make a check pass: put right what each finding names, or report why it cannot be put right without a human decision.')
  lines.push('When you are done, run `node plugins/ratchet/ratchet-cli.mjs compile` and `node plugins/ratchet/ratchet-cli.mjs verify` from the project root and report exactly what changed and what the gate now says.')
  return lines.join('\n')
}

/**
 * Records one automatic dispatch, so the same finding set is not dispatched twice in a row.
 *
 * @param root - Absolute project root.
 * @param keys - The finding keys that were dispatched.
 * @param specHash - The law-set hash at dispatch time, so a corpus change re-arms it.
 * @param at - Optional ISO timestamp (tests); defaults to now.
 * @returns `{ ok, recorded }`.
 */
export function recordResolveDispatch(root, { keys = [], specHash = null, at = null } = {}) {
  const fields = { keys: [...keys].sort(), specHash }
  if (typeof at === 'string' && at.length > 0) fields.at = at
  const written = appendLedger(root, RESOLVE_DISPATCH_EVENT, fields)
  return { ok: written.error === undefined, recorded: written.error === undefined, path: written.path ?? null, error: written.error }
}

/**
 * Reads back the most recent automatic dispatch.
 *
 * @param root - Absolute project root.
 * @returns `{ at, keys, specHash }`, or `null` when none was ever recorded.
 */
export function lastResolveDispatch(root) {
  const ledger = readLedger(root)
  if (ledger.error !== undefined) return null
  const events = (ledger.events ?? []).filter((event) => event?.event === RESOLVE_DISPATCH_EVENT)
  const last = events[events.length - 1]
  if (last === undefined) return null
  return {
    at: typeof last.at === 'string' ? last.at : null,
    keys: Array.isArray(last.keys) ? last.keys.filter((key) => typeof key === 'string') : [],
    specHash: typeof last.specHash === 'string' ? last.specHash : null,
  }
}

/**
 * Decides whether an automatic dispatch is DUE, and why.
 *
 * A dispatch that is not recorded is one that will happen again on every state read. The
 * decision is conservative in the direction that costs nothing: it re-arms when the finding
 * SET changes, when the law set changes, or when the cooldown has lapsed, and it declines
 * only while the same findings are still outstanding under the same laws inside the window.
 *
 * @param root - Absolute project root.
 * @param keys - The finding keys the caller would dispatch.
 * @param options - `{ now, cooldownMs, specHash }`; `now` and the cooldown are injectable so
 *   a test drives the window without waiting.
 * @returns `{ due, reason }`.
 */
export function resolveDispatchDue(root, keys, { now = Date.now(), cooldownMs = DISPATCH_COOLDOWN_MS, specHash = null } = {}) {
  const wanted = [...(Array.isArray(keys) ? keys : [])].sort()
  if (wanted.length === 0) return { due: false, reason: 'nothing automatable is outstanding' }
  const last = lastResolveDispatch(root)
  if (last === null) return { due: true, reason: 'no automatic dispatch has been recorded' }
  if (JSON.stringify(last.keys) !== JSON.stringify(wanted)) return { due: true, reason: 'the set of outstanding findings changed' }
  if (last.specHash !== null && specHash !== null && last.specHash !== specHash) return { due: true, reason: 'the law set changed since the last attempt' }
  const at = last.at === null ? NaN : Date.parse(last.at)
  if (!Number.isFinite(at)) return { due: true, reason: 'the last dispatch records no readable time' }
  const elapsed = now - at
  if (elapsed >= cooldownMs) return { due: true, reason: `the cooldown lapsed (${Math.round(elapsed / 60000)} min)` }
  return { due: false, reason: `dispatched ${Math.round(elapsed / 60000)} min ago for these same findings, under these same laws` }
}
