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
 *     display facts.
 *
 * OUTPUTS
 *   `{ ok, id, path, authority, status, zones, steps, humanRequired, reason }`.
 *   `steps` is `[{ op, ... }]` where `op` is one of:
 *     - `declare-zone` — the zone is undeclared and its paths were inferred from the
 *       positive targets of the record's laws;
 *     - `widen-or-remap-zone` — a law targets a path its record's zones do not govern;
 *     - `human-authorship-required` — a `humanOnly` zone refuses an agent record, and
 *       authorship cannot be automated.
 *   `humanRequired` is true only when a step cannot be carried out by an agent. A
 *   record with no steps is already unblocked (or blocked for a reason this module does
 *   not model, which `reason` states).
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
    path: record.path ?? null,
    authority: record.authority ?? null,
    status: record.status ?? null,
    zones: Array.isArray(record.zones) ? [...record.zones] : [],
    steps: plan.steps,
    humanRequired: plan.humanRequired,
    reason: plan.steps.length === 0 ? 'no structural blocker was found for this record' : null,
  }
}
