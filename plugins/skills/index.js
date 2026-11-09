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
 *   explain-webpage, ui-builder, proof-not-tests, literature-review,
 *   tests-that-could-fail, visual-explanations, ui-testing, ui-design-system,
 *   research-first, canvas-test-bridge, property-based-domain-tests,
 *   visual-golden-tests, a11y-keyboard-audit, maestro-mobile-flows,
 *   test-run-observability.
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
    whenToUse: 'A design note, a paper comparison, or any explanation a busy human must read once.',
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
    whenToUse: 'The answer is a flow, architecture, sequence or state machine; a document needs a visual.',
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
    file: 'tests-that-could-fail.md',
    name: 'tests-that-could-fail',
    description: 'A check earns its place only if it can fail: name the production change it catches, watch it go red first, and refuse assertions that restate their own setup.',
    whenToUse: 'About to write or review a test, or about to claim that something works.',
    invocation: { modelInvocable: true, userInvocable: true },
  },
  {
    file: 'visual-explanations.md',
    name: 'visual-explanations',
    description: 'Choose the artifact (deck, diagram, interactive page, animation) from the reader\'s question, then apply one visual system and the show-the-transformation discipline.',
    whenToUse: 'A document, deck, diagram or explainer is requested, or a record needs a visual.',
    invocation: { modelInvocable: true, userInvocable: true },
  },
  {
    file: 'ui-testing.md',
    name: 'ui-testing',
    description: 'Prove a web UI in a browser: role-first locators, web-first assertions, the state matrix, accessibility, and a negative run that proves the check can fail.',
    whenToUse: 'Verifying a page, component or flow in a browser, or reviewing a UI test.',
    invocation: { modelInvocable: true, userInvocable: true },
  },
  {
    file: 'ui-design-system.md',
    name: 'ui-design-system',
    description: 'Tokens, component states and layout patterns for an interface that looks deliberate rather than generated.',
    whenToUse: 'Building or restyling any screen: pick the scales first, then the pattern, then prove contrast and focus.',
    invocation: { modelInvocable: true, userInvocable: true },
  },
  {
    file: 'canvas-test-bridge.md',
    name: 'canvas-test-bridge',
    description: 'Give a canvas/editor app a gated window.__APP_TEST__ bridge so tests read the model and act through the same commands as the UI.',
    whenToUse: 'A canvas, WebGL or notation editor has no DOM to assert against, or a screenshot is the only evidence a flow has.',
    invocation: { modelInvocable: true, userInvocable: true },
  },
  {
    file: 'property-based-domain-tests.md',
    name: 'property-based-domain-tests',
    description: 'Find music-domain edge cases with Vitest and fast-check: invariants for chords, transposition and parsing, a shrunk counterexample, and a property seen to fail.',
    whenToUse: 'Pure domain logic (chords, transposition, parsing, timing) is about to be tested with examples that only cover the obvious cases.',
    invocation: { modelInvocable: true, userInvocable: true },
  },
  {
    file: 'visual-golden-tests.md',
    name: 'visual-golden-tests',
    description: 'Pin the rendering environment and compare canvas/notation screenshots with pixelmatch: element crops, ignoreMask for live regions, reviewed baselines, Argos for shared review.',
    whenToUse: 'Layout, notation glyphs or grid geometry must be protected against a change a role-based test cannot see.',
    invocation: { modelInvocable: true, userInvocable: true },
  },
  {
    file: 'a11y-keyboard-audit.md',
    name: 'a11y-keyboard-audit',
    description: 'Run axe-core plus a scripted keyboard walk on a complex UI: fail serious violations, prove the scan catches an unnamed control, and check focus order, visibility and activation.',
    whenToUse: 'A keyboard-only user must operate a dense editor, or an accessibility claim needs evidence beyond one scan.',
    invocation: { modelInvocable: true, userInvocable: true },
  },
  {
    file: 'maestro-mobile-flows.md',
    name: 'maestro-mobile-flows',
    description: 'Drive the mobile app with Maestro YAML: verify the target is really Android, prefer stable ids, seed state, run smoke flows in CI and read the artifacts.',
    whenToUse: 'A mobile build needs an end-to-end flow (launch, sign-in, create, edit) without an Appium server.',
    invocation: { modelInvocable: true, userInvocable: true },
  },
  {
    file: 'test-run-observability.md',
    name: 'test-run-observability',
    description: 'Leave a failure bundle worth reading: one JSON event per step with a run id, a summarized gate, and Playwright traces uploaded on failure.',
    whenToUse: 'A red run is hard to diagnose, CI artifacts are missing, or a suite needs machine-readable evidence instead of console prose.',
    invocation: { modelInvocable: true, userInvocable: true },
  },
  {
    file: 'research-first.md',
    name: 'research-first',
    description: 'Read the current source before implementing: the installed version, the official docs for that version, the changelog — then write.',
    whenToUse: 'A task with no prior specification, a library or CLI you have not checked in this session, or anything that used to work.',
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
