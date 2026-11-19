/**
 * PURPOSE
 *   Give one role a model route of its own, and a fallback that keeps the turn alive when that
 *   route refuses. The deployment's default model is a single choice, so a role that must run on
 *   an expensive model (the system designer) had to be re-routed by hand in every session, and an
 *   exhausted subscription took the whole turn down with it. This plugin holds the rule: before a
 *   session's first request, a role with a configured route selects it; when the provider answers
 *   with a quota failure, the session selects the configured fallback and the step is retried.
 *
 * WHY THESE TWO SEAMS
 *   - `agent/created` is the only point before step preparation where `agent.model.select()`
 *     changes the FIRST request. A selection made at `agent/pre-step` lands on the next step,
 *     and a route rewritten on `agent/request` throws inside the turn: dsh freezes the step's
 *     route and rejects a different one ("use agent.model.select() before step preparation").
 *   - `agent/request-error` is the harness's own recovery seam: a listener returns
 *     `{ kind: 'retry' }` and the failed step is retried, with the selection it finds. That is
 *     what turns "the subscription is exhausted" into one retried step on the fallback instead of
 *     a dead turn.
 *
 * INPUTS
 *   Config (all optional):
 *     roles              map of preset id -> { provider, model, reasoningEffort?, fallback? }.
 *                        `fallback` has the same shape; a role without a fallback never switches.
 *     quotaCodes         failure codes that mean "this route is out of quota". Default
 *                        ["QUOTA", "ACCOUNT_QUOTA"] — the provider-neutral codes dsh-llm assigns
 *                        through isQuotaExceededError(). RATE_LIMIT is deliberately absent: a
 *                        retry on the same route is the right answer there.
 *
 * OUTPUTS
 *   Two listeners and a `model/selection` event per decision. No tool, no prompt section, no
 *   service: the route is the whole product, and it is recorded in the session log like any other
 *   selection the human makes.
 *
 * KEYWORDS
 *   role model, default route, quota, fallback, agent.model.select, agent/request-error,
 *   gpt-6.2-astra, deepseek-flash
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A session that already sent a request keeps its route: a resumed architect chat must not
 *     jump back to the expensive model because the server restarted.
 *   - A `model/selection` event seen since the plugin loaded wins over the rule: the human's pick
 *     is not undone. A pick made before the plugin loaded and before any request cannot be
 *     distinguished from the deployment default, and the rule applies (the picker writes a
 *     selection, so this is the blank-session case).
 *   - An agent without a session header or without `model.select` is left alone: the plugin
 *     cannot prove which role it is, and a wrong route costs money.
 *   - A preset without a rule keeps the deployment default.
 *   - Only one switch per agent: the second quota failure after the switch is terminal, so a
 *     provider that answers QUOTA for every route cannot loop the step.
 *   - A switched-off fallback is not selected twice: the switch requires the current route to
 *     differ from the fallback.
 *   - A failure whose code is not in `quotaCodes` is returned to `next()` untouched, so the
 *     harness retry policy and the human's error message keep working.
 */

/** Provider-neutral codes dsh-llm assigns when an account or route has no quota left. */
export const DEFAULT_QUOTA_CODES = ['QUOTA', 'ACCOUNT_QUOTA']

/** Reasoning levels this harness understands, in ascending cost. */
const EFFORT_ORDER = ['off', 'low', 'medium', 'high', 'xhigh', 'max']

/** A route needs both halves; anything else is a half-rule that would route nobody. */
function routeOf(value) {
  if (value === null || typeof value !== 'object') return null
  const provider = typeof value.provider === 'string' ? value.provider.trim() : ''
  const model = typeof value.model === 'string' ? value.model.trim() : ''
  if (provider === '' || model === '') return null
  const route = { provider, model }
  if (EFFORT_ORDER.includes(value.reasoningEffort)) route.reasoningEffort = value.reasoningEffort
  return route
}

/**
 * Normalize the plugin config into a total policy.
 *
 * @param config - Raw Loader config.
 * @returns `{ roles, quotaCodes, droppedRoles }`; an empty `roles` means the plugin is a no-op.
 */
export function normalizeConfig(config = {}) {
  const source = config.roles !== null && typeof config.roles === 'object' && !Array.isArray(config.roles)
    ? config.roles
    : {}
  const roles = {}
  let droppedRoles = 0
  for (const [preset, value] of Object.entries(source)) {
    if (typeof preset !== 'string' || preset.trim() === '') {
      droppedRoles += 1
      continue
    }
    const primary = routeOf(value)
    if (primary === null) {
      droppedRoles += 1
      continue
    }
    const fallback = routeOf(value.fallback)
    roles[preset.trim()] = fallback === null ? { primary } : { primary, fallback }
  }
  const codes = Array.isArray(config.quotaCodes)
    ? config.quotaCodes.filter((code) => typeof code === 'string' && code.trim() !== '').map((code) => code.trim())
    : []
  return {
    roles,
    quotaCodes: codes.length > 0 ? codes : [...DEFAULT_QUOTA_CODES],
    droppedRoles,
    configured: Object.keys(source).length,
  }
}

/**
 * Resolve the preset in force for one agent, through the deployment's own policy owner first.
 *
 * The policy owner (`toolFamilies.presetFor`) resolves a selection made after creation; the
 * preset registry projection does the same without the policy row; the creation header is the
 * last resort, and it names the preset the agent was BORN on. Reading only the header is how a
 * session switched mid-life keeps being described as its first role.
 *
 * @param ctx - Cordis context.
 * @param agent - Agent whose session is asked about.
 * @returns The preset id, or undefined.
 */
export function presetOf(ctx, agent) {
  try {
    const resolved = ctx.get?.('toolFamilies')?.presetFor?.(agent?.session)
    if (typeof resolved === 'string' && resolved !== '') return resolved
  } catch {
    // No policy owner in this composition: fall through to the projection.
  }
  try {
    const projected = ctx.get?.('agentPresets')?.presetForSession?.(agent?.session)
    if (typeof projected === 'string' && projected !== '') return projected
  } catch {
    // A bare assembly has no preset projection.
  }
  const header = agent?.session?.header?.agentPreset
  return typeof header === 'string' && header !== '' ? header : undefined
}

/** Stable key for one route, used for comparison only. */
const routeKey = (route) => `${route?.provider ?? ''}/${route?.model ?? ''}/${route?.reasoningEffort ?? ''}`

/**
 * The route a freshly created agent should start on, or null to leave it alone.
 *
 * @param ctx - Cordis context (for the preset owner).
 * @param agent - The agent created.
 * @param policy - `normalizeConfig()` output.
 * @param seenSelection - Whether a `model/selection` event was observed for this session.
 * @returns A route to select, or null.
 */
export function initialRoute(ctx, agent, policy, seenSelection = false, presetOverride) {
  if (seenSelection) return null
  const preset = typeof presetOverride === 'string' && presetOverride !== '' ? presetOverride : presetOf(ctx, agent)
  const rule = preset === undefined ? undefined : policy.roles[preset]
  if (rule === undefined) return null
  if (typeof agent?.model?.select !== 'function') return null
  // A session that already sent a request is resumed, not fresh: its recorded route is history.
  try {
    if (typeof agent.session?.requestHeader === 'function' && agent.session.requestHeader() !== undefined) return null
  } catch {
    return null
  }
  return rule.primary
}

/**
 * Decide what one failed request means for the role's route.
 *
 * @param ctx - Cordis context.
 * @param agent - The agent whose request failed.
 * @param policy - `normalizeConfig()` output.
 * @param failure - The serializable failure facts (`code` is the routing key).
 * @param alreadySwitched - Whether this agent already used its one switch.
 * @returns `{ action: 'switch', route, from }` or `{ action: 'ignore', reason }`.
 */
export function fallbackDecision(ctx, agent, policy, failure, alreadySwitched = false) {
  if (alreadySwitched) return { action: 'ignore', reason: 'already-switched' }
  const preset = presetOf(ctx, agent)
  const rule = preset === undefined ? undefined : policy.roles[preset]
  if (rule === undefined) return { action: 'ignore', reason: 'no-rule' }
  if (rule.fallback === undefined) return { action: 'ignore', reason: 'no-fallback' }
  const code = typeof failure?.code === 'string' ? failure.code : ''
  if (!policy.quotaCodes.includes(code)) return { action: 'ignore', reason: 'not-quota' }
  if (typeof agent?.model?.select !== 'function') return { action: 'ignore', reason: 'no-select' }
  let current
  try {
    current = agent.model.current()
  } catch {
    current = undefined
  }
  if (current !== undefined && current !== null && routeKey(current) === routeKey(rule.fallback)) {
    return { action: 'ignore', reason: 'already-fallback' }
  }
  return { action: 'switch', route: rule.fallback, from: current ?? null }
}

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = 'role-model'

/**
 * The live-agent registry is injected so a seat committed before the first request can find the
 * agent it belongs to. `ctx.get('agents')` is not reliably readable from a plugin context on this
 * harness; an injected service is, and `agents` is core (mounted by `dsh-agent`).
 */
export const inject = ['agents']

/**
 * Register the two listeners.
 *
 * @param ctx - Cordis context.
 * @param config - Raw plugin config; see the file contract.
 */
export function apply(ctx, config = {}) {
  const policy = normalizeConfig(config)
  if (policy.droppedRoles > 0) {
    ctx.logger.warn(`role-model: ignored ${policy.droppedRoles} malformed role rule(s) of ${policy.configured}`)
  }
  if (Object.keys(policy.roles).length === 0) return
  // One line at mount: which role will run on which route, and what it falls back to. A routing
  // rule that silently did nothing is exactly the failure this plugin exists to prevent.
  for (const [preset, rule] of Object.entries(policy.roles)) {
    const fallback = rule.fallback === undefined ? 'no fallback' : `falls back to ${rule.fallback.provider}/${rule.fallback.model}`
    ctx.logger.warn(`role-model: ${preset} runs on ${rule.primary.provider}/${rule.primary.model}, ${fallback}`)
  }

  /** Sessions whose model was chosen by the human (a `model/selection` this plugin did not write). */
  const selections = new Set()
  /** The selection this plugin made per session, so its own event is never read back as a human's. */
  const ownSelections = new Map()
  /** Agents that already used their one quota switch. */
  const switched = new WeakSet()

  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'model/selection' || typeof session?.id !== 'string') return
    // READ-BACK GUARD. The plugin's own `select()` appends a `model/selection` event; recording it
    // as the human's choice made the rule refuse to route the same session twice (measured
    // 2026-11-19: a resumed architect chat kept astra only because it was already selected).
    const key = routeKey(event.data ?? {})
    if (ownSelections.get(session.id) === key) return
    selections.add(session.id)
  })

  /** Select the role's route for one agent, once. */
  const applyInitial = (agent, presetOverride) => {
    try {
      const sessionId = agent?.session?.id
      const route = initialRoute(ctx, agent, policy, typeof sessionId === 'string' && selections.has(sessionId), presetOverride)
      if (route === null) return
      agent.model.select(route)
      if (typeof sessionId === 'string') ownSelections.set(sessionId, routeKey(route))
    } catch (error) {
      // A route is a preference; a plugin that cannot set it must not break the session.
      ctx.logger.warn(`role-model: could not set the role route (${error instanceof Error ? error.message : String(error)})`)
    }
  }

  // A SEAT COMMITTED BEFORE THE AGENT EXISTS MUST SURVIVE. The Web UI commits the chosen preset
  // as `agent-preset/selected` while the session is still blank, often before any Agent is
  // constructed for it — measured 2026-11-19: the seat arrived first, `agents.get()` returned
  // undefined, and the session then started on the deployment default. The seat is remembered by
  // session id, exactly as the tool-family policy does it, and replayed at creation.
  const seats = new Map()
  ctx.on('agent/created', ({ agent }) => {
    const sessionId = agent?.session?.id
    applyInitial(agent, typeof sessionId === 'string' ? seats.get(sessionId) : undefined)
  })
  // THE SEAT ARRIVES LATE. A preset picked on a blank session is committed as
  // `agent-preset/selected` AFTER the agent exists — measured 2026-11-19: a new `architect` chat
  // started on the deployment default because the rule was only read at creation. The selection
  // is the moment the role becomes real, and it is before the first request, so this is where
  // the expensive route is chosen.
  try {
    (typeof ctx.root?.on === 'function' ? ctx.root : ctx).on('session/event', (session, event) => {
      if (event?.type !== 'agent-preset/selected') return
      const preset = event?.data?.agentPreset
      if (typeof session?.id === 'string' && typeof preset === 'string') seats.set(session.id, preset)
      let live
      try {
        live = ctx.agents?.get?.(session?.id) ?? ctx.get?.('agents')?.get?.(session?.id)
      } catch {
        live = undefined
      }
      applyInitial(live, preset)
    })
  } catch {
    // A root without the session feed leaves the rule to agent/created.
  }

  ctx.on('agent/request-error', async (payload, next) => {
    const agent = payload?.agent
    let decisive
    try {
      decisive = fallbackDecision(ctx, agent, policy, payload?.failure, switched.has(agent))
    } catch {
      decisive = { action: 'ignore', reason: 'error' }
    }
    if (decisive.action !== 'switch') return next()
    try {
      agent.model.select(decisive.route)
      switched.add(agent)
      ctx.logger.warn(`role-model: ${String(payload?.provider ?? 'the provider')} reported ${String(payload?.failure?.code ?? 'a failure')} with no quota left; ${agent?.id ?? 'the agent'} continues on ${decisive.route.provider}/${decisive.route.model}`)
      // Own the recovery: the harness retries the step with the selection just recorded.
      return { kind: 'retry' }
    } catch (error) {
      ctx.logger.warn(`role-model: the quota fallback could not be selected (${error instanceof Error ? error.message : String(error)})`)
      return next()
    }
  })
}
