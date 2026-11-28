/**
 * PURPOSE
 *   Deliver the project state to a ROOT session: L1 once as the first model-visible message,
 *   then L2 — one aggregated delta — at a turn boundary only when the projection hash changed.
 *   A delegated worker gets nothing; a workspace without `state/views/digest.md` gets nothing.
 *
 * WHY THE PRE-STEP DECISION AND NOT `agent.inject()` FROM INSIDE THE HOOK
 *   `agent.inject()` is synchronous but it does not deliver into the step that is being
 *   prepared: `preStep` claims the step's batch BEFORE it runs the `agent/pre-step` waterfall
 *   (dsh-agent-loop/lib/index.js:683 then :698), and `inject` routes the message to the
 *   "next-step" inbox with `wakeup = false` (:585-587, :573-577). The harness documents the
 *   consequence: injected context "may miss a request whose pre-step already claimed its batch;
 *   idle drivers leave it pending until follow-up or steering wakes them" (docs/subsystems/core.md
 *   :135-143), and "input inserted after the claim stays pending" (:385). So a delta injected
 *   from inside the hook could never join the turn boundary that asked for it; it sat in the
 *   inbox, and when that turn had no further step it stayed there with no driver wake — the
 *   "delta arrives, then the turn stops" symptom.
 *
 *   The boundary that owns "what enters this step" is the waterfall's decision. The harness's
 *   own pre-step participant uses it (dsh-agent-instructions/lib/index.js:1480-1497: await
 *   next(), then return `{...decision, messages: ...}`), and the loop appends those messages
 *   to the session as `user/message` (dsh-agent-loop/lib/index.js:873-878). This plugin does
 *   the same: it never writes the session from inside the hook, the delta enters the step that
 *   was about to start, and it is still logged as a user/message with `source.kind: state-feed`.
 *
 * LIFECYCLE
 *   - `agent/created` (root, state present): compose L1 from digest + plan + snapshot, inject
 *     once, remember the projection hash. L1 is never edited or repeated. This handler is not a
 *     waterfall and does not gate a step, so `inject` is safe here.
 *   - `agent/pre-step`: await the rest of the waterfall, then return its decision with at most
 *     one message added — L1 prepended if the created hook missed it, otherwise one aggregated
 *     L2 appended after the step's claimed batch, and only when `step === 1`, the turn is new
 *     and the projection hash changed. A second change inside the same turn is not delivered
 *     (the next turn picks the newest hash up).
 *   - Any failure is swallowed: a workspace whose state is unreadable must not break a turn.
 */

import { composeL1, composeL2, readState, stateMessage } from './lib/feed.mjs'

export const name = '@cc/dsh-state-feed'
export const inject = []

/** Lineage test: a delegated child is not a root, whatever its depth reports. */
export function isRootAgent(agent) {
  const header = agent?.session?.header
  if (header === undefined) return false
  const depth = Number(header.delegationDepth ?? 0)
  if (Number.isFinite(depth) && depth > 0) return false
  if (typeof header.parentSession === 'string' && header.parentSession !== '') return false
  if (header.origin === 'subagent') return false
  return true
}

/** The workspace a session runs in. */
function cwdOf(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
}

/**
 * Bind the feed for the lifetime of one workspace session.
 *
 * @param ctx - host context; needs `on`.
 * @param {object} [config] - `disabled: true` turns the feed off without removing the row.
 */
export function apply(ctx, config = {}) {
  if (config.disabled === true) return
  /** session id -> { l1: boolean, hash: string|null, lastTurn: number|null } */
  const seen = new Map()
  const stateOf = (agent) => {
    const id = agent?.session?.id
    if (typeof id !== 'string' || id === '') return null
    if (!seen.has(id)) seen.set(id, { l1: false, hash: null, lastTurn: null })
    return seen.get(id)
  }

  /** L1 at session start. Not a step boundary, so a direct session write is safe here. */
  const deliverL1 = (agent) => {
    try {
      if (!isRootAgent(agent)) return
      const record = stateOf(agent)
      if (record === null || record.l1) return
      const state = readState(cwdOf(agent))
      if (state.ok === false) return
      agent.inject(stateMessage(composeL1(state)))
      record.l1 = true
      record.hash = state.hash
    } catch {
      // A feed that cannot compose must never fail the session.
    }
  }

  /**
   * What this pre-step should add to its decision, decided synchronously so a second step in
   * the same turn cannot compose a second delta. Nothing is written and nothing is delivered
   * here: the caller commits the record only when the decision enters a step.
   *
   * @returns {{l1: string|null, l2: string|null, hash: string, turn: number|null}|null}
   */
  const planStep = (agent, payload) => {
    try {
      if (!isRootAgent(agent)) return null
      const record = stateOf(agent)
      if (record === null) return null
      const turn = typeof payload?.turn === 'number' ? payload.turn : null
      // L1 that missed `agent/created` still arrives first, before the delta.
      const needsL1 = !record.l1
      // The checks come BEFORE the read: a step that cannot produce a message must not pay for
      // reading and hashing the projections. Measured on a real project: readState costs ~2 ms
      // per step, a turn has ~15 steps, so the discarded reads were ~30 ms per turn.
      if (!needsL1) {
        if (payload?.step !== 1) return null
        if (turn !== null && record.lastTurn === turn) return null
      }
      const state = readState(cwdOf(agent))
      if (state.ok === false) return null
      if (needsL1) return { l1: composeL1(state), l2: null, hash: state.hash, turn }
      if (state.hash === record.hash) return null
      return { l1: null, l2: composeL2(state, record.hash), hash: state.hash, turn }
    } catch {
      return null
    }
  }

  ctx.on('agent/created', ({ agent }) => deliverL1(agent))
  // One waterfall participant. It returns through `next()` — the hook is never held open for a
  // session write — and adds its message to the decision that the step will actually enter.
  ctx.on('agent/pre-step', (payload, next) => {
    const agent = payload?.agent
    const claimed = Array.isArray(payload?.messages) ? payload.messages : []
    const plan = planStep(agent, payload)
    const decision = next()
    if (plan === null || (plan.l1 === null && plan.l2 === null)) return decision
    return Promise.resolve(decision).then(
      (result) => {
        if (result?.kind !== 'enter') return result
        try {
          const record = stateOf(agent)
          if (record === null) return result
          const messages = [...result.messages]
          if (plan.l2 !== null) {
            const lastClaimed = messages.findLastIndex((message) => claimed.includes(message))
            messages.splice(lastClaimed + 1, 0, stateMessage(plan.l2))
          }
          if (plan.l1 !== null) messages.unshift(stateMessage(plan.l1))
          record.l1 = true
          record.hash = plan.hash
          if (plan.turn !== null) record.lastTurn = plan.turn
          return { ...result, messages }
        } catch {
          // Same rule as before: never throw into the step waterfall.
          return result
        }
      },
      (error) => {
        // The waterfall failed for someone else's reason; do not mask it.
        throw error
      },
    )
  }, { prepend: true })
}

export default { name, inject, apply }
