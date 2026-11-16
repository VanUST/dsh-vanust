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

  ctx.on('agent/created', ({ agent }) => {
    if (!presets.includes(agent?.session?.header?.agentPreset)) return
    for (const tool of tools) agent.ctx.tools.register(tool)
  })

  ctx.commands.register({
    name: 'designmap',
    description: 'Read or change the designmap living document (status | scan | apply | render | lint | open | export). Used by the Design map panel and by the human.',
    recordInput: false,
    handler: createCommandHandler({ hostFor }),
  })
}
