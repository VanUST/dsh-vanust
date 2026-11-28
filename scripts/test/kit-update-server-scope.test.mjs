/*
PROOF: a `dsh web` server on another port no longer makes this profile's port look
  busy, while the harness-replacement gate still refuses under any `dsh web` on the machine.
Behavior: `kit-update --check --json --port P` reports `server.running` and
  `server.pids` from the /proc scan filtered to the processes that declared port P
  (`dsh web --port P`), plus the HTTP answer on P; a `dsh web --port Q` process is
  invisible to `--port P` and visible to `--port Q`. The check's own process and its
  ancestors are never named, because those pids are what `dsh web --restart` sends TERM
  to. The harness replacement gate (`convergeHarness`) still sees every `dsh web` on
  the machine, whatever its port and home.
Fails when: the scan stops filtering by declared port (any `dsh web` makes `running`
  true again), when the ancestor chain is no longer excluded, or when the gate starts
  reading the port-filtered list instead of the machine-wide one.
Production path: scripts/kit-update.mjs (`linuxWebServers`, `profileServer`,
  `serverView`, `convergeHarness`), exercised through the real CLI. scripts/test-all.mjs
  runs this file through `node --test`. The /proc scan is Linux-only production code, so
  the tests that depend on it are skipped on Windows; there one test covers the HTTP half
  (busy port true, no pid guessed), which is the half Windows runs.
*/

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const KIT_UPDATE = join(KIT, 'scripts', 'kit-update.mjs')
const control = process.env.CASE_NEGATIVE_CONTROL ?? ''
const windows = process.platform === 'win32'
// `kit-update` reads /proc only on Linux; on Windows it answers from the HTTP probe alone
// (scripts/kit-update.mjs says so where linuxWebServers is defined). The tests that
// synthesise a process through /proc cannot run here, so they are named as skipped and the
// Windows half gets its own test at the bottom instead of a file that silently runs zero.
const linuxOnly = windows ? 'Linux /proc scan; Windows exercises the HTTP probe instead' : false

let work
let home
let fakeRoot
let shimDir
let checkEnv
const children = []

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** One free TCP port: bound, read, released. Nothing listens on it afterwards. */
function freePort() {
  const server = createServer()
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => done(port))
    })
  })
}

/**
 * A stand-in for the machine's npm, first on PATH: it answers `npm root -g` with a
 * temporary root and refuses every other call. The gate test therefore reaches the
 * install step without touching the machine's global npm or its node_modules.
 */
function writeNpmShim() {
  const path = join(shimDir, 'npm')
  writeFileSync(path, '#!/bin/sh\nif [ "$1" = "root" ] && [ "$2" = "-g" ]; then printf "%s\\n" "' + fakeRoot + '"; exit 0; fi\nexit 1\n')
  chmodSync(path, 0o755)
  return path
}

/** Wait until something accepts TCP connections on this port. */
function waitForPort(port) {
  return new Promise((done, fail) => {
    const attempt = (tries) => {
      const socket = connect(port, '127.0.0.1')
      socket.on('connect', () => { socket.destroy(); done() })
      socket.on('error', () => {
        socket.destroy()
        if (tries >= 100) fail(new Error('nothing listened on port ' + port))
        else setTimeout(() => attempt(tries + 1), 20)
      })
    }
    attempt(0)
  })
}

/** A `bin.js` with the shape of the harness entry point, doing nothing but sleep. */
function writeSleeperBin(dir, source) {
  const lib = join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib')
  mkdirSync(lib, { recursive: true })
  const bin = join(lib, 'bin.js')
  writeFileSync(bin, source ?? 'setTimeout(() => {}, 600000)\n')
  return bin
}

/** Start one synthetic `dsh web` process and wait until /proc can see it. */
async function startWeb(bin, args, env) {
  const child = spawn(process.execPath, [bin, ...args], { stdio: ['ignore', 'ignore', 'ignore'], env })
  children.push(child)
  for (let tries = 0; tries < 100; tries += 1) {
    try {
      if (readFileSync('/proc/' + child.pid + '/cmdline', 'utf8').includes('web')) return child
    } catch {}
    await sleep(20)
  }
  throw new Error('synthetic dsh web pid ' + child.pid + ' never appeared in /proc')
}

/** Run the real check and parse its one JSON object. */
function runCheck(port) {
  const result = spawnSync(
    process.execPath,
    [KIT_UPDATE, '--check', '--json', '--kit', KIT, '--home', home, '--port', String(port)],
    { encoding: 'utf8', env: checkEnv },
  )
  assert.equal(result.status, 0, 'kit-update --check --port ' + port + ' exited ' + result.status + '\n' + result.stderr.slice(-1200))
  return JSON.parse(result.stdout)
}

const PARENT_BIN = [
  "import { spawnSync } from 'node:child_process'",
  'const argv = process.argv.slice(2)',
  'const portAt = argv.indexOf(\'--port\')',
  'const [checkPort, home, kit] = argv.filter((arg, i) => arg !== \'web\' && i !== portAt && i !== portAt + 1)',
  'const result = spawnSync(process.execPath, [' + JSON.stringify(KIT_UPDATE) + ', \'--check\', \'--json\', \'--kit\', kit, \'--home\', home, \'--port\', checkPort], { encoding: \'utf8\', env: process.env })',
  'process.stdout.write(result.stdout ?? \'\')',
  'process.stderr.write(result.stderr ?? \'\')',
  'process.exit(result.status ?? 1)',
].join('\n')

before(async () => {
  work = mkdtempSync(join(tmpdir(), 'kit-update-server-scope-'))
  home = join(work, 'home')
  mkdirSync(home, { recursive: true })
  fakeRoot = join(work, 'npm-root')
  mkdirSync(join(fakeRoot, '@deepseek-ai', 'dsh'), { recursive: true })
  writeFileSync(join(fakeRoot, '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.0.0-scope-test' }))
  shimDir = join(work, 'bin')
  mkdirSync(shimDir, { recursive: true })
  writeNpmShim()
  checkEnv = { ...process.env, PATH: shimDir + ':' + (process.env.PATH ?? '') }
  // The imported module resolves `npm` through this process's PATH, so set it here
  // (and prove the shim wins below) before any gate call can reach an install.
  process.env.PATH = checkEnv.PATH
})

after(() => {
  for (const child of children) {
    try { child.kill('SIGKILL') } catch {}
  }
  if (work) rmSync(work, { recursive: true, force: true })
})

test('negative control expect-pre-fix reports a foreign-port server as this port', { skip: linuxOnly }, async () => {
  if (control !== 'expect-pre-fix') return
  // The pre-fix shape: every `dsh web` on the machine makes `server.running` true,
  // whatever port it declared. This assertion must FAIL on the fixed script.
  const bin = writeSleeperBin(join(work, 'control'))
  const foreign = await freePort()
  const checked = await freePort()
  await startWeb(bin, ['web', '--port', String(foreign)], checkEnv)
  const json = runCheck(checked)
  assert.equal(json.server.running, true, 'pre-fix: any dsh web counted as this port server')
})

test('a dsh web on another port does not make this profile port look busy (AC-1)', { skip: linuxOnly }, async () => {
  const bin = writeSleeperBin(join(work, 'foreign'))
  const foreignPort = await freePort()
  const checkedPort = await freePort()
  const foreign = await startWeb(bin, ['web', '--port', String(foreignPort)], checkEnv)

  const json = runCheck(checkedPort)
  assert.equal(json.server.port, checkedPort, 'the report names the port that was asked about')
  assert.equal(json.server.running, false, 'a dsh web --port ' + foreignPort + ' (pid ' + foreign.pid + ') made port ' + checkedPort + ' look busy')
  assert.deepEqual(json.server.pids, [], 'no pid may be offered for TERM on a port nothing serves')
  assert.equal(json.server.http.running, false)
  for (const key of ['drift', 'plan', 'server']) assert.ok(key in json, 'the JSON contract keeps ' + key)
  for (const key of ['port', 'running', 'http', 'pids']) assert.ok(key in json.server, 'server keeps ' + key)

  const own = runCheck(foreignPort)
  assert.equal(own.server.running, true, 'the server of its own port must still be visible')
  assert.ok(own.server.pids.includes(foreign.pid), 'pid ' + foreign.pid + ' missing from its own port list: ' + JSON.stringify(own.server.pids))
})

test('the check own process and its ancestors are never named (AC-3)', { skip: linuxOnly }, async () => {
  const parentBin = writeSleeperBin(join(work, 'parent'), PARENT_BIN)
  const parentPort = await freePort()
  const sibling = await startWeb(writeSleeperBin(join(work, 'sibling')), ['web', '--port', String(parentPort)], checkEnv)
  const parent = spawn(
    process.execPath,
    [parentBin, 'web', '--port', String(parentPort), String(parentPort), home, KIT],
    { env: checkEnv },
  )
  let out = ''
  parent.stdout.setEncoding('utf8')
  parent.stdout.on('data', (chunk) => { out += chunk })
  let err = ''
  parent.stderr.setEncoding('utf8')
  parent.stderr.on('data', (chunk) => { err += chunk })
  const exitCode = await new Promise((done) => parent.on('exit', (code) => done(code)))
  assert.equal(exitCode, 0, 'the check below the synthetic parent failed: ' + err.slice(-1200))
  const json = JSON.parse(out)

  assert.ok(json.server.pids.includes(sibling.pid), 'a server that is not an ancestor (pid ' + sibling.pid + ') must stay visible: ' + JSON.stringify(json.server.pids))
  assert.equal(json.server.pids.includes(parent.pid), false, 'the check own parent (pid ' + parent.pid + ') was offered for TERM: ' + JSON.stringify(json.server.pids))
  assert.equal(json.server.pids.includes(process.pid), false, 'the test process itself is an ancestor and must not be named')
})

test('the harness gate still sees any dsh web on the machine (AC-2)', { skip: linuxOnly }, async () => {
  const module = await import(pathToFileURL(KIT_UPDATE).href)
  const bin = writeSleeperBin(join(work, 'other-home'))
  const otherHome = join(work, 'another-machine-home')
  mkdirSync(otherHome, { recursive: true })
  const otherPort = await freePort()
  const checkedPort = await freePort()
  const foreign = await startWeb(bin, ['web', '--port', String(otherPort)], { ...checkEnv, DSH_HOME: otherHome })

  const probe = await module.profileServer(checkedPort)
  assert.equal(probe.running, false, 'the checked port is still free')
  assert.ok(probe.machine.some((row) => row.pid === foreign.pid), 'pid ' + foreign.pid + ' missing from the machine-wide scan: ' + JSON.stringify(probe.machine))

  const blocked = await module.convergeHarness({
    want: '0.0.0-scope-test-newer',
    enabled: true,
    server: probe.running ? probe : null,
    machine: probe.machine,
  })
  assert.equal(blocked.action, 'blocked', 'the harness replacement was not refused: ' + JSON.stringify(blocked))
  assert.equal(blocked.reason, 'web-server-running')
})

test('the gate is a gate, not a wall: no dsh web on the machine lets the replacement run (AC-2 control)', { skip: linuxOnly }, async () => {
  // Safety: the gate must resolve npm through the shim before it is ever allowed to call
  // it, or a regression there would run a real global install on this machine.
  const resolved = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', env: checkEnv })
  assert.equal(resolved.stdout.trim(), fakeRoot, 'the npm PATH shim is not first; refusing to let the gate test run a real install')
  const module = await import(pathToFileURL(KIT_UPDATE).href)
  const result = await module.convergeHarness({ want: '0.0.0-scope-test-newer', enabled: true, server: null, machine: [] })
  assert.equal(result.action, 'failed', 'the shim refuses the install, so the gate let it through and the step failed')
})
test('a dsh web started without --port is attributed to the port it listens on (AC-1)', { skip: linuxOnly }, async () => {
  // The live :3080 server is started without --port, so its command line names no port.
  // The socket table plus the process's own descriptors are what say which port it serves.
  const listenerBin = writeSleeperBin(join(work, 'portless'), [
    "require('node:http')",
    "  .createServer((request, response) => response.end('ok'))",
    "  .listen(Number(process.env.SCOPE_LISTEN_PORT), '127.0.0.1')",
  ].join('\n'))
  const servedPort = await freePort()
  const otherPort = await freePort()
  const server = spawn(process.execPath, [listenerBin, 'web'], { stdio: ['ignore', 'ignore', 'ignore'], env: { ...checkEnv, SCOPE_LISTEN_PORT: String(servedPort) } })
  children.push(server)
  await waitForPort(servedPort)

  const own = runCheck(servedPort)
  assert.equal(own.server.running, true)
  assert.ok(own.server.pids.includes(server.pid), 'a dsh web without --port must be named for the port it listens on: ' + JSON.stringify(own.server.pids))

  const other = runCheck(otherPort)
  assert.equal(other.server.running, false)
  assert.deepEqual(other.server.pids, [], 'the listener on port ' + servedPort + ' leaked into port ' + otherPort)
  for (const key of ['drift', 'plan', 'server']) assert.ok(key in other, 'the JSON contract keeps ' + key)
  for (const key of ['port', 'running', 'http', 'pids']) assert.ok(key in other.server, 'server keeps ' + key)
})

test('a dsh web without --port and without a listening socket is in no port list (AC-2)', { skip: linuxOnly }, async () => {
  const silent = await startWeb(writeSleeperBin(join(work, 'silent')), ['web'], checkEnv)
  const port = await freePort()
  const json = runCheck(port)
  assert.equal(json.server.running, false, 'a process holding no listening socket made port ' + port + ' look busy')
  assert.equal(json.server.pids.includes(silent.pid), false)
  const module = await import(pathToFileURL(KIT_UPDATE).href)
  const machine = module.linuxWebServers()
  assert.ok(machine.some((row) => row.pid === silent.pid && row.port === null), 'a portless silent process stays machine-wide evidence only: ' + JSON.stringify(machine))
})

// The half Windows actually runs: no /proc scan exists, so the HTTP answer alone decides
// `running`, and `pids` stays empty rather than guessing a process to send TERM to.
test('Windows: the HTTP answer names the port busy, and no pid is guessed without /proc', { skip: windows ? false : 'Windows-only; the /proc tests above cover Linux' }, async () => {
  const served = await freePort()
  const idle = await freePort()
  const listener = spawn(
    process.execPath,
    ['-e', "require('node:http').createServer((request, response) => response.end('ok')).listen(Number(process.env.SCOPE_LISTEN_PORT), '127.0.0.1')"],
    { stdio: ['ignore', 'ignore', 'ignore'], env: { ...checkEnv, SCOPE_LISTEN_PORT: String(served) } },
  )
  children.push(listener)
  await waitForPort(served)
  const busy = runCheck(served)
  assert.equal(busy.server.running, true, 'the HTTP answer must make the port busy on Windows')
  assert.equal(busy.server.http.running, true, 'the HTTP detail must report the answer')
  assert.deepEqual(busy.server.pids, [], 'no /proc on Windows, so no pid may be offered for TERM')
  const free = runCheck(idle)
  assert.equal(free.server.running, false, 'a free port must not look busy')
})
