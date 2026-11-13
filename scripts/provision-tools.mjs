/**
 * PURPOSE
 *   Install — or report on — the external tools the kit's features need, so a fresh
 *   machine does not start with RTK silently inert, Headroom uninstalled, or the
 *   deck/diagram exports unable to render. Missing tools are a supported state (each
 *   feature degrades and says so), which is exactly why nobody notices them for
 *   weeks; this command makes the state explicit and fixable in one step.
 *
 *   WHY NOT ONLY DOCUMENT THEM. A dependency that lives in a README is a dependency
 *   every new machine gets wrong. The kit already pins and installs the harness, the
 *   profile and the plugin tarballs; the binaries belong in the same convergence.
 *
 * INPUTS
 *   --check            report only (default). Writes nothing.
 *   --apply            install what is missing. Never uses sudo.
 *   --json             one JSON object instead of a table.
 *   --only <ids>       comma-separated subset, e.g. "rtk,d2".
 *   --skip <ids>       comma-separated exclusions, e.g. "mermaid".
 *   --kit <path>       kit checkout. Default: the parent of this script.
 *   Environment: RTK_EDITION (default "oss" — Apache-2.0 only), SKIP_TOOLS (set 1 to
 *   make the installer skip this whole step).
 *
 * OUTPUTS
 *   Exit 0 when every selected tool is present or was installed; 1 when any is still
 *   missing after the run; 2 on a usage error. Prints per-tool status, the version it
 *   found, and the exact next command for a manual install.
 *
 * KEYWORDS
 *   provisioning, rtk, headroom, babysitter, marp, mermaid, d2, chrome, installer,
 *   role toolchain, depcruise, semgrep, oasdiff, difftastic, betterleaks, osv-scanner,
 *   lychee, trafilatura, axe-core, pixelmatch, checksum, pin, hooks bridge, dsh-hooks-claude-code
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Already present (any version): never reinstalled, never fetched. The probe is
 *     the authority, so re-running is free and offline-safe. A present version that
 *     differs from the pin is REPORTED as a note, not replaced: a silent upgrade is
 *     how a documented role command stops matching the machine.
 *   - A downloaded release artifact is verified before it is unpacked. The digest is
 *     pinned in this file where the kit measured it, otherwise read from the release's
 *     published checksum file; with neither, the install refuses rather than running
 *     bytes nothing vouched for.
 *   - The kit's own `~/.local/bin/<name>` wins over an ambient binary of the same name
 *     (measured 2026-11-10: conda's trafilatura 2.0.0 sat earlier on PATH than the
 *     pinned 2.3.1), so `--check` reports the version the kit installed.
 *   - Python tools go through `uv tool install`; `pip install` into the conda base is
 *     deliberately not a path this script knows.
 *   - A missing tool is a supported state: the run reports it with the manual command
 *     and exits 1, and the boot proceeds.
 *   - No network: each install fails on its own and is reported with the manual
 *     command; the run continues, and the exit code says something is missing.
 *   - Windows: `--check` works everywhere, `--apply` refuses the POSIX-only installers
 *     with a message naming the equivalent (winget/choco), rather than half-installing.
 *   - A tool whose probe throws (corrupt binary) is reported missing, not present.
 *   - `--apply` installs on every platform: npm-based tools through the global npm
 *     (a `.cmd` shim on Windows, which is why the runner routes through the command
 *     interpreter), rtk and d2 from their release archives onto a directory that is
 *     already on PATH, and headroom through `uv tool install` with uv installed on
 *     demand. A tool whose release asset does not exist for this platform stays
 *     missing and reports the manual command. Two kit-local exceptions are installed
 *     into `<kit>/.tools`, not a global bin: the browser-audit libraries, and the
 *     `@deepseek-ai/dsh-hooks-claude-code` bridge the code-search pack mounts (with the
 *     wire-protocol package it imports and the harness peers npm may not supply).
 *   - Chrome and ffmpeg are DETECTED ONLY: they are OS packages, and installing them
 *     under a user account is how a machine ends up with two browsers.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LOCAL_BIN = join(homedir(), '.local', 'bin')
const DSH_HOME = resolve(process.env.DSH_HOME ?? join(homedir(), '.npm', 'dsh'))

/**
 * The role toolchain, pinned. Each value is the version this kit installs when
 * the tool is absent; a newer release is not adopted silently, because a role's
 * command has to behave the same on every machine. Measured 2026-11-10 against
 * the project's own latest release (see .dsh/research/role-toolchain-install.md).
 *
 * The first group is comment-only here: the entries below read these constants,
 * so the pin lives once instead of once per URL.
 */
const PINS = {
  depcruise: '18.7.2',
  semgrep: '1.185.0',
  oasdiff: '1.37.0',
  difft: '0.72.0',
  betterleaks: '1.10.0',
  osvScanner: '2.7.1',
  lychee: '0.24.2',
  trafilatura: '2.3.1',
  axePlaywright: '4.14.0',
  pixelmatch: '8.0.0',
  playwrightCore: '1.65.0',
  // Code-search pack (profile/code-search.mcp.json). Pinned because a symbol server and an
  // embedding index that change under a deployment change its answers, not just its speed.
  serena: '2.1.0',
  octocode: '0.29.2',
  // Code-search adoption hooks: the real Claude Code hooks bridge the pack mounts for
  // Serena activate/remind/cleanup, plus the wire-protocol package it imports. The bridge is
  // NOT part of the installed harness tree on 0.2.2-rc.3 (its profile symlinks dangle), so the
  // kit installs both into .tools and links the harness peers itself.
  hooksClaudeCode: '0.2.2-rc.3',
  hookProtocol: '0.2.2-rc.3',
}

/** The OS token these release projects publish (`windows`, `darwin`, `linux`). */
function releaseOS({ platform = process.platform } = {}) {
  return { os: platform === 'win32' ? 'windows' : platform === 'darwin' ? 'darwin' : 'linux' }
}

/** sha256 of a file, lowercase hex. */
function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Extract the asset's digest from a release checksum file.
 *
 * PURPOSE
 *   Projects publish their sums in three shapes (`<sum>  <name>`, `<sum> *<name>`,
 *   and the `.sha256` sibling which is one line of the first form). One parser
 *   keeps the installer honest instead of trusting an asset's bytes because the
 *   download succeeded.
 * INPUTS
 *   text  - the checksum file body (string).
 *   asset - basename of the downloaded asset (string).
 * OUTPUTS
 *   Lowercase hex digest, or null when the file does not name the asset.
 * KEYWORDS
 *   checksum, sha256, release asset, verification
 */
function checksumFor(text, asset) {
  for (const line of String(text).split('\n')) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/iu.exec(line.trim())
    if (match !== null && match[2].trim() === asset) return match[1].toLowerCase()
  }
  return null
}

/**
 * Read the version field of an installed package, or null.
 *
 * PURPOSE
 *   The two Node libraries are a kit-level pair, not a CLI, so the probe is their
 *   package metadata rather than `--version`. Reading it also proves the package
 *   directory is complete, not merely present.
 * INPUTS
 *   path - absolute path to the package's package.json (string).
 * OUTPUTS
 *   Version string, or null when the file is missing or unreadable.
 * KEYWORDS
 *   npm package, probe, kit tools directory, axe, pixelmatch
 */
function packageVersion(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    return typeof value.version === 'string' ? value.version : null
  } catch {
    return null
  }
}

/** Parse arguments; unknown flags are a usage error. */
function parseArgs(argv) {
  const options = { mode: 'check', json: false, only: null, skip: null, kit: resolve(join(HERE, '..')) }
  const known = new Set(['check', 'apply', 'json', 'only', 'skip', 'kit'])
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) throw new Error(`unexpected argument ${token}`)
    const [key, inline] = token.slice(2).split('=')
    if (!known.has(key)) throw new Error(`unknown option --${key}`)
    if (key === 'check') { options.mode = 'check'; continue }
    if (key === 'apply') { options.mode = 'apply'; continue }
    if (key === 'json') { options.json = true; continue }
    const value = inline ?? argv[++index]
    if (value === undefined) throw new Error(`--${key} needs a value`)
    if (key === 'kit') options.kit = resolve(value)
    else options[key] = new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))
  }
  return options
}

/** Where a command may live: PATH first, then the per-user bin directories. */
function candidateDirs() {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const extra of [LOCAL_BIN, join(homedir(), '.cargo', 'bin'), join(homedir(), '.npm-global', 'bin')]) {
    if (!dirs.includes(extra)) dirs.push(extra)
  }
  return dirs
}

/**
 * Filename suffixes to try for one name on this platform.
 *
 * PURPOSE
 *   Reproduce the host's own executable resolution, which `statSync` does not do:
 *   Windows runs `node.exe` for the name `node` by appending PATHEXT, and asking
 *   for the bare name finds nothing.
 * INPUTS
 *   name - the requested tool name, e.g. 'node' or 'chrome.exe' (string).
 * OUTPUTS
 *   Array of suffixes to append, '' meaning the name as given. On POSIX, [''].
 *   On Windows, the PATHEXT list (lower-cased) for a name without a dot, because
 *   Windows never executes an extensionless file; [''] when the name already
 *   carries an extension, because that spelling is exact.
 * KEYWORDS
 *   PATHEXT, win32, executable resolution, which, provisioning
 *
 * The bare name is NOT tried first on Windows: `C:\Program Files\nodejs\npm` is a
 * POSIX shell script that exists next to `npm.cmd`, and spawning the former from
 * Node fails with EINVAL. Measured before this change: which('node'), which('git')
 * and which('powershell') all returned null while those programs run on the same
 * PATH, so every Windows probe reported a working tool as missing.
 */
function nameSuffixes(name) {
  if (process.platform !== 'win32') return ['']
  if (name.includes('.')) return ['']
  const configured = String(process.env.PATHEXT ?? '').split(';').map((entry) => entry.trim()).filter(Boolean)
  const suffixes = configured.length > 0 ? configured : ['.COM', '.EXE', '.BAT', '.CMD']
  return suffixes.map((suffix) => suffix.toLowerCase())
}

/** First path from a list that exists as a file, or null. */
function firstExisting(paths) {
  for (const candidate of paths) {
    if (typeof candidate !== 'string' || candidate === '') continue
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // Keep looking.
    }
  }
  return null
}

/** Resolve an executable by name across PATH and the per-user locations. */
export function which(names) {
  const list = Array.isArray(names) ? names : [names]
  for (const dir of candidateDirs()) {
    for (const name of list) {
      for (const suffix of nameSuffixes(name)) {
        const candidate = join(dir, `${name}${suffix}`)
        try {
          if (statSync(candidate).isFile()) return candidate
        } catch {
          // Not here; keep looking.
        }
      }
    }
  }
  return null
}

/**
 * Resolve a tool the way the OS would: by name on PATH, then by the install
 * locations the platform actually uses.
 *
 * PURPOSE
 *   A browser or a vendor tool is frequently installed but not on PATH, which is
 *   the normal case on Windows and macOS. Name-only probing reports it missing and
 *   makes a working feature look unavailable.
 * INPUTS
 *   tool - a TOOLS entry: { names: string[], known?: { [platform]: string[] } }.
 * OUTPUTS
 *   Absolute path (string), or null when neither PATH nor a known location has it.
 * KEYWORDS
 *   chrome, chromium, edge, detection, known locations, per-platform
 */
function resolveToolBin(tool) {
  // A kit-installed binary wins over an ambient one of the same name. Measured
  // 2026-11-10: the conda `trafilatura` 2.0.0 sits earlier on PATH than the pinned
  // uv tool 2.3.1, so a PATH-first probe reported the wrong version as present.
  if (tool.preferLocal === true) {
    for (const name of tool.names) {
      const candidate = join(LOCAL_BIN, process.platform === 'win32' ? `${name}.exe` : name)
      if (existsSync(candidate)) return candidate
    }
  }
  const fromPath = which(tool.names)
  if (fromPath !== null) return fromPath
  const known = tool.known?.[process.platform] ?? []
  return firstExisting(known)
}

/** Run a probe command and return its first line, or null when it fails. */
function probeVersion(bin, args = ['--version']) {
  try {
    const out = execFileSync(bin, args, { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] })
    return String(out).trim().split('\n')[0].slice(0, 120) || 'present'
  } catch {
    return null
  }
}

/**
 * Run a command with inherited stdio so a human sees what is happening.
 *
 * PURPOSE
 *   Run one installer and report whether it exited zero, on every platform.
 * INPUTS
 *   argv - executable followed by its arguments (string[]).
 *   env  - extra environment entries merged over process.env (object, optional).
 * OUTPUTS
 *   true when the command exited 0. false on any non-zero exit, a spawn failure,
 *   or the 15-minute timeout; never throws.
 * KEYWORDS
 *   spawn, install, cross-platform, exit code
 *
 * A `.cmd`/`.bat` shim is NOT spawned here: Node refuses that with EINVAL since
 * CVE-2024-27980, and routing it through `cmd.exe` from spawnSync mis-escapes the
 * quoted path. Callers that need npm resolve its CLI script instead - see
 * installWithNpm - which needs neither.
 */
function run(argv, env = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, ...env },
    timeout: 15 * 60_000,
  })
  return result.status === 0
}

/**
 * Run an async step up to three times.
 *
 * Measured on this deployment (2026-10-26): a web call commonly fails once or twice
 * and then succeeds. Provisioning a fresh machine over a flaky link is exactly the
 * case where a single attempt turns a working install into a reported failure.
 */
async function withRetry(step, attempts = 3) {
  let last
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await step()
    } catch (error) {
      last = error
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
    }
  }
  throw last
}

/** Download a URL to a temp file with Node's fetch (no curl dependency), with retries. */
async function download(url, target) {
  return withRetry(async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(180_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    writeFileSync(target, buffer)
    return target
  })
}

/** Fetch a JSON API with retries. */
async function fetchJson(url) {
  return withRetry(async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
    return response.json()
  })
}

/**
 * Directory a downloaded single binary is installed into.
 *
 * PURPOSE
 *   Put a release binary somewhere the NEXT shell finds it. A tool copied to a
 *   directory that is not on PATH is installed and unreachable at the same time,
 *   which reads exactly like a failed install.
 * INPUTS
 *   none.
 * OUTPUTS
 *   Absolute directory path (string). Windows: the directory npm already puts
 *   global shims in, because it is on PATH and user-writable - measured on this
 *   machine: C:\Users\<user>\AppData\Roaming\npm. POSIX: ~/.local/bin, which the
 *   kit's own rtk installer targets too.
 * KEYWORDS
 *   PATH, bin directory, npm prefix, ~/.local/bin, portable install
 */
function binDir() {
  if (process.platform === 'win32') {
    const npmPrefix = process.env.APPDATA ? join(process.env.APPDATA, 'npm') : null
    if (npmPrefix !== null && existsSync(npmPrefix)) return npmPrefix
  }
  mkdirSync(LOCAL_BIN, { recursive: true })
  return LOCAL_BIN
}

/** Extract a .tar.gz with the system tar, which ships on every target OS. */
function extractTarGz(archive, into) {
  mkdirSync(into, { recursive: true })
  return run(['tar', '-xzf', archive, '-C', into])
}

/**
 * Extract a .zip. Windows has no unzip binary, so PowerShell's Expand-Archive is
 * the one extractor guaranteed to be present there.
 */
function extractZip(archive, into) {
  mkdirSync(into, { recursive: true })
  if (process.platform === 'win32') {
    return run([
      'powershell.exe',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath "${archive}" -DestinationPath "${into}" -Force`,
    ])
  }
  return run(['unzip', '-q', '-o', archive, '-d', into])
}

/**
 * Find one file by name under a freshly extracted directory.
 *
 * PURPOSE
 *   Release archives wrap their binary in a versioned directory whose name changes
 *   every release (`d2-v0.9.0/bin/d2`), so the installer must discover the file
 *   instead of assuming a path.
 * INPUTS
 *   root - directory to search (string).
 *   name - basename to match, case-insensitively, e.g. 'd2.exe' (string).
 * OUTPUTS
 *   Absolute path of the first match in depth-first order, or null when the
 *   archive does not contain it (a failed or renamed release).
 * KEYWORDS
 *   archive layout, find binary, release asset, recursive search
 */
function findInTree(root, name) {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    const candidate = join(root, entry.name)
    if (entry.isDirectory()) {
      const nested = findInTree(candidate, name)
      if (nested !== null) return nested
    } else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return candidate
    }
  }
  return null
}

/**
 * Download a release archive, extract it, and install the binary it carries onto PATH.
 *
 * PURPOSE
 *   Install a tool the release publishes as a binary rather than through a package
 *   manager, without a shell pipeline, an elevation prompt, or an `install.sh`.
 * INPUTS
 *   options.url    - archive URL (string).
 *   options.binary - basename inside the archive, e.g. 'rtk.exe' (string).
 *   options.target - name to install it as, e.g. 'rtk.exe' (string).
 *   options.kind   - 'tar.gz' (default) or 'zip' (string).
 * OUTPUTS
 *   The installed absolute path (string), or null when the download, the
 *   extraction, or the copy failed; the caller reports the manual command.
 * KEYWORDS
 *   release asset, tar.gz, zip, copy, PATH, user-local install
 */
async function installArchiveBinary({ url, binary, target, kind = 'tar.gz', sha256: pinned = null, checksumUrl = null }) {
  const stem = `${target.replaceAll(/\W/gu, '-')}-${process.pid}`
  const archive = join(tmpdir(), kind === 'zip' ? `${stem}.zip` : `${stem}.tar.gz`)
  const into = join(tmpdir(), stem)
  try {
    await download(url, archive)
  } catch {
    return null
  }
  // A downloaded artifact is verified before it is unpacked. The digest is either pinned in
  // this file (the offline, strongest case) or read from the release's published checksum
  // file; with neither, the install refuses rather than running unchecked bytes.
  if (!(await verifyDownload(archive, url, pinned, checksumUrl))) return null
  const extracted = kind === 'zip' ? extractZip(archive, into) : extractTarGz(archive, into)
  if (!extracted) return null
  const found = findInTree(into, binary)
  if (found === null) return null
  const destination = join(binDir(), target)
  try {
    copyFileSync(found, destination)
  } catch {
    return null
  }
  return destination
}

/**
 * Verify one downloaded artifact before it is used.
 *
 * PURPOSE
 *   Put the checksum gate in one place so an archive and a bare release binary
 *   cannot diverge: a pinned digest is compared directly, and a published
 *   checksum file is fetched and parsed only when no digest is pinned.
 * INPUTS
 *   file         - downloaded artifact (absolute path).
 *   url          - artifact URL, whose basename names it in the checksum file.
 *   pinned       - known sha256 hex digest, or null.
 *   checksumUrl  - URL of the release's published checksum file, or null.
 * OUTPUTS
 *   true when the digest matches; false on a mismatch, an absent digest, or a
 *   checksum file that does not name the asset. Never throws.
 * KEYWORDS
 *   checksum, sha256, supply chain, release artifact
 */
async function verifyDownload(file, url, pinned, checksumUrl) {
  const expected = typeof pinned === 'string' && pinned !== ''
    ? pinned.toLowerCase()
    : checksumUrl === null
      ? null
      : await withRetry(async () => {
        const response = await fetch(checksumUrl, { signal: AbortSignal.timeout(60_000) })
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${checksumUrl}`)
        const digest = checksumFor(await response.text(), basename(url))
        if (digest === null) throw new Error(`checksum file does not name ${basename(url)}`)
        return digest
      }).catch(() => null)
  return expected !== null && sha256(file) === expected
}

/**
 * Install a release that publishes the executable as a bare file (no archive).
 *
 * PURPOSE
 *   osv-scanner publishes `osv-scanner_linux_amd64` directly. Pouring it into the
 *   archive path would need a fake archive, so the raw case gets its own small
 *   function that still verifies before copying.
 * INPUTS
 *   url, target, sha256, checksumUrl - as in installArchiveBinary.
 * OUTPUTS
 *   Installed absolute path (string), or null.
 * KEYWORDS
 *   raw binary, osv-scanner, checksum, user-local install
 */
async function installRawBinary({ url, target, sha256: pinned = null, checksumUrl = null }) {
  const temp = join(tmpdir(), `${target.replaceAll(/\W/gu, '-')}-${process.pid}`)
  try {
    await download(url, temp)
  } catch {
    return null
  }
  if (!(await verifyDownload(temp, url, pinned, checksumUrl))) return null
  const destination = join(binDir(), target)
  try {
    copyFileSync(temp, destination)
    if (process.platform !== 'win32') execFileSync('chmod', ['0755', destination])
  } catch {
    return null
  }
  return destination
}

/**
 * Install a pinned Python tool through `uv tool install`.
 *
 * PURPOSE
 *   semgrep and trafilatura are Python CLIs. `pip install` into the conda base is
 *   forbidden on this deployment (it would change every other Python consumer),
 *   so the one supported unattended path is an isolated uv tool environment with
 *   a pinned version. uv also verifies the wheel hashes it downloads from PyPI.
 * INPUTS
 *   spec - pinned requirement, e.g. 'semgrep==1.185.0' (string).
 * OUTPUTS
 *   true when the install exited zero and the shim resolves afterwards.
 * KEYWORDS
 *   uv, python tool, semgrep, trafilatura, isolated install
 */
function installUvTool(spec) {
  const uv = ensureUv()
  if (uv === null) return false
  const installed = run([uv, 'tool', 'install', '--python', '3.13', spec])
  ensureOnPath(join(homedir(), '.local', 'bin'))
  return installed
}

/**
 * The argv that runs the npm CLI, including the Windows shim workaround.
 *
 * PURPOSE
 *   Both the global install and the kit-local `.tools` install need the same
 *   resolution: `npm.cmd` cannot be spawned directly on Windows (EINVAL since
 *   CVE-2024-27980), so the CLI script is run with this node binary instead.
 * INPUTS
 *   args - npm arguments (string[]).
 * OUTPUTS
 *   argv for run(), or null when npm is absent.
 * KEYWORDS
 *   npm, windows shim, npm-cli.js, install
 */
function npmArgv(args) {
  const npm = which('npm')
  if (npm === null) return null
  if (process.platform === 'win32' && /\.cmd$/iu.test(npm)) {
    const cli = join(dirname(npm), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    return existsSync(cli) ? [process.execPath, cli, ...args] : null
  }
  return [npm, ...args]
}

/**
 * Install pinned packages into the kit's own `.tools` directory.
 *
 * PURPOSE
 *   @axe-core/playwright and pixelmatch are libraries a role script imports, not
 *   CLIs, so there is no global binary to install and no PATH entry to wire. They
 *   live beside the kit they serve, so a fresh checkout converges with the same
 *   two versions the report names.
 * INPUTS
 *   directory - the kit's `.tools` path (string).
 * OUTPUTS
 *   true when npm exited zero.
 * KEYWORDS
 *   kit tools directory, npm prefix, axe-core, pixelmatch
 */
/**
 * Whether `.tools/package.json` names the versions this kit pins.
 *
 * WHY THIS EXISTS. The manifest used to be written only when absent, so a PINS bump left it
 * naming the previous versions: npm kept them, `detect()` saw the packages and `--check`
 * reported a healthy install of a set nobody pins. Comparing the manifest with PINS makes
 * that state visible, and `--apply` now rewrites the manifest before installing.
 *
 * @param directory - The kit's `.tools` directory.
 * @returns A sentence naming the drift, or null when it matches (or is unreadable).
 */
/**
 * The dependency set the kit installs into its own `.tools` directory.
 *
 * ONE SOURCE OF TRUTH. The manifest used to be written by the browser-audit installer alone,
 * so a second `.tools` consumer could not be added without one installer silently dropping the
 * other's dependencies. Both the manifest writer and the drift check read this list, so
 * `npm install --prefix <kit>/.tools` always converges the whole set.
 *
 * @returns Package name to exact version.
 */
function kitToolDependencies() {
  return {
    '@axe-core/playwright': PINS.axePlaywright,
    pixelmatch: PINS.pixelmatch,
    'playwright-core': PINS.playwrightCore,
    '@deepseek-ai/dsh-hooks-claude-code': PINS.hooksClaudeCode,
    '@deepseek-ai/dsh-hook-protocol': PINS.hookProtocol,
  }
}

function npmManifestDrift(directory) {
  const manifest = join(directory, 'package.json')
  let dependencies
  try {
    dependencies = JSON.parse(readFileSync(manifest, 'utf8')).dependencies ?? {}
  } catch {
    return null
  }
  const expected = kitToolDependencies()
  const stale = Object.entries(expected)
    .filter(([name, version]) => dependencies[name] !== version)
    .map(([name, version]) => `${name}@${dependencies[name] ?? '(absent)'} (this kit pins ${version})`)
  if (stale.length === 0) return null
  return `${manifest} names ${stale.join(', ')}; run --apply to rewrite it from PINS`
}

function installNpmPrefix(directory) {
  mkdirSync(directory, { recursive: true })
  const manifest = join(directory, 'package.json')
  // ALWAYS rewritten from PINS. Writing it only when absent is why a PINS bump installed the
  // old set: the manifest still named the previous versions, npm kept them, and --check then
  // reported a healthy install of a version nobody pinned.
  writeFileSync(manifest, `${JSON.stringify({
    name: 'dsh-kit-tools',
    private: true,
    type: 'module',
    dependencies: kitToolDependencies(),
  }, null, 2)}\n`, 'utf8')
  const argv = npmArgv(['install', '--prefix', directory, '--no-audit', '--no-fund'])
  return argv !== null && run(argv)
}

/**
 * Locate a harness package that a kit-installed plugin imports at runtime.
 *
 * WHY THIS EXISTS. `@deepseek-ai/dsh-hooks-claude-code` declares the harness packages it
 * imports as PEER dependencies, and npm does not install peers. On the installed harness
 * 0.2.2-rc.3 the profile's `@deepseek-ai/*` entries are dangling symlinks into a node_modules
 * tree that does not contain them, so a bare `npm install` of the bridge leaves
 * `Cannot find package '@deepseek-ai/dsh-hook-protocol'`. The kit therefore links the real
 * packages, resolved from the harness that is actually installed, next to the bridge.
 *
 * @param name - Full package name, e.g. `@deepseek-ai/dsh-tools`.
 * @returns Absolute path to the package directory, or null when the harness does not ship it.
 */
function harnessPackagePath(name) {
  const candidates = []
  const global = globalModulesRoot()
  if (global !== null) {
    candidates.push(join(global, '@deepseek-ai', 'dsh', 'node_modules', name))
    candidates.push(join(global, name))
  }
  // The profile symlinks are checked LAST and by real path: they are the normal location on a
  // healthy machine, and they are exactly what dangles on the measured one.
  candidates.push(join(DSH_HOME, 'profiles', 'node_modules', name))
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return realpathSync(candidate)
    } catch {
      // A dangling symlink throws on realpath; try the next candidate.
    }
  }
  return null
}

/**
 * Link the peer dependencies of kit-installed packages so their imports resolve.
 *
 * @param directory - The kit's `.tools` directory (its `node_modules` is the parent scope).
 * @param packages - Package names to read `peerDependencies` from.
 * @returns `{ linked, unresolved }`, where each entry names the peer and its source.
 */
function linkHarnessPeers(directory, packages) {
  const scope = join(directory, 'node_modules', '@deepseek-ai')
  mkdirSync(scope, { recursive: true })
  const linked = []
  const unresolved = []
  const seen = new Set()
  for (const packageName of packages) {
    let peers = {}
    try {
      peers = JSON.parse(readFileSync(join(directory, 'node_modules', packageName, 'package.json'), 'utf8')).peerDependencies ?? {}
    } catch {
      continue
    }
    for (const peer of Object.keys(peers)) {
      if (seen.has(peer)) continue
      seen.add(peer)
      const target = join(directory, 'node_modules', peer)
      if (existsSync(target)) continue
      const source = harnessPackagePath(peer)
      if (source === null) {
        unresolved.push(peer)
        continue
      }
      mkdirSync(dirname(target), { recursive: true })
      symlinkSync(source, target)
      linked.push({ peer, source })
    }
  }
  return { linked, unresolved }
}

/**
 * Import the hooks bridge out of process and report what it exports.
 *
 * The import is the only honest check that the peer links work: a package that exists but
 * cannot import looks installed to `--check` and fails at boot in the loader.
 *
 * @param directory - The kit's `.tools` directory.
 * @returns `{ ok, detail }`; `detail` is `name`/`inject` or the first error line.
 */
function probeHooksBridge(directory) {
  const entry = join(directory, 'node_modules', '@deepseek-ai', 'dsh-hooks-claude-code', 'lib', 'index.js')
  if (!existsSync(entry)) return { ok: false, detail: 'bridge not installed' }
  try {
    const out = execFileSync(process.execPath, [
      '-e',
      `import(${JSON.stringify(pathToFileURL(entry).href)}).then(m => console.log(JSON.stringify({ name: m.name, inject: m.inject }))).catch(e => { console.error(e.message); process.exit(1) })`,
    ], { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] })
    const parsed = JSON.parse(String(out).trim())
    if (parsed?.name !== 'hooks-claude-code') return { ok: false, detail: `unexpected export ${JSON.stringify(parsed)}` }
    return { ok: true, detail: `${parsed.name} inject=${JSON.stringify(parsed.inject)}` }
  } catch (error) {
    const message = String(error?.stderr ?? error?.message ?? error).trim().split('\n').slice(-1)[0]
    return { ok: false, detail: message.slice(0, 200) }
  }
}

/**
 * Install the hooks bridge and the wire-protocol package it imports, then link harness peers.
 *
 * The order matters: npm installs the two packages (and the bridge's only non-peer dependency,
 * schemastery), and only then can `linkHarnessPeers` read their `peerDependencies`. A failed
 * link is reported by the probe, so `--apply` tells the operator a missing harness package
 * instead of leaving a bridge that cannot import.
 *
 * @param directory - The kit's `.tools` directory.
 * @returns true when npm succeeded and the bridge imports.
 */
function installHooksBridge(directory) {
  const installed = installNpmPrefix(directory)
  linkHarnessPeers(directory, ['dsh-hooks-claude-code', 'dsh-hook-protocol'])
  const probe = probeHooksBridge(directory)
  if (!probe.ok) process.stderr.write(`hooks bridge: ${probe.detail}\n`)
  return installed && probe.ok
}


/**
 * Run a global npm install for a package that has no prebuilt release archive.
 *
 * PURPOSE
 *   One call site for "install this npm package globally", so the Windows shim
 *   problem and the PATH check live in exactly one place.
 * INPUTS
 *   pkg  - package spec, e.g. '@marp-team/marp-cli' (string).
 *   env  - extra environment entries for the install (object, optional).
 * OUTPUTS
 *   npm's own exit status as a boolean (false when npm is absent or the install
 *   failed). The caller re-probes the tool, because a package name and its binary
 *   name differ: `@marp-team/marp-cli` installs `marp`, `@mermaid-js/mermaid-cli`
 *   installs `mmdc`.
 * KEYWORDS
 *   npm, global install, npm-cli.js, windows shim, PATH, provision
 *
 * On Windows `npm` resolves to `npm.cmd`, which spawnSync cannot execute (EINVAL
 * since CVE-2024-27980) and which `cmd.exe` mangles once the path is quoted -
 * measured: `'\"C:\Program Files\nodejs\npm.cmd\"' is not recognized`. Running
 * npm's own CLI script with this node binary needs neither a shell nor a quote.
 */
function installWithNpm(pkg, env = {}) {
  const argv = npmArgv(['install', '-g', '--no-audit', '--no-fund', pkg])
  return argv !== null && run(argv, env)
}

/**
 * Resolve the release asset name for a platform and architecture.
 *
 * PURPOSE
 *   Turn `process.platform`/`process.arch` into the tokens a release actually
 *   publishes. Guessing these is how a macOS machine ends up downloading a Linux
 *   binary: d2 publishes `macos`, not `darwin`, and Windows archives are `.tar.gz`
 *   in the same series as the Unix ones.
 * INPUTS
 *   os   - 'windows' | 'macos' | 'linux' for this run (string).
 *   arch - 'amd64' | 'arm64' (string).
 * OUTPUTS
 *   File name of the archive (string), e.g. 'd2-v0.9.0-macos-arm64.tar.gz'.
 * KEYWORDS
 *   release asset naming, macos, windows, amd64, arm64
 */
function d2AssetName(tag, os, arch) {
  return `d2-${tag}-${os}-${arch}.tar.gz`
}

/** Release-asset tokens for this run: d2 says `macos`, not `darwin`. */
function d2PlatformTokens() {
  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
  return { os, arch }
}

/**
 * Make a directory visible to this process and to future ones.
 *
 * PURPOSE
 *   A tool whose bin directory is not on PATH is installed and unreachable at the
 *   same time. `uv` and its tool shims land in `~/.local/bin`, which on Windows is
 *   not on PATH by default, so wiring the binary also means wiring the PATH.
 * INPUTS
 *   dir - absolute directory that must be searchable (string).
 * OUTPUTS
 *   true when the directory is now on this process's PATH (always, for the caller's
 *   lifetime), and on the persisted user PATH on Windows. false only when the
 *   persisted write failed.
 * KEYWORDS
 *   PATH, setx, user environment, uv, shim, persistence
 */
function ensureOnPath(dir) {
  if (!existsSync(dir)) return false
  const current = String(process.env.PATH ?? '')
  if (!current.split(delimiter).includes(dir)) process.env.PATH = `${dir}${delimiter}${current}`
  if (process.platform !== 'win32') return true
  const escaped = dir.replaceAll("'", "''")
  const added = run([
    'powershell.exe',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$p=[Environment]::GetEnvironmentVariable('Path','User'); if (-not (($p -split ';') -contains '${escaped}')) { [Environment]::SetEnvironmentVariable('Path', ($p.TrimEnd(';') + ';${escaped}'), 'User') }`,
  ])
  return added
}

/**
 * Return a usable `uv`, installing the official one when it is absent.
 *
 * PURPOSE
 *   Headroom is published only as a Python tool, so `uv tool install` is its one
 *   supported unattended path. Without this, "install headroom" always degraded to
 *   a manual instruction.
 * INPUTS
 *   none.
 * OUTPUTS
 *   Absolute path of `uv` (string), or null when its installer failed or the
 *   binary cannot be found afterwards.
 * KEYWORDS
 *   uv, python toolchain, astral, headroom, unattended install
 */
function ensureUv() {
  const existing = which('uv')
  if (existing !== null) return existing
  const installed = process.platform === 'win32'
    ? run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', 'irm https://astral.sh/uv/install.ps1 | iex'])
    : run(['sh', '-c', 'curl -fsSL https://astral.sh/uv/install.sh | sh'])
  if (!installed) return null
  const candidateDirs = [join(homedir(), '.local', 'bin'), join(homedir(), '.cargo', 'bin')]
  for (const dir of candidateDirs) ensureOnPath(dir)
  return which('uv')
}

/** Chrome/Chromium/Edge install locations, per platform. Shared by detection and by
 * the mermaid puppeteer config, so the two cannot disagree about what is installed. */
const CHROME_KNOWN = {
  win32: [
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
}

/** The tool set, in a stable order, with the probe and the installer for each. */
const TOOLS = [
  {
    id: 'rtk',
    label: 'RTK — command-aware output compression',
    required: false,
    names: ['rtk'],
    install: async () => {
      const edition = process.env.RTK_EDITION === '' ? 'oss' : (process.env.RTK_EDITION ?? 'oss')
      if (process.platform === 'win32') {
        // The release publishes a Windows zip per edition (rtk-oss-x86_64-pc-windows-msvc.zip
        // for v1.1.0), so Windows installs the same Apache-2.0 edition the POSIX
        // installer would, without a shell.
        const meta = await fetchJson('https://api.github.com/repos/rtk-ai/rtk/releases/latest')
        const tag = typeof meta?.tag_name === 'string' ? meta.tag_name : ''
        if (tag === '') return false
        const prefix = edition === 'oss' ? 'rtk-oss' : 'rtk'
        const url = `https://github.com/rtk-ai/rtk/releases/download/${tag}/${prefix}-x86_64-pc-windows-msvc.zip`
        return (await installArchiveBinary({ url, binary: 'rtk.exe', target: 'rtk.exe', kind: 'zip' })) !== null
      }
      const script = join(tmpdir(), `rtk-install-${process.pid}.sh`)
      await download('https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh', script)
      return run(['sh', script], { RTK_EDITION: edition, RTK_INSTALL_DIR: LOCAL_BIN })
    },
    manual: 'RTK_EDITION=oss sh <(curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh)',
    manualWindows: 'download rtk-oss-x86_64-pc-windows-msvc.zip from https://github.com/rtk-ai/rtk/releases and put rtk.exe on PATH',
  },
  {
    id: 'headroom',
    label: 'Headroom — model-traffic compression proxy',
    required: false,
    names: ['headroom'],
    install: async () => {
      const uv = ensureUv()
      if (uv === null) return false
      const installed = run([uv, 'tool', 'install', '--python', '3.13', 'headroom-ai[proxy]'])
      // uv puts the shim in ~/.local/bin, which Windows does not search by default.
      ensureOnPath(join(homedir(), '.local', 'bin'))
      return installed && which('headroom') !== null
    },
    manual: 'uv tool install --python 3.13 "headroom-ai[proxy]"',
    manualWindows: 'irm https://astral.sh/uv/install.ps1 | iex; then: uv tool install --python 3.13 "headroom-ai[proxy]"',
  },
  {
    id: 'babysitter',
    label: 'Babysitter — deterministic process runs',
    required: false,
    names: ['babysitter'],
    install: async () => installWithNpm('@a5c-ai/babysitter'),
    manual: 'npm install -g @a5c-ai/babysitter',
  },
  {
    id: 'marp',
    label: 'Marp CLI — deck export to PDF/PPTX',
    required: false,
    names: ['marp'],
    install: async () => installWithNpm('@marp-team/marp-cli'),
    manual: 'npm install -g @marp-team/marp-cli',
  },
  {
    id: 'mermaid',
    label: 'Mermaid CLI — render .mmd source',
    required: false,
    names: ['mmdc'],
    install: async () => {
      // The package installs without its bundled browser; the pinned chrome-headless-shell
      // is then installed deliberately, so a render never touches the user's desktop browser.
      const ok = installWithNpm('@mermaid-js/mermaid-cli', { PUPPETEER_SKIP_DOWNLOAD: '1' })
      if (!ok) return false
      const shell = ensurePuppeteerShell()
      writePuppeteerConfig()
      return shell
    },
    manual: 'PUPPETEER_SKIP_DOWNLOAD=1 npm install -g @mermaid-js/mermaid-cli',
    manualWindows: '$env:PUPPETEER_SKIP_DOWNLOAD="1"; npm install -g @mermaid-js/mermaid-cli',
  },
  {
    id: 'd2',
    label: 'D2 — text-to-diagram renderer',
    required: false,
    names: ['d2'],
    install: async () => {
      const meta = await fetchJson('https://api.github.com/repos/d2lang/d2/releases/latest')
      const tag = typeof meta?.tag_name === 'string' ? meta.tag_name : ''
      if (tag === '') return false
      // The release asset is platform- AND architecture-specific, and the tokens are
      // the project's own: `macos` (not `darwin`), `windows`, `amd64`/`arm64`, all
      // shipped as .tar.gz. Measured against v0.9.0 before this line was written.
      const { os, arch } = d2PlatformTokens()
      const url = `https://github.com/d2lang/d2/releases/download/${tag}/${d2AssetName(tag, os, arch)}`
      const binary = process.platform === 'win32' ? 'd2.exe' : 'd2'
      return (await installArchiveBinary({ url, binary, target: binary })) !== null
    },
    manual: 'download d2-linux-amd64.tar.gz from https://github.com/d2lang/d2/releases and put `d2` on PATH',
    manualWindows: 'download d2-windows-amd64.tar.gz from https://github.com/d2lang/d2/releases and put d2.exe on PATH',
  },
  // ── the role toolchain (pinned 2026-11-10) ─────────────────────────────────
  // These are the CLIs the six agent presets may run. Each entry carries the exact
  // release it installs: an available-but-newer binary is reported, never swapped
  // in, because a role's documented command has to behave the same on every
  // machine. The maintenance evidence (release date, licence, last commit) lives
  // in .dsh/research/role-toolchain-install.md; the digest pins live here.
  {
    id: 'depcruise',
    label: 'dependency-cruiser — architecture rules and dependency graph',
    required: false,
    pin: PINS.depcruise,
    versionPin: PINS.depcruise,
    names: ['depcruise', 'dependency-cruiser'],
    install: async () => installWithNpm(`dependency-cruiser@${PINS.depcruise}`),
    manual: `npm install -g dependency-cruiser@${PINS.depcruise}`,
  },
  {
    id: 'semgrep',
    preferLocal: true,
    label: 'semgrep — pattern-based static analysis',
    required: false,
    pin: PINS.semgrep,
    versionPin: PINS.semgrep,
    names: ['semgrep'],
    install: async () => installUvTool(`semgrep==${PINS.semgrep}`) && which('semgrep') !== null,
    manual: `uv tool install --python 3.13 semgrep==${PINS.semgrep}`,
  },
  {
    id: 'oasdiff',
    preferLocal: true,
    label: 'oasdiff — OpenAPI breaking-change gate',
    required: false,
    pin: PINS.oasdiff,
    versionPin: PINS.oasdiff,
    names: ['oasdiff'],
    install: async () => {
      const { os } = releaseOS()
      const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
      const tag = `v${PINS.oasdiff}`
      const asset = os === 'darwin'
        ? `oasdiff_${PINS.oasdiff}_darwin_all.tar.gz`
        : `oasdiff_${PINS.oasdiff}_${os}_${arch}.tar.gz`
      const base = `https://github.com/oasdiff/oasdiff/releases/download/${tag}`
      const binary = os === 'windows' ? 'oasdiff.exe' : 'oasdiff'
      return (await installArchiveBinary({ url: `${base}/${asset}`, binary, target: binary, checksumUrl: `${base}/checksums.txt` })) !== null
    },
    manual: 'download the oasdiff release archive for this platform from https://github.com/oasdiff/oasdiff/releases and put it on PATH',
  },
  {
    id: 'difft',
    preferLocal: true,
    label: 'difftastic — syntax-aware structural diff',
    required: false,
    pin: PINS.difft,
    versionPin: PINS.difft,
    names: ['difft'],
    install: async () => {
      const { os } = releaseOS()
      const triple = {
        linux: process.arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu',
        darwin: process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin',
      }[os]
      // The project publishes no checksum file, so this kit pins the digest it measured
      // for the one asset it can verify (Linux x64). Other platforms stay a manual row
      // rather than being fetched unverified.
      const pinned = os === 'linux' && process.arch === 'x64' ? '33ea1f003081e9f2422299a434e6040c89085bd9f102b08f3fe30393720d5d4a' : null
      if (triple === undefined || pinned === null) return false
      const url = `https://github.com/Wilfred/difftastic/releases/download/${PINS.difft}/difft-${PINS.difft}-${triple}.tar.gz`
      return (await installArchiveBinary({ url, binary: 'difft', target: 'difft', sha256: pinned })) !== null
    },
    manual: 'download difft from https://github.com/Wilfred/difftastic/releases and put it on PATH (or cargo install difftastic)',
  },
  {
    id: 'betterleaks',
    preferLocal: true,
    label: 'betterleaks — secrets scan (maintained gitleaks successor)',
    required: false,
    pin: PINS.betterleaks,
    versionPin: PINS.betterleaks,
    names: ['betterleaks'],
    install: async () => {
      const { os } = releaseOS()
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
      const tag = `v${PINS.betterleaks}`
      const suffix = os === 'windows' ? 'zip' : 'tar.gz'
      const asset = `betterleaks_${PINS.betterleaks}_${os}_${arch}.${suffix}`
      const base = `https://github.com/betterleaks/betterleaks/releases/download/${tag}`
      const binary = os === 'windows' ? 'betterleaks.exe' : 'betterleaks'
      const pinned = os === 'linux' && process.arch === 'x64' ? '9d9ad503cd5d80d18a939352266c3fcca52f10da9b83cd5cfe646989b13940fe' : null
      return (await installArchiveBinary({
        url: `${base}/${asset}`,
        binary,
        target: binary,
        kind: suffix === 'zip' ? 'zip' : 'tar.gz',
        sha256: pinned,
        checksumUrl: `${base}/checksums.txt`,
      })) !== null
    },
    manual: 'download betterleaks from https://github.com/betterleaks/betterleaks/releases and put it on PATH',
  },
  {
    id: 'osv-scanner',
    preferLocal: true,
    label: 'osv-scanner — dependency vulnerability scan',
    required: false,
    pin: PINS.osvScanner,
    versionPin: PINS.osvScanner,
    names: ['osv-scanner'],
    install: async () => {
      const { os } = releaseOS()
      const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
      const asset = `osv-scanner_${os}_${arch}${os === 'windows' ? '.exe' : ''}`
      const base = `https://github.com/google/osv-scanner/releases/download/v${PINS.osvScanner}`
      const pinned = os === 'linux' && process.arch === 'x64' ? 'fb7dab19a8bd9bbe5c3189f09d4b7ee1820c9553a23bac202648a56efd2f6ee8' : null
      return (await installRawBinary({
        url: `${base}/${asset}`,
        target: process.platform === 'win32' ? 'osv-scanner.exe' : 'osv-scanner',
        sha256: pinned,
        checksumUrl: `${base}/osv-scanner_SHA256SUMS`,
      })) !== null
    },
    manual: 'download osv-scanner from https://github.com/google/osv-scanner/releases and put it on PATH',
  },
  {
    id: 'lychee',
    preferLocal: true,
    label: 'lychee — link and anchor checker',
    required: false,
    pin: PINS.lychee,
    versionPin: PINS.lychee,
    names: ['lychee'],
    install: async () => {
      const { os } = releaseOS()
      const triple = os === 'darwin'
        ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`
        : os === 'windows'
          ? 'x86_64-pc-windows-msvc'
          // The GNU build needs GLIBC 2.39 and this kit runs on Ubuntu 22.04 (2.35);
          // the musl build is static and starts there. Measured 2026-11-10.
          : `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-musl`
      const suffix = os === 'windows' ? 'zip' : 'tar.gz'
      const url = `https://github.com/lycheeverse/lychee/releases/download/lychee-v${PINS.lychee}/lychee-${triple}.${suffix}`
      const binary = os === 'windows' ? 'lychee.exe' : 'lychee'
      const pinned = os === 'linux' && process.arch === 'x64' ? '73657a111819a30c47c08352896796f23d64e4eb2b3ed39b6d32149241566fc5' : null
      return (await installArchiveBinary({
        url,
        binary,
        target: binary,
        kind: suffix === 'zip' ? 'zip' : 'tar.gz',
        sha256: pinned,
        checksumUrl: `${url}.sha256`,
      })) !== null
    },
    manual: 'download the lychee release archive for this platform from https://github.com/lycheeverse/lychee/releases and put it on PATH',
  },
  {
    id: 'serena',
    preferLocal: true,
    label: 'Serena — symbolic code navigation MCP server (code-search pack)',
    required: false,
    pin: PINS.serena,
    versionPin: PINS.serena,
    names: ['serena'],
    // A `uv tool install` puts the console script in ~/.local/bin, which is what the pack's
    // `binary: serena` row resolves. The alternative - `uvx --from …` on every launch - would
    // re-resolve the pin on every bridge restart and add seconds to each session.
    install: async () => installUvTool(`serena-agent==${PINS.serena}`) && which('serena') !== null,
    manual: `uv tool install --python 3.13 serena-agent==${PINS.serena}`,
  },
  {
    id: 'octocode',
    preferLocal: true,
    label: 'Octocode — semantic/AST/graph code retrieval MCP server (code-search pack)',
    required: false,
    pin: PINS.octocode,
    versionPin: PINS.octocode,
    names: ['octocode'],
    // WHICH DIGEST IS VERIFIED. Octocode 0.29.2 publishes `<triple>.sha256` release assets,
    // but they hold the digest of the `.mcpb` bundle for that triple, not of the `.tar.gz`
    // this installer downloads (checked against the release's server.json, which publishes
    // the same value as `fileSha256` for the .mcpb). The digest below is the measured sha256
    // of `octocode-0.29.2-x86_64-unknown-linux-musl.tar.gz` on 2026-11-11; for other targets
    // no digest is pinned, so the install refuses rather than running unverified bytes and
    // prints the manual command.
    install: async () => {
      const { os } = releaseOS()
      const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
      const triple = os === 'darwin'
        ? `${arch}-apple-darwin`
        : os === 'windows'
          ? `${arch}-pc-windows-msvc`
          : `${arch}-unknown-linux-musl`
      const suffix = os === 'windows' ? 'zip' : 'tar.gz'
      const base = `https://github.com/Muvon/octocode/releases/download/${PINS.octocode}`
      const url = `${base}/octocode-${PINS.octocode}-${triple}.${suffix}`
      const binary = os === 'windows' ? 'octocode.exe' : 'octocode'
      const pinned = os === 'linux' && process.arch === 'x64'
        ? '7b4e7908b0e29544a6a5003f3e50803d540e9dc15c8223de3f19f5a626029af8'
        : null
      return (await installArchiveBinary({
        url,
        binary,
        target: binary,
        kind: suffix === 'zip' ? 'zip' : 'tar.gz',
        sha256: pinned,
      })) !== null
    },
    manual: `download octocode-${PINS.octocode}-<triple>.tar.gz from https://github.com/Muvon/octocode/releases/tag/${PINS.octocode}, check its sha256, and put octocode on PATH`,
  },
  {
    id: 'trafilatura',
    preferLocal: true,
    label: 'trafilatura — boilerplate-free web text extraction',
    required: false,
    pin: PINS.trafilatura,
    versionPin: PINS.trafilatura,
    names: ['trafilatura'],
    install: async () => installUvTool(`trafilatura==${PINS.trafilatura}`) && which('trafilatura') !== null,
    manual: `uv tool install --python 3.13 trafilatura==${PINS.trafilatura}`,
  },
  {
    id: 'browser-audit',
    label: 'axe-core + pixelmatch — browser accessibility audit and screenshot diff (kit .tools)',
    required: false,
    pin: `@axe-core/playwright ${PINS.axePlaywright}; pixelmatch ${PINS.pixelmatch}; playwright-core ${PINS.playwrightCore}`,
    // The composite string detect() builds, so `--check` reports a drifted package instead of
    // passing a set that only LOOKS installed (it had no versionPin at all before: the drift
    // note below never fired for the one entry that is not a PATH binary).
    versionPin: `axe ${PINS.axePlaywright}, pixelmatch ${PINS.pixelmatch}, playwright ${PINS.playwrightCore}`,
    names: [],
    // A Node library has no PATH binary; the probe is its package metadata, and the
    // install target is the kit's own .tools directory rather than a global npm prefix.
    detect: (options) => {
      const directory = join(options.kit, '.tools')
      const axe = packageVersion(join(directory, 'node_modules', '@axe-core', 'playwright', 'package.json'))
      const pixelmatch = packageVersion(join(directory, 'node_modules', 'pixelmatch', 'package.json'))
      const playwright = packageVersion(join(directory, 'node_modules', 'playwright-core', 'package.json'))
      // The manifest is the second half of the pin: a bumped PINS with an old manifest installs
      // the old set. installNpmPrefix rewrites it now, and --check says so when they disagree.
      const drift = npmManifestDrift(directory)
      // `drifted` is what makes --apply rewrite the manifest from PINS even though the packages
      // are present: the manifest is kit state, and a stale one keeps the old versions forever.
      const extra = drift === null ? {} : { note: drift, drifted: true }
      if (axe === null || pixelmatch === null || playwright === null) return { bin: null, version: null, ...extra }
      return {
        bin: directory,
        version: `axe ${axe}, pixelmatch ${pixelmatch}, playwright ${playwright}`,
        ...extra,
      }
    },
    install: async ({ options }) => installNpmPrefix(join(options.kit, '.tools')),
    manual: 'npm install --prefix <kit>/.tools (installs @axe-core/playwright, pixelmatch and playwright-core at the pinned versions)',
  },

  {
    id: 'hooks-bridge',
    label: '@deepseek-ai/dsh-hooks-claude-code — Claude Code hooks bridge (Serena activate/remind/cleanup)',
    required: false,
    pin: `@deepseek-ai/dsh-hooks-claude-code ${PINS.hooksClaudeCode}; @deepseek-ai/dsh-hook-protocol ${PINS.hookProtocol}`,
    versionPin: `hooks-claude-code ${PINS.hooksClaudeCode}, hook-protocol ${PINS.hookProtocol}`,
    names: [],
    // Like browser-audit, this is a Node package rather than a PATH binary: the probe is the
    // package metadata plus an out-of-process IMPORT, because a bridge whose peer links are
    // missing exists on disk and cannot load. That exact state was measured on this machine:
    // npm installed the bridge, `import` failed on @deepseek-ai/dsh-hook-protocol, and the
    // loader then reported "did not activate" while the boot continued.
    detect: (options) => {
      const directory = join(options.kit, '.tools')
      const bridge = packageVersion(join(directory, 'node_modules', '@deepseek-ai', 'dsh-hooks-claude-code', 'package.json'))
      const protocol = packageVersion(join(directory, 'node_modules', '@deepseek-ai', 'dsh-hook-protocol', 'package.json'))
      const probe = probeHooksBridge(directory)
      if (bridge === null || protocol === null || !probe.ok) {
        return { bin: null, version: bridge === null ? null : `hooks-claude-code ${bridge}, hook-protocol ${protocol ?? '(absent)'}`, note: probe.ok ? undefined : probe.detail }
      }
      return { bin: join(directory, 'node_modules', '@deepseek-ai', 'dsh-hooks-claude-code', 'lib', 'index.js'), version: `hooks-claude-code ${bridge}, hook-protocol ${protocol}` }
    },
    install: async ({ options }) => installHooksBridge(join(options.kit, '.tools')),
    manual: `npm install --prefix <kit>/.tools @deepseek-ai/dsh-hooks-claude-code@${PINS.hooksClaudeCode} @deepseek-ai/dsh-hook-protocol@${PINS.hookProtocol}, then link the harness peers (node scripts/provision-tools.mjs --apply --only hooks-bridge)`,
  },

  {
    id: 'chrome',
    label: 'Chrome/Chromium — PDF rendering (decks)',
    required: false,
    detectOnly: true,
    names: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome', 'chrome.exe', 'msedge.exe'],
    // Per-platform install locations. A browser is installed OUTSIDE PATH on the
    // two desktop platforms - Windows puts chrome.exe under Program Files and
    // macOS under /Applications - so a name-only probe reports "missing" on a
    // machine whose Chrome is right there. Measured before this change: Chrome
    // present at C:\Program Files\Google\Chrome\Application\chrome.exe, probe
    // answering MISSING.
    known: CHROME_KNOWN,
    manual: 'install Chrome or Chromium with your OS package manager, or set CHROME_PATH',
    manualWindows: 'install Chrome or Edge (winget install Google.Chrome, or winget install Microsoft.Edge), or set CHROME_PATH',
  },
  {
    id: 'ffmpeg',
    label: 'ffmpeg — video output (Manim animations)',
    required: false,
    detectOnly: true,
    names: ['ffmpeg'],
    manual: 'install ffmpeg with your OS package manager',
    manualWindows: 'install ffmpeg with winget (Gyan.FFmpeg) or choco, then put ffmpeg.exe on PATH',
  },
]

/**
 * Where globally installed npm packages live, so a package's own tooling can be run.
 *
 * PURPOSE
 *   mermaid-cli's puppeteer must install the browser revision IT was pinned to, and only
 *   the copy inside that package knows which revision that is.
 * INPUTS
 *   none.
 * OUTPUTS
 *   Absolute `node_modules` directory (string), or null when it cannot be determined.
 * KEYWORDS
 *   npm root -g, global modules, puppeteer, mermaid-cli
 */
function globalModulesRoot() {
  if (process.platform === 'win32') {
    const root = join(binDir(), 'node_modules')
    return existsSync(root) ? root : null
  }
  const npm = which('npm')
  if (npm === null) return null
  try {
    const out = execFileSync(npm, ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const value = String(out).trim()
    return value === '' ? null : value
  } catch {
    return null
  }
}

/**
 * Install the browser revision mermaid-cli's puppeteer pins.
 *
 * PURPOSE
 *   `mmdc` defaults to `headless: "shell"`, which needs its own `chrome-headless-shell`
 *   binary. Without that exact revision every render fails with "Could not find
 *   chrome-headless-shell (ver. …)". The tempting workaround - pointing puppeteer at the
 *   installed desktop Chrome with PUPPETEER_EXECUTABLE_PATH - makes a user's browser the
 *   machine-wide target of every puppeteer consumer and can put real windows on screen,
 *   which is exactly what a tool call must never do. Installing the pinned shell keeps
 *   rendering headless and leaves the user's browser alone.
 * INPUTS
 *   none.
 * OUTPUTS
 *   true when the pinned shell is installed or already present, false when the mermaid-cli
 *   puppeteer CLI is missing or the download failed.
 * KEYWORDS
 *   puppeteer, chrome-headless-shell, mermaid-cli, headless, revision pin
 */
function ensurePuppeteerShell() {
  const root = globalModulesRoot()
  if (root === null) return false
  const cli = join(root, '@mermaid-js', 'mermaid-cli', 'node_modules', 'puppeteer', 'lib', 'puppeteer', 'node', 'cli.js')
  if (!existsSync(cli)) return false
  return run([process.execPath, cli, 'browsers', 'install', 'chrome-headless-shell'])
}

/**
 * Write the puppeteer config mmdc should use, with headlessness stated rather than assumed.
 *
 * PURPOSE
 *   `@mermaid-js/mermaid-cli` is installed with PUPPETEER_SKIP_DOWNLOAD=1, so its browser is
 *   provisioned deliberately rather than by a postinstall; this config then pins `headless`
 *   and the flags that keep a render off the desktop - no extensions, no sync, no first-run
 *   window.
 * INPUTS
 *   none.
 * OUTPUTS
 *   true when the config was written; false when the file could not be written.
 * KEYWORDS
 *   mermaid, mmdc, puppeteer, headless shell, JSON, BOM
 *
 * Two measured details. The file is UTF-8 with NO byte-order mark: PowerShell's
 * `Set-Content -Encoding utf8` adds one and mermaid-cli's `JSON.parse` then rejects the file
 * with "Unexpected token", so `mmdc -p <config>` failed while the same flags inline worked.
 * And `headless` is spelled "shell" to match the pinned chrome-headless-shell - never the
 * desktop Chrome, which would render in a real window.
 */
function writePuppeteerConfig() {
  const target = join(DSH_HOME, 'mermaid-puppeteer.json')
  const config = {
    headless: 'shell',
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-sync',
      '--hide-scrollbars',
    ],
  }
  try {
    mkdirSync(DSH_HOME, { recursive: true })
    writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    return true
  } catch {
    // A missing config is reported by the mmdc hint, not a failed install.
    return false
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const selected = TOOLS.filter((tool) => (options.only === null || options.only.has(tool.id))
    && (options.skip === null || !options.skip.has(tool.id)))
  if (selected.length === 0) throw new Error('no tool selected')

  const report = { mode: options.mode, platform: process.platform, tools: [] }
  let missing = 0
  /**
   * Probe one tool through its own detector when it has one, because a Node
   * library has no PATH binary to resolve. Everything else keeps the same
   * PATH-then-known-locations resolution the kit has always used.
   */
  const detect = (tool) => typeof tool.detect === 'function'
    ? tool.detect(options)
    : (() => {
      const bin = resolveToolBin(tool)
      return { bin, version: bin === null ? null : probeVersion(bin, tool.probeArgs) }
    })()
  for (const tool of selected) {
    const found = detect(tool)
    const bin = found.bin
    const version = found.version
    const entry = {
      id: tool.id,
      label: tool.label,
      ...(typeof tool.pin === 'string' ? { pin: tool.pin } : {}),
      status: bin === null ? 'missing' : 'present',
      bin: bin ?? null,
      version,
      action: bin === null ? 'install' : 'none',
    }
    // A present tool is reported with the version it actually runs. When that is not
    // the pin, say so: silently running an older release is the drift this list exists
    // to make visible, and replacing a working binary without being asked is worse.
    if (version !== null && typeof tool.versionPin === 'string' && !version.includes(tool.versionPin)) {
      entry.note = `running ${version}; this kit pins ${tool.versionPin}`
    }
    // A detector may know something the version string cannot say (the .tools manifest vs the
    // PINS). Its note is appended, never hidden behind the version note.
    if (typeof found.note === 'string' && found.note !== '') entry.note = entry.note === undefined ? found.note : `${entry.note}; ${found.note}`
    if ((bin === null || found.drifted === true) && options.mode === 'apply') {
      if (tool.detectOnly === true) {
        entry.action = 'manual'
      } else {
        const ok = await tool.install({ options }).catch(() => false)
        const after = detect(tool)
        entry.status = after.bin === null ? 'missing' : 'installed'
        entry.bin = after.bin ?? null
        entry.version = after.version
        entry.action = after.bin === null ? 'manual' : 'none'
        // The report describes the state AFTER --apply: a drift that the install fixed is not
        // reported as still there.
        const afterNote = typeof after.note === 'string' && after.note !== ''
          ? after.note
          : (after.version !== null && typeof tool.versionPin === 'string' && !after.version.includes(tool.versionPin) ? `running ${after.version}; this kit pins ${tool.versionPin}` : undefined)
        if (afterNote === undefined) delete entry.note
        else entry.note = afterNote
        if (after.bin === null) entry.note = `the installer ran without producing ${tool.id}; see its output above`
        else if (!ok) entry.note = 'installed, but the installer reported a non-zero exit'
      }
    }
    if (entry.status === 'missing') {
      missing += 1
      // The next command must be one this shell can run: a POSIX env-var prefix
      // and a Linux asset name are actively wrong advice on Windows.
      entry.manual = process.platform === 'win32' && tool.manualWindows ? tool.manualWindows : tool.manual
    }
    report.tools.push(entry)
    if (!options.json) {
      const version = entry.version === null ? '' : `  ${entry.version}`
      process.stdout.write(`${entry.status === 'missing' ? 'MISSING' : entry.status === 'installed' ? 'INSTALLED' : 'ok     '}  ${tool.id}${version}\n`)
      if (entry.note !== undefined) process.stdout.write(`         note: ${entry.note}\n`)
      if (entry.status === 'missing') process.stdout.write(`         manual: ${entry.manual}\n`)
    }
  }
  report.missing = missing
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  else process.stdout.write(`\n${selected.length - missing}/${selected.length} tools available${missing > 0 ? ` — ${missing} missing (run with --apply to install)` : ''}\n`)
  process.exit(missing === 0 ? 0 : 1)
}

const direct = process.argv[1] === undefined ? true : resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (direct) {
  main().catch((error) => {
    process.stderr.write(`provision-tools: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  })
}
