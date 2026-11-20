/**
 * PURPOSE: Host half of the presentation plugin — it contributes the `presentation`
 *          and `dashboard` tools and nothing else; viewing needs no code here
 *          because the harness's Sidebar document preview already renders `.html`.
 * INPUTS:  the cordis context (ctx) with the `tools` service mounted.
 * OUTPUTS: apply() registers the tools for the design seats. Returns nothing; a
 *          missing `tools` service fails the mount loudly instead of silently
 *          doing nothing.
 * KEYWORDS: presentation, dashboard, plugin, host, tool, cordis, deck, board.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { presentationTools } from './plugin-presentation.mjs'

export const name = 'presentation'
export const inject = ['tools']

/**
 * The preset in force: the tool-families service owns the resolution (projection
 * first, remembered selection, creation header last). Reading
 * `agent.session.header.agentPreset` here would resolve the preset the session was
 * CREATED with, so a seat chosen later would keep the wrong tool set.
 * @param ctx - Cordis context (host).
 * @param agent - The live agent.
 * @returns The preset id, or undefined when no owner can answer.
 */
function presetOf(ctx, agent) {
  try {
    const resolved = ctx.get?.('toolFamilies')?.presetFor?.(agent?.session)
    if (typeof resolved === 'string' && resolved.trim() !== '') return resolved
  } catch {
    // No policy owner in this composition: fall back to the projection.
  }
  try {
    const projected = ctx.get?.('agentPresets')?.presetForSession?.(agent?.session)
    if (typeof projected === 'string' && projected.trim() !== '') return projected
  } catch {
    // No projection either: the creation header is the last fallback.
  }
  try {
    const header = agent?.session?.header?.agentPreset
    return typeof header === 'string' && header !== '' ? header : undefined
  } catch {
    return undefined
  }
}

/** The role-surface policy; a preset without a tool-families row admits every tool. */
function surfaceAllows(ctx, agent, toolName) {
  try {
    return ctx.get?.('toolFamilies')?.allows?.(agent, toolName) !== false
  } catch {
    return true
  }
}

/**
 * Keep one agent's tools in line with its CURRENT preset.
 *
 * WHY DEFERRED. A seat selected on a blank session is committed as an
 * `agent-preset/selected` event; a plugin that only listens on `agent/created`
 * keeps the creation-time answer. The event is raised on the ROOT context (this
 * row and the preset registry are siblings), and it can arrive AFTER the agent
 * exists, so the previous set is disposed before the new one is registered — a
 * duplicate registration would throw.
 *
 * @param ctx - Cordis context (host).
 * @param options.allowed - (preset) => boolean.
 * @param options.tools - Tool definitions this plugin registers.
 * @returns The sync function, for the proof script and for `agent/pre-step`.
 */
export function installPresetGate(ctx, { allowed, tools = [] }) {
  const installed = new Map()
  const resolve = (agent) => {
    try {
      return presetOf(ctx, agent)
    } catch {
      return undefined
    }
  }
  const sync = (agent) => {
    if (agent === undefined || agent === null) return
    try {
      const preset = resolve(agent)
      const current = installed.get(agent)
      if (current !== undefined && current.preset === preset) return
      if (current !== undefined) {
        for (const dispose of current.disposers) {
          try {
            dispose()
          } catch {
            // A disposer that fails must not take the session down.
          }
        }
        installed.delete(agent)
      }
      if (typeof preset !== 'string' || !allowed(preset)) return
      const selected = tools.filter((tool) => surfaceAllows(ctx, agent, tool.name))
      const disposers = selected.map((tool) => agent.ctx.tools.register(tool)).filter((dispose) => typeof dispose === 'function')
      installed.set(agent, { preset, disposers })
    } catch {
      // Never throw into agent/created: an exception there cancels the session creation.
    }
  }
  ctx.on('agent/created', ({ agent }) => sync(agent))
  if (typeof ctx.root?.on === 'function') {
    ctx.root.on('session/event', (session, event) => {
      if (event?.type !== 'agent-preset/selected') return
      let live
      try {
        live = ctx.get?.('agents')?.get?.(session?.id)
      } catch {
        live = undefined
      }
      if (live !== undefined && live !== null) sync(live)
    })
  }
  // The last line of defence: the first request header is derived after pre-step.
  ctx.on('agent/pre-step', (payload, next) => {
    sync(payload?.agent)
    return next()
  }, { prepend: true })
  return sync
}

/**
 * The presets that may see these tools: the design seats. An unknown or
 * preset-less session keeps them, so nothing is silently degraded.
 * @param preset - The resolved preset id.
 * @returns Whether the preset may use the deck and the board.
 */
export function designSeat(preset) {
  return ['standard', 'presenter', 'ux'].includes(preset)
}

/**
 * Registers the deck and board tools on the tools service, scoped to the design seats.
 * @param ctx - Cordis context; `ctx.tools` is guaranteed by `inject`.
 */
export function apply(ctx) {
  installPresetGate(ctx, { allowed: designSeat, tools: presentationTools(defineTool) })
}

export { renderDeck, THEMES, SLIDE_TYPES } from './render-deck.mjs'
export { renderBoard } from './render-board.mjs'
export { chartSvg } from './charts.mjs'
