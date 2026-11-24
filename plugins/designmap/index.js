/**
 * designmap host plugin (design-map v2): the four page tools and the `/designmap` command.
 *
 * The page document is the only store: one Excalidraw file per page under
 * designmap/pages/, edited by the Project state -> Map panel through the command and by
 * agents through map_list / map_read / map_edit / map_render. There is no model, view,
 * overlay, annotation or manifest behind it.
 *
 * Registration follows the shipped pattern: `inject ['tools','commands']`, tools
 * registered per agent from `agent/created` and gated by `agentPreset` (default:
 * orchestrator only — an agent that never received the tool cannot be argued into writing
 * the design of the system it is working in), while the command stays ungated because it
 * is the human panel path.
 */
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createCommandHandler } from './src/command.mjs'
import { createPageTools } from './src/page-tools.mjs'

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = 'designmap'

/** Both registries are required. */
export const inject = ['tools', 'commands']

/** Presets that receive the page tools by default. */
const DEFAULT_PRESETS = ['orchestrator']

/** Resolve the session workspace an agent call runs against. */
function agentCwd(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd()
}

/**
 * The preset in force: the tool-families service owns the resolution (projection first,
 * remembered selection, creation header last). Reading `agent.session.header.agentPreset`
 * here resolved the preset the session was CREATED with — the profile default
 * `orchestrator` — so every seat received the orchestrator tool set. The lookup is
 * guarded because a composition without the service must not fail a session creation.
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
  const sync = (agent, presetOverride) => {
    if (agent === undefined || agent === null) return
    try {
      const preset = typeof presetOverride === 'string' && presetOverride !== '' ? presetOverride : resolve(agent)
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
      if (live !== undefined && live !== null) sync(live, event?.data?.agentPreset)
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
 * @param ctx - Cordis host context.
 * @param config - `{dir?: string, presets?: string[]}`.
 *   `dir` is the designmap directory relative to the session workspace (default
 *   `designmap`); `presets` overrides which agent presets receive the tools.
 */
export function apply(ctx, config = {}) {
  const dirName = typeof config.dir === 'string' && config.dir !== '' ? config.dir : 'designmap'
  const presets = Array.isArray(config.presets) && config.presets.length > 0 ? config.presets : DEFAULT_PRESETS
  const pageHostFor = (exec) => ({ designmapDir: join(agentCwd(exec.agent), dirName) })

  const pageTools = createPageTools({ defineTool, pageHostFor })

  installPresetGate(ctx, {
    tools: pageTools,
    allowed: (preset) => presets.includes(preset),
  })

  ctx.commands.register({
    name: 'designmap',
    description: 'Read or change one design-map page (pages | page | save | tidy-page | render-page). Used by the Project state -> Map editor and by the human.',
    recordInput: false,
    handler: createCommandHandler({ hostFor: (invocation) => pageHostFor(invocation) }),
  })
}
