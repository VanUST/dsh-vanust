/**
 * PURPOSE
 *   Prove the specs plugin's observable behaviour: that a project's ACTIVE spec text
 *   reaches a system prompt, that a non-active spec does not, and that a subagent
 *   resolves the SAME project as its parent from its own Session header.
 *
 *   It drives the real shipped plugin — `apply()` registers the section, and the test
 *   calls the provider the plugin actually registered — rather than re-implementing the
 *   rendering beside it. The expected strings are hand-written literals from fixtures
 *   created here, never computed by the code under test.
 *
 * INPUTS
 *   None. Fixtures are built under the OS temporary directory and removed afterwards.
 *
 * OUTPUTS
 *   `node --test scripts/test-specs.mjs` exits 0 when every assertion holds and non-zero
 *   otherwise. Three cases remain the decisions this product rests on; the cases for an
 *   empty project, a malformed registry and a context with no agent were removed as
 *   per-branch coverage under the small-behavioural-suite ruling.
 *
 * KEYWORDS
 *   specs, system prompt, injection, subagent, behaviour test, prompt section
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A project with no `docs/specs`: the section contributes an EMPTY string, not a
 *     header with nothing under it, so a project without specs adds no prompt noise.
 *   - A `draft` spec: excluded from the prompt.
 *   - A provider call with no agent at all: falls back to `process.cwd()` and must not
 *     throw, because a throw during assembly would break every prompt in the process.
 */

import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import { apply, inject } from '../plugins/specs/plugin-specs.mjs'

/** Every fixture root created by this file, removed after the run. */
const roots = []

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/**
 * Build a throwaway project and return its root.
 *
 * @param specs - `{ [filename]: content }` written into `<root>/docs/specs`.
 * @returns Absolute path of a project root carrying `.dsh/project.json` and the specs.
 */
function projectWith(specs) {
  const root = mkdtempSync(join(tmpdir(), 'specs-test-'))
  roots.push(root)
  mkdirSync(join(root, '.dsh'), { recursive: true })
  writeFileSync(join(root, '.dsh', 'project.json'), '{}\n')
  if (Object.keys(specs).length > 0) {
    mkdirSync(join(root, 'docs', 'specs'), { recursive: true })
    for (const [file, content] of Object.entries(specs)) {
      writeFileSync(join(root, 'docs', 'specs', file), content)
    }
  }
  return root
}

/**
 * Register the real plugin against a fake prompt registry and return the provider.
 *
 * The fake implements exactly the two members the plugin uses — `systemPrompt.section`
 * and `ctx.effect` — so the test observes the section the production code registered
 * instead of a copy of the rendering.
 *
 * @returns The registered section's `text` provider.
 */
function registerSection() {
  let captured = null
  const ctx = {
    effect(fn) {
      return fn()
    },
    systemPrompt: {
      section(options) {
        captured = options
        return () => {}
      },
    },
  }
  apply(ctx)
  assert.notEqual(captured, null, 'apply() registered no section')
  return captured.text
}

describe('specs plugin', () => {
  it('injects an active spec body into the prompt', () => {
    // Fails if the provider stops reading `docs/specs`, stops rendering the body, or
    // stops rendering the human-authored header that frames the requirement.
    const root = projectWith({
      'alpha.spec.md': '---\ntitle: Alpha\nstatus: active\n---\nALPHA-BODY-LITERAL\n',
    })
    const text = registerSection()({ agent: { session: { header: { cwd: root } } } })
    assert.match(text, /ALPHA-BODY-LITERAL/)
    assert.match(text, /### Alpha/)
    assert.match(text, /docs\/specs\/alpha\.spec\.md/)
    assert.match(text, /requirements written by the human/)
  })

  it('excludes a spec that is not active', () => {
    // Fails if the status filter is dropped, which would inject drafts and finished
    // specs as if they were current requirements.
    const root = projectWith({
      'live.spec.md': '---\ntitle: Live\nstatus: active\n---\nLIVE-BODY\n',
      'draft.spec.md': '---\ntitle: Draft\nstatus: draft\n---\nDRAFT-BODY\n',
    })
    const text = registerSection()({ agent: { session: { header: { cwd: root } } } })
    assert.match(text, /LIVE-BODY/)
    assert.doesNotMatch(text, /DRAFT-BODY/)
  })

  it('resolves the same project for a subagent that starts in a subdirectory', () => {
    // Fails if the provider stops walking upward from the Session workspace: a subagent
    // whose cwd is a subdirectory would then receive NO specs while its parent received
    // them, which is the exact case the injection exists to cover.
    const root = projectWith({
      'shared.spec.md': '---\ntitle: Shared\nstatus: active\n---\nSHARED-BODY\n',
    })
    const nested = join(root, 'src', 'deep')
    mkdirSync(nested, { recursive: true })
    const text = registerSection()({ agent: { session: { header: { cwd: nested } } } })
    assert.match(text, /SHARED-BODY/)
  })

})
