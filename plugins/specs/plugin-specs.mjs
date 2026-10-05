/**
 * PURPOSE
 *   Make the whole system prompt configurable from spec files, at two scopes, without a
 *   restart: a GLOBAL spec under `$DSH_HOME/specs` reaches every agent on this machine,
 *   and a LOCAL spec under a project's `docs/specs` reaches only the agents working in
 *   that project. Together they fill every slot the prompt has - identity, persona prefix,
 *   rules, machine facts, persona suffix and advisory items - so the plugin no longer owns
 *   any prompt text of its own; it owns the reading.
 *
 *   One assembly renders from ONE snapshot. The harness hands every section provider the
 *   same context object for one assembly and a fresh one for the next (measured, not
 *   assumed), so the snapshot is memoised against that object: the first section reads the
 *   catalogue, every later section of the same prompt reuses it, and the next request
 *   re-reads. A change to several spec files therefore lands in a single prompt, and no
 *   prompt can mix an old section with a new one.
 *
 *   The loader's own cache means an unchanged catalogue is a directory listing plus one
 *   `stat` per file, not a re-parse, so this stays cheap on every request.
 *
 * INPUTS
 *   No configuration: the scopes are conventions (`$DSH_HOME/specs/*.md` and
 *   `<project>/docs/specs/*.md`) and the project is resolved from the calling session's
 *   workspace, so a root session and every subagent it starts read the same project with no
 *   coordination between them. Turning the plugin off is a profile decision
 *   (`- id: specs / disabled: true`), not a plugin option.
 *
 * OUTPUTS
 *   One section per slot, each a PROVIDER re-evaluated on every assembly, so editing a spec
 *   file takes effect on the next request. A slot with no active item registers but renders
 *   the empty string, which the prompt omits rather than showing an empty heading. Every
 *   section is registered with `interpolate: false` and substitutes `{{cwd}}` and `{{model}}`
 *   itself, because the harness's interpolator throws on a reference whose variable is not
 *   registered for that assembly, and that throw would cost the whole prompt rather than one
 *   section. Reading never throws into an assembly: a bad file costs its own item, named in
 *   the catalogue's problems list, and never the prompt.
 *
 * KEYWORDS
 *   specs, prompt slots, two scopes, global, local, catalogue, batch, hot reload,
 *   subagents, identity, persona, rules, machine facts, prompt variables, interpolation
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No agent or no workspace in the provider context: falls back to the process
 *     directory, the pre-existing behaviour of every workspace reader here.
 *   - No spec directory, or no active item for a slot: that section renders empty.
 *   - A local spec naming a global-only slot: refused by the loader and reported as a
 *     problem; it never reaches the prompt.
 *   - Any unexpected error while rendering: the section is empty, because a prompt assembly
 *     must never fail on a spec file.
 *   - Repeated registration on reload: made inside `ctx.effect` for every slot, so Cordis
 *     disposes the previous registrations instead of colliding with the section-name
 *     uniqueness rule.
 */

import { loadCatalogue, renderSlot, slotRegistrations } from './specs-catalogue.mjs'

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = 'specs'

/** The prompt registry this plugin contributes to. */
export const inject = ['systemPrompt']

/**
 * One snapshot per assembly, keyed by the context object the harness passes to providers.
 *
 * A WeakMap, not a Map: the context is built per assembly and released with it, so nothing
 * accumulates and a new assembly always starts by consulting the loader's revision cache.
 */
const perAssembly = new WeakMap()

/**
 * The workspace the calling session was opened on.
 *
 * @param context - Provider context supplied by the prompt registry.
 * @returns The session's workspace directory, or the process directory when the harness
 *   supplied no agent, session or cwd.
 */
function workspaceOf(context) {
  const cwd = context?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd()
}

/**
 * Substitute the prompt variables a spec may use, from the session the assembly is for.
 *
 * This plugin registers its sections with `interpolate: false` and resolves `{{cwd}}` and
 * `{{model}}` itself. The harness's own interpolator THROWS on a reference whose variable
 * is not registered for that assembly, and a throw inside `renderPrompt` would cost the
 * whole prompt rather than one section - so a spec that uses a variable, read in a
 * composition that has none (a probe, a test, a session-less assembly), must not be able to
 * break it. A reference this function cannot resolve is left in place, which shows the
 * author their template did not resolve instead of silently dropping their sentence.
 *
 * @param text - Rendered section text.
 * @param context - Provider context, carrying the session header when there is a session.
 * @returns The text with `cwd` and `model` substituted where the session supplies them.
 */
function resolveVariables(text, context) {
  if (!text.includes('{{')) return text
  const header = context?.agent?.session?.header ?? {}
  const values = {
    cwd: typeof header.cwd === 'string' ? header.cwd : undefined,
    model: [header.model, header.modelId, header.modelName].find((value) => typeof value === 'string' && value.length > 0),
  }
  return text.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (reference, name) => {
    const value = values[name]
    return typeof value === 'string' && value.length > 0 ? value : reference
  })
}

/**
 * The catalogue this assembly renders from.
 *
 * @param context - Provider context; its identity is the assembly's identity.
 * @returns The snapshot for this assembly, read once on the first section that asks.
 */
function snapshotFor(context) {
  const memo = perAssembly.get(context)
  if (memo !== undefined) return memo
  const snapshot = loadCatalogue({ cwd: workspaceOf(context) })
  perAssembly.set(context, snapshot)
  return snapshot
}

/**
 * Install one prompt section per slot.
 *
 * @param ctx - Cordis context; `systemPrompt` is present because `inject` names it.
 * @returns Nothing; every registration is made through `ctx.effect`, which Cordis disposes
 *   on unload so a reload replaces the sections rather than colliding with them.
 */
export function apply(ctx) {
  for (const { slot, section, order } of slotRegistrations()) {
    ctx.effect(() => {
      const dispose = ctx.systemPrompt.section({
        name: section,
        order,
        // The plugin owns its text end to end: see `resolveVariables` for why the
        // harness's interpolator is kept away from a spec-authored section.
        interpolate: false,
        // A provider, not a string: the catalogue follows the files rather than a snapshot
        // taken at boot.
        text: (context) => {
          try {
            return resolveVariables(renderSlot(snapshotFor(context), slot), context)
          } catch {
            // Never throw into a prompt assembly: a malformed spec must cost its own
            // section, not every prompt in the process.
            return ''
          }
        },
      })
      return () => dispose()
    })
  }
}
