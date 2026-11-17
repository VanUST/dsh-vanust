/**
 * PURPOSE
 *   Mirror the requirements of an Analysis Record into the project state as REQ entities, so the
 *   record is the JUSTIFICATION of a requirement and `state/req/` is its register. One REQ per
 *   requirement, found again by `analysisRef`; a repeat upsert updates that REQ and never adds a
 *   second one.
 *
 * WHAT THIS MODULE DOES NOT DO
 *   It does not write the Analysis Record (the analysis service owns that) and it does not check
 *   readiness. It refuses only two things, BEFORE the record is written: a requirement without
 *   acceptance criteria (nothing to verify, `req_criteria_required`) and a NEW requirement that
 *   looks like an existing REQ while the caller has not reviewed the candidates
 *   (`req_duplicate_candidates`).
 *
 * THE CORE IS OPTIONAL
 *   Without `ccProjectState` (a composition that does not mount project-state) every function is
 *   a no-op and the analysis behaviour is exactly the old one.
 */

import { createHash } from 'node:crypto'

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'when', 'must', 'have', 'has', 'are', 'was', 'were', 'will', 'shall', 'each', 'every', 'their', 'them', 'they', 'than', 'then', 'also', 'only', 'over', 'under', 'after', 'before', 'while', 'where', 'which', 'what', 'there', 'here', 'such', 'same', 'other', 'some', 'any', 'all', 'not', 'but', 'can', 'may', 'should', 'would', 'could'])

/** planned -> proposed, proven -> done, deferred/rejected -> rejected (design §6). */
export function reqStatusOf(analysisStatus) {
  if (analysisStatus === 'proven') return 'done'
  if (analysisStatus === 'deferred' || analysisStatus === 'rejected') return 'rejected'
  return 'proposed'
}

/** The frozen criteria hash: a stable sha256 of the acceptance list. */
export function criteriaHashOf(criteria) {
  return createHash('sha256').update(JSON.stringify(Array.isArray(criteria) ? criteria.map(String) : []), 'utf8').digest('hex')
}

/** Lowercased content words of a text (or of a criteria list joined). */
export function tokensOf(value) {
  const text = Array.isArray(value) ? value.join(' ') : String(value ?? '')
  return new Set(text.toLowerCase().split(/[^a-z0-9\u0400-\u04ff]+/).filter((word) => word.length >= 4 && !STOP.has(word)))
}

/** Jaccard similarity of two token sets. */
export function similarity(a, b) {
  const left = tokensOf(a)
  const right = tokensOf(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  return shared / (left.size + right.size - shared)
}

/** The REQ already bound to one requirement of one record, or undefined. */
export function findExisting(rows, initiative, requirementId) {
  return rows.find((row) => row?.analysisRef?.initiative === initiative && row?.analysisRef?.requirementId === requirementId)
}

/** The REQ text of a requirement: its text, trimmed to the 140-char title bound. */
export function titleOf(requirement) {
  return String(requirement?.text ?? '').split('\n')[0].trim().slice(0, 140)
}

/**
 * Check the requirements of a patch BEFORE the record is written.
 *
 * @param {object} core - the ccProjectState service.
 * @param {{cwd: string, initiative: string, requirements: object[], allowDuplicate?: boolean, duplicateReview?: string}} input
 * @returns {ok: true} or {ok: false, code, message, …}
 */
export async function precheck(core, { cwd, initiative, requirements, allowDuplicate = false, duplicateReview = '' }) {
  if (core === undefined || core === null) return { ok: true, skipped: 'no-core' }
  // The host service is cwd-first with an `open(cwd)`; the raw core is already bound to a cwd.
  const state = typeof core.open === 'function' ? core.open(cwd) : core
  if (!Array.isArray(requirements) || requirements.length === 0) return { ok: true }
  let rows
  try {
    const listed = await state.list('req')
    if (listed?.ok === false) return { ok: true, skipped: 'core-unavailable' }
    rows = Array.isArray(listed.rows) ? listed.rows : []
  } catch {
    return { ok: true, skipped: 'core-unavailable' }
  }
  for (const requirement of requirements) {
    const id = String(requirement?.id ?? '')
    const acceptance = Array.isArray(requirement?.acceptance) ? requirement.acceptance.filter((item) => String(item).trim() !== '') : []
    if (acceptance.length === 0) {
      return {
        ok: false,
        code: 'req_criteria_required',
        requirementId: id,
        message: `requirement "${id}" has no acceptance criteria: a REQ without criteria cannot be verified; add acceptance or drop the requirement`,
      }
    }
    const existing = findExisting(rows, initiative, id)
    if (existing !== undefined) continue
    const candidates = rows
      .filter((row) => row?.analysisRef?.initiative !== initiative || row?.analysisRef?.requirementId !== id)
      .map((row) => ({ id: row.id, title: row.title, status: row.status, score: Math.max(similarity(requirement.text, row.title), similarity(acceptance, row.title)) }))
      .filter((candidate) => candidate.score >= 0.35)
      .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)))
      .slice(0, 3)
    const reviewed = allowDuplicate === true && String(duplicateReview ?? '').trim() !== ''
    if (candidates.length > 0 && !reviewed) {
      return {
        ok: false,
        code: 'req_duplicate_candidates',
        requirementId: id,
        candidates,
        message: `requirement "${id}" looks like existing REQ ${candidates.map((candidate) => candidate.id).join(', ')}; inspect them and repeat the upsert with allowDuplicate:true and a duplicateReview reason (or reword the requirement)`,
      }
    }
  }
  return { ok: true }
}

/**
 * Write the REQ for every requirement of the record (create or update), then regenerate the
 * projections so `digest.md` and `index.json` reflect the new links.
 *
 * @returns {{ok: boolean, reqs: object[], errors: object[]}}
 */
export async function mirror(core, { cwd, initiative, record }) {
  const result = { ok: true, reqs: [], errors: [] }
  if (core === undefined || core === null) return { ...result, skipped: 'no-core' }
  const state = typeof core.open === 'function' ? core.open(cwd) : core
  const requirements = Array.isArray(record?.requirements) ? record.requirements : []
  let rows = []
  try {
    const listed = await state.list('req')
    rows = Array.isArray(listed?.rows) ? listed.rows : []
  } catch {
    rows = []
  }
  for (const requirement of requirements) {
    if (Array.isArray(requirement?.acceptance) && requirement.acceptance.filter((item) => String(item).trim() !== '').length === 0) {
      result.errors.push({ requirementId: requirement.id, code: 'req_criteria_required', message: 'skipped: no acceptance criteria' })
      continue
    }
    const acceptance = Array.isArray(requirement.acceptance) ? requirement.acceptance.map(String) : []
    const analysisRef = { initiative, requirementId: String(requirement.id) }
    const payload = {
      title: titleOf(requirement),
      criteria: acceptance,
      status: reqStatusOf(requirement.status),
      criteriaHash: criteriaHashOf(acceptance),
      analysisRef,
      body: [String(requirement.text ?? ''), requirement.reason === undefined ? '' : `Reason: ${requirement.reason}`].filter((part) => part !== '').join('\n\n'),
    }
    const existing = findExisting(rows, initiative, requirement.id)
    try {
      if (existing === undefined) {
        const created = await state.create('req', payload)
        if (created?.ok === false) { result.errors.push({ requirementId: requirement.id, code: created.code, message: created.message }); continue }
        result.reqs.push({ requirementId: requirement.id, reqId: created.id, action: 'created' })
      } else {
        const updated = await state.update(existing.id, { expectedRevision: existing.revision, ...payload })
        if (updated?.ok === false) {
          // A stale revision here means another writer changed the REQ between list and update;
          // refetch once and retry, then report.
          const fresh = await state.get(existing.id)
          const retried = fresh?.ok === false ? { ok: false, code: fresh.code } : await state.update(existing.id, { expectedRevision: fresh.frontmatter.revision, ...payload })
          if (retried?.ok === false) { result.errors.push({ requirementId: requirement.id, code: retried.code, message: retried.message }); continue }
          result.reqs.push({ requirementId: requirement.id, reqId: existing.id, action: 'updated' })
          continue
        }
        result.reqs.push({ requirementId: requirement.id, reqId: existing.id, action: 'updated' })
      }
    } catch (error) {
      result.errors.push({ requirementId: requirement.id, code: 'mirror_failed', message: error instanceof Error ? error.message : String(error) })
    }
  }
  try {
    const views = await state.regenerateViews()
    if (views?.ok === false) result.errors.push({ code: 'views_failed', message: views.message })
  } catch (error) {
    result.errors.push({ code: 'views_failed', message: error instanceof Error ? error.message : String(error) })
  }
  result.ok = result.errors.length === 0
  return result
}
