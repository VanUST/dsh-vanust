/**
 * PURPOSE
 *   Deliver the project state to a ROOT session: L1 once as the first model-visible message,
 *   then L2 — one aggregated delta — at a turn boundary only when the projection hash changed.
 *   A delegated worker gets nothing; a workspace without `state/views/digest.md` gets nothing.
 *
 * WHY `agent.inject()` AND NOT A PROMPT SECTION
 *   The design wants the state in the CONVERSATION (L1 first message, L2 appended deltas), and
 *   the harness writes every injected message to the journal as `user/message` — so the rule
 *   "model-visible means logged" holds without a second mechanism. `inject` also does not wake
 *   an idle driver: the text arrives at the next step boundary of a turn that is already
 *   running.
 *
 * LIFECYCLE
 *   - `agent/created` (root, state present): compose L1 from digest + plan + snapshot, inject
 *     once, remember the projection hash. L1 is never edited or repeated.
 *   - `agent/pre-step` with `step === 1` (turn boundary): if the hash changed since the last
 *     injected state, compose one aggregated L2 and inject it; a second change inside the same
 *     turn is not injected (the next turn picks the newest hash up).
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
 * @param ctx - host context; needs `on`, and `root` for the session-event listener.
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

  const deliverL2 = (agent, { turn, step } = {}) => {
    try {
      if (!isRootAgent(agent)) return
      if (step !== 1) return
      const record = stateOf(agent)
      // L1 must be out first: the delta only makes sense on top of the snapshot.
      if (record === null || !record.l1) return
      if (typeof turn === 'number' && record.lastTurn === turn) return
      const state = readState(cwdOf(agent))
      if (state.ok === false) return
      if (state.hash === record.hash) return
      agent.inject(stateMessage(composeL2(state, record.hash)))
      record.hash = state.hash
      record.lastTurn = typeof turn === 'number' ? turn : null
    } catch {
      // Same rule as L1: never throw into the step waterfall.
    }
  }

  ctx.on('agent/created', ({ agent }) => deliverL1(agent))
  // One waterfall participant: L1 first (a state that appeared after `agent/created` still
  // arrives before the first request), then the L2 check for this turn boundary.
  ctx.on('agent/pre-step', (payload, next) => {
    const agent = payload?.agent
    deliverL1(agent)
    deliverL2(agent, { turn: payload?.turn, step: payload?.step })
    return next()
  }, { prepend: true })
}

export default { name, inject, apply }
