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
 * Registers the `diagram` tool on the tools service.
 * @param ctx - Cordis context; `ctx.tools` is guaranteed by `inject`.
 */
export function apply(ctx) {
  ctx.tools.register(diagramTool(defineTool))
}

export { renderDiagram, THEMES, KINDS } from './render.mjs'
