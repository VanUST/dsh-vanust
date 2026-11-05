/**
 * PURPOSE
 *   Keep delegated work on the cheap flash route. The harness default is already
 *   deepseek-flash, and the Subagent settings page can offer an allowlist, but
 *   neither refuses a workflow script that asks for deepseek-v4-pro: the request
 *   reaches the loop with whatever route the script named. This plugin sits on
 *   the `agent/request` waterfall, the last place the frozen LlmCallConfig can
 *   be replaced before dispatch, and rewrites or refuses a child's route.
 *
 * INPUTS
 *   Config (all optional):
 *     provider / model       the fallback route. Default deepseek-official / deepseek-flash.
 *     allowedRoutes          exact {provider, model} pairs. Default: the fallback route.
 *     onViolation            "rewrite" (default) or "refuse".
 *     enforceRoot            also apply to root agents. Default false, so the
 *                            human can still choose a stronger model for the
 *                            conversation itself.
 *     maxReasoningEffort     optional cap: off | low | high | max.
 *     deniedModels           optional model-id patterns refused for EVERY agent,
 *                            root included. `*` matches any run of characters,
 *                            matching is case-insensitive, and the decision is a
 *                            refusal rather than a rewrite: silently substituting
 *                            another model is how a "never use this" rule gets
 *                            believed while the expensive route was paid for. A
 *                            pattern containing `/` matches `<provider>/<model>`.
 *
 * OUTPUTS
 *   One `agent/request` listener. It never registers a tool, prompt section,
 *   service or session event. A refusal throws before dispatch, so the child's
 *   turn fails with the guard's message instead of silently using another model.
 *
 * KEYWORDS
 *   flash, model guard, agent/request, delegated child, deepseek-flash, policy
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A malformed allowedRoutes entry is dropped with a warning; an empty list
 *     falls back to the configured route rather than disabling the guard.
 *   - An invalid onViolation value is treated as "rewrite" and reported once:
 *     refusing every request because of a typo would be worse than the typo.
 *   - An agent without a session/header is left alone; the guard cannot prove it
 *     is a child, and a refusal it cannot attribute would break unrelated work.
 *   - A provider that does not route through DSH's LLM (ACP, SDK, Claude Code)
 *     never reaches `agent/request`; that is a documented residual, not a bug in
 *     this listener.
 *   - The warning is logged once per (agent, requested route), so a looping child
 *     does not fill the log with the same line.
 *   - A deniedModels entry that is not a non-empty string is dropped and counted;
 *     a typo never turns into "deny everything".
 *   - A denied-model refusal is reported once per denied pattern, not once per
 *     request, because it is a configuration fact rather than a looping child.
 */

/** Compile one deny pattern: `*` is the only metacharacter, matching is case-insensitive. */
function compileDenyPattern(pattern) {
  const source = pattern.trim().toLowerCase()
  const body = source
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return { source, matcher: new RegExp(`^${body}$`) }
}

/** Route of a request after the adapter has resolved it. */
const EFFORT_ORDER = ['off', 'low', 'high', 'max']

/**
 * Normalize the plugin config into a total policy.
 *
 * @param config - Raw Loader config.
 * @returns A policy that is safe for every request.
 */
export function normalizeConfig(config = {}) {
  const provider = typeof config.provider === 'string' && config.provider.trim() !== ''
    ? config.provider.trim()
    : 'deepseek-official'
  const model = typeof config.model === 'string' && config.model.trim() !== ''
    ? config.model.trim()
    : 'deepseek-flash'
  const fallback = { provider, model }
  const allowedRoutes = Array.isArray(config.allowedRoutes)
    ? config.allowedRoutes
      .filter((route) => route !== null && typeof route === 'object'
        && typeof route.provider === 'string' && route.provider !== ''
        && typeof route.model === 'string' && route.model !== '')
      .map((route) => ({ provider: route.provider, model: route.model }))
    : []
  const onViolation = config.onViolation === 'refuse' ? 'refuse' : 'rewrite'
  const denyCandidates = Array.isArray(config.deniedModels)
    ? config.deniedModels.filter((pattern) => typeof pattern === 'string' && pattern.trim() !== '')
    : []
  const deniedModels = denyCandidates.map(compileDenyPattern)
  const maxReasoningEffort = EFFORT_ORDER.includes(config.maxReasoningEffort)
    ? config.maxReasoningEffort
    : null
  return {
    fallback,
    allowedRoutes: allowedRoutes.length > 0 ? allowedRoutes : [fallback],
    deniedModels,
    onViolation,
    enforceRoot: config.enforceRoot === true,
    maxReasoningEffort,
    malformedOnViolation: config.onViolation !== undefined && config.onViolation !== 'refuse' && config.onViolation !== 'rewrite',
    droppedRoutes: Array.isArray(config.allowedRoutes) ? config.allowedRoutes.length - allowedRoutes.length : 0,
  }
}

/**
 * Decide what to do with one resolved call.
 *
 * @param call - The LlmCallConfig returned by `next()`.
 * @param agent - The requesting Agent.
 * @param policy - `normalizeConfig()` output.
 * @returns `{ action: 'allow' | 'rewrite' | 'refuse', call, reason?, denied? }`.
 */
export function guardDecision(call, agent, policy) {
  const depth = Number(agent?.session?.header?.delegationDepth ?? 0)
  const parent = agent?.session?.header?.parentSession
  const isChild = (Number.isFinite(depth) && depth > 0) || (typeof parent === 'string' && parent.length > 0)
  const applies = isChild || policy.enforceRoot
  const key = `${call?.provider ?? ''}/${call?.model ?? ''}`
  const denied = denyMatch(call, policy.deniedModels)
  if (denied !== null) {
    return {
      action: 'refuse',
      call,
      denied: denied.source,
      reason: `flash-guard: ${key} matches deniedModels "${denied.source}" and is never dispatched; choose an allowed route`,
    }
  }
  const allowed = policy.allowedRoutes.some((route) => route.provider === call?.provider && route.model === call?.model)
  const capped = capEffort(call, policy.maxReasoningEffort)
  if (!applies) return { action: 'allow', call }
  if (!allowed) {
    if (policy.onViolation === 'refuse') {
      return {
        action: 'refuse',
        call,
        reason: `flash-guard: ${key} is not allowed for delegated work; use ${policy.fallback.provider}/${policy.fallback.model}`,
      }
    }
    return {
      action: 'rewrite',
      call: { ...capped, provider: policy.fallback.provider, model: policy.fallback.model },
      reason: `flash-guard: rewrote ${key} to ${policy.fallback.provider}/${policy.fallback.model}`,
    }
  }
  return { action: 'allow', call: capped }
}

/**
 * Find the first deny pattern a call matches.
 *
 * @param call - Resolved call.
 * @param deniedModels - Compiled deny patterns.
 * @returns The matching pattern, or null when nothing denies this call.
 */
function denyMatch(call, deniedModels) {
  if (deniedModels.length === 0 || call === null || typeof call !== 'object') return null
  const model = String(call.model ?? '').toLowerCase()
  const route = `${String(call.provider ?? '').toLowerCase()}/${model}`
  return deniedModels.find((pattern) => pattern.matcher.test(
    pattern.source.includes('/') ? route : model,
  )) ?? null
}

/**
 * Apply the optional reasoning-effort cap without changing the route.
 *
 * @param call - Resolved call.
 * @param max - Cap name, or null.
 * @returns The call, or a copy with a lower effort.
 */
function capEffort(call, max) {
  if (max === null || call === null || typeof call !== 'object') return call
  const current = call.reasoningEffort
  if (!EFFORT_ORDER.includes(current)) return call
  if (EFFORT_ORDER.indexOf(current) <= EFFORT_ORDER.indexOf(max)) return call
  return { ...call, reasoningEffort: max }
}

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = 'flash-guard'

/** Nothing is injected: the waterfall is global and needs no service. */
export const inject = []

/**
 * Register the request waterfall.
 *
 * @param ctx - Cordis context.
 * @param config - Raw plugin config.
 */
export function apply(ctx, config = {}) {
  const policy = normalizeConfig(config)
  if (policy.malformedOnViolation) {
    ctx.logger.warn(`flash-guard: onViolation ${JSON.stringify(config.onViolation)} is not "rewrite" or "refuse"; using "rewrite"`)
  }
  if (policy.droppedRoutes > 0) {
    ctx.logger.warn(`flash-guard: ignored ${policy.droppedRoutes} malformed allowedRoutes entr${policy.droppedRoutes === 1 ? 'y' : 'ies'}`)
  }
  const droppedDeny = (Array.isArray(config.deniedModels) ? config.deniedModels.length : 0) - policy.deniedModels.length
  if (droppedDeny > 0) {
    ctx.logger.warn(`flash-guard: ignored ${droppedDeny} malformed deniedModels entr${droppedDeny === 1 ? 'y' : 'ies'}`)
  }
  const warned = new Set()
  ctx.on('agent/request', async (payload, next) => {
    const call = await next()
    const decision = guardDecision(call, payload?.agent, policy)
    if (decision.action === 'allow') return decision.call
    const agentId = payload?.agent?.id ?? 'unknown'
    // A deny rule is a configuration fact, so it is reported once per pattern;
    // an allowlist violation is reported once per agent and requested route.
    const key = decision.denied === undefined
      ? `${agentId}:${call?.provider ?? '?'}/${call?.model ?? '?'}`
      : `deny:${decision.denied}`
    if (!warned.has(key)) {
      warned.add(key)
      ctx.logger.warn(decision.reason)
    }
    if (decision.action === 'refuse') throw new Error(decision.reason)
    return decision.call
  })
}
