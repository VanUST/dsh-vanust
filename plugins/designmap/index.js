/**
 * designmap host plugin (M3): registers the seven agent tools and the `/designmap`
 * human command over the M0 core and the M3 host service.
 *
 * Registration follows the shipped `design-map` 0.2.0 pattern: `inject
 * ['tools','commands']`, tools registered per agent from `agent/created` and gated by
 * `agentPreset` (default: orchestrator only — an agent that never received the tool
 * cannot be argued into writing the design of the system it is working in), while the
 * command stays ungated because it is the human panel path.
 *
 * The plugin knows nothing about layout; it resolves the session workspace, builds a
 * host service, and lets `src/tools.mjs` call it.
 */
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createHostService, createFileLogger } from './src/host.mjs'
import { createHostTools, agentCwd } from './src/tools.mjs'
import { createCommandHandler } from './src/command.mjs'

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = 'designmap'

/** Both registries are required. */
export const inject = ['tools', 'commands']

/** Presets that receive the agent tools by default. */
const DEFAULT_PRESETS = ['orchestrator']

/**
 * @param ctx - Cordis host context.
 * @param config - `{dir?: string, presets?: string[]}`.
 *   `dir` is the designmap directory relative to the session workspace (default
 *   `designmap`); `presets` overrides which agent presets receive the tools.
 */
export function apply(ctx, config = {}) {
  const dirName = typeof config.dir === 'string' && config.dir !== '' ? config.dir : 'designmap'
  const presets = Array.isArray(config.presets) && config.presets.length > 0 ? config.presets : DEFAULT_PRESETS

  /** Resolve the caller's workspace and open a per-call host service + JSONL logger. */
  const hostFor = exec => {
    const cwd = agentCwd(exec.agent)
    const designmapDir = join(cwd, dirName)
    const { logger, path } = createFileLogger(designmapDir)
    return {
      service: createHostService({ designmapDir, repoRoot: cwd, logger }),
      logger,
      logPath: path,
    }
  }

  const tools = createHostTools({ defineTool, hostFor })

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

  installPresetGate(ctx, {
    tools,
    allowed: (preset) => presets.includes(preset),
  })

  ctx.commands.register({
    name: 'designmap',
    description: 'Read or change the designmap living document (status | scan | apply | render | lint | open | export). Used by the Design map panel and by the human.',
    recordInput: false,
    handler: createCommandHandler({ hostFor }),
  })
}
