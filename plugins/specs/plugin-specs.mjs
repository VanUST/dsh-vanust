/**
 * PURPOSE
 *   Make a project's human-authored spec documents a always-present part of every
 *   agent's system prompt - a root session and every subagent it starts - so the
 *   requirements a human wrote are read as binding instructions rather than left on
 *   disk for an agent to find, or not.
 *
 *   This is the whole mechanism. There is no compiler, no verifier, no law, no consent
 *   and no judge behind it: specs are advisory text a human owns, and the only thing
 *   this plugin does is read them and put them in front of the model.
 *
 * INPUTS
 *   No configuration, deliberately. The spec directory is a convention
 *   (`<project>/docs/specs/*.md`) and the project is resolved from the calling session's
 *   workspace, so the plugin needs no settings and depends on no harness package beyond
 *   the prompt registry it injects. Turning it off is a profile decision
 *   (`- id: specs / disabled: true`), not a plugin option.
 *
 * OUTPUTS
 *   Registers exactly one system-prompt section whose text is a PROVIDER, re-evaluated on
 *   every assembly. That is what makes editing a spec file take effect on the next request
 *   with no restart, and it is why a subagent sees a spec added after its parent started.
 *   Contributes an empty string - never a throw - when the project has no specs, so the
 *   prompt keeps every other section and a missing spec directory is not an error.
 *
 *   `context.agent.session.header.cwd` is the session workspace the harness supplies to
 *   the provider, which is how a root session and its subagents resolve the SAME project
 *   without any coordination between them.
 *
 * KEYWORDS
 *   specs, system prompt, prompt section, subagents, project root, hot reload, advisory
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No agent or no workspace in the provider context: falls back to the process
 *     directory, which is the pre-existing behaviour of every other workspace reader here.
 *   - No `docs/specs`, no active specs, or every spec unreadable: contributes nothing.
 *   - Any unexpected error while reading: swallowed, and the section is empty. A prompt
 *     assembly must never fail because a spec file was odd.
 *   - Repeated registration on reload: made inside `ctx.effect`, so Cordis disposes the
 *     previous registration instead of colliding with the section-name uniqueness rule.
 */

import { activeSpecs, findProjectRoot, readSpecs, renderSpecsPrompt } from './specs-core.mjs'

/** Cordis function-plugin name; also the id a profile patch targets. */
export const name = 'specs'

/** The prompt registry this plugin contributes to. */
export const inject = ['systemPrompt']

/** Section name; unique, so a duplicate is a defect rather than a silent shadow. */
const SECTION_NAME = 'project:specs'

/** Order used when the prompt registry allocates no central position: after the rules. */
const FALLBACK_ORDER = 10200

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
 * Install the project-specs section.
 *
 * @param ctx - Cordis context; `systemPrompt` is present because `inject` names it.
 * @returns Nothing; the registration is made through `ctx.effect`, which Cordis disposes
 *   on unload so a reload replaces the section rather than colliding with it.
 */
export function apply(ctx) {
  const order = ctx.systemPrompt.getSectionOrder?.(SECTION_NAME) ?? FALLBACK_ORDER
  ctx.effect(() => {
    const dispose = ctx.systemPrompt.section({
      name: SECTION_NAME,
      order,
      // A provider, not a string: it re-reads the project's specs on every assembly, so
      // the section follows the files rather than a snapshot taken at boot.
      text: (context) => {
        try {
          const root = findProjectRoot(workspaceOf(context))
          return renderSpecsPrompt(activeSpecs(readSpecs(root)), root)
        } catch {
          // Never throw into a prompt assembly: a malformed spec file must cost the
          // section, not every prompt in the process.
          return ''
        }
      },
    })
    return () => dispose()
  })
}
