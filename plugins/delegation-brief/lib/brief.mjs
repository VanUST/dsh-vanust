/**
 * PURPOSE
 *   Render a delegation BRIEF from the project state register, deterministically, and parse a
 *   worker's RETURN against the frozen criteria of that brief.
 *
 * WHY THE TEXT IS RENDERED AND NOT WRITTEN BY THE MODEL
 *   A brief that the orchestrator composes in prose drifts from the register: criteria get
 *   paraphrased, a decision is forgotten, a test command is mistyped. Here the text is a pure
 *   function of the REQ, its decisions, its tests and the caller's non-scope; the same input
 *   gives the same bytes, and `briefHash` is the sha256 of those bytes. The return is checked
 *   against that hash, so a brief whose criteria changed under the worker is refused.
 *
 * INPUTS (renderBrief)
 *   req        the REQ frontmatter (id, title, status, criteria[], body)
 *   decisions  decision frontmatter rows that link this REQ
 *   tests      TEST frontmatter rows that name this REQ (with command/testPath/evidenceRefs)
 *   nonScope   string[] the caller wants excluded (rendered verbatim)
 *   role       optional role label the brief is addressed to
 *
 * OUTPUT
 *   { text, briefHash, criteria: [{id, text}], status }
 */

import { createHash } from 'node:crypto'

export const RETURN_STATUSES = ['done', 'blocked', 'design_problem']

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
const byId = (a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? ''))
const clean = (value) => String(value ?? '').replace(/\r\n/g, '\n').trim()

/**
 * The REQ statuses a brief can be rendered for. `analysis_upsert` mirrors a planned
 * requirement to `proposed`, a proven one to `done` and a deferred/rejected one to
 * `rejected`; nothing in the tool surface writes `accepted`, so requiring it made the brief
 * unreachable. A planned or open requirement is briefable; a finished or rejected one is not.
 */
export const BRIEFABLE_REQ_STATUSES = ['proposed', 'open', 'accepted']

/** Is this REQ status one the register can produce AND a brief can render? */
export function briefableReq(status) {
  return BRIEFABLE_REQ_STATUSES.includes(String(status ?? ''))
}

/** The stable id of one acceptance criterion (position in the list is not an id). */
export function criterionId(reqId, text, index) {
  return `${reqId}-C${String(index + 1).padStart(2, '0')}`
}

/** The criteria of a REQ as `{id, text}` in declaration order. */
export function criteriaOf(req) {
  const list = Array.isArray(req?.criteria) ? req.criteria.map(clean).filter((item) => item !== '') : []
  return list.map((text, index) => ({ id: criterionId(req.id, text, index), text }))
}

/**
 * Render the brief.
 *
 * @returns {{ok: true, text: string, briefHash: string, criteria: object[]} | {ok: false, code, message}}
 */
export function renderBrief({ req, decisions = [], tests = [], nonScope = [], role = '' }) {
  if (req === undefined || req === null) return { ok: false, code: 'feature_required', message: 'no REQ to brief' }
  if (!briefableReq(req.status)) {
    return { ok: false, code: 'feature_required', message: `REQ ${req.id} is "${req.status}"; a brief is rendered for a planned or accepted requirement (${BRIEFABLE_REQ_STATUSES.join(', ')}), not for a finished or rejected one` }
  }
  const criteria = criteriaOf(req)
  if (criteria.length === 0) return { ok: false, code: 'criteria_missing', message: `REQ ${req.id} has no acceptance criteria` }
  const lines = []
  lines.push(`# Delegation brief: ${req.id}`)
  lines.push('')
  if (role !== '') lines.push(`Role: ${role}`)
  lines.push(`Requirement (verbatim from ${req.id}):`)
  lines.push('')
  lines.push(clean(req.title))
  lines.push('')
  lines.push('## Acceptance criteria (verbatim; return one entry per id)')
  lines.push('')
  for (const criterion of criteria) lines.push(`- ${criterion.id}: ${criterion.text}`)
  lines.push('')
  lines.push('## Related decisions')
  lines.push('')
  const decisionRows = [...decisions].sort(byId)
  if (decisionRows.length === 0) lines.push('(none recorded)')
  else for (const decision of decisionRows) lines.push(`- ${decision.id} [${decision.status}]: ${clean(decision.decision)}`)
  lines.push('')
  lines.push('## Tests that must pass')
  lines.push('')
  const testRows = [...tests].sort(byId)
  if (testRows.length === 0) lines.push('(none recorded; the return cannot claim a verified criterion)')
  else for (const test of testRows) {
    lines.push(`- ${test.id} [${test.status}] ${clean(test.title)}`)
    if (clean(test.command) !== '') lines.push(`  command: ${clean(test.command)}`)
    if (clean(test.testPath) !== '') lines.push(`  path: ${clean(test.testPath)}`)
    if (Array.isArray(test.evidenceRefs) && test.evidenceRefs.length > 0) lines.push(`  evidence: ${test.evidenceRefs.join(', ')}`)
  }
  lines.push('')
  lines.push('## Non-scope (do not touch)')
  lines.push('')
  const scopeRows = nonScope.map(clean).filter((item) => item !== '')
  if (scopeRows.length === 0) lines.push('(none stated)')
  else for (const item of scopeRows) lines.push(`- ${item}`)
  lines.push('')
  lines.push('## Checks')
  lines.push('')
  lines.push('Run the full gate ONCE, at the boundary of this task: batch the edits, then run the suite and quote the command, output and exit code. Do not rerun the gate after every edit.')
  lines.push('')
  lines.push('## Return format')
  lines.push('')
  lines.push('Return through `delegation_return` with this briefHash and an object:')
  lines.push('')
  lines.push('{')
  lines.push(`  "briefHash": "<this brief's hash>",`)
  lines.push('  "status": "done | blocked | design_problem",')
  lines.push('  "criteria": [{ "id": "<criterion id>", "pass": true|false, "evidence": "<command/output/observation>" }],')
  lines.push('  "questions": ["<open question>"]')
  lines.push('}')
  lines.push('')
  lines.push('Every criterion id above must appear exactly once; a criterion that is not in this brief is refused (return_unmapped).')
  const text = `${lines.join('\n')}\n`
  return { ok: true, text, briefHash: sha256(text), criteria }
}

/**
 * Parse and validate a return against the brief that produced `briefHash`.
 *
 * @param {{brief: {text, briefHash, criteria}, briefHash: string, returned: object}} input
 * @returns {{ok: true, status, criteria, questions, briefHash} | {ok: false, code, message}}
 */
export function parseReturn({ brief, briefHash, returned }) {
  if (briefHash !== brief.briefHash) {
    return { ok: false, code: 'brief_stale', message: `the briefHash ${String(briefHash).slice(0, 12)}… does not match the current criteria (${brief.briefHash.slice(0, 12)}…); a criterion changed since the brief was rendered — rerender it` }
  }
  if (returned === null || typeof returned !== 'object') return { ok: false, code: 'return_invalid', message: 'return must be an object' }
  if (!RETURN_STATUSES.includes(returned.status)) return { ok: false, code: 'return_invalid', message: `status must be one of ${RETURN_STATUSES.join(' | ')}` }
  const known = new Map(brief.criteria.map((criterion) => [criterion.id, criterion]))
  if (!Array.isArray(returned.criteria)) return { ok: false, code: 'return_invalid', message: 'criteria must be an array' }
  const seen = new Set()
  const mapped = []
  for (const entry of returned.criteria) {
    if (entry === null || typeof entry !== 'object') return { ok: false, code: 'return_invalid', message: 'every criterion entry must be an object' }
    const id = String(entry.id ?? '')
    if (!known.has(id)) {
      return { ok: false, code: 'return_unmapped', message: `criterion "${id}" is not in this brief; the brief's criteria are ${[...known.keys()].join(', ')}` }
    }
    if (seen.has(id)) return { ok: false, code: 'return_unmapped', message: `criterion "${id}" appears more than once` }
    seen.add(id)
    if (typeof entry.pass !== 'boolean') return { ok: false, code: 'return_invalid', message: `criterion "${id}" needs a boolean pass` }
    const evidence = clean(entry.evidence)
    if (entry.pass === true && evidence === '') return { ok: false, code: 'return_invalid', message: `criterion "${id}" passes without evidence` }
    mapped.push({ id, text: known.get(id).text, pass: entry.pass, evidence })
  }
  const missing = [...known.keys()].filter((id) => !seen.has(id))
  if (missing.length > 0) return { ok: false, code: 'return_unmapped', message: `criteria not returned: ${missing.join(', ')}` }
  const questions = Array.isArray(returned.questions) ? returned.questions.map(clean).filter((item) => item !== '') : []
  return { ok: true, briefHash: brief.briefHash, status: returned.status, criteria: mapped, questions }
}
