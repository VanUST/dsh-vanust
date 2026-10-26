/**
 * PURPOSE
 *   Own the lifecycle of the Headroom proxy that compresses this deployment's
 *   model traffic, and the one decision that makes it active: whether the boot
 *   adds the `llm-deepseek` baseURL overlay that points the harness at it.
 *
 *   WHY OWNERSHIP AND NOT A MANUAL COMMAND. The overlay redirects EVERY model
 *   request to 127.0.0.1:8787. If the proxy is not up, the harness cannot reach
 *   a model at all, so "remember to start it" is not an acceptable design; the
 *   launcher calls `ensure` before boot and fails loudly instead of booting a
 *   harness that will fail every turn.
 *
 *   WHY THE PROXY IS DETACHED AND HEALTH-POLLED. Headroom takes several seconds
 *   to import its stack (it printed "Starting proxy server..." ~30s before it
 *   answered /livez on this machine), and it must outlive the launcher. So the
 *   child is detached with its own log, and `ensure` waits for readiness rather
 *   than returning the moment the process was spawned.
 *
 * INPUTS
 *   <command>            status | ensure | start | stop | enable | disable | doctor
 *   --port <n>           proxy port. Default 8787.
 *   --upstream <url>     Anthropic-shaped upstream. Default https://api.deepseek.com/anthropic
 *   --bin <path>         headroom executable. Default: $HEADROOM_BIN, then PATH,
 *                        then ~/.local/bin/headroom, then the uv tool directory.
 *   --home <path>        harness home. Default $DSH_HOME, else ~/.npm/dsh.
 *   --kit <path>         kit checkout. Default the parent of this script.
 *   --timeout <ms>       readiness wait for one start. Default 90000.
 *   --json               one JSON object on stdout instead of human lines.
 *
 * OUTPUTS
 *   Exit 0 on success, 1 when a proxy could not be made healthy, 2 on a usage
 *   error. `enable` writes the marker `$DSH_HOME/headroom/enabled`, `disable`
 *   removes it; the launcher reads that marker and nothing else.
 *
 * KEYWORDS
 *   headroom, context compression, llm proxy, baseURL, opt-in overlay, readiness
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Proxy already healthy on the port: `ensure` reports it and starts nothing,
 *     so the command is safe to run on every boot and from a shell script.
 *   - Stale pidfile (process gone): ignored and overwritten; the health probe,
 *     not the pidfile, is the authority on whether a proxy is usable.
 *   - A foreign process holding the port: `ensure` reports the port as taken and
 *     fails with the pid when it can find one, instead of spawning a second
 *     proxy that would immediately die.
 *   - Headroom missing: every command still answers, with the install line, so
 *     `status` and `doctor` stay useful before the tool is installed.
 *   - `disable` does NOT stop the proxy by default: another profile may be
 *     using it. Pass `--stop` to stop it too.
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_PORT = 8787
const DEFAULT_UPSTREAM = 'https://api.deepseek.com/anthropic'
/** Beacon off (this deployment sends no telemetry), tool search off (it rewrites the tool list). */
const PROXY_ENV = {
  HEADROOM_BEACON: 'off',
  HEADROOM_TELEMETRY: 'off',
  HEADROOM_TOOL_SEARCH: '0',
  HEADROOM_UPDATE_CHECK: 'off',
}

/** Parse `--flag value` and `--flag=value`; unknown flags are a usage error. */
function parseArgs(argv) {
  const known = new Set(['port', 'upstream', 'bin', 'home', 'kit', 'timeout', 'json', 'stop'])
  const options = { port: DEFAULT_PORT, upstream: DEFAULT_UPSTREAM, timeout: 90000, json: false, stop: false }
  const rest = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      rest.push(token)
      continue
    }
    const [rawKey, inline] = token.slice(2).split('=')
    const key = rawKey
    if (!known.has(key)) throw new Error(`unknown option --${key}`)
    if (key === 'json') { options.json = true; continue }
    if (key === 'stop') { options.stop = true; continue }
    const value = inline ?? argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value`)
    if (inline === undefined) index += 1
    if (key === 'port' || key === 'timeout') {
      const number = Number(value)
      if (!Number.isInteger(number) || number <= 0) throw new Error(`--${key} must be a positive integer`)
      options[key] = number
    } else {
      options[key] = value
    }
  }
  const command = rest[0] ?? 'status'
  const commands = new Set(['status', 'ensure', 'start', 'stop', 'enable', 'disable', 'doctor'])
  if (!commands.has(command)) throw new Error(`unknown command ${command}`)
  return { command, options }
}

/** Harness home, matching the rule every other kit script uses. */
function resolveHome(options) {
  if (typeof options.home === 'string' && options.home !== '') return resolve(options.home)
  if (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '') return resolve(process.env.DSH_HOME)
  return resolve(homedir(), '.npm', 'dsh')
}

/** Locate the headroom executable without assuming one install layout. */
function resolveBin(options) {
  const candidates = []
  if (typeof options.bin === 'string' && options.bin !== '') candidates.push(options.bin)
  if (typeof process.env.HEADROOM_BIN === 'string' && process.env.HEADROOM_BIN !== '') candidates.push(process.env.HEADROOM_BIN)
  // `delimiter` is ':' on POSIX and ';' on Windows; splitting on ':' there would
  // read a Windows PATH as one long directory name and report "not installed".
  const names = process.platform === 'win32' ? ['headroom.exe', 'headroom.cmd', 'headroom'] : ['headroom']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue
    for (const name of names) candidates.push(join(dir, name))
  }
  for (const name of names) {
    candidates.push(join(homedir(), '.local', 'bin', name))
    candidates.push(join(homedir(), '.local', 'share', 'uv', 'tools', 'headroom-ai', 'bin', name))
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/** Paths this script owns under the harness home. */
function statePaths(home, kitOption) {
  const dir = join(home, 'headroom')
  // `--kit` was accepted and documented but never read, so `enable --kit <other>`
  // silently copied THIS checkout's overlay. An accepted option that changes nothing
  // is a false success; the resolution order is now explicit.
  const kit = typeof kitOption === 'string' && kitOption !== ''
    ? resolve(kitOption)
    : resolve(process.env.DSH_KIT_DIR ?? join(HERE, '..'))
  return {
    dir,
    marker: join(dir, 'enabled'),
    pid: join(dir, 'proxy.pid'),
    log: join(dir, 'proxy.log'),
    kitPatch: join(kit, 'profile', 'headroom.patch.yml'),
    homePatch: join(dir, 'patch.yml'),
  }
}

/**
 * Whether anything is listening on the port.
 *
 * `/readyz` answering non-2xx is NOT proof the port is free: a foreign listener
 * answers exactly that way, and the old code then spawned a second proxy that died
 * on the busy port while the report said "did not become ready" with no pid. A TCP
 * connect is the honest test of occupancy.
 */
function portOpen(port, timeoutMs = 1200) {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port })
    const finish = (value) => {
      socket.removeAllListeners()
      socket.destroy()
      done(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

/** Ask the proxy whether it can serve traffic. */
async function probe(port, path = '/readyz', timeoutMs = 2500) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
    return { ok: response.ok, status: response.status }
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Read the pidfile, or undefined when it is absent or unreadable. */
function readPid(paths) {
  try {
    const value = Number(readFileSync(paths.pid, 'utf8').trim())
    return Number.isInteger(value) && value > 0 ? value : undefined
  } catch {
    return undefined
  }
}

/** Whether a pid is still alive. */
function alive(pid) {
  if (pid === undefined) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Sleep without a dependency. */
function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

/** Start a detached proxy and wait for readiness. */
async function startProxy(context) {
  const { bin, options, paths, report } = context
  const before = await probe(options.port)
  if (before.ok) {
    report.port = options.port
    report.started = false
    report.reachable = true
    report.note = 'a proxy was already serving on this port'
    return true
  }
  if (bin === undefined) {
    report.error = 'headroom is not installed (looked for HEADROOM_BIN, PATH, ~/.local/bin/headroom, and the uv tool directory)'
    report.next = ['uv tool install --python 3.13 "headroom-ai[proxy]"']
    return false
  }
  if (await portOpen(options.port)) {
    report.error = `port ${options.port} is already held by a process that does not answer /readyz as a headroom proxy`
    report.next = [`stop the other listener, or pass --port <free port>`, `then: node scripts/headroom.mjs ensure --port <that port>`]
    return false
  }

  mkdirSync(paths.dir, { recursive: true })
  const log = openSync(paths.log, 'a')
  const args = ['proxy', '--port', String(options.port), '--anthropic-api-url', options.upstream]
  const child = spawn(bin, args, {
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, ...PROXY_ENV },
  })
  // A non-executable or vanished binary emits 'error' asynchronously. Without this
  // listener Node kills the process with an uncaught exception instead of the
  // documented install-line answer. The pidfile is only written once a pid exists.
  let spawnError
  child.on('error', (error) => {
    spawnError = error
  })
  child.unref()
  if (typeof child.pid === 'number' && child.pid > 0) writeFileSync(paths.pid, `${child.pid}\n`)

  const deadline = Date.now() + options.timeout
  let last = { ok: false, status: 0 }
  while (Date.now() < deadline) {
    await sleep(750)
    last = await probe(options.port)
    if (last.ok) {
      report.port = options.port
      report.pid = child.pid
      report.started = true
      report.reachable = true
      report.log = paths.log
      return true
    }
    if (spawnError !== undefined) break
    if (child.exitCode !== null) break
  }
  report.error = spawnError !== undefined
    ? `the proxy could not be started: ${spawnError.message}`
    : `the proxy did not become ready within ${options.timeout} ms (last probe: ${last.status || last.error || 'no answer'})`
  report.log = paths.log
  report.next = spawnError !== undefined
    ? ['check that the headroom binary is executable, or pass --bin <path>', `read the log: tail -n 40 ${paths.log}`]
    : [`read the log: tail -n 40 ${paths.log}`]
  return false
}

/**
 * Whether a pid is plausibly the proxy this script started.
 *
 * A pidfile outlives its process, and operating systems reuse pids. Signalling a
 * reused pid would kill a stranger's process, so the command line is checked before
 * any signal is sent. Linux exposes it in /proc; elsewhere `ps` answers. When the
 * check cannot run, the answer is false and `stop` refuses rather than guesses.
 */
function looksLikeHeadroom(pid) {
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
    return cmdline.includes('headroom')
  } catch {
    // /proc is Linux-only; fall back to ps.
  }
  if (process.platform === 'win32') {
    // `ps` does not exist on Windows, so the previous fallback always failed and the
    // guard treated its own proxy as a stranger: it deleted the pidfile and left the
    // proxy running. tasklist is the native answer.
    try {
      const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', timeout: 3000 })
      return out.toLowerCase().includes('headroom')
    } catch {
      return false
    }
  }
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 3000 })
    return out.includes('headroom')
  } catch {
    return false
  }
}

/** Stop the proxy this script started, if it is still there. */
async function stopProxy(context) {
  const { options, paths, report } = context
  const pid = readPid(paths)
  const reachable = (await probe(options.port)).ok
  if (pid === undefined || !alive(pid)) {
    report.stopped = false
    report.note = reachable
      ? 'no pidfile of ours, but something is still serving on this port; not killing a process this script did not start'
      : 'nothing to stop'
    return true
  }
  if (!looksLikeHeadroom(pid)) {
    rmSync(paths.pid, { force: true })
    report.stopped = false
    report.note = `pid ${pid} from the pidfile is not headroom (the pid was reused); removed the stale pidfile and killed nothing`
    return true
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    report.error = `could not signal pid ${pid}: ${error instanceof Error ? error.message : String(error)}`
    return false
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(250)
    if (!alive(pid)) break
  }
  if (alive(pid)) {
    try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
  }
  rmSync(paths.pid, { force: true })
  report.stopped = true
  report.pid = pid
  return true
}

/** Write the opt-in marker and project the overlay next to the harness home. */
async function enable(context) {
  const { paths, report } = context
  if (!existsSync(paths.kitPatch)) {
    report.error = `the kit overlay is missing: ${paths.kitPatch}`
    return false
  }
  // Health first, state second. The marker tells start.sh to REDIRECT model traffic,
  // so writing it before a working proxy exists would arm a redirect to nothing.
  if (!(await startProxy(context))) {
    report.enabled = false
    report.note = 'the proxy was not made healthy, so the opt-in marker was NOT written'
    return false
  }
  mkdirSync(paths.dir, { recursive: true })
  // The overlay pins the endpoint, so a non-default port must be written into it or
  // the two would disagree the moment anyone passes --port.
  const rendered = readFileSync(paths.kitPatch, 'utf8').replace('http://127.0.0.1:8787', `http://127.0.0.1:${context.options.port}`)
  if (context.options.port !== 8787 && rendered === readFileSync(paths.kitPatch, 'utf8')) {
    report.error = `the overlay does not name port 8787, so --port ${context.options.port} cannot be applied to it`
    return false
  }
  writeFileSync(paths.homePatch, rendered)
  writeFileSync(paths.marker, `enabled ${new Date().toISOString()} port ${context.options.port}\n`)
  report.enabled = true
  report.marker = paths.marker
  report.patch = paths.homePatch
  report.next = [
    `start the proxy: node scripts/headroom.mjs ensure`,
    `boot with the overlay: dsh web --patch ${paths.homePatch}`,
    `start.sh does both automatically while ${paths.marker} exists`,
  ]
  return true
}

/** Remove the marker so the launcher boots without the overlay. */
function disable(context) {
  const { paths, report } = context
  rmSync(paths.marker, { force: true })
  rmSync(paths.homePatch, { force: true })
  report.enabled = false
  report.next = ['the next boot reaches the model directly; revert is complete']
  return true
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2))
  const home = resolveHome(options)
  const paths = statePaths(home, options.kit)
  const bin = resolveBin(options)
  const context = { bin, options, paths, report: { command, home, port: options.port, upstream: options.upstream, bin: bin ?? null } }
  const { report } = context

  let ok = true
  switch (command) {
    case 'status': {
      const health = await probe(options.port)
      report.reachable = health.ok
      report.httpStatus = health.status
      report.pid = readPid(paths)
      report.pidAlive = alive(report.pid)
      report.enabled = existsSync(paths.marker)
      report.installed = bin !== undefined
      break
    }
    case 'start':
    case 'ensure': {
      ok = await startProxy(context)
      report.enabled = existsSync(paths.marker)
      break
    }
    case 'stop': {
      ok = await stopProxy(context)
      break
    }
    case 'enable': {
      ok = await enable(context)
      if (ok) ok = await startProxy(context)
      break
    }
    case 'disable': {
      ok = disable(context)
      if (options.stop) ok = (await stopProxy(context)) && ok
      break
    }
    case 'doctor': {
      const health = await probe(options.port)
      const before = await probe(options.port, '/stats')
      report.reachable = health.ok
      report.pid = readPid(paths)
      report.enabled = existsSync(paths.marker)
      report.installed = bin !== undefined
      report.overlayPresent = existsSync(paths.homePatch)
      report.statsReachable = before.ok
      report.env = PROXY_ENV
      if (bin === undefined) {
        report.next = ['uv tool install --python 3.13 "headroom-ai[proxy]"']
        ok = false
      } else if (!health.ok) {
        report.next = ['node scripts/headroom.mjs ensure', `tail -n 40 ${paths.log}`]
        ok = false
      } else if (!existsSync(paths.marker)) {
        report.next = ['node scripts/headroom.mjs enable']
      }
      break
    }
    default:
      ok = false
      report.error = `unhandled command ${command}`
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ok, ...report }, null, 2)}\n`)
  } else {
    const lines = [`headroom ${command}: ${ok ? 'ok' : 'FAILED'}`]
    for (const [key, value] of Object.entries(report)) {
      if (key === 'command' || key === 'next') continue
      if (value === undefined) continue
      if (typeof value === 'object' && value !== null) lines.push(`  ${key}: ${JSON.stringify(value)}`)
      else lines.push(`  ${key}: ${value}`)
    }
    if (Array.isArray(report.next)) for (const step of report.next) lines.push(`  → ${step}`)
    process.stdout.write(`${lines.join('\n')}\n`)
  }
  process.exit(ok ? 0 : 1)
}

main().catch((error) => {
  process.stderr.write(`headroom: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(2)
})
