/**
 * PURPOSE
 *   Prove the observable behaviour of the MCP sync: that a declared server becomes the row
 *   the harness loads, that each launcher shape produces the command it needs (a Python
 *   package through uvx, an npm package through npx), and that a server whose launcher is
 *   absent is named and skipped rather than written as a row that cannot start.
 *
 *   It drives the real reader and builder against a spec written into a temporary home, so
 *   the assertion is about the JSON that would reach `$DSH_HOME/cordis.patch.yml` rather
 *   than about the source that produced it.
 *
 * INPUTS
 *   None. The spec is a fixture built here; the temporary home is removed afterwards.
 *
 * OUTPUTS
 *   `node --test scripts/test-mcp-sync.mjs` exits 0 when every case holds.
 *
 * KEYWORDS
 *   mcp, dsh-mcp-client, spec, runner, uvx, npx, patch layer, behaviour test
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A spec naming a runner this plugin does not implement: refused with the runner named,
 *     and no server reaches the row list.
 *   - An npx server on a machine with no npx beside the interpreter: the resolver falls back
 *     to the bare name rather than refusing, because the OS resolves PATH at spawn time.
 */

import { strict as assert } from 'node:assert'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, it } from 'node:test'

import { buildConfig, buildRow, readSpec, resolveNpx } from '../plugins/godot-mcp/godot-mcp.mjs'

/** Every fixture directory created by this file, removed after the run. */
const roots = []

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/**
 * Write a spec into a temporary home and read it back with the real reader.
 *
 * @param servers - The `servers` array to write.
 * @returns The `readSpec` result.
 */
function specWith(servers) {
  const home = mkdtempSync(join(tmpdir(), 'mcp-sync-'))
  roots.push(home)
  const specPath = join(home, 'mcp-servers.json')
  writeFileSync(specPath, `${JSON.stringify({ version: 1, servers }, null, 2)}\n`)
  return readSpec({ specPath, home })
}

describe('mcp sync', () => {
  it('builds an npx row for an npm package, with the package pinned and `-y` first', () => {
    // Fails if an npx server is sent through the uvx shape (the command would be uvx and the
    // package would be treated as a Python distribution), or if the package is dropped from
    // the args - npx would then run with nothing to run.
    const spec = specWith([
      {
        id: 'playwright-mcp',
        serverName: 'playwright',
        runner: 'npx',
        transport: 'stdio',
        package: '@playwright/mcp@0.0.79',
        args: ['--headless', '--isolated'],
      },
    ])
    assert.deepEqual(spec.errors, [])
    const [server] = spec.servers
    assert.equal(server.runner, 'npx')
    const row = buildRow({ server, npx: '/usr/bin/npx' })
    assert.equal(row.config.command, '/usr/bin/npx')
    assert.deepEqual(row.config.args, ['-y', '@playwright/mcp@0.0.79', '--headless', '--isolated'])
    assert.equal(row.config.transport, 'stdio')
    assert.equal(row.config.serverName, 'playwright')
    assert.match(row.id, /playwright/)
  })

  it('keeps the uvx shape for a server that declares no runner, and never asks for npx', () => {
    // Fails if the new field changed the old behaviour: a spec written before `runner`
    // existed must still build the uvx row, and must not be refused for a missing npx.
    const spec = specWith([
      {
        id: 'godot-mcp',
        serverName: 'godot',
        transport: 'stdio',
        package: 'godot-ai==4.2.3',
        telemetry: false,
        telemetryFlag: '--disable-telemetry',
        excludeDomains: ['a', 'b'],
        domainsFlag: '--exclude-domains',
        args: ['--from', 'godot-ai==4.2.3', 'godot-ai', 'attach'],
      },
    ])
    assert.deepEqual(spec.errors, [])
    const [server] = spec.servers
    assert.equal(server.runner, 'uvx', 'an absent runner must default to uvx')
    const row = buildRow({ server, uvx: '/opt/uvx' })
    assert.equal(row.config.command, '/opt/uvx')
    assert.ok(!row.config.args.includes('-y'), 'the npx flag leaked into a uvx row')
    assert.deepEqual(row.config.args, [
      '--from',
      'godot-ai==4.2.3',
      'godot-ai',
      'attach',
      '--disable-telemetry',
      '--exclude-domains',
      'a,b',
    ])
  })

  it('does not push a provider flag at a server that does not declare it', () => {
    // Fails if `telemetry: false` alone still appends `--disable-telemetry`: an npm server
    // that does not know the flag refuses to start over an unknown option, and the failure
    // would surface at boot rather than here.
    const spec = specWith([
      {
        id: 'playwright-mcp',
        serverName: 'playwright',
        runner: 'npx',
        transport: 'stdio',
        package: '@playwright/mcp@0.0.79',
        telemetry: false,
        args: ['--headless'],
      },
    ])
    const [server] = spec.servers
    const row = buildRow({ server, npx: '/usr/bin/npx' })
    assert.ok(!row.config.args.includes('--disable-telemetry'), `a Godot flag reached an npm server: ${JSON.stringify(row.config.args)}`)
  })

  it('refuses a runner it does not implement, naming the value', () => {
    // Fails if an unknown launcher is silently treated as uvx, which would emit a row whose
    // command is wrong and leave the failure to boot time.
    const spec = specWith([{ id: 'odd', serverName: 'odd', runner: 'docker', transport: 'stdio', package: 'x' }])
    assert.equal(spec.ok, false)
    assert.equal(spec.servers.length, 0)
    assert.ok(spec.errors.some((error) => /runner/.test(error) && /docker/.test(error)), JSON.stringify(spec.errors))
  })

  it('requires the launcher its runner needs, and not the other one', () => {
    // Fails if the builder demands uvx from an npm server (or npx from a uvx server): the
    // sync would then report a missing launcher the server never uses.
    const spec = specWith([
      { id: 'npm-one', serverName: 'npmserver', runner: 'npx', transport: 'stdio', package: 'pkg@1.0.0' },
    ])
    const [server] = spec.servers
    assert.throws(() => buildConfig({ server, uvx: '/opt/uvx' }), /npx/)
    assert.doesNotThrow(() => buildConfig({ server, npx: '/usr/bin/npx' }))
  })

  it('resolves npx beside the running interpreter when it is there', () => {
    // The check that would have caught the missing `dirname` import: the far worse bug was
    // that a swallowed ReferenceError returned the bare name, so the row built fine and the
    // path was never verified. The expectation is derived from the filesystem, not from the
    // function under test.
    const beside = join(dirname(process.execPath), process.platform === 'win32' ? 'npx.cmd' : 'npx')
    const resolved = resolveNpx({ env: {} })
    if (existsSync(beside)) assert.equal(resolved, beside, 'npx exists beside node but was not found')
    else assert.equal(resolved, 'npx', 'no npx beside node, so the bare name is the documented fallback')
    assert.equal(resolveNpx({ env: { NPX_BIN: '/custom/npx' } }), '/custom/npx', 'an explicit override must win')
  })
})
