/**
 * PURPOSE
 *   Give the agent ONE static paragraph that says which of its four code-search
 *   facilities to use, when the code-search workspace pack is mounted. The four are
 *   genuinely different instruments - exact grep/glob, symbolic navigation (Serena),
 *   conceptual retrieval (Octocode semantic search) and the relationship graph
 *   (Octocode graphrag) - and without a routing rule an agent defaults to reading whole
 *   files, which is the cost the pack exists to remove.
 *
 *   WHY A PLUGIN AND NOT A LINE IN THE PROFILE PATCH. The text must be static: the
 *   prompt-cache audit on this deployment found that a section re-rendering mid-turn
 *   re-bills the whole context. This section is a constant string, contributed ONLY when
 *   the pack is applied to a repository instance, so a project without the pack pays
 *   nothing and the machine-wide home layer is untouched. Once applied it is COMMON TO
 *   EVERY ROLE on that instance - orchestrator, backend, research, reviewer, critic, docs,
 *   ux and standard all get this same paragraph and the same mcp__serena__<tool> and
 *   mcp__octocode__<tool> surface, because the pack's rows are root-level loader rows, not a
 *   preset. The cost is one short section on one project's agents, and it only changes when
 *   this file changes.
 *
 * INPUTS
 *   Config: none. The tool names are part of the frozen text on purpose; a name that
 *   drifts is a bug this section should make visible, not hide behind interpolation.
 *
 * OUTPUTS
 *   `apply(ctx)` registers one system-prompt section, `code-search:routing`, and returns.
 *   No service is required; the plugin is inert in a composition without a prompt registry.
 *
 * KEYWORDS
 *   code search routing, serena, octocode, prompt section, static, cache-stable, workspace pack
 */

/** Cordis function-plugin name; the loader id the generated pack row carries. */
export const name = 'code-search-routing'

/**
 * The prompt registry this plugin contributes to.
 *
 * DECLARED, NOT OPTIONAL. Cordis throws "cannot get property \"systemPrompt\" without inject"
 * when a plugin touches a service it did not inject, and the loader reports the entry as
 * "did not activate" instead of failing the boot - so the section silently disappeared and
 * only the warning in the headless run exposed it (measured 2026-11-11). With the injection
 * declared, the plugin waits for the service and contributes as soon as it exists.
 */
export const inject = ['systemPrompt']

/** Section order: after the MCP server report (10150), before nothing in particular. */
const ORDER = 10160

const ROUTING = [
  'CODE SEARCH ROUTING (this project has the code-search pack mounted):',
  '  - exact string, regex or path lookup -> the built-in grep/glob tools. Cheapest and exact; use it when you already know the token or file name.',
  '  - a symbol by name, its references, or a file outline -> mcp__serena__find_symbol / find_referencing_symbols / get_symbols_overview. Language-server precise; prefer it over reading a whole file.',
  '  - a question about MEANING rather than a name ("where is the retry policy implemented") -> mcp__octocode__semantic_search. It reads a PREBUILT index: run octocode index for the current revision and check octocode stats; the MCP server never builds one (mcp_index=false).',
  '  - an AST shape rather than a string ("$VAR.unwrap()", "if let Some($X) = $Y { $$$ }") -> mcp__octocode__structural_search. READ-ONLY here: rewrite/update_all are refused, so do not plan an edit through it.',
  '  - who calls / imports / extends what, or a path between two nodes -> mcp__octocode__graphrag (search, then get-relationships, then get-node or find-path).',
  '  The same token is never worth two instruments: grep first for exact text, Serena for a symbol, Octocode for meaning or relationships.',
].join('\n')

/**
 * Register the static section.
 *
 * @param ctx - Cordis context; only `systemPrompt` is used, opportunistically.
 * @returns Nothing.
 */
export function apply(ctx) {
  if (typeof ctx?.systemPrompt?.section !== 'function') return
  const order = ctx.systemPrompt.getSectionOrder?.('code-search:routing') ?? ORDER
  ctx.effect(() => {
    const dispose = ctx.systemPrompt.section({ name: 'code-search:routing', order, text: ROUTING })
    return () => dispose()
  })
}
