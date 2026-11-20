/**
 * PURPOSE
 *   Keep a session's context under a token budget by pruning the NEWEST over-sized
 *   tool results first, so the point where a provider's prefix cache breaks sits at
 *   the tail of the conversation instead of the head.
 *
 * WHY. A provider that caches a prompt prefix re-bills every token after the first
 *   changed byte. The harness prunes tool results only when the context is already
 *   above the compaction threshold, and @deepseek-ai/dsh-compaction-tool-result-pruner
 *   rewrites EVERY result larger than 8192 characters starting from the oldest. The
 *   earliest rewritten node then sits near the head, so the next request re-bills
 *   almost the whole context. Measured 2026-11-20 over three days of this deployment
 *   (22 938 steps, 5.56 B tokens of prompt, 99.13% served from cache): 53 prune passes
 *   paid 12.2 M fresh tokens out of 48.2 M total; the whole net over-billing was
 *   9.4 M tokens.
 *
 * WHAT. Before each step this plugin measures the session with the same token meter
 *   the harness uses and compares it with a budget (contextWindow x budgetRatio,
 *   0.45 by default - below the 0.5 compaction threshold of a 1M window). Above the
 *   budget it rewrites the newest eligible results first and stops as soon as the
 *   projection is back under the budget. The newest protectResults results are never
 *   touched, so the model keeps the inputs it is currently working from. Every rewrite
 *   writes the same two durable events the harness writes (compaction/prune plus a
 *   tool/result replacement citing the shadowed node), so replay stays exact.
 *
 * The harness pruner stays mounted as a safety net: when this plugin cannot free
 * enough (every candidate already pruned), compaction and the old path still run.
 */

/** Defaults, chosen to sit just under the shipped compaction thresholds. */
export const DEFAULTS = Object.freeze({
  enabled: true,
  budgetRatio: 0.45,
  thresholdChars: 8192,
  headChars: 4096,
  tailChars: 1024,
  protectResults: 3,
})

/** Fixed marker substituted for every removed middle span; identical to the harness pruner. */
export const PRUNE_MARKER = '\n\n[... tool result middle pruned ...]\n\n'

const CONFIG_KEYS = new Set([
  'enabled',
  'budgetRatio',
  'thresholdChars',
  'headChars',
  'tailChars',
  'protectResults',
  'routes',
])

/** Count Unicode code points without splitting surrogate pairs. */
export function codePointLength(text) {
  return Array.from(text).length
}

function positiveInteger(name, value) {
  if (!Number.isInteger(value) || value <= 0) throw new Error('TailPrunerConfig: ' + name + ' (' + String(value) + ') must be a positive integer')
}

function nonNegativeInteger(name, value) {
  if (!Number.isInteger(value) || value < 0) throw new Error('TailPrunerConfig: ' + name + ' (' + String(value) + ') must be a non-negative integer')
}

function ratio(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value >= 1) throw new Error('TailPrunerConfig: ' + name + ' (' + String(value) + ') must be a fraction between 0 and 1')
}

/**
 * Resolve and validate the plugin configuration.
 * @param config - raw profile configuration.
 * @returns a detached frozen configuration.
 */
export function resolveConfig(config = {}) {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error('TailPrunerConfig: unknown key "' + key + '" (allowed: ' + [...CONFIG_KEYS].join(', ') + ')')
  }
  const resolved = {
    enabled: config.enabled ?? DEFAULTS.enabled,
    budgetRatio: config.budgetRatio ?? DEFAULTS.budgetRatio,
    thresholdChars: config.thresholdChars ?? DEFAULTS.thresholdChars,
    headChars: config.headChars ?? DEFAULTS.headChars,
    tailChars: config.tailChars ?? DEFAULTS.tailChars,
    protectResults: config.protectResults ?? DEFAULTS.protectResults,
    routes: config.routes ?? [],
  }
  if (typeof resolved.enabled !== 'boolean') throw new Error('TailPrunerConfig: enabled must be a boolean')
  ratio('budgetRatio', resolved.budgetRatio)
  positiveInteger('thresholdChars', resolved.thresholdChars)
  nonNegativeInteger('headChars', resolved.headChars)
  nonNegativeInteger('tailChars', resolved.tailChars)
  nonNegativeInteger('protectResults', resolved.protectResults)
  const emitted = resolved.headChars + codePointLength(PRUNE_MARKER) + resolved.tailChars
  if (emitted > resolved.thresholdChars) throw new Error('TailPrunerConfig: headChars + marker + tailChars (' + String(emitted) + ') must be at most thresholdChars')
  if (!Array.isArray(resolved.routes)) throw new Error('TailPrunerConfig: routes must be an array')
  const routes = resolved.routes.map((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('TailPrunerConfig: a routes entry must be an object')
    for (const key of Object.keys(entry)) {
      if (key !== 'provider' && key !== 'model' && key !== 'budgetRatio') throw new Error('TailPrunerConfig: unknown routes entry key "' + key + '"')
    }
    if (typeof entry.provider !== 'string' || entry.provider.length === 0) throw new Error('TailPrunerConfig: every routes entry needs a provider')
    ratio('routes.budgetRatio', entry.budgetRatio)
    return Object.freeze({
      provider: entry.provider,
      ...(typeof entry.model === 'string' && entry.model.length > 0 ? { model: entry.model } : {}),
      budgetRatio: entry.budgetRatio,
    })
  })
  return deepFreeze({ ...resolved, routes })
}

/** Detach and deeply freeze one value. */
export function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) deepFreeze(value[key])
  }
  return value
}

/** Total text content of one message's blocks in code points. */
export function measureContent(blocks) {
  let chars = 0
  for (const block of blocks) if (block.type === 'text') chars += codePointLength(block.text)
  return chars
}

/**
 * Replace an over-budget text middle while retaining rich-block order.
 * @param blocks - original message content.
 * @param config - resolved thresholds.
 * @returns pruned content, or null when the text is within budget or already pruned.
 */
export function pruneContent(blocks, config) {
  const totalChars = measureContent(blocks)
  if (totalChars <= config.thresholdChars) return null
  const removedStart = config.headChars
  const removedEnd = totalChars - config.tailChars
  const pruned = []
  let consumed = 0
  let markerInserted = false
  let changed = false
  for (const block of blocks) {
    if (block.type !== 'text') {
      pruned.push(block)
      continue
    }
    if (block.text.includes(PRUNE_MARKER)) return null
    const points = Array.from(block.text)
    const blockStart = consumed
    const blockEnd = blockStart + points.length
    const headEnd = Math.min(points.length, Math.max(0, removedStart - blockStart))
    const tailStart = Math.min(points.length, Math.max(0, removedEnd - blockStart))
    const marker = blockStart < removedEnd && blockEnd > removedStart && !markerInserted ? PRUNE_MARKER : ''
    if (marker.length > 0) markerInserted = true
    const text = points.slice(0, headEnd).join('') + marker + points.slice(tailStart).join('')
    if (text !== block.text) changed = true
    if (text.length > 0) pruned.push({ ...block, text })
    consumed = blockEnd
  }
  if (!markerInserted || !changed) return null
  return pruned
}

/**
 * Choose which over-sized tool results to rewrite, newest first, until the
 * projected context fits the budget.
 *
 * @param input.nodes - ascending surface candidates, each with seq, message and tokens.
 * @param input.totalTokens - measured context size.
 * @param input.budget - token budget the context must fall below.
 * @param input.protectResults - how many of the newest results stay untouched.
 * @param input.config - resolved thresholds.
 * @param input.estimateMessage - prices one message in tokens.
 * @returns the rewrites to append, newest first; empty when nothing is needed.
 */
export function planPrune(input) {
  const { nodes, totalTokens, budget, protectResults, config, estimateMessage } = input
  if (!Number.isFinite(totalTokens) || !Number.isFinite(budget) || totalTokens <= budget) return []
  if (!Array.isArray(nodes) || nodes.length === 0) return []
  const protectedFrom = Math.max(0, nodes.length - Math.max(0, protectResults))
  const planned = []
  let projected = totalTokens
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (projected <= budget) break
    if (index >= protectedFrom) continue
    const node = nodes[index]
    const content = pruneContent(node.message.content, config)
    if (content === null) continue
    const message = deepFreeze({ ...node.message, content })
    const tokensAfter = estimateMessage(message)
    const freed = Math.max(0, node.tokens - tokensAfter)
    planned.push({ seq: node.seq, message, tokensBefore: node.tokens, tokensAfter, freed })
    projected -= freed
  }
  return planned
}

/** The budget ratio for one route, falling back to the configured default. */
export function budgetRatioFor(config, route) {
  if (route !== undefined) {
    for (const entry of config.routes) {
      if (entry.provider !== route.provider) continue
      if (entry.model !== undefined && entry.model !== route.model) continue
      return entry.budgetRatio
    }
  }
  return config.budgetRatio
}

/**
 * Rewrite the chosen nodes in the session surface, newest first.
 * Writes the same durable pair the harness pruner writes, so replay and the
 * compaction telemetry agree about what was shadowed.
 *
 * @param session - agent session whose surface is rewritten.
 * @param planned - result of planPrune.
 * @returns how many nodes were rewritten.
 */
export function applyPrune(session, planned) {
  let written = 0
  for (const entry of planned) {
    const event = session.eventAt(entry.seq)
    if (event === undefined || event.type !== 'tool/result') continue
    session.append('compaction/prune', {
      shadowedRange: { start: entry.seq, end: entry.seq },
      shadowedSeqs: [entry.seq],
      shadowedTokenCount: entry.tokensBefore,
    })
    session.append('tool/result', { ...event.data, message: entry.message }, {
      surfaceOp: { op: 'replace', startSeq: entry.seq, endSeq: entry.seq },
      sourceEventSeqs: [entry.seq],
    })
    written += 1
  }
  return written
}

/** Price the surface through the token meter and plan one prune pass. */
function planSession(ctx, session, config) {
  const meter = ctx.tokenMeter ?? ctx.get?.('tokenMeter')
  if (meter === undefined) return []
  const route = session.requestContext?.()
  const contextWindow = route?.contextWindow
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return []
  const budget = Math.floor(contextWindow * budgetRatioFor(config, route))
  const measurement = meter.measure(session, session.requestHeader?.())
  if (!Number.isFinite(measurement.totalTokens) || measurement.totalTokens <= budget) return []
  const prices = new Map(measurement.nodes.map((node) => [node.seq, node.tokens]))
  const nodes = []
  for (const seq of session.surface.nodes) {
    const event = session.eventAt(seq)
    if (event === undefined || event.type !== 'tool/result') continue
    const message = session.deriveEventMessage(event)
    nodes.push({ seq, message, tokens: prices.get(seq) ?? meter.estimateMessage(message) })
  }
  return planPrune({
    nodes,
    totalTokens: measurement.totalTokens,
    budget,
    protectResults: config.protectResults,
    config,
    estimateMessage: (message) => meter.estimateMessage(message),
  })
}

/** One prune pass for one agent; never throws into the step. */
function runOne(ctx, agent, config, inFlight) {
  const session = agent?.session
  if (session === undefined || inFlight.has(session)) return
  const planned = planSession(ctx, session, config)
  if (planned.length === 0) return
  inFlight.add(session)
  try {
    const written = applyPrune(session, planned)
    if (written > 0) ctx.logger?.info?.('tail-pruner: rewrote ' + String(written) + ' tool result(s) at the tail')
  } finally {
    inFlight.delete(session)
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tail-pruner'

/** Services the plugin needs before it may activate. */
export const inject = ['tokenMeter']

/**
 * Register the per-step budget check.
 * @param ctx - plugin context.
 * @param config - raw profile configuration.
 */
export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config)
  if (!resolved.enabled) {
    ctx.logger?.info?.('tail-pruner: disabled by configuration')
    return
  }
  const inFlight = new WeakSet()
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    if (signal === undefined || !signal.aborted) {
      try {
        runOne(ctx, agent, resolved, inFlight)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger?.warn?.('tail-pruner: skipped this step: ' + message)
      }
    }
    return next()
  }, { prepend: true })
}
