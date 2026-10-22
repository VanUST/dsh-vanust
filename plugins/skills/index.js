/**
 * PURPOSE
 *   Register the deployment's reusable skills as runtime skills, so every
 *   machine gets the same bodies from the same tarball instead of a manual copy
 *   into $DSH_HOME/skills. The bodies are ordinary Markdown in `skills/`; the
 *   registry serves them through the `skill` tool and the human-facing skill
 *   catalog.
 *
 * INPUTS
 *   The `skills` service (declared in `inject`) and the Markdown files beside
 *   this module.
 *
 * OUTPUTS
 *   One registration per skill, each disposed with this plugin. No tool, prompt
 *   section, session event or file is written.
 *
 * KEYWORDS
 *   skills, ponytail, grill-me, grilling, clear-writing, explain-diagram,
 *   explain-webpage, ui-builder, proof-not-tests, literature-review.
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A missing body file fails the mount loudly: a skill catalog that silently
 *     lost a skill is worse than a plugin that refuses to load.
 *   - A duplicate name is the registry's decision; this module registers in a
 *     fixed order and does not try to out-rank a filesystem skill.
 *   - `grill-me` is user-invocable only; the model reaches the procedure through
 *     `grilling`, which is the actual interview.
 */

import { readFileSync } from 'node:fs'

export const name = 'skills'

/** The one service this plugin cannot work without. */
export const inject = ['skills']

/**
 * The skill set, in registration order.
 *
 * `invocation` is the only deployment policy here: `grill-me` stays a human
 * action, while `grilling` is the model-loadable procedure behind it.
 */
const SKILLS = [
  {
    file: 'ponytail.md',
    name: 'ponytail',
    description: 'Lazy-senior discipline: read the callers, take the smallest complete change, reuse before adding, prove the result, and name what you skipped.',
    whenToUse: 'Any coding task; especially when a solution is growing, a dependency is about to be added, or a change needs a review.',
    invocation: { modelInvocable: true, userInvocable: true },
  },
  {
    file: 'grill-me.md',
    name: 'grill-me',
    description: 'A relentless interview to sharpen a plan or design, invoked by the human.',
    whenToUse: 'The user says "grill me" or asks to stress-test a plan before implementation.',
    invocation: { modelInvocable: false, userInvocable: true },
  },
  {
    file: 'grilling.md',
    name: 'grilling',
    description: 'Interview in rounds over the decision frontier until every branch is settled, with a recommended answer beside each question.',
    whenToUse: 'A large or ambiguous task before planning; an idea the user has not yet pinned down.',
    invocation: { modelInvocable: true, userInvocable: true },
  },
  {
    file: 'clear-writing.md',
    name: 'clear-writing',
    description: 'Write concise, concrete explanations in the "80% of the way to ASD-STE100" style; one idea per paragraph, active verbs, no decorative synonyms.',
    whenToUse: 'A handoff, a design note, a paper comparison, or any explanation a busy human must read once.',
    invocation: { modelInvocable: true, userInvocable: true },
  },
  {
    file: 'explain-webpage.md',
    name: 'explain-webpage',
    description: 'Explain a topic through one self-contained interactive HTML page with useful controls, keyboard access and a narrow-screen layout.',
    whenToUse: 'A mechanism is easier to understand by changing an input or stepping through it than by reading prose.',
    invocation: { modelInvocable: true, userInvocable: true },
  },
  {
    file: 'explain-diagram.md',
    name: 'explain-diagram',
    description: 'Explain a system, concept or workflow as a diagram rendered by the local `diagram` tool; relationships, not coordinates.',
    whenToUse: 'The answer is a flow, architecture, sequence or state machine; a handoff needs a visual.',
    invocation: { modelInvocable: true, userInvocable: true },
  },
  {
    file: 'ui-builder.md',
    name: 'ui-builder',
    description: 'Build the smallest accessible interface, then prove it in a browser with Playwright: render, snapshot, screenshot, inspect console and states, fix, present.',
    whenToUse: 'A UI, page, component, layout or visual change is requested.',
    invocation: { modelInvocable: true, userInvocable: true },
  },
  {
    file: 'proof-not-tests.md',
    name: 'proof-not-tests',
    description: 'No autotests: prove behavior by running the product and quoting the command, output and exit code; a test is written only when the human asks and the behavior is non-trivial.',
    whenToUse: 'Before accepting a "done" claim, or whenever a test file is about to be written.',
    invocation: { modelInvocable: true, userInvocable: true },
  },
  {
    file: 'literature-review.md',
    name: 'literature-review',
    description: 'Turn a research question into a short, cited comparison: search several ways, shortlist, read the shortlist, compare, hand off with citations.',
    whenToUse: 'The user asks for papers, a literature review, or the state of the art on a topic.',
    invocation: { modelInvocable: true, userInvocable: true },
  },
]

/**
 * Registers every skill on the calling plugin's context.
 *
 * @param ctx - Cordis context; `ctx.skills` is guaranteed by `inject`.
 */
export function apply(ctx) {
  for (const skill of SKILLS) {
    const content = readFileSync(new URL(`./skills/${skill.file}`, import.meta.url), 'utf8')
    const dispose = ctx.skills.register({
      name: skill.name,
      description: skill.description,
      ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
      content,
      source: 'runtime',
      invocation: skill.invocation,
    })
    ctx.effect(() => dispose)
  }
}
