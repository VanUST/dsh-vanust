/*
PROOF: the TESTER role cannot write product code, and a test still needs its PROOF header
Behavior: with a role write scope configured, a write/edit by that preset is refused
  (WRITE_SCOPE) unless the path is under one of the role's allowed roots or matches one of its
  globs; an allowed test path still needs the PROOF header; an unscoped preset (backend) keeps
  the old behaviour on product files; a scoped role writing outside the workspace is refused.
Fails when: the tester can edit the product it is testing, the role scope replaces the PROOF rule
  instead of adding to it, or the guard starts refusing product writes for every role.
Production path: plugins/proof-guard/proof-guard.mjs (normalizeConfig roles, matchesScope,
  presetOf, the tools/pre-execute listener) and profile/cordis.patch.yml (roles.tester.allow).
*/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, matchesScope, normalizeConfig } from '../proof-guard.mjs'

const ALLOW = ['docs/cases/', 'test/', 'tests/']

function harness(config = { roles: { tester: { allow: ALLOW } } }) {
  const cwd = mkdtempSync(join(tmpdir(), 'proof-guard-scope-'))
  mkdirSync(join(cwd, 'docs', 'cases'), { recursive: true })
  mkdirSync(join(cwd, 'src'), { recursive: true })
  const handlers = []
  const ctx = {
    on(event, handler) { if (event === 'tools/pre-execute') handlers.push(handler) },
    get() { return undefined },
    logger: { warn() {} },
  }
  apply(ctx, { mode: 'deny', ...config })
  // The plugin now registers more than one pre-execute listener (the scope and the shell audit):
  // drive them in order, the way the tool pipeline does, instead of only the first.
  const run = async (name, path, { preset = 'tester', content = '', newString = 'x' } = {}) => {
    const exec = { name, arguments: name === 'write' ? { file_path: path, content } : { file_path: path, new_string: newString }, agent: { session: { header: { cwd, agentPreset: preset } } } }
    const step = async (index) => (index >= handlers.length ? { kind: 'allow' } : handlers[index](exec, () => step(index + 1)))
    return step(0)
  }
  return { cwd, run }
}

const PROOF = '/*\nPROOF: x\nBehavior: y\nFails when: z\n*/\n'

test('B1: a path that climbs out of the allowed root cannot write the product', async () => {
  const { cwd, run } = harness()
  const climbs = [
    // The scope prefix is a PREFIX of the raw string; the resolved path is the product file.
    'docs/cases/../../src/app.mjs',
    'docs/cases/../../src/app.mjs',
    'test/../src/app.mjs',
    'docs/cases/../../../outside.mjs',
    'docs/cases/..\\..\\src\\app.mjs',
    join(cwd, 'src', 'app.mjs'),
  ]
  for (const path of climbs) {
    const verdict = await run('write', path, { content: PROOF })
    assert.equal(verdict?.kind, 'deny', `the scope allowed ${path}`)
    assert.match(verdict.reason, /WRITE_SCOPE/, path)
  }
  // B3: a PRODUCT file named *.test.* outside a test root is still the product, even with a
  // PROOF header. The scope names roots, not file-name patterns.
  const productNamedTest = await run('write', 'src/app.test.mjs', { content: PROOF })
  assert.equal(productNamedTest.kind, 'deny', 'a product file named *.test.* was allowed')
  assert.match(productNamedTest.reason, /WRITE_SCOPE/)
  // A test inside a test root is allowed, and so is a spec file under tests/.
  const testNamed = await run('write', 'tests/app.spec.mjs', { content: PROOF })
  assert.equal(testNamed.kind, 'allow', 'a test under a test root is allowed')
  const disguised = await run('write', 'test/../src/app.mjs', { content: PROOF })
  assert.equal(disguised.kind, 'deny', 'a product path disguised as a test climbed out')
})

test('scope matching covers a prefix, a glob and nothing else', () => {
  assert.equal(matchesScope('docs/cases/a.json', 'docs/cases/'), true)
  assert.equal(matchesScope('docs/cases/tests/a.test.mjs', 'docs/cases/'), true)
  assert.equal(matchesScope('plugins/x/y.test.mjs', '**/*.test.*'), true)
  assert.equal(matchesScope('plugins/x/y.spec.ts', '**/*.spec.*'), true)
  assert.equal(matchesScope('src/product.mjs', 'test/'), false)
  assert.equal(matchesScope('src/product.test.mjs', 'test/'), false)
  // H2: a leading `**` + slash must also match the workspace ROOT, or the rule exempts the root.
  assert.equal(matchesScope('x.spec.mjs', '**/*.spec.*'), true)
  assert.equal(matchesScope('x.test.mjs', '**/*.test.*'), true)
  assert.deepEqual(normalizeConfig({ roles: { tester: { allow: ALLOW }, empty: { allow: [] } } }).roles, { tester: { allow: ALLOW } })
})

test('the tester writes cases and tests, never the product', async () => {
  const { cwd, run } = harness()
  assert.equal((await run('write', join(cwd, 'docs', 'cases', 'probe.json'), { content: '{}' })).kind, 'allow')
  assert.equal((await run('write', join(cwd, 'test', 'probe.test.mjs'), { content: PROOF })).kind, 'allow')
  const product = await run('write', join(cwd, 'src', 'probe.mjs'), { content: 'export default 1\n' })
  assert.equal(product.kind, 'deny')
  assert.match(product.reason, /WRITE_SCOPE/)
  assert.match(product.reason, /tester/)
  const edit = await run('edit', join(cwd, 'src', 'probe.mjs'))
  assert.equal(edit.kind, 'deny', 'edit slipped past the scope')
})

test('an allowed test path still needs its PROOF header', async () => {
  const { cwd, run } = harness()
  const bare = await run('write', join(cwd, 'test', 'probe.test.mjs'), { content: 'test("x", () => {})\n' })
  assert.equal(bare.kind, 'deny')
  assert.match(bare.reason, /autotest/)
})

test('B1 residual: a junction at an existing ancestor cannot smuggle a write into the product', async () => {
  const { cwd, run } = harness()
  // A junction under the case root that points at the product directory. The write names a
  // sub-directory that does not exist yet, which is what the first fix missed.
  let linked = true
  try {
    symlinkSync(join(cwd, 'src'), join(cwd, 'docs', 'cases', 'jlink'), 'junction')
  } catch {
    linked = false
  }
  if (!linked) return
  const smuggled = await run('write', 'docs/cases/jlink/newdir/deep/helper.mjs', { content: 'export default 1\n' })
  assert.equal(smuggled.kind, 'deny', 'a junction under the case root let the write reach the product')
  assert.match(smuggled.reason, /WRITE_SCOPE/)
})

test('an unscoped role keeps the old behaviour, and a path outside the workspace is out of scope', async () => {
  const { cwd, run } = harness()
  assert.equal((await run('write', join(cwd, 'src', 'probe.mjs'), { content: 'export default 1\n', preset: 'backend' })).kind, 'allow')
  const outside = await run('write', join(cwd, '..', 'elsewhere.mjs'), { content: 'x' })
  assert.equal(outside.kind, 'deny', 'a scoped role wrote outside the workspace')
})

test('B2: a hard link under an allowed root is refused, because it is the product', async () => {
  const { cwd, run } = harness()
  const product = join(cwd, 'src', 'probe.mjs')
  writeFileSync(product, 'export default 1\n', 'utf8')
  let linked = true
  try {
    require('node:fs').linkSync(product, join(cwd, 'docs', 'cases', 'link.mjs'))
  } catch {
    linked = false
  }
  if (!linked) return
  const verdict = await run('write', 'docs/cases/link.mjs', { content: 'export default 2\n' })
  assert.equal(verdict.kind, 'deny', 'a hard link to the product was written through the case root')
  assert.match(verdict.reason, /WRITE_SCOPE/)
  assert.match(verdict.reason, /hard link/)
})

test('the tester write scope in the profile is the case library and the test roots only', () => {
  const profile = readFileSync(join(process.cwd(), 'profile', 'cordis.patch.yml'), 'utf8')
  const block = profile.slice(profile.indexOf('roles:'), profile.indexOf('# ── tool-families'))
  const tester = block.slice(block.indexOf('tester:'))
  const allow = tester.slice(tester.indexOf('allow:'), tester.indexOf('allow:') + 400)
  for (const root of ['- docs/cases/', '- test/', '- tests/']) assert.ok(allow.includes(root), 'the profile lost ' + root)
  // D4: a global file-name pattern would let a PRODUCT file named *.test.* through (B3).
  assert.ok(!allow.includes('**/*.test.*'), 'the profile still allows a product file named *.test.*')
  assert.ok(!allow.includes('**/*.spec.*'), 'the profile still allows a product file named *.spec.*')
})
