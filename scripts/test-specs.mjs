/**
 * PURPOSE
 *   Prove the observable behaviour of the two-scope specs catalogue: that a project's
 *   own spec reaches the advisory `items` section and a non-active one does not, that a
 *   project spec CANNOT enter a global-only slot however it is written, that global specs
 *   reach a project that has none of its own, and that one prompt assembly renders from
 *   ONE catalogue snapshot while the next assembly sees a change.
 *
 *   It drives the real shipped plugin - `apply()` registers the sections, and the test
 *   calls the provider each section registered - rather than re-implementing the rendering
 *   beside it. The expected strings are hand-written literals from fixtures created here,
 *   never computed by the code under test.
 *
 * INPUTS
 *   None. Fixtures are built under the OS temporary directory and removed afterwards. The
 *   global scope is exercised by pointing `DSH_HOME` at a scratch home for the duration of
 *   a case and restoring it afterwards.
 *
 * OUTPUTS
 *   `node --test scripts/test-specs.mjs` exits 0 when every assertion holds and non-zero
 *   otherwise. Five cases, each naming the production change that would make it fail.
 *
 * KEYWORDS
 *   specs, two scopes, global, local, prompt slots, scope isolation, batch, snapshot,
 *   behaviour test
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A project with no `docs/specs`: the items section contributes an EMPTY string, not a
 *     header with nothing under it, so a project without specs adds no prompt noise.
 *   - A `draft` spec: excluded from the prompt.
 *   - A local spec naming `slot: rules`: refused, and reported in the catalogue problems
 *     rather than silently dropped.
 *   - `DSH_HOME` restored even when a case fails, so one case cannot leak a scratch home
 *     into the next.
 */

import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import { apply } from '../plugins/specs/plugin-specs.mjs'

/** Every fixture root created by this file, removed after the run. */
const roots = []

/** The `DSH_HOME` this process started with, restored after every case. */
const startingHome = process.env.DSH_HOME

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  if (startingHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = startingHome
})

/** Create a tracked temporary directory and return its path. */
function tempRoot(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

/**
 * Build a throwaway GLOBAL scope and point `DSH_HOME` at it.
 *
 * @param specs - `{ [filename]: content }` written into `<home>/specs`.
 * @returns Absolute home path.
 */
function homeWith(specs) {
  const home = tempRoot('specs-home-')
  mkdirSync(join(home, 'specs'), { recursive: true })
  for (const [file, content] of Object.entries(specs)) {
    writeFileSync(join(home, 'specs', file), content)
  }
  // The machine-facts generator reads this file; without it a `machine` item is refused
  // with a reason, which is the documented behaviour rather than a silent empty section.
  writeFileSync(join(home, 'MACHINE.md'), '# This machine\n\n- Platform: test\n')
  process.env.DSH_HOME = home
  return home
}

/**
 * Build a throwaway project and return its root.
 *
 * @param specs - `{ [filename]: content }` written into `<root>/docs/specs`.
 * @returns Absolute path of a project root carrying `.dsh/project.json` and the specs.
 */
function projectWith(specs) {
  const root = tempRoot('specs-project-')
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
 * Register the real plugin against a fake prompt registry and capture every section.
 *
 * The fake implements exactly the two members the plugin uses - `systemPrompt.section`
 * and `ctx.effect` - so the test observes the sections the production code registered
 * instead of a copy of the rendering.
 *
 * @returns A map of section name to the registration the plugin made.
 */
function registerSections() {
  const sections = new Map()
  const ctx = {
    effect(fn) {
      return fn()
    },
    systemPrompt: {
      section(options) {
        sections.set(options.name, options)
        return () => {}
      },
    },
  }
  apply(ctx)
  assert.ok(sections.size >= 6, `apply() registered ${sections.size} section(s)`)
  return sections
}

/**
 * Render one registered section as the harness would for a Session in `cwd`.
 *
 * @param sections - Map from {@link registerSections}.
 * @param name - Section name, e.g. `specs:items`.
 * @param cwd - The Session workspace.
 * @param context - Optional context object, reused to model ONE assembly calling several
 *   sections (the harness passes the same object to every provider of an assembly).
 * @returns The section text.
 */
function render(sections, name, cwd, context = undefined) {
  const section = sections.get(name)
  assert.ok(section !== undefined, `no section registered as ${name}`)
  return section.text(context ?? { agent: { session: { header: { cwd } } } })
}

describe('specs catalogue', () => {
  it('injects an active project spec into the advisory items section, and not a draft', () => {
    // Fails if the local scope stops reaching `specs:items`, if the status filter is
    // dropped (injecting drafts as if they were current), or if the human-authored framing
    // and the source path stop being printed.
    homeWith({})
    const root = projectWith({
      'live.spec.md': '---\ntitle: Live\nstatus: active\n---\nLIVE-BODY-LITERAL\n',
      'draft.spec.md': '---\ntitle: Draft\nstatus: draft\n---\nDRAFT-BODY-LITERAL\n',
    })
    const sections = registerSections()
    const text = render(sections, 'specs:items', root)
    assert.match(text, /LIVE-BODY-LITERAL/)
    assert.match(text, /### Live/)
    assert.match(text, /source: docs\/specs\/live\.spec\.md/)
    assert.match(text, /requirements written by the human/)
    assert.doesNotMatch(text, /DRAFT-BODY-LITERAL/)
  })

  it('refuses a project spec that names a global-only slot', () => {
    // Fails the moment the scope boundary is dropped: a project could then dilute,
    // reorder or disable a mandatory rule by writing a file into its own repository.
    homeWith({ '10-rules.md': '---\nslot: rules\n---\nGLOBAL-RULE-LITERAL\n' })
    const root = projectWith({
      'override.spec.md': '---\ntitle: Override\nslot: rules\n---\nLOCAL-OVERRIDE-LITERAL\n',
    })
    const sections = registerSections()
    const context = { agent: { session: { header: { cwd: root } } } }
    const rules = render(sections, 'specs:rules', root, context)
    assert.match(rules, /GLOBAL-RULE-LITERAL/)
    assert.doesNotMatch(rules, /LOCAL-OVERRIDE-LITERAL/)
    for (const name of sections.keys()) {
      assert.doesNotMatch(render(sections, name, root, context), /LOCAL-OVERRIDE-LITERAL/)
    }
  })

  it('reaches a project that has no specs of its own with the global items', () => {
    // Fails if the global scope is read only when the project has specs, or if the
    // identity, rules and generated machine items stop rendering.
    homeWith({
      '00-identity.md': '---\nslot: identity\n---\nGLOBAL-IDENTITY-LITERAL\n',
      '10-rules.md': '---\nslot: rules\n---\nGLOBAL-RULE-LITERAL\n',
      '90-machine.md': '---\nslot: machine\ngenerated: machine-facts\n---\nplaceholder\n',
    })
    const root = projectWith({})
    const sections = registerSections()
    const context = { agent: { session: { header: { cwd: root } } } }
    assert.equal(render(sections, 'specs:identity', root, context), 'GLOBAL-IDENTITY-LITERAL')
    assert.match(render(sections, 'specs:rules', root, context), /GLOBAL-RULE-LITERAL/)
    assert.match(render(sections, 'specs:rules', root, context), /MANDATORY OPERATING RULES/)
    assert.match(render(sections, 'specs:machine', root, context), /Platform: test/)
    assert.equal(render(sections, 'specs:items', root, context), '')
  })

  it('renders one assembly from one snapshot, and the next assembly sees the change', () => {
    // Fails if a section re-reads the catalogue while an assembly is in flight (a batch
    // edit could then land half-applied inside one prompt), or if a later assembly kept a
    // cached snapshot (an edit would need a restart).
    const home = homeWith({ '10-rules.md': '---\nslot: rules\n---\nFIRST-BODY\n' })
    const root = projectWith({})
    const sections = registerSections()
    const firstAssembly = { agent: { session: { header: { cwd: root } } } }
    assert.match(render(sections, 'specs:rules', root, firstAssembly), /FIRST-BODY/)

    writeFileSync(join(home, 'specs', '10-rules.md'), '---\nslot: rules\n---\nSECOND-BODY\n')
    writeFileSync(join(home, 'specs', '20-late.md'), '---\nslot: rules\norder: 20\n---\nLATE-BODY\n')

    const sameAssembly = render(sections, 'specs:rules', root, firstAssembly)
    assert.match(sameAssembly, /FIRST-BODY/, 'a section re-read the catalogue mid-assembly')
    assert.doesNotMatch(sameAssembly, /SECOND-BODY|LATE-BODY/)

    const nextAssembly = render(sections, 'specs:rules', root, { agent: { session: { header: { cwd: root } } } })
    assert.match(nextAssembly, /SECOND-BODY/, 'the next assembly kept the stale snapshot')
    assert.match(nextAssembly, /LATE-BODY/, 'the batch added in the same step did not land together')
    assert.doesNotMatch(nextAssembly, /FIRST-BODY/)
  })

  it('resolves the same project for a subagent that starts in a subdirectory', () => {
    // Fails if the provider stops walking upward from the Session workspace: a subagent
    // whose cwd is a subdirectory would then receive NO specs while its parent received
    // them, which is the exact case the injection exists to cover.
    homeWith({})
    const root = projectWith({
      'shared.spec.md': '---\ntitle: Shared\nstatus: active\n---\nSHARED-BODY-LITERAL\n',
    })
    const nested = join(root, 'src', 'deep')
    mkdirSync(nested, { recursive: true })
    const text = render(registerSections(), 'specs:items', nested)
    assert.match(text, /SHARED-BODY-LITERAL/)
  })
})
