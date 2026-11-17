/**
 * PURPOSE: Host half of the presentation plugin — it contributes the single
 *          `presentation` tool and nothing else; viewing needs no code here
 *          because the harness's Sidebar document preview already renders `.html`.
 * INPUTS:  the cordis context (ctx) with the `tools` service mounted.
 * OUTPUTS: apply() registers the tool. It returns nothing; a missing `tools`
 *          service fails the mount loudly instead of silently doing nothing.
 * KEYWORDS: presentation, plugin, host, tool, cordis, slides.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { presentationTool } from './plugin-presentation.mjs'

export const name = 'presentation'
export const inject = ['tools']

/**
 * Register a tool only on agents whose session preset is in `presets`. Decks are a
 * communication instrument for the design roles; a backend child has no use for one.
 * A session with no recorded preset keeps the tool, so an unknown composition is never
 * silently degraded.
 *
 * @param ctx - Cordis context (host).
 * @param tool - The tool definition.
 * @param presets - Preset ids that may see the tool.
 */
/**
 * The preset in force: the tool-families service owns the resolution (projection first,
 * remembered selection, creation header last). Reading `agent.session.header.agentPreset`
 * here resolved the preset the session was CREATED with — the profile default `orchestrator`
 * — so every seat received the orchestrator tool set. The lookup is guarded because a
 * composition without the service must not fail a session creation.
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

/**
 * Keep one agent's tools in line with its CURRENT preset.
 *
 * WHY DEFERRED. A seat selected on a blank session is committed as an
 * `agent-preset/selected` event; a plugin that only listens on `agent/created` keeps the
 * creation-time answer. The event is raised on the ROOT context (this row and the preset
 * registry are siblings), and it can arrive AFTER the agent exists, so the previous set is
 * disposed before the new one is registered — a duplicate registration would throw.
 */
function installPresetGate(ctx, { allowed, tools = [], toolsFor, onInstalled }) {
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
      const selected = typeof toolsFor === 'function' ? toolsFor(preset) : tools
      const disposers = selected.map((tool) => agent.ctx.tools.register(tool)).filter((dispose) => typeof dispose === 'function')
      installed.set(agent, { preset, disposers })
      onInstalled?.(agent, preset)
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

function registerForPresets(ctx, tool, presets) {
  installPresetGate(ctx, { tools: [tool], allowed: (preset) => presets.includes(preset) })
}

/**
 * Registers the `presentation` tool on the tools service, scoped to the design roles.
 * @param ctx - Cordis context; `ctx.tools` is guaranteed by `inject`.
 */
export function apply(ctx) {
  registerForPresets(ctx, presentationTool(defineTool), ['standard', 'orchestrator', 'ux'])
}

export { renderDeck, THEMES, SLIDE_TYPES } from './render.mjs'
