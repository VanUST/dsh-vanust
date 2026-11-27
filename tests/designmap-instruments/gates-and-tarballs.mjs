/*
PROOF: the shipped gates and the two repacked plugins (AC-8).
Behavior: the designmap and project-state-panel test sets run green - including the source-level
  tests this change added - `make verify` passes all its checks, and repacking each plugin from
  its tree produces a byte-identical tarball to the one shipped in plugins/, at the shipped
  version name.
Fails when: a plugin test file fails or the new test files are missing, a verify check fails, a
  tarball is stale against its tree, or a tarball/version no longer matches its source.
Production path: plugins/designmap, plugins/project-state-panel, plugins/*.tgz, Makefile verify.
*/
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROOT, runCase } from './lib.mjs'

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

function run(command, args, options = {}) {
  try {
    const stdout = execFileSync(command, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 240000, ...options })
    return { code: 0, output: stdout }
  } catch (error) {
    return { code: error?.status ?? 1, output: `${error?.stdout ?? ''}\n${error?.stderr ?? ''}` }
  }
}

const DESIGNMAP_TESTS = [
  'plugins/designmap/test/readability.test.mjs',
  'plugins/designmap/test/diagram-and-layout.test.mjs',
  'plugins/designmap/test/editor-surface.test.mjs',
  'plugins/designmap/test/command-edit.test.mjs',
  'plugins/project-state-panel/test/map-space.test.mjs',
]

const PLUGIN_DIRS = ['plugins/designmap', 'plugins/project-state-panel']

/** The tarball npm pack writes for this package: @scope/name -> scope-name-version.tgz. */
function tarballNameFor(packageJson) {
  return `${packageJson.name.replace(/^@([^/]+)\//, '$1-')}-${packageJson.version}.tgz`
}

runCase('AC-8', async ({ check, equal, log }) => {
  // The source-level tests this change added must be present in the tree under test; on the
  // previous version they do not exist, which is how this check fails there.
  for (const file of DESIGNMAP_TESTS) {
    let exists = false
    try { exists = statSync(join(ROOT, file)).isFile() } catch { exists = false }
    check(exists, `the source-level test ${file} ships in the tree`)
  }
  if (DESIGNMAP_TESTS.some((file) => { try { return !statSync(join(ROOT, file)).isFile() } catch { return true } })) {
    log('skipping the long gates: this tree does not carry the change under test')
    return
  }

  const designmapTests = readdirSync(join(ROOT, 'plugins/designmap/test')).filter((name) => name.endsWith('.test.mjs')).sort().map((name) => `plugins/designmap/test/${name}`)
  const panelTests = readdirSync(join(ROOT, 'plugins/project-state-panel/test')).filter((name) => name.endsWith('.test.mjs')).sort().map((name) => `plugins/project-state-panel/test/${name}`)
  const dm = run('node', ['--test', ...designmapTests])
  log('designmap tests', `exit ${dm.code}`, dm.output.split('\n').filter((line) => /^# (pass|fail|tests)/.test(line)).join(' | '))
  equal(dm.code, 0, `the designmap test files pass (${designmapTests.length} files)`)
  check(/fail\s+0/.test(dm.output), 'the designmap test run reports zero failures')
  const panel = run('node', ['--test', ...panelTests])
  log('panel tests', `exit ${panel.code}`, panel.output.split('\n').filter((line) => /^# (pass|fail|tests)/.test(line)).join(' | '))
  equal(panel.code, 0, `the project-state-panel test files pass (${panelTests.length} files)`)
  check(/fail\s+0/.test(panel.output), 'the panel test run reports zero failures')

  const verify = run('make', ['verify'])
  log('make verify', `exit ${verify.code}`, verify.output.trim().split('\n').slice(-6).join(' | '))
  equal(verify.code, 0, 'make verify passes')
  check(/20\/20/.test(verify.output), 'make verify reports 20/20 checks')

  const packed = mkdtempSync(join(tmpdir(), 'dm-pack-'))
  for (const dir of PLUGIN_DIRS) {
    const manifest = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'))
    const expected = tarballNameFor(manifest)
    const base = expected.slice(0, expected.lastIndexOf('-'))
    const shipped = readdirSync(join(ROOT, 'plugins')).filter((name) => name.startsWith(`${base}-`) && name.endsWith('.tgz'))
    log('tarball for', manifest.name, 'version', manifest.version, 'shipped', JSON.stringify(shipped))
    equal(shipped.length, 1, `exactly one shipped tarball for ${manifest.name} (${shipped.join(', ') || 'none'})`)
    if (shipped.length !== 1) continue
    equal(shipped[0], expected, `the shipped tarball for ${manifest.name} matches package.json version ${manifest.version}`)
    const shippedPath = join(ROOT, 'plugins', shipped[0])
    const result = run('npm', ['pack', '--pack-destination', packed, '--silent'], { cwd: join(ROOT, dir) })
    let built = ''
    try { built = sha256(join(packed, expected)) } catch { built = '' }
    const shippedHash = sha256(shippedPath)
    log('tarball', shipped[0], 'shipped', shippedHash.slice(0, 16), 'repacked', built.slice(0, 16) || '(none)')
    check(result.code === 0 && built !== '', `npm pack rebuilds ${expected} from its tree (exit ${result.code})`)
    equal(built, shippedHash, `${shipped[0]} is byte-identical to a repack of its tree`)
  }
})
