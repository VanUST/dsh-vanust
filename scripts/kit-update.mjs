#!/usr/bin/env node
/**
 * PURPOSE
 *   Make a machine's live dsh deployment match this kit, repeatedly and safely.
 *   The kit is the canonical source (profile files + plugin tarballs + the
 *   deployment procedure + harness pin); every machine is a projection of it. This script is
 *   what turns "the kit changed" into "the machine converged", on any OS, from
 *   either PowerShell or bash, so the update loop does not depend on the shell
 *   that started it.
 *
 * INPUTS
 *   --kit <dir>       kit root (default: the parent of this script's directory)
 *   --home <dir>      DSH_HOME (default: env DSH_HOME, else <userhome>/.npm/dsh)
 *   --profile <name>  profile to converge (default: "web")
 *   --port <n>        the profile's TCP port for the live-server watchdog
 *                     (default: env PORT, else 3080)
 *   --check           report drift only; write nothing (default when no flag)
 *   --apply           back up the profile patch and MCP server list, converge the
 *                     machine, then write the state record
 *   --restore <stamp> put those two files back from <home>/.dsh-kit-backups/<stamp>
 *                     and stop; this is rollback of the installation, not of data
 *   --fetch           git fetch the kit before deciding what drifted
 *   --json            emit one JSON object on stdout (logs still go to stderr)
 *   --no-harness      never touch the globally installed harness
 *   --no-tools        never provision the optional external binaries
 *   --help            usage
 *
 * OUTPUTS
 *   Human mode: key-value progress lines on stdout, diagnostics on stderr.
 *   JSON mode:  exactly one JSON object on stdout:
 *               { ok, kit, home, profile, drift, plan, applied, harness, error,
 *                 server, backup }
 *               `drift` is null when nothing changed; `plan` lists the concrete
 *               actions; `applied` lists what actually ran. Exits 0 when the
 *               run reached a decision (drift or not), 1 only on hard failure,
 *               so a caller can separate "needs update" from "could not tell".
 *               `applied` may contain `provision-tools`: `--apply` also installs the
 *               optional external binaries, so one call converges the whole machine.
 *               `server.running` is the live-server watchdog answer on every
 *               platform, so a launcher can refuse to apply under a live server.
 *               `backup` is the stamped directory `--apply` kept, or null.
 *
 * KEYWORDS
 *   dsh-kit, drift, convergence, idempotent, profile, plugin tarball, pnpm
 *   store, hash-based comparison, DSH_HOME, pinned harness
 *
 * BEHAVIOUR ON EDGE CASES
 *   - No state file (first run): every kit artifact counts as pending, because
 *     nothing on this machine has been checked against the kit yet.
 *   - Kit directory missing a file: that item is skipped and reported, never
 *     fatal; a machine can still be converged for the artifacts that exist.
 *   - No tarballs in kit/plugins: plugin convergence is a no-op (not an error).
 *   - Node older than 24: refused before any read or write with one message and
 *     exit 1. The pinned harness and pnpm 11's Corepack abort on older runtimes,
 *     and `start.sh` runs this script each boot with stderr swallowed, so without
 *     the guard the failure was silent and the machine still looked converged.
 *   - JSON mode never mixes logs into stdout, so a caller can always parse it.
 *   - A server on the profile port is detected by its HTTP answer on every platform;
 *     /proc adds the pid on Linux. The watchdog errs towards "a server is there": any
 *     HTTP answer blocks a harness replacement, because a false block costs a restart
 *     while a false pass costs a browser that cannot load its plugins.
 *   - The first `--apply` on a machine with no profile patch yet backs up nothing and
 *     says so; it does not invent an empty backup that looks like protection.
 *   - `--restore` refuses a stamp that is not one path segment, a manifest that names a
 *     file outside the harness home, and a path this kit does not restore.
 */

import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── argument parsing ───────────────────────────────────────────────────────

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const KIT_DEFAULT = resolve(SCRIPT_DIR, '..')

/** Human-facing usage text for `--help`. */
const USAGE = `kit-update — converge an installed machine onto this kit

  node scripts/kit-update.mjs [--check | --apply | --restore <stamp>] [--fetch]
                              [--json] [--kit <dir>] [--home <dir>]
                              [--profile <name>] [--port <n>] [--no-harness] [--help]

  --check       report what differs from the kit; write nothing (default)
  --apply       keep the profile patch and the MCP server list in
                <home>/.dsh-kit-backups/<stamp>/, then write the profile files
                and rules, install drifted plugin tarballs and the pinned
                harness, then record the machine state
  --restore <stamp>
                put back the profile patch and MCP server list from that backup
                (see <home>/.dsh-kit-backups/ for the stamps), then stop: a
                rollback does not converge. Restart dsh web afterwards.
  --fetch       ask git for new commits before deciding what drifted
  --json        emit one JSON object on stdout (logs still go to stderr)
  --kit <dir>   kit checkout (default: the parent of this script's directory)
  --home <dir>  harness home (default: $DSH_HOME, else <userhome>/.npm/dsh)
  --profile     profile to converge (default: web)
  --port <n>    the profile's port for the live-server watchdog (default: $PORT,
                else 3080). A server that answers HTTP there blocks a harness
                replacement and is reported as server.running in --json.
  --no-harness  never touch the globally installed harness
  --no-tools    never provision the optional external binaries (rtk, marp,
                mermaid, d2); SKIP_TOOLS=1 does the same
  --keep-model-config
                keep the installed agent-default-model row (provider/model/
                reasoningEffort) when the profile patch is written; every other
                row still comes from the kit. A dsh boot hook passes this so an
                automatic update cannot silently change the model cost.
  --help        this text

Drift is decided by content hashes, so a repacked tarball that kept its
filename and version is detected and reported rather than passing silently.
The state record lives in <home>/.dsh-kit-state.json. The harness composes a
profile at boot, so a change applied here needs a restart to take effect:
use start.sh / start.ps1, which converge and boot in one step.
`

/** Parse argv into a flat options object; unknown flags are a hard error. */
function parseArgs(argv) {
  const opts = {
    kit: KIT_DEFAULT,
    home: process.env.DSH_HOME || join(homedir(), '.npm', 'dsh'),
    profile: 'web',
    mode: 'check',
    fetch: false,
    json: false,
    harness: true,
    tools: true,
    keepModelConfig: false,
    port: Number(process.env.PORT) || 3080,
    restore: null,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      i += 1
      if (i >= argv.length) throw new Error(`missing value for ${arg}`)
      return argv[i]
    }
    switch (arg) {
      case '--kit': opts.kit = resolve(next()); break
      case '--home': opts.home = resolve(next()); break
      case '--profile': opts.profile = next(); break
      case '--check': opts.mode = 'check'; break
      case '--apply': opts.mode = 'apply'; break
      case '--fetch': opts.fetch = true; break
      case '--json': opts.json = true; break
      case '--no-harness': opts.harness = false; break
      case '--no-tools': opts.tools = false; break
      case '--keep-model-config': opts.keepModelConfig = true; break
      case '--port': {
        const value = Number(next())
        if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`--port needs a TCP port (1-65535), got "${argv[i]}"`)
        opts.port = value
        break
      }
      case '--restore': opts.restore = next(); opts.mode = 'restore'; break
      case '--help': case '-h': opts.help = true; break
      default: throw new Error(`unknown argument: ${arg}`)
    }
  }
  return opts
}

// ── logging ────────────────────────────────────────────────────────────────
// Human mode writes to stdout; JSON mode routes every log to stderr so stdout
// stays a single parseable object. This is the log-driven contract callers use.

let JSON_MODE = false
const LOG = []

/**
 * Record one structured event and echo it to the operator-visible stream.
 *
 * In JSON mode the event goes to STDERR, never to stdout: a caller parses stdout as a
 * single object, and the contract in this file's header says diagnostics land on stderr.
 */
function log(event, fields = {}) {
  const entry = { event, ...fields }
  LOG.push(entry)
  const detail = Object.entries(fields)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`)
    .join(' ')
  const line = detail ? `${event} ${detail}` : event
  if (JSON_MODE) {
    process.stderr.write(`${line}\n`)
    return
  }
  console.log(line)
}

/** Write a warning to stderr; never throws, never pollutes JSON stdout. */
function warn(message) {
  process.stderr.write(`warn: ${message}\n`)
}

// ── process helpers ────────────────────────────────────────────────────────

// Windows: npm and corepack ship beside the interpreter, so their JavaScript
// entry points are known outright; the harness CLI lives under npm's global
// prefix. Resolving to entry points keeps every spawn a plain argv call with no
// command-line quoting, which a `.cmd` shim would otherwise require because the
// Node installation path contains a space.
const NODE_DIR = dirname(process.execPath)
const NPM_CLI = join(NODE_DIR, 'node_modules', 'npm', 'bin', 'npm-cli.js')
const COREPACK_CLI = join(NODE_DIR, 'node_modules', 'corepack', 'dist', 'corepack.js')
const GLOBAL_BIN = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm')
const DSH_BIN = join(GLOBAL_BIN, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

/**
 * Run a command to completion and return its stdout, or null on failure.
 * Used for every git/npm/pnpm call, so one missing tool degrades a single
 * capability instead of aborting convergence.
 */
function run(cmd, args, options = {}) {
  try {
    return execFileSync(cmd, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options.exec,
    }).trim()
  } catch (error) {
    return null
  }
}

/**
 * Run a command with the operator watching its output; returns success.
 *
 * PURPOSE
 *   Run an installer whose output a human wants to see (pnpm, npm), without ever
 *   writing to the stream a machine-readable caller is reading.
 * INPUTS
 *   cmd/args - executable and arguments (string[]).
 *   options.cwd / options.exec - spawn options (optional).
 * OUTPUTS
 *   true on exit 0, false otherwise (and a warning naming the command).
 * KEYWORDS
 *   installer, stdio, json mode, stdout contract
 *
 * In JSON mode the child's output is captured and relayed to STDERR. Measured before
 * this fix: `--json --apply` printed pnpm's `Progress: resolved 0, reused 0 ...` on
 * stdout, so the "exactly one JSON object" promise broke for the one caller that
 * exists to parse it. Nothing the installer prints is lost - it moves streams.
 */
function runVisible(cmd, args, options = {}) {
  try {
    if (JSON_MODE) {
      const result = spawnSync(cmd, args, { cwd: options.cwd, encoding: 'utf8', ...options.exec })
      if (result.stdout) process.stderr.write(result.stdout)
      if (result.stderr) process.stderr.write(result.stderr)
      if (result.status !== 0) {
        warn(`${cmd} ${args.join(' ')} failed: exit ${result.status ?? 'no status'}`)
        return false
      }
      return true
    }
    execFileSync(cmd, args, {
      cwd: options.cwd,
      stdio: 'inherit',
      ...options.exec,
    })
    return true
  } catch (error) {
    warn(`${cmd} ${args.join(' ')} failed: ${error.message.split('\n')[0]}`)
    return false
  }
}

/**
 * Resolve a tool name to a spawnable command plus the arguments that must
 * precede the caller's own.
 *
 * Windows exposes npm, corepack and the harness as `.cmd` shims, and a plain
 * argv spawn of a `.cmd` is refused. Each name is therefore resolved to the
 * JavaScript entry point behind the shim and run with the current interpreter,
 * so arguments stay an argv array and no path needs command-line quoting. On
 * other platforms the tool is used by name. Returns null when the tool is not
 * installed, which a caller reads as "capability unavailable".
 */
function tool(name) {
  if (process.platform !== 'win32') return { cmd: name, prefix: [] }
  const entry = { npm: NPM_CLI, corepack: COREPACK_CLI, dsh: DSH_BIN }[name]
  if (!entry || !existsSync(entry)) return null
  return { cmd: process.execPath, prefix: [entry] }
}

/** Run a resolved tool to completion and return stdout, or null on failure. */
function runTool(name, args, options = {}) {
  const resolved = tool(name)
  if (!resolved) return null
  return run(resolved.cmd, [...resolved.prefix, ...args], options)
}

/** Run a resolved tool with the operator watching its output. */
function runToolVisible(name, args, options = {}) {
  const resolved = tool(name)
  if (!resolved) {
    warn(`${name} is not installed; cannot run: ${args.join(' ')}`)
    return false
  }
  return runVisible(resolved.cmd, [...resolved.prefix, ...args], options)
}

// ── artifact inventory ─────────────────────────────────────────────────────

/** sha256 of a file's bytes, or null when the file is absent. */
function hashFile(path) {
  if (!existsSync(path)) return null
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Filenames (sorted) directly inside a directory, or [] when it is absent. */
function listFiles(dir, suffix) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return []
  return readdirSync(dir)
    .filter((name) => (suffix ? name.endsWith(suffix) : true))
    .sort()
}

/**
 * Read the plugin package name out of a packed tarball by letting npm unpack
 * it to stdout and pulling the first manifest it prints. Returns null when the
 * tarball cannot be read, which downgrades that tarball to "install it and let
 * pnpm decide" instead of failing the run.
 */
function tarballPackageName(tgzPath) {
  const listing = run('tar', ['-xzOf', tgzPath, 'package/package.json'])
  if (!listing) return null
  try {
    return JSON.parse(listing).name ?? null
  } catch {
    return null
  }
}

/** Read one JSON file, returning null instead of throwing on any problem. */
function readJson(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Inventory the kit: the canonical files this machine must project. Every entry
 * carries both a hash and the source path so the applier never has to re-derive
 * either.
 *
 * Each entry's `dst` is relative to the harness home, so an entry can land either
 * inside the profile directory (`profiles/<profile>/…`) or at the home root. The
 * MCP server spec deliberately lands at the home root: it is read by a plugin that
 * is mounted for every profile, and the row it produces is written to the home patch
 * layer, so projecting it into one profile's directory would make it invisible to
 * the others.
 *
 * `rules` is the procedure document for setup, update and verification
 * (`DEPLOYMENT.md`), installed at the harness home so a machine without the kit
 * checked out can still read it.
 */
function inventoryKit(kit, profile) {
  const items = {
    profile: [
      { id: 'cordis.patch.yml', src: join(kit, 'profile', 'cordis.patch.yml'), dst: join('profiles', profile, 'cordis.patch.yml') },
      { id: 'package.json', src: join(kit, 'profile', 'package.json'), dst: join('profiles', profile, 'package.json') },
      { id: 'pnpm-workspace.yaml', src: join(kit, 'profile', 'pnpm-workspace.yaml'), dst: join('profiles', profile, 'pnpm-workspace.yaml') },
      // The MCP server spec is projected to the HARNESS HOME, not into a profile: the
      // plugin that reads it is mounted for every profile, and the row it produces is
      // written to the home patch layer so one list serves them all. A spec that only
      // existed in the kit would be readable on the machine that has the kit checked out
      // and invisible everywhere else, which is the opposite of the point.
      { id: 'mcp-servers.json', src: join(kit, 'profile', 'mcp-servers.json'), dst: 'mcp-servers.json' },
    ].map((item) => ({ ...item, hash: hashFile(item.src) })),
    rules: ['DEPLOYMENT.md'].map((id) => ({
      id,
      src: join(kit, 'rules', id),
      dst: id,
      hash: hashFile(join(kit, 'rules', id)),
    })),
    plugins: listFiles(join(kit, 'plugins'), '.tgz').map((name) => {
      const src = join(kit, 'plugins', name)
      return { id: name, src, hash: hashFile(src), package: tarballPackageName(src) }
    }),
  }
  return items
}

// ── drift detection ────────────────────────────────────────────────────────

/**
 * Compare the kit inventory with the machine's recorded state and return the
 * concrete work needed, or null when the machine already matches the kit.
 *
 * The comparison is content-hash based on purpose: a plugin can be repacked
 * without a version bump, and a hash catches that where a version number does
 * not. `unrecorded` covers the first run, where nothing is known to be applied.
 */
function computeDrift({ items, state, profile, home }) {
  // The recorded rules hash was a single string in the version that shipped one rules
  // file; a state written by that version cannot vouch for `DEPLOYMENT.md` (indexing a
  // string yields nothing), so it counts as drift and the next apply rewrites it.
  const recordedRule = (id) => state?.rules?.[id] ?? null
  if (!state) {
    return {
      reason: 'no-state-record',
      profileFiles: items.profile.filter((i) => i.hash).map((i) => i.id),
      rules: items.rules.every((i) => i.hash),
      plugins: items.plugins.map((p) => p.id),
    }
  }
  const profileFiles = items.profile
    .filter((item) => item.hash && item.hash !== state.profile?.[item.id])
    .map((item) => item.id)
  const plugins = items.plugins
    .filter((item) => item.hash !== state.plugins?.[item.id])
    .map((item) => item.id)
  const rules = items.rules.some((item) => Boolean(item.hash) && item.hash !== recordedRule(item.id))

  const profileJson = readJson(join(home, 'profiles', profile, 'package.json'))
  const installedPlugins = Object.keys(profileJson?.dependencies ?? {})

  if (profileFiles.length === 0 && plugins.length === 0 && !rules) return null
  return { reason: 'kit-changed', profileFiles, plugins, rules, installedPlugins }
}

/**
 * Report what the kit repository itself has to say: the recorded commit, the
 * current one, and which kit files differ. Read-only diagnostics for the
 * operator; drift is always decided by hashes, never by git state.
 */
function describeRepository(kit, state) {
  const head = run('git', ['-C', kit, 'rev-parse', 'HEAD'])
  if (!head) return { git: false }
  const dirty = Boolean(run('git', ['-C', kit, 'status', '--porcelain']))
  const appliedHead = state?.appliedHead ?? null
  const changedSinceApplied = appliedHead && appliedHead !== head
    ? (run('git', ['-C', kit, 'diff', '--name-only', `${appliedHead}..${head}`]) ?? '').split('\n').filter(Boolean)
    : []
  return { git: true, head, dirty, appliedHead, changedSinceApplied }
}

// ── convergence ────────────────────────────────────────────────────────────

/**
 * Copy the canonical profile files and global rules into DSH_HOME. Returns the
 * list of items written; a missing kit file is skipped and warned about rather
 * than aborting, so one damaged file cannot block the rest of the update.
 */
function installFiles({ items, home, profile }) {
  const written = []
  for (const item of [...items.profile, ...items.rules]) {
    if (!item.hash) { warn(`kit file missing, skipped: ${item.src}`); continue }
    const dst = join(home, item.dst)
    mkdirSync(dirname(dst), { recursive: true })
    copyFileSync(item.src, dst)
    written.push(item.id)
  }
  return written
}

/**
 * The installed `agent-default-model` row, verbatim, or null.
 *
 * The row is a top-level patch entry: it starts at `- id: agent-default-model`
 * and ends before the next top-level `- ` entry. A boot-time convergence keeps
 * this row from the machine, so an automatic kit update can never change the
 * provider, the model or the reasoning effort - a cost decision, not a kit
 * artefact.
 */
function readModelConfigRow(patchPath) {
  if (!existsSync(patchPath)) return null
  const lines = readFileSync(patchPath, 'utf8').split('\n')
  const start = lines.findIndex((line) => /^- id: agent-default-model$/.test(line))
  if (start === -1) return null
  let end = start + 1
  while (end < lines.length && !/^- /.test(lines[end])) end += 1
  while (end > start + 1 && lines[end - 1].trim() === '') end -= 1
  return lines.slice(start, end).join('\n')
}

/** Replace the kit's model row in a freshly written patch with the machine's own. */
function keepModelConfigRow(patchPath, saved) {
  const current = readModelConfigRow(patchPath)
  if (!current || current === saved) return false
  const text = readFileSync(patchPath, 'utf8')
  writeFileSync(patchPath, text.replace(current, () => saved))
  return true
}

/** Plugin package names currently recorded as dependencies of the profile. */
function installedPluginNames(profileJson) {
  return Object.keys(profileJson?.dependencies ?? {})
}

/**
 * Install the kit's plugin tarballs into the profile with the pinned pnpm.
 *
 * Why the explicit `remove`, lockfile drop and `store prune`: pnpm keys a
 * `file:` dependency by its path string and remembers the resolved snapshot in
 * the profile lockfile, so a tarball that kept its filename but changed its
 * bytes is served from that snapshot — the new code silently never lands.
 * Dropping the lockfile and pruning the store before re-adding forces the
 * tarball on disk to be read again. The caller then verifies the installed
 * bytes against the tarball, because this is exactly the kind of failure that
 * passes quietly.
 */
function installPlugins({ items, home, profile }) {
  if (items.length === 0) return { installed: [], skipped: true }
  const profileDir = join(home, 'profiles', profile)
  mkdirSync(profileDir, { recursive: true })
  const pnpm = ['pnpm@11.7.0']
  const stale = installedPluginNames(readJson(join(profileDir, 'package.json')))
  const lockfile = join(profileDir, 'pnpm-lock.yaml')

  if (stale.length > 0) runToolVisible('corepack', [...pnpm, 'remove', ...stale], { cwd: profileDir })
  if (existsSync(lockfile)) {
    try {
      rmSync(lockfile, { force: true })
      log('plugins.lockfile-dropped', { path: lockfile })
    } catch (error) {
      warn(`could not drop ${lockfile}: ${error.message.split('\n')[0]}`)
    }
  }
  runToolVisible('corepack', [...pnpm, 'store', 'prune'], { cwd: profileDir })

  const ok = runToolVisible('corepack', [...pnpm, 'add', ...items.map((p) => p.src)], { cwd: profileDir })
  return { installed: items.map((p) => p.id), ok }
}

/**
 * Directory holding globally installed packages, asked of npm itself so a
 * custom prefix stays supported. Falls back to the conventional Windows global
 * directory when npm cannot answer. Returns null when neither is available.
 */
function globalRoot() {
  const fromNpm = runTool('npm', ['root', '-g'])
  if (fromNpm) return fromNpm
  return process.platform === 'win32' && existsSync(GLOBAL_BIN) ? join(GLOBAL_BIN, 'node_modules') : null
}

/** Version of the globally installed harness, or null when it is absent. */
function installedHarnessVersion() {
  const root = globalRoot()
  if (!root) return null
  return readJson(join(root, '@deepseek-ai', 'dsh', 'package.json'))?.version ?? null
}

/**
 * PIDs of `dsh web` servers running on this machine, from /proc (Linux only).
 * One signal, not the verdict: the port probe below works everywhere. A harness
 * replaced under a running server is the one
 * upgrade that cannot be finished by the next boot: the live process keeps the
 * composition it composed at boot (its Loader rows are in memory) while every
 * file it serves and every `dsh.client` manifest it reads are the new ones. The
 * browser then loads the new client packages, which inject services only the
 * new rows provide (`contextMenus`, `fileDrag` in 0.2.2-rc.3), and boot dies
 * with "Failed to load plugins / N required entries did not activate" until the
 * server is restarted. Measured 2026-11-13 on this machine: a 0.2.1-rc.2
 * process served a 0.2.2-rc.3 tree, sidebar and chat stayed pending and the
 * whole client UI chain with them.
 */
function linuxWebServerPids() {
  if (process.platform !== 'linux') return []
  const pids = []
  let entries = []
  try { entries = readdirSync('/proc') } catch { return [] }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    let cmdline
    try { cmdline = readFileSync(`/proc/${entry}/cmdline`, 'utf8') } catch { continue }
    const args = cmdline.split('\0').filter(Boolean)
    const entryPoint = args.find((arg) => /(^|\/)bin\.js$/.test(arg) || /(^|\/)dsh$/.test(arg))
    if (entryPoint !== undefined && args.includes('web')) pids.push(Number(entry))
  }
  return pids
}

/**
 * Ask the profile port whether a server answers HTTP. Returns `{ running, detail }`.
 *
 * This is the cross-platform half of the watchdog, and it is the half that matters on
 * Windows: /proc does not exist there, so the old check answered "cannot tell" and every
 * harness replacement under a live server went ahead. Node owns the socket API on every
 * platform, so the probe costs no external tool. A refused connection answers in
 * milliseconds; the timeout only bounds a silent host.
 */
function probeProfilePort(port, timeoutMs = 1500) {
  return new Promise((done) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      done(value)
    }
    const req = httpRequest(
      { host: '127.0.0.1', port, path: '/', method: 'GET', timeout: timeoutMs, headers: { connection: 'close' } },
      (res) => {
        res.resume()
        finish({ running: true, detail: `HTTP ${res.statusCode ?? 'response'}` })
      },
    )
    req.on('timeout', () => { req.destroy(); finish({ running: false, detail: `no HTTP answer within ${timeoutMs}ms` }) })
    req.on('error', (error) => finish({ running: false, detail: error.code ?? 'connection failed' }))
    req.end()
  })
}

/**
 * The live-server watchdog: the HTTP answer on the profile port on every platform, plus the
 * /proc scan as an EXTRA signal on Linux (it also names the pid, which the port cannot).
 * Returns null when neither signal fires, so callers keep one "is anything there" test.
 */
async function profileServer(port) {
  const http = await probeProfilePort(port)
  const pids = linuxWebServerPids()
  if (!http.running && pids.length === 0) return null
  return { port, http, pids }
}

/** The watchdog as the JSON contract reports it, present even when nothing answered. */
function serverView(server, port) {
  return {
    port: server?.port ?? port,
    running: server !== null,
    http: server?.http ?? { running: false, detail: 'no HTTP answer' },
    pids: server?.pids ?? [],
  }
}

/**
 * Install or repair the globally pinned harness when the machine's version
 * differs from the kit's `install.ps1`/`install.sh` pin. Both installers carry
 * the same literal, which is read here so a pin bump in the kit propagates
 * without editing this script.
 *
 * A pin bump is refused while a `dsh web` server runs: swapping the tree under
 * a live server cannot be completed by any later step of this convergence (the
 * composition it serves was fixed at boot), so doing it here would only replace
 * a machine that says "restart required" with a browser that cannot load its
 * plugins. The refusal leaves the state untouched and names the restart.
 */
async function convergeHarness({ want, enabled, server }) {
  if (!enabled) return { action: 'skipped' }
  const have = installedHarnessVersion()
  if (have === want) return { action: 'already-current', have, want }
  if (!want) {
    warn('the kit declares no harness pin; leaving the installed harness alone')
    return { action: 'skipped', have, want }
  }
  if (server !== null) {
    const seen = server.pids.length > 0
      ? `dsh web is running (pid ${server.pids.join(', ')})`
      : `a server answers HTTP on the profile port ${server.port} (${server.http.detail})`
    warn(`harness ${have ?? 'absent'} -> ${want} not installed: ${seen}`)
    warn('  a harness replaced under a live server keeps that server\'s OLD composition while serving the NEW client bundles, so the next page load fails with "Failed to load plugins"')
    warn('  stop the web server, then re-run this convergence; the next launch installs the pin and composes the new rows')
    return { action: 'blocked', have, want, reason: 'web-server-running', port: server.port, pids: server.pids }
  }
  log('harness.installing', { want, have: have ?? 'absent' })
  const ok = runToolVisible('npm', ['install', '-g', '--no-audit', '--no-fund', `@deepseek-ai/dsh@${want}`])
  return { action: ok ? 'installed' : 'failed', have, want }
}

/** Read the harness pin the kit's installers carry (single source of truth). */
function pinnedHarness(kit) {
  for (const script of ['install.ps1', 'install.sh']) {
    const path = join(kit, script)
    if (!existsSync(path)) continue
    const match = readFileSync(path, 'utf8').match(/DSH_VERSION\s*[=:]\s*'?([0-9][^'\s"]*)'?/)
    if (match) return match[1]
  }
  return null
}

/**
 * Compare each entry of a tarball with the copy that actually landed in the
 * profile, so a stale cached install is reported instead of silently passing.
 *
 * pnpm resolves a `file:` specifier of an unchanged name and version from its
 * store, so a repacked tarball that kept its version can install old bytes; the
 * content hashes here are what turn that into a warning. Files present in the
 * tarball but absent from the install are reported too, because that is exactly
 * how the stale case shows up first.
 */
function verifyInstalledBytes({ items, home, profile }) {
  const findings = []
  const installedRoot = join(home, 'profiles', profile, 'node_modules')
  for (const item of items) {
    if (!item.package) continue
    const listing = run('tar', ['-tzf', item.src])
    if (!listing) { findings.push(`${item.id}: unreadable tarball`); continue }
    // Split on CRLF as well as LF: Windows tar reports each entry with a
    // carriage return that would otherwise become part of the file path.
    const entries = listing.split(/\r?\n/).map((e) => e.trim())
      .filter((e) => e.startsWith('package/') && !e.endsWith('/'))
    const missing = []
    const differing = []
    for (const entry of entries) {
      const relative = entry.slice('package/'.length)
      const installed = join(installedRoot, ...item.package.split('/'), relative)
      if (!existsSync(installed)) { missing.push(relative); continue }
      const packed = run('tar', ['-xzOf', item.src, entry], { exec: { encoding: 'buffer' } })
      const packedHash = packed === null ? null : createHash('sha256').update(packed).digest('hex')
      if (packedHash && packedHash !== hashFile(installed)) differing.push(relative)
    }
    if (missing.length || differing.length) {
      findings.push(`${item.id}: ${missing.length} file(s) absent, ${differing.length} differing (e.g. ${(missing[0] ?? differing[0] ?? '')})`)
    }
  }
  return findings
}

// ── backup and restore ─────────────────────────────────────────────────────
// The layer a convergence overwrites is the only copy of what the machine was running.
// `--apply` copies the two files it cannot reconstruct for a human - the profile patch and the
// MCP server list - into <home>/.dsh-kit-backups/<stamp>/ BEFORE it writes. The state file is a
// record of what was applied, not a snapshot of what was there, so it cannot serve as one.
// `--restore <stamp>` copies them back. Neither touches sessions, storages or credentials:
// this is rollback of the INSTALLATION, never of data.

const BACKUP_DIR = '.dsh-kit-backups'

/** Files a convergence overwrites and a human may need back, relative to the harness home. */
function backupTargets(profile) {
  return [join('profiles', profile, 'cordis.patch.yml'), 'mcp-servers.json']
}

/** Local-time `YYYYMMDD-HHMMSS`, safe in a path on every platform (no colons). */
function backupStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/** One free stamp: two applies inside the same second must not share a directory. */
function freshBackupStamp(home) {
  const base = backupStamp()
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const stamp = attempt === 0 ? base : `${base}-${attempt + 1}`
    if (!existsSync(join(home, BACKUP_DIR, stamp))) return stamp
  }
  throw new Error(`cannot allocate a backup stamp under ${join(home, BACKUP_DIR)}`)
}

/**
 * Copy the backup targets into a stamped directory and write its manifest.
 * Returns null when there is nothing to copy, so a first-ever apply says so instead of
 * printing an empty backup as if it protected something.
 */
function createBackup({ home, profile }) {
  const present = backupTargets(profile).filter((relative) => existsSync(join(home, relative)))
  if (present.length === 0) return null
  const stamp = freshBackupStamp(home)
  const dir = join(home, BACKUP_DIR, stamp)
  const files = []
  for (const relative of present) {
    const source = join(home, relative)
    const destination = join(dir, relative)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(source, destination)
    files.push({ path: relative.split('\\').join('/'), sha256: hashFile(source) })
  }
  const manifest = { stamp, createdAt: new Date().toISOString(), home, profile, files }
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return { stamp, dir, files: files.map((file) => file.path) }
}

/** Stamps available under <home>/.dsh-kit-backups, newest last. */
function backupStamps(home) {
  try {
    return readdirSync(join(home, BACKUP_DIR))
      .filter((name) => existsSync(join(home, BACKUP_DIR, name, 'manifest.json')))
      .sort()
  } catch {
    return []
  }
}

/**
 * Put the files of one backup back into <home>. Refuses a stamp that is not a single path
 * segment and a manifest entry that escapes the home: a restored file is written over a
 * live profile, so a crafted manifest must not become a write primitive.
 */
function restoreBackup({ home, stamp }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(stamp) || stamp.includes('..')) {
    throw new Error(`--restore needs one backup stamp (letters, digits, dot, dash, underscore); got "${stamp}"`)
  }
  const dir = join(home, BACKUP_DIR, stamp)
  const manifest = readJson(join(dir, 'manifest.json'))
  if (!manifest) {
    const available = backupStamps(home)
    throw new Error(
      `no backup "${stamp}" under ${join(home, BACKUP_DIR)}` +
        (available.length ? `; available: ${available.join(', ')}` : '; no backup has been taken on this machine yet'),
    )
  }
  const restored = []
  for (const file of manifest.files ?? []) {
    const relative = String(file.path ?? '')
    const parts = relative.split(/[\\/]/)
    if (relative === '' || relative.startsWith('/') || parts.includes('..') || /^[A-Za-z]:/.test(relative)) {
      throw new Error(`backup ${stamp} lists a path outside the harness home: "${relative}"`)
    }
    if (!backupTargets(manifest.profile).map((target) => target.split('\\').join('/')).includes(relative)) {
      throw new Error(`backup ${stamp} lists "${relative}", which this kit does not restore`)
    }
    const source = join(dir, relative)
    if (!existsSync(source)) throw new Error(`backup ${stamp} is incomplete: ${relative} is missing from ${dir}`)
    const destination = join(home, relative)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(source, destination)
    const hash = hashFile(destination)
    restored.push({ path: relative, sha256: hash, matchesBackup: hash === file.sha256 })
  }
  return { stamp, dir, restored }
}

// ── state ──────────────────────────────────────────────────────────────────

/** Where the machine records what it last converged to. */
function statePath(home) {
  return join(home, '.dsh-kit-state.json')
}

/**
 * Ask the Hindsight subagent-tool patch script where the installed plugin stands.
 *
 * PURPOSE
 *   Convergence, not a manual step. `@vectorize-io/hindsight-coding-agents` hands its
 *   `hindsight_*` tool bodies the same subagent-excluding resolver its lifecycle hooks
 *   use, so a delegated child that calls one gets "Hindsight memory is disabled for this
 *   workspace." even with a live bank. No released version fixes it and no config key
 *   separates the tool path from the hook path, so the kit ships a one-line patch
 *   (scripts/hindsight-subagent-tools.mjs) and re-applies it after every reinstall.
 * INPUTS
 *   kit - kit root; the patch script lives in <kit>/scripts.
 * OUTPUTS
 *   The patch script's JSON report, or { state: 'script-missing' | 'error' }.
 *   'unpatched' is a decision for the caller to act on, never a failure.
 * KEYWORDS
 *   hindsight, subagent, patch, idempotent, convergence
 *
 * Exit 3 is the script's "unpatched" answer, so this cannot go through `run()`: that
 * helper turns every non-zero exit into null and would report a patchable machine as
 * one the kit could not read.
 */
function inspectHindsightTools(kit, mode = '--check') {
  const script = join(kit, 'scripts', 'hindsight-subagent-tools.mjs')
  if (!existsSync(script)) return { state: 'script-missing', script }
  const result = spawnSync(process.execPath, [script, mode, '--json'], { cwd: kit, encoding: 'utf8' })
  try {
    return JSON.parse((result.stdout ?? '').trim())
  } catch {
    const detail = (result.stderr || result.stdout || '').trim().split('\n').filter(Boolean).slice(-1)[0]
    return { state: 'error', detail: detail ?? 'no output' }
  }
}

/**
 * Ask the harness identity guard where the installed harness stands.
 *
 * PURPOSE
 *   Convergence, not a manual step. `snapshotAppend()` in the pinned harness stores whatever
 *   message a producer passes, and `adoptSessionEvent()` validates identities only when the
 *   session is loaded — so one plugin that injects a message without an `id` makes every session
 *   it touched refuse to open, and the cost is the session. The kit patches both functions
 *   (scripts/harness-identity-guard.mjs); an `npm install` of the harness would restore the
 *   defect, so the patch is re-applied on every boot.
 * INPUTS
 *   kit - kit root; the patch script lives in <kit>/scripts.
 * OUTPUTS
 *   The patch script's JSON report, or { state: 'script-missing' | 'error' }.
 *   'unpatched' is a decision for the caller to act on, never a failure.
 * KEYWORDS
 *   harness, session, identity, patch, idempotent, convergence
 *
 * Exit 3 is the script's "unpatched" answer, so this cannot go through `run()`: that helper
 * turns every non-zero exit into null and would report a patchable harness as unreadable.
 */
function inspectIdentityGuard(kit, mode = '--check') {
  const script = join(kit, 'scripts', 'harness-identity-guard.mjs')
  if (!existsSync(script)) return { state: 'script-missing', script }
  const result = spawnSync(process.execPath, [script, mode, '--json'], { cwd: kit, encoding: 'utf8' })
  try {
    return JSON.parse((result.stdout ?? '').trim())
  } catch {
    const detail = (result.stderr || result.stdout || '').trim().split('\n').filter(Boolean).slice(-1)[0]
    return { state: 'error', detail: detail ?? 'no output' }
  }
}

/** Build the state record written after a successful apply. */
function buildState({ items, kit, repo, harness }) {
  return {
    unit: 'dsh-kit-state',
    version: 1,
    appliedAt: new Date().toISOString(),
    kit,
    appliedHead: repo?.head ?? null,
    profile: Object.fromEntries(items.profile.filter((i) => i.hash).map((i) => [i.id, i.hash])),
    rules: Object.fromEntries(items.rules.filter((i) => i.hash).map((i) => [i.id, i.hash])),
    plugins: Object.fromEntries(items.plugins.map((p) => [p.id, p.hash])),
    harness,
  }
}

// ── main ───────────────────────────────────────────────────────────────────

/** Entry point: inventory, decide, optionally converge, always report. */
async function main(argv) {
  const opts = parseArgs(argv)
  if (opts.help) {
    // A usage summary rather than a dump of the module header: callers read
    // this to learn the flags, and a doc-comment dump buries them.
    console.log(USAGE)
    return 0
  }
  JSON_MODE = opts.json
  const kit = resolve(opts.kit)
  const home = resolve(opts.home)

  // Node >= 24 is a hard prerequisite. Checked before anything is read or written,
  // because the failure it prevents is a silent one: pnpm 11's Corepack and the
  // pinned harness abort on an older runtime, and `start.sh` runs this script on
  // every boot with stderr swallowed, so an unguarded run left a machine that
  // looked converged while no plugin or rule had been installed.
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10)
  if (!Number.isInteger(nodeMajor) || nodeMajor < 24) {
    const message = `Node >= 24 is required (found ${process.version}); pnpm 11 and the pinned harness both need it, so this convergence cannot run. Put a Node 24+ first on PATH and re-run.`
    if (JSON_MODE) emit({ ok: false, error: message })
    else process.stderr.write(`error: ${message}\n`)
    return 1
  }

  // The live-server watchdog runs on every invocation. `--check` reports it, `--apply`
  // refuses a harness replacement under it, and the Windows launcher reads it before
  // applying. The HTTP answer on the profile port is the one signal every platform has;
  // the /proc pid list is an extra, Linux-only.
  const server = await profileServer(opts.port)
  log('server.probe', {
    port: opts.port,
    running: server !== null,
    http: server?.http.detail ?? 'no HTTP answer',
    pids: server?.pids ?? [],
  })

  // Restore is a standalone action: put back what a previous apply kept, then stop. It
  // deliberately does not converge, because the point of a rollback is to stop where the
  // machine was, not to re-impose the kit it just left.
  if (opts.mode === 'restore') {
    const result = restoreBackup({ home, stamp: opts.restore })
    for (const file of result.restored) {
      if (!file.matchesBackup) warn(`${file.path} was restored, but its hash does not match the backup entry`)
    }
    log('backup.restored', { stamp: result.stamp, path: result.dir, files: result.restored.map((file) => file.path) })
    log('kit.restored', { restart: 'required — the profile is composed at boot' })
    emit({ ok: true, kit, home, profile: opts.profile, mode: 'restore', stamp: result.stamp, restored: result.restored, server: serverView(server, opts.port) })
    return 0
  }

  const harnessPin = pinnedHarness(kit)

  log('kit.inventory', { kit, home, profile: opts.profile, mode: opts.mode })
  if (!existsSync(kit)) throw new Error(`kit directory not found: ${kit}`)
  if (opts.fetch) {
    // `run` returns null only on failure, so empty stdout is a SUCCESS: `git fetch
    // --quiet` prints nothing when it works. Testing the trimmed string for truth made
    // every successful fetch warn `git fetch failed`, sending a reader after a network
    // problem that was not there.
    const fetched = run('git', ['-C', kit, 'fetch', '--quiet', 'origin'])
    const fetchOk = fetched !== null
    log('kit.fetch', { ok: fetchOk })
    if (!fetchOk) warn('git fetch failed; deciding on the working tree as it is')
  }

  const state = readJson(statePath(home))
  const items = inventoryKit(kit, opts.profile)
  const repo = describeRepository(kit, state)
  const drift = computeDrift({ items, state, profile: opts.profile, home })

  if (repo.git) {
    log('kit.repository', {
      head: (repo.head ?? '').slice(0, 8),
      appliedHead: repo.appliedHead ? repo.appliedHead.slice(0, 8) : 'none',
      dirty: repo.dirty,
      changedSinceApplied: repo.changedSinceApplied.length,
    })
  }
  log('kit.artifacts', {
    profileFiles: items.profile.length,
    plugins: items.plugins.map((p) => p.id),
    rules: items.rules.map((i) => `${i.id}:${i.hash ? 'present' : 'missing'}`),
  })

  const plan = []
  if (drift) {
    if (drift.profileFiles.length) plan.push({ action: 'write-profile-files', items: drift.profileFiles })
    if (drift.plugins.length) plan.push({ action: 'install-plugins', items: drift.plugins })
    if (drift.rules) plan.push({ action: 'write-rules', items: items.rules.map((i) => i.id) })
  }
  const installedHarness = installedHarnessVersion()
  if (harnessPin && installedHarness !== harnessPin) {
    plan.push({ action: 'install-harness', items: [`@deepseek-ai/dsh@${harnessPin}`], have: installedHarness })
  }
  log('harness.installed', { have: installedHarness ?? 'absent', pin: harnessPin ?? 'none' })

  // The Hindsight plugin lives OUTSIDE the profile (a file: row in the home patch layer,
  // installed by its own installer), so its state is not part of the profile hashes. It is
  // still kit state: a reinstall of the plugin reverts the patch, and a child agent silently
  // loses every hindsight_* tool until the next boot converges it. Reported on every run.
  const hindsight = inspectHindsightTools(kit)
  if (hindsight.state === 'unpatched') plan.push({ action: 'patch-hindsight-tools', items: [hindsight.path] })
  log('hindsight.tools', { state: hindsight.state ?? 'unknown', sha256: hindsight.sha256 ?? 'none' })

  // The harness identity guard is kit state too: it lives in the pinned harness, which a global
  // `npm install -g` rewrites without asking. Reported on every run; applied on every converge.
  const identityGuard = inspectIdentityGuard(kit)
  if (identityGuard.state === 'unpatched') plan.push({ action: 'patch-harness-identity', items: [identityGuard.path] })
  log('harness.identity-guard', { state: identityGuard.state ?? 'unknown', sha256: identityGuard.sha256 ?? 'none' })

  if (!drift && plan.length === 0) {
    log('kit.current', { state: statePath(home) })
    // An apply that finds nothing to do still records the head it verified, or the
    // state's `appliedHead` freezes at the last run that wrote an artifact: the machine
    // is converged, but the record points at an older commit and `changedSinceApplied`
    // grows with every scripts-only or documentation commit. Only `--apply` writes —
    // `--check` promises to write nothing, and a check that mutated the state would be
    // the one thing a caller runs it to avoid.
    if (opts.mode === 'apply') {
      const settled = buildState({ items, kit, repo, harness: harnessPin })
      writeFileSync(statePath(home), `${JSON.stringify(settled, null, 2)}\n`)
      log('kit.state-written', { path: statePath(home), actions: [] })
    }
    emit({ ok: true, kit, home, profile: opts.profile, drift: null, plan, applied: [], harness: harnessPin, repo, server: serverView(server, opts.port) })
    return 0
  }

  log('kit.drift', { reason: drift?.reason ?? 'harness-only', actions: plan.map((p) => p.action) })
  if (opts.mode !== 'apply') {
    log('kit.check-only', { hint: 're-run with --apply to converge' })
    emit({ ok: true, kit, home, profile: opts.profile, drift, plan, applied: [], harness: harnessPin, repo, server: serverView(server, opts.port) })
    return 0
  }

  // ── converge ─────────────────────────────────────────────────────────────
  // Profile files, plugin tarballs and rules are always written from the kit on
  // an apply, not only the drifted ones: an earlier run may have been
  // interrupted between the two, and a whole-file copy is cheap next to the
  // risk of a machine that believes it converged while a file is stale.
  // The backup comes FIRST: everything below overwrites files the machine was running,
  // and a backup taken after the first copy protects nothing.
  const backup = createBackup({ home, profile: opts.profile })
  if (backup) log('backup.created', { path: backup.dir, files: backup.files })
  else log('backup.empty', { reason: 'no profile patch or MCP server list on this machine yet' })
  const applied = []
  const patchPath = join(home, 'profiles', opts.profile, 'cordis.patch.yml')
  const modelRow = opts.keepModelConfig ? readModelConfigRow(patchPath) : null
  const writtenFiles = installFiles({ items, home, profile: opts.profile })
  if (modelRow && keepModelConfigRow(patchPath, modelRow)) {
    applied.push('keep-model-config')
    log('files.model-config-kept', { row: 'agent-default-model' })
  }
  if (writtenFiles.length) applied.push('write-profile-files')
  log('files.installed', { items: writtenFiles })
  if (drift?.rules || items.rules.every((i) => i.hash)) applied.push('write-rules')

  // The Hindsight patch is re-applied on every apply, not only when the pre-check said
  // 'unpatched': the two runs are milliseconds apart and a plugin reinstall in between is
  // unlikely, but "patched because we checked" is what makes the state record honest.
  if (hindsight.state !== 'absent' && hindsight.state !== 'script-missing') {
    const patched = inspectHindsightTools(kit, '--apply')
    if (patched.state === 'patched') {
      applied.push('patch-hindsight-tools')
      log('hindsight.patched', { path: patched.path, sha256: patched.sha256 })
    } else {
      warn(`Hindsight subagent-tool patch did not apply (state: ${patched.state ?? patched.error ?? 'unknown'}); hindsight_* tools stay unavailable to subagents`)
    }
  }

  // Re-applied on every converge for the same reason as the Hindsight patch: the check and the
  // apply are milliseconds apart, but "patched because we checked" is what keeps the record honest.
  if (identityGuard.state !== 'absent' && identityGuard.state !== 'script-missing') {
    const guarded = inspectIdentityGuard(kit, '--apply')
    if (guarded.state === 'patched') {
      applied.push('patch-harness-identity')
      log('harness.identity-guarded', { path: guarded.path, sha256: guarded.sha256 })
    } else {
      warn(`Harness identity guard did not apply (state: ${guarded.state ?? guarded.detail ?? 'unknown'}); a message without an id would block its whole session again`)
    }
  }

  const stalePkgs = new Set()
  for (const id of drift?.plugins ?? []) {
    const item = items.plugins.find((p) => p.id === id)
    if (item?.package) stalePkgs.add(item.package)
  }
  // A plugin renamed inside a tarball leaves its old package behind; install
  // every kit tarball whenever the installed set does not match the kit set.
  const installedNames = new Set(installedPluginNames(readJson(join(home, 'profiles', opts.profile, 'package.json'))))
  const kitNames = new Set(items.plugins.map((p) => p.package).filter(Boolean))
  const setMismatch = [...kitNames].some((n) => !installedNames.has(n)) || [...installedNames].some((n) => !kitNames.has(n))
  const toInstall = setMismatch || stalePkgs.size > 0 ? items.plugins : []

  if (toInstall.length) {
    const result = installPlugins({ items: toInstall, home, profile: opts.profile })
    applied.push('install-plugins')
    log('plugins.installed', { items: result.installed, ok: result.ok })
    if (!result.ok) throw new Error('plugin install failed; see pnpm output above')
    const findings = verifyInstalledBytes({ items: toInstall, home, profile: opts.profile })
    if (findings.length) {
      for (const finding of findings) warn(`installed bytes differ from the kit tarball — ${finding}`)
      warn('bump the plugin version in its package manifest, repack with scripts/pack-plugin.mjs --dir plugins/<name>, then re-run this update')
    } else {
      log('plugins.verified', { items: toInstall.map((p) => p.id) })
    }
  } else {
    log('plugins.current', { items: items.plugins.map((p) => p.id) })
  }

  const harnessResult = await convergeHarness({ want: harnessPin, enabled: opts.harness, server })
  if (harnessResult.action === 'installed') applied.push('install-harness')
  log('harness.state', harnessResult)

  // Provision the optional external binaries the features degrade without. Same shape as
  // the MCP projection below: reported, never thrown, because a machine that cannot reach
  // a release server is still a converged machine for every kit-owned artefact.
  //
  // This is what makes a fresh machine complete without a human running a second command.
  // The kit-owned half of the deployment always converged in one call; the binary half did
  // not, and the consequence was a machine that reported converged while rtk,
  // marp, mermaid and d2 were silently absent for weeks. Provisioning is part
  // of convergence now, opt-out with --no-tools or SKIP_TOOLS=1.
  if (opts.tools && process.env.SKIP_TOOLS !== '1') {
    const provisionArgs = [join(kit, 'scripts', 'provision-tools.mjs'), '--apply', '--kit', kit]
    const provisioned = run(process.execPath, provisionArgs, { cwd: kit })
    if (provisioned === null) {
      warn('external tool provisioning did not run to completion; run it directly for the reason:')
      warn(`  node ${join(kit, 'scripts', 'provision-tools.mjs')} --apply`)
    } else {
      applied.push('provision-tools')
      log('tools.provisioned', { report: provisioned.split('\n').filter(Boolean).slice(-3) })
    }
  } else {
    log('tools.skipped', { reason: opts.tools ? 'SKIP_TOOLS=1' : '--no-tools' })
  }

  // Project the declared MCP servers into the home patch layer. This runs LAST and its
  // failure is reported rather than thrown: the spec file has just been projected, so a
  // refusal here (a launcher missing on this machine, or a foreign patch layer) is a
  // fact about this machine and not a reason to leave the rest of the convergence
  // unrecorded. A deployment with no MCP tools still works; a machine that believes it
  // converged when it did not does not.
  //
  // `process.execPath`, not `runTool('node', …)`: the `tool()` resolver only knows the
  // npm-family CLIs and answers null for anything else, so routing this through it would
  // silently never run the sync on Windows — a failure that looks exactly like success.
  //
  // The project directory comes from an EXPLICIT environment variable, never from the
  // working directory. The cwd here is the kit, and a project directory is load-bearing (it
  // is where the editor addon is discovered), so inferring it would record a `cwd` that has
  // no Godot project in it. It is also the launcher's home in the default layout — the
  // provisioned `uvx` lives under `<project>/vendor/uv` — so without it the sync cannot find
  // `uvx` at all. A machine that keeps its Godot project somewhere else sets `GODOT_PROJECT`
  // once in its environment; a machine that has not provisioned anything gets a named
  // refusal from the sync instead of a row that cannot start.
  const godotProject = process.env.GODOT_PROJECT
  const syncArgs = [join(kit, 'scripts', 'dsh-mcp-sync.mjs'), '--apply', '--home', home]
  if (typeof godotProject === 'string' && godotProject.trim() !== '') {
    if (existsSync(join(godotProject, 'project.godot'))) {
      syncArgs.push('--project', godotProject)
    } else {
      warn(`GODOT_PROJECT=${godotProject} holds no project.godot; ignoring it`)
    }
  }
  const sync = run(process.execPath, syncArgs, { cwd: kit })
  if (sync === null) {
    warn('MCP server sync did not run to completion; run it directly for the reason:')
    warn(`  node ${join(kit, 'scripts', 'dsh-mcp-sync.mjs')} --apply`)
  } else {
    applied.push('sync-mcp-servers')
    log('mcp.synced', { report: sync.split('\n').filter(Boolean).slice(-6) })
  }

  const next = buildState({ items, kit, repo, harness: harnessPin })
  writeFileSync(statePath(home), `${JSON.stringify(next, null, 2)}\n`)
  log('kit.state-written', { path: statePath(home) })
  log('kit.applied', { actions: applied, restart: 'required — the profile is composed at boot' })
  emit({ ok: true, kit, home, profile: opts.profile, drift, plan, applied, harness: harnessPin, repo, state: next, server: serverView(server, opts.port), backup })
  return 0
}

/** Emit the single JSON object in JSON mode; human mode already logged. */
function emit(result) {
  if (JSON_MODE) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

try {
  // Top-level await: the live-server watchdog asks the profile port over an HTTP socket,
  // and a synchronous question is not available for a socket in Node.
  process.exitCode = await main(process.argv.slice(2))
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (JSON_MODE) process.stdout.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`)
  else process.stderr.write(`error: ${message}\n`)
  process.exitCode = 1
}
