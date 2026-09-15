/**
 * PURPOSE
 *   The ratchet's host-side CONSENT SERVICE: the one seam a non-agent surface (the
 *   ADR panel's host half) uses to obtain the ratchet's own ratification question and
 *   to hand back the label a human selected. It exists so a UI never re-implements
 *   consent: this module builds no question and writes no record of its own, it calls
 *   `ratify` for both halves, and that function is what rebuilds the quiz, refuses a
 *   foreign one, refuses a stale text, and writes the approval and its transcript.
 *
 *   The service is a cordis service value, not a tool: `ratchet-tools.mjs` provides it
 *   under {@link CONSENT_SERVICE}, and the only caller in this kit is the ADR panel's
 *   HTTP route, which sits behind the browser trust fence. No tool, no CLI verb and no
 *   command argument reaches it, which is what keeps the consent surface exactly one
 *   surface wide.
 *
 * INPUTS
 *   `ask({ root, ids, at })` — `root` is an absolute project root (string), `ids` an
 *   array of decision-id strings or `null` for every decision waiting, `at` an ISO
 *   timestamp or `null` for now.
 *   `settle({ root, adrId, label, quiz, ids, askedBy, at, write })` — `adrId` names the
 *   record the human answered about, `label` is the exact string the human selected from
 *   the question's own options, and `quiz` is the question object `ask` returned
 *   unchanged. `write` defaults to true; `false` returns the artifacts without writing.
 *
 * OUTPUTS
 *   `ask` returns the canonical `ratify` result for "no answer yet": `{ ok, needsAnswer,
 *   attempt, pending, blocked, quiz, problems, summary, nextStep }` when at least one
 *   decision waits, and `{ ok, nothingToRatify, message, blocked, problems }` when none
 *   does. Nothing is written by either shape.
 *   `settle` returns the canonical `ratify` result for an answer: `ratified` and
 *   `wrote` name what was written, or `rejected` / `unreadable` / `changed` describe an
 *   answer that minted nothing, with `problems` carrying the stable codes. Its approval
 *   and transcript record {@link CONSENT_CHANNEL} rather than the harness seam's channel,
 *   because this service is how a surface that is NOT the seam records a consent.
 *   Neither function throws for a malformed call: a `quiz` that is missing, a `label`
 *   that is not a string and an `adrId` no question offered all reach `ratify`, whose
 *   own refusal is the answer. A caller that passes a non-string `root` gets the
 *   ratchet's own unreadable-project result rather than an exception.
 *
 * KEYWORDS
 *   ratification, consent service, cordis service, host route, ADR panel, quiz pairing,
 *   no composed answer, approval, transcript
 *
 * BEHAVIOUR ON EDGE CASES
 *   - `quiz` null or undefined with a `label`: `ratify` refuses with
 *     `RATIFICATION_UNPROVEN` and writes nothing, because an answer with no question is
 *     a string a caller typed.
 *   - `quiz` that is not the question the ratchet builds for the records waiting now:
 *     `ratify` refuses with `RATIFICATION_UNPROVEN`; the answer is never interpreted.
 *   - `adrId` that no question in the supplied quiz named: the constructed answer
 *     selects nothing, `deriveDecisions` reports it unreadable, and nothing is minted.
 *   - `label` that matches neither option of the question: unreadable, nothing minted.
 *   - `adrId` that is already in force, is not a decision, or whose zone resolves to
 *     `humanOnly`: the record is not in the queue, so `ratify` reports it as not waiting
 *     and nothing is minted.
 *   - A quiz answered twice: the second call finds the record no longer waiting, so the
 *     replay mints nothing.
 *   - `write: false`: the approval and transcript texts are returned in the result and
 *     no file is written, which is the dry-run the tests use.
 */
import { ratify, findRoot } from './ratchet-ops.mjs'
import { RATIFY_CHANNEL_PANEL } from './ratchet-ratify.mjs'

/**
 * The cordis service name the panel's host half reaches with `ctx.get`.
 *
 * One value, duplicated in the ADR panel because a cordis service name cannot be
 * imported across a package boundary this deployment packs independently (the ratchet
 * and the panel are two tarballs with no dependency between them). The ADR panel
 * declares the literal itself and `scripts/check-consent-surface.mjs` fails when the two
 * copies stop being equal, which is the only thing that keeps them honest — the same
 * arrangement as `RATIFY_INTENT_KIND`, and for the same reason.
 */
export const CONSENT_SERVICE = 'ratchetConsent'

/**
 * The channel every consent this service records is recorded under.
 *
 * The panel's route puts the ratchet's own question to the human in the decision window
 * and sends back the label they selected. That is the same `ratify` operation the tool
 * and the command call, but the harness user-questions seam did not carry the answer — so
 * recording `user-question` would write a false statement into a durable record. Both
 * values live in `RATIFICATION_CHANNELS`, and this one names the surface that did.
 */
export const CONSENT_CHANNEL = RATIFY_CHANNEL_PANEL

/**
 * Finds the question a supplied quiz asked about one record.
 *
 * The question id is the ratchet's private naming (`ratify-<id>`, `ratify-again-<id>`),
 * so it is never constructed here: it is read back out of the quiz's own `roles` map,
 * which `buildQuiz` built. A quiz that offered no question for the record yields `null`,
 * and the caller then sends an answer that selects nothing — which the ratchet reads as
 * unreadable and refuses, rather than this function inventing a question id for an
 * answer nobody asked for.
 *
 * @param quiz - The question object `ask` returned, or any value.
 * @param adrId - The record id the human answered about, or any value.
 * @returns The question id string, or `null`.
 */
function questionIdFor(quiz, adrId) {
  if (quiz === null || typeof quiz !== 'object') return null
  if (typeof adrId !== 'string' || adrId.length === 0) return null
  for (const [questionId, role] of Object.entries(quiz.roles ?? {})) {
    if (role !== null && typeof role === 'object' && role.adrId === adrId) return questionId
  }
  return null
}

/**
 * PURPOSE
 *   Obtain the ratification question the ratchet would put to a human for one project,
 *   without asking anyone. The caller renders it; nothing is written.
 *
 * INPUTS
 *   options — `{ root, ids, at }` as described in this module's header.
 *
 * OUTPUTS
 *   The `ratify` result for a call with no answer. `quiz` is present exactly when at
 *   least one decision waits, and it is the object that must be handed back unchanged to
 *   {@link settleConsent}.
 *
 * KEYWORDS
 *   ratification, prepare, quiz, question, no write, queue
 */
export function askConsent({ root, ids = null, at = null } = {}) {
  return ratify({ root, ids, at })
}

/**
 * PURPOSE
 *   Record the human's answer to a question the ratchet already built. The answer is
 *   the label the human selected out of that question's own options; everything else —
 *   which question it answers, whether it is still the question, whether the record may
 *   enter force, and what artifact a "yes" writes — is the ratchet's decision.
 *
 * INPUTS
 *   options — `{ root, adrId, label, quiz, ids, askedBy, at, write }` as described in
 *   this module's header.
 *
 * OUTPUTS
 *   The canonical `ratify` result. `ratified` and `wrote` are non-empty only when the
 *   label was the question's approve label, the quiz was the question the ratchet builds
 *   now, the record had not changed since the question was built, and the record waits
 *   for a human. Every other outcome carries `problems` with a stable code and writes
 *   nothing.
 *
 * KEYWORDS
 *   ratification, settle, consent, label, approval artifact, refusal
 */
export function settleConsent({
  root,
  adrId = null,
  label = null,
  quiz = null,
  ids = null,
  askedBy = 'unattributed',
  at = null,
  write = true,
  channel = CONSENT_CHANNEL,
} = {}) {
  const questionId = questionIdFor(quiz, adrId)
  const selected = typeof label === 'string' && label.length > 0 ? [label] : []
  // The answer is built ONLY from the question's own roles: the question id comes from
  // the supplied quiz, and the label is carried through unchanged for `deriveDecisions`
  // to compare against the options the question offered. Nothing here maps a decision
  // name onto a label, so a caller cannot answer with a word the ratchet never offered.
  const answer = { answers: questionId === null ? [] : [{ id: questionId, selected }] }
  return ratify({
    root,
    answer,
    quiz: quiz === null || quiz === undefined ? null : quiz,
    ids: Array.isArray(ids) && ids.length > 0 ? ids : typeof adrId === 'string' && adrId.length > 0 ? [adrId] : null,
    askedBy,
    at,
    write,
    channel,
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
export function consentRootFor(start) {
  if (typeof start !== 'string' || start.length === 0) return null
  try {
    return findRoot(start)
  } catch {
    return null
  }
}

/**
 * PURPOSE
 *   Build the value `ratchet-tools.mjs` provides as the {@link CONSENT_SERVICE} cordis
 *   service. It is a plain object of the two operations above, so the panel's host half
 *   reaches one stable shape with `ctx.get` and this module keeps every consent decision
 *   inside the ratchet.
 *
 * INPUTS
 *   None.
 *
 * OUTPUTS
 *   `{ ask, settle, rootFor }` — the two operations plus root resolution, each a
 *   function with the contracts above. Never null.
 *
 * KEYWORDS
 *   cordis service, provide, host seam, adr panel
 */
export function createConsentService() {
  return { ask: askConsent, settle: settleConsent, rootFor: consentRootFor }
}
