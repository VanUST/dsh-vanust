#!/usr/bin/env node
/**
 * PURPOSE
 *   Make a machine's live dsh deployment match this kit, repeatedly and safely.
 *   The kit is the canonical source (profile files + plugin tarballs + global
 *   rules + harness pin); every machine is a projection of it. This script is
 *   what turns "the kit changed" into "the machine converged", on any OS, from
 *   either PowerShell or bash, so the update loop does not depend on the shell
 *   that started it.
 *
 * INPUTS
 *   --kit <dir>       kit root (default: the parent of this script's directory)
 *   --home <dir>      DSH_HOME (default: env DSH_HOME, else <userhome>/.npm/dsh)
 *   --profile <name>  profile to converge (default: "web")
 *   --check           report drift only; write nothing (default when no flag)
 *   --apply           converge the machine, then write the state record
 *   --fetch           git fetch the kit before deciding what drifted
 *   --json            emit one JSON object on stdout (logs still go to stderr)
 *   --no-harness      never touch the globally installed harness
 *   --help            usage
 *
 * OUTPUTS
 *   Human mode: key-value progress lines on stdout, diagnostics on stderr.
 *   JSON mode:  exactly one JSON object on stdout:
 *               { ok, kit, home, profile, drift, plan, applied, harness, error }
 *               `drift` is null when nothing changed; `plan` lists the concrete
 *               actions; `applied` lists what actually ran. Exits 0 when the
 *               run reached a decision (drift or not), 1 only on hard failure,
 *               so a caller can separate "needs update" from "could not tell".
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
 *   - JSON mode never mixes logs into stdout, so a caller can always parse it.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── argument parsing ───────────────────────────────────────────────────────

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const KIT_DEFAULT = resolve(SCRIPT_DIR, '..')

/** Human-facing usage text for `--help`. */
const USAGE = `kit-update — converge an installed machine onto this kit

  node scripts/kit-update.mjs [--check | --apply] [--fetch] [--json]
                              [--kit <dir>] [--home <dir>] [--profile <name>]
                              [--no-harness] [--help]

  --check       report what differs from the kit; write nothing (default)
  --apply       write the profile files and rules, install drifted plugin
                tarballs and the pinned harness, then record the machine state
  --fetch       ask git for new commits before deciding what drifted
  --json        emit one JSON object on stdout (logs still go to stderr)
  --kit <dir>   kit checkout (default: the parent of this script's directory)
  --home <dir>  harness home (default: $DSH_HOME, else <userhome>/.npm/dsh)
  --profile     profile to converge (default: web)
  --no-harness  never touch the globally installed harness
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

/** Record one structured event and echo it to the operator-visible stream. */
function log(event, fields = {}) {
  const entry = { event, ...fields }
  LOG.push(entry)
  if (JSON_MODE) return
  const detail = Object.entries(fields)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`)
    .join(' ')
  console.log(detail ? `${event} ${detail}` : event)
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

/** Run a command with the operator watching its output; returns success. */
function runVisible(cmd, args, options = {}) {
  try {
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
 * `rules` is a LIST, not one file: the deployment's rules reach a model through
 * `AGENTS.md`, and the procedure those rules point at for setup, update and
 * verification lives in `DEPLOYMENT.md` beside it. Both are installed together,
 * because a pointer to a file the machine does not have is worse than no pointer.
 */
function inventoryKit(kit, profile) {
  const items = {
    profile: [
      { id: 'cordis.patch.yml', src: join(kit, 'profile', 'cordis.patch.yml'), dst: join('profiles', profile, 'cordis.patch.yml') },
      { id: 'package.json', src: join(kit, 'profile', 'package.json'), dst: join('profiles', profile, 'package.json') },
      { id: 'pnpm-workspace.yaml', src: join(kit, 'profile', 'pnpm-workspace.yaml'), dst: join('profiles', profile, 'pnpm-workspace.yaml') },
    ].map((item) => ({ ...item, hash: hashFile(item.src) })),
    rules: ['AGENTS.md', 'DEPLOYMENT.md'].map((id) => ({
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
  // The recorded rules hash was a single string before `DEPLOYMENT.md` joined
  // `AGENTS.md`; a state written by that version cannot vouch for the new file, so an
  // unreadable entry counts as drift and the next apply rewrites both.
  const recordedRule = (id) =>
    typeof state?.rules === 'string' ? (id === 'AGENTS.md' ? state.rules : null) : (state?.rules?.[id] ?? null)
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
 * Install or repair the globally pinned harness when the machine's version
 * differs from the kit's `install.ps1`/`install.sh` pin. Both installers carry
 * the same literal, which is read here so a pin bump in the kit propagates
 * without editing this script.
 */
function convergeHarness({ want, enabled }) {
  if (!enabled) return { action: 'skipped' }
  const have = installedHarnessVersion()
  if (have === want) return { action: 'already-current', have, want }
  if (!want) {
    warn('the kit declares no harness pin; leaving the installed harness alone')
    return { action: 'skipped', have, want }
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

// ── state ──────────────────────────────────────────────────────────────────

/** Where the machine records what it last converged to. */
function statePath(home) {
  return join(home, '.dsh-kit-state.json')
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
function main(argv) {
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
  const harnessPin = pinnedHarness(kit)

  log('kit.inventory', { kit, home, profile: opts.profile, mode: opts.mode })
  if (!existsSync(kit)) throw new Error(`kit directory not found: ${kit}`)
  if (opts.fetch) {
    const fetched = run('git', ['-C', kit, 'fetch', '--quiet', 'origin'])
    log('kit.fetch', { ok: Boolean(fetched) })
    if (!fetched) warn('git fetch failed; deciding on the working tree as it is')
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

  if (!drift && plan.length === 0) {
    log('kit.current', { state: statePath(home) })
    emit({ ok: true, kit, home, profile: opts.profile, drift: null, plan, applied: [], harness: harnessPin, repo })
    return 0
  }

  log('kit.drift', { reason: drift?.reason ?? 'harness-only', actions: plan.map((p) => p.action) })
  if (opts.mode !== 'apply') {
    log('kit.check-only', { hint: 're-run with --apply to converge' })
    emit({ ok: true, kit, home, profile: opts.profile, drift, plan, applied: [], harness: harnessPin, repo })
    return 0
  }

  // ── converge ─────────────────────────────────────────────────────────────
  // Profile files, plugin tarballs and rules are always written from the kit on
  // an apply, not only the drifted ones: an earlier run may have been
  // interrupted between the two, and a whole-file copy is cheap next to the
  // risk of a machine that believes it converged while a file is stale.
  const applied = []
  const writtenFiles = installFiles({ items, home, profile: opts.profile })
  if (writtenFiles.length) applied.push('write-profile-files')
  log('files.installed', { items: writtenFiles })
  if (drift?.rules || items.rules.every((i) => i.hash)) applied.push('write-rules')

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
      warn('bump the plugin version in its package manifest, repack with scripts/rebuild-plugins.sh, then re-run this update')
    } else {
      log('plugins.verified', { items: toInstall.map((p) => p.id) })
    }
  } else {
    log('plugins.current', { items: items.plugins.map((p) => p.id) })
  }

  const harnessResult = convergeHarness({ want: harnessPin, enabled: opts.harness })
  if (harnessResult.action !== 'skipped' && harnessResult.action !== 'already-current') applied.push('install-harness')
  log('harness.state', harnessResult)

  const next = buildState({ items, kit, repo, harness: harnessPin })
  writeFileSync(statePath(home), `${JSON.stringify(next, null, 2)}\n`)
  log('kit.state-written', { path: statePath(home) })
  log('kit.applied', { actions: applied, restart: 'required — the profile is composed at boot' })
  emit({ ok: true, kit, home, profile: opts.profile, drift, plan, applied, harness: harnessPin, repo, state: next })
  return 0
}

/** Emit the single JSON object in JSON mode; human mode already logged. */
function emit(result) {
  if (JSON_MODE) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

try {
  process.exitCode = main(process.argv.slice(2))
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (JSON_MODE) process.stdout.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`)
  else process.stderr.write(`error: ${message}\n`)
  process.exitCode = 1
}
