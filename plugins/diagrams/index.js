/**
 * PURPOSE: Host half of the diagrams plugin — it contributes the single `diagram`
 *          tool and nothing else; viewing needs no code here because the harness's
 *          Sidebar document preview already renders `.html`.
 * INPUTS:  the cordis context (ctx) with the `tools` service mounted.
 * OUTPUTS: apply() registers the tool. It returns nothing; a missing `tools`
 *          service fails the mount loudly instead of silently doing nothing.
 * KEYWORDS: diagrams, schemes, plugin, host, tool, cordis, svg.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { diagramTool } from './plugin-diagrams.mjs'

export const name = 'diagrams'
export const inject = ['tools']

/**
 * Register a tool only on agents whose session preset is in `presets`. A diagram is a
 * design instrument: the orchestrator draws the system, the UX role draws flows, and a
 * backend fix has no reason to carry it. A session with no recorded preset keeps the
 * tool, so an unknown composition is never silently degraded.
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
 * Registers the `diagram` tool on the tools service, scoped to the design roles.
 * @param ctx - Cordis context; `ctx.tools` is guaranteed by `inject`.
 */
export function apply(ctx) {
  registerForPresets(ctx, diagramTool(defineTool), ['standard', 'orchestrator', 'ux'])
}

export { renderDiagram, THEMES, KINDS } from './render.mjs'
