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
 * Registers the `presentation` tool on the tools service.
 * @param ctx - Cordis context; `ctx.tools` is guaranteed by `inject`.
 */
export function apply(ctx) {
  ctx.tools.register(presentationTool(defineTool))
}

export { renderDeck, THEMES, SLIDE_TYPES } from './render.mjs'
