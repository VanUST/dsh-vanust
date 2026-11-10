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
function registerForPresets(ctx, tool, presets) {
  const allowed = (agent) => {
    const preset = agent?.session?.header?.agentPreset
    return typeof preset !== 'string' || preset === '' || presets.includes(preset)
  }
  ctx.on('agent/created', ({ agent }) => {
    if (allowed(agent)) agent.ctx.tools.register(tool)
  })
}

/**
 * Registers the `presentation` tool on the tools service, scoped to the design roles.
 * @param ctx - Cordis context; `ctx.tools` is guaranteed by `inject`.
 */
export function apply(ctx) {
  registerForPresets(ctx, presentationTool(defineTool), ['standard', 'orchestrator', 'ux'])
}

export { renderDeck, THEMES, SLIDE_TYPES } from './render.mjs'
